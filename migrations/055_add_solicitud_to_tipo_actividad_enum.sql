-- tipo_actividad ya perdía el valor SOLICITUD en prod: solicitudesServices.ts y
-- solicitudesRepo.ts ya validan/usan 'SOLICITUD' como tipo_actividad valido,
-- pero el enum en prod nunca lo tuvo (se agrego a mano en dev, fuera de una
-- migracion registrada). Sin esto, crear una solicitud de tipo SOLICITUD
-- falla con "invalid input value for enum tipo_actividad".
ALTER TYPE tipo_actividad ADD VALUE IF NOT EXISTS 'SOLICITUD';
