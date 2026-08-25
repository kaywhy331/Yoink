# Yoink

Yoink is the ground-up successor to CartCollect: a local-first, signal-driven
commerce control plane whose only retailer-session executor is a paired Chrome
extension.

Yoink 0.53.0 continuously accepts TrackaLacker Web Push, preserves the complete
followed-product catalog (including unavailable and unsupported listings),
resolves exact product/listing identity, creates one mission per variant,
evaluates ordered user strategies, deduplicates competing source events, and
records every decision in SQLite. Target, Walmart, Amazon, and Best Buy now have
separate, exact-version add-to-cart lanes. Each lane requires its own current evidence,
no-click rehearsal, and explicit local activation; upgrading never activates a
new lane. Every lane is restricted to first-party shipping offers, quantity one.
Amazon additionally requires a unique ASIN-bound offer token that remains only
in page memory. Buy Now, checkout, and order submission are not authorized.

Version 0.53.0 adds bounded retention for quarantined observer-recipe recovery
evidence and its contributor review history. Migration 46 defines a 90-day
inactivity policy: the latest evidence or review activity starts the clock, and
the existing six-hour privacy/telemetry maintenance task removes at most 500
expired evidence rows per user per run. Review events cascade only with the
eligible evidence; premature direct deletion remains blocked by the database.

Every effective cleanup writes an immutable aggregate receipt containing only
the policy, cutoff, and deleted row counts. It never copies a normalized value,
SKU, recipe, layout, or review answer. The user dashboard explains automatic
expiry in plain language, the admin registry reports policy/aggregate status,
and self-service export includes a user's receipts. User deletion remains an
intentional privacy cascade. Retention cannot apply evidence, fill a field,
promote or qualify a recipe, change a plan, create a job, reserve spend, or
invoke Chrome. See
[recovery-evidence retention](docs/OBSERVER_RECIPE_RECOVERY_RETENTION.md).

Version 0.52.0 gives each contributor a simple, owner-scoped way to review the
quarantined normalized store details introduced in 0.51. The Preferences
workspace asks whether the exact public value was correct, incorrect, or
whether an earlier confirmation should be withdrawn. Requests accept only a
fixed decision and its exact confirmation phrase; free text and page/account
context are not part of the contract.

Migration 45 records each real decision as a sequenced append-only event bound
by composite tenant/user/evidence identity and a deterministic evidence hash.
Retries are idempotent, current state is a projection rather than an evidence
edit, and user deletion remains an intentional privacy cascade. Reviews are
included in self-service export and projected in the admin registry. They do
not fill observations, affect promotion or qualification, change plans, create
jobs, reserve spend, or invoke Chrome. Production account/device reputation,
region-aware independent quorum, measured conflict SLOs, and a separately
governed read-only application projection remain open. The bounded retention
policy arrives in 0.53. See
[recovery user review](docs/OBSERVER_RECIPE_RECOVERY_USER_REVIEW.md).

Version 0.51.0 adds the first provenance-bearing storage boundary for a field
that a signed observer recipe can recover while the bundled observer is
missing it. Trial contract v3 may send only a normalized availability, USD
cents, bounded public seller name, shipping/pickup state, or Add-control
boolean—and only when the fixed packaged structured-page oracle reads the exact
same value. Chrome and the server independently validate the payload.

Migration 44 stores that evidence in an append-only quarantine bound to the
authenticated contributor/device, exact SKU, layout, recipe, trial, and
server-known lifecycle stage. Every row is `not_applied`; the admin UI exposes
its provenance and the user-data export includes it. There is no endpoint or
repository path that can apply it to an observation, catalog, qualification,
plan, job, or browser action. Automatic field fill, public account reputation,
regional quorum, signing/promotion, mutation, checkout, and order submission
remain closed. See
[observer-recipe recovery evidence](docs/OBSERVER_RECIPE_RECOVERY_EVIDENCE.md).

Version 0.50.0 makes signed observer-recipe canaries contributor-aware and
stage-aware before any recipe-derived field can become product evidence.
Migration 43 stamps each new trial with the server-known recipe lifecycle
stage. Promotion counts only the latest trial for one tenant contributor,
exact SKU, layout, and stage, so retries and extra paired devices cannot inflate
quorum. Worker-generated canary entry requires two distinct tenant users and
devices; trusted read-only requires a 24-hour burn-in plus three canary users,
devices, SKUs, and two layouts.

Canary delivery is assigned deterministically to 25% of tenant accounts. A
canary with at least four current cohort trials automatically kills and
undistributes when at least two contributors fail and failing contributors are
at least half of the cohort. This is a conservative tenant-scoped safety seam,
not public account reputation or Sybil resistance. Automatic signing,
promotion, recipe field-fill, cross-region quorum, mutation, checkout, and
order submission remain closed. See
[observer-recipe canary governance](docs/OBSERVER_RECIPE_CANARY_GOVERNANCE.md).

Version 0.49.0 adds a fixed packaged structured-page oracle for the five-field
observer-repair lifecycle introduced in 0.48. Signed recipes are now compared
against both authoritative packaged evidence and a separately implemented
JSON-LD/microdata/accessibility reader. Trial v2 sends only fixed field/state
enums and derived counts; extracted values, selectors, DOM, URLs, and account
context never enter the receipt. Migration 42 preserves version-1 trials as
legacy evidence, which cannot satisfy a generated-repair oracle gate.

A worker-generated repair still requires explicit review before shadow
distribution. Canary promotion now requires oracle-complete agreement on every
field across two exact SKUs; trusted read-only promotion requires five complete
trials, three SKUs, and two layouts. One conflict with known packaged evidence
immediately kills and undistributes the recipe with bounded lifecycle and audit
evidence. Automatic signing/promotion, recipe-derived observation field-fill,
public independent-account consensus, checkout, and order submission remain closed.
See [packaged observer-recipe oracle](docs/OBSERVER_RECIPE_ORACLE.md).

Version 0.48.0 extended privacy-bounded observer repair mining across all five
fixed read-only fields: availability, unit price, seller, fulfillment, and add
control. On an exact unblocked product/offer page, field semantics are evaluated
locally and only one globally unique allowlisted element/attribute/value
landmark per field can cross the extension boundary. Page HTML/text, observed
prices, seller names, stock labels, fulfillment labels, arbitrary selectors,
and offer/session material remain outside the repair payload.

