/**
 * Reglas de la planificación por snapshot (ADR-008), puras y sin DB.
 *
 * Port 1:1 de las versiones VIGENTES de las funciones PL/pgSQL:
 *   planificacion_ventana (063), snapshot_validar_payload (063), snapshot_calcular_diff (075),
 *   snapshot_faltantes_actual / snapshot_faltantes_proxima (073), snapshot_armar_diff_json (063),
 *   planificacion_marcar_dias_vacios (075) y el cálculo de generar_semana_desde_snapshot (075).
 *
 * Reglas de diseño:
 *  - "ahora" siempre llega por parámetro (TimestampLocal, hora de pared de Argentina); nunca new Date().
 *  - Todas las duraciones/objetivos son minutos enteros; el payload de la planilla trae horas
 *    (minutosObjetivoDesdeHoras las convierte igual que ROUND(horas * 60) de la migración 073).
 *
 * Responsabilidad del REPO/SERVICE (no replicable acá, depende de la DB):
 *  - pg_advisory_xact_lock(7305101), SELECT ... FOR UPDATE del snapshot, estados y expiración.
 *  - INSERT ... ON CONFLICT (user_context_id, turno, DATE(esperado_in)) DO NOTHING (altas, turnos de
 *    la semana, genéricos) y su ROW_COUNT; el feriado heredado de las altas de snapshot_aplicar.
 *  - Cargar los insumos (planificacion_diaria de la ventana, solicitudes APROBADAS no borradas,
 *    v_interno_users, sedes activas, objetivos) con los tipos de entrada de este archivo.
 *  - Borrar los turnos genéricos de los días que cubre la plantilla (ver diasCubiertosPorPlantilla).
 *  - Aplicar las licencias a los turnos insertados (aplicar_licencias_a_turnos) y promover objetivos.
 *
 * Orden de strings (apellido, nombre): el SQL ordena con la collation de la DB; acá se usa
 * Intl.Collator('es'), que es equivalente para nombres comunes pero no garantiza paridad bit a bit
 * con colaciones exóticas. Los empates conservan el orden de entrada (sort estable).
 */
import {
    FechaLocal,
    TimestampLocal,
    combinar,
    compararTs,
    diffMinutos,
    fechaDe,
    horaMinuto,
    isoDow,
    rangoFechas,
    redondearPg,
    sumarDias,
    sumarMinutos,
} from './fechaLocal';
import { jornadaMinutos } from './jornada';

/* ------------------------------------------------------------------ */
/* Tipos de entrada                                                    */
/* ------------------------------------------------------------------ */

export type TurnoSnapshotNombre = 'Mañana' | 'Tarde';
export type TurnoNombre = TurnoSnapshotNombre | 'Rotativo';

/** Fila de planificacion_snapshot_turno (hora_in/out como 'HH:MM'). */
export interface SnapshotTurno {
    userContextId: number;
    /** 1 = lunes ... 6 = sábado */
    diaSemana: number;
    turno: TurnoSnapshotNombre;
    horaIn: string;
    horaOut: string;
    sedeId: number;
}

/** Fila de planificacion_diaria. */
export interface TurnoDiario {
    id: number;
    userContextId: number;
    turno: TurnoNombre;
    esperadoIn: TimestampLocal;
    esperadoOut: TimestampLocal | null;
    sedeIdIn: number | null;
    sedeIdOut: number | null;
    licencia: boolean;
    minutosLicencia: number;
    horarioCorrido: boolean;
    marcadoInAt: TimestampLocal | null;
    marcadoOutAt: TimestampLocal | null;
    generica: boolean;
    feriado: boolean;
}

/** Solicitud de ausencia. El repo carga solo las APROBADAS y no borradas (deleted_at IS NULL). */
export interface SolicitudAprobada {
    usuarioId: number;
    fechaInicio: TimestampLocal;
    fechaFin: TimestampLocal;
    /** null = licencia por días; con valor = por horas (no omite altas/modificaciones). */
    cantidadMinutos: number | null;
}

/** Fila de v_interno_users. */
export interface UsuarioInfo {
    userContextId: number;
    nombre: string;
    apellido: string;
    rolNombre: string;
}

/** Fila de usuarios_horas_objetivo (minutos). */
export interface ObjetivoUsuario {
    userContextId: number;
    minutosObjetivo: number | null;
    minutosObjetivoPendiente?: number | null;
}

