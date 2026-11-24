-- Migración: Tablas para dispositivos y notificaciones push
-- Fecha: 2026-02-09
-- Descripción: Creación de tablas para registro de dispositivos móviles y tracking de notificaciones

-- Tabla de dispositivos registrados
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  user_context_id INTEGER NOT NULL REFERENCES usuario_entidad(id) ON DELETE CASCADE,
  push_token VARCHAR(500) NOT NULL UNIQUE,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_name VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_token UNIQUE (user_context_id, push_token)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_devices_user_context_id ON devices(user_context_id);
CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token);
CREATE INDEX IF NOT EXISTS idx_devices_last_active ON devices(last_active);
CREATE INDEX IF NOT EXISTS idx_devices_is_active ON devices(is_active);

-- Tabla para tracking de notificaciones enviadas
CREATE TABLE IF NOT EXISTS notification_logs (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  user_context_id INTEGER NOT NULL REFERENCES usuario_entidad(id) ON DELETE CASCADE,
  title VARCHAR(255),
  body TEXT NOT NULL,
  data JSONB,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'error')),
  expo_ticket_id VARCHAR(255),
  expo_receipt_id VARCHAR(255),
  error_message TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para notification_logs
CREATE INDEX IF NOT EXISTS idx_notification_logs_device_id ON notification_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_context_id ON notification_logs(user_context_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_expo_ticket_id ON notification_logs(expo_ticket_id);

-- Comentarios para documentación
COMMENT ON TABLE devices IS 'Registro de dispositivos móviles para notificaciones push';
COMMENT ON TABLE notification_logs IS 'Log de notificaciones push enviadas';
COMMENT ON COLUMN devices.push_token IS 'Token de Expo Push Notifications';
COMMENT ON COLUMN devices.platform IS 'Plataforma del dispositivo: ios, android o web';
COMMENT ON COLUMN notification_logs.expo_ticket_id IS 'ID de ticket devuelto por Expo al enviar';
COMMENT ON COLUMN notification_logs.expo_receipt_id IS 'ID de receipt para verificar entrega';