The durable signing-free compiler can group mature field suggestions for one
layout into a single fixed-mode recipe candidate. A five-field candidate is now
representable and tested; partial candidates are intended only for missing
read-only fields, but runtime field-fill remains disabled. Automatic processing
still stops at unsigned 30-day quarantine. The
external or independent-account correctness oracle, cross-account/Sybil-resistant
consensus, regional/public-reputation canaries, and automatic validation/promotion remain deliberately
open. See [adapter repair intelligence](docs/ADAPTER_REPAIR_INTELLIGENCE.md)
and [durable observer-repair candidate evaluation](docs/OBSERVER_REPAIR_CANDIDATE_EVALUATION.md).

Version 0.47.0 gives privacy-bounded observer correction its own durable worker
family. When one open Add-control selector miss independently reaches the
existing three-device/two-exact-SKU local threshold, the worker can compile its
allowlisted stable attributes into one unsigned, quarantined observer-only
candidate. Repeated runs reuse the same scoped fingerprint, and migration 41
preserves existing worker history while adding the seventh closed task kind.

Automatic processing stops at quarantine. Generated candidates contain only
the fixed read-only `addControl` field, carry no signature or trust generation,
expire after 30 days, and cannot distribute or execute. The standalone worker
has no recipe signing-key dependency. Explicit protected maintainer promotion,
rooted signing, measured shadow/canary trials, rollback/kill-switch behavior,
and the hosted witness gate remain mandatory; mutation runners never consume
remote recipes. See
[durable observer-repair candidate evaluation](docs/OBSERVER_REPAIR_CANDIDATE_EVALUATION.md).

Version 0.46.0 makes guided purchase setup server-authoritative before it
writes. As the user changes an exact item, quantity, price limits, delivery,
action, or timing, the setup dialog obtains a no-purchase-write preview of the
normalized plan, worst-case item/tax/store reserve, remaining headroom, and the
same readiness explanation that will appear after save. Any change clears the
acknowledgement and disables creation until the new preview passes.

The five-minute contract-v2 receipt binds the private user, normalized draft,
accepted listing, current reserve calculation, current readiness, and issue
instant. Creation recalculates all of it and rejects a changed or expired
preview. The receipt is not an action capability and is not stored in audit or
outbox payloads. Existing contract-v1 clients remain compatible. See
[purchase-plan preflight](docs/PURCHASE_PLAN_PREFLIGHT.md).

Version 0.45.0 makes every user purchase plan explain its real automation
state. A server-derived readiness contract evaluates the current plan revision,
enabled exact targets, packaged mappings, separately qualified retailer lanes,
paired companion version and adapter capabilities, signal connection, global
pause, execution mode, and expiry. The user dashboard now distinguishes a
configured mapping from an armed lane, shows the next safe step, and provides a
plain-language checklist. “Armed” never means an offer is currently in stock:
Chrome must still bind a fresh exact item, price, first-party seller, shipping
offer, quantity-one action, and usable Add control at action time.

Plan quantity remains the user's overall desired amount; each guarded cart
attempt adds exactly one. Direct reviewed plans already enforced that boundary.
The live engine now also converts a legacy advanced-strategy multi-unit add to
a notification before creating a spend reservation, while shadow mode retains
the requested quantity for observable simulation. A live match for any
unqualified retailer lane likewise becomes a notification before spend is
reserved. Target and Walmart remain the only qualified lanes in the current
local deployment; Amazon and Best Buy remain closed until their independent
qualification is explicitly activated.
See [purchase automation readiness](docs/PURCHASE_AUTOMATION_READINESS.md).

Version 0.44.0 hardens the tenant-local community inventory projection. Exact
selected-offer evidence is now reduced to each contributor's latest eligible
assertion, so one account cannot multiply its influence with repeated rows or
multiple paired devices. A contributor's newer stock state supersedes their
own stale state instead of conflicting with it; current disagreements between
independent contributors still fail closed.

Price projection now requires three current price votes, uses their median,
and exposes only bounded range/count metadata. Short evidence TTLs, healthy-
device eligibility, exact seller/fulfillment/location isolation, and the three-
current-contributor/device advisory threshold remain enforced. This is a local
projection contract and explicitly has no mutation authority. It does not ship
the production shared evidence service, pseudonymous cross-account identity,
reputation, Sybil defense, or abuse operations required for a real community
network.

Version 0.43.0 adds governed recovery and a sanitized service-level projection
for operator-alert connectors. Migration 40 replaces the permissive delivery
update guard with an exact transition contract: identity, payload, idempotency
key, endpoint binding, privacy class, and creation evidence are immutable.
Only a dead letter may return to pending, and only through `alert.manage`, an
explicit allowlisted reason and confirmation, the same enabled/bound connector,
and a three-replay lifetime ceiling. The original delivery ID is reused so a
receiver can continue to deduplicate it; nothing can be edited or retargeted.

The Alerts workspace now derives idle, healthy, degraded, critical, disabled,
and unbound states from a 24-hour append-only receipt window and a five-minute
delivery SLO. Recent retries and recovered dead letters remain visible in the
rate instead of being erased by a later success. An expired twelfth-attempt
lease is deterministically dead-lettered on the next worker cycle rather than
becoming stranded. This adds no URL/secret storage, arbitrary egress, product
notification, retailer action, checkout, or purchase authority.

Version 0.42.0 adds durable, HMAC-signed webhook delivery for privacy-classified
operator alerts. Admins bind an alert connector only to an opaque
deployment-owned reference; URLs and signing secrets are never accepted by the
API or stored in SQLite. The fixed alert worker leases each bounded aggregate
delivery with a one-use capability, retries transient failures, dead-letters
redirects/permanent failures, and records append-only attempt receipts.

Reference, endpoint, and secret-variable name are pinned by a public binding
fingerprint on both connector and queued delivery. A changed deployment binding
cannot lease old work; an explicit admin re-save cancels it before accepting
the new destination. Worker attestation advances to contract 2 and covers the
public connector registry, so API/worker registry drift also closes leasing.
This is a webhook slice, not email/pager integration, managed secrets, egress
enforcement, PostgreSQL fleet delivery, or purchase authority. See
[operator alert connectors](docs/OPERATOR_ALERT_CONNECTORS.md).

Version 0.41.0 adds an API-owned deployment contract for background work.
Migration 38 records the expected mode and a secret-free SHA-256 fingerprint of
the exact Yoink version, closed task registry, witness requirement, endpoint,
log namespace, public key pin, and maximum receipt age. Actual configuration
changes append a hash-chained operational event; unchanged restarts do not add
history. Heartbeats retain only the fingerprint, never raw key or endpoint
configuration.

