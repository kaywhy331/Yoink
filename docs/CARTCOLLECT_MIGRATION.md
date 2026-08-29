# CartCollect browser-safety migration

## Decision

Yoink will reuse CartCollect's proven safety semantics, not copy its monolithic
browser coordinator. Pure proof rules move first. Each retailer DOM adapter then
advances independently through fixtures, read-only observation, add-only, review,
and submit qualification.

The current Yoink companion has only loopback access as a required host
permission. Retailer access is optional. Generic `retailerMutation` remains
forced false, while the independently versioned `target-add-v4`,
`walmart-add-v5`, `amazon-add-v7`, and `bestbuy-add-v5` capabilities can be declared and qualified
only for their narrow add-only scopes.

## Source-to-target map

| CartCollect source | Reusable responsibility | Yoink target | Status |
| --- | --- | --- | --- |
| `extension/offer-policy.js` | Live price and seller binding | `packages/browser-safety/src/index.ts` | Ported as integer-money, immutable-job verification |
| `extension/safety.js` | Exact cart scope, quantity, total, and fresh proof | `packages/browser-safety/src/index.ts` | Ported for one-job carts |
| `extension/evidence.js` | Privacy-preserving destination/payment fingerprints | Browser safety checkout contract | Validator ported; Target fixture capture accepts an in-memory signer; runtime signing pending |
| `extension/retailers.js` | Retailer visible-DOM readers | One versioned adapter module per retailer | Four qualification-gated add lanes plus nine exact-identity read-only observers with sanitized fixture coverage |
| `extension/automation-state.js` | Durable reservations and post-mutation locks | Yoink action-job state machine and lease reconciliation | Mission-wide claims, four-lane lease expiry, cold-worker recovery, and explicit uncertain-state resolution implemented |
| `extension/content.js` | Navigation and mutation orchestration | Small job runner composed from adapter + verifier | Separate Target, Walmart, Amazon, and Best Buy add-only runners implemented as isolated bundles |
| `extension/traffic.js` / schedule and queue modules | Store budgets, cooldowns, and queue restraint | Per-adapter runtime guards | Walmart virtual-queue restraint implemented; broader per-store traffic budgets pending |

## Versioned browser contract

`BROWSER_SAFETY_CONTRACT_VERSION` binds every observation to one immutable job:

- exact retailer and SKU;
- allowlisted HTTPS retailer origin;
- fresh visible product-page evidence;
- stock, actionable control, unit price, seller, and fulfillment;
- independently counted single-job cart with no foreign lines;
- bounded final total and unchanged quantity;
- visible checkout evidence represented only by keyed fingerprints;
- no unsafe substitutions, memberships, authentication, MFA, queues, location
  prompts, or security challenges;
- submit requires a previously approved destination/payment fingerprint set.

Missing or ambiguous evidence fails closed with a stable reason code. Signal
evidence can tighten a cap, but it can never replace the fresh browser proof.

## Qualification ladder

Each retailer and action level is promoted separately:

1. Extract a read-only DOM adapter with no click functions.
2. Replay CartCollect fixtures and add sanitized current fixtures for positive,
   stale, marketplace, wrong-SKU, quantity-limit, auth, MFA, queue, cart, review,
   and confirmation states.
3. Run signed-in read-only shadow observation against the real site.
4. Complete a current-adapter live-evidence dossier and a mutation-disabled
   add-to-cart rehearsal.
5. Qualify `add_to_cart`; enable only the minimum product/cart host permission.
6. Prove duplicate-click prevention, cold service-worker recovery, lease expiry,
   foreign-cart blocking, and post-mutation reconciliation.
7. Qualify `prepare_checkout` after cart and fulfillment evidence passes.
8. Qualify `submit_order` only after user-approved keyed checkout trust, final
   total verification, confirmation evidence, and uncertain-submit recovery.

Qualification is an explicit database record containing adapter version and an
evidence hash. A completed dossier never self-qualifies: the local user must
confirm the exact retailer add-only scope in the control center.

## Current Target boundary

