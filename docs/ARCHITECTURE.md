# Yoink architecture

## North star

Yoink turns trusted product signals into fast, bounded browser actions while
keeping product identity, user intent, source evidence, affiliate attribution,
and execution state separate.

```text
Sources -> normalized signals -> identity resolution -> incidents/dedupe
        -> per-user mission decision -> action job -> Chrome verification
        -> browser action -> audited result
```

## Trust boundaries

1. Sources report claims; they never authorize a purchase.
2. The commerce graph owns canonical variant and retailer-listing identity.
3. The mission engine decides whether a user's current rules qualify a signal.
4. An action job is a short-lived, immutable capability for one listing.
5. Only the Chrome extension may eventually mutate a retailer session.
6. Chrome must prove live identity, stock, seller, price, quantity, fulfillment,
   cart scope, and checkout total before advancing.

Yoink 0.1 created `shadow_ready` jobs only. Retailer execution remains
qualification-gated rather than implied by a strategy match.

Yoink 0.2 adds authenticated device pairing and a dormant lease/reconciliation
protocol. Leasing is independently gated by execution mode, the global pause,
device capability, and an explicit retailer/action qualification record. See
[CartCollect browser-safety migration](CARTCOLLECT_MIGRATION.md).

Yoink 0.3 adds an explicit, read-only Target shadow-observation path. A paired
user requests optional `www.target.com` access from the extension popup and
inspects the active exact product page once. Chrome remaps the result to a
strict allowlist before authenticated loopback submission. The server rebuilds
the canonical URL, discards extra fields, bounds retention, and labels evidence
as candidate, not actionable, or manually blocked. It never creates a retailer
qualification or action authorization.

Yoink 0.4 adds a derived Target qualification dossier. It considers only recent
observations from the current adapter version and makes positive, marketplace,
fulfillment, unavailable, and SKU-diversity coverage visible. The dossier is a
readiness projection: it cannot write an adapter qualification, change global
execution settings, advertise browser mutation capability, or lease a job.

Yoink 0.5 adds `target-add-v1`, an independently versioned add-only runner. Its
initial qualified scope is Target-sold shipping offers, quantity one. Activation
requires two exact live TCINs, a first-party shipping candidate, a current
no-click production-runner rehearsal, a recently connected capable companion,
and an explicit local confirmation. Activation writes the versioned evidence
hash and enables live mode atomically; the global pause remains reversible.

Every leased Target job first proves an empty cart, then binds one DOM control
to an in-memory authorization. Chrome reports and durably persists `adding`
before consuming that authorization and clicking once. It then verifies one
exact cart line. A worker restart before the boundary cancels safely; a lease
expiry or uncertain result after the boundary locks the job for manual review
and cannot trigger an automatic retry. Checkout and submit states remain
unqualified.

Yoink 0.6 adds an extension-owned TrackaLacker Web Push path. A user gesture
grants optional TrackaLacker page access, the extension creates a real silent
PushSubscription with TrackaLacker's published application-server key, and a
minimal MAIN-world bridge submits the confirmed nested device payload using the
already signed-in page context. Subscription endpoint/key material, cookies,
CSRF values, and signed notification URLs never enter the database, durable
signal queue, diagnostics, or logs.

Silent extension Web Push is available in Chrome 121 and newer. If the runtime
cannot create a silent subscription, Yoink retains a standards-compatible
visible fallback and reports that an additional toast may appear. It does not
delete, replace, intercept, or suppress the user's ordinary TrackaLacker
browser registration.

Push delivery is sanitized in Chrome, queued durably with a 50-event bound, and
accepted only by the paired-device endpoint with a matching Idempotency-Key.
Unknown/out-of-stock events are recorded but explicitly barred from strategy
qualification. A separate user-requested followed-library pass captures all
source listings, including unavailable and unsupported-store candidates, and
then stops. Preferred source retailer routes resolve store-only pushes without
discarding alternate same-retailer records.