A standalone worker with a missing or different expectation may report one
bounded mismatch state, but it cannot create schedules, enqueue work, or lease
a task. External health and the Operations workspace require current coverage
with the exact fingerprint and reject any concurrently online mismatch. This
protects against accidental package or public trust-configuration drift; it is
not hardware remote attestation, binary-signature verification, PostgreSQL
fleet identity, or a secrets system. Already-leased recovery remains bounded,
and deployment changes still stop the worker before the API. No retailer action
is widened. See [worker deployment attestation](docs/WORKER_DEPLOYMENT_ATTESTATION.md).

Version 0.40.0 makes observer-recipe witness freshness durable worker work
instead of a manual production dependency. Migration 37 adds a sixth closed
task family that checks the exact installed, package-rooted transparency tip,
skips network access while its matching independent receipt is comfortably
fresh, and refreshes it before either configured freshness or signed validity
expires. Unavailable, invalid, conflicting, or stale witness responses remain
bounded retry failures and hosted recipe delivery continues to fail closed.

The standalone worker receives only the pinned witness public configuration
and reloads the root-signed public trust manifest for every bounded run. It
does not load the observer intermediate private signer, and the external
witness private key remains outside Yoink entirely. Hosted API and worker
processes must receive the same witness configuration; local deployments with
no witness retain a transparent safe no-op. This automates receipt renewal but
does not provide the independently operated witness service, a public
consistency monitor, PostgreSQL, or automatic recipe promotion, and it widens
no retailer action. See [observer witness refresh](docs/OBSERVER_WITNESS_REFRESH.md).

Version 0.39.0 completes the repository-side hosted Chrome transport seam.
Hosted mode now requires an exact allowlist of packaged Chrome extension
origins and checks it before pairing-code or bearer resolution. The exact
one-time pairing code body resolves only its owning tenant/user; current and
unexpired previous credentials resolve ordinary device routes, while a pending
credential resolves only the two-phase commit route. An invalid bearer cannot
fall back to trusted-proxy identity headers.

The extension now has package-owned local and production runtime profiles. A
production build requires exact non-loopback HTTPS API/app origins, emits only
that API host permission, uses browser-managed updates, and contains no local
ZIP behavior. Hosted mode disables both unpacked-extension release endpoints
and omits their onboarding link. This is verified deployment structure—not a
published browser release, TLS/IdP/PostgreSQL implementation, or production
fleet—and it widens no retailer action. See
[hosted Chrome device transport](docs/HOSTED_DEVICE_TRANSPORT.md).

Version 0.38.0 adds recoverable two-phase rotation for paired Chrome device
credentials. After 30 days, the companion prepares a random next-generation
credential, persists it locally, and then commits that exact generation. A
lost begin response leaves the current token untouched; a lost commit response
is retried from the durable pending token before heartbeat. Commit is
idempotent, pending tokens cannot call ordinary device APIs, and the previous
credential has only a two-minute in-flight grace period.

Migration 36 backfills existing devices at generation one without rotating or
revealing their current token. The database stores only domain-separated
hashes, rejects partial recovery state with cross-field triggers, clears
pending/previous hashes on revocation, and records sanitized audit and closed
telemetry events. Admin sees generation/readiness only. This advances the Phase
2 hosted-device foundation but is not production identity, TLS, or device-risk
infrastructure, and it widens no retailer action. See
[device credential rotation](docs/DEVICE_CREDENTIAL_ROTATION.md).

Version 0.37.0 adds privacy-bounded repair intelligence to the immediate
extension diagnostic path. On an unblocked exact product page, a packaged
observer that misses one otherwise recognizable Add control may report at most
five locally unique structural landmarks. Each landmark is limited to a fixed
button-like element kind and one stable `data-*`, button-state, or `name`
attribute. Page HTML/text, IDs/classes, URLs, SKUs, product/form values, dynamic
numeric/hash identifiers, credentials, account/contact data, and
checkout/payment vocabulary remain excluded. The service worker and server
independently reconstruct and validate the allowlist before anything is
retained.

The repair queue aggregates matching landmarks by exact layout, distinct
paired device, and distinct retailer SKU, then derives a non-executable
read-only selector suggestion for maintainers. Three devices and two exact SKUs
mean only **maintainer review ready**—never trusted, published, or safe to run.
At 0.37 suggestions could not enter the registry. Version 0.47 may now compile
that thresholded evidence into an unsigned quarantine candidate, but it cannot
promote, sign, trial, distribute, or execute it automatically. This is a
tenant-scoped correction aid, not the future
cross-account community trust plane, and it widens no retailer action. See
[adapter repair intelligence](docs/ADAPTER_REPAIR_INTELLIGENCE.md).

Version 0.36.0 makes authenticated TrackaLacker signal intake durable before
evaluation. The Chrome device request validates and normalizes the packaged
push contract, discards any ephemeral offer ID, atomically accepts or
deduplicates a tenant/user-scoped `signal_event_v1` inbox row, and queues an
immediate priority worker wake before returning `202`. `SignalEngine` no longer
runs in that device request; the embedded or standalone worker evaluates at
most 25 messages per task under the same principal scope. The local/manual
`POST /api/v1/signals` compatibility route remains synchronous.

Processing failures retry with a fixed redacted code and stop after 20 inbox
claims. An uncertain post-commit acknowledgement is left for lease recovery;
transport idempotency makes the recovered evaluation a duplicate instead of a
second side effect. Migration 35 changes only the untouched hosted-delivery
schedule default to a 15-second **Signal inbox and delivery recovery** fallback.
Pausing that schedule defers new wakes without losing intake. The Operations
workspace shows bounded signal-inbox state and lets an authorized operator
retry one dead letter after a correction, without exposing its payload or any
capability. Health advertises the durable request boundary. This remains a
SQLite local/staging milestone, not PostgreSQL or a production worker fleet,
and it widens no retailer action. See [durable signal ingress](docs/SIGNAL_INGRESS.md).

Version 0.35.0 extracts background execution behind an asynchronous store and
handler contract and ships a separately runnable worker process. The SQLite
adapter enumerates tenant/user principals with bounded keyset pagination,
scopes every schedule, lease, transition, and heartbeat to its owner, and keeps
the embedded worker as the zero-configuration local default. Operators can set
the API to `external` mode and supervise `npm run start:worker` independently;
health then reflects the standalone heartbeat and complete principal coverage.

The worker refuses to create or migrate a database: the API remains the sole
schema owner and must initialize the exact current schema first. Ambiguous
completion is fail-closed—the worker never attempts a contradictory failure
transition after an uncertain success—and exception content is not persisted
or printed at startup. A real child-process integration test covers startup,
all-principal work, external API health, graceful shutdown, and outage
reporting. This is a strong SQLite process boundary for local and staging use,
not PostgreSQL or a production worker fleet, and it widens no retailer lane.