/** Fila de planificacion_snapshot_objetivo (minutos). */
export interface ObjetivoSnapshot {
    userContextId: number;
    minutosObjetivo: number;
}

export interface Ventana {
    desde: FechaLocal;
    hasta: FechaLocal;
    lunes: FechaLocal;
}

export type AccionDiff = 'sin_cambio' | 'alta' | 'modificacion' | 'baja' | 'omitido';
export type MotivoDiff = '2H' | 'MARCADO' | 'LICENCIA' | null;

export interface FilaDiff {
    userContextId: number;
    turno: TurnoSnapshotNombre;
    fecha: FechaLocal;
    accion: AccionDiff;
    motivo: MotivoDiff;
    oldId: number | null;
    oldIn: TimestampLocal | null;
    oldOut: TimestampLocal | null;
    oldSedeIn: number | null;
    oldSedeOut: number | null;
    oldCorrido: boolean | null;
    newIn: TimestampLocal | null;
    newOut: TimestampLocal | null;
    newSede: number | null;
}

export interface Faltante {
    user_context_id: number;
    nombre: string;
    apellido: string;
    horas: number;
    objetivo: number;
}

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

const ORDEN_TURNO: Record<string, number> = { Mañana: 0, Tarde: 1, Rotativo: 2 };
const colador = new Intl.Collator('es');

const aTexto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** ROUND(minutos / 60.0, 2) de PG, a partir de minutos (sin empates posibles con minutos enteros). */
const minutosAHoras2 = (minutos: number): number => redondearPg((minutos * 100) / 60) / 100;

/** planificacion_ventana */
export const ventana = (ahora: TimestampLocal): Ventana => {
    const hoy = fechaDe(ahora);
    const dow = isoDow(hoy);
    const lunes = dow === 7 ? sumarDias(hoy, 1) : sumarDias(hoy, -(dow - 1));
    const desde = dow === 7 ? lunes : hoy;
    return { desde, hasta: sumarDias(lunes, 5), lunes };
};

/** ROUND(horas * 60) de PG (conversión del objetivo de la planilla a minutos). */
export const minutosObjetivoDesdeHoras = (horas: number): number => redondearPg(horas * 60);

const mapaUsuarios = (usuarios: readonly UsuarioInfo[]): Map<number, UsuarioInfo> =>
    new Map(usuarios.map((u) => [u.userContextId, u]));

const compararUsuarios = (a: UsuarioInfo, b: UsuarioInfo): number =>
    colador.compare(a.apellido, b.apellido) || colador.compare(a.nombre, b.nombre);

/* ------------------------------------------------------------------ */
/* snapshot_validar_payload                                            */
/* ------------------------------------------------------------------ */

export interface TurnoPayloadCrudo {
    user_context_id?: number | null;
    dia_semana?: number | null;
    turno?: string | null;
    hora_in?: string | null;
    hora_out?: string | null;
    sede_id?: number | null;
}
export interface ObjetivoPayloadCrudo {
    user_context_id?: number | null;
    horas?: number | null;
}
export interface PayloadSnapshot {
    turnos?: TurnoPayloadCrudo[] | null;
    objetivos?: ObjetivoPayloadCrudo[] | null;
}

export interface ContextoValidacion {
    /** user_context_id presentes en v_interno_users. */
    usuariosExistentes: ReadonlySet<number> | readonly number[];
    /** ids de sedes con activo = true. */
    sedesActivas: ReadonlySet<number> | readonly number[];
    /** count(*) de planificacion_snapshot_turno de snapshots ACTIVO. */
    turnosSnapshotActivo: number;
}

const RE_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const comoSet = (x: ReadonlySet<number> | readonly number[]): ReadonlySet<number> => (x instanceof Set ? x : new Set(x));

/**
 * snapshot_validar_payload: mismos mensajes y mismo orden de chequeos.
 * Los chequeos con DISTINCT (usuario inexistente, sede) devuelven mensajes únicos ordenados.
 */
