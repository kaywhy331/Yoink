# Yoink

Yoink is the ground-up successor to CartCollect: a local-first, signal-driven
commerce control plane whose only retailer-session executor is a paired Chrome
extension.

Yoink 0.31.0 continuously accepts TrackaLacker Web Push, preserves the complete
followed-product catalog (including unavailable and unsupported listings),
resolves exact product/listing identity, creates one mission per variant,
evaluates ordered user strategies, deduplicates competing source events, and
records every decision in SQLite. Target, Walmart, Amazon, and Best Buy now have
separate, exact-version add-to-cart lanes. Each lane requires its own current evidence,
no-click rehearsal, and explicit local activation; upgrading never activates a
new lane. Every lane is restricted to first-party shipping offers, quantity one.
Amazon additionally requires a unique ASIN-bound offer token that remains only
in page memory. Buy Now, checkout, and order submission are not authorized.

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
authority, and external paging plus background escalation workers remain
roadmap work.

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
listing-only or unresolved selections stay quarantined. Exact
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

The user dashboard stays focused on exact products, purchase plans, recent
actions, and preferences. Choose **Set up purchase** on a known exact listing,
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
and ambiguous or conflicting SKU evidence stop before mutation. Observer v4
recognizes current Best Buy test/automation attributes and safely reports when
a native Add-intent control exists outside the known selector set, allowing the
sanitized repair queue to distinguish selector drift from a genuinely missing
control. It also binds a seller name represented by bounded accessibility
metadata inside the exact seller element. Explicit in-store-only products are
manual/local evidence with unknown global availability rather than false
out-of-stock evidence. Migration 19 retires every earlier Best Buy
qualification, requiring fresh v4 evidence and a v3 rehearsal before explicit
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

## Verify

```bash
npm run verify
```

The suite type-checks the app, rebuilds all browser bundles, and runs database,
signal, source, attribution, notification, adapter, service-worker recovery,
and API tests.

See [Architecture](docs/ARCHITECTURE.md), [Hosted deployment
contract](docs/HOSTED_DEPLOYMENT.md), [Data portability and recovery](docs/DATA_PORTABILITY.md), [CartCollect browser-safety
migration](docs/CARTCOLLECT_MIGRATION.md), and [Roadmap](docs/ROADMAP.md).
