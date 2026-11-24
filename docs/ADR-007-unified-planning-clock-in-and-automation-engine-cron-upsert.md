# ADR-007: Unified Design for Planning, Clock-In, and Automation Engine (Cron UPSERT)
Date: 2026-04-22
Status: Accepted

## 1. Status
Accepted

## 2. Context and Problem
The system must support real-world scenarios in shift assignment:

- Split shifts: Employees with multiple work blocks on the same day (e.g., 08:00-12:00 and 16:00-20:00).
- Operational flexibility (AC1): Managers must be able to modify one specific day schedule for an employee without changing the global template.
- Exception management: The model must account for time-off days, sick leave, and vacations.
- Performance and simplicity: Splitting "scan events" and "expected schedules" into separate tables would force complex JOINs and error-prone matching logic (i.e., uncertainty about which block a scan belongs to).

A design is needed that automates schedule generation, supports ad-hoc changes without being overwritten by the system, and keeps clock-in transactions fast and atomic.

## 3. Decision
A "Materialized Workday" model is adopted, where theoretical planning and real execution coexist in the same table, fed by a preventive automation engine.

### 3.1 Database Schema (Core Tables)
#### Table 1: `planificacion_diaria` (unified table)
Stores each expected work block and its corresponding clock-in/clock-out data.

- `id`: UUID / INT (PK).
- `user_context_id`: INT (FK).
- `fecha`: DATE.
- `turno`: ENUM 
- `esperado_in`: TIMESTAMP NULL.
- `esperado_out`: TIMESTAMP NULL.
- `real_in`: TIMESTAMP NULL (filled by entry scan).
- `real_out`: TIMESTAMP NULL (filled by exit scan).
- `idempotencia_key`: VARCHAR UNIQUE (prevents double-click submissions).
- `reason`: VARCHAR NULL (e.g., 'Franco', 'Licencia').
- `modificado_manualmente`: BOOLEAN DEFAULT FALSE (protection flag).
- Constraint: `UNIQUE (user_context_id, fecha, turno)`.

#### Table 2: `saldos_francos`
- `user_context_id`: INT (PK/FK).
- `horas_disponibles`: DECIMAL.
- `horas_consumidas`: DECIMAL.

#### Table 3: `devices_clockin`
- `user_context_id`: INT.
- `device_id`: INT.
- Constraint: `UNIQUE (user_context_id, device_id)`.

### 3.2 Automation Engine (Rolling Window Cronjob)
An automatic daily process (cronjob) will be implemented.

Behavior:
- Read shift templates and approved leaves.
- Project and insert schedules into `planificacion_diaria` 7 days in advance.

UPSERT strategy:
- To guarantee idempotency and absorb template changes, the database will use update-on-conflict behavior.

AC1 protection:
- UPSERT must strictly preserve manually modified rows created by HR.

UPSERT SQL logic:

```sql
INSERT INTO planificacion_diaria (id_usuario, fecha, bloque_id, esperado_in, esperado_out)
VALUES (...)
ON CONFLICT (id_usuario, fecha, bloque_id)
DO UPDATE SET
    esperado_in = EXCLUDED.esperado_in,
    esperado_out = EXCLUDED.esperado_out
WHERE planificacion_diaria.modificado_manualmente = FALSE;
```

### 3.3 Atomic Clock-In Flow
When a request arrives from the mobile app:

1. It passes Geofencing and `devices_clockin` validations (ADR-002).
2. It runs a single `UPDATE` on `planificacion_diaria`, targeting the user row for `CURRENT_DATE` where `real_in IS NULL`, ordered by the smallest time difference between `NOW()` and `esperado_in`.

This guarantees that clock-in is attached to the correct block (morning or afternoon).

### 3.4 Weekly Closing Processing
Instead of calculating overtime and time-off on demand, a weekly settlement process will run (e.g., Sundays at 23:59):

- 48-hour calculation: Sum `real_out - real_in` for the whole week. Any excess over 48 hours is transferred to an overtime report or added to `saldos_francos`.
- Consumed time-off: Rows with `reason = 'Franco'` validate execution and update consumption in `saldos_francos`.

## 4. Consequences (Trade-offs)
### Advantages (Pros)
- O(1) queries for the app: The mobile client gets current status directly from `planificacion_diaria` without JOINs.
- Fault tolerance: If the cronjob service fails over a weekend, the system still has a 7-day preloaded buffer in the database, preventing operational interruptions.
- Historical immutability: If business unit shift rules change, past history remains unchanged because records are already materialized per day.
- Native support for split shifts: `bloque_id` allows flexible daily partitioning.

### Disadvantages (Cons)
- Data volume: It creates rows even for time-off days (with `esperado_in = NULL` and `reason = 'Franco'`), slightly increasing table size. This is mitigated with proper indexing.
- Cron maintenance: Infrastructure monitoring is required to ensure scheduled jobs run successfully.

## 5. Implementation Notes
All timestamps (`esperado_in`, `real_in`, etc.) must be stored in UTC format in the database. Conversion to local timezone (e.g., `America/Argentina/Cordoba`) must happen only in the presentation layer (Frontend/App) and in HR reports.

## 6. Migration Traceability Update (2026-04-27)
The following section documents effective schema changes found in `migrations/clock_in_system.sql` and `migrations/geofencing.sql`.

### 6.1 Changes Applied to Clock-In Tables
1. `turno_enum` type created with values: `Mañana`, `Tarde`, `Noche`, `Rotativo`.
2. `planificacion_diaria` created with:
    - `user_context_id`, `fecha`, `turno`.
    - Initial columns `esperado_in` and `esperado_out`.
    - `reason`, `modificado_manualmente`, and unique constraint on `(user_context_id, fecha, turno)`.
3. `planificacion_diaria` was later altered in the same migration:
    - `esperado_in` dropped.
    - `esperado_out` dropped.
    - `sede_id` added.
4. `scans` table created for scan audit (`user_context_id`, `created_at`, `latitud`, `longitud`).
5. `idempotency_records` table created with `idempotency_key` PK and index on `created_at`.
6. `saldos_francos` table created (`user_context_id` PK, `horas_disponibles`, `horas_consumidas`).
7. `devices_clockin` table created with unique device constraint on `device_id`.
8. `geofencing.sql` added `sedes` table and enforces `planificacion_diaria.sede_id` as FK to `sedes(id)`.

### 6.2 Current Notes About the Migration Script
1. `clock_in_system.sql` declares and then drops `planificacion_diaria.esperado_in` / `esperado_out` in the same script.
2. `devices_clockin` includes unique constraint definition in `CREATE TABLE` and a later `ALTER TABLE ... ADD CONSTRAINT` for the same logical rule.
3. `scans` table definition includes a trailing comma after `longitud`, which should be corrected before replaying from zero in a clean environment.

### 6.3 Alignment Status Against Service Layer
1. Clock-in scan validation code currently queries `planificacion_diaria` and expects `esperado_in` / `esperado_out` for IN/OUT decision logic.
2. Shift upsert/read/update code currently writes to and reads from `horarios` (not `planificacion_diaria`).
3. This indicates an active dual-model stage (`horarios` + `planificacion_diaria`) that should be explicitly maintained or consolidated.