export const validarPayload = (payload: PayloadSnapshot | null | undefined, ctx: ContextoValidacion): string[] => {
    if (!payload || !Array.isArray(payload.turnos) || payload.turnos.length === 0) {
        return ['La planilla no tiene turnos.'];
    }
    const turnos = payload.turnos;
    const usuarios = comoSet(ctx.usuariosExistentes);
    const sedes = comoSet(ctx.sedesActivas);
    const errores: string[] = [];
    const unicos = (mensajes: string[]): string[] => [...new Set(mensajes)].sort();

    errores.push(...unicos(
        turnos
            .filter((t) => t.user_context_id == null || !usuarios.has(t.user_context_id))
            .map((t) => `Usuario ${aTexto(t.user_context_id)} inexistente o dado de baja.`),
    ));

    for (const t of turnos) {
        if (t.turno == null || (t.turno !== 'Mañana' && t.turno !== 'Tarde')) {
            errores.push(`Usuario ${aTexto(t.user_context_id)}: turno inválido "${aTexto(t.turno)}" (se esperaba Mañana o Tarde).`);
        }
    }

    for (const t of turnos) {
        if (t.dia_semana == null || t.dia_semana < 1 || t.dia_semana > 6) {
            errores.push(`Usuario ${aTexto(t.user_context_id)}: día de semana inválido (${aTexto(t.dia_semana)}).`);
        }
    }

    for (const t of turnos) {
        const inOk = t.hora_in != null && RE_HORA.test(t.hora_in);
        const outOk = t.hora_out != null && RE_HORA.test(t.hora_out);
        if (t.hora_in == null || t.hora_out == null || !inOk || !outOk || (inOk && outOk && t.hora_out! <= t.hora_in!)) {
            errores.push(`Usuario ${aTexto(t.user_context_id)}, día ${aTexto(t.dia_semana)}: horario inválido (${aTexto(t.hora_in)} - ${aTexto(t.hora_out)}).`);
        }
    }

    errores.push(...unicos(
        turnos
            .filter((t) => t.sede_id == null || !sedes.has(t.sede_id))
            .map((t) => `Usuario ${aTexto(t.user_context_id)}: sede ${aTexto(t.sede_id)} inexistente o inactiva.`),
    ));

    // GROUP BY (usuario, día, turno) HAVING count(*) > 1, en orden de primera aparición
    const grupos = new Map<string, { t: TurnoPayloadCrudo; n: number }>();
    for (const t of turnos) {
        const clave = `${aTexto(t.user_context_id)}|${aTexto(t.dia_semana)}|${aTexto(t.turno)}`;
        const g = grupos.get(clave);
        if (g) g.n += 1;
        else grupos.set(clave, { t, n: 1 });
    }
    for (const { t, n } of grupos.values()) {
        if (n > 1) errores.push(`Usuario ${aTexto(t.user_context_id)}, día ${aTexto(t.dia_semana)}: turno ${aTexto(t.turno)} duplicado.`);
    }

    for (const m of turnos) {
        if (m.turno !== 'Mañana' || m.user_context_id == null || m.dia_semana == null) continue;
        for (const t of turnos) {
            if (t.turno !== 'Tarde' || t.user_context_id !== m.user_context_id || t.dia_semana !== m.dia_semana) continue;
            if (m.hora_out != null && t.hora_in != null && RE_HORA.test(m.hora_out) && RE_HORA.test(t.hora_in) && t.hora_in < m.hora_out) {
                errores.push(`Usuario ${m.user_context_id}, día ${m.dia_semana}: los turnos Mañana y Tarde se solapan.`);
            }
        }
    }

    if (Array.isArray(payload.objetivos)) {
        for (const o of payload.objetivos) {
            if (o.user_context_id == null || o.horas == null || o.horas < 0 || o.horas > 168 || !usuarios.has(o.user_context_id)) {
                errores.push(`Objetivo del usuario ${aTexto(o.user_context_id)} inválido (${aTexto(o.horas)} horas).`);
            }
        }
    }

    // Guarda anti-borrado: no se acepta una planilla con menos de la mitad de los turnos del snapshot activo.
    const activos = ctx.turnosSnapshotActivo;
    const nuevos = turnos.length;
    if (activos > 0 && nuevos * 2 < activos) {
        errores.push(`La planilla tiene ${nuevos} turnos y la vigente ${activos}: parece que se borró contenido. Revisá la planilla.`);
    }

    return errores;
};

/* ------------------------------------------------------------------ */
/* snapshot_calcular_diff                                              */
/* ------------------------------------------------------------------ */

