/**
 * Parser de la planilla de horarios (Google Sheet) → payload del snapshot de planificación.
 * Port a TS del parser que corría dentro de n8n (ADR-010), sin cambios de lógica.
 *
 * Layout de la planilla: fila 1 = encabezados `ID | Empleado | lunes … sabado | Objetivo semanal (hs)`.
 * `ID` = `user_context_id` (columna protegida). Sedes aceptadas: `Adm`, `Insumos`, `Super`,
 * `Dep. Super` (la sede de salida es igual a la de entrada). Usuarios sin horarios cargados
 * (rotativos) se ignoran; su objetivo sí se toma. Detalle de columnas abajo.
 *
 * Layout esperado (fila 1 = encabezados; cada día ocupa 6 columnas: entrada/salida/sede del
 * turno 1 y entrada/salida/sede del turno 2; en Google Sheets la celda combinada del día
 * llega con el nombre solo en su primera columna):
 *   ID | Empleado | lunes ×6 | martes ×6 | … | sábado ×6 | Objetivo semanal (hs)
 * Cada fila siguiente es un usuario (ID = user_context_id). Las filas sin ID se ignoran
 * (separadores). Un usuario sin horarios cargados no genera turnos (rotativo) pero su
 * objetivo, si lo tiene, igual se informa.
 *
 * Leer el rango con valueRenderOption=UNFORMATTED_VALUE: las horas llegan como fracción de
 * día; también se aceptan textos "7:00", "07:00" o "07:00:00".
 */

export type CeldaPlanilla = string | number | null | undefined;

export interface TurnoPayload {
    user_context_id: number;
    dia_semana: number;
    turno: 'Mañana' | 'Tarde';
    hora_in: string;
    hora_out: string;
    sede_id: number;
}

export interface ObjetivoPayload {
    user_context_id: number;
    horas: number;
}

export interface PayloadPlanilla {
    turnos: TurnoPayload[];
    objetivos: ObjetivoPayload[];
}

export interface ResultadoParsePlanilla {
    payload: PayloadPlanilla;
    errores: string[];
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const SEDES: Record<string, number> = {
    adm: 2,
    administracion: 2,
    insumos: 4,
    super: 1,
    'dep super': 5,
    'deposito super': 5,
};

const normalizar = (valor: unknown): string =>
    String(valor ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const vacio = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';

// → "HH:MM" | null (vacío) | undefined (inválido)
export const parseHora = (valor: CeldaPlanilla): string | null | undefined => {
    if (vacio(valor)) return null;
    let minutos: number;
    if (typeof valor === 'number') {
        if (valor < 0 || valor >= 1) return undefined;
        minutos = Math.round(valor * 1440);
    } else {
        const m = String(valor).trim().match(/^(\d{1,2}):([0-5]\d)(:[0-5]\d)?$/);
        if (!m) return undefined;
        minutos = Number(m[1]!) * 60 + Number(m[2]!);
    }
    if (minutos >= 1440) return undefined;
    const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
    const mm = String(minutos % 60).padStart(2, '0');
    return `${hh}:${mm}`;
};

// "52,5 hs semanales" | 52.5 | "48" → 52.5 | null (vacío) | undefined (inválido)
export const parseObjetivo = (valor: CeldaPlanilla): number | null | undefined => {
    if (vacio(valor)) return null;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : undefined;
    const m = String(valor).trim().match(/^(\d+(?:[.,]\d+)?)/);
    return m ? Number(m[1]!.replace(',', '.')) : undefined;
};

const nombreColumna = (indice: number): string => {
    let n = indice + 1;
    let nombre = '';
    while (n > 0) {
        const resto = (n - 1) % 26;
        nombre = String.fromCharCode(65 + resto) + nombre;
        n = Math.floor((n - 1) / 26);
    }
    return nombre;
};

/** @param filas valores de la hoja (fila 1 = encabezados) */
export const parsePlanilla = (filas: CeldaPlanilla[][]): ResultadoParsePlanilla => {
    const errores: string[] = [];
    const turnos: TurnoPayload[] = [];
    const objetivos: ObjetivoPayload[] = [];

    if (!Array.isArray(filas) || filas.length < 2) {
        return { payload: { turnos, objetivos }, errores: ['La planilla está vacía.'] };
    }

    const encabezado = filas[0]!.map(normalizar);
    const colId = encabezado.indexOf('id');
    const colObjetivo = encabezado.findIndex((h) => h.startsWith('objetivo'));
    const colDia = DIAS.map((dia) => encabezado.indexOf(dia));

    if (colId === -1) errores.push('Falta la columna "ID" en el encabezado.');
    if (colObjetivo === -1) errores.push('Falta la columna "Objetivo semanal (hs)" en el encabezado.');
    colDia.forEach((col, i) => {
        if (col === -1) errores.push(`Falta la columna del día "${DIAS[i]}" en el encabezado.`);
    });
    if (errores.length > 0) return { payload: { turnos, objetivos }, errores };

    const vistos = new Set<number>();

    for (let f = 1; f < filas.length; f += 1) {
        const fila = filas[f]!;
        const idCrudo = fila[colId];
        if (vacio(idCrudo)) continue;

        const userContextId = Number(idCrudo);
        const filaNro = f + 1;
        if (!Number.isInteger(userContextId) || userContextId <= 0) {
            errores.push(`Fila ${filaNro}: ID inválido "${idCrudo}".`);
            continue;
        }
        if (vistos.has(userContextId)) {
            errores.push(`Fila ${filaNro}: el usuario ${userContextId} está repetido en la planilla.`);
            continue;
        }
        vistos.add(userContextId);

        colDia.forEach((inicio, diaIdx) => {
            (['Mañana', 'Tarde'] as const).forEach((turno, slot) => {
                const base = inicio + slot * 3;
                const crudos = [fila[base], fila[base + 1], fila[base + 2]];
                if (crudos.every(vacio)) return;

                const donde = `Fila ${filaNro}, ${DIAS[diaIdx]} (${turno}, columna ${nombreColumna(base)})`;
                const horaIn = parseHora(crudos[0]);
                const horaOut = parseHora(crudos[1]);
                if (horaIn === undefined || horaOut === undefined) {
                    errores.push(`${donde}: horario inválido "${crudos[0]}" - "${crudos[1]}".`);
                    return;
                }
                if (horaIn === null || horaOut === null) {
                    errores.push(`${donde}: falta la entrada o la salida.`);
                    return;
                }
                const sedeId = SEDES[normalizar(crudos[2])];
                if (!sedeId) {
                    errores.push(`${donde}: sede desconocida "${crudos[2] ?? ''}".`);
                    return;
                }
                turnos.push({
                    user_context_id: userContextId,
                    dia_semana: diaIdx + 1,
                    turno,
                    hora_in: horaIn,
                    hora_out: horaOut,
                    sede_id: sedeId,
                });
            });
        });

        const horas = parseObjetivo(fila[colObjetivo]);
        if (horas === undefined) {
            errores.push(`Fila ${filaNro}: objetivo inválido "${fila[colObjetivo]}".`);
        } else if (horas !== null) {
            objetivos.push({ user_context_id: userContextId, horas });
        }
    }

    return { payload: { turnos, objetivos }, errores };
};
