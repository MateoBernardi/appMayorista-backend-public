# Project Progress

## Current Session
- Role: Coder
- WIP Task: none — R-01, R-02, R-03 implemented and syntax-verified; migration file generated; session ending

---

## Current State
- Latest commit: 39994c41 (chore: session handoff — recepcion planning batch + horarios task updates)
- Working tree: uncommitted changes present (see Exit Note below)
- `npx tsc --noEmit`: clean
- Tests (touched suites): `horarios/domain` 4/4, `articulos/domain` 15/15, `articulos/controllers` 5/5 — all green
- Pre-existing failing suites (unrelated to this session): `solicitudesActividades/domain`, `auth/domain`, `archivos/domain`, `archivos/controllers`, `licencias/*`, `REPORTE_COBERTURA_TESTS` — none introduced by this work

**Exit Note:** Changes from this session are uncommitted. The tree also carries pre-existing uncommitted changes to `CLAUDE.md`, `README.md`, `docs/horarios.MD` (not authored by this session). Owner should review those separately before staging.

---

## Completed

- H-01: Mounted `horariosRouter` in `app.ts`; fixed `req.originalUrl` → `req.path` in `recepcionController`; added default export to `horariosRoutes.ts`
- H-02: Fixed `jsonb_to_recordset` column name `idEmpleado` → `userContextId` in `upsertHorarios`
- H-03: Rewrote `updateShiftController` to pass `HorariosDTO`; added `AND turno = CAST($5 AS turno_enum)` filter to `updateShiftsManually`
- H-04: Added `token` to `ScanDTO`; added `codigoQr` to `PlanificacionCheck`; added `s.codigo_qr` to `getDataToCheckScan` SELECT + GROUP BY; added QR token check in `receiveScan`; wired `scanController` to `receiveScan`; created migration `add_codigo_qr_to_sedes.sql`
- H-05: Fixed `LEFT JOIN solicitudes` → `solicitudes_ausencia` and `'aprobada'` → `'APROBADA'` in `getDataToCheckScan`
- H-06: Propagated `fechaInicio`/`fechaFin` query params through `getShiftsController` and `getShiftsByUserController`

### Planning batch — 2026-05-23 (Planner session)
- Created `docs/tasks/recepcion-tasks.md` — three sequential tasks (R-01 → R-02 → R-03)
- Extended **H-02** and **H-03** in `docs/tasks/horarios-tasks.md` to absorb the new `HorariosDTO` shape

### Coder session — 2026-05-23
- **R-01**: Renamed `HorariosDTO` fields `entrada`/`salida` → `horario_in`/`horario_out`; rewrote `procesarArchivoShifts` as pure `(filePath) => Promise<HorariosDTO[]>` with 8-column parse, no header skip, distinct `sede_id_in`/`sede_id_out`; updated call site in `recepcionController`; propagated rename to `horariosControllers.ts` and `horariosRepo.ts` (minimum to keep tsc clean — H-03 will complete the business logic); created `src/__tests__/horarios/domain.test.ts` (4 cases, green)
- **R-02**: Rewrote `sincronizarArticulos.ts` as pure streaming `(filePath) => Promise<ArticuloDTO[]>` with `readline`, no `any`, no HTTP concerns; changed `upsertArticulo` → `Promise<number>` (`rowCount ?? 0`); changed `upsertArticulos`/`syncArticulos` → `Promise<number>` (upsert sum only, cleanup chain excluded); added `procesarArticulosService`; appended 7 new cases to `src/__tests__/articulos/domain.test.ts` (all green)
- **R-03**: Deleted `recepcionExcelController`, `limpiarDirectorioUploadsAsync`, `syncArticulosController`; consolidated `recepcionController` to handle both `/upload-shifts` and `/recepcion-excel`; repointed `sincronizarArticulosRoutes` to `recepcionController`; removed `syncArticulosController` describe block from `articulos/controllers.test.ts`
- **Migration**: Created `migrations/refactor_planificacion_diaria_sede_columns.sql` — adds `sede_id_in`/`sede_id_out`, backfills from `sede_id`, drops `sede_id`

---

## In Progress
*(none)*

---

## Known Issues