Yoink 0.7 turns those vertical slices into a durable personal-use control
plane. Followed-library imports have no application item limit and write a
restart-visible run ledger plus per-product receipts. Library, missions,
opportunities, actions, and audit history use bounded server-side pagination
instead of being embedded into the three-second UI snapshot. TrackaLacker
bridge status writes only material changes to audit/outbox history.

Yoink 0.8 adds the Walmart lane; 0.8.2 advances it to `walmart-observer-v4` and
`walmart-add-v3` so price, seller, fulfillment, and the Add control must share
one exact-SKU offer scope. Walmart's split dollar/cents markup is normalized
only inside that scope. The production runner requires an exact Walmart item ID,
Walmart as seller, explicitly visible shipping, quantity one, an empty cart,
fresh offer verification, a durable pre-click receipt, and exact one-line cart
proof. Virtual queues and every interactive/manual block cancel before the
mutation boundary. Its activation requires two current item IDs, one bound
no-click rehearsal, a current capable companion, the exact dossier hash, and a
separate local confirmation. Shipping implementation is complete, but live
authorization remains closed until those current-user gates are satisfied.

Yoink 0.22 adds Walmart Collectibles Draw as a distinct read-only lifecycle.
The packaged `walmart-draw-observer-v1` accepts only the exact draw hub and
extracts a bounded public card schema from server-rendered draw modules, with a
visible-card fallback. The extension allowlists and posts item ID, title, price,
seller class/name, draw state, closing instant, condition, quantity limits, and
draw/Add-control state to migration 24. The server rebuilds canonical URLs,
keeps an idempotent bounded history, projects still-open drawings, and joins
only on exact Walmart listing SKU to label private mission matches. Sanitized
observer failures use the same ledger with no item payload.

This is not part of Walmart add qualification. A drawing card has its normal
Add control suppressed, and entering the drawing is an irrevocable contingent
order authorization: Walmart may later place and charge the order if the user
is selected. The packaged observer has no click or network primitive and the
extension contains no drawing-entry route. Account, address, payment,
membership, cookie/session, entry token, and entry status are excluded from the
contract. Any future entry capability must be independently packaged,
versioned, consented per drawing, rehearsed, and governed at least as strictly
as submit-order.

Yoink 0.10 advances the Amazon lane to `amazon-observer-v6` and
`amazon-add-v5`. The contracts accept an Amazon candidate only when one offer
scope binds the exact ASIN, unique volatile offer token, price, seller, explicit
shipping evidence, and Add control. Observer v6 first checks the Add control's
nearest exact product form so deeply nested live markup remains locally bound.
Canonical offer fields win over alternate payment tokens when the canonical
fields agree, and explicit checkout ASIN inputs win over variation-swatch
metadata. It handles both the combined visible `Shipper / Seller` field and
separate `Ships from` / `Sold by` fields; Amazon fulfillment does not turn a
different named seller into a first-party offer. Non-rendered content cannot
supply fulfillment. The production runner retains the selected token only
inside a short-lived page authorization and requires it to be unchanged
immediately before clicking the same control. It preflights an independently
empty Amazon cart and proves one exact quantity-one ASIN afterward. Buy Now,
marketplace sellers, pickup, checkout, and submit remain closed. Amazon
activation separately requires two current ASINs, one ready offer binding, a
no-click rehearsal, a current capable companion, the exact dossier hash, and
explicit local confirmation.

Yoink 0.11 adds `bestbuy-observer-v2` and `bestbuy-add-v1`. The observer accepts
current and legacy numeric-SKU product URLs, then requires one bounded offer
scope in which exact SKU evidence, one Add control, price, explicit visible
`Sold by Best Buy`, and selected shipping all agree. It rejects marketplace,
pickup-selected, high-demand queue, and conflicting-SKU layouts. The production
runner uses the same empty-cart, durable pre-click receipt, at-most-once click,
and exact one-line cart proof boundaries as the other add-only lanes. Migration
11 explicitly resets Best Buy execution and any prior qualification to closed;
two current SKUs, a no-click rehearsal, a capable companion, the exact dossier
hash, and local confirmation are required to activate v1.

