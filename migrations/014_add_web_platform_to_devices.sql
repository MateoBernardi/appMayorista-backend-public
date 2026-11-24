-- Migracion: habilitar plataforma web para dispositivos push
-- Fecha: 2026-03-16
-- Descripcion: amplia el check constraint de devices.platform para incluir 'web'

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_platform_check;

ALTER TABLE devices
  ADD CONSTRAINT devices_platform_check
  CHECK (platform IN ('ios', 'android', 'web'));
