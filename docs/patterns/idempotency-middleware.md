# Pattern: Idempotency Middleware

## What this is
An opt-in Express middleware that deduplicates mutation requests (`POST`/`PUT`) carrying an
`X-Idempotency-Key` header. A centralized `idempotency_keys` table in PostgreSQL acts as the
single source of truth. Keys are **scoped per authenticated user** via the composite primary key
`(owner_key, idempotency_key)`, where `owner_key` is `req.user.userId`. The first request for a key
acquires a lock (`status = 'processing'`), runs the controller, and caches the final status code
and JSON body. A repeat of the same key *by the same user* replays the cached response without
re-running the controller. A second request that arrives while the first is still in flight gets
`409 Conflict`. If the controller fails, the lock is deleted so the client can safely retry.
Because keys are user-scoped, two different users may safely use the same key string with no
collision, replay, or cross-user data exposure.

## Usage
Attach it per-route, **after `auth`** and body parsing, before the controller. Auth must run first
so `req.user.userId` is populated — that value is the `owner_key` the lock is scoped by:

```ts
import { idempotency } from '../adapters/middlewares/idempotency';

router.post('/', idempotency, crearPedidoController);
router.put('/:id', idempotency, actualizarPedidoController);
```

The client sends a unique key per logical operation:

```
POST /newPedido
X-Idempotency-Key: 11111111-1111-1111-1111-111111111111
```

## Parameters
The middleware takes the standard Express `(req, res, next)` signature — no configuration.

| Input | Type | Description |
|---|---|---|
| `X-Idempotency-Key` header | string | Client-generated unique key (UUID recommended). Absent → request passes through unchanged. Only needs to be unique *per user*, not globally. |
| `req.user.userId` | number | Populated by `auth`; used as `owner_key` to scope the lock. Falls back to `'anonymous'` if the route has no auth (a single shared bucket — avoid). |

Layering:

| Layer | File | Responsibility |
|---|---|---|
| Middleware | `src/adapters/middlewares/idempotency.ts` | HTTP glue: header check, replay/409 short-circuit, response capture. |
| Service | `src/domain/services/idempotencyService.ts` | Decision logic returning `acquired` / `replay` / `conflict`; complete/fail. |
| Repo | `src/adapters/db/idempotencyRepo.ts` | SQL: atomic `INSERT ... ON CONFLICT DO NOTHING`, read, complete, delete. |

## Constraints
- **Keys are scoped to `req.user.userId`** (composite PK `(owner_key, idempotency_key)`). The
  middleware must be mounted **behind `auth`**; on an unauthenticated route `owner_key` collapses to
  `'anonymous'` and all such requests share one namespace (re-introducing the cross-user problem) —
  do not do this.
- **Only `POST` and `PUT`** are intercepted. Other methods (incl. `PATCH`, `DELETE`) pass through.
- **JSON responses only.** Capture wraps `res.json`. Controllers that respond via `res.send`
  with non-JSON payloads are not cached (the lock is still cleaned up on finish/close).
- **Replay returns the cached status code**, not a forced `200`. A request originally answered
  `201` replays as `201`. (Deviation from the "always 200" wording in the original spec — see
  `docs/DECISIONS.md`.)
- **In-flight duplicates get `409` immediately** — no polling/waiting. The client retries.
- **Only `2xx` responses are cached.** Any `>= 400` (or an aborted connection) deletes the lock
  so the operation is retriable. This means deterministic `4xx` validation errors are *not*
  memoized; a retry re-runs the controller.
- **TTL eviction** runs via `initIdempotencyKeysCleanupCron` (`src/utils/cronJobs.ts`, daily 4:30 AM),
  which calls `deleteExpiredKeys(72)` to purge any row older than 72h (completed or orphaned
  `processing`). This is the effective idempotency window: a key reused after 72h gets a fresh
  execution, not a replay. `created_at` is indexed to keep the purge cheap.
- The atomicity guarantee comes from the `idempotency_keys` PRIMARY KEY (unique index) plus
  `ON CONFLICT DO NOTHING` — no advisory locks or transactions are required for the check/lock.

## Example
The same successful order creation, with key scoping made explicit (all requests below are by
user 7 unless noted):

```
# Request A (first, user 7)
POST /newPedido          X-Idempotency-Key: abc
-> insert (owner=7, key=abc) wins (processing) -> controller runs -> 201 {id:42} -> completed

# Request B (same key, later, user 7)
POST /newPedido          X-Idempotency-Key: abc
-> insert (7, abc) conflicts -> row is completed -> 201 {id:42} replayed, controller NOT called

# Request C (same key, while A still running, user 7)
POST /newPedido          X-Idempotency-Key: abc
-> insert (7, abc) conflicts -> row is processing -> 409 Conflict

# Request D (SAME key string, different user 9)
POST /newPedido          X-Idempotency-Key: abc
-> insert (9, abc) wins -> controller runs normally; user 7's row is untouched and never exposed
```
