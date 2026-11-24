-- Prueba funcional del cálculo de minutos trabajados (SQL_CALCULAR_HORAS_TRABAJADAS, horariosRepo.ts).
-- Corre en una transacción que se descarta. Usa los user_context_id 7, 8, 14 y 15 de la DB de dev;
-- no usar contra otras bases. Inyecta el SQL exacto del repositorio:
--   DOTENV_CONFIG_QUIET=true psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
--     -v sql="$(DOTENV_CONFIG_QUIET=true npx ts-node --files -e "import { SQL_CALCULAR_HORAS_TRABAJADAS as s } from './src/adapters/db/horariosRepo'; process.stdout.write(s)")" \
--     -f database/tests/horas_trabajadas.test.sql
BEGIN;

DO $$
DECLARE
  hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  ayer date := hoy - 1;
BEGIN
  DELETE FROM scans WHERE planificacion_diaria_id IN (SELECT id FROM planificacion_diaria WHERE user_context_id IN (7,8,14,15));
  DELETE FROM planificacion_diaria WHERE user_context_id IN (7,8,14,15);
  -- Licencias reales de la DB de dev restarían su solape a los turnos del test.
  DELETE FROM solicitudes_ausencia WHERE usuario_id IN (7,8,14,15);
  DELETE FROM usuarios_horas_objetivo WHERE user_context_id IN (7,8,14,15);
  INSERT INTO usuarios_horas_objetivo (user_context_id, minutos_objetivo) VALUES (14, 2880), (15, 1440);

  -- (usuario, turno, fecha, esperado_in, esperado_out, marcado_in, marcado_out, licencia, minutos_previos)
  INSERT INTO planificacion_diaria
    (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out, marcado_in_at, marcado_out_at, licencia, minutos_trabajados) VALUES
    -- A: llega antes y se va después → cuenta desde esperado_in hasta la salida: 08:00 → 12:10 = 4 h 10 min = 250
    (7,  'Mañana', hoy + time '08:00', hoy + time '12:00', 1,1, hoy + time '07:50', hoy + time '12:10', false, 0),
    -- B: llegada anticipada de 20 min no suma: 16:00 → 20:00 = 240
    (7,  'Tarde',  hoy + time '16:00', hoy + time '20:00', 1,1, hoy + time '15:40', hoy + time '20:00', false, 0),
    -- C: entrada sin salida → limitada al fin del turno: 07:10 → 09:00 = 1 h 50 min = 110
    (8,  'Mañana', hoy + time '07:00', hoy + time '09:00', 1,1, hoy + time '07:10', NULL, false, 0),
    -- D: llegó después del fin del turno y sin salida → 0
    (8,  'Tarde',  hoy + time '20:00', hoy + time '22:00', 1,1, hoy + time '22:30', NULL, false, 99),
    -- E: corrido sin salida, objetivo completo (2880) → 8 h = 480
    (14, 'Mañana', hoy + time '08:00', NULL,              1,1, hoy + time '08:00', NULL, false, 0),
    -- F: corrido sin salida, medio tiempo (1440) → 4 h = 240
    (15, 'Mañana', hoy + time '10:00', NULL,              1,1, hoy + time '10:00', NULL, false, 0),
    -- G: corrido CON salida marcada → rige la regla de scans: 16:00 → 20:00 = 240
    (15, 'Tarde',  hoy + time '16:00', NULL,              1,1, hoy + time '16:00', hoy + time '20:00', false, 0),
    -- H: licencia → no se toca
    (14, 'Tarde',  hoy + time '16:00', hoy + time '20:00', 1,1, hoy + time '16:00', hoy + time '20:00', true, 99),
    -- I: ayer, salida marcada tarde (después del cron) → se recalcula: 15 h 40 min = 940
    (7,  'Mañana', ayer + time '08:00', ayer + time '12:00', 1,1, ayer + time '08:00', ayer + time '23:40', false, 40),
    -- J: hace 3 días → fuera de la ventana, no se toca
    (7,  'Tarde',  (hoy - 3) + time '16:00', (hoy - 3) + time '20:00', 1,1, (hoy - 3) + time '16:00', (hoy - 3) + time '20:00', false, 5),
    -- K: ayer sin entrada marcada → no se toca
    (8,  'Mañana', ayer + time '08:00', ayer + time '12:00', 1,1, NULL, NULL, false, 77),
    -- L: sin cambios respecto de lo ya guardado → no cuenta como actualizada
    (14, 'Rotativo', hoy + time '09:00', hoy + time '10:00', 1,1, hoy + time '09:00', hoy + time '10:00', false, 60);
