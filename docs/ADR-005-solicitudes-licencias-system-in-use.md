# ADR-005: SolicitudesLicencias System in Use - Workflow, Contracts, and Integration with SolicitudesActividades
Date: 2026-04-14
Status: Accepted
Deciders: Mateo Bernardi

## Context
The backend currently runs two related scheduling domains:

- `licencias` (leave requests and approvals).
- `solicitudes-actividades` (activity requests, invitations, and activity scheduling).

These domains are operationally coupled because activity availability checks must consider already approved leaves. The implementation uses a layered architecture (router -> controller -> service -> repository), enforces role-based permissions, and applies state transitions with transactional updates in PostgreSQL.

This ADR documents the system as implemented, including APIs, payload contracts, date handling rules, error strategy, and dependencies.

## Decision
We keep the current production architecture for SolicitudesLicencias and its integration with SolicitudesActividades:

1. Licencias are managed in a dedicated module under `/licencias`.
2. Availability checks in SolicitudesActividades include approved leaves by querying `licenciasRepo.findApprovedSolicitudesByDateRange`.
3. Date logic is validated and normalized in controllers/services and persisted as SQL timestamps.
4. State transitions are enforced in services and persisted with transactional repository operations.
5. Notifications are emitted asynchronously from controllers via `devicesService` after successful create/approve/reject/update actions.

## Tools
- Node.js + TypeScript.
- Express.
- PostgreSQL (`pg` + pooled clients).
- Jest + ts-jest for unit tests.

## Libraries In Use
Primary runtime/test libraries involved in these flows:

- `express`
- `pg`
- `jsonwebtoken` (auth context consumed by controllers)
- `expo-server-sdk` (push delivery via devices module)
- `firebase-admin` (web push via devices module)
- `node-cron` (expiration/notification support jobs in the codebase)
- `jest`
- `ts-jest`

## APIs Used
## Route mounting
- `app.use('/solicitudes-actividades', auth(allRoles), SolicitudesActividadesRouter)`
- `app.use('/licencias', auth(allRoles), licenciasRouter)`

## SolicitudesActividades HTTP API
- `POST /solicitudes-actividades/solicitudes`
- `GET /solicitudes-actividades/solicitudes/invitados`
- `PUT /solicitudes-actividades/solicitudes/update`
- `POST /solicitudes-actividades/solicitudes/reenviar`
- `GET /solicitudes-actividades/solicitudes/creador`
- `POST /solicitudes-actividades/solicitudes/cancelar`
- `POST /solicitudes-actividades/solicitudes/ocultar-invitado`
- `GET /solicitudes-actividades/solicitudes/bitacora/:solicitudId`
- `POST /solicitudes-actividades/actividades/participantes`
- `GET /solicitudes-actividades/actividades/:actividadId`
- `PUT /solicitudes-actividades/actividades/cancelar`
- `PUT /solicitudes-actividades/actividades/crear`
- `PUT /solicitudes-actividades/actividades/actualizar-horarios`

## SolicitudesLicencias HTTP API
- `GET /licencias/tipos`
- `GET /licencias/saldos`
- `GET /licencias/solicitudes` (management roles)
- `GET /licencias/solicitudes/usuario`
- `POST /licencias/solicitudes`
- `POST /licencias/solicitudes/:id/archivo`
- `POST /licencias/solicitudes/:id/cancelar`
- `POST /licencias/solicitudes/:id/aprobar` (gerencia/encargado/consejo)
- `POST /licencias/solicitudes/:id/rechazar` (gerencia/encargado/consejo)

## Internal cross-module API (service level)
SolicitudesActividades validates collisions against approved leaves through:

- `licenciasRepo.findApprovedSolicitudesByDateRange(userId, fechaInicio, fechaFin)`

This call is part of `validarDisponibilidadFechas(...)` in `solicitudesActividadesServices` and contributes `RangoOcupado` entries with `tipo: 'licencia'`.

## Payloads
## SolicitudesActividades payloads
### Create solicitud (`POST /solicitudes-actividades/solicitudes`)
Input (controller-normalized to `SolicitudDTO`):

```ts
{
  titulo: string;
  descripcion: string;
  tipo_actividad: string; // e.g. REUNION | MANDATO
  fecha_inicio: string | null; // converted to Date
  fecha_fin: string | null;    // converted to Date
  invitados: number[];
  crear_de_todos_modos: number;
}
```

Success output:

```ts
{ success: true, solicitudId: number }
```

Conflict output (availability overlap):

```ts
{
  success: false,
  message: 'Hay compromisos que se solapan para uno o mas participantes.',
  rangosOcupados: Array<{
    usuario: string;
    tipo: 'solicitud' | 'actividad' | 'licencia';
    desde: Date;
    hasta: Date;
  }>;
}
```

### Update solicitud (`PUT /solicitudes-actividades/solicitudes/update`)
Input (`SolicitudBitacoraDTO`):

```ts
{
  solicitud_id: number;
  estado: string;
  fecha_inicio_nueva?: Date;
  fecha_fin_nueva?: Date;
  observacion?: string;
}
```

Output:
- `{ success: true, message: 'Solicitud actualizada exitosamente.' }`
- or overlap response with `rangosOcupados`.

### Activities by user period (`POST /solicitudes-actividades/actividades/participantes`)
Input supports body/query keys:

```ts
{
  fechaInicio: string; // parsed as Date
  fechaFin: string;    // parsed as Date
}
```

Output:

