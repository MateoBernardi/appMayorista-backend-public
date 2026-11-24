import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../../adapters/db/pgClient';
import * as repo from '../../adapters/db/planificacionRepo';
import { leerPlanilla } from '../../adapters/inputs_outputs/lectorPlanillaGoogle';
import { BadRequestError, ConflictError, PreconditionFailedError, UnprocessableEntityError } from '../../adapters/errors/AppError';
import { parsePlanilla } from './planillaParser';
import { aplicarLicenciasATurnos } from './licenciasTurnosServices';
import { sendMailService } from './mailService';
import { fechaDe, isoDow, sumarDias } from './fechaLocal';
import type { FechaLocal } from './fechaLocal';
import {
  armarRespuestaPreview,
  calcularDiff,
  diasCubiertosPorPlantilla,
  faltantesProximaSemana,
  faltantesSemanaActual,
  minutosObjetivoDesdeHoras,
  turnosDiasVacios,
  turnosSemana,
  validarPayload,
  ventana,
} from './planificacionReglas';
import type { Faltante, FilaDiff, ObjetivoSnapshot, RespuestaPreview, SnapshotTurno } from './planificacionReglas';
import type { PayloadPlanilla } from './planillaParser';

/**
 * Planificación por snapshot (ADR-008 / ADR-010). Las reglas viven en planificacionReglas.ts (puras);
 * acá se orquesta: leer la planilla, abrir la transacción, cargar insumos desde el repo, aplicar
 * las reglas y escribir en el mismo orden que las antiguas funciones SQL (snapshot_previsualizar,
 * snapshot_aplicar, generar_semana_desde_snapshot).
 */

export type PlanificacionPreview = {
  ok: true;
  snapshotId: number;
  expiraAt: string;
  igualAlVigente: boolean;
} & RespuestaPreview;

export interface PlanificacionAplicada {
  ok: true;
  snapshotId: number;
  altas: number;
  modificaciones: number;
  bajas: number;
  omitidos: number;
  usuariosAfectados: number[];
}

export type ResultadoGeneracionSemana =
  | { ok: false; motivo: 'SIN_SNAPSHOT'; lunes: FechaLocal }
  | { ok: true; lunes: FechaLocal; snapshotId: number; generados: number; objetivosPromovidos: number; faltantes: Faltante[] };

/** Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT, ROLLBACK ante cualquier error). */
const enTransaccion = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** sha256 del contenido (turnos y objetivos ordenados): sirve para detectar "igual al vigente". */
const hashSnapshot = (turnos: SnapshotTurno[], objetivos: ObjetivoSnapshot[]): string => {
  const t = [...turnos]
    .sort((a, b) => a.userContextId - b.userContextId || a.diaSemana - b.diaSemana || a.turno.localeCompare(b.turno))
    .map((x) => [x.userContextId, x.diaSemana, x.turno, x.horaIn, x.horaOut, x.sedeId]);
  const o = [...objetivos]
    .sort((a, b) => a.userContextId - b.userContextId)
    .map((x) => [x.userContextId, x.minutosObjetivo]);
  return crypto.createHash('sha256').update(JSON.stringify({ turnos: t, objetivos: o })).digest('hex');
};

const unicos = (ids: Array<number | null | undefined>): number[] =>
  [...new Set(ids.filter((x): x is number => typeof x === 'number'))];

const aSnapshotTurnos = (payload: PayloadPlanilla): SnapshotTurno[] =>
  payload.turnos.map((t) => ({
    userContextId: t.user_context_id,
    diaSemana: t.dia_semana,
    turno: t.turno,
    horaIn: t.hora_in,
    horaOut: t.hora_out,
    sedeId: t.sede_id,
  }));

