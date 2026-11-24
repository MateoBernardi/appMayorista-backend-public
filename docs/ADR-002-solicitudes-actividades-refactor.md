# ADR-002: SolicitudesActividades Refactor - DTO Contracts, Canonical Date Type, and Endpoint Unification
Date: 2026-04-02
Status: Accepted
Deciders: Mateo Bernardi

## Context
The solicitudesActividades module currently has split endpoints and responsibilities that increase frontend and backend complexity:

- Date validation exists as a dedicated endpoint.
- Date handling is not standardized end to end.
- Functionally related operations are spread across multiple endpoints.
- Calendar activity loading requires multiple requests to cover broader time windows.

In addition, the team needs stable CRUD contracts for requests, using DTOs in controllers and services to reduce payload ambiguity.

## Decision
We adopt the following architecture direction for solicitudesActividades:

1. Request controllers must operate with typed objects using established CRUD DTOs.
2. Dates must be handled strictly as Date objects in backend code:
- They arrive as strings.
- They are converted once at input boundaries.
- They are transported and processed as Date objects in services/adapters.
3. validarFechas is removed as a dedicated endpoint and becomes an internal service validation.
4. updateFechas, aceptarSolicitud, and rechazarSolicitud are unified into a single operation: updateSolicitud.
5. getActividades moves to a range-based query:
- GET /api/actividades?start=2026-03-29T00:00:00Z&end=2026-05-02T23:59:59Z
- The client requests one month before and one month after the current month.
6. A new endpoint is introduced to hide requests, with persistent database support.

## Tools
- Node.js + TypeScript.
- Express.
- PostgreSQL.

## Libraries In Use
Main dependencies involved in this refactor:

- express
- pg

## APIs Used
## Current relevant state
Current module routes (before unification):

- POST /solicitudes/validar-fechas
- PUT /solicitudes/modificar-fechas
- PUT /solicitudes/invitados/estado
- GET /actividades/participantes/semanales

## Target state
Target contracts introduced by this ADR:

- PUT /api/solicitudes/:solicitudId
- Unified update for date changes, acceptance, and rejection through a DTO contract.

- GET /api/actividades?start=...&end=...
- Range query to cover previous month + current month + next month.

- PATCH /api/solicitudes/:solicitudId/ocultar
- Hides a request to keep inboxes clean and improve filtering.

## Controllers: DTO First
## Controller rule
- The controller receives req, normalizes payloads, and builds input DTOs.
- The controller must not pass contract-less objects to services.
- The service layer operates on typed DTOs and encapsulates business validations.

## Requests CRUD
- Create: creation DTO.
- Read: filter/query DTO.
- Update: a single DTO for state transitions and date changes.
- Delete/Logical Hide: hide DTO (without physical deletion).

## Dates
## Date standard
- All domain dates are Date objects in backend code.
- String to Date conversion happens at the input boundary (controller).
- Re-conversion of Date in internal layers is not allowed, except output serialization.

## Trade-off
- Requires technical discipline to use Date correctly.
- Benefit: full normalization of time handling to a single type.

## Validations
## Main change
- The dedicated date-validation endpoint is removed.
- Range/overlap validation is integrated into create/update service flows.

## Trade-off
- Requires more service-layer programming.
- Benefit: fewer client round-trips and less coupling to preflight validations.

## Update Unification
## Main change
- updateFechas, aceptarSolicitud, and rechazarSolicitud converge into updateSolicitud.
- The action is defined by DTO contract (update type + required fields).

## Trade-off
- Service rules become more complex.
- Benefit: clearer controller behavior, consistent contracts, and uniform request responsibility.

## Activity Range Query
## Main change
- Weekly reads are replaced by parameterized start/end queries.
- Frontend requests a 3-month window (previous, current, next).

## Trade-off
- Larger initial payload.
- Benefit: fewer requests, better calendar UX, and lower perceived latency.

## Hide Requests
## Main change
- New endpoint for logical request hiding.
- Requires a new field in solicitudes table (for example, visibility/hidden flag).

## Trade-off
- Introduces schema and filtering-logic changes.
- Benefit: cleaner inbox and faster query filtering for visible requests.

## Pros
- Consistent DTO contracts across full CRUD.
- Fewer endpoints and less responsibility fragmentation.
- Fewer client-backend calls for validation and calendar refresh.
- Unified and more predictable date model.

## Cons
- Higher service complexity due to centralized rules.
- Client migration required toward new contracts.
- Increased initial payload for range-based activity queries.
- Database migration required to support hiding.

## Alternatives Considered
| Alternative | Reason Rejected |
|---|---|
| Keep validarFechas as a separate endpoint | Duplicates flow, adds round-trips, and scatters business rules. |
| Keep separate update endpoints | Fragments contracts and hurts functional consistency of update behavior. |
| Keep weekly activity query | Forces more requests and degrades calendar navigation UX. |
| Do not add request hiding | Preserves inbox noise and increases client-side filtering cost. |

## Consequences
### Positive
- More coherent API for maintenance and evolution.
- Better UX due to fewer requests in common user flows.
- Lower temporal ambiguity by using Date as canonical type.

### Negative
- Cross-cutting refactor across controllers, services, and tests.
- Extra care needed for initial date parsing and timezone validation.
- Possible temporary client impact during migration period.

### Constraints Introduced
- Every date input must be parsed to Date exactly once in controllers.
- Request services must consume DTOs, not ad-hoc payloads.
- updateSolicitud must cover transitions previously distributed across separate endpoints.
- getActividades requires valid start and end parameters.
- Hidden state must be persisted and respected in read queries.

## Unchanged Areas
Aspects that explicitly remain unchanged:

- Layered architecture controller -> service -> repo.
- Express as HTTP framework and TypeScript for typed contracts.
- General HTTP response policy and module-level error handling.
- Business flows not impacted by update/dates/activity reads/hiding.