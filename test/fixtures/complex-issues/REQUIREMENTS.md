# Synthetic reservation and billing acceptance contract

This fixture contains no customer data. It is an evaluation workload, not ASC production code. Implement the two independent Issues against this contract, then integrate. Node >=24 built-in `node:sqlite` is available; no network or dependencies are needed. All methods are synchronous. Persist state in the supplied database path, including idempotency records; close/reopen must preserve results. Separate service instances may use the same database. Use transactions so rejection leaves all state unchanged.

## Shared interface and authority

Reservation exports `ReservationService`; billing exports `BillingService`, each from `service.mjs`. Constructor takes a SQLite filename; `close()` closes it. Actor is `{tenant,role}`, tenant a nonempty string, role `admin` or `reader`. Invalid actor throws an Error with `code: 'AUTH'`; readers may list/get but may not mutate (`FORBIDDEN`). Missing IDs and IDs belonging to another tenant return `NOT_FOUND`, never another tenant's data. No global current-tenant state.

Mutation input must have exactly the specified keys and valid types; otherwise `VALIDATION`. IDs, keys and SKU are nonempty strings. Monetary values, quantities and versions are safe integers with bounds below. No coercion of numeric strings. Unknown keys are rejected. Errors have a stable `code` property; internal messages need not be identical. Errors never consume inventory, create invoices, or persist idempotency records. Returned objects must not share mutable internal state.

Idempotency is scoped by tenant, operation and key. Same canonical input returns the original result (including original version) without repeating effects, even after reopen. Reusing a key with a different input is `CONFLICT`. Replay still requires the current actor to be authorized. Perform replay before checking current resource version; a previously successful operation remains replayable after later transitions. Different tenants may reuse keys.

List returns `{items,total}`; each item is the same public shape as get. Input exactly `{page,pageSize}`, both positive safe integers, pageSize<=50; order by creation order, total independent of pagination. Out-of-range pages return empty items, empty service returns total0. Readers have list/get access. get(actor,id) returns the tenant-owned public resource.

## Issue R: reservation (only reservation/ and tests/reservation* writable)

`seed(actor,{sku,available,unitCents})`: available>=0 and unitCents>=0 safe integers. Adds an inventory item for actor tenant. Existing SKU is `CONFLICT`; this is setup, never an overwrite. Returns no prescribed value.

`reserve(actor,{key,sku,quantity})`: quantity>0 safe integer. Unknown SKU is NOT_FOUND, insufficient inventory is CONFLICT. Reject unsafe multiplication of quantity*unitCents with VALIDATION before decrementing inventory. Returns `{id,tenant,sku,quantity,amountCents,status:'reserved',version:1}`. id is an opaque unique string. Inventory decreases exactly once. All public objects have these keys only.

`cancel(actor,{key,id,expectedVersion})`: expectedVersion>=1 safe integer. Missing ID NOT_FOUND; stale version CONFLICT; only reserved -> canceled is allowed, otherwise CONFLICT (except successful replay). Restore inventory exactly once; return the resource with status canceled and incremented version. `inventory(actor,sku)` returns `{sku,available,unitCents}` under same tenant/read rules.

Implement `get`, `list`, `close` as above. Never import billing implementation.

## Issue B: billing (only billing/ and tests/billing* writable)

`issue(actor,{key,event})`: event has exactly `{id,tenant,sku,quantity,amountCents,status,version}`; must match actor tenant, status reserved, version>=1, quantity>0, amountCents>=0, safe integers. Mismatched tenant is FORBIDDEN. The event is a trusted internal reservation event *after schema and tenant validation*, not a public authentication mechanism. This fixture does not claim signed-event security. One invoice per tenant+reservation id; a second issue under a different key is CONFLICT. Returns `{id,tenant,reservationId,amountCents,status:'open',version:1}`. IDs unique strings.

`pay(actor,{key,id,expectedVersion})`: open -> paid, increment version; stale version/other state CONFLICT.

`refund(actor,{key,id,expectedVersion})`: paid -> refunded, increment version; stale version/other state CONFLICT. No partial refunds. Replay semantics above apply to pay/refund.

Implement `get`, `list`, `close` as above. Never import reservation implementation.

## Integration and failure scenarios

Actor A reserves stock, issues invoice from the resulting event, pays, refunds; read/list/reopen reflect state. Actor B cannot read or change A's resources. Cancellation restores stock without changing existing billing records; coordinating business cancellation with refunds requires both explicit operations and is not implicit cross-service mutation.

Exercise rejected inputs and stale versions without damaging valid records, duplicate operations before/after reopen, two instances sharing a database, safe integer overflow, pagination, and readers. Two Issues are implementable in parallel because public contract is fixed. Integration must test real outputs, not independently invented event mocks only.

Later evaluation phases may introduce an explicit contract revision, review finding, Git conflict and writer handoff. Those changes require new target/evidence and must not rewrite this initial contract retrospectively. No commit, push, PR, or external operation is authorized by this fixture itself; the evaluation driver owns synthetic Git setup/integration.