Yoink 0.12 adds exact-identity, read-only adapters for Disney Store,
Ravensburger, Riot Games Merch, Books-A-Million, Fanatics, Kohl's, and Macy's.
Their product identities are respectively a Disney item number, Ravensburger
article number, Riot product slug, Books-A-Million `/p/` identifier, Fanatics
path-encoded `p-` product token, Kohl's `prd-` number, and Macy's Web ID. Path-dependent canonical
URLs are sanitized rather than guessed from an ID alone. Migration 12 registers
the stores and explicitly leaves retailer and listing execution disabled.

Yoink 0.15 adds read-only `pbandai-observer-v1` and
`pokemoncenter-observer-v1` adapters. Premium Bandai identity is the exact
letter-plus-ten-digit `/us/item/` value and availability distinguishes preorder,
in-stock, and closed pages. Pokémon Center identity retains the entire
hyphenated `/product/` ID, including its optional child suffix, so visually
similar parent and variant pages cannot merge. Migration 18 registers both
stores, seeds canonical attribution policy for every existing user, and
explicitly keeps retailer/listing execution disabled.

The same release supersedes Best Buy's initial adapter with
`bestbuy-observer-v3` and `bestbuy-add-v2`. It recognizes current test and
automation attributes plus bounded native/accessibility Add controls. A
sanitized generic Add-intent count lets the repair queue classify selector
drift even when no configured control matched; it never includes control text
or changes the mutation boundary.

