# DECISIONS.md

Format:
```
## YYYY-MM-DD: [Short title]
- **Reason:** [Why this approach was chosen]
- **Rejected alternative:** [What else was considered and why it was discarded]
- **Constraint:** [Any limitation this decision imposes going forward]
```

---

## 2026-11-07: Planificación sin n8n: el backend lee la planilla y las reglas pasan a services TS
- **Reason:** n8n (servicio, Postgres y Redis en Railway) solo corría tres workflows (preview, confirmar, semanal) y su costo no se justificaba; además las reglas de planificación y de licencias sobre turnos vivían en PL/pgSQL (deuda del ADR-008). Ahora `lectorPlanillaGoogle` lee la planilla con una cuenta de servicio (scope `spreadsheets.readonly`, solo GET: la planilla nunca se modifica), las reglas son funciones puras testeadas con jest, los services orquestan la transacción y `initGeneracionSemanalCron` (domingo 01:00) genera la semana y avisa por mail al admin. La migración 083 elimina las funciones SQL; quedan `planificacion_ahora_ar`, `jornada_corrido_minutos`, `planificacion_fin_turno` y `planificacion_minutos_turno` para las consultas de agregación. Detalle en `docs/ADR-010-planificacion-sin-n8n.md`.
- **Rejected alternative:** Seguir con n8n o hacer que llame a endpoints del backend (mantiene la infraestructura); dejar las reglas en PL/pgSQL (tests manuales, migraciones por cada cambio).
- **Constraint:** Aplicar la 083 recién después del deploy y de desactivar el workflow semanal de n8n. El primer preview posterior al deploy dice `igualAlVigente = false` (el hash pasó de md5 a sha256). Una sola instancia del backend (el cron no tiene coordinación entre instancias; el advisory lock evita solapamientos con un publish).

---

## 2026-10-02: Horas trabajadas calculadas de noche según los scans
- **Reason:** Al dejar de escribir `horas_trabajadas` junto con los turnos (planilla/alta manual), sus lectores (horas semanales vs. objetivo, excedentes y extras del resumen que acredita francos) leían 0. Ahora el cron nocturno de las 23:30 (el que reporta ausencias) la calcula con un `UPDATE` inline e idempotente a partir de `marcado_in_at`/`marcado_out_at`: entrada desde `esperado_in` o desde la marca si llegó tarde (la llegada anticipada no suma) hasta la salida marcada (la salida tardía suma), entrada sin salida limitada al fin del turno, y horario corrido sin salida como jornada fija de 8 h (4 h si su objetivo es de medio tiempo, < 40 h; migración 078). Recalcula hoy y ayer, y corre antes del resumen del domingo 00:00. Detalle en ADR-008.
- **Rejected alternative:** Función SQL en una migración (agrega una dependencia de despliegue de DB para algo que el cron ya resuelve con un UPDATE); calcular al momento de marcar la salida (no cubre "sin salida" ni las salidas editadas); contar todo el turno programado cuando falta la salida (premia la llegada tarde).
- **Constraint:** Las horas de un día recién se ven después de las 23:30. Los turnos anteriores al despliegue necesitan un backfill único (ver ADR-008). El cálculo supone `marcado_*` y `esperado_*` en la misma hora local (DB en America/Argentina/Buenos_Aires).

---

## 2026-10-02: Planificación desde planilla con snapshot, funciones SQL y cola de notificaciones
- **Reason:** La planilla de Google Sheets es la fuente editable; cada publicación crea un snapshot (preview → confirmar) que se aplica de forma atómica con funciones SQL (`snapshot_previsualizar`, `snapshot_aplicar`, `generar_semana_desde_snapshot`), de modo que la regla de 2 h, las validaciones y la escritura viven en un solo lugar y n8n solo orquesta. Las notificaciones se encolan en la misma transacción (`notificaciones_pendientes`) y las despacha un worker; las corridas automáticas no notifican. Detalle en `docs/ADR-008-planificacion-por-planilla-snapshot-y-n8n.md`.
- **Rejected alternative:** Que la corrida semanal lea la planilla de Drive (se puede alterar sin control); SQL suelto dentro de los nodos de n8n (duplica lógica, no atómico); tabla de objetivos con `vigente_desde` (obliga a reescribir cuatro consultas).
- **Constraint:** `horas_trabajadas` ya no se escribe al cargar turnos: la calcula el cron nocturno según los scans (ver la entrada anterior). `horario_corrido` deja `esperado_out` en NULL y no es reversible. Mientras convivan el cron viejo y el workflow semanal, el semanal no debe activarse.

