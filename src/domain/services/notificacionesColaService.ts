import {
  reclamarNotificaciones,
  marcarNotificacionesEnviadas,
  marcarNotificacionesFallidas,
  eliminarNotificacionesViejas,
  NotificacionPendienteRow,
} from '../../adapters/db/notificacionesPendientesRepo';
import { sendNotificationToMultipleUsers } from './devicesService';

const LOTE = 200;

export const procesarColaNotificaciones = async (): Promise<{ enviadas: number; fallidas: number }> => {
  const lote = await reclamarNotificaciones(LOTE);
  if (lote.length === 0) return { enviadas: 0, fallidas: 0 };

  const grupos = new Map<string, NotificacionPendienteRow[]>();
  for (const n of lote) {
    const clave = JSON.stringify(n.payload);
    grupos.set(clave, [...(grupos.get(clave) ?? []), n]);
  }

  let enviadas = 0;
  let fallidas = 0;

  for (const items of grupos.values()) {
    const { payload } = items[0] as NotificacionPendienteRow;
    const ok: number[] = [];
    const ko: number[] = [];
    let motivo = 'Falló el envío de la notificación.';

    try {
      const { results } = await sendNotificationToMultipleUsers(
        items.map(i => i.userContextId),
        { ...payload, data: { ...payload.data, updated_at: new Date().toISOString() } }
      );
      for (const item of items) {
        const r = results.get(item.userContextId);
        const fallo = !r || (r.errors.length > 0 && r.sentCount === 0);
        if (fallo) {
          ko.push(item.id);
          if (r?.errors[0]) motivo = r.errors[0];
        } else {
          ok.push(item.id);
        }
      }
    } catch (error) {
      ko.push(...items.map(i => i.id));
      motivo = error instanceof Error ? error.message : motivo;
    }

    await marcarNotificacionesEnviadas(ok);
    await marcarNotificacionesFallidas(ko, motivo);
    enviadas += ok.length;
    fallidas += ko.length;
  }

  return { enviadas, fallidas };
};

export const limpiarColaNotificaciones = async (dias = 14): Promise<number> => eliminarNotificacionesViejas(dias);