export interface EntradaCalcularDiff {
    snapshotTurnos: readonly SnapshotTurno[];
    /**
     * planificacion_diaria candidatos a "viejos". Se filtran acá (usuarios del snapshot, solo
     * Mañana/Tarde, no genéricos, fecha dentro de la ventana), así que el repo puede cargar de más.
     */
    turnosViejos: readonly TurnoDiario[];
    /** Solicitudes APROBADAS no borradas; solo se usan las de días (cantidadMinutos == null). */
    solicitudes: readonly SolicitudAprobada[];
    ahora: TimestampLocal;
}

const igualNullable = <T>(a: T | null | undefined, b: T | null | undefined): boolean => (a ?? null) === (b ?? null);

/**
 * snapshot_calcular_diff: FULL JOIN por (usuario, turno, fecha) entre los turnos nuevos del
 * snapshot expandidos a la ventana y los viejos de planificacion_diaria. El orden de los CASE es el del SQL.
 */
export const calcularDiff = ({ snapshotTurnos, turnosViejos, solicitudes, ahora }: EntradaCalcularDiff): FilaDiff[] => {
    const { desde, hasta } = ventana(ahora);
    const corte = sumarMinutos(ahora, 120);
    const usuarios = new Set(snapshotTurnos.map((s) => s.userContextId));
    const fechas = rangoFechas(desde, hasta);

    interface Nuevo { uid: number; turno: TurnoSnapshotNombre; fecha: FechaLocal; esperadoIn: TimestampLocal; esperadoOut: TimestampLocal; sede: number }
    const nuevos: Nuevo[] = [];
    for (const st of snapshotTurnos) {
        for (const fecha of fechas) {
            if (isoDow(fecha) !== st.diaSemana) continue;
            nuevos.push({
                uid: st.userContextId, turno: st.turno, fecha,
                esperadoIn: combinar(fecha, st.horaIn), esperadoOut: combinar(fecha, st.horaOut), sede: st.sedeId,
            });
        }
    }

    const viejos = turnosViejos
        .filter((v) =>
            usuarios.has(v.userContextId) && (v.turno === 'Mañana' || v.turno === 'Tarde') && !v.generica
            && fechaDe(v.esperadoIn) >= desde && fechaDe(v.esperadoIn) <= hasta)
        .map((v) => ({ v, fecha: fechaDe(v.esperadoIn) }));

    const clave = (uid: number, turno: string, fecha: FechaLocal) => `${uid}|${turno}|${fecha}`;
    const viejosPorClave = new Map<string, typeof viejos>();
    for (const x of viejos) {
        const k = clave(x.v.userContextId, x.v.turno, x.fecha);
        const lista = viejosPorClave.get(k);
        if (lista) lista.push(x);
        else viejosPorClave.set(k, [x]);
    }

    interface Par { uid: number; turno: TurnoSnapshotNombre; fecha: FechaLocal; v: TurnoDiario | null; n: Nuevo | null }
    const pares: Par[] = [];
    const usadas = new Set<TurnoDiario>();
    for (const n of nuevos) {
        const coinc = viejosPorClave.get(clave(n.uid, n.turno, n.fecha));
        if (coinc && coinc.length > 0) {
            for (const { v } of coinc) {
                usadas.add(v);
                pares.push({ uid: n.uid, turno: n.turno, fecha: n.fecha, v, n });
            }
        } else {
            pares.push({ uid: n.uid, turno: n.turno, fecha: n.fecha, v: null, n });
        }
    }
    for (const { v, fecha } of viejos) {
        if (!usadas.has(v)) pares.push({ uid: v.userContextId, turno: v.turno as TurnoSnapshotNombre, fecha, v, n: null });
    }

    const solicitudCubre = (uid: number, nIn: TimestampLocal, nOut: TimestampLocal): boolean =>
        solicitudes.some((sa) =>
            sa.usuarioId === uid && sa.cantidadMinutos == null
            && compararTs(sa.fechaInicio, nOut) < 0 && compararTs(sa.fechaFin, nIn) > 0);

    return pares.map(({ uid, turno, fecha, v, n }): FilaDiff => {
        const oldIn = v ? v.esperadoIn : null;
        const oldOut = v ? v.esperadoOut : null;
        const newIn = n ? n.esperadoIn : null;
        const newOut = n ? n.esperadoOut : null;
        const newSede = n ? n.sede : null;
        const oldLicencia = v ? v.licencia || v.minutosLicencia > 0 : false;
        const oldMarcado = v ? v.marcadoInAt != null || v.marcadoOutAt != null : false;
        const oldAntesDelCorte = v != null && compararTs(oldIn!, corte) < 0;
        const nuevoAntesDelCorte = n != null && compararTs(newIn!, corte) < 0;

        const sinCambio = v != null && n != null
            && compararTs(oldIn!, newIn!) === 0
            && (oldOut === null ? false : compararTs(oldOut, newOut!) === 0)
            && igualNullable(v.sedeIdIn, newSede)
            && igualNullable(v.sedeIdOut, newSede)
            && !v.horarioCorrido;

        let accion: AccionDiff;
        let motivo: MotivoDiff = null;
        if (sinCambio) {
            accion = 'sin_cambio';
        } else if (v != null && (oldAntesDelCorte || oldMarcado)) {
            accion = 'omitido';
            motivo = oldAntesDelCorte ? '2H' : 'MARCADO';
        } else if (v == null && nuevoAntesDelCorte) {
            accion = 'omitido';
            motivo = '2H';
        } else if (v != null && oldLicencia) {
            accion = 'omitido';
            motivo = 'LICENCIA';
        } else if (n != null && solicitudCubre(uid, newIn!, newOut!)) {
            accion = 'omitido';
            motivo = 'LICENCIA';
        } else if (v == null) {
            accion = 'alta';
        } else if (n == null) {
            accion = 'baja';
        } else {
            accion = 'modificacion';
        }

        return {
            userContextId: uid, turno, fecha, accion, motivo,
            oldId: v ? v.id : null, oldIn, oldOut,
            oldSedeIn: v ? v.sedeIdIn : null, oldSedeOut: v ? v.sedeIdOut : null,
            oldCorrido: v ? v.horarioCorrido : null,
            newIn, newOut, newSede,
        };
    });
};