// Lee la planilla, la valida y la guarda como snapshot en PREVIEW con su diff.
// No modifica planificacion_diaria.
export const previsualizarPlanificacionService = async (userContextId: number): Promise<PlanificacionPreview> => {
  const filas = await leerPlanilla();
  const { payload, errores } = parsePlanilla(filas as any);
  if (errores.length > 0) {
    throw new UnprocessableEntityError('La planilla tiene errores. Corregilos y volvé a intentar.', { errores });
  }

  return enTransaccion(async (client) => {
    const ahora = await repo.ahoraAr(client);

    const idsPayload = unicos([
      ...payload.turnos.map((t) => t.user_context_id),
      ...(payload.objetivos ?? []).map((o) => o.user_context_id),
    ]);
    const existentes = await repo.getUsuarios(client, idsPayload);
    const erroresValidacion = validarPayload(payload, {
      usuariosExistentes: new Set(existentes.map((u) => u.userContextId)),
      sedesActivas: new Set(await repo.getSedesActivas(client)),
      turnosSnapshotActivo: await repo.contarTurnosSnapshotActivo(client),
    });
    if (erroresValidacion.length > 0) {
      throw new UnprocessableEntityError('La planilla tiene errores. Corregilos y volvé a intentar.', { errores: erroresValidacion });
    }

    const snapshotTurnos = aSnapshotTurnos(payload);
    const objetivosSnapshot: ObjetivoSnapshot[] = (payload.objetivos ?? []).map((o) => ({
      userContextId: o.user_context_id,
      minutosObjetivo: minutosObjetivoDesdeHoras(o.horas),
    }));
    const hash = hashSnapshot(snapshotTurnos, objetivosSnapshot);

    await repo.expirarPreviews(client, userContextId);
    const { id, expiraAt } = await repo.insertarSnapshotPreview(client, userContextId, hash);
    await repo.insertarSnapshotTurnos(client, id, snapshotTurnos);
    await repo.insertarSnapshotObjetivos(client, id, objetivosSnapshot);

    // Insumos del diff (la ventana arranca en hoy y llega al sábado; la semana en curso, desde el lunes)
    const { lunes, hasta } = ventana(ahora);
    const uidsSnapshot = unicos(snapshotTurnos.map((t) => t.userContextId));
    const uidsActivos = await repo.getUsuariosSnapshotActivo(client);
    const turnosViejos = await repo.getTurnosDiarios(client, uidsSnapshot, lunes, hasta);
    const solicitudes = await repo.getSolicitudesAprobadas(client, uidsSnapshot, lunes, hasta);
    const usuarios = await repo.getUsuarios(client, unicos([...uidsSnapshot, ...uidsActivos]));
    const objetivosVigentes = await repo.getObjetivosUsuarios(client, uidsSnapshot);

    const diff = calcularDiff({ snapshotTurnos, turnosViejos, solicitudes, ahora });
    const respuesta = armarRespuestaPreview({
      diff,
      faltantesActual: faltantesSemanaActual({
        snapshotTurnos, turnosSemana: turnosViejos, diff, usuarios, objetivosVigentes, objetivosSnapshot, ahora,
      }),
      faltantesProxima: faltantesProximaSemana({ snapshotTurnos, usuarios, objetivosVigentes, objetivosSnapshot }),
      usuarios,
      usuariosSnapshotNuevo: new Set(uidsSnapshot),
      usuariosSnapshotActivo: new Set(uidsActivos),
    });
    await repo.guardarDiff(client, id, respuesta);

    const igualAlVigente = await repo.existeActivoConHash(client, hash);
    return { ok: true, snapshotId: id, expiraAt, igualAlVigente, ...respuesta };
  });
};

/** Inserta los turnos sintéticos de los días sin turnos reales de la ventana (planificacion_marcar_dias_vacios). */
const marcarDiasVacios = async (client: PoolClient, desde: FechaLocal, hasta: FechaLocal): Promise<number> => {
  const usuarios = await repo.getUsuariosConObjetivo(client);
  const turnosExistentes = await repo.getTurnosExistentesDelRango(client, desde, hasta);
  return repo.insertarSinteticos(client, turnosDiasVacios({ usuarios, desde, hasta, turnosExistentes }));
};

const cuenta = (diff: FilaDiff[], accion: FilaDiff['accion']): number => diff.filter((d) => d.accion === accion).length;

