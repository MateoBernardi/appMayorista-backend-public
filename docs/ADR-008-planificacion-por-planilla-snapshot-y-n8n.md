# ADR-008: Planificación de horarios desde una planilla (snapshot) orquestada con n8n
Date: 2026-10-02
Status: Superseded en parte por ADR-010 (n8n y las reglas en PL/pgSQL se reemplazaron por services TS; el modelo de snapshot y sus reglas siguen vigentes)

## 1. Contexto
La carga de horarios dependía de `planificacion_base_semanal` (editable solo por el admin de la
DB), de un cron semanal (`initGeneracionSemanalShiftsCron`) y de un CSV por día (`/plantilla-dia`).
Límites: no se podía modificar en masa más de un día, los sábados quedaban aislados, y el alta
de usuarios u objetivos dependía del admin. La base semanal tampoco alcanza para horarios que
varían día a día.

## 2. Decisión
Una planilla de Google Sheets (una fila por usuario; 6 días × 2 turnos × entrada/salida/sede;
más el objetivo semanal) es la fuente editable. Cada publicación genera un **snapshot** en la DB
que reemplaza a `planificacion_base_semanal`.

Flujo:
1. `POST /horarios/planificacion/preview` (gerencia, encargado) → el backend llama al webhook de
   n8n (firmado con HMAC) → n8n lee la planilla, la parsea (`docs/n8n/parsePlanilla.js`) y llama
   a `snapshot_previsualizar`, que valida, guarda el snapshot en `PREVIEW` y devuelve el diff.
2. `POST /horarios/planificacion/confirmar {previewId}` → n8n llama a `snapshot_aplicar`: una
   transacción atómica (advisory lock) que reevalúa la regla de 2 h y escribe `planificacion_diaria`.
3. n8n genera cada domingo 01:00 la semana siguiente con `generar_semana_desde_snapshot`
   (idempotente, desde el snapshot ACTIVO, nunca desde Drive).

Toda la lógica de negocio vive en funciones SQL (migración 063); n8n solo orquesta. El rol de
n8n tiene `EXECUTE` sobre las tres funciones y nada más (son `SECURITY DEFINER`).

### Reglas
- **Regla de 2 h:** se evalúa contra el turno VIEJO (`esperado_in >= ahora AR + 2 h`); lo que no
  cumple se omite y se informa. Un turno nuevo sin viejo usa su propio inicio. "Ahora" siempre es
  `now() AT TIME ZONE 'America/Argentina/Buenos_Aires'` (`esperado_in` es `timestamp` sin zona).
- **Alcance:** solo usuarios con ≥1 turno en la planilla y solo turnos `Mañana`/`Tarde`, desde hoy
  hasta el sábado (los domingos, la semana siguiente). Los rotativos no se tocan; sus turnos se
  cargan a mano con `POST /horarios/turno` (turno `Rotativo`).
- **Se pisan** las ediciones manuales válidas; se preserva `feriado` (y las altas lo heredan del
  día/turno). Las filas con `licencia` o solapadas con una solicitud `APROBADA` no se tocan y se
  informan (el usuario debe marcar la ausencia a mano).
- **Validaciones** (todas juntas, sin escribir nada): usuarios existentes, turno/día/horas/sede
  válidos, sin duplicados ni solapamientos, y guarda anti-borrado (menos de la mitad de los turnos
  del snapshot activo se rechaza).
- **Objetivos** en minutos (migración 073; antes deciHoras). El payload de n8n los sigue mandando en
  horas. El publish escribe `minutos_objetivo_pendiente`; la
  generación semanal lo promueve, para no alterar el resumen de la semana en curso. Un usuario
  nuevo recibe su objetivo de inmediato. Se informan solo los faltantes (preview: semana actual y
  próxima; corrida automática: alerta por mail al admin).
- **Notificaciones:** cola `notificaciones_pendientes` (outbox) alimentada dentro de la misma
  transacción del confirmar y despachada por un worker (`initNotificacionesColaCron`, cada minuto,
  `FOR UPDATE SKIP LOCKED`, backoff, máx. 5 intentos). Las corridas automáticas no notifican.
