ADR-004: File Open Tracking Table (archivo_aperturas)
Date: 2026-04-09
Status: Accepted
Lab: Documents
Deciders: Backend squad

## Context
The system must satisfy two critical user experience needs:

- Traceability for file owners: allow each file owner to know which specific users have already accessed the content.
- Novelty indicators (badges): show each user which documents are still "new" or not yet explored.

Existing permission tables (archivos_visibilidad_usuario) are responsible for access control (who can view), but not for consumption events (who already opened/read). Mixing these concerns in current permission tables would violate single-responsibility boundaries and increase permission-management complexity.

The system is already in production, so the solution must avoid backend exception-heavy paths and database locking risks.

## Decision
Implement a dedicated join table for read/open tracking.

Data structure:
- Create table archivo_aperturas with:
  - archivo_id: file identifier (foreign key).
  - usuario_id: user identifier that opens the file (foreign key).
  - creado_en: timestamp of the first open/read event.

Integrity and performance:
- Composite unique constraint on (archivo_id, usuario_id) to enforce exactly one record per user-file pair.
- Idempotent insert strategy that ignores duplicates at the database-engine level:
  - PostgreSQL/SQLite: ON CONFLICT DO NOTHING
  - MySQL: INSERT IGNORE

Business logic:
- Open tracking: attempt an insert into archivo_aperturas every time a user requests file download or file preview/view.
- Badge query: determine "Unread" status using a LEFT JOIN between visible files for the user and archivo_aperturas; if the joined row is NULL, the file is considered pending read/open.

## Alternatives Considered
| Alternative | Reason Rejected |
| --- | --- |
| Add read/open fields to archivos_visibilidad_usuario | Couples security permissions with consumption audit state and increases maintenance complexity. |
| Track reads in application memory/cache only | Volatile state; not reliable for persistent badges and ownership traceability. |
| Insert and handle duplicate errors with try/catch | Adds avoidable backend overhead under repeated opens and creates noisy error paths. |

## Consequences
### Positive:
- Permission logic remains decoupled from audit/read-tracking logic.
- Idempotent conflict-ignoring inserts minimize backend exception handling overhead and keep latency low.
- Lightweight, indexed table scales linearly with unique user-file interactions (50 users x N files).

### Negative:
- Incremental storage growth: one additional row per first unique user-file interaction.

### Constraints introduced:
- Open/read events must always attempt idempotent insertion on download/view requests.
- Badge computations depend on the visibility query plus LEFT JOIN against archivo_aperturas.
- Composite uniqueness on (archivo_id, usuario_id) must be preserved across environments.

## Pros
- Clean separation of concerns between authorization and read/open tracking.
- Efficient duplicate handling without exception-driven control flow.
- Straightforward unread-badge query semantics.

## Cons
- Additional table and index lifecycle to manage.
- Slightly more complex read paths due to tracking write + badge join query.

## Tools
- Relational database unique composite constraints
- SQL idempotent insert patterns
- LEFT JOIN unread-state query pattern

## APIs used
- SQL INSERT with conflict-ignore semantics:
  - PostgreSQL/SQLite: INSERT ... ON CONFLICT DO NOTHING
  - MySQL: INSERT IGNORE
- SQL SELECT with LEFT JOIN for unread badge status

## Libraries in use
- N/A (database-level pattern)