Version 0.34.0 adds a durable local background-work boundary. Migration 34
stores five closed maintenance schedules, capability-leased tasks, append-only
transition receipts, and runtime heartbeats. The bundled worker runs outside
HTTP request handling and performs only idempotent action/spend safety recovery,
Chrome notification lease recovery, hosted inbox/outbox lease recovery,
sanitized adapter-alert reconciliation, and operational telemetry retention.
It cannot create a signal, authorize a retailer action, click an Add control,
enter checkout, or submit an order.

Task claims use one-use random capabilities whose hashes alone reach SQLite.
Expired claims receive a new capability, handler failures retry with bounded
backoff, and exhausted tasks stop in dead letter until an authorized operator
retries them. Successful and cancelled task history is retained for 30 days
and pruned by the retention handler; unresolved dead letters are preserved.
Schedule changes, manual runs, and retries require the new
`worker.manage` permission and write audit/outbox receipts. The **Operations**
workspace shows safe counts, results, schedules, task states, and 30-second
worker heartbeats, with pause/resume, run-once, and retry controls that expose no
payload or capability material. Two-connection contention, crash recovery,
tenant isolation, failure redaction, and route authorization are covered by
automated tests. This is the local modular-monolith seam, not PostgreSQL or a
deployed production worker fleet, and it widens no retailer capability.

Version 0.33.0 adds a self-service **My data** inventory and a versioned,
privacy-scoped JSON download. Migration 33 grants the baseline user role a
dedicated `user.privacy.export` permission without changing any retailer
capability. The archive is assembled inside one read transaction from eight
plain-language categories covering the authenticated user's account,
preferences, plans, sources, actions, device evidence, community work, and
activity. Every query binds both the current tenant and user where the schema
supports them; shared catalog material appears only as an exact public
reference attached to that user's own record.

The export never selects device-token hashes, pairing-code hashes, hosted or
community request nonces, action capabilities, notification capabilities, or
inbox lease capabilities. A schema-coverage test fails if a future table gains
a user-ownership edge without an explicit export disposition, and cross-tenant
fixtures prove another user's records cannot enter the file. Downloads are
`no-store`, carry an exact byte length and SHA-256 header, and remain separate
from the full-database operator portability archive. Broader account deletion
stays visibly closed until production identity revocation and a deletion-
specific cleanup/reconciliation workflow on a deployed worker fleet can prove
complete cleanup; existing contribution-specific deletion controls are
unchanged. No seller, fulfillment, checkout, drawing-entry,
payment, or order capability is widened.

Version 0.32.0 adds a five-step, plain-language setup guide to the user
dashboard. It distinguishes a current/online Chrome companion, connected signal
source, reviewed exact product, active bounded plan, and the current action
boundary. A paired but outdated or offline companion, a product still in
review, paused actions, shadow mode, and a hosted approval request each remain
visibly distinct instead of being presented as ready.

Users can now paste an exact product-page link for any of Yoink's thirteen
supported retailers. The server—not the browser form—binds the supported
domain, exact retailer SKU, and tracking-free canonical URL and rejects search,
category, drawing-hub, insecure, credential-bearing, and mismatched links. The
two-stage dialog shows the extracted store/SKU before explicit confirmation.
Submission creates only a private informational `user_link` provenance record
and a pending catalog proposal. It cannot assert availability or price, record
an offer observation, create a plan, or authorize an action. Independent catalog
review remains required; retailer qualification, saved caps, trusted fresh
evidence, and Chrome revalidation remain separate later gates.

Catalog ingestion now enforces URL-to-SKU binding for every source, including
query-key identities such as Macy's. Hosted action resume responses that require
two-person approval remain visibly paused instead of being reported as enabled.
This release needs no database migration and does not widen any retailer,
seller, fulfillment, checkout, drawing-entry, payment, or order capability.

Version 0.31.0 adds an enforceable high-risk administrative change boundary.
Migration 32 stores tenant-scoped, exact-payload change requests, independent
decisions, and append-only lifecycle events. Hosted requests carry proxy-signed
authentication assurance, authentication time, and session identity; a fresh
step-up is valid for at most five minutes. Role grants, rooted observer-trust
installation, recipe promotion/rollback, retailer mutation-lane activation,
and resuming purchase actions require approval by a different authenticated
user and actor. Role revocation, recipe re-sign/disable, affiliate-policy
replacement, and existing catalog review decisions require a fresh sign-in.
Emergency pause remains immediate.

Approval never performs the mutation. The exact original operation must be
retried before its 15-minute request expires; payload drift, cross-tenant
access, stale assurance, self-approval, expiry, and replay fail closed. The
authorization is consumed in the same SQLite transaction as the protected
change. Only an allowlisted operation label, bounded safe summary, and one-way
payload hash are retained—never arbitrary request bodies or credentials. The
new **Approvals** workspace explains pending, approved, consumed, rejected, and
expired changes in plain language. Exact loopback/offline setup remains usable
and records local-trusted receipts, but its internal marker cannot be supplied
through hosted headers. This release ships the enforcement contract, not an
identity provider or MFA service; hosted operators must still integrate one.

Version 0.30.0 adds a privacy-bounded operational health plane. Migration 31
stores ordinary API traffic only as tenant-scoped minute rollups over fixed,
package-owned route groups, HTTP outcome classes, actor kinds, and latency
bands. Individual rows are retained only for 4xx/5xx failures and contain a
one-way correlation key, fixed route group, method, status, duration, and a
server-owned error code. Raw URLs and query strings, request/response bodies,
messages, product or listing identifiers, user-entered values, browser content,
credentials, and offer tokens are never telemetry dimensions or payloads.

The permission-gated **Operations** workspace reports 1-hour, 24-hour, 7-day,
and 30-day service health, route error rates, bounded latency, safe failure
families, and recent correlations. Detail expires automatically after 30 days;
each deletion that removes rows writes an immutable aggregate retention
receipt. Capture is fail-open for request delivery, tenant isolated, and cannot
authorize or alter any purchase action. Retailer qualifications and mutation
boundaries are unchanged.