// Aplica de forma atómica el preview confirmado, reevaluando la regla de 2 h al momento de confirmar.
// Las notificaciones a los usuarios afectados se encolan acá; las despacha el worker de la cola.
export const confirmarPlanificacionService = async (
  snapshotId: number,
  userContextId: number,
): Promise<PlanificacionAplicada> => {
  return enTransaccion(async (client) => {
    await repo.lockPlanificacion(client); // serializa publicar y generación semanal

    const snap = await repo.getSnapshotParaActualizar(client, snapshotId);
    if (!snap || snap.estado !== 'PREVIEW') {
      throw new ConflictError('El preview no existe o ya fue confirmado.');
    }
    if (snap.creadoPor !== userContextId) {
      throw new ConflictError('El preview pertenece a otro usuario.');
    }
    if (snap.vencido) {
      // En la función SQL el RAISE deshacía este UPDATE: el rollback de enTransaccion hace lo mismo.
      await repo.marcarExpirado(client, snapshotId);
      throw new PreconditionFailedError('El preview venció, generá uno nuevo.');
    }

    const ahora = await repo.ahoraAr(client);
    const { lunes, desde, hasta } = ventana(ahora);
    const snapshotTurnos = await repo.getTurnosSnapshot(client, snapshotId);
    const uids = unicos(snapshotTurnos.map((t) => t.userContextId));
    const turnosViejos = await repo.getTurnosDiarios(client, uids, lunes, hasta);
    const solicitudes = await repo.getSolicitudesAprobadas(client, uids, lunes, hasta);
    const diff = calcularDiff({ snapshotTurnos, turnosViejos, solicitudes, ahora });

    const bajas = diff.filter((d) => d.accion === 'baja');
    const modificaciones = diff.filter((d) => d.accion === 'modificacion');
    const altas = diff.filter((d) => d.accion === 'alta');

    await repo.eliminarBajasSinMarcado(client, bajas.map((d) => d.oldId as number));
    const idsModificados = await repo.actualizarModificaciones(client, modificaciones);
    await repo.eliminarGenericasDeDias(client, altas.map((d) => ({ userContextId: d.userContextId, fecha: d.fecha })));
    const idsAltas = await repo.insertarAltas(client, altas);

    // Turnos nuevos o modificados (sin licencia aplicada, si no se habrían omitido): se les
    // aplican las licencias que los solapan.
    await aplicarLicenciasATurnos(client, [...idsModificados, ...idsAltas]);

    // Los días que quedaron sin turnos se marcan como licencia (y descuentan del objetivo).
    await marcarDiasVacios(client, desde, hasta);

    await repo.upsertObjetivosDesdeSnapshot(client, snapshotId);
    await repo.marcarActivoReemplazado(client);
    await repo.activarSnapshot(client, snapshotId);

    const usuariosAfectados = unicos(
      diff
        .filter((d) => (d.accion === 'alta' || d.accion === 'modificacion' || d.accion === 'baja') && d.userContextId !== userContextId)
        .map((d) => d.userContextId),
    ).sort((a, b) => a - b);
    await repo.encolarNotificaciones(client, snapshotId, usuariosAfectados);

    return {
      ok: true,
      snapshotId,
      altas: cuenta(diff, 'alta'),
      modificaciones: cuenta(diff, 'modificacion'),
      bajas: cuenta(diff, 'baja'),
      omitidos: cuenta(diff, 'omitido'),
      usuariosAfectados,
    };
  });
};