---

## 2026-06-05: Idempotency keys are scoped per authenticated user
- **Reason:** The `idempotency_keys` table uses a composite `PRIMARY KEY (owner_key, idempotency_key)` where `owner_key` is the authenticated `req.user.userId`, instead of keying on the client-supplied `idempotency_key` alone. A global key namespace let any caller who presented a key already in use by another user either be blocked with `409` or — worse — **replay that other user's cached response body** (a cross-user data-exposure / IDOR vector), since keys are not guaranteed unique, unguessable, or even UUID-formatted. Scoping the lock by `owner_key` confines every key to its owner: two different users may now use the same string with no collision, replay, or interference. The composite PK still provides the single unique index used for the atomic `INSERT ... ON CONFLICT (owner_key, idempotency_key) DO NOTHING` lock.
- **Rejected alternative:** (1) Keep the single-column key and instead *enforce* a UUID format / minimum entropy on the header — rejected because it does not stop a malicious authenticated user from deliberately reusing a known key, and pushes a correctness guarantee onto client behaviour. (2) Namespace by concatenating `owner::key` into the existing single PK column — rejected as less explicit and prone to `VARCHAR(255)` overflow / delimiter ambiguity versus a dedicated column.
- **Constraint:** All idempotency-wrapped routes mount behind `auth(...)`, so `req.user.userId` is always present when the middleware runs; if the middleware is ever attached to a route **without** auth, `owner_key` falls back to the literal `'anonymous'`, collapsing those requests into one shared bucket — so do not mount `idempotency` on unauthenticated mutation routes without revisiting the scoping. Migration `029_create_idempotency_keys.sql` was amended in place (the table is new on this branch and unreleased) rather than adding a follow-up `ALTER`. TTL eviction (`deleteExpiredKeys(72)`) remains global and is unaffected.

## 2026-06-05: Idempotency replay returns the cached status code, caches only 2xx
- **Reason:** The idempotency middleware (`POST`/`PUT` + `X-Idempotency-Key`) replays the exact `response_code` stored at completion rather than a forced `200 OK`. A creation that answered `201` must replay as `201` so a retry is indistinguishable from the original — that is the point of idempotency. Only `2xx` responses are persisted as `completed`; any `>= 400` or aborted connection deletes the `processing` row so the operation is retriable. Atomicity of the check/lock comes from the `idempotency_keys` PRIMARY KEY (unique index) + `INSERT ... ON CONFLICT DO NOTHING` — no advisory lock or wrapping transaction needed.
- **Rejected alternative:** Always return `200` on replay (per the original task wording). Rejected because it loses the original semantics and would surprise clients that branch on status code. Also rejected: caching `4xx` validation failures — they are deterministic but memoizing them would permanently lock a key on what is usually a fixable client error, so retries re-run the controller instead.
- **Constraint:** Response capture wraps `res.json` only — controllers replying via `res.send` with non-JSON payloads are not cached (the lock is still cleaned up on `finish`/`close`). In-flight duplicates get `409` immediately (no polling). TTL eviction runs daily (4:30 AM) via `initIdempotencyKeysCleanupCron` → `deleteExpiredKeys(72)`, purging any row older than 72h regardless of status (also reaps `processing` locks orphaned by a crash); `idempotency_keys.created_at` is indexed for this. Tests follow the repo convention (service layer with mocked repo simulating the `23505`/`ON CONFLICT` no-row case, plus middleware tests with a hand-rolled `req`/`res`); the true-concurrency unique-index guarantee is not exercised against a live DB. Pattern documented in `docs/patterns/idempotency-middleware.md`.

## 2026-05-22: QR token validated in service layer, not SQL
- **Reason:** Validating `token` against `sedes.codigo_qr` in `receiveScan` (service) after fetching the planificacion allows a distinct error message (`'Token QR inválido.'`) separate from `'No se encontró planificación...'`. This makes the clock-in failure reason clear to the employee without an extra DB round-trip, since `getDataToCheckScan` already returns `codigoQr` in the planificacion result.
- **Rejected alternative:** Adding `AND s.codigo_qr = $6` directly to the SQL in `getDataToCheckScan`. Rejected because it collapses "no shift" and "wrong QR" into the same silent error, degrading UX without a meaningful security benefit in this context.
- **Constraint:** `getDataToCheckScan` must select `s.codigo_qr AS "codigoQr"` and `PlanificacionCheck` must include `codigoQr: string`. Both must stay in sync with any future `sedes` schema changes.