- **`minutos_trabajados`** (antes `horas_trabajadas`, en deciHoras): los turnos de la planilla/alta manual ya no la escriben (nace en 0); la
  calcula de noche el mismo cron de las 23:30 que reporta las ausencias
  (`initAusenciasSweepCron` → `calcularHorasTrabajadasRecientes`, `horariosRepo.ts`), **según los
  marcados** (`marcado_in_at`/`marcado_out_at`). En minutos, por turno sin licencia y con entrada
  marcada. La entrada cuenta desde `esperado_in`, o desde la marca si llegó tarde (la llegada
  anticipada no suma; la tardanza descuenta):
  1. salida marcada → `salida − entrada` (la salida tardía suma: alimenta las horas extra/francos);
  2. sin salida → hasta el fin del turno: `esperado_out − entrada` (0 si llegó después del fin);
  3. horario corrido (`esperado_out` NULL) sin salida → jornada fija de 8 h, o 4 h si su objetivo
     semanal es de medio tiempo (< 40 h, migración 078; sin objetivo cargado, 8 h). La define una sola función
     SQL, `jornada_corrido_minutos()`.
  A eso se le resta lo que se solape con licencias por horas aprobadas (ver "Licencias").
  Sin entrada marcada no se toca el turno. Es idempotente y recalcula hoy y ayer (hora Argentina),
  así que una salida marcada después de las 23:30 se corrige la noche siguiente. El del sábado
  corre antes del resumen semanal del domingo 00:00. No se aplica el ×2 de feriado (duración cruda).
  Los lectores (`getHorasSemanalesVsObjetivo`, `getHorasExcedentesSemanales`,
  `getHorasExtrasPostSabado`) ven las horas del día recién después de las 23:30.
  **Backfill al desplegar** (una vez, lo corre quien despliega; recalcula la semana en curso, ajustar
  `$1` = días hacia atrás): ejecutar `SQL_CALCULAR_HORAS_TRABAJADAS` con el parámetro
  `(7)`: por ejemplo con `psql` tomando el SQL del repo (ver
  `database/tests/horas_trabajadas.test.sql`) o llamando a `calcularHorasTrabajadasRecientes(7)`.
- **`horario_corrido`** (update manual): deja un único turno por día (el de menor `esperado_in`),
  `esperado_out = NULL`, sede de salida = sede de entrada, borra los demás. Al marcar salida no se
  verifica el horario (no hay reporte de salida anticipada). No es reversible.
- **Licencias sobre turnos** (migración 074): `aplicar_licencia` / `revertir_licencia`, únicas
  implementaciones. Las llaman la aprobación y la cancelación (`licenciasRepo`) y la generación
  semanal / publicación, para los turnos nuevos.
  - **Por días:** los turnos que cubre enteros quedan con `licencia = true`.
  - **Por horas:** cubre el turno entero → `licencia = true`; cubre el inicio o el final → se recorta
    `esperado_in`/`esperado_out`; cae en el medio → el horario no cambia y se resta de
    `minutos_trabajados`.
  - **Solape:** queda en `minutos_licencia` y descuenta del objetivo semanal. Si la licencia es un
    franco, además se consume del saldo, salvo el sábado ≥ 13.

### Deuda técnica: reglas de negocio en SQL
> **Resuelta por ADR-010:** las reglas se migraron a services TS y n8n se dio de baja. Lo que sigue
> es el registro histórico.

Las reglas de planificación y de licencias sobre turnos (diff, regla de 2 h, objetivos pendientes,
recorte de turnos por licencias, consumo de francos por horas) viven en PL/pgSQL (migraciones
063/065/073/074), porque n8n llama directo a estas funciones. Es una excepción a la regla del
proyecto (las reglas de negocio van en el dominio, en los services TS), con costos concretos:
- **Reglas fuera del dominio:** parte de la lógica de licencias está en `licenciasServices` y
  parte en la DB.
- **Tests manuales:** se prueban con tests `.sql` que se corren a mano contra una base
  (`database/tests/`); Jest solo verifica que se invoquen.
- **Cambios caros:** cada cambio es una migración que copia la función entera
  (`CREATE OR REPLACE`).

**Salida:** que n8n llame a endpoints del backend (`generar-semana`, `confirmar`) en vez de a las
funciones, y migrar la lógica a services TS. Mientras tanto, no duplicar estas reglas en TS:
aprobar y cancelar invocan las funciones.

**Para flujos nuevos de n8n:** n8n solo lee, prepara datos y los manda a un endpoint del backend,
que valida y aplica las reglas en el dominio. No se agregan funciones SQL con lógica de negocio
para n8n.

## 3. Alternativas descartadas
- Confiar en la planilla de Drive para las corridas automáticas: se puede alterar sin control.
- Escribir directo desde n8n con SQL en los nodos: duplica lógica y no es atómico; se prefirieron
  funciones SQL.
- Vigencia de objetivos con tabla `vigente_desde`: obliga a reescribir cuatro consultas; se eligió
  la columna `horas_objetivo_pendiente`.

## 4. Estado y despliegue
Hecho: migraciones 062/063, funciones SQL (probadas: `database/tests/snapshot_planificacion.test.sql`),
endpoints `preview`/`confirmar`/`turno`/`info`, cliente n8n, cola de notificaciones, `horario_corrido`,
workflows y parser (`docs/n8n`), y la limpieza del código viejo: se eliminaron `/base-shifts`,
`/plantilla-dia`, el ABM de `/objetivos` (queda `GET /objetivos/semanal`, que ahora incluye
`horasObjetivoPendiente` y, desde la 073, los campos en minutos), el parser de CSV y el cron semanal. La migración `064` borra
`planificacion_base_semanal` y se aplica recién tras el cutover.

Puesta en marcha (histórica; `docs/n8n/` se eliminó, el despliegue vigente está en ADR-010 y el
layout de la planilla en el encabezado de `planillaParser.ts`). Mientras convivan el cron viejo y el workflow semanal
(versiones anteriores del backend), **no activar el semanal**: ambos generan la misma semana.
