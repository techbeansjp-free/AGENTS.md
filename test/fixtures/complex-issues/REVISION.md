# Explicit contract revision after initial acceptance

This is a later requirement, not a correction to the initial acceptance oracle. Reservation public resources now include `currency: 'JPY'` in reserve/get/list/cancel and successful replay results. Billing validates this additional event property and rejects any other or missing currency with VALIDATION, without consuming an idempotency key. Invoice public shape remains unchanged. All initial tenant, authorization, state, persistence and idempotency guarantees remain.

Existing stored reservations and successful replay records created before this revision must remain readable and gain the constant currency at the public boundary; their IDs, quantities, amounts and versions must not change. No currency conversion or additional currencies are in scope. Integration must use actual revised reservation outputs, then pay/refund normally.

Only reservation/service.mjs and billing/service.mjs are authorized implementation changes. The evaluation driver owns requirements/oracles and Git integration. Each Issue owner updates only its assigned service; original acceptance evidence is retained but does not prove the revised contract. Preserve the other Issue's completed work during handoff and repairs.