---

## 2026-05-23: HorariosDTO field names diverge from planificacion_diaria DB columns on the write path
- **Reason:** `HorariosDTO` is being renamed to match the file format the operator uploads (`horario_in`, `horario_out`). The DB column names (`esperado_in`, `esperado_out`) are read by ~10 SELECTs across `horariosRepo.ts` and projected into a separate `HorarioUsuarioDTO` that is NOT being renamed. Renaming the DB columns would force every read path to change at once for no operator-visible benefit. The mapping DTO-name → DB-column happens inside the write SQL (in `jsonb_to_recordset` declarations for `upsertHorarios`, in the `SET` clause for `updateShiftsManually`).
- **Rejected alternative:** Rename the DB columns to `horario_in` / `horario_out` for full symmetry. Rejected because the read-path blast radius (every SELECT, every consumer of `HorarioUsuarioDTO`, and all aplicarExclusion logic) is much larger than the write-path savings.
- **Constraint:** Future writers to `planificacion_diaria` must remember to map `horario_in`/`horario_out` (DTO) → `esperado_in`/`esperado_out` (column). Future readers continue to project DB columns straight into `HorarioUsuarioDTO`. Do NOT introduce a third name for these fields.

---

## 2026-05-23: planificacion_diaria.sede_id replaced by sede_id_in + sede_id_out (clean break, no transition shim)
- **Reason:** The shifts file format now carries two distinct sede references per shift (entry and exit). `HorariosDTO` was updated mid-refactor to expose both fields, but the parser still aliased a single column into both (and the DB had only one column). Splitting the column matches the operational reality without keeping a redundant `sede_id` around.
- **Rejected alternative:** Keep `sede_id` alongside the two new columns during a transition period. Rejected because this project does not maintain backwards-compatibility shims for internal schema; carrying three columns with overlapping meaning invites drift.
- **Constraint:** The migration in H-02 is destructive on the old `sede_id` column — backfill into both new columns happens in the same migration step. Any code reading `planificacion_diaria.sede_id` after this migration runs will break at query time.

## 2026-05-23: getDataToCheckScan joins sedes by branching on tipo_scan (IN → sede_id_in, OUT → sede_id_out)
- **Reason:** Employees may enter and exit at different physical locations. Joining unconditionally on either column would use the wrong geofence and QR for half of all scans.
- **Rejected alternative:** Always join on `sede_id_in`. Rejected because it would apply the entry-sede geofence and QR to OUT scans, silently allowing out-of-boundary exits.
- **Constraint:** The join must mirror the `tipo_scan` CASE already in the same query (`WHEN p.real_in IS NULL THEN 'IN' ELSE 'OUT'`). Implementation: `INNER JOIN sedes s ON s.id = CASE WHEN p.real_in IS NULL THEN p.sede_id_in ELSE p.sede_id_out END`. The GROUP BY clause already groups on `s.ubicacion`, `s.radio_permitido_metros`, `s.codigo_qr` — these remain valid since the join still produces exactly one sede row per shift.

---

## 2026-05-23: recepcion batch tests at the service layer only
- **Reason:** Parsers and controllers in the recepcion batch (R-01, R-02, R-03) are not directly covered by automated tests. The service is the layer under test; tests hand-build a DTO that matches the shape the parser produces and assert what the service forwards to a mocked repo. This validates the parser→service→DB contract end-to-end without exercising fs or HTTP wiring, and matches the strategy already documented in `docs/ADR-003-solicitudes-actividades-testing-plan.md`. Parser file-format quirks and controller plumbing are verified manually via the Runtime Signals in each task file.
- **Rejected alternative:** Fixture-based parser tests (real temp files + `fs.writeFileSync`) plus mocked controller tests. Rejected because they duplicate coverage already provided by service tests and runtime verification, and because the project's existing ADR explicitly pins the service as the test boundary.
- **Constraint:** Any future regression in parser file-format handling will not be caught by CI — only by runtime verification. The Runtime Signals in `recepcion-tasks.md` must be treated as mandatory rather than optional.

---

