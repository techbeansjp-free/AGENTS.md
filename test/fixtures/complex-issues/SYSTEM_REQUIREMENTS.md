# Synthetic multi-Issue system acceptance

This extends REQUIREMENTS.md for an evaluation workload, not a product template. No customer data, external services, real authentication or payment processing. REVISION.md applies only when explicitly requested later. The existing service oracles remain mandatory. No implementation solution is supplied for this extension.

Develop two concurrent vertical Issues: reservation management and invoice management. Each includes its screen, HTTP behavior, service and persistence. The coordinator owns their shared HTTP/authentication contract and actual integration. Split work according to dependencies and explicit non-overlapping ownership; no mandatory Agent count or hierarchy. A third integration task is not a substitute for testing each Issue. Shared files require one writer at a time.

## Server and authority

`web/server.mjs` starts a loopback HTTP server on PORT (0 by default), uses DATA_FILE for both services, and prints one JSON line `{ "port": <actual port> }` after listening. SIGTERM closes the server and database. Serve the application at `/`.

The evaluation Host supplies `x-fixture-session`: `alpha-admin`, `alpha-reader`, or `beta-admin`. Map these to the corresponding tenant and role. Reject missing/unknown sessions with 401 for API requests. Headers are a dummy authentication boundary supplied by the test Host, never a real login scheme. Do not trust tenant or role from JSON/query parameters. Mutations by readers return 403. A different tenant cannot retrieve or mutate another tenant's resource. All HTML renders user strings as text.

API responses use JSON. Service errors AUTH/FORBIDDEN/NOT_FOUND/VALIDATION/CONFLICT map to HTTP 401/403/404/400/409 and `{code,message}` with a nonempty actionable message. Malformed JSON, arrays/null in place of objects, missing/extra fields, numeric strings, unsafe numbers and invalid query values are rejected. A failed request must leave durable business state unchanged. Unknown routes/methods never silently invoke another operation.

## HTTP contract

- `POST /api/reservations/seed`: body `{sku,available,unitCents}`, 200 on success.
- `POST /api/reservations`: body `{key,sku,quantity}`, 201 returning the service resource.
- `GET /api/reservations?page=1&pageSize=2`: service list result `{items,total}`.
- `GET /api/reservations/:id`: service resource.
- `POST /api/reservations/:id/cancel`: `{key,expectedVersion}`, 200 resource.
- `GET /api/inventory?sku=<sku>`: inventory resource.
- `POST /api/invoices`: `{key,reservationId}`, 201 invoice. Resolve the reservation through the authenticated actor's service; never accept an arbitrary event supplied by the browser. Pass the actual reservation output into billing.
- `GET /api/invoices?page=1&pageSize=2` and `GET /api/invoices/:id`: billing list/resource.
- `POST /api/invoices/:id/pay` and `/refund`: `{key,expectedVersion}`, 200 resource.

URL IDs are opaque and encoded. Lists default to page1/pageSize2 and otherwise follow the service contract. Mutations retain idempotency across HTTP retries and server restart. Do not silently retry a stale version as a new mutation.

## Visible business journeys

Use semantic controls with these stable test IDs (HTML id): `reservation-form`, `sku`, `quantity`, `reserve`, `reservations`, `reservation-prev`, `reservation-next`, `reservation-pagination`, `invoices`, `invoice-prev`, `invoice-next`, `invoice-pagination`, `message`. Each list row has `data-id` with the resource ID. Reservation rows expose buttons named `Cancel` and `Invoice`; invoice rows expose `Pay` and `Refund` when applicable. Disabled/unavailable actions reflect state and reader authority. The UI may choose its layout freely.

Inventory is seeded through the fixture API; the application must not seed business data on startup. A user enters SKU/quantity, reserves, finds the row in the paginated list, creates its invoice, pays, refunds and cancels the reservation. Each successful operation updates the relevant visible status and survives reload/restart. Each list has two rows per page, total and page indicators, previous/next controls. Do not infer a successful operation merely from clicking a button.

Invalid input and server conflict show an explanatory message while preserving user input. Users can correct and retry. A request whose response is lost can be retried without duplicate effects using the same operation key; a genuinely new operation uses a new key. A stale tab must show conflict and allow refresh rather than overwrite newer data. Reader mode permits navigation, not mutations. Backend validation remains effective when the UI is bypassed.

## Completion and later phases

Completion requires original service tests, real HTTP negative/positive tests, browser journeys, independent review of original requirements and integrated diff, and synthetic Draft PR/CI. No implementation by the evaluator is counted as autonomous development. Keep initial and follow-on phase results separate. Later requests exercise schema evolution, review repair and interruption with saved work; the same coordinator session continues across Issues. Actual work boundaries and measured contexts determine whether the workload exercises prolonged development; two files or one short revision alone are not large-system evidence.