Version 0.29.0 removes the hidden advanced-strategy dependency from reviewed
user purchase plans. Migration 30 adds an append-only decision mode and signal
freshness bound to each intent revision, plus an explicit decision source on
mission decisions and action jobs. A guided plan now evaluates its enabled
exact listing, trusted-exact source, verified seller and fulfillment, current
numeric price, caps, expiry, and 120-second freshness window directly—even when
no strategy exists. Informational sources can notify but cannot authorize a
retailer action.
Its notification choice cannot be widened by an add strategy. Source-created
missions retain ordered-strategy behavior, so existing integrations remain
compatible without generated or hidden per-product strategies. Existing 0.28
reviewed plans receive a new immutable direct-mode revision during migration;
their prior revision remains unchanged.

The plan editor now preflights every enabled cart target and the same
quantity/tax/store-fee all-in bound enforced by the repository. The server
independently rejects any cart revision containing a monitor-only mapping,
missing item cap, non-first-party seller policy, non-shipping fulfillment, or
insufficient all-in cap, and the surrounding mission/target update rolls back.
Direct jobs carry no fake strategy foreign key, are audited as
`purchase_intent`, and lease through the existing qualified Chrome, immutable
offer, spend-reservation, and recovery contracts. No retailer capability is
widened; checkout, payment, pickup mutation, marketplace sellers, and order
submission remain closed.

Version 0.28.0 replaces the dashboard's create-then-edit shortcut with one
guided exact-purchase review. Choosing a catalog listing does not write a
mission or authorize a click. The user first reviews the exact SKU and variant,
retailer-as-seller, fulfillment, quantity, per-item cap, all-in cap, timing,
and either notification-only or guarded add-to-cart authority. One confirmed
request then creates the mission, complete target set, and custom immutable
intent revision atomically; only the chosen listing starts enabled. Invalid or
duplicate reviews leave no partial state. Legacy user API creation now starts
notification-only, while signal/internal creation retains its existing
strategy behavior. Newly discovered sibling listings join existing missions
disabled so catalog growth cannot silently widen store consent. Product cards
distinguish the latest observed numeric price from catalog MSRP and expose
exact variant dimensions; cart review also shows the conservative tax/store-fee
bound used by the action engine. Checkout, payment, marketplace sellers,
substitutions, pickup mutation, and order submission remain closed. This
release needs no database migration and changes no retailer qualification.

Version 0.27.0 adds migration 29 and a deployment-pinned external-witness seam
for observer-recipe transparency. The server publishes only a bounded public
checkpoint (root/manifest hashes and the current append-only transparency
sequence/hash) to a separately operated HTTPS endpoint. It verifies the
returned Ed25519 signature, exact checkpoint, witness sequence, predecessor
receipt, lifetime, and deployment-pinned public key before storing immutable
receipt/check rows. Hosted mode now requires witness configuration and returns
a correlated `503` instead of distributing an active recipe until its newest
transparency tip has a fresh valid receipt; every new manifest install or
recipe signature advances that tip. `/admin` and `/api/v1/health` expose
healthy, pending, degraded, stale, or inconsistent state and fixed-code alarms.
Local/offline mode remains compatible and does not require a witness. Yoink
does not include or operate the independent service or its private key, so a
production operator must still deploy and monitor that separate trust domain.
No selector, product, browsing, user, account, token, or mutation data enters
the witness contract, and this release changes no retailer capability.

Version 0.25.0 adds migration 27 and an exact selected-offer identity spine for
read-only community evidence. The packaged observers emit only the
server-verified public retailer SKU plus normalized selected size, color,
edition, language, pack, condition, finish, and style values. The server
re-normalizes those fields, rejects child-ID mismatch or unapproved dimensions,
and derives the durable fingerprint itself. Exact variants now receive separate
observation keys even when they share one retailer listing; listing-only or
ambiguous selection is visibly quarantined and cannot publish community stock.
Seller, fulfillment, and country/region/one-way store scope remain separate key
dimensions. Opaque Amazon offer IDs remain ephemeral, and this release changes
no retailer mutation qualification or authority. See the
[selected-offer identity contract](docs/SELECTED_OFFER_IDENTITY.md).

Version 0.26.0 introduces `bestbuy-observer-v5` for the four supplied Best Buy
layouts: preorder, high-demand/manual gate, pickup-selected limited stock, and
ordinary inventory. Standalone visible Pre-order controls are now recognized,
and an exact high-demand offer may retain its bounded SKU, price, seller, and
selected fulfillment as read-only evidence while the control remains
non-actionable. Actual queues remain separate manual boundaries. Popup guidance
identifies preorder, high-demand, queue, and pickup states instead of asking for
the same generic retry. Preorders cannot satisfy Best Buy's in-stock
qualification checks or pass `bestbuy-add-v3`; pickup, high-demand handling,
queues, checkout, and order submission remain closed. Sanitized
`interactive_high_demand` diagnostics reach the server without DOM, page text,
URLs, account data, or tokens. Migration 28 retires only inherited Best Buy
qualification and execution flags so v4 evidence cannot authorize the v5
boundary; fresh v5 evidence and explicit review are required.

Version 0.24.0 replaces observer-recipe trust-on-first-use with a public offline
root pinned independently in the API package and Chrome companion. Migration 26
retires every legacy signed recipe, then stores immutable root-signed manifest
generations and chained transparency receipts. One root-authorized online
Ed25519 intermediate signs expiring, declarative read-only recipes. The
companion verifies the complete manifest chain, permanent revocations, active
key, transparency checkpoint, recipe signature, schema, and expiry, and pins
the latest generation against rollback. Rooted rotation and renewal tooling,
an admin install/status surface, and explicit audited recipe re-signing are
included. None of this downloaded data can navigate, click, fill forms, decide
identity, qualify a retailer, or widen mutation authority.

Version 0.23.0 adds a tenant-scoped, privacy-classified operator alert path for
adapter repair failures. An accepted sanitized companion diagnostic and its
matching alert reconciliation commit atomically. Configurable rules can narrow
by retailer and operation, set severity, threshold, dedupe and escalation
windows, and route immutable receipts to the admin dashboard and durable audit
outbox. Operators with `alert.manage` can acknowledge or resolve an incident;
the same structural group auto-resolves when its diagnostic recovers, while a
strictly later failure may open new work. Alert projections expose only stable
allowlisted reason codes, structural fingerprints, bounded counts, and a
pseudonymous contributor cohort—never exact product IDs, page content, URLs,
tokens, account data, or operator notes. Alert rules carry no retailer mutation
authority. Version 0.42 adds a bounded signed-webhook worker path; version 0.43
adds exact bounded dead-letter replay and a local sanitized health/SLO
projection. Email/pager providers, managed secrets, and independent production
on-call monitoring remain roadmap work.