/* ------------------------------------------------------------------ */
/* Faltantes                                                           */
/* ------------------------------------------------------------------ */

export interface EntradaFaltantesActual {
    snapshotTurnos: readonly SnapshotTurno[];
    /** planificacion_diaria de la semana lunes..sábado (se filtra de nuevo acá por usuario y fecha). */
    turnosSemana: readonly TurnoDiario[];
    diff: readonly FilaDiff[];
    usuarios: readonly UsuarioInfo[];
    /** usuarios_horas_objetivo */
    objetivosVigentes: readonly ObjetivoUsuario[];
    objetivosSnapshot: readonly ObjetivoSnapshot[];
    ahora: TimestampLocal;
}

/**
 * snapshot_faltantes_actual: semana en curso (o la siguiente si hoy es domingo). Suma las filas
 * existentes que el publish no reemplaza (cualquier turno, genéricas incluidas; esperadoOut null
 * suma 0) más las altas/modificaciones, contra el objetivo VIGENTE (si no hay, el de la planilla).
 */
export const faltantesSemanaActual = (e: EntradaFaltantesActual): Faltante[] => {
    const { lunes } = ventana(e.ahora);
    const sabado = sumarDias(lunes, 5);
    const uids = new Set(e.snapshotTurnos.map((s) => s.userContextId));
    const reemplazados = new Set(
        e.diff.filter((d) => d.accion === 'modificacion' || d.accion === 'baja').map((d) => d.oldId),
    );
    const minutos = new Map<number, number>();
    const sumar = (uid: number, m: number) => minutos.set(uid, (minutos.get(uid) ?? 0) + m);

    for (const pd of e.turnosSemana) {
        const f = fechaDe(pd.esperadoIn);
        if (!uids.has(pd.userContextId) || f < lunes || f > sabado || reemplazados.has(pd.id)) continue;
        sumar(pd.userContextId, pd.esperadoOut ? diffMinutos(pd.esperadoOut, pd.esperadoIn) : 0);
    }
    for (const d of e.diff) {
        if (d.accion === 'alta' || d.accion === 'modificacion') sumar(d.userContextId, diffMinutos(d.newOut!, d.newIn!));
    }

    const vigentes = new Map(e.objetivosVigentes.map((o) => [o.userContextId, o]));
    const delSnapshot = new Map(e.objetivosSnapshot.map((o) => [o.userContextId, o]));
    const info = mapaUsuarios(e.usuarios);

    const res: Array<{ u: UsuarioInfo; f: Faltante }> = [];
    for (const uid of uids) {
        const u = info.get(uid);
        if (!u) continue;
        const objetivo = vigentes.get(uid)?.minutosObjetivo ?? delSnapshot.get(uid)?.minutosObjetivo ?? null;
        if (objetivo === null) continue;
        const total = minutos.get(uid) ?? 0;
        if (total < objetivo) {
            res.push({ u, f: { user_context_id: uid, nombre: u.nombre, apellido: u.apellido, horas: minutosAHoras2(total), objetivo: minutosAHoras2(objetivo) } });
        }
    }
    return res.sort((a, b) => compararUsuarios(a.u, b.u)).map((x) => x.f);
};

