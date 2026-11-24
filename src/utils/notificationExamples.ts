import { sendNotificationToUser, sendNotificationToMultipleUsers } from '../domain/services/devicesService';

/**
 * EJEMPLOS DE USO DE NOTIFICACIONES PUSH
 * 
 * Este archivo contiene ejemplos de cómo integrar notificaciones push
 * en diferentes partes de tu aplicación.
 */

// ============================================================================
// EJEMPLO 1: Notificar cuando se crea un nuevo pedido
// ============================================================================

export const notificarNuevoPedido = async (pedidoId: number, userContextId: number, clienteNombre: string) => {
  try {
    await sendNotificationToUser(userContextId, {
      title: '🛒 Nuevo Pedido',
      body: `Pedido #${pedidoId} creado para ${clienteNombre}`,
      data: {
        type: 'nuevo_pedido',
        pedido_id: pedidoId,
        action: 'open_pedido'
      },
      sound: 'default',
      badge: 1
    });
  } catch (error) {
    console.error('Error enviando notificación de nuevo pedido:', error);
  }
};

// ============================================================================
// EJEMPLO 2: Notificar cuando cambia el estado de un pedido
// ============================================================================

export const notificarCambioEstadoPedido = async (
  pedidoId: number, 
  userContextId: number, 
  nuevoEstado: string
) => {
  const estadoMessages: Record<string, string> = {
    'pendiente': 'Pedido pendiente de aprobación',
    'aprobado': '✅ Pedido aprobado y en proceso',
    'enviado': '📦 Pedido enviado',
    'entregado': '🎉 Pedido entregado',
    'cancelado': '❌ Pedido cancelado'
  };

  try {
    await sendNotificationToUser(userContextId, {
      title: 'Estado del Pedido Actualizado',
      body: estadoMessages[nuevoEstado] || `Estado: ${nuevoEstado}`,
      data: {
        type: 'cambio_estado_pedido',
        pedido_id: pedidoId,
        nuevo_estado: nuevoEstado,
        action: 'open_pedido'
      }
    });
  } catch (error) {
    console.error('Error enviando notificación de cambio de estado:', error);
  }
};

// ============================================================================
// EJEMPLO 3: Notificar aprobación/rechazo de licencia
// ============================================================================

export const notificarLicencia = async (
  licenciaId: number,
  userContextId: number,
  aprobada: boolean,
  motivo?: string
) => {
  try {
    await sendNotificationToUser(userContextId, {
      title: aprobada ? '✅ Licencia Aprobada' : '❌ Licencia Rechazada',
      body: aprobada 
        ? `Tu solicitud de licencia #${licenciaId} ha sido aprobada`
        : `Tu solicitud de licencia #${licenciaId} fue rechazada. Motivo: ${motivo}`,
      data: {
        type: 'licencia_respuesta',
        licencia_id: licenciaId,
        aprobada,
        action: 'open_licencias'
      }
    });
  } catch (error) {
    console.error('Error enviando notificación de licencia:', error);
  }
};

// ============================================================================
// EJEMPLO 4: Notificar nueva tarea en Kanban
// ============================================================================

export const notificarNuevaTarea = async (
  tareaId: number,
  userContextIds: number[],
  tareaTitulo: string,
  asignadoPor: string
) => {
  try {
    await sendNotificationToMultipleUsers(userContextIds, {
      title: '📋 Nueva Tarea Asignada',
      body: `${asignadoPor} te asignó: "${tareaTitulo}"`,
      data: {
        type: 'nueva_tarea',
        tarea_id: tareaId,
        action: 'open_kanban'
      },
      priority: 'high'
    });
  } catch (error) {
    console.error('Error enviando notificación de nueva tarea:', error);
  }
};

// ============================================================================
// EJEMPLO 5: Notificar recordatorio de actividad pendiente
// ============================================================================