Version 0.22.0 adds a separate read-only Walmart Collectibles Draw lifecycle.
An explicit companion action observes only the exact draw hub, extracts bounded
item ID, title, price, first-party seller, draw state, close time, condition,
quantity limits, and the fact that normal Add is suppressed, then writes a
sanitized migration-24 ledger. User and admin views match each exact Walmart
item ID to an existing purchase plan and automatically hide expired drawings.
Observer/runtime failures are reported immediately with allowlisted codes. The
integration never reads or stores account, address, payment, membership,
session, cookie, entry-token, or entry-status data. It cannot enter a drawing:
Walmart drawing entry is irrevocable and authorizes a future automatic charge
and order if selected, so it is isolated from the qualified Walmart add-only
lane and remains manual pending a separately designed high-risk capability.

The community pilot is explicit and read-only: users opt in per retailer
and deliberately share one server-reconstructed sanitized observation at a
time. Exact selected variants are isolated by a server-derived fingerprint;
listing-only or unresolved selections stay quarantined. Each contributor's
latest eligible assertion is their only current vote, and current prices use a
median/range projection; repeated assertions and extra devices do not increase
that contributor's weight. Exact
product-equivalence claims require strong identifiers and never remap the
private catalog. Signed expiring observer recipes can evaluate five fixed
read-only fields in shadow/canary mode; packaged code verifies the offline-root
chain, revocation state, signature, and schema, and downloaded data can never
click or navigate.

Hosted portability now includes request-bound tenant/user repositories,
replay-protected signed proxy scopes, automatic paired-device scope resolution,
idempotent principal provisioning, and leased inbox/outbox delivery with
dead-letter receipts. A streaming, checksummed portability archive can be
verified, restored into a fresh SQLite database, and reconciled table by table
without an item-count cap. Local mode remains the default; see the hosted
deployment contract before enabling the boundary mode.

Version 0.19.0 adds the first production-shaped application spine without
changing retailer mutation authority. Persisted roles and granular permissions
now authorize explicit user, admin, device, and internal API surfaces; an
`actorKind` label alone grants nothing. Every HTTP failure has a correlation ID
and safe status taxonomy. Manual catalog changes enter a normalized review
queue and cannot update the shared commerce graph until an authorized curator
approves them. The root page is now a minimal product and purchase-preference
dashboard, while the permission-gated operations console lives at `/admin`.

Version 0.20.0 adds the private purchase-safety spine. Every new actionable
job binds an immutable exact-offer key and sanitized offer snapshot to the
current append-only mission intent revision. Intent policy now covers exact
retailer targets, unit and all-in caps, quantity, seller, fulfillment, action
ceiling, expiry, cooldown, and substitution rules. Transactional reservations
prevent concurrent jobs from exceeding remaining quantity or optional
per-order, daily, and monthly user limits; an append-only ledger records every
reserve, release, and future verified purchase commit. Leasing fails closed
when the intent revision or reservation is stale. Add-to-cart confirmation now
releases its reservation and never counts as a completed purchase. Checkout
and order submission remain closed.

Version 0.21.0 adds reversible local catalog identity governance. Migration 23
introduces separately authorized proposal and approval permissions, immutable
before/after topology snapshots, and an append-only sequenced operation ledger.
A merge requires a reviewed conflict-free exact-identifier claim for the exact
variant pair, matching explicit variant dimensions, and a different authorized
user and actor for approval. A split moves only named listings into a newly
identified variant, requires an explicit changed dimension, and refuses to
divide one purchase intent across both sides. Active purchase jobs or spend
reservations, stale topology, and ambiguous downstream mappings all fail
closed. Compensation restores exact recorded row identities only when the
post-operation topology has not drifted. Because the current commerce graph is
shared, application of these operations is disabled as soon as more than one
tenant exists; production hosted curation still needs a separate global
authority and step-up approval plane.

Disney Store, Ravensburger, Riot Games Merch, Books-A-Million, Fanatics,
Kohl's, Macy's, Premium Bandai, and Pokémon Center are recognized as
exact-identity catalog and browser observation stores. Their observers send
the same sanitized structural diagnostics, but all nine stores' mutation paths
remain closed. Premium Bandai distinguishes preorder, in-stock, and closed
item pages; Pokémon Center retains the complete hyphenated product/variant ID.
Observer v2 rejects Premium Bandai unavailable-page shells and Pokémon Center
Imperva frames as manual/security blocks, clears all offer fields, and never
publishes either response as out-of-stock evidence.

## Requirements

- Node.js 22.5 or newer
- Chrome 121 or newer for silent extension Web Push
- A normal signed-in TrackaLacker Chrome session for initial enrollment and
  manual followed-library synchronization

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:32991> for the user dashboard. The separate admin control
center is at <http://127.0.0.1:32991/admin>. Either page may be closed after
setup; the API process and paired Chrome companion continue handling push and
qualified work. Local data is stored under `data/` unless `YOINK_DATA_DIR`
points to another explicit directory.

The durable local worker starts embedded with the API and is visible under
**Admin → Operations → Background work**. For an intentional maintenance stop,
set `YOINK_BACKGROUND_WORKER_MODE=disabled`; health then reports `disabled`,
schedules and queued tasks remain durable, and no task handler runs until the
worker is re-enabled. Signal intake still returns a durable queued receipt, but
evaluation waits for the worker. Disabling the worker does not cancel an
already leased retailer action—use the user-facing **Pause Actions** control
for retailer mutation. The legacy
`YOINK_BACKGROUND_WORKER=1|0` switch remains compatible but cannot be combined
with the mode setting.

For independently supervised local/staging execution, build first, start the
API once in external mode so it owns database migration, and then start the
worker in a second process:

```bash
npm run build
```

Then run the API in terminal 1:

```bash
YOINK_BACKGROUND_WORKER_MODE=external npm start
```

And the worker in terminal 2:

```bash
npm run start:worker
```

Both processes must use the same explicit `YOINK_DATA_DIR`. See the
[background worker runbook](docs/BACKGROUND_WORKER.md) for modes, bounded
settings, health semantics, shutdown, and recovery. External SQLite mode is
not a substitute for the roadmap's PostgreSQL, fleet, backup/PITR, and
production identity gates.

SQLite migrations are transactional. An existing file is integrity-checked and
backed up with a `.before-vN.<timestamp>.sqlite` suffix before a pending schema
migration is applied.

For an offline, exact export/restore/reconciliation drill, use `npm run
portability -- drill ...` and follow the [data portability
contract](docs/DATA_PORTABILITY.md). Archives contain private state, are never
served over HTTP, and do not include observer-recipe root or intermediate key
files.