export interface EntradaFaltantesProxima {
    snapshotTurnos: readonly SnapshotTurno[];
    usuarios: readonly UsuarioInfo[];
    objetivosVigentes: readonly ObjetivoUsuario[];
    objetivosSnapshot: readonly ObjetivoSnapshot[];
}

const minutosEntreHoras = (horaIn: string, horaOut: string): number => {
    const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    return aMin(horaOut) - aMin(horaIn);
};

/**
 * snapshot_faltantes_proxima: plantilla semanal completa contra el objetivo que regirá esa semana:
 * el de la planilla, si no el pendiente, si no el vigente.
 */
export const faltantesProximaSemana = (e: EntradaFaltantesProxima): Faltante[] => {
    const totales = new Map<number, number>();
    for (const st of e.snapshotTurnos) {
        totales.set(st.userContextId, (totales.get(st.userContextId) ?? 0) + minutosEntreHoras(st.horaIn, st.horaOut));
    }
    const vigentes = new Map(e.objetivosVigentes.map((o) => [o.userContextId, o]));
    const delSnapshot = new Map(e.objetivosSnapshot.map((o) => [o.userContextId, o]));
    const info = mapaUsuarios(e.usuarios);

    const res: Array<{ u: UsuarioInfo; f: Faltante }> = [];
    for (const [uid, total] of totales) {
        const u = info.get(uid);
        if (!u) continue;
        const vig = vigentes.get(uid);
        const objetivo = delSnapshot.get(uid)?.minutosObjetivo ?? vig?.minutosObjetivoPendiente ?? vig?.minutosObjetivo ?? null;
        if (objetivo === null) continue;
        if (total < objetivo) {
            res.push({ u, f: { user_context_id: uid, nombre: u.nombre, apellido: u.apellido, horas: minutosAHoras2(total), objetivo: minutosAHoras2(objetivo) } });
        }
    }
    return res.sort((a, b) => compararUsuarios(a.u, b.u)).map((x) => x.f);
};

/* ------------------------------------------------------------------ */
/* snapshot_armar_diff_json                                            */
/* ------------------------------------------------------------------ */

export interface DetalleDiff {
    userContextId: number;
    nombre: string;
    apellido: string;
    fecha: FechaLocal;
    turno: TurnoSnapshotNombre;
    accion: AccionDiff;
    motivo: MotivoDiff;
    antes: { in: string; out: string | null; sede: number | null; horarioCorrido: boolean } | null;
    despues: { in: string; out: string | null; sede: number | null } | null;
}

export interface RespuestaPreview {
    resumen: {
        altas: number; modificaciones: number; bajas: number; sinCambios: number;
        omitidos2h: number; omitidosLicencia: number;
    };
    detalle: DetalleDiff[];
    faltantes: { semanaActual: Faltante[]; proximaSemana: Faltante[] };
    usuariosSinTurnos: Array<{ userContextId: number; nombre: string; apellido: string }>;
}

export interface EntradaArmarPreview {
    diff: readonly FilaDiff[];
    faltantesActual: readonly Faltante[];
    faltantesProxima: readonly Faltante[];
    usuarios: readonly UsuarioInfo[];
    /** user_context_id con turnos en el snapshot nuevo. */
    usuariosSnapshotNuevo: ReadonlySet<number> | readonly number[];
    /** user_context_id con turnos en el snapshot ACTIVO (vigente). */
    usuariosSnapshotActivo: ReadonlySet<number> | readonly number[];
}

