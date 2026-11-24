# ADR-003: SolicitudesActividades Testing Plan - Business Rules and DTO Contracts
Date: 2026-04-02
Status: Proposed
Deciders: Mateo Bernardi

## Context
The solicitudesActividades flow has been unified and now concentrates critical rules in the service layer:

- Date overlap validation.
- Request state and transition rules.
- Activity creation/update with availability validation.
- Soft delete for requests (creator) and request hiding for guests.
- Date-range queries for activities/licenses.

This flow requires a testing plan that prioritizes:

1. Business logic.
2. Payload contracts (input/output DTOs).
3. Visibility of what each intermediary service receives and returns.

## Decision
We adopt a layered testing strategy with primary focus on service unit tests.

1. The service layer is the layer under test.
2. Controllers and repositories are fully mocked.
3. Tests validate DTO contracts (input/output) and expected side effects.
4. Business validations are tested with positive, negative, and edge cases.

## Tools
- Jest.
- ts-jest.
- Module mocks (`jest.mock(...)`).

## Scope
## In Scope
- `src/domain/services/solicitudesActividadesServices.ts`
- DTOs used by those services:
  - `SolicitudDTO`
  - `SolicitudBitacoraDTO`
  - `SolicitudInfoDTO`
  - `CreateSolicitudResult`
  - `UpdateSolicitudResult`
  - `ActividadDTO`
  - `CreateActividadResult`
  - `UpdateActividadHorariosResult`
- Business rules and input/output contracts.

## Out of Scope
- Real integration with PostgreSQL.
- Route-level E2E tests with the full app.
- Real push notification delivery.

## Mocking Strategy
## Controllers (fully mocked)
- Their internal implementation is not evaluated in this phase.
- They are not part of service tests.

## Repositories (fully mocked)
- All adapters used by services are mocked:
  - `solicitudesRepo`
  - `actividadesRepo`
  - `licenciasRepo`
  - `usuariosRepo`
- Each test case explicitly defines `mockResolvedValue` / `mockRejectedValue` to control the scenario.

## Assertion Strategy
- Validate exact arguments sent to repositories.
- Validate service output DTOs.
- Validate business errors with expected messages.

## DTO Contract Matrix
## Solicitudes
1. `createSolicitudService`
- Input DTO: `SolicitudDTO`.
- Output DTO: `CreateSolicitudResult`.
- Expected contract:
  - `created=true` -> `solicitudId` with value, `rangosOcupados=[]`.
  - `created=false` -> `solicitudId=null`, `rangosOcupados.length > 0`.

2. `updateSolicitudService`
- Input DTO: `SolicitudBitacoraDTO`.
- Output DTO: `UpdateSolicitudResult`.
- Expected contract:
  - `updated=true` -> `rangosOcupados=[]`.
  - `updated=false` -> `rangosOcupados.length > 0` (when overlaps exist).

3. `cancelarSolicitudService`
- Input: `solicitudId`, `userContextId`.
- Output: `void`.
- Expected contract: only the creator can cancel and only in an allowed state.

4. `ocultarSolicitudDeInvitadoService`
- Input: `solicitudId`, `userContextId`.
- Output: `void`.
- Expected contract:
  - If repo confirms update -> success.
  - If repo returns `false` -> request not found/already hidden error.

## Actividades
1. `crearActividadService`
- Input DTO: `ActividadDTO` (without `actividad_id`).
- Output DTO: `CreateActividadResult`.
- Expected contract:
  - `created=true` -> `actividad` with data, `rangosOcupados=[]`.
  - `created=false` -> `actividad=null`, `rangosOcupados.length > 0`.

2. `actualizarHorariosActividadService`
- Input: `actividadId`, `userId`, `nuevaFechaInicio`, `nuevaFechaFin`.
- Output DTO: `UpdateActividadHorariosResult`.
- Expected contract:
  - `updated=true` -> `actividad` actualizada.
  - `updated=false` -> `actividad=null`, `rangosOcupados.length > 0`.

3. `getActividadesByUserService`
- Input: `userId`, `fechaInicio`, `fechaFin`.
- Output: `{ actividades, licencias }`.
- Expected contract:
  - Validates period (`fechaFin > fechaInicio`).
  - Delegates to repo with period filters.

## Business Rules Test Cases
## A. Availability and dates
1. Invalid dates in create/update/activity -> error.
2. Valid dates without overlaps -> successful operation.
3. Overlaps with request/activity/license -> response with `rangosOcupados`.
4. Correct exclusion of current entity (`solicitudIdExcluir` / `actividadIdExcluir`).