`target-observer-v3` is a pure visible-DOM reader for exact Target TCINs. It
observes product offer, seller type, fulfillment, cart inventory, bounded order
total, manual blockers, and privacy-preserving checkout evidence. Its fixtures
cover first-party and marketplace offers, hidden/recommended controls, wrong
SKUs, authentication/MFA/location/membership/queue/challenge states, foreign
cart lines, and unsafe checkout choices.

It contains no click, event-dispatch, fetch, navigation, or credential logic.
The separate `target-add-v4` bundle owns Target's only commerce click function. It accepts
only an immutable Target/add-to-cart/quantity-one/first-party job with exact
Shipping or explicitly configured Pickup fulfillment, binds the exact current
fulfillment region, and can select the matching available tile. Shipping may
use an explicitly available same-day Delivery fallback.
It then waits for Target's Add control to rebind and reobserves the offer before
the single Add click. `Check availability`, a Pickup tile for a Shipping job,
unavailable tiles, ambiguous regions, and location or membership prompts remain
closed. The service worker
consumes a short-lived authorization and writes the durable mutation receipt
before selection; it verifies the exact cart afterward.

The initial live dossier requires two distinct exact TCINs, one Target-sold
remote-fulfillment candidate, and one no-click rehearsal. Marketplace, Pickup,
and unavailable observations remain additional layout coverage; only an exact
Pickup target may authorize Pickup. Qualification and activation are explicit, and checkout plus
order submission remain closed.

## Current Walmart boundary

`walmart-observer-v5` is a pure visible-DOM reader whose shipping evidence must
be explicit; the v1 observer cannot qualify mutation. The separate
`walmart-add-v5` bundle accepts only an immutable
Walmart/add-to-cart/quantity-one/first-party job matching exact Shipping or
explicitly configured Pickup. It applies an
empty-cart preflight, stops on virtual queues or interactive blockers,
reobserves immediately before consuming a short-lived click authorization, and
proves one exact cart line afterward. Its service-worker receipt and restart
semantics match Target without sharing a generic mutation capability.

The implementation and automated recovery coverage are complete. Live Walmart
authorization requires two fresh v5 item IDs, a first-party shipping candidate,
one no-click rehearsal, a recently connected capable companion, the exact
dossier hash, and explicit local activation.

## Current Amazon boundary

`amazon-observer-v7` is a pure visible-DOM reader that requires one offer scope
to bind the exact ASIN, a unique volatile offer token, price, seller, explicit
selected-fulfillment evidence, and the Add control. It checks the Add control's nearest
exact product form first so deeply nested live buy boxes remain bound without a
whole-page fallback. It recognizes both the combined visible `Shipper / Seller`
field and separate `Ships from` / `Sold by` Offer Display fields. A separate
field layout is first-party only when Amazon is both shipper and seller; a
different named seller remains marketplace evidence even when Amazon fulfills
the shipment. Fulfillment ignores non-rendered script, style, template, and
hidden text. Canonical offer fields take precedence over alternate payment
tokens when internally consistent, while explicit checkout ASIN inputs take
precedence over variation-swatch metadata. Route validation takes its volatile
offer token only from the selected exact Add form. The separate `amazon-add-v7` bundle
accepts only an immutable Amazon/add-to-cart/quantity-one/first-party job whose
live fulfillment matches exact Shipping or explicitly configured Pickup. The
offer token stays only inside a short-lived in-page authorization and
must remain unchanged at commit. The service worker proves the Amazon cart is
empty first, writes the durable mutation receipt, clicks Add at most once, and
then proves one exact cart line. Buy Now, checkout, marketplace, fulfillment
mismatch, and order submission remain closed.

The live dossier requires two exact ASINs, one Amazon.com-sold shipping
candidate with a ready ephemeral offer binding, one no-click rehearsal, a
current capable companion, the exact evidence hash, and explicit local
activation.

The companion retries a failed dynamic observation across a short bounded
hydration window. Every explicit retailer observation, rehearsal, and guarded
live verification also posts an authenticated structural diagnostic. Migration
10 persists only allowlisted counts/enums and a
server-derived layout fingerprint for the open/recovered repair queue. Raw DOM,
page text, offer tokens, cookies, CSRF values, addresses, and account data never
enter the diagnostic contract.