/** snapshot_armar_diff_json: el JSON que ve el usuario antes de confirmar. */
export const armarRespuestaPreview = (e: EntradaArmarPreview): RespuestaPreview => {
    const info = mapaUsuarios(e.usuarios);
    const cuenta = (f: (d: FilaDiff) => boolean) => e.diff.filter(f).length;

    const detalle = e.diff
        .filter((d) => d.accion !== 'sin_cambio' && info.has(d.userContextId))
        .map((d) => ({ d, u: info.get(d.userContextId)! }))
        .sort((a, b) =>
            compararUsuarios(a.u, b.u)
            || (a.d.fecha < b.d.fecha ? -1 : a.d.fecha > b.d.fecha ? 1 : 0)
            || (ORDEN_TURNO[a.d.turno]! - ORDEN_TURNO[b.d.turno]!))
        .map(({ d, u }): DetalleDiff => ({
            userContextId: d.userContextId,
            nombre: u.nombre,
            apellido: u.apellido,
            fecha: d.fecha,
            turno: d.turno,
            accion: d.accion,
            motivo: d.motivo,
            antes: d.oldId === null ? null : {
                in: horaMinuto(d.oldIn!),
                out: d.oldOut === null ? null : horaMinuto(d.oldOut),
                sede: d.oldSedeIn,
                horarioCorrido: d.oldCorrido === true,
            },
            despues: d.newIn === null ? null : {
                in: horaMinuto(d.newIn),
                out: d.newOut === null ? null : horaMinuto(d.newOut),
                sede: d.newSede,
            },
        }));

    const nuevo = comoSet(e.usuariosSnapshotNuevo);
    const usuariosSinTurnos = [...comoSet(e.usuariosSnapshotActivo)]
        .filter((uid) => !nuevo.has(uid) && info.has(uid))
        .sort((a, b) => a - b)
        .map((uid) => ({ userContextId: uid, nombre: info.get(uid)!.nombre, apellido: info.get(uid)!.apellido }));

    return {
        resumen: {
            altas: cuenta((d) => d.accion === 'alta'),
            modificaciones: cuenta((d) => d.accion === 'modificacion'),
            bajas: cuenta((d) => d.accion === 'baja'),
            sinCambios: cuenta((d) => d.accion === 'sin_cambio'),
            omitidos2h: cuenta((d) => d.accion === 'omitido' && (d.motivo === '2H' || d.motivo === 'MARCADO')),
            omitidosLicencia: cuenta((d) => d.accion === 'omitido' && d.motivo === 'LICENCIA'),
        },
        detalle,
        faltantes: { semanaActual: [...e.faltantesActual], proximaSemana: [...e.faltantesProxima] },
        usuariosSinTurnos,
    };
};

/* ------------------------------------------------------------------ */
/* planificacion_marcar_dias_vacios                                    */
/* ------------------------------------------------------------------ */

export interface TurnoSinteticoNuevo {
    userContextId: number;
    turno: TurnoSnapshotNombre;
    esperadoIn: TimestampLocal;
    esperadoOut: TimestampLocal;
    licencia: true;
    minutosLicencia: number;
    generica: true;
    feriado: boolean;
}

export interface EntradaDiasVacios {
    /** usuarios_horas_objetivo JOIN v_interno_users (el repo ya garantiza que existen). */
    usuarios: ReadonlyArray<{ userContextId: number; rolNombre: string; minutosObjetivo: number | null }>;
    desde: FechaLocal;
    hasta: FechaLocal;
    /**
     * planificacion_diaria de TODOS los usuarios con fecha en [desde, hasta] (cualquier turno,
     * genéricos incluidos). Sirve para: detectar días con turno real, heredar feriado
     * (cualquier usuario, cualquier turno) y descartar los sintéticos que ya existen.
     */
    turnosExistentes: ReadonlyArray<Pick<TurnoDiario, 'userContextId' | 'turno' | 'esperadoIn' | 'generica' | 'feriado'>>;
}

const HORARIOS_SINTETICOS: ReadonlyArray<{ turno: TurnoSnapshotNombre; general: [string, string]; limpieza: [string, string] }> = [
    { turno: 'Mañana', general: ['08:00', '12:00'], limpieza: ['07:00', '09:00'] },
    { turno: 'Tarde', general: ['16:00', '20:00'], limpieza: ['20:00', '22:00'] },
];

/**
 * planificacion_marcar_dias_vacios: dos turnos sintéticos con licencia por cada día lun-sáb sin
 * turno real (no genérico) de un usuario con objetivo. minutosLicencia = jornada / 2 (división
 * entera). Se descartan los que ya existen (lo que en SQL hace ON CONFLICT DO NOTHING; el repo
 * mantiene igualmente el ON CONFLICT por concurrencia), así el largo del resultado es el ROW_COUNT.
 */
