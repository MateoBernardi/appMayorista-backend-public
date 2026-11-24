// new Date("YYYY-MM-DD") lo interpreta el motor JS como medianoche UTC. El resto del
// código de horarios lee después año/mes/día con getters locales (getFullYear/getMonth/
// getDate), así que en un servidor con huso horario negativo (ej. Argentina, UTC-3) esa
// fecha "vuelve" al día anterior. Esta función arma la fecha directamente en horario
// local para evitar ese corrimiento de un día.
export const parseFechaLocalISO = (fechaRaw: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaRaw.trim());
  if (!match) return null;

  const [, y, m, d] = match;
  const fecha = new Date(Number(y), Number(m) - 1, Number(d));

  if (
    fecha.getFullYear() !== Number(y) ||
    fecha.getMonth() !== Number(m) - 1 ||
    fecha.getDate() !== Number(d)
  ) {
    return null;
  }

  return fecha;
};

// Los getters locales de Date (getHours/getDate/...) leen el timezone del proceso
// Node, no el de Argentina. El server corre en horario americano, así que usamos
// Intl.DateTimeFormat con timeZone fijo para no depender de dónde esté deployado.
const FECHA_HORA_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const formatFechaHora = (fecha: Date): string => {
  const partes = Object.fromEntries(
    FECHA_HORA_FORMATTER.formatToParts(fecha).map(({ type, value }) => [type, value])
  );
  return `${partes.day}/${partes.month}/${partes.year} - ${partes.hour}:${partes.minute}:${partes.second}`;
};

// Las columnas TIMESTAMP (sin tz) llegan como string "YYYY-MM-DD HH:MM:SS" (ver
// setTypeParser en pgClient) y guardan hora argentina. new Date(str) las leería en el
// timezone del proceso Node, así que fijamos el offset (Argentina no tiene horario de verano).
export const parseTimestampAR = (raw: string | Date): Date =>
  raw instanceof Date ? raw : new Date(`${raw.trim().replace(' ', 'T')}-03:00`);
