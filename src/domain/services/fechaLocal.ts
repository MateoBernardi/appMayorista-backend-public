/**
 * Helpers puros para timestamps locales "naive" (hora de pared de Argentina, sin zona).
 *
 * pgClient.ts hace que `timestamp` y `date` lleguen como string ('YYYY-MM-DD HH:MM:SS' / 'YYYY-MM-DD').
 * Acá se opera sobre esos strings con aritmética UTC interna (Date.UTC / getUTC*) solo como calendario:
 * nunca se usa el reloj ni la zona horaria del server, así que no hay corrimientos por DST ni TZ.
 */

/** 'YYYY-MM-DD HH:MM:SS' (al parsear también se acepta 'T' y fracciones de segundo). */
export type TimestampLocal = string;
/** 'YYYY-MM-DD' */
export type FechaLocal = string;

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 86_400_000;

const pad = (n: number, largo = 2): string => String(n).padStart(largo, '0');

const RE_TS = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** Parsea fecha o timestamp a milisegundos "UTC" (calendario naive). Las fracciones se descartan. */
const aMs = (valor: string): number => {
    const m = RE_TS.exec(valor.trim());
    if (!m) throw new Error(`Timestamp/fecha local inválido: ${valor}`);
    const [anio, mes, dia, h, mi, s] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
    const ms = Date.UTC(anio, mes - 1, dia, h, mi, s);
    const d = new Date(ms);
    // Rechaza fechas inexistentes (2025-02-30) que Date.UTC normalizaría en silencio
    if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia || h > 23 || mi > 59 || s > 59) {
        throw new Error(`Timestamp/fecha local inválido: ${valor}`);
    }
    return ms;
};

const desdeMs = (ms: number): TimestampLocal => {
    const d = new Date(ms);
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/** Minutos desde epoch (naive). Puede tener decimales si el timestamp trae segundos. */
export const aMinutos = (ts: TimestampLocal | FechaLocal): number => aMs(ts) / MS_POR_MINUTO;

/** Inversa de aMinutos → 'YYYY-MM-DD HH:MM:SS' (redondea al segundo). */
export const desdeMinutos = (minutos: number): TimestampLocal => desdeMs(Math.round(minutos * 60) * 1000);

export const sumarMinutos = (ts: TimestampLocal, minutos: number): TimestampLocal =>
    desdeMs(aMs(ts) + Math.round(minutos * 60) * 1000);

/**
 * ROUND(numeric) de Postgres: redondea half away from zero (-2.5 → -3).
 * Math.round redondea half hacia +infinito (-2.5 → -2), por eso difiere en .5 negativos.
 */
export const redondearPg = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/**
 * a - b en minutos, exacto (con decimales si hay segundos). El llamador redondea con
 * redondearPg para replicar ROUND(EXTRACT(EPOCH FROM (a - b)) / 60).
 */
export const diffMinutos = (a: TimestampLocal, b: TimestampLocal): number => (aMs(a) - aMs(b)) / MS_POR_MINUTO;

/** DATE(ts) */
export const fechaDe = (ts: TimestampLocal | FechaLocal): FechaLocal => desdeMs(aMs(ts)).slice(0, 10);

export const sumarDias = (fecha: FechaLocal | TimestampLocal, n: number): FechaLocal =>
    desdeMs(aMs(fecha) + n * MS_POR_DIA).slice(0, 10);

/** EXTRACT(ISODOW): 1 = lunes ... 7 = domingo. */
export const isoDow = (valor: FechaLocal | TimestampLocal): number => {
    const dow = new Date(aMs(valor)).getUTCDay(); // 0 = domingo
    return dow === 0 ? 7 : dow;
};

/** fecha + hora (equivale a `date + time` en PG). hora: 'HH:MM' o 'HH:MM:SS'. */
export const combinar = (fecha: FechaLocal, hora: string): TimestampLocal => {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(hora.trim());
    if (!m) throw new Error(`Hora inválida: ${hora}`);
    const base = aMs(fecha); // valida la fecha
    return desdeMs(base + (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) * 1000);
};

/** to_char(ts, 'HH24:MI') */
export const horaMinuto = (ts: TimestampLocal): string => desdeMs(aMs(ts)).slice(11, 16);

/** Comparador (negativo si a < b, 0 si iguales, positivo si a > b). */
export const compararTs = (a: TimestampLocal, b: TimestampLocal): number => aMs(a) - aMs(b);

export const minTs = (a: TimestampLocal, b: TimestampLocal): TimestampLocal => (compararTs(a, b) <= 0 ? a : b);
export const maxTs = (a: TimestampLocal, b: TimestampLocal): TimestampLocal => (compararTs(a, b) >= 0 ? a : b);

/** Fechas de `desde` a `hasta`, ambas inclusive. Vacío si desde > hasta. */
export const rangoFechas = (desde: FechaLocal, hasta: FechaLocal): FechaLocal[] => {
    const fin = aMs(hasta);
    const res: FechaLocal[] = [];
    for (let ms = aMs(desde); ms <= fin; ms += MS_POR_DIA) res.push(desdeMs(ms).slice(0, 10));
    return res;
};