Companion 0.16.0 also reports failures that occur before an observer can return
its normal contract, but only after exact URL/SKU validation and optional host
permission. Injection, execution, top-frame, runtime, collection, and contract
failures use fixed reason codes and an all-zero structural layout. Raw browser
errors and URLs are discarded; pre-permission attempts are never transmitted.
Companion 0.16.1 closes that zero-layout repair group only after each affected
exact SKU later produces a successful observation.

Companion 0.17.0 durably queues only canonical diagnostics when loopback
delivery fails transiently. The device-bound outbox is deduplicated, limited to
50 entries, expires after nine minutes, and drains on startup and health
cycles. Stale entries, entries from another pairing, and permanent 4xx
rejections are discarded; exact server ingestion is idempotent. The queue does
not retain raw errors, URLs, DOM, or any value outside the diagnostic contract.

## Current Best Buy boundary

`bestbuy-observer-v6` binds one exact numeric SKU, price, first-party seller,
an exact selected Shipping or Pickup state, and Add control inside a bounded offer scope. It
supports current and legacy product routes plus current test/automation and
accessible native-button layouts. Its diagnostic reports a sanitized generic
Add-intent count when an unknown selector exists, allowing immediate repair
queue classification without storing page text or DOM. The separate
`bestbuy-add-v5` runner preserves the empty-cart, durable pre-click receipt,
at-most-once click, exact cart-line proof, queue/interactive restraint, and
marketplace/fulfillment-mismatch rejection boundaries. Accessibility-backed seller names are
read only inside the already-bound seller element, and in-store-only products
remain manual/local evidence with unknown global availability. Migration 19
retires prior Best Buy qualifications; observer-version binding also excludes
pre-v5 evidence from current qualification. Preorders and high-demand gates are
retained as read-only evidence but cannot satisfy or execute the in-stock lane.
Activation requires a fresh v6 dossier,
no-click rehearsal, capable companion, exact evidence hash, and local
confirmation.

## Constrained layout recovery

The four action stores keep packaged selectors as their first choice. Target
can recover current fulfillment tiles from unique visible accessibility labels,
while Walmart, Amazon, and Best Buy can recover one Add-intent control and one
price only when each has a unique, privacy-bounded structural landmark. Recovery
does not relax exact TCIN/SKU/ASIN, seller, saved fulfillment, quantity, price-cap,
offer-token, offer-scope, or control-uniqueness checks. Duplicate semantic
controls or prices fail closed. Signed observer recipes remain read-only shadow
evidence and never supply a click target.

Premium Bandai and Pokémon Center use observer-only v2 adapters. Their exact
item/product identities, availability, canonical routes, attribution, signal,
and diagnostic paths are enabled, while every mutation capability remains
absent and database execution support remains false. Unavailable-page and
Imperva challenge shells are manual/security evidence with unknown inventory,
not out-of-stock assertions.

## Recommended implementation order

1. Target read-only adapter and fixture parity.
2. Target add-only qualification.
3. Walmart read-only adapter, including official queue restraint. **Implemented.**
4. Walmart add-only qualification path. **Implemented.**
5. Amazon read-only adapter, including live seller and ASIN binding. **Implemented.**
6. Amazon add-only qualification and ephemeral offer-bound entry evaluation. **Implemented; live dossier and explicit activation pending.**
7. Best Buy read-only/add-only adapter and qualification path. **Implemented;
   live v2 dossier and explicit activation pending.**
8. Additional exact-identity read-only observers, including Premium Bandai and
   Pokémon Center. **Implemented; mutation intentionally absent.**
9. Checkout review per retailer.
10. Auto-submit per retailer only after all earlier levels remain stable.

TrackaLacker push ingestion remains a separate source adapter and does not need
to wait for retailer mutation qualification.

Amazon's ephemeral offer-bound entry evaluation is implemented as read-only
evidence plus an isolated add-only runner. The rehearsal proves the final
pre-click boundary without navigating to Buy Now, clicking, or persisting the
offer ID. Mutation remains closed until explicit local activation.