## 2026-05-23: procesarArticulosService returns repo-reported counts, not input array length
- **Reason:** Matches the existing contract of `procesarShiftsService` (which returns `upsertHorarios`'s result). The frontend's `totalInsertados` should reflect what the DB actually wrote, not what the parser sent in. This surfaces partial-write situations (no-op upserts when nothing changed) instead of masking them behind an input count.
- **Rejected alternative:** Return `articulos.length` (the count of parsed rows). Rejected because it lies to the operator when an upsert is a no-op (matching existing row), and because the divergence from `procesarShiftsService` would be a footgun for the next agent touching either service.
- **Constraint:** `upsertArticulo`, `upsertArticulos`, and `syncArticulos` change signature from `Promise<void>` to `Promise<number>`. Any future caller of `syncArticulos` must remember to use the return value (or explicitly discard with `void`). The `eliminarArticulosSinStock` cleanup chain does NOT contribute to the returned count — the contract is "rows inserted/updated by this sync run."

---

## 2026-07-02: `POST /clientes/import` CSV bulk import is atomic, ignores `provincia`, defaults `id_condicion_iva` to "Consumidor Final"
- **Reason:** The import endpoint parses a comma-delimited CSV of clientes and inserts them in a single DB transaction (`createClientesBulk`). Any row failing type/value validation (`clienteValidator`), required-field checks, email format, unknown `localidad`, or a `cuit`/`email` collision (within the file or against the DB) rejects the **entire file** with `AppError(400, 'Clientes inválidos: ' + JSON.stringify(errores))`, `errores` being `[{ fila, errores: [...] }]` (1-indexed over CSV data rows). Partial imports would leave the operator unable to tell which rows actually landed without re-diffing the DB, so all-or-nothing was chosen over a per-row best-effort insert. `clientes.id_condicion_iva` is `NOT NULL` with no DB default and the CSV does not carry a condición-IVA column, so the service resolves a default by looking up `condiciones_iva.descripcion ILIKE '%Consumidor Final%'` at import time (tolerating the `TEST_` seed prefix) rather than hardcoding an id that could drift from the seed data. The CSV's `provincia` column (index 5) is ignored entirely — clientes only store `id_localidad`, and `localidades` has no `provincia` column, so there is nowhere to persist it.
- **Rejected alternative:** (1) Best-effort insert valid rows and report failures for the rest — rejected because it complicates the operator's mental model ("did my file import or not?") and risks a half-imported client list with no telefono/email row for some clients. (2) Hardcode a numeric `id_condicion_iva` for "Consumidor Final" — rejected because seed IDs differ between environments (the test seed prefixes descriptions with `TEST_`), so a name-based `ILIKE` lookup is the only stable cross-environment reference. (3) Auto-create unknown `localidades` on the fly — rejected to keep the import strictly validating against existing reference data instead of silently growing it from typos in an uploaded file.
- **Constraint:** If `condiciones_iva` ever loses a row matching `%Consumidor Final%`, the import endpoint fails closed with `AppError(500)` rather than inserting with a null/garbage condición IVA. `localidades.nombre` matching is case-insensitive/trimmed but still exact — CSV rows must match an existing localidad name precisely (whitespace/casing aside) or the whole file is rejected. The CUIT normalization step (11 plain digits → `XX-XXXXXXXX-X`) happens in the parser before validation; anything else reaching `validarCUIT` in a different shape fails as invalid rather than being further coerced.

---

## 2026-10-03: saldo de francos puede ser negativo; GET de saldos por empleado para DetalleEmpleado
- **Reason:** El saldo de francos (`horas_disponibles − horas_consumidas`) es solo informativo y nunca bloquea solicitudes. Al aprobar un franco, `executeApprovalTransaction` ahora debita siempre el total (upsert sobre `saldos_francos`, creando la fila con `horas_disponibles = 0` si no existe) en lugar de acotarlo al saldo disponible. Se agregan `GET /licencias/saldos/:id/francos` y `GET /licencias/saldos/:id/vacaciones` (`managementRoles`) para las ventanas de francos y vacaciones del detalle de empleado. La lógica de vacaciones no cambia.
- **Rejected alternative:** Agregar un CHECK `>= 0` o clamp en la BD — contradice el requisito de que el saldo negativo sea informativo.
- **Constraint:** `liquidarHorasFranco` sigue rechazando (422) liquidar más que el saldo neto, por lo que con saldo negativo no se puede liquidar. El reintegro al cancelar usa el ledger y revierte el consumo completo.
