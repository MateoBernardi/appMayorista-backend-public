import { pool } from './pgClient';
import { Device, NotificationLog } from '../../domain/dto/DeviceDTO';

// Buscar dispositivo por user_context_id y push_token
export const findDeviceByUserAndToken = async (
  userContextId: number,
  pushToken: string
): Promise<Device | null> => {
  const result = await pool.query(
    `SELECT * FROM devices WHERE user_context_id = $1 AND push_token = $2`,
    [userContextId, pushToken]
  );
  return result.rows[0] || null;
};

// Buscar dispositivo solo por push_token (para detectar reasignaciones)
export const findDeviceByToken = async (
  pushToken: string
): Promise<Device | null> => {
  const result = await pool.query(
    `SELECT * FROM devices WHERE push_token = $1`,
    [pushToken]
  );
  return result.rows[0] || null;
};

// Reasignar un dispositivo a un nuevo usuario (mismo dispositivo físico, distinto login)
export const reassignDevice = async (
  id: number,
  newUserContextId: number,
  platform: 'ios' | 'android' | 'web',
  deviceName?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Device> => {
  const result = await pool.query(
    `UPDATE devices 
     SET user_context_id = $1, platform = $2, device_name = $3, ip_address = $4, user_agent = $5,
         is_active = TRUE, last_active = NOW(), updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [newUserContextId, platform, deviceName, ipAddress, userAgent, id]
  );
  return result.rows[0];
};

// Crear nuevo dispositivo
export const createDevice = async (
  userContextId: number,
  pushToken: string,
  platform: 'ios' | 'android' | 'web',
  deviceName?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Device> => {
  const result = await pool.query(
    `INSERT INTO devices (user_context_id, push_token, platform, device_name, ip_address, user_agent, registered_at, last_active)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING *`,
    [userContextId, pushToken, platform, deviceName, ipAddress, userAgent]
  );
  return result.rows[0];
};

// Obtener todos los dispositivos activos de un usuario
export const getActiveDevicesByUserContext = async (
  userContextId: number
): Promise<Device[]> => {
  const result = await pool.query(
    `SELECT * FROM devices WHERE user_context_id = $1 AND is_active = TRUE`,
    [userContextId]
  );
  return result.rows;
};

export const getActiveDevicesByMultipleUserContexts = async (
  userContextIds: number[]
): Promise<Map<number, Device[]>> => {
  if (userContextIds.length === 0) return new Map();

  const placeholders = userContextIds.map((_, i) => `$${i + 1}`).join(', ');

  const result = await pool.query(
    `SELECT * FROM devices WHERE user_context_id IN (${placeholders}) AND is_active = TRUE`,
    userContextIds
  );

  return result.rows.reduce((map, device) => {
    const list = map.get(device.user_context_id) ?? [];
    list.push(device);
    return map.set(device.user_context_id, list);
  }, new Map<number, Device[]>());
};

// Desactivar dispositivo por id
export const deactivateDevice = async (id: number): Promise<Device> => {
  const result = await pool.query(
    `UPDATE devices SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

// Desactivar dispositivo por push_token (usado en logout)
export const deactivateDeviceByToken = async (pushToken: string): Promise<Device | null> => {
  const result = await pool.query(
    `UPDATE devices SET is_active = FALSE, updated_at = NOW() WHERE push_token = $1 AND is_active = TRUE RETURNING *`,
    [pushToken]
  );
  return result.rows[0] || null;
};

// Eliminar dispositivos inactivos (más de X días)
export const deleteInactiveDevices = async (daysInactive: number): Promise<number> => {
  const result = await pool.query(
    `DELETE FROM devices 
     WHERE last_active < NOW() - INTERVAL '1 day' * $1
     RETURNING id`,
    [daysInactive]
  );
  return result.rowCount || 0;
};

// Guardar log de notificación
export const saveNotificationLog = async (
  deviceId: number | null,
  userContextId: number,
  title: string | undefined,
  body: string,
  data: any,
  status: string,
  expoTicketId?: string,
  errorMessage?: string,
  deliveredAt?: Date
): Promise<NotificationLog> => {
  const result = await pool.query(
    `INSERT INTO notification_logs (device_id, user_context_id, title, body, data, status, expo_ticket_id, error_message, sent_at, delivered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
     RETURNING *`,
    [deviceId, userContextId, title, body, JSON.stringify(data), status, expoTicketId, errorMessage, deliveredAt ?? null]
  );
  return result.rows[0];
};

// Actualizar estado de notificación con receipt
export const updateNotificationReceipt = async (
  ticketId: string,
  status: string,
  receiptId?: string,
  errorMessage?: string
): Promise<NotificationLog | null> => {
  const result = await pool.query(
    `UPDATE notification_logs 
     SET status = $1, expo_receipt_id = $2, error_message = $3, delivered_at = NOW()
     WHERE expo_ticket_id = $4
     RETURNING *`,
    [status, receiptId, errorMessage, ticketId]
  );
  return result.rows[0] || null;
};

// Obtener tickets pendientes para verificar receipts
export const getPendingTickets = async (hoursAgo: number = 1): Promise<string[]> => {
  const result = await pool.query(
    `SELECT DISTINCT expo_ticket_id 
     FROM notification_logs
     WHERE status = 'sent' 
     AND expo_ticket_id IS NOT NULL
     AND sent_at > NOW() - INTERVAL '1 hour' * $1`,
    [hoursAgo]
  );
  return result.rows.map(row => row.expo_ticket_id);
};
