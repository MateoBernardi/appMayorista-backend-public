// Las duraciones (saldos de francos, objetivos, minutos trabajados, licencias por horas) se
// guardan en minutos enteros, que son exactos. Las horas con 2 decimales son solo presentación.

/** Minutos → horas redondeadas a 2 decimales (45 → 0.75, 10 → 0.17). */
export const minutosAHoras = (minutos: number): number => Math.round((minutos / 60) * 100) / 100;

/** Horas (posiblemente fraccionarias) → minutos enteros. */
export const horasAMinutos = (horas: number): number => Math.round(horas * 60);

/** Minutos → texto: 750 → "12 hs, 30 minutos", 45 → "45 minutos", 480 → "8 hs", -90 → "-1 hs, 30 minutos". */
export const formatMinutos = (minutos: number): string => {
    const signo = minutos < 0 ? '-' : '';
    const abs = Math.abs(Math.round(minutos));
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    const textoMinutos = `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
    if (h === 0) return `${signo}${textoMinutos}`;
    if (m === 0) return `${signo}${h} hs`;
    return `${signo}${h} hs, ${textoMinutos}`;
};