```ts
{
  actividades: ActividadDTO[];
  licencias: LicenciaDTO[]; // approved leaves in same period
}
```

## SolicitudesLicencias payloads
### Create leave request (`POST /licencias/solicitudes`)
Input (`CreateSolicitudDTO`):

```ts
{
  tipo_licencia_id: number;
  fecha_inicio: string; // converted to Date
  cantidad_dias?: number;   // mutually exclusive with cantidad_horas
  cantidad_horas?: number;  // mutually exclusive with cantidad_dias
  observacion?: string;
}
```

Output: created `SolicitudAusenciaDTO` row.

### Approve / reject
- `POST /licencias/solicitudes/:id/aprobar`

```ts
{ observacion?: string }
```

- `POST /licencias/solicitudes/:id/rechazar`

```ts
{ observacion: string }
```

Output:
- `{"message":"Solicitud aprobada correctamente."}`
- `{"message":"Solicitud rechazada correctamente"}`

## Notification payloads (shared)
Both domains send push payloads with unified cache metadata:

```ts
{
  title: string;
  body: string;
  link: string;
  data: {
    type: string;
    domain: 'solicitudesActividades' | 'licencias';
    event: 'created' | 'updated' | 'status_changed';
    updated_at: string; // ISO
    entity_id: string;
    solicitud_id?: number;
    actividad_id?: number;
  };
}
```

## Date Management
## Canonical behavior
- Controllers parse incoming date strings once (`new Date(...)`) and pass Date objects to services.
- Services enforce chronological rules:
  - end > start when both exist.
  - no past-dated create/update for active scheduling operations.
  - period filters require valid ranges (`fechaFin > fechaInicio`).
- Repositories apply overlap checks using SQL interval predicates:
  - `(fecha_inicio <= end AND fecha_fin >= start)`.

## Expiration policies
### SolicitudesActividades
- Expirable guest states: `SENT`, `SEEN`, `MODIFIED`, `MODIFIED_BY_HOST`.
- Expiration runs in repo helpers before several reads/writes and writes bitacora state `EXPIRED`.

### SolicitudesLicencias
- Expirable states: `PENDIENTE`, `PENDIENTE_DOCUMENTACION`, `PENDIENTE_APROBACION`.
- Expiration updates leave request state to `EXPIRADA` when `fecha_inicio <= NOW()`.

## Duration and balance logic in Licencias
- `fecha_fin` is derived from `fecha_inicio + cantidad_dias` or `cantidad_horas`.
- Fractional values are accepted only in 0.5 increments.
- Storage uses decimas (`*10`) for `cantidad_dias` and `cantidad_horas`.
- Approval/cancellation use transactional saldo and residuo updates with rollback-safe fields (`residuo_al_aprobar`).

## Error Handling
## HTTP boundary
- Controllers return:
  - `401` for missing auth context.
  - `400` for invalid payload/date/filter combinations.
  - `404` for missing resource identifiers.
  - `500` for unhandled/internal failures.

## Business-rule errors
Services throw explicit errors for:
- invalid state transitions.
- insufficient role hierarchy for approve/reject in Licencias.
- overlap conflicts and invalid periods.
- permission violations (creator/host/invited constraints).
- missing required attachments for leave types that require documentation.

## Transactional consistency
Repository operations that affect multiple tables/state are transactional:
- request creation + invite rows.
- solicitud update + bitacora.
- activity creation + participants.
- leave approval and cancellation (saldo/residuo + status updates).

## Async notification resilience
Notifications are sent after HTTP success using fire-and-forget patterns; notification failures are logged and do not roll back the business transaction.

## Pros
- Clear separation of concerns (controllers/services/repositories).
- Cross-domain availability validation prevents scheduling activities during approved leaves.
- Strong role and ownership enforcement for sensitive operations.
- Transactional handling of leave balances reduces inconsistency risk.
- Unified notification payload contract across modules.
- Soft-delete/hide patterns preserve historical traceability.

## Cons
- Business rule complexity is concentrated in services, increasing maintenance effort.
- Several controller-level endpoints use non-RESTful verbs/paths (`/update`, `/cancelar`, `/crear`).
- Some error mappings are broad (`500`) where finer status codes could improve API clarity.
- Date handling relies on `Date` parsing and server timezone behavior if clients send ambiguous strings.
- Notification dispatch is eventually consistent (best effort), not part of ACID business transactions.

## Alternatives Considered
| Alternative | Reason Rejected |
|---|---|
| Decouple activity availability from approved leaves | Would allow inconsistent agendas and user conflicts. |
| Persist date/time as strings end-to-end | Increases ambiguity and weakens overlap validations. |
| Enforce synchronous notification success before HTTP response | Adds latency and external provider coupling to core business operations. |
| Keep saldo update outside approval/cancellation transactions | Raises risk of partial updates and accounting mismatch. |

## Consequences
### Positive
- The active implementation preserves schedule integrity across activities and leave requests.
- Leave approvals/rejections/cancellations are auditable and constrained by hierarchy.
- The frontend receives conflict details (`rangosOcupados`) to drive informed user decisions.

### Negative
- Rules and states are numerous, requiring strong test coverage and onboarding documentation.
- Any change in leave-state semantics can affect scheduling behavior in another module.

### Constraints Introduced
- SolicitudesActividades availability checks must continue including approved leaves.
- Licencias approval/rejection must enforce role hierarchy (`id_rol` ordering).
- Date overlap semantics must stay consistent between SQL and service-layer validations.
- Fractional durations in Licencias must remain aligned with decimas storage strategy.
