# ADR-006: Evolution to a Ticket System and Kanban Boards (Personal and Shared)
Date: 2026-04-30
Status: Accepted
Deciders: Mateo Bernardi

## Context
The system currently has separate entities for:

- Requests (user petitions).
- Activities (calendar events).
- Objectives (goals).

The company needs a ticket system where requests can be picked up by a user or a team and then moved into a Kanban-style activity board.

The main challenge is to separate the concept of the "petition" (Ticket) from the "execution" (Task/Kanban), while supporting personal and shared boards without mixing data and enabling dynamic assignment of responsible users and observers.

## Decision
We will evolve the current schema without breaking the base structure, introducing changes in the database and business logic.

### 2.1 Solicitudes as a Ticket System
The `solicitudes` table will act as the inbox or "Help Desk". It stores the original request. Once a request is approved or taken through `solicitudes_bitacora`, an objective can be generated from it.

### 2.2 Objetivos as Kanban Cards
The `objetivos` table will represent the cards inside the Kanban board.

- Traceability: Add `solicitud_id` (nullable, FK) to `objetivos` to keep a direct link to the originating ticket.
- Ordering: Use the existing `rank_position` and `estado` fields to place the card in the correct column and preserve visual order after Drag & Drop events.

### 2.3 New Table: objetivos_usuarios
To manage participants inherited from the request and newly assigned users, we will create a dedicated pivot table `objetivos_usuarios` instead of using the general polymorphic table.

Table structure:

- `objetivo_id` (FK)
- `usuario_id` (FK)
- `rol` (enum: `ASSIGNEE`, `VISUALIZER`)

Business rules:

- Multi-assignment: The same `objetivo_id` can have multiple `ASSIGNEE` records at the same time.
- Automatic transfer: When an objective is created from a request, the creator or assigned owner enters as `ASSIGNEE`. The rest of `solicitudes_invitados` are migrated as `VISUALIZER`.
- Reassignment: Changing the responsible user updates the current owner to `VISUALIZER` and creates (or updates) a new `ASSIGNEE` record for the new owner.

### 2.4 Board Differentiation (Personal vs. Shared)
No additional data structures are required; separation is done at query time:

- Personal board: List `objetivos` filtered by an INNER JOIN on `objetivos_usuarios` where `usuario_id = {CurrentUser}` and `rol = 'ASSIGNEE'`.
- Shared board: List `objetivos` associated with the team/work context, rendering multiple avatars on the frontend when there are multiple `ASSIGNEE` users.

## Consequences
### Positive
- Minimal structural impact: Reuse existing core tables (`solicitudes`, `objetivos`, `solicitudes_bitacora`).
- Ownership flexibility: Role-based assignment allows "passing the ball" without losing historical visibility of who was involved.
- Collaborative scalability: Native support for multiple assignees improves teamwork.
- Efficient queries: Board separation is achieved with direct, index-friendly queries on the new pivot table.

### Negative / Considerations
- State synchronization: Because a card appears in multiple personal boards when there are multiple assignees, the frontend must handle real-time updates (or refetching). If one user moves a card to "Completed", the change must reflect in other users' views.
- More complex endpoints: Update endpoints (`PUT`/`PATCH` on `objetivos`) must handle user arrays to insert, update, or remove specific records in `objetivos_usuarios` instead of a single `asignado_id` field.