export const notificarRecordatorioActividad = async (
  actividadId: number,
  userContextId: number,
  actividadNombre: string,
  fechaVencimiento: Date
) => {
  try {
    const diasRestantes = Math.ceil(
      (fechaVencimiento.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    await sendNotificationToUser(userContextId, {
      title: '⏰ Recordatorio de Actividad',
      body: `"${actividadNombre}" vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`,
      data: {
        type: 'recordatorio_actividad',
        actividad_id: actividadId,
        dias_restantes: diasRestantes,
        action: 'open_actividades'
      },
      badge: 1
    });
  } catch (error) {
    console.error('Error enviando recordatorio de actividad:', error);
  }
};

// ============================================================================
// EJEMPLO 6: Notificación masiva a todos los usuarios de un entorno
// ============================================================================

export const notificarAnuncioGeneral = async (
  userContextIds: number[],
  titulo: string,
  mensaje: string
) => {
  try {
    const result = await sendNotificationToMultipleUsers(userContextIds, {
      title: titulo,
      body: mensaje,
      data: {
        type: 'anuncio_general',
        action: 'open_novedades'
      },
      priority: 'high'
    });

    return result;
  } catch (error) {
    console.error('Error enviando anuncio general:', error);
    throw error;
  }
};

// ============================================================================
// EJEMPLO 7: Notificar cuando hay un nuevo archivo compartido
// ============================================================================

export const notificarNuevoArchivo = async (
  archivoId: number,
  userContextIds: number[],
  archivoNombre: string,
  compartidoPor: string
) => {
  try {
    await sendNotificationToMultipleUsers(userContextIds, {
      title: '📎 Nuevo Archivo Compartido',
      body: `${compartidoPor} compartió "${archivoNombre}"`,
      data: {
        type: 'nuevo_archivo',
        archivo_id: archivoId,
        action: 'open_archivos'
      }
    });
  } catch (error) {
    console.error('Error enviando notificación de nuevo archivo:', error);
  }
};

// ============================================================================
// EJEMPLO 8: Notificar respuesta de encuesta
// ============================================================================

export const notificarNuevaEncuesta = async (
  encuestaId: number,
  userContextIds: number[],
  encuestaTitulo: string
) => {
  try {
    await sendNotificationToMultipleUsers(userContextIds, {
      title: '📊 Nueva Encuesta Disponible',
      body: `"${encuestaTitulo}" - Tu opinión es importante`,
      data: {
        type: 'nueva_encuesta',
        encuesta_id: encuestaId,
        action: 'open_encuestas'
      },
      badge: 1
    });
  } catch (error) {
    console.error('Error enviando notificación de encuesta:', error);
  }
};

// ============================================================================
// EJEMPLO 9: Notificar stock bajo de artículo (para admin/gerencia)
// ============================================================================

export const notificarStockBajo = async (
  articuloId: number,
  adminUserContextIds: number[],
  articuloNombre: string,
  stockActual: number
) => {
  try {
    await sendNotificationToMultipleUsers(adminUserContextIds, {
      title: '⚠️ Alerta de Stock Bajo',
      body: `"${articuloNombre}" tiene solo ${stockActual} unidades`,
      data: {
        type: 'stock_bajo',
        articulo_id: articuloId,
        stock_actual: stockActual,
        action: 'open_articulo'
      },
      priority: 'high'
    });
  } catch (error) {
    console.error('Error enviando notificación de stock bajo:', error);
  }
};

// ============================================================================
// EJEMPLO 10: Sistema de notificaciones programadas
// ============================================================================

export const programarNotificacion = async (
  userContextId: number,
  titulo: string,
  mensaje: string,
  data: any,
  delayMinutos: number
) => {
  // Programar notificación para enviar después de X minutos
  setTimeout(async () => {
    try {
      await sendNotificationToUser(userContextId, {
        title: titulo,
        body: mensaje,
        data: data
      });
    } catch (error) {
      console.error('Error enviando notificación programada:', error);
    }
  }, delayMinutos * 60 * 1000);
};

// ============================================================================
// USO EN CONTROLLERS O SERVICES
// ============================================================================

/*

// En pedidosController.ts
import { notificarNuevoPedido } from '../utils/notificationExamples';

export const crearPedidoController = async (req: Request, res: Response) => {
  // ... crear pedido ...
  
  // Enviar notificación
  await notificarNuevoPedido(
    pedido.id, 
    req.user.userContextId, 
    cliente.nombre
  );
  
  return res.json({ success: true, pedido });
};

// En licenciasService.ts
import { notificarLicencia } from '../utils/notificationExamples';

export const aprobarLicencia = async (licenciaId: number, aprobada: boolean) => {
  // ... actualizar licencia en DB ...
  
  // Notificar al usuario
  await notificarLicencia(
    licenciaId,
    licencia.user_context_id,
    aprobada,
    aprobada ? undefined : 'No hay disponibilidad de personal'
  );
  
  return licencia;
};

*/