// Genera la semana que empieza en `lunes` (por defecto, el próximo lunes) desde el snapshot ACTIVO.
// Idempotente: los turnos ya existentes se respetan (ON CONFLICT DO NOTHING).
export const generarSemanaService = async (lunes?: FechaLocal): Promise<ResultadoGeneracionSemana> => {
  return enTransaccion(async (client) => {
    await repo.lockPlanificacion(client);

    const hoy = fechaDe(await repo.ahoraAr(client));
    const lunesObjetivo = lunes ?? sumarDias(hoy, 8 - isoDow(hoy));
    if (isoDow(lunesObjetivo) !== 1) {
      throw new BadRequestError(`La fecha ${lunesObjetivo} no es un lunes.`);
    }

    const snapshotId = await repo.getSnapshotActivoId(client);
    if (snapshotId === null) {
      return { ok: false, motivo: 'SIN_SNAPSHOT', lunes: lunesObjetivo } as const;
    }

    const snapshotTurnos = await repo.getTurnosSnapshot(client, snapshotId);
    const uids = unicos(snapshotTurnos.map((t) => t.userContextId));
    const usuarios = await repo.getUsuarios(client, uids);

    // Faltantes antes de promover: faltantesProximaSemana ya usa el objetivo de la planilla.
    const faltantes = faltantesProximaSemana({
      snapshotTurnos,
      usuarios,
      objetivosVigentes: await repo.getObjetivosUsuarios(client, uids),
      objetivosSnapshot: await repo.getObjetivosSnapshot(client, snapshotId),
    });

    // Si la semana se regenera, los turnos sintéticos de un día que la plantilla cubre se reemplazan.
    await repo.eliminarGenericasDeDias(client, diasCubiertosPorPlantilla(snapshotTurnos, lunesObjetivo));

    const sabado = sumarDias(lunesObjetivo, 5);
    const diasConCorrido = await repo.getDiasConCorrido(client, uids, lunesObjetivo, sabado);
    const idsInsertados = await repo.insertarTurnosSemana(
      client,
      turnosSemana(snapshotTurnos, lunesObjetivo, diasConCorrido, new Set(usuarios.map((u) => u.userContextId))),
    );

    // Licencias solo sobre los turnos recién insertados: regenerar la semana no vuelve a aplicarlas.
    await aplicarLicenciasATurnos(client, idsInsertados);

    // Días sin turnos de usuarios con objetivo: licencia, para que descuenten del objetivo.
    await marcarDiasVacios(client, lunesObjetivo, sabado);

    const objetivosPromovidos = await repo.promoverObjetivosPendientes(client);

    return {
      ok: true,
      lunes: lunesObjetivo,
      snapshotId,
      generados: idsInsertados.length,
      objetivosPromovidos,
      faltantes,
    } as const;
  });
};

// Corrida automática: no se notifica a los empleados, solo se avisa al administrador cuando
// la generación falló o hay usuarios por debajo de su objetivo.
export const notificarResultadoSemanal = async (resultado: ResultadoGeneracionSemana): Promise<void> => {
  if (resultado.ok && resultado.faltantes.length === 0) return;

  const destino = process.env.ALERTAS_EMAIL_TO?.trim();
  if (!destino) {
    console.warn('[planificacion] Falta ALERTAS_EMAIL_TO: no se envía el aviso de la generación semanal.');
    return;
  }

  const texto = resultado.ok
    ? `Semana del ${resultado.lunes} generada (${resultado.generados} turnos). Usuarios por debajo de su objetivo semanal:\n` +
      resultado.faltantes.map((f) => `- ${f.apellido} ${f.nombre}: ${f.horas} hs de ${f.objetivo} hs`).join('\n')
    : `No se generó la semana del ${resultado.lunes}: ${resultado.motivo || 'error desconocido'}.`;

  await sendMailService({ to: destino, subject: 'Planificación semanal: revisar', text: texto });
};

export interface PlanificacionInfo {
  planillaUrl: string | null;
  ultimaPublicacion: {
    snapshotId: number;
    aplicadoAt: string | null;
    publicadoPor: { nombre: string; apellido: string } | null;
  } | null;
}

// Datos para la pantalla de publicación: link a la planilla (configurado por entorno) y la
// última publicación confirmada.
export const getInfoPlanificacionService = async (): Promise<PlanificacionInfo> => {
  const ultima = await repo.getUltimaPublicacionPlanificacion();
  return {
    planillaUrl: process.env.PLANIFICACION_PLANILLA_URL?.trim() || null,
    ultimaPublicacion: ultima
      ? {
          snapshotId: ultima.snapshotId,
          aplicadoAt: ultima.aplicadoAt ? new Date(ultima.aplicadoAt).toISOString() : null,
          publicadoPor: ultima.nombre ? { nombre: ultima.nombre, apellido: ultima.apellido ?? '' } : null,
        }
      : null,
  };
};
