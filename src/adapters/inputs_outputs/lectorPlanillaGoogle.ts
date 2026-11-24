import { JWT } from 'google-auth-library';
import { AppError } from '../errors/AppError';

/**
 * Lectura de la planilla de horarios (Google Sheets) con una cuenta de servicio.
 *
 * SOLO LECTURA: scope `spreadsheets.readonly` y un único GET a `.../values/{rango}`.
 * Este módulo NUNCA debe escribir, formatear ni modificar la planilla (ni agregar otros scopes).
 */

const SCOPE_SOLO_LECTURA = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TIMEOUT_POR_DEFECTO_MS = 20_000;

const servicioNoDisponible = (mensaje: string) => new AppError(mensaje, 503, 'SERVICE_UNAVAILABLE');

export const leerPlanilla = async (): Promise<unknown[][]> => {
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const clave = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const sheetId = process.env.PLANIFICACION_SHEET_ID;
  const rango = process.env.PLANIFICACION_SHEET_RANGE;
  if (!email || !clave || !sheetId || !rango) {
    console.error('[planificacion] Falta configurar GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY / PLANIFICACION_SHEET_ID / PLANIFICACION_SHEET_RANGE.');
    throw servicioNoDisponible('El servicio de planificación no está configurado.');
  }

  const timeout = Number(process.env.PLANIFICACION_SHEETS_TIMEOUT_MS) || TIMEOUT_POR_DEFECTO_MS;
  const client = new JWT({
    email,
    key: clave.replace(/\\n/g, '\n'),
    scopes: [SCOPE_SOLO_LECTURA],
  });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(rango)}?valueRenderOption=UNFORMATTED_VALUE`;

  try {
    const respuesta = await client.request<{ values?: unknown[][] }>({ url, method: 'GET', timeout });
    return respuesta.data?.values ?? [];
  } catch (error) {
    // Se loguea el mensaje y nunca la clave ni el objeto de error completo (puede incluir credenciales).
    console.error('[planificacion] No se pudo leer la planilla de Google:', error instanceof Error ? error.message : 'error desconocido');
    throw servicioNoDisponible('No se pudo leer la planilla de horarios. Intentá de nuevo en unos minutos.');
  }
};