export const turnosDiasVacios = (e: EntradaDiasVacios): TurnoSinteticoNuevo[] => {
    const diasConReal = new Set<string>();
    const sinteticosExistentes = new Set<string>();
    const feriadoPorDia = new Map<FechaLocal, boolean>();
    for (const t of e.turnosExistentes) {
        const f = fechaDe(t.esperadoIn);
        if (t.generica) sinteticosExistentes.add(`${t.userContextId}|${t.turno}|${f}`);
        else diasConReal.add(`${t.userContextId}|${f}`);
        if (t.feriado) feriadoPorDia.set(f, true);
    }

    const res: TurnoSinteticoNuevo[] = [];
    for (const u of e.usuarios) {
        const mitad = Math.floor(jornadaMinutos(u.minutosObjetivo) / 2);
        for (const fecha of rangoFechas(e.desde, e.hasta)) {
            if (isoDow(fecha) > 6 || diasConReal.has(`${u.userContextId}|${fecha}`)) continue;
            for (const h of HORARIOS_SINTETICOS) {
                if (sinteticosExistentes.has(`${u.userContextId}|${h.turno}|${fecha}`)) continue;
                const [hin, hout] = u.rolNombre === 'empleado-limpieza' ? h.limpieza : h.general;
                res.push({
                    userContextId: u.userContextId, turno: h.turno,
                    esperadoIn: combinar(fecha, hin), esperadoOut: combinar(fecha, hout),
                    licencia: true, minutosLicencia: mitad, generica: true,
                    feriado: feriadoPorDia.get(fecha) ?? false,
                });
            }
        }
    }
    return res;
};

/* ------------------------------------------------------------------ */
/* generar_semana_desde_snapshot (cálculo)                             */
/* ------------------------------------------------------------------ */

export interface TurnoSemanaNuevo {
    userContextId: number;
    turno: TurnoSnapshotNombre;
    esperadoIn: TimestampLocal;
    esperadoOut: TimestampLocal;
    sedeIdIn: number;
    sedeIdOut: number;
}

/** Días (usuario + fecha) que la plantilla cubre: el repo borra los turnos genéricos de esos días antes de insertar. */
export const diasCubiertosPorPlantilla = (
    snapshotTurnos: readonly SnapshotTurno[],
    lunes: FechaLocal,
): Array<{ userContextId: number; fecha: FechaLocal }> => {
    const vistos = new Set<string>();
    const res: Array<{ userContextId: number; fecha: FechaLocal }> = [];
    for (const st of snapshotTurnos) {
        const fecha = sumarDias(lunes, st.diaSemana - 1);
        const k = `${st.userContextId}|${fecha}`;
        if (!vistos.has(k)) { vistos.add(k); res.push({ userContextId: st.userContextId, fecha }); }
    }
    return res;
};

/**
 * Turnos a insertar al generar la semana que empieza en `lunes`: uno por turno del snapshot de
 * usuarios existentes (v_interno_users), salteando los días que ya están en horario corrido
 * (un único turno sin salida, los demás se borraron a propósito). El repo inserta con
 * ON CONFLICT DO NOTHING (idempotencia) y aplica las licencias solo a las filas realmente insertadas.
 */
export const turnosSemana = (
    snapshotTurnos: readonly SnapshotTurno[],
    lunes: FechaLocal,
    diasConCorrido: ReadonlyArray<{ userContextId: number; fecha: FechaLocal }>,
    usuariosExistentes: ReadonlySet<number> | readonly number[],
): TurnoSemanaNuevo[] => {
    const existentes = comoSet(usuariosExistentes);
    const corridos = new Set(diasConCorrido.map((d) => `${d.userContextId}|${d.fecha}`));
    const res: TurnoSemanaNuevo[] = [];
    for (const st of snapshotTurnos) {
        if (!existentes.has(st.userContextId)) continue;
        const fecha = sumarDias(lunes, st.diaSemana - 1);
        if (corridos.has(`${st.userContextId}|${fecha}`)) continue;
        res.push({
            userContextId: st.userContextId, turno: st.turno,
            esperadoIn: combinar(fecha, st.horaIn), esperadoOut: combinar(fecha, st.horaOut),
            sedeIdIn: st.sedeId, sedeIdOut: st.sedeId,
        });
    }
    return res;
};