END $$;

SELECT format('PREPARE calc(int) AS %s', :'sql') \gexec

-- 1ª corrida: 8 turnos cambian (A B C D E F G I); H, J, K y L no.
EXECUTE calc(1);

DO $$
DECLARE
  hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  ayer date := hoy - 1;
  v int;
BEGIN
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=7  AND turno='Mañana' AND DATE(esperado_in)=hoy;  ASSERT v = 250, 'A: desde esperado_in hasta la salida marcada: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=7  AND turno='Tarde'  AND DATE(esperado_in)=hoy;  ASSERT v = 240, 'B: llegada anticipada no suma: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=8  AND turno='Mañana' AND DATE(esperado_in)=hoy;  ASSERT v = 110, 'C: sin salida, limitada al turno: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=8  AND turno='Tarde'  AND DATE(esperado_in)=hoy;  ASSERT v = 0,   'D: llegó después del fin: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=14 AND turno='Mañana' AND DATE(esperado_in)=hoy;  ASSERT v = 480, 'E: corrido sin salida, jornada completa: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=15 AND turno='Mañana' AND DATE(esperado_in)=hoy;  ASSERT v = 240, 'F: corrido sin salida, medio tiempo: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=15 AND turno='Tarde'  AND DATE(esperado_in)=hoy;  ASSERT v = 240, 'G: corrido con salida, según scans: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=14 AND turno='Tarde'  AND DATE(esperado_in)=hoy;  ASSERT v = 99,  'H: licencia no se toca: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=7  AND turno='Mañana' AND DATE(esperado_in)=ayer; ASSERT v = 940, 'I: ayer, salida tardía recalculada: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=7  AND turno='Tarde'  AND DATE(esperado_in)=hoy-3; ASSERT v = 5, 'J: fuera de la ventana no se toca: '||v;
  SELECT minutos_trabajados INTO v FROM planificacion_diaria WHERE user_context_id=8  AND turno='Mañana' AND DATE(esperado_in)=ayer; ASSERT v = 77, 'K: sin entrada marcada no se toca: '||v;
  RAISE NOTICE 'OK: reglas de horas trabajadas';
END $$;

-- 2ª corrida: idempotente, no cambia nada (UPDATE 0).
EXECUTE calc(1);

-- Con ventana mayor entra el turno de hace 3 días (J): 4 h = 240.
EXECUTE calc(5);
DO $$
DECLARE v int;
BEGIN
  SELECT minutos_trabajados INTO v FROM planificacion_diaria
   WHERE user_context_id=7 AND turno='Tarde' AND DATE(esperado_in)=(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date-3;
  ASSERT v = 240, 'backfill con ventana mayor: '||v;
  RAISE NOTICE 'OK: idempotencia y ventana configurable';
END $$;

-- Umbral de jornada (migración 078): 40 h o más = 8 h; menos de 40 h = 4 h; sin objetivo = 8 h.
DO $$
BEGIN
  ASSERT jornada_corrido_minutos(2400) = 480, 'objetivo 40 h: jornada completa';
  ASSERT jornada_corrido_minutos(2399) = 240, 'objetivo < 40 h: media jornada';
  ASSERT jornada_corrido_minutos(1800) = 240, 'objetivo 30 h: media jornada';
  ASSERT jornada_corrido_minutos(NULL) = 480, 'sin objetivo: jornada completa';
  RAISE NOTICE 'OK: umbral de 40 h';
END $$;

ROLLBACK;
