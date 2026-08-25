# Purchase-plan preflight

Yoink 0.46 adds a server-authoritative, no-purchase-write review before the
guided setup creates a plan. It answers three questions for a non-technical
user before they commit anything:

1. Is this exact draft valid under the current safety policy?
2. What is the current worst-case price boundary?
3. What will the plan actually be able to do after it is saved?

The preflight is not a stock observation, purchase authorization, action
capability, or promise that an offer will qualify.

## Contract

`POST /api/v1/user/purchase-intents/preflight` accepts purchase-intent contract
version `2` with the explicit confirmation
`PREFLIGHT_EXACT_PURCHASE_PLAN`. It validates:

- the exact accepted listing and USD currency;
- quantity from 1 through 99;
- positive integer item and all-in caps;
- first-party seller and exact-item substitution;
- fulfillment and the shipping-only guarded-add boundary;
- packaged add-runner availability when an add is requested;
- cooldown and future expiry bounds;
- the current tax and retailer reserve required by an add plan; and
- whether another plan already owns the selected product.

A successful response returns normalized listing and draft facts, the maximum
item subtotal, tax reserve, store reserve, minimum all-in total, remaining
headroom, and the same automation-readiness projection used by saved plan
cards. `noPurchasePlanSaved` is always `true`.

The endpoint creates no mission, target, intent revision, spend reservation,
or action job. Normal privacy-bounded route telemetry still records the route
outcome according to the operational telemetry policy.

## Fresh review receipt

The response includes a five-minute `preflightFingerprint` bound to:

- the private tenant and user scope;
- the normalized exact draft and accepted listing;
- current price-reserve calculation;
- current server-derived automation readiness; and
- the preflight issuance instant.

The guided UI submits that fingerprint and instant with contract-version-2
creation. The server recalculates the complete preflight immediately before
the write. A changed field, listing, reserve, source, companion, qualification,
global action state, user scope, or expired receipt fails with a new-preview
requirement. The fingerprint is a consistency receipt, not a bearer credential,
and it is not retained in purchase audit or outbox payloads.

Contract version `1` remains accepted for existing clients and tests. The
first-party user dashboard uses version `2` and never silently falls back.

## User experience

The setup dialog runs a short debounced check as the user edits the plan. The
review checkbox and create button stay disabled until the current check passes.
Changing any material field clears the prior acknowledgement immediately.

The dark review panel then shows:

- maximum item subtotal;
- server-required all-in total;
- tax and retailer reserve;
- room remaining within the user's chosen limit; and
- the exact readiness headline and explanation expected after save.

An unqualified lane may still be saved for monitoring, but the preview says it
will remain closed. Fresh offer verification, add-only qualification, quantity
one per attempt, the global pause, and manual checkout remain unchanged.

## Failure and recovery

Incomplete values are explained locally before a request. Server policy errors
replace the preview with one bounded message and leave creation disabled. If a
valid preview expires or current server state changes during submission, the
dialog automatically requests a new preview and requires the user to review it
again. No stale receipt is retried as a create request.