Observer-recipe trust initialization, renewal, rotation, revocation, restart,
and recovery procedures are documented in the [rooted trust
runbook](docs/OBSERVER_RECIPE_TRUST.md). The offline private root is never an
API input, server dependency, extension asset, release file, or portability
record.

## Load and pair the Chrome companion

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked**.
3. Choose `apps/extension` from this repository.
4. Open Yoink → **Preferences** and create a one-time pairing code (or use
   **Connections** in `/admin`).
5. Enter the code in the extension popup within five minutes.

Pairing stores a hashed device credential in Yoink and the runtime credential in
Chrome extension storage. The extension has no cookie API access and no
persistent retailer content script.

## Connect TrackaLacker

Stay signed in on a normal TrackaLacker tab, open the Yoink popup, and choose
**Connect TrackaLacker push**. The extension creates a real PushSubscription and
a minimal MAIN-world function submits the confirmed nested device contract from
the signed-in TrackaLacker origin. Push endpoint/key material, cookies, CSRF
values, Cloudflare/session values, and signed notification URLs never enter the
Yoink database, queue, telemetry, or logs.

Chrome 121+ supports a silent extension subscription, so TrackaLacker's normal
browser notification remains the visible alert. If Chrome reports that silent
push is unavailable, the popup states that the fallback can produce an extra
visible notification. Yoink still deduplicates signal incidents and action jobs
independently of desktop toast presentation.

Choose **Sync followed library** for a user-requested catalog pass. It has no
application product or mission-count limit and imports every source listing
returned by TrackaLacker, including out-of-stock, Best Buy, unsupported-store,
and alternate same-retailer records. Progress and per-product receipts are
durable. This is catalog synchronization, not stock polling; live inventory
events continue to arrive through Web Push.

## Configure behavior

The user dashboard stays focused on guided setup, exact products, purchase
plans, recent actions, and preferences. If the product is not yet approved,
choose **Add product link**, paste the store's exact product page and product
name, verify the extracted store/SKU, and explicitly send it for independent
review. That suggestion carries no stock or price claim and creates no plan.
For an approved listing, choose **Set up purchase**,
then review the item/SKU, store-as-seller, fulfillment, quantity, unit and total
caps, timing, and allowed action before anything is created. Notifications are
the default; add-to-cart is offered only for a qualified mapping, requires an
explicit shipping choice and a total that covers the current conservative tax
and store-fee safety bound, and still leaves checkout manual. Later changes use
the same revisioned plan editor. Reviewed plans decide exact matches directly;
advanced ordered strategies remain available as defaults for source-created
missions and specialist routing. Catalog
suggestions remain pending until reviewed in the admin control center. Detailed
source health, diagnostics, privacy-classified operator alerts, retailer
qualification, recipes, affiliate setup, catalog review, reversible
merge/split/compensation history, and role membership are intentionally
isolated under `/admin`.

There is no separate Signals start switch:

- Connected sources continuously ingest signals.
- A reviewed user plan directly produces its saved notification or qualified
  cart decision for a fresh exact offer; it does not require a hidden strategy.
- The default catchall strategy produces notifications for strategy-owned
  source/import missions.
- An exact trusted signal can create a new mission and attach all known retailer
  listings without overwriting user settings.
- A retailer listing discovered after a mission exists is attached disabled
  until the user explicitly includes it in a new intent revision.
- For strategy-owned missions, higher strategy rows win. Empty keywords mean
  catchall; quoted phrases, `+` terms, alternatives, and exclusions are
  supported.
- MSRP policies are maximums and include every lower price.
- Seller policy, allowed seller names, fulfillment, quantity, signal age, price
  cap, and exact source/store selections are evaluated before a job is created.
- **Pause Actions** persists and prevents new purchase jobs and leases while
  signal intake and history continue.

When two stores or sources report the same product, one active purchase job
claims the mission. Corroborating signals are recorded but cannot create a
second purchase. A verified rejection or pre-mutation cancellation releases the
claim for a legitimate later re-signal. A potentially mutated or uncertain job
stays locked until the user explicitly reviews the retailer session.

## Retailer safety

Walmart, Amazon, Best Buy, Disney Store, Ravensburger, Riot Games Merch,
Books-A-Million, Fanatics, Kohl's, Macy's, Premium Bandai, and Pokémon Center
have read-only visible-DOM observers; Target uses its separate observer. Only
the first four retailers'
evidence can feed independent add-only qualification dossiers. Amazon
inspection also proves that one unique live offer token is bound to the exact
ASIN and Add control. The token and any constructed validation route remain in
page memory and are discarded; only readiness and a reason code are persisted.
These observations never authorize mutation by themselves.

Walmart Collectibles Draw uses a separate `walmart-draw-observer-v1` contract,
not the normal Walmart product observer or `walmart-add-v3` qualification
dossier. From the exact `/shop/collectibles/draw` hub it records at most 24
normalized cards and reconstructs canonical item URLs server-side. Draw cards
are matched to private missions only by exact Walmart item ID. They are never
published as ordinary in-stock/Add evidence because Walmart suppresses Add on
these cards and selecting **Enter drawing** authorizes a contingent order. The
companion exposes no entry call, entry click, or drawing preference endpoint.

Every explicit retailer inspection now sends a second, authenticated adapter
diagnostic to the local server. If the packaged observer cannot be injected,
executed, found, collected, or contract-validated after an exact SKU and host
permission are established, the extension immediately sends a stable failure
code with an all-zero structural layout. Raw browser errors and page URLs are
never forwarded, and attempts before optional permission produce no telemetry.
Amazon, Best Buy, and the nine added read-only
inspections that stop at a binding boundary are retried across a
short, bounded hydration window before the result is returned. Diagnostics contain only allowlisted counts and enums describing
the layout and failure stage; page HTML/text, offer tokens, cookies, CSRF
values, addresses, and account data are rejected from this ledger. The control
center groups stable layout fingerprints into an adapter repair queue and marks
a group recovered when the same structure later passes. Transient hydration
failures recover automatically. Zero-layout observer-runtime incidents recover
only after every affected exact SKU later completes a successful inspection;
persistent parser failures still require a
reviewed adapter release rather than remotely supplied or self-modifying code.
Each newly opened repair group is also reconciled against tenant-owned operator
alert rules in the same database transaction as diagnostic ingestion. The
admin Alerts view exposes redacted incidents, rule configuration, immutable
lifecycle events, dashboard/audit-outbox delivery receipts, acknowledgement,
and resolution. Arbitrary diagnostic reason strings are rejected by both the
companion and server against one parity-tested contract, closing that field as
a channel for raw errors or exact product data. This operational path cannot
create, qualify, lease, or execute a purchase job.

