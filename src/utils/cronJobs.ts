import * as cron from 'node-cron';
import { clearAllRefreshTokens } from '../adapters/db/authRepo';
import { calcularResumenSemanalService, ejecutarSweepSinMarcar, ejecutarSweepHorasTrabajadas } from '../domain/services/horariosServices';
import { ejecutarSweepAsentadoAutomatico, ejecutarSweepAusencias } from '../domain/services/reportesServices';
import { cleanupInactiveDevices, sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { checkNotificationReceipts } from '../adapters/comunications/expoPushNotifications';
import { expireNovedad } from '../adapters/db/novedadesRepo';
import { getActividadesProximasSinNotificar, marcarActividadNotificada } from '../adapters/db/actividadesRepo';
import { expirarSolicitudesAusenciaVencidas, expirarSolicitudesAusenciaVencidasSinDocumentacion } from '../adapters/db/licenciasRepo';
import { procesarExpiracionesSinDocumentacion, ejecutarSweepConsumoLicencias } from '../domain/services/licenciasServices';
import { deleteExpiredKeys } from '../adapters/db/idempotencyRepo';
import { procesarColaNotificaciones, limpiarColaNotificaciones } from '../domain/services/notificacionesColaService';
import { generarSemanaService, notificarResultadoSemanal } from '../domain/services/planificacionServices';

const IDEMPOTENCY_KEY_TTL_HOURS = 72;

// Los horarios de los cron están pensados en hora argentina; se fija el timezone
// explícitamente para no depender del TZ configurado en el entorno del server.
const CRON_OPTIONS = { timezone: 'America/Argentina/Buenos_Aires' };

/**
 * Inicializa el cron job que limpia claves de idempotencia vencidas
 * Se ejecuta todos los días a las 4:30 AM
 */
export const initIdempotencyKeysCleanupCron = () => {
  // Cron expression: '30 4 * * *' = todos los días a las 4:30 AM
  cron.schedule('30 4 * * *', async () => {
    try {
      console.log('Running idempotency keys cleanup job...');
      const deletedCount = await deleteExpiredKeys(IDEMPOTENCY_KEY_TTL_HOURS);
      console.log(`Idempotency keys cleanup completed. Deleted ${deletedCount} keys.`);
    } catch (error) {
      console.error('Error in idempotency keys cleanup cron job:', error);
    }

    try {
      const eliminadas = await limpiarColaNotificaciones();
      if (eliminadas > 0) {
        console.log(`Notification queue cleanup completed. Deleted ${eliminadas} rows.`);
      }
    } catch (error) {
      console.error('Error in notification queue cleanup:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el worker de la cola de notificaciones (notificaciones_pendientes).
 * Se ejecuta cada minuto; el reclamo con SKIP LOCKED evita duplicados entre instancias.
 */
export const initNotificacionesColaCron = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const { enviadas, fallidas } = await procesarColaNotificaciones();
      if (enviadas > 0 || fallidas > 0) {
        console.log(`[Cron] Cola de notificaciones: ${enviadas} enviada(s), ${fallidas} con error.`);
      }
    } catch (error) {
      console.error('Error in notification queue cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el cron job que limpia la tabla refresh_tokens
 * Se ejecuta todos los días a las 3:00 AM
 */
export const initRefreshTokensCleanupCron = () => {
  // Cron expression: '0 3 * * *' = todos los días a las 3:00 AM
  cron.schedule('0 3 * * *', async () => {
    try {
      const deletedCount = await clearAllRefreshTokens();
    } catch (error) {
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el cron job que limpia dispositivos inactivos
 * Se ejecuta todos los días a las 3:30 AM
 */
export const initDevicesCleanupCron = () => {
  // Cron expression: '30 3 * * *' = todos los días a las 3:30 AM
  cron.schedule('30 3 * * *', async () => {
    try {
      console.log('Running device cleanup job...');
      const deletedCount = await cleanupInactiveDevices(30); // Eliminar dispositivos inactivos por más de 30 días
      console.log(`Device cleanup completed. Deleted ${deletedCount} devices.`);
    } catch (error) {
      console.error('Error in device cleanup cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el cron job que verifica receipts de notificaciones
 * Se ejecuta cada 15 minutos
 */
export const initNotificationReceiptsCron = () => {
  // Cron expression: '*/15 * * * *' = cada 15 minutos
  cron.schedule('*/15 * * * *', async () => {
    try {
      await checkNotificationReceipts();
    } catch (error) {
      console.error('Error in notification receipts cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el cron job que expira novedades con más de 7 días
 * Se ejecuta todos los días a las 4:00 AM
 */
export const initNovedadesExpiryCron = () => {
  // Cron expression: '0 4 * * *' = todos los días a las 4:00 AM
  cron.schedule('0 4 * * *', async () => {
    try {
      await expireNovedad();
    } catch (error) {
      console.error('Error in novedades expiry cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el cron job que envía recordatorios de actividades próximas.
 * Se ejecuta cada 10 minutos entre las 7:00 y las 21:59.
 * Busca actividades que empiezan en los próximos 25 minutos y envía
 * push notifications a sus participantes.
 */
export const initActividadesReminderCron = () => {
  // Cron expression: '*/10 7-21 * * *' = cada 10 min, de 7:00 a 21:59
  cron.schedule('*/10 7-21 * * *', async () => {
    try {
      const actividades = await getActividadesProximasSinNotificar();

      if (actividades.length === 0) return;

      for (const actividad of actividades) {
        // Calcular minutos restantes para el mensaje
        const minutosRestantes = Math.round(
          (new Date(actividad.fecha_inicio).getTime() - Date.now()) / 60000
        );

        sendNotificationToMultipleUsers(actividad.participantes, {
          title: '⏰ Actividad próxima',
          body: `"${actividad.titulo}" comienza en ${minutosRestantes} minutos`,
          data: {
            type: 'recordatorio_actividad',
            actividad_id: actividad.actividad_id,
            domain: 'solicitudesActividades',
            event: 'updated',
            updated_at: new Date().toISOString(),
            entity_id: String(actividad.actividad_id)
          }
        }).catch(err => console.error(`Error enviando recordatorio actividad ${actividad.actividad_id}:`, err));

        // Marcar como notificada para no enviar duplicados
        await marcarActividadNotificada(actividad.actividad_id);
      }

      console.log(`[Cron] Recordatorios enviados para ${actividades.length} actividad(es)`);
    } catch (error) {
      console.error('Error in actividades reminder cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa el cron job que expira solicitudes de ausencia cuya fecha_inicio ya pasó.
 * Se ejecuta cada 15 minutos.
 */
export const initSolicitudesAusenciaExpiryCron = () => {
  // Cron expression: '*/15 * * * *' = cada 15 minutos
  cron.schedule('*/15 * * * *', async () => {
    try {
      const ExpiredSolicitudes = await expirarSolicitudesAusenciaVencidas();
      if (ExpiredSolicitudes.length > 0) {
        console.log(`[Cron] Solicitudes de ausencia expiradas: ${ExpiredSolicitudes.length}`);
      }
    } catch (error) {
      console.error('Error in solicitudes ausencia expiry cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Inicializa un cron job que expira las solicitudes de ausencia que pasaron su fecha de inicio por 24 hs y siguen en estado pendiente documentación.
 * Genera un reporte y envía notificación a gerencia y encargados.
 */
export const initExpireLicenciasPendientesDocumentacionCron = () => {
  // Cron expression: '0 7 * * *' = todos los días a las 7:00 AM
  cron.schedule('0 7 * * *', async () => {
    try {
      const expiredSolicitudes = await expirarSolicitudesAusenciaVencidasSinDocumentacion();
      if (expiredSolicitudes.length > 0) {
        console.log(`[Cron] Solicitudes de ausencia expiradas por falta de documentación: ${expiredSolicitudes.length}`);
        await procesarExpiracionesSinDocumentacion(expiredSolicitudes);
      }
    } catch (error) {
      console.error('Error in expiring pending documentation absence requests cron job:', error);
    }
  }, CRON_OPTIONS);
};

export const initConsumirLicenciasAprobadasCron = () => {
  cron.schedule('0 6 * * *', async () => {
    try {
      const procesadas = await ejecutarSweepConsumoLicencias();
      if (procesadas > 0) {
        console.log(`[Cron] Licencias marcadas como consumidas: ${procesadas}`);
      }
    } catch (error) {
      console.error('Error in consumir licencias aprobadas cron job:', error);
    }
  }, CRON_OPTIONS);
};

export const initResumenSemanalCron = () => {
  // Domingo 00:00 AM
  cron.schedule('0 0 * * 0', async () => {
    await calcularResumenSemanalService();
  }, CRON_OPTIONS);
};

export const initReportesAsentadoAutomaticoCron = () => {
  cron.schedule('*/60 * * * *', async () => {
    try {
      const asentados = await ejecutarSweepAsentadoAutomatico();
      if (asentados > 0) {
        console.log(`[Cron] Reportes asentados automáticamente: ${asentados}`);
      }
    } catch (error) {
      console.error('Error in reportes asentado automático cron job:', error);
    }
  }, CRON_OPTIONS);
};

/**
 * Avisa los turnos sin marcar: la entrada a mitad del turno y la salida al pasar la gracia, una
 * sola vez por turno (lo garantizan las marcas aviso_*_at). Corre cada 15 min porque las mitades
 * de turno varían según la planilla (p. ej. 10:00 y 18:00 para 08-12 y 16-20); el desvío máximo
 * respecto de la mitad exacta es de 15 min.
 */
export const initSinMarcarSweepCron = () => {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const enviados = await ejecutarSweepSinMarcar();
      if (enviados > 0) {
        console.log(`[Cron] Mensajes de sin-marcar enviados: ${enviados}`);
      }
    } catch (error) {
      console.error('Error in sin-marcar sweep cron job:', error);
    }
  }, CRON_OPTIONS);
};

export const initAusenciasSweepCron = () => {
  cron.schedule('30 23 * * *', async () => {
    try {
      const reportados = await ejecutarSweepAusencias();
      if (reportados > 0) {
        console.log(`[Cron] Reportes de ausencia generados: ${reportados}`);
      }
    } catch (error) {
      console.error('Error in ausencias sweep cron job:', error);
    }

    try {
      const actualizados = await ejecutarSweepHorasTrabajadas();
      if (actualizados > 0) {
        console.log(`[Cron] Horas trabajadas calculadas: ${actualizados} turno(s) actualizado(s)`);
      }
    } catch (error) {
      console.error('Error in horas trabajadas sweep cron job:', error);
    }
  }, CRON_OPTIONS);
};


/**
 * Genera la semana siguiente desde el snapshot ACTIVO y avisa por mail al administrador si hubo
 * un problema o usuarios por debajo de su objetivo. Domingo 01:00 (reemplaza al workflow semanal de n8n).
 */
export const initGeneracionSemanalCron = () => {
  cron.schedule('0 1 * * 0', async () => {
    try {
      const resultado = await generarSemanaService();
      console.log(`[Cron] Generación semanal: ${JSON.stringify({ ...resultado, faltantes: resultado.ok ? resultado.faltantes.length : undefined })}`);
      await notificarResultadoSemanal(resultado);
    } catch (error) {
      console.error('Error in weekly generation cron job:', error);
    }
  }, CRON_OPTIONS);
};
