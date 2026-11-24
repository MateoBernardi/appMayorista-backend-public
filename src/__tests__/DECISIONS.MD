# DECISIONS.MD — Test Engineer Session

## 2026-05-27: Domain test boundary is src/domain/services/

The prompt says "explore the /domain folder". The project has no top-level `/domain` dir; the
domain layer lives at `src/domain/`. All files under `src/domain/services/` were treated as
modules requiring a dedicated test suite.

## 2026-05-27: Existing web/domain.test.ts is preserved, not split

`src/__tests__/web/domain.test.ts` bundles four web-service modules into one suite
(suscripciones, articulosPublic, articulosImagenes, images). The instruction says "one file per
domain module", but also "preserve existing tests that already conform to AGENTS.MD standards".
That file conforms to AGENTS.MD (jest.mock at top, beforeEach reset, no shared state). Decision:
preserve it and create no duplicate files for those four web modules.

## 2026-05-27: crearPedidoService has a latent bug — datosPedido/pagoValido checks are no-ops

In `crearPedidoService.ts`:
```ts
if (!datosPedido(pedidoData)) { ... }
```
`datosPedido` is async and returns a Promise, which is always truthy. The condition is never
true regardless of the input. The same applies to the `pagoValido` check. Tests reflect actual
behavior (no error thrown for invalid pedidoData via those specific guards). The only guard
that actually fires is `!Array.isArray(articulosPedido)`. This is noted here, not silently
corrected.

## 2026-05-27: LexoRank is not mocked in kanban tests

LexoRank is a pure computation library with no I/O. Letting it run as-is in unit tests is safe
and keeps the tests simpler. kanbanRepo functions that return rank strings are mocked; LexoRank
operates on those strings.

## 2026-05-27: detallePedidoValidator.validateData must return [] in beforeEach

Auto-mocking the validations module sets all methods to jest.fn() returning undefined. The
service calls `errores.length` on the return value, which throws if undefined. Every test that
exercises validarArticulosParaPedido configures the mock to return [] before calling the service.

## 2026-05-27: dynamic import in detallePedidosServices is intercepted by jest.mock()

The service uses `await import('../../adapters/db/articulosRepo')` inside
`validarArticulosParaPedido`. Top-level `jest.mock('../../adapters/db/articulosRepo')` in the
test file intercepts both static and dynamic imports because Jest replaces the module in the
shared module registry before any code runs.

## 2026-05-27: verificationToken argon2 mock — hash returns plain string

argon2.hash is mocked to return a plain string (not a real Argon2 hash). Tests verify that the
return value from the mock is forwarded to the repo unchanged. argon2.verify is mocked to return
true/false as needed.

## 2026-05-27: precio_venta is not in Pedido_ArticuloDTO but is used by detallePedidosServices

`validarArticulosParaPedido` destructures `precio_venta` from each articulo (any[]). Test
fixtures include `precio_venta` as an extra field to satisfy the runtime destructuring.

## 2026-05-27: pedidosServices.datosPedido validates cliente/condicion via their repos

The service calls `getClienteById` and `getCondicionVentaById` before running the DTO validator.
Tests mock both repos. The pedidosValidations module is also mocked so the validator's
validateData returns [] by default.