Yoink 0.15.1 advances the two new read-only adapters to
`pbandai-observer-v2` and `pokemoncenter-observer-v2` after direct Chrome probes
identified non-product edge responses. Premium Bandai's multilingual `PAGE NOT
AVAILABLE` shell is a manual unknown block; Pokémon Center's top-level Imperva
`_Incapsula_Resource` iframe is a security challenge. Blocked documents clear
availability, price, seller, fulfillment, and Add evidence before persistence,
and the sanitized diagnostic records only the stable block reason and bounded
layout counts.

Yoink 0.16.0 closes the observer-runtime telemetry gap. Once the companion has
validated an exact retailer URL/SKU and confirmed optional host permission, a
bundle-injection, execution, missing-top-frame, missing-runtime, collection, or
contract-normalization failure is posted immediately as one authenticated
diagnostic with a stable allowlisted reason and all structural counts set to
zero. The payload contains no canonical URL, raw browser error, DOM, or page
text. Identity failures and permission denials are never reported.

Yoink 0.16.1 makes those zero-layout runtime incidents recoverable without
conflating products: the repair projection closes the group only after every
affected exact SKU has a later successful observation. A success on one item
cannot hide an unresolved runtime failure on another.

Yoink 0.17.0 closes the transient delivery gap after collection. Retryable
adapter diagnostics enter a local-storage outbox only after exact identity,
optional permission, and canonical payload validation. The queue is paired-
device-bound, deduplicated, capped at 50, and aged out after nine minutes; it
drains on worker startup and the health alarm. Network/no-status failures, 408,
429, and 5xx responses retain the event, while permanent 4xx responses do not.
The server deduplicates the complete normalized event identity so a request
that succeeded before its response was lost cannot create a second occurrence.
Raw errors, URLs, DOM, and secrets never enter the outbox.

Yoink 0.18.0 introduces `bestbuy-observer-v4` and `bestbuy-add-v3` as a new
review boundary. The observer reads bounded text plus accessibility labels only
inside the already-selected seller element, fixing logo-backed `Sold by Best
Buy` layouts without inferring ownership from branding elsewhere on the page.
An explicit `In Store Only` page with no product Add intent is classified as a
manual location boundary with unknown global availability, preventing a local
store product from poisoning out-of-stock projections. Migration 19 retires
all earlier Best Buy qualifications and disables inherited Best Buy execution;
fresh v4 evidence and a v3 no-click rehearsal remain prerequisites. Historical
repair work is closed across layout fingerprints only when a strictly newer
packaged adapter later produces a non-failure result for the same exact SKU;
same-version evidence cannot self-resolve a parser incident.

Yoink 0.19.0 separates authenticated identity context from authorization.
Migration 20 persists granular permissions, built-in operator roles, and
tenant/user memberships. Only the exact seeded loopback control-center scope
has the local bootstrap bypass; a signed `maintainer` actor label has no
implicit privilege. Service and paired-device actors receive fixed narrow
capabilities. The HTTP router exposes explicit user, admin, device, and internal
surfaces, fails closed on unclassified routes, and attaches one safe correlation
ID to every error.

Migration 21 introduces governed catalog change proposals. A manual user
listing suggestion is normalized to an allowlisted payload, tenant-scoped,
content-hash deduplicated, and audited before it enters a pending queue. Only a
catalog curator may accept or reject it; the global listing write occurs inside
the acceptance transaction and retains all existing exact-identity conflict and
retailer-domain checks. Trusted exact source ingestion remains a separate
provenance path.

Yoink 0.21.0 completes the local reversible identity slice with migration 23.
Catalog identity proposals freeze a deterministic topology containing the
affected variants, listings, identifiers, source mappings, preferred routes,
missions, identity claims, historical resolution references, active jobs, and
spend reservations. Approval reconstitutes and hashes that topology inside the
write transaction; drift or active work rejects the operation. Merge requires
a reviewed exact-identifier claim, equal explicit variant dimensions, and a
different authorized user/actor. Split requires a partial exact listing set and
a changed allowlisted dimension, and it cannot divide one mission's targets.
Applied operations retain immutable before/after snapshots plus append-only
sequenced events. Rollback is a new compensating operation that restores exact
row identities only from the recorded topology and refuses drift.

These operations are intentionally limited to a database containing exactly
one tenant. The catalog tables are still shared, so tenant-local authority must
not become de facto global authority in hosted mode. A separately authenticated
global curator, production step-up, and cross-tenant policy remain roadmap work.

Yoink 0.22.0 adds migration 24 without altering any retailer execution or
qualification row. Walmart Draw scans belong to the private tenant/user/device
evidence plane and are read through explicit user/admin projections. Their
exact item-ID mission join is advisory: it cannot create a stock incident,
action job, add qualification, community assertion, or spend reservation.

Yoink 0.23.0 adds migration 25 and a privacy-classified operations plane for
the fixed `adapter_repair` event family. Sanitized diagnostic ingestion and
alert reconciliation commit atomically. Tenant-owned rules apply bounded
retailer/operation scopes, thresholds, dedupe and escalation windows, then
append lifecycle and dashboard/audit-outbox delivery receipts. Admin
projections replace user/device identity with a tenant-scoped pseudonymous
cohort and exclude exact SKUs, URLs, DOM/text, tokens, free-form notes, and raw
errors. A recovered diagnostic resolves matching work; manual resolution
suppresses historical replay but permits a strictly later failure to reopen.
Alert management has a distinct permission and cannot widen an observer,
qualification, action job, or packaged runner.

Yoink 0.24.0 adds migration 26 and replaces observer-recipe trust-on-first-use.
The API package and Chrome companion contain only the same public Ed25519
offline root. A root-signed, exact-schema manifest authorizes one unrevoked
online recipe-signing intermediate, binds its lifetime, retains or explicitly
revokes every prior key, and links each generation to the exact predecessor
hash. SQLite stores immutable manifest receipts plus a chained append-only
transparency ledger; the offline private root and online private intermediates
are excluded from the database and portability format.

The companion receives the complete manifest chain with an active recipe. It
verifies every root signature and fingerprint, monotonic generation,
predecessor hash, permanent revocation set, active-key lifetime, current
manifest hash, transparency checkpoint, and recipe signature before its fixed
isolated interpreter sees selector data. Chrome persists the latest generation
and checkpoint, so later server replay or a conflicting root generation fails
closed. A new root-authorized intermediate requires process restart to load its
named private key and explicit maintainer re-signing of reviewed recipes.
Neither manifest installation nor re-signing changes recipe review state or
retailer execution authority. Yoink 0.27.0 adds a separate HTTPS witness client
and migration-29 receipt/check ledger. It sends only the public root/manifest
hashes and current transparency sequence/hash, pins the witness Ed25519 key,
and verifies an exact chain-extending, expiring receipt. Hosted delivery of an
active recipe fails closed until the latest local transparency tip is freshly
witnessed. The local server is never treated as its own witness; this repository
does not ship the independent service/private key or production refresh and
public-consistency monitors.

Yoink 0.25.0 adds migration 27 and a separate, versioned selected-offer scope
to sanitized browser observations and read-only community assertions. The
Chrome package extracts a public retailer child key plus only size, color,
edition, language, pack, condition, finish, and style. The server revalidates
the child key against its canonical retailer SKU, normalizes the selected
dimensions, and derives the fingerprint; the browser cannot choose a durable
community key. Seller, fulfillment, and consented locality remain independent
dimensions. `listing_only` and `unresolved` evidence is retained for repair and
review but receives zero identity confidence and cannot publish stock. Opaque
offer tokens, checkout fields, and every mutation capability remain outside
this contract.

Yoink 0.26.0 advances Best Buy observation to `bestbuy-observer-v5` without a
broader action capability. Migration 28 retires inherited Best Buy
qualification and execution flags while leaving every other retailer
untouched. The observer models standalone
preorders, high-demand product gates, active queues, pickup-selected limited
stock, and ordinary inventory separately. An exact high-demand scope may retain
bounded public offer evidence for monitoring and diagnostics, but the live
offer remains manual and non-actionable. Preorders are excluded from Best Buy
qualification readiness and are rejected again by `bestbuy-add-v3` before an
authorization is created. The diagnostic path accepts only the structural
`interactive_high_demand` code and fixed counts; page content remains local.

The witness publisher is deliberately asynchronous at the API boundary while
receipt acceptance remains a deterministic database transaction. A verified
receipt and its accepted check/audit/outbox records commit together. Transport,
schema, signature, checkpoint, chain, or lifetime failures record only a fixed
sanitized outcome and keep delivery closed; response bodies and network details
are never persisted. Local mode has no witness requirement. Hosted boundary
configuration requires an explicit HTTPS endpoint, public log ID, public key
pin, and maximum age, but that staged seam is not a substitute for independent
operation, PostgreSQL, workers, IdP, or production monitoring.

The application bundles now reflect those trust domains. `/` is the user
product surface over existing missions, targets, listings, jobs, and settings;
`/admin` is independently permission-gated and owns diagnostics, retailer
qualification, catalog review, role membership, attribution, recipes, and
audit operations. The bundles call explicit `/api/v1/user` and
`/api/v1/admin` contracts. Legacy unprefixed application paths remain only as a
deprecated compatibility facade during migration.

Yoink 0.30.0 adds the local operational-observability boundary without turning
HTTP traffic into a browsing log. Migration 31 creates minute rollups keyed only
by tenant, fixed package-owned route group, method, actor kind, outcome class,
and bounded latency band. Successful and redirect traffic never receives an
individual event. A 4xx/5xx event retains only its one-way correlation key,
route group, status, safe server-owned error code, duration, and timestamp.
Dynamic path segments, query strings, bodies, messages, exact product IDs,
browser content, and user-entered values are structurally absent.

The API records after response completion and fails open if telemetry itself is
unavailable, so observability cannot block or authorize commerce work. Reads
use `admin.read`, remain tenant scoped, and expose four closed time windows.
Thirty-day pruning is opportunistic per tenant and records an immutable
aggregate receipt whenever detail is deleted. This is a local implementation
of structured metrics/log retention, not the Phase 2 production worker,
external metrics backend, SLO/on-call system, or PostgreSQL deployment.

Yoink 0.31.0 adds a separate high-risk administrative change boundary. Hosted
identity context now carries proxy-signed assurance level, authentication time,
and session ID, all bound to the request method, complete path, tenant, user,
actor, timestamp, and one-use nonce. The API accepts a step-up context for at
most five minutes. The internal loopback bootstrap has an in-process boundary
marker that is never accepted from hosted headers, so matching its visible IDs
cannot turn a hosted request into a local-trusted request.

Migration 32 adds tenant-scoped `admin_change_requests`, immutable
`admin_change_decisions`, and immutable `admin_change_events`. A closed policy
map divides protected operations into fresh-step-up and two-person controls.
Two-person requests bind the operation type, target, and canonical payload hash,
expire after 15 minutes, and require a different user and actor to approve.
Approval is inert: an exact retry atomically claims the authorization and runs
the protected repository mutation in one SQLite transaction. Rollback restores
the approval, while a successful claim cannot be replayed. Only bounded review
summaries are projected to `/admin`; raw bodies and secrets are not stored.

Local/offline mode records an immediate local-trusted consumed receipt so the
single-user product remains operable. The signed assurance protocol is an
enforcement seam, not a production IdP, MFA implementation, break-glass system,
or hosted session service.

Yoink 0.32.0 adds a user-onboarding projection without creating a second source
of truth. The five displayed setup steps are derived from existing scoped device
heartbeats, source connections, catalog/proposal counts, mission intent, and
action settings. The browser never decides readiness. Product-link intake is a
separate informational boundary: the server accepts only an exact product URL
for one registered retailer, extracts its URL-bound SKU, canonicalizes away
tracking, and creates a pending catalog proposal under private `user_link`
provenance. That source cannot assert availability or price and does not create
offer observations, missions, signals, or jobs. Catalog approval can establish
identity only; the later trusted signal, plan, qualification, lease, and live
Chrome validation gates remain unchanged.

Yoink 0.29.0 makes the reviewed mission policy—not an implicit generated
strategy—the decision source for user-created plans. Migration 30 adds
`decision_mode` and `max_signal_age_seconds` to immutable intent revisions and
records `decision_source` on both the signal decision and action job. Guided
and legacy user plans use `purchase_intent`; source/internal missions retain
`strategy`. Existing reviewed plans are upgraded by appending a new direct-mode
revision, leaving their prior history unchanged.

For a direct plan, a fresh resolved signal is evaluated only against the frozen
enabled listing, trusted-exact source, mission state, expiry, explicitly
verified first-party seller, selected fulfillment, numeric unit price, and
reviewed target cap. An informational source is downgraded to notification and
cannot reserve spend or reach a lease. The action
is the plan's saved notification or add ceiling, quantity one per opportunity;
an ordered strategy cannot widen or suppress it. A direct action job therefore
has a null strategy foreign key and an explicit `purchase_intent` decision
source. Its intent revision, exact-offer snapshot, idempotency key, spend
reservation, retailer qualification, device lease, and Chrome final checks are
otherwise identical to strategy-driven jobs.

Changing a direct plan to cart mode is revalidated transactionally after the
complete target set is staged. Every enabled target must be executable,
first-party-only, shipping, and capped, and the intent all-in maximum must cover
the worst enabled target at requested quantity plus the configured tax and
retailer allowance. Any failure rolls back mission, target, and revision
changes. This mode remains limited to notify/add-to-cart; it cannot request
checkout or order submission.

Yoink 0.28.0 makes the user creation boundary explicit without adding a second
intent model. `PurchaseIntentCreateInput` version 1 names one existing exact
listing and carries quantity, unit/all-in caps, first-party seller policy,
fulfillment, exact-only substitution, timing, action ceiling, and a review
confirmation. The repository validates that entire contract before opening one
nested-safe transaction, creates all known variant targets with only the chosen
listing enabled, and writes the configured immutable intent directly as
revision 1. Policy validation failure rolls back mission, targets, audit/outbox,
and revision together. A concurrent duplicate returns a conflict rather than
overwriting the existing plan. The compatibility user request creates a
notification-only draft; signal/internal callers retain their strategy-owned
creation path.

Catalog expansion cannot expand consent. A later listing for an existing exact
variant is attached to its mission disabled and is absent from the frozen
current revision until the user reviews and saves the complete target set. The
user library projects the last numeric offer observation separately from MSRP,
along with its observation time and normalized variant dimensions. The guided
cart choice also recomputes the same conservative tax-plus-store allowance
bound used by action-job reservation, so a plan cannot appear cart-ready with
an all-in cap the engine will deterministically reject.

Yoink 0.20.0 adds the private intent and spend boundary in migration 22.
`exact_offer_keys` freezes an exact listing/SKU with allowlisted variant
dimensions, condition, seller, fulfillment, and explicit region/store slots;
`offer_snapshots` freezes the sanitized price and availability evidence used by
one action. Neither table accepts a raw retailer session token. Mission changes
append a `mission_intent_revisions` row instead of rewriting policy history,
and optimistic revision checks reject lost updates.

Before a live mutation job can be leased, the engine must bind the current
intent revision and immutable snapshot, then create a transactional
`spend_reservations` row within remaining desired quantity and per-intent plus
optional per-order/daily/monthly limits. `spend_ledger_entries` is append-only:
reserve and release events balance cart-only work, while a commit is legal only
for a future verified `submit_order` action with an all-in total no greater than
the reservation. Current add-only confirmation releases capacity and does not
increase mission fulfillment. A policy revision cancels unleased stale work;
already uncertain mutation remains locked for review rather than being retried.

A bounded hydration retry handles buy boxes that settle just after the initial
user inspection. The companion also sends an authenticated, allowlisted
structural diagnostic for explicit inspections, rehearsals, and guarded live
verification. Migration 10 stores bounded counts/enums and a server-derived
layout fingerprint, then projects open and recovered groups into the control
center. Raw DOM/text and session, account, address, CSRF, cookie, or offer-token
data are outside the contract and never stored. In the current release,
persistent incidents require a reviewed adapter release and the server never
downloads selectors or self-modifying retailer code. The roadmap's possible
future registry is limited to signed, expiring, observer-only selector data
interpreted by fixed packaged logic; it can never supply mutation behavior.

Target, Walmart, Amazon, and Best Buy capabilities are named and adapter-version-bound.
The legacy generic `retailerMutation` flag is normalized to false and cannot
lease Best Buy or any future lane. Cold-worker recovery uses one
retailer-neutral receipt envelope while dispatching only to the four explicit
add runners.

Every user-facing control-plane mutation and material source/browser transition
writes a sanitized audit event and a tenant outbox event in one transaction.
Signal secrets, bearer values, signed query values, volatile Amazon offer IDs,
and push endpoints are redacted or rejected before that boundary.

The retailer evidence layer has read-only observers for thirteen exact stores.
Target, Walmart, Amazon, and Best Buy evidence drive separate gated dossiers
but do not self-authorize. Amazon additionally proves that one exact live offer
ID is bound to the intended ASIN entirely in page memory. It persists only route
kind/readiness/reason; the token and any constructed validation route are
discarded. A completed dossier is preparation evidence until explicit Amazon
activation writes the exact qualification record.

## Domain ownership

### Global commerce graph

- Product families
- Exact variants
- Identifiers
- Retailers and capabilities
- Retailer listings and canonical URLs
- Source-product and source-listing mappings
- Sanitized offer observations
- Pending and reviewed catalog change proposals with provenance hashes
- Reviewed merge, split, and compensating operations with immutable topology
  snapshots and append-only sequenced history

### User-owned intent

- Tenants and users
- Private source connections and follows
- Ordered, revisioned strategies
- One mission per user and exact variant
- Many listing targets per mission
- Append-only mission intent revisions with exact target and action limits
- Private per-order/daily/monthly spend policy
- Notification and attribution policy
- Paired extension devices
- Persisted tenant role memberships and user-facing product preferences

### Event and execution ledger

- Signal events and transport occurrences
- Semantic opportunity incidents
- Resolution and mission decisions
- Action jobs, attempts, and append-only state events
- Immutable exact-offer keys and sanitized offer snapshots
- Transactional spend reservations and append-only spend ledger entries
- Sanitized receipts and audit events
- Tenant-scoped transactional outbox events
- Sanitized, device-attributed retailer shadow observations
- Durable source-sync runs and per-product receipts

Private source data is tenant-owned. Exact catalog identities may eventually be
shared, but no private follow or signal becomes global automatically.

## Persistence

SQLite is the local source of truth. Schema migrations are transactional and
numbered; the current schema is migration 32. Foreign keys are mandatory.
Current projections and append-only audit events update in the same transaction;
Yoink does not use full event sourcing.

Money is stored as integer minor units plus an ISO currency code. Timestamps are
UTC ISO-8601 values. User-owned tables include tenant/user ownership from the
first schema so their IDs can migrate to PostgreSQL later.

The database repository is the only application module allowed to issue SQL.
The two web bundles and extension communicate through versioned HTTP contracts.
Local requests resolve to the exact seeded bootstrap scope with an internal
loopback-only boundary marker; hosted boundary mode resolves an authenticated
tenant/user/actor scope before persisted permission checks. Hosted assurance is
proxy signed and time bounded. Identity context does not substitute for a role
membership, and matching local IDs does not inherit local trust.

The streaming `yoink-portability-ndjson-v1` operator format exports every
application table from one read transaction, preserves exact integers/blobs,
and binds every table plus the aggregate logical dataset to SHA-256 counts and
hashes. Restore is permitted only into a new database with an exact migration
and schema match, followed by foreign-key, integrity, and data-parity checks.
It is a PostgreSQL cutover and desktop-recovery prerequisite, not a PostgreSQL
driver or a remotely downloadable backup. See [Data portability and recovery](DATA_PORTABILITY.md).

## Signal identity

Resolution priority is:

1. Exact source-listing reference
2. Exact retailer and retailer SKU
3. Preferred exact source-product retailer route
4. Unique exact source-product plus retailer mapping
5. Preferred source-product-slug retailer route
6. Unique exact source-product slug plus retailer mapping
7. Unresolved or ambiguous

Fuzzy title matching never creates an executable job.

## Dedupe

- Transport dedupe: one source connection plus external event ID.
- Incident dedupe: one listing/event/offer fingerprint within a bounded window.
- User-action idempotency: user, mission, incident, strategy revision, and action.
- Mission claim: at most one active non-notification job across sibling retailer
  listings for one mission.

Closing an incident after `offer_rejected`, `expired`, or a pre-mutation cancel
allows a newer source event to create a legitimate new incident. A confirmed or
uncertain mutation retains the mission lock. Manual-review and
submission-uncertain states remain blocking even after their original lease or
signal window expires; only explicit browser-state review can release them.

## Affiliate routing

Canonical retailer URLs establish identity. Attribution routes are selected only
after resolution and are snapshotted onto a job. Default policy is to prefer a
validated affiliate route and fall back to the exact canonical listing within a
strict latency budget. Affiliate failure cannot relax any commerce validation.

Raw Amazon offer IDs are volatile. Yoink may retain a one-way fingerprint for
dedupe, but it does not write the token into SQLite, diagnostics, or audit data.
The Amazon observer may construct a validation route in isolated page execution,
but returns only a boolean receipt. The add runner never uses Buy Now navigation;
it revalidates the same in-memory token and clicks only Add to Cart.

## Deployment evolution

The current local release is a modular monolith with separated trust surfaces:

- Local API and SQLite control plane
- Guided exact-product purchase dashboard plus a separately permission-gated
  admin UI
- Persisted RBAC and a governed manual catalog-write queue
- Chrome companion with independently qualification-gated Target, Walmart, and
  Amazon, and Best Buy add-only executors
- Explicit, read-only Walmart Draw discovery with exact private mission matching
  and no contingent-order entry capability
- Exact-version local companion package feed for unpacked-extension updates

The future deployment moves shared control-plane data to PostgreSQL and adds a
web application, durable device queues, and tenant isolation. Chrome remains the
only executor; a web or backend service never gains retailer-session authority.
