import app from "./app";
import {
  initRefreshTokensCleanupCron,
  initDevicesCleanupCron,
  initNotificationReceiptsCron,
  initNovedadesExpiryCron,
  initActividadesReminderCron,
  initSolicitudesAusenciaExpiryCron,
  initIdempotencyKeysCleanupCron,
  initResumenSemanalCron,
  initExpireLicenciasPendientesDocumentacionCron,
  initConsumirLicenciasAprobadasCron,
  initReportesAsentadoAutomaticoCron,
  initSinMarcarSweepCron,
  initAusenciasSweepCron,
  initNotificacionesColaCron,
  initGeneracionSemanalCron
} from "./utils/cronJobs";
import { initSocketServer } from "./adapters/realtime/socketServer";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  // Inicializar cron jobs
  initRefreshTokensCleanupCron();
  initDevicesCleanupCron();
  initNotificationReceiptsCron();
  initNovedadesExpiryCron();
  initActividadesReminderCron();
  initSolicitudesAusenciaExpiryCron();
  initIdempotencyKeysCleanupCron();
  initResumenSemanalCron();
  initExpireLicenciasPendientesDocumentacionCron();
  initConsumirLicenciasAprobadasCron();
  initReportesAsentadoAutomaticoCron();
  initSinMarcarSweepCron();
  initAusenciasSweepCron();
  initNotificacionesColaCron();
  initGeneracionSemanalCron();
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

initSocketServer(server);