## B. Request transition rules
1. Guest cannot change state if current state is `EXPIRED`.
2. Guest cannot change state if already `ACCEPTED`/`REJECTED`.
3. Dates cannot be modified if any guest has a final state.
4. Modification acceptance is creator-only.

## C. Permission rules
1. Request cancellation is creator-only.
2. Activity schedule updates are host-only.
3. Request hiding applies only to row `id_solicitud + id_usuario_invitado`.

## D. Soft delete and visibility
1. Guest inbox does not return rows with `si.deleted_at IS NOT NULL`.
2. State/expiration operations ignore hidden guests.
3. Re-send reactivates hidden guest (`deleted_at = NULL`) when applicable.

## Service I/O Examples
## updateSolicitudService
Input:
```ts
{
  solicitud_id: 12,
  usuario_id: 33,
  estado: 'MODIFIED',
  fecha_inicio_nueva: new Date('2026-05-10T10:00:00Z'),
  fecha_fin_nueva: new Date('2026-05-10T11:00:00Z'),
  observacion: 'Mover por conflicto'
}
```

Output without conflict:
```ts
{ updated: true, rangosOcupados: [] }
```

Output with conflict:
```ts
{
  updated: false,
  rangosOcupados: [
    {
      usuario: 'First Lastname',
      tipo: 'actividad',
      desde: new Date('2026-05-10T10:30:00Z'),
      hasta: new Date('2026-05-10T11:30:00Z')
    }
  ]
}
```

## crearActividadService
Input:
```ts
{
  titulo: 'Weekly meeting',
  descripcion: 'Planning',
  fecha_inicio: new Date('2026-05-12T14:00:00Z'),
  fecha_fin: new Date('2026-05-12T15:00:00Z'),
  solicitud_id: 44
}
```

Output without conflict:
```ts
{ created: true, actividad: { id: 99, ... }, rangosOcupados: [] }
```

Output with conflict:
```ts
{ created: false, actividad: null, rangosOcupados: [...] }
```

## getActividadesByUserService
Input:
```ts
{
  userId: 33,
  fechaInicio: new Date('2026-05-01T00:00:00Z'),
  fechaFin: new Date('2026-05-31T23:59:59Z')
}
```

Output:
```ts
{
  actividades: [{ ...actividadConRol }],
  licencias: [{ ...licenciaAprobada }]
}
```

## Execution Plan
1. Normalize DTO fixtures for services (valid inputs and invalid variants).
2. Cover happy paths for each exported service.
3. Cover business error cases per rule.
4. Cover output contract cases (`created/updated`, `rangosOcupados`).
5. Cover permissions and soft delete (new guest hide flow).
6. Review coverage and ensure focus on critical services.

## Test Structure Proposal
- `src/__tests__/solicitudesActividades/services/createSolicitudService.test.ts`
- `src/__tests__/solicitudesActividades/services/updateSolicitudService.test.ts`
- `src/__tests__/solicitudesActividades/services/crearActividadService.test.ts`
- `src/__tests__/solicitudesActividades/services/actualizarHorariosActividadService.test.ts`
- `src/__tests__/solicitudesActividades/services/cancelarSolicitudService.test.ts`
- `src/__tests__/solicitudesActividades/services/ocultarSolicitudDeInvitadoService.test.ts`
- `src/__tests__/solicitudesActividades/services/getActividadesByUserService.test.ts`

## Pros
- Direct coverage of real business rules.
- DTO contracts verified where they matter most (services).
- Infrastructure isolation through full mocking.

## Cons
- Lower integration confidence if not complemented with E2E tests.
- Mock maintenance when adapters change.

## Alternatives Considered
| Alternative | Reason Rejected |
|---|---|
| Controller-focused as the main testing layer | Duplicates validations and does not cover all logic centralized in services. |
| Real DB integration tests as baseline | Higher execution cost and noise for business rule iteration. |
| Payload snapshots only | Does not validate business branches or rule behavior. |

## Consequences
### Positive
- Future business rule changes get fast and localized feedback.
- Input/output DTOs remain documented and validated by tests.

### Negative
- Requires discipline to keep fixtures/mocks aligned with current contracts.

### Constraints Introduced
- Every new service in solicitudesActividades must include DTO contract tests.
- Every new business rule must have at least one success case and one failure case.
- Controllers and repositories are not SUT in this ADR; they are fully mocked.