Companion 0.17.0 also makes eligible adapter diagnostics durable across a
temporary local-server outage. Only the already-normalized payload is retained:
the outbox is bound to the paired device, deduplicated, limited to 50 entries,
expires entries before the server's acceptance window, and drains on startup
and the one-minute health cycle. Network failures, HTTP 408/429, and server
errors are retried; permanent client rejection is dropped. Exact retry
idempotency on ingestion prevents an ambiguous response from incrementing an
incident twice. This adds no page permission or retailer mutation capability.

Target's qualified `target-add-v1` runner requires:

- live execution mode, Actions unpaused, an online paired device, and a current
  adapter qualification;
- an immutable exact TCIN job with unit/total caps;
- quantity one, Target as seller, and shipping fulfillment;
- a provably empty cart;
- immediate live SKU, stock, seller, price, and fulfillment revalidation;
- a durable `adding` receipt before one click;
- exact cart-line verification afterward.

Walmart's separately gated `walmart-add-v3` runner applies the same immutable
job, empty-cart, at-most-once, cart-proof, and recovery boundaries. In addition,
shipping must be explicit in the live buy box, Walmart must be the seller, and
virtual queues, memberships, location prompts, authentication, MFA, or security
challenges stop the job before mutation.

Amazon's separately gated `amazon-add-v5` runner requires an exact ASIN,
Amazon.com as both first-party seller identity and shipping offer, quantity one,
a provably empty Amazon cart, and a unique offer token scoped with the price,
seller evidence, shipping evidence, and Add control. Observer v6 binds the
nearest exact product form before considering bounded local fallbacks, including
when Amazon deeply nests the Add control. Canonical `offerListingID` checkout
fields take precedence when they agree; `offeringID.1` is used only when the
canonical family is absent. Explicit checkout ASIN inputs take precedence over
variation-swatch `data-asin` markers. It recognizes both a combined visible
`Shipper / Seller` field and separate `Ships from` / `Sold by` fields. A split
offer is first-party only when both values are Amazon; Amazon-fulfilled offers
sold by another merchant remain named marketplace evidence. Fulfillment ignores
script, style, template, and hidden text, and the volatile offer token comes
only from the selected Add form rather than unrelated same-ASIN forms. The raw
token stays inside the isolated page runner and must be unchanged at the final
pre-click check. Only the Add-to-Cart control can be clicked; Buy Now navigation
is never used. The resulting cart must contain one exact ASIN at quantity one.

Best Buy's separately gated `bestbuy-add-v3` runner requires an exact numeric
SKU from a current or legacy product URL, explicit visible `Sold by Best Buy`
evidence in the same bounded offer scope as one Add-to-Cart control and price,
selected shipping, and quantity one. `Sold & shipped by` marketplace offers,
pickup-selected offers, high-demand queues, location/account/security blocks,
and ambiguous or conflicting SKU evidence stop before mutation. Observer v5
recognizes current Best Buy test/automation attributes and safely reports when
a native Add-intent control exists outside the known selector set, allowing the
sanitized repair queue to distinguish selector drift from a genuinely missing
control. It also binds a seller name represented by bounded accessibility
metadata inside the exact seller element. Explicit in-store-only products are
manual/local evidence with unknown global availability rather than false
out-of-stock evidence. Migration 28 retires inherited Best Buy
qualification, requiring fresh v5 evidence and a v3 rehearsal before explicit
activation. Its empty-cart, at-most-once receipt, immediate offer revalidation,
and exact single-line cart proof match the other guarded lanes. A historical
repair group is superseded only by a strictly newer packaged adapter's later
non-failure result for that same exact SKU.

A generic retailer-mutation capability cannot authorize Target, Walmart,
Amazon, Best Buy, or any future lane.

Pickup add, prepare-checkout, and submit-order are displayed as twelve
independent future qualification lanes. They have no packaged runner or
activation endpoint. Prepare/submit strategies remain non-leasable rehearsal
records even when add-only execution is live; destination/payment fingerprints,
final-total proof, confirmation evidence, and uncertain-submit recovery remain
mandatory future submit prerequisites.

Chrome restart behavior is fail-closed for all four implemented lanes. Pre-Add work cancels without clicking.
Post-receipt work verifies the cart and never repeats the click. Any ambiguous
post-click result moves to manual review.

## Local companion updates

Build the exact-version update artifact with:

```bash
npm run package:extension
```

The popup's **Check for updates** button compares semantic versions against the
local Yoink release, validates exact filename/hash/size metadata, and downloads
the packaged ZIP when newer. Chrome does not allow an unpacked extension to
replace its own source directory. Extract the ZIP over the same companion
folder, then choose **Reload after overwriting the folder** in the popup (or
Reload on `chrome://extensions`). Pairing and local extension state remain in
Chrome storage.

For a production-channel artifact, supply exact HTTPS origins explicitly:

```bash
YOINK_EXTENSION_API_ORIGIN=https://api.yoink.example \
YOINK_EXTENSION_APP_ORIGIN=https://app.yoink.example \
npm run package:extension:production
```

The production archive has a separate filename, manifest host permission, and
runtime profile. It rejects loopback origins and never uses the local ZIP feed;
publication/signing and the final extension ID remain deployment steps.

## Verify

```bash
npm run verify
```

The suite type-checks the app, rebuilds all browser bundles, and runs database,
signal, source, attribution, notification, adapter, service-worker recovery,
and API tests.

See [Architecture](docs/ARCHITECTURE.md), [Purchase-plan preflight](docs/PURCHASE_PLAN_PREFLIGHT.md), [Purchase automation readiness](docs/PURCHASE_AUTOMATION_READINESS.md), [Hosted deployment
contract](docs/HOSTED_DEPLOYMENT.md), [Worker deployment attestation](docs/WORKER_DEPLOYMENT_ATTESTATION.md), [Observer witness refresh](docs/OBSERVER_WITNESS_REFRESH.md), [Hosted Chrome device transport](docs/HOSTED_DEVICE_TRANSPORT.md), [Durable signal ingress](docs/SIGNAL_INGRESS.md), [Adapter repair intelligence](docs/ADAPTER_REPAIR_INTELLIGENCE.md), [Durable repair candidate evaluation](docs/OBSERVER_REPAIR_CANDIDATE_EVALUATION.md), [Data portability and recovery](docs/DATA_PORTABILITY.md), [CartCollect browser-safety
migration](docs/CARTCOLLECT_MIGRATION.md), and [Roadmap](docs/ROADMAP.md).