| # | Location | Description |
|---|----------|-------------|
| 1 | `src/adapters/db/horariosRepo.ts` — `upsertHorarios` | `jsonb_to_recordset` still declares `entrada`/`salida` as JSON keys; after R-01 the DTO emits `horario_in`/`horario_out` — inserts will land NULL for time fields until H-02 code changes land. |
| 2 | `src/adapters/db/horariosRepo.ts` — `upsertHorarios` | `jsonb_to_recordset` still declares `idEmpleado`; JSON key is `userContextId` — inserts NULL for `user_context_id`. Carried from before this session; fixed in H-02. |
| 3 | `src/adapters/db/horariosRepo.ts` — `insertWeeklyPlanning` (lines 372–393) | Still inserts/updates `sede_id` column. Will fail at runtime after the migration drops `sede_id`. Must be updated in H-02 before the migration is applied. |
| 4 | `src/adapters/db/horariosRepo.ts` — `getDataToCheckScan` (line 196) | `INNER JOIN sedes s ON p.sede_id = s.id` will fail after migration drops `sede_id`. H-02 must replace with `ON s.id = CASE WHEN p.real_in IS NULL THEN p.sede_id_in ELSE p.sede_id_out END` (branches by tipo_scan — decided 2026-05-23, see DECISIONS.md). |
| 5 | `src/controllers/horariosControllers.ts` — `updateShiftController` | `sede_id_in: 0, sede_id_out: 0` are placeholder values; `req.body` not yet destructured for `sede_id_in`/`sede_id_out`. H-03 will complete this. |
| 6 | `src/domain/services/horariosServices.ts` | `console.error` in `procesarShiftsService` and `calcularResumenSemanalService`/`generateWeeklyPlanning`; `console.log` in `receiveScan` path. No-console rule violation; low priority. |
| 7 | `sedes` table | No `codigo_qr` column until `migrations/add_codigo_qr_to_sedes.sql` is applied. QR token validation (`receiveScan`) will fail at runtime. |

---

## Next Steps

1. **Apply migrations** (in order):
   - `migrations/add_codigo_qr_to_sedes.sql` (needed for H-04 runtime)
   - **Do NOT apply** `migrations/refactor_planificacion_diaria_sede_columns.sql` until H-02 code changes land in `horariosRepo.ts` — `insertWeeklyPlanning` and `getDataToCheckScan` still reference the `sede_id` column and will break at runtime the moment it is dropped.
2. **H-02 code changes** (`horariosRepo.ts` — `upsertHorarios`): fix `jsonb_to_recordset` JSON key names (`idEmpleado` → `userContextId`, `entrada`/`salida` → `horario_in`/`horario_out`); add `sede_id_in`/`sede_id_out` to the recordset and INSERT; update `insertWeeklyPlanning` and `getDataToCheckScan` to use new column names. Then apply the migration.
3. **H-03 code changes** (`horariosControllers.ts`, `horariosRepo.ts`): properly destructure `sede_id_in`/`sede_id_out` from `req.body` in `updateShiftController`; update `updateShiftsManually` SET clause to write `sede_id_in`/`sede_id_out`.
4. **Runtime verification** of R-01 runtime signals (upload-shifts with 3-row file → 3 rows inserted; first-row fix confirmed) — blocked until H-02 lands.
5. **Runtime verification** of R-02/R-03 runtime signals (`POST /recepcion-excel` returns `200 { success, totalInsertados }`).
6. ~~Open question resolved~~ `getDataToCheckScan` sede join: `ON s.id = CASE WHEN p.real_in IS NULL THEN p.sede_id_in ELSE p.sede_id_out END` — decided 2026-05-23.

---

## Quality

### recepcion-tasks.md (Quality: A) — planner artifact
- Verification passing: N/A
- Agent understandable: Yes
- Test stability: N/A
- Architecture boundaries: Compliant
- Code conventions: Followed

### horarios-tasks.md (Quality: B) — H-02 and H-03 expanded
- Verification passing: N/A
- Agent understandable: Yes
- Test stability: N/A
- Architecture boundaries: Compliant
- Code conventions: Followed
- B grade rationale: open question on `getDataToCheckScan` sede join — now resolved (branch by tipo_scan, 2026-05-23); grade can be upgraded to A when H-02 is coded.

### procesarArchivoShifts / HorariosDTO (Quality: A) — R-01
- Verification passing: Syntax ✓ / Runtime pending (blocked on H-02)
- Agent understandable: Yes — pure function, typed DTO, no HTTP concerns
- Test stability: Stable — 4/4 green, service-layer only
- Architecture boundaries: Compliant — adapter produces DTO, service owns DB call
- Code conventions: Followed

### sincronizarArticulos / articulosServices / articulosRepo (Quality: A) — R-02
- Verification passing: Syntax ✓ / Runtime pending (R-03 controller wiring complete, needs end-to-end test)
- Agent understandable: Yes — pure streaming parser, service returns repo-reported count
- Test stability: Stable — 15/15 green (7 new cases)
- Architecture boundaries: Compliant
- Code conventions: Followed — no `any`, exact coercion semantics preserved

### recepcionController / sincronizarArticulosRoutes / articulosController (Quality: A) — R-03
- Verification passing: Syntax ✓ / Runtime pending
- Agent understandable: Yes — single controller, two route branches, single `finally` unlink
- Test stability: Stable — dead test block removed, suite still green
- Architecture boundaries: Compliant — no per-route auth, no bulk cleanup
- Code conventions: Followed
