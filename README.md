# Yoink

Yoink is the ground-up successor to CartCollect: a local-first, call-driven
commerce control plane. Its only store session runs inside a paired Chrome
companion.

Yoink 1.19.3 continuously accepts TrackaLacker Web Push, preserves the complete
followed-product catalog (including unavailable and unsupported listings),
resolves exact product/listing identity, creates one plan per product,
evaluates ordered rules, deduplicates competing source events, and records
every decision in SQLite. Target, Walmart, Amazon, and Best Buy each have a
separate, exact-version add-to-cart lane. Each lane requires its own current
evidence, no-click rehearsal, and explicit local activation; upgrading never
activates a new lane. Every lane is restricted to first-party offers, quantity
one, and the exact saved fulfillment choice: Shipping by default or explicit
Pickup. Amazon additionally requires a unique ASIN-bound offer token that
remains only in page memory. Buy Now, checkout, and order submission are not
authorized.

Version 1.19.3 sends Target inspection and qualification failures through the
same privacy-bounded adapter-diagnostic and Admin Incident pipeline as Walmart,
Amazon, and Best Buy. Target inspection retries brief DOM hydration before
reporting missing price, seller, fulfillment, offer, or Add-to-Cart bindings,
and both no-click rehearsal and live guarded-add outcomes now produce operation
diagnostics. Diagnostic evidence remains structural and excludes product URLs,
page text, account state, and observed offer values.

Version 1.19.2 treated an actionable first-party preorder as a normal guarded
add-to-cart offer. Best Buy add v11 removes its preorder-only rejection, and
qualification plus automatic store checks now reuse exact preorder evidence
and catalog candidates. Exact product, seller, price, fulfillment, quantity,
control, no-click rehearsal, and activation requirements remain unchanged.

Version 1.19.1 added opt-in, bounded automatic store rechecks that reuse prior
exact product evidence and catalog candidates without clicking Add to cart. It
ranks current actionable evidence ahead of repair candidates and advances when
one product is unavailable. Walmart
observer/action versions 7/8 bind one primary action while ignoring a rendered
sticky duplicate; duplicate primary actions remain ambiguous and fail closed.

Version 1.19.0 ships the context-first action and interface pass. The Chrome
popup derives one relevant action from current page, handoff, and health state;
Cart ready and Needs you remain recoverable across popup reopen and store-tab
closure. Admin and shopper workspaces consolidate scattered controls, preserve
loaded pages during background refresh, refresh the visible Products, Plans,
and Calls views, and expose a clear retry state instead of silently showing
stale data. Validated Walmart purchase handoffs prefer its review-order route,
then fall back through raw direct-cart and product-page destinations without
manufacturing affiliate parameters. The first-party, exact-item, price-limit,
Shipping-default or explicit-Pickup, quantity-one, and manual-checkout
boundaries are unchanged.

Version 1.18.1 adds an admin-only call simulator under Settings › Operations ›
Tools in `/admin`. An operator can paste one exact supported store product URL
and observed USD price, then run the production call normalizer and resolver
through a server-enforced dry-run. The simulator records the test decision
while a transactional safety invariant prevents catalog, plan, incident,
action-job, notification, spend-reservation, store-action, and cart mutations.
It also preserves the browser source's real health and rejects category,
search, drawing-hub, sign-in, malformed, or credential-bearing URLs.

Version 1.18.0 closes the signal-to-cart trigger gap across Target, Walmart,
Amazon, and Best Buy. A fresh `trusted_exact` signal matched to an explicit
add-to-cart purchase plan may now start the guarded Chrome check even when the
source omits price, seller, or fulfillment. Missing source fields remain
unknown and never become authorization: Chrome must still prove the reviewed
price cap, first-party seller, exact Shipping or explicitly selected Pickup,
quantity one, and an exact +1 cart delta on the live retailer page. Explicit
third-party, fulfillment-conflict, over-cap, stale, and inexact signals remain
fail-closed. Notification-only plans and informational sources are unchanged.

Version 1.17.2 distinguishes Best Buy's current visible `Account Required`
high-demand state from a rendered security challenge. CSS-hidden CAPTCHA
scaffolding cannot block an otherwise exact signed-in offer, while visible
account, MFA, location, queue, reservation-gate, and security states continue
to stop before any click and now provide the specific next step. The Best Buy
observer and action contracts advance together, so the prior lane is retired
until fresh no-click evidence is reviewed and explicitly activated.

Version 1.17.1 recognizes Target's current direct-fulfillment product shell,
including exact TCIN-bound `shippingButton` and generic Add controls inside an
explicit Shipping or same-day Delivery section. It excludes the Add control
from fulfillment-tile selection, ignores sticky and recommendation controls,
and still refuses visible page errors or ambiguous fulfillment. Pickup remains
explicit opt-in only. The versioned Target lane is retired on upgrade and must
be requalified with fresh no-click evidence before activation.

Version 1.17.0 repairs false-negative qualification evidence across current
Target, Walmart, Amazon, and Best Buy layouts without weakening any mutation
gate. A curated 160-store, exact-host and locale-path-aware Howl directory now
controls affiliate wrapping while every registered store outside the directory
keeps its direct retailer URL. Users can delete obsolete purchase plans through
a typed confirmation while action, spend, and audit history remains retained;
unsafe in-flight work still blocks deletion. The same release corrects
qualification-result and readiness copy, repairs admin restock projections, and
prevents challenged retailer warm-up tabs from repeatedly spawning replacements.
Checkout and order submission remain manual.

Version 1.16.1 closes the independent Y01–Y30 acceptance audit. A proven local
Cart-ready handoff no longer waits for control-plane reporting; drop-window
supersession is transactionally valid and exposed in admin authoring; users can
choose manual or auto-watch for armed plans with open-window backfill, countdown,
and per-item readiness; and Carted, Needs-you, and Missed connectors now follow
the shared action transition boundary, including recovery. Restock evidence can
seed an admin window draft, while Insights shows cap headroom and aggregate
p50/p95 latency. These are control, visibility, and latency fixes only—the
retailer safety and manual-checkout boundary is unchanged.

Version 1.16.0 completes the provider-neutral action platform around the existing
bounded signal-to-cart path. Structured Discord channels and future adapters
enter through one versioned signal contract with explicit per-channel trust,
replay limits, health, and scorecards; TrackaLacker retains its byte-identical
qualified idempotency contract. Admin-authored drop and queue-open windows feed
an opt-in user watch queue. Near each window, the paired Chrome companion keeps
every queued exact product under bounded, stagger-proof, read-only observation
until it appears in stock or the window closes; observation itself never clicks
a retailer control. The user Calls feed, bulk profile actions, readiness
checklists, deployment-bound Carted/Needs-you/Missed connectors, exact
confirmation observations, privacy receipts, analytics/CSV, and a sanitized
health bundle make the path visible and operable. Source false-positive
feedback is idempotent and feeds the same operator scorecard, while all-lane
no-click reverification and restart-safe watch leases remove setup dead ends.
Signal batching, bounded
long-polling, in-process wakeups, coalesced progress, lease heartbeats, warm cart
baselines, and session checks reduce avoidable cold-path delay. First-party,
exact-SKU, quantity-one, Shipping-default/explicit-Pickup, fresh-DOM,
qualification, permission, and manual-checkout boundaries are unchanged.

Version 1.14.0 makes the cart handoff faster to see, easier to close, and
measurable end to end without widening retailer authority. Chrome now settles
after the Add click from a bounded DOM or navigation event instead of always
sleeping 1.5 seconds, persists one reusable action tab per retailer across
worker cycles, and offers an opt-in cart-ready sound plus an exact-page inspect
hotkey. The dashboard polls only its action feed at an adaptive cadence,
separates Queued, Checking, Ready to check out, Needs you, and Closed stages,
and shows per-hop p50/p95 latency. Explicit Got it or Missed it review closes
the handoff; Got it accepts only a positive amount for that item within the
original reservation, records user-reported spend, and advances exactly one mission
quantity. A generated status glossary, current-release announcement, user
documentation, llms.txt, and Shipping-first qualification candidates remove
status and arming dead ends. Checkout and order submission remain manual.

Version 1.13.0 closes the confirmed-cart handoff without widening retailer
authority. Exact cart confirmation now creates a local, persistent **Cart
ready** popup state, an extension badge count, and a Chrome notification; Open
cart revalidates and focuses the existing exact retailer cart tab while
checkout stays manual. Signal delivery no longer waits for informational
notification/status requests, and a bounded 250/750/1500/2500 ms lease probe
replaces the one guessed follow-up timer. One bounded job drain performs its
unchanged health/access preflight once, safely continues past clean pre-click
rejections, and reuses only a fresh verified cart baseline for the next
same-lane job. Mutation-uncertain results still stop and lock. Sanitized
lease-to-cart and click-to-cart durations make the path measurable, while the
dashboard now exposes the latest bounded decision reason.

Version 1.12.2 gave every extension navigation option a distinct, validated
destination through one allowlisted route resolver shared by the popup and
right-click menu, so labels cannot silently degrade into aliases of the default
dashboard. The items it introduced (Manage store access, Diagnostics, and an
admin Settings link) have since been replaced: the current popup offers
Settings › Chrome from its status panel, Extension settings from its overflow
menu, and Open Yoink in its footer.

Version 1.12.1 removes the recurring-alarm wait between already queued guarded
adds. One Chrome cycle may lease and execute at most four jobs, strictly one at
a time, and advances only after the previous exact cart delta is confirmed.
Within that one bounded cycle, Yoink reuses only the tab it created for the same
retailer, leaving at most one resulting cart tab per store. Checkout, payment,
Buy Now, and ordering remain manual.

Version 1.12.0 removes the empty-cart bottleneck without weakening the
at-most-once Add boundary. Before a qualified add, Chrome captures at most 25
uniquely identified SKU-and-quantity lines in ephemeral session state. After
the click it requires every baseline quantity to remain unchanged and only the
authorized exact SKU to increase by one. This lets several qualified signal
matches accumulate into one retailer cart for a faster manual checkout. Any
stale, duplicated, incomplete, missing, or extra line locks safely; checkout,
payment, Buy Now, and order submission remain manual. All four adapter versions
advance and prior qualifications are retired for explicit requalification.

Version 1.11.0 gives signal-imported legacy plans a one-review, stale-safe
transition into explicit notification-only plans. The exact preview is
fingerprint-bound and applied atomically; it never infers price limits or
authorizes a retailer click. Individual plans now offer a guarded-cart draft
helper that keeps only packaged store mappings, fills missing caps from the
latest observed prices for review, calculates the current tax/store-reserve
minimum, defaults fulfillment to Shipping, and preserves Pickup only when it
was explicitly selected. Saving remains a separate user action, and checkout,
payment, and ordering remain closed.

Version 1.10.1 lets the compact companion surface an authoritative product
title only after the server resolves the exact retailer and SKU to Yoink's
catalog; page and tab titles remain untrusted. It also turns local and
Chrome-managed extension updates into a persistent, exact-version handoff:
local packages are downloaded before the user replaces the unpacked files,
managed checks run only from a mismatch action, and installation completes
only through an explicit companion reload. The TypeScript test baseline is
clean again, with no change to retailer mutation authority.

Version 1.10.0 replaces the extension's stacked admin-style popup with one
compact, exact-page-aware control surface. A shared deterministic classifier
and view reducer select at most one dominant action, retain inspection during
paused, test, monitoring, or TrackaLacker-attention states, and progressively
disclose health, diagnostics, store access, updates, and consent-gated evidence
sharing. Sanitized qualification results persist across popup closes, and the
small extension action menu revalidates the live tab, health, permission, and
exact product identity before acting. Existing no-click qualification,
manual-entry, permission, pairing, and retailer-action boundaries are unchanged.

Version 1.9.1 extends Best Buy observer v8 and add v7 to the single-control,
split-shell layout observed on SKU 6685081. Recovery may cross sibling regions
under the exact product page only when one Add control, one distinct price,
one unambiguous seller class, quantity one, and one selected fulfillment agree;
any competing SKU, price, or primary action still fails closed. Migration 52
retires inherited Best Buy qualification before the expanded binder can act.

Version 1.9.0 turns retailer qualification into one active-tab action: the
companion detects the exact product domain, captures one observation, and
routes Target, Walmart, Amazon, or Best Buy through its corresponding no-click
verifier without repeating the inspection. Other supported stores remain one-
click read-only inspections. Best Buy observer v7 distinguishes a passive
high-demand label from an actual demand gate and can collapse a sticky Add
duplicate only when one non-sticky primary action remains bound to one exact
SKU, price, seller class, and selected fulfillment; Best Buy add v6 therefore
requires fresh qualification. User-dashboard destinations are matched against
the curated, path-aware Howl store directory. Only matching destinations are
wrapped as a Howl ClickMate URL with the exact destination, `collectwithdodo`
publisher slug, readable page name, and canonical dashboard URL; all other
registered retailers open directly until their provider integration exists.
The admin Settings view exposes the same routing directory used by the matcher.

Version 1.8.0 makes Shipping the deterministic fulfillment default throughout
mission evaluation, persistence, qualification, and browser execution. Pickup
is eligible only when the user explicitly saved Pickup and the live exact
first-party offer proves it is currently available; an unavailable or
mismatched choice stops before any click and never falls back across modes.
Target add v4 recognizes current fulfillment tiles, prioritizes Shipping, uses
an eligible Delivery tile only as the non-Pickup remote fallback, and rebinds
the exact Add control after an authorized tile selection. Walmart add v5,
Amazon add v7, and Best Buy add v5 apply the same exact-choice boundary.
All four adapters can recover from constrained selector drift only when one
unique SKU, seller, price, fulfillment path, and Add control remain provable;
ambiguity fails closed and emits a privacy-bounded diagnostic. The version
bumps retire prior qualifications, requiring fresh evidence, no-click
rehearsal, and explicit activation before live actions resume.

Version 1.7.0 is a consumer-surface release driven by first-hand usage
feedback. Quick add no longer fails when tax and store-fee reserves exceed the
item price: the no-write preflight now returns the auto-raised reviewed total
(item price plus reserves, flagged `autoRaised`) instead of rejecting, while
the create step keeps strict enforcement of the fingerprint-bound reviewed
value. Quick-add profiles gain MSRP and MSRP-offset-percent price modes
(±90%, resolved per listing, falling back to guided setup when a listing has
no recorded MSRP), a single default profile that the bare Quick-add button
uses, and live propagation: migration 50 links each quick-added purchase plan
to its profile, and saving a profile re-derives every linked plan's caps
through the existing audited safety validation, reporting skipped plans. The
current profile contract also binds Shipping or an explicit Pickup opt-in and
propagates the saved quantity, fulfillment, caps, and action atomically. When
profiles exist but none is marked default, bare Quick add opens the profile
chooser instead of silently creating a notification-only plan; the built-in
notify-only setup remains an explicit choice. The
Plans workspace also supports an explicit multi-select **Apply setup** flow for
existing active or paused plans. The server revalidates the complete selected
set in one transaction, links each plan to the saved profile, updates only
plans with sufficient price evidence and compatible store targets, reports
every skip, and cancels any stale pre-lease job whose intent revision changed.
This is the reviewed migration path for imported notification-only plans; it
does not silently widen plans when a profile is merely created. If a reviewed
cart profile was linked while a retailer lane was still closed, successful
activation of that exact lane automatically retries the linked plans against
the now-current mapping. Unsupported or evidence-incomplete plans remain
unchanged and reported. A linked store-price cart profile is also retried
inside the first fresh priced signal transaction, after durable offer capture
and before policy evaluation, so that same signal can produce a guarded cart
job. Reducing a profile to notification-only never waits on missing price
evidence and preserves the prior cap until it can be safely re-derived. The
user surface drops all operator vocabulary — the Signal connections card,
signal/TrackaLacker copy in the hero, toasts, and the server-generated setup
guide now speak in product-tracking terms — and purchase plans render as one
dense summary row with full detail behind a native disclosure. Cart-action
copy honestly reads "Add to cart" (quantity is a declared field). The
TrackaLacker catalog sync becomes self-diagnosing for product media: each run
captures one sanitized raw-field sample into the audit log, image and MSRP
extraction cover the real hydration-payload candidates with a documented
dollars-versus-cents heuristic, and products still missing an image get a
bounded, cached og:image page-fallback fetch (25 per run). Sync remains a
full pass, so one run backfills the existing catalog. Checkout automation
remains deliberately unshipped: no execution lane above add-to-cart is
qualified, so no checkout control is offered.

Version 1.6.0 adds the fourth verification-level composition — and the final
rung of the hosted-signal plane's qualification ladder: the signal-handler
repository composition. It is not a twenty-eighth qualification boundary: it
creates no new PostgreSQL role, function, or receipt table, and grants no new
mutation authority. It fans in four already-qualified boundaries — the
observer-witness-refresh boundary (0.71.0, the tip of an eight-module,
six-handler-family chain reaching back through worker-control), the durable
signal-ingress repository composition (1.3.0), the bounded operator
dead-letter inbox-reset writer (1.4.0), and the bounded notification-delivery
ensure writer (1.5.0) — into one deterministic manifest, keyed by SHA-256
fingerprint, in that fixed structural order.

Three build-time fingerprint-convergence proofs establish that this is one
connected graph, not four accidentally-unrelated qualifications, each checked
in-process with no live database required: the observer-witness-refresh
boundary, rebuilt directly here, must equal the ingress composition's own
embedded copy of that identical node; the dead-letter-reset writer's own
declared job-lifecycle predecessor must equal the ingress composition's own
embedded copy of that identical node; and the notification-ensure writer's own
declared dead-letter-reset predecessor must equal this module's own directly
bound dead-letter-reset member's fingerprint. Any mismatch fails closed.

This closes `hostedDeliveryHandlerRepositoryParity` and the aggregate
`allHandlerRepositoryParity` — completing the in-repo hosted-signal plane's
qualified-inactive composition ladder: every handler repository family is now
either independently qualified or composition-verified, with runtime
authority still gated off. It also proves, for the first time in one place
and on a separate accounting axis from mutation families, that all seven
`BACKGROUND_TASK_KINDS` entries each map to exactly one qualified PostgreSQL
module — six through the observer-witness-refresh chain's tip, and
`hosted_delivery_recovery` through the ingress composition — verified against
the real exported constant, never a copied list.

Two write families own this composition's own two new mutation-family rows,
both already closed by name: the operator-driven dead-letter inbox-reset
(1.4.0) and the notification-delivery ensure write (1.5.0). The
observer-witness-refresh and durable signal-ingress composition boundaries
are delegated on that axis, their own already-total families cited by import
rather than re-listed. Two write families remain concretely out of scope,
recorded in the module's own `KNOWN_OUT_OF_SCOPE_WRITES` constant:
`CatalogRepository.upsertListing`'s manual "add to library" reference
inserts, carried forward unchanged; and the task-kind dispatch mechanism
itself — pure application-layer routing with no PostgreSQL repository-write
surface of its own, precisely the mechanism this module's own two closed
flags now attest is fully wired. `NotificationRepository.ensureForJob`, the
last item on every prior out-of-scope list, is gone.

SQLite remains authoritative; nothing is activated. `noNewRoleCreated`,
`noNewFunctionCreated`, and `noNewMutationPath` all stay true — this
composition proves closure, not a twenty-eighth qualified writer. Plan
without a database connection using `npm run
postgres:signal-handler-composition -- plan`; verify against a live database
with `YOINK_POSTGRES_URL=... npm run postgres:signal-handler-composition --
verify` — there is no `apply` step and no acknowledgement environment
variable, because this module creates nothing new to apply — and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 1.5.0 adds the twenty-seventh independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded notification-delivery
ensure writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns
no application object, inherits no role, has zero direct/effective table or
column grants, and may call one strict security-definer function. The
boundary protects two tenant tables — `action_jobs` and
`notification_deliveries` — but its complete mutation set is the second
alone; `action_jobs` is read and row-locked for ownership, never written.

PostgreSQL binds `session_user` to one exact tenant/user, revalidates the
qualified operator dead-letter inbox-reset boundary (1.4.0) as its declared
predecessor, and accepts one explicit `ensure_notification_delivery`
operation under `NOTIFICATION_ENSURE_V1`. The caller supplies only
`actionJobId`; the one `action_jobs` row a call may ever touch is locked
with `SELECT ... FOR UPDATE OF job`, and it must carry `action = 'notify'`
and `state = 'notify_only'` — anything else fails closed with `55000`. The
`state` check is a documented, deliberate narrowing beyond SQLite's own
`ensureForJob` SQL, which never inspects `state` at all: the invariant holds
because `ensureForJob`'s one real caller, `SignalRepository.createActionJob`,
always creates the job with `state = 'notify_only'` in the same synchronous
call that invokes it moments later.

`notification_deliveries` carries `UNIQUE(job_id)`, exactly like SQLite's
own `INSERT OR IGNORE`: a fresh call inserts one `pending` row with
database-owned timestamps, while a delivery already ensured for that job is
a true zero-write success. Because the table is live — `leaseNext`/
`acknowledge`/`recordInteraction`/`recoverExpired` all advance a delivery
long after creation — the replay path echoes the row's current live
`state`/`attempts`/`updated_at` rather than a stale creation-time snapshot,
the deliberate inverse of the attribution-receipt boundary's
immutable-replay design. Neither path writes `audit_events` or
`outbox_events`, matching SQLite's own `ensureForJob` exactly, which never
calls `AuditRepository.record` on either path — the family's first honest
zero-audit claim; every other qualified writer in this repository appends
to the audit trail at least conditionally.

Neither `action_jobs` nor `notification_deliveries` is one of the five
domains the shared writer-lock protocol guards, so this boundary never
calls it; per-job serialization comes from the row lock plus
`UNIQUE(job_id)` + `ON CONFLICT (job_id) DO NOTHING`, the identical backstop
the attribution-receipt writer uses. Native PostgreSQL 16 proves wrong,
same-tenant-peer, and unmapped principal denial, zero direct and
cross-boundary SQL, notify-action/notify-only-state precondition
enforcement, true INSERT-or-existing idempotency, and the honest zero-audit
write set. This closes `notificationEnsureWriterParity`, closing
`NotificationRepository.ensureForJob` — the last unqualified write family
named anywhere in this repository's own accounting, and the same write the
final handler-composition rung's own out-of-scope list names as an
"orphaned third scope no flag in this repository ... has ever promised to
cover." `hostedDeliveryHandlerRepositoryParity` and
`allHandlerRepositoryParity` both remain false — only the final handler
composition itself, binding every qualified writer into the existing
runtime chain, remains open among write families. SQLite remains
authoritative; nothing is activated. Use `npm run
postgres:signal-notification-ensure-apply -- plan ...` and the [PostgreSQL
cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 1.4.0 adds the twenty-sixth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded operator dead-letter
inbox-reset writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role
owns no application object, inherits no role, has zero direct/effective
table or column grants, and may call one strict security-definer function.
The boundary protects four forced-RLS tenant tables — `audit_events`,
`hosted_delivery_receipts`, `inbox_messages`, and `outbox_events` — and all
four are also its complete mutation set; there is no read-only table
anywhere in its surface.

PostgreSQL binds `session_user` to one exact tenant/user, revalidates the
qualified action-job lifecycle boundary (1.0.0) as its declared
predecessor, and accepts one explicit `reset_dead_letter_inbox` operation
under `DEAD_LETTER_RESET_V1`. The caller supplies only `inboxMessageId`
and `correlationId`; `eventType` is never caller input — it is the
hardcoded `signal_event_v1` literal, matching `retryDeadLetterInbox`'s one
real caller exactly. The one row a call may ever touch is locked with
`SELECT ... FOR UPDATE OF inbox`, and its `state` must be exactly
`dead_letter` — anything else, including a message already reset back to
`accepted`, fails closed with `55000` once the replay check below finds no
match.

A fresh reset atomically updates the locked `inbox_messages` row — `state`
to `accepted`, `delivery_attempts` to zero, and every lease/error field
(`lease_capability_hash`, `lease_expires_at`, `next_attempt_at`,
`last_error_code`, `processed_at`) cleared — inserts one
`hosted_delivery_receipts` row whose `receipt_hash` reproduces SQLite's
real length-prefixed `stableHash` scheme in SQL byte-for-byte, including
its trailing-pipe terminator, and appends one `audit_events`/
`outbox_events` pair; PostgreSQL owns the timestamp. Four statements, four
rows, one transaction.

Because a dead-lettered message can legitimately cycle back through
`dead_letter` a second time before an old request happens to be replayed,
this boundary follows the job-lifecycle-apply and reservation-lifecycle-apply
audited-replay-graph pattern rather than a live-row idempotency check: a
replay of the exact same `request_id` echoes the original audited result
unconditionally, without also requiring the currently live row to still
show `accepted`. RBAC (`worker.manage`) is deliberately not reproduced in
SQL, following the same precedent `postgres-hosted-delivery-lease-recovery.ts`
already established for its own lease/complete/retry functions, and is
recorded honestly as `workerManagePermissionRevalidated: false` rather than
silently omitted. Neither `inbox_messages` nor `hosted_delivery_receipts`
is one of the five domains the shared writer-lock protocol guards, so this
boundary never calls it; per-row serialization comes entirely from the row
lock itself.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped
principal denial, zero direct and cross-boundary SQL, dead-letter-state
precondition enforcement, atomic four-table mutation, audited-replay-graph
idempotency across a legitimate second dead-letter cycle, and
byte-identical receipt-hash parity with the real SQLite call. This closes
`deadLetterResetWriterParity`, closing the dead-letter-reset write family
`postgres-signal-ingress-composition.ts` (1.3.0) named out of scope.
`NotificationRepository.ensureForJob` and `CatalogRepository.upsertListing`'s
manual "add to library" reference inserts still carry forward unchanged,
and the task-kind dispatch mechanism itself remains, as before, without
any PostgreSQL repository-write surface of its own to qualify.
`hostedDeliveryHandlerRepositoryParity` and `allHandlerRepositoryParity`
both remain false — final handler composition binding this writer into
the existing chain is separate work. SQLite remains authoritative; nothing
is activated. Use `npm run postgres:signal-dead-letter-reset-apply -- plan
...` and the [PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md)
runbook.

Version 1.3.0 adds the verification-level durable signal-ingress repository
composition. It is not a twenty-sixth qualification boundary: it creates no
new PostgreSQL role, function, or receipt table, and grants no new mutation
authority. It fans in four already-qualified boundaries — the bounded
durable signal-ingress enqueue writer (1.2.0), the sealed tenant queue-write
boundary (0.63.0), the hosted-delivery lease/plan boundary, and the complete
signal-evaluation repository composition (1.1.0) — into one deterministic
manifest, keyed by SHA-256 fingerprint, arranged as a four-member fan-in
rather than a linear chain.

Three build-time fingerprint-convergence proofs establish that this is one
connected graph, not four accidentally-unrelated qualifications, each
checked in-process with no live database required: the ingress-enqueue
writer's own declared attribution-receipt predecessor must equal the
evaluation-repository composition's own embedded copy of that identical
node; the ingress-enqueue writer's own declared queue-write predecessor must
equal the tenant queue-write boundary rebuilt directly in this module's own
chain; and the hosted-delivery lease/plan boundary rebuilt directly here
must equal the evaluation-repository composition's own embedded copy of
that identical node — the lease/plan boundary is deliberately bound both
directly and transitively, a strengthening the convergence proof turns
honest rather than redundant. Any mismatch fails closed.

This closes `signalIngressRepositoryParity`. The four members' seventeen
total mutation/plan families — two owned directly by this composition (the
accept/dedupe enqueue write and the task-wake write) plus the
evaluation-repository composition's own already-total fifteen, cited by
import rather than re-listed — are completely covered, with zero unmapped
families and zero unmapped chain boundaries.
`hostedDeliveryHandlerRepositoryParity` and `allHandlerRepositoryParity`
both remain false.

Four write families stay concretely out of scope, recorded in the module's
own `KNOWN_OUT_OF_SCOPE_WRITES` constant. `NotificationRepository
.ensureForJob` and `CatalogRepository.upsertListing`'s manual "add to
library" reference inserts both carry forward unchanged.
`HostedDeliveryRepository.retryDeadLetterInbox` — the operator-driven
dead-letter replay path that resets an already-dead-lettered
`inbox_messages` row back to `accepted` and writes an `audit_events`/
`outbox_events` pair — is not covered by any bound member; qualifying it is
left to a later module. The task-kind dispatch mechanism itself — the
application-layer routing that decides which handler function runs for
each of the seven background task kinds — has no PostgreSQL
repository-write surface of its own to qualify.

SQLite remains authoritative; nothing is activated. `noNewRoleCreated`,
`noNewFunctionCreated`, and `noNewMutationPath` all stay true — this
composition proves closure, not a fifth qualified writer. Plan without a
database connection using `npm run postgres:signal-ingress-composition --
plan`; verify against a live database with `YOINK_POSTGRES_URL=... npm run
postgres:signal-ingress-composition -- verify` — there is no `apply` step
and no acknowledgement environment variable, because this module creates
nothing new to apply — and the [PostgreSQL cutover
qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 1.2.0 adds the twenty-fifth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded durable signal-ingress
enqueue writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns
no application object, inherits no role, has zero direct/effective table or
column grants, and may call one strict security-definer function. The
boundary protects and mutates the same two forced-RLS tenant tables —
`hosted_delivery_receipts` and `inbox_messages`; there is no read-only table
anywhere in its surface.

PostgreSQL binds `session_user` to one exact tenant/user, revalidates the
qualified attribution-receipt boundary (0.99.0) as its declared predecessor,
and accepts one `accept_signal_ingress` operation carrying a single
sanitized, 64KiB-bounded TrackaLacker signal envelope — the exact
thirteen-key shape `DurableSignalIngressService`'s own `durableSignal`
helper produces. `source` and `eventType` are never caller input: they are
the SQL literals `'trackalacker'`/`'signal_event_v1'`, matching
`acceptTrackalacker`'s own hardcoded call into `acceptInbox` exactly.
`messageKey` and `payloadHash` are both derived database-side from the
envelope alone — never accepted or cross-checked.

A brand-new message atomically inserts one `inbox_messages` row plus one
`hosted_delivery_receipts` row — never `audit_events`/`outbox_events`,
mirroring SQLite's own `acceptInbox`, which touches neither table. A
duplicate with identical content is an honest one-write dedupe:
`inbox_messages` stays unmutated but a fresh row still appends to the
append-only `hosted_delivery_receipts` ledger, a deliberate divergence from
every zero-write-replay sibling in this family — reproducing that pattern
here would silently drop a real SQLite side effect. A duplicate key used for
different content fails closed before any write at all.

The companion task-wake half of `acceptTrackalacker` —
`BackgroundTaskRepository.enqueueServiceTask`'s exact three-table write
family — is already independently qualified, table-for-table and
privilege-for-privilege, by the sealed tenant queue-write boundary (0.63.0).
This module does not reimplement it: it binds that boundary's manifest
fingerprint into its own and verifies (never applies) it from both its own
`apply` and `verify` paths. A caller composing full `acceptTrackalacker`
semantics is expected to invoke this function first, then separately invoke
the already-qualified queue-writer when the resulting inbox state calls for
a `hosted_delivery_recovery` task.

This closes `ingressEnqueueWriterParity`, the write family
`postgres-signal-evaluation-repository-composition.ts` (1.1.0) newly named
out of scope. `signalIngressRepositoryParity` stays false — a future
composition rung binding this writer, `hostedDeliveryLeaseRecovery`, and the
resolution-plan function together is required before that flag can honestly
flip. `writerLockProtocolParity` also stays false: neither table sits inside
any of the shared protocol's five domains. Native PostgreSQL 16 proves
principal isolation, direct and cross-boundary denial, fresh-accept two-row
atomicity, same-content dedupe with a mutation-free inbox and an appended
receipt, fail-closed conflicting-content rejection, and the consumed
queue-write boundary's own fingerprint match. Notification dispatch, the
operator dead-letter inbox-reset, hosted-delivery handler composition, and
the ingress composition rung itself remain open. SQLite remains
authoritative; nothing is activated. Use `npm run
postgres:signal-ingress-enqueue-apply -- plan ...` and the [PostgreSQL
cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 1.1.0 adds the verification-level complete signal-evaluation
repository composition. It is not a twenty-fifth qualification boundary: it
creates no new PostgreSQL role, function, or receipt table, and grants no new
mutation authority. It fans in five already-qualified boundaries — the
hosted-delivery lease/plan boundary, the eleven-boundary signal-evaluation
apply composition (0.98.0), the reservation-lifecycle writer, the
attribution-receipt writer (0.99.0), and the post-creation job-lifecycle
writer (1.0.0) — into one deterministic manifest, keyed by SHA-256
fingerprint, arranged as a fan-in DAG rather than rung-1's single linear
chain.

Two build-time fingerprint-convergence proofs establish that this is one
connected graph, not two accidentally-unrelated qualification trees:
`postgres-signal-target-qualification-apply.ts`'s own default predecessor —
the root of the nine-boundary writer-track that also reaches the
reservation-lifecycle, attribution-receipt, and job-lifecycle writers — is
checked against rung-1's own chain-tip `actionSpendApply` fingerprint, and
the attribution-receipt and job-lifecycle writers' own declared predecessor
fingerprint is checked against `postgres-signal-attribution-policy-apply.ts`'s
independently rebuilt fingerprint. Either mismatch fails closed. Together
with `hostedDeliveryLeaseRecovery`'s own independent witness-refresh lineage
— the DAG's second root — the five members' fifteen total mutation/plan
families (five owned directly by this composition, plus rung-1's own ten,
cited by import rather than re-listed) are completely covered, with zero
unmapped families and zero unmapped chain boundaries.

This closes `signalEvaluationRepositoryParity`.
`signalIngressRepositoryParity`, `hostedDeliveryHandlerRepositoryParity`, and
`allHandlerRepositoryParity` all remain false. Three write families stay
concretely out of scope, recorded in the module's own
`POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES` constant:
`NotificationRepository.ensureForJob` (a handler/task-kind dispatch concern,
carried forward from 0.98.0 unchanged), `CatalogRepository.upsertListing`'s
manual "add to library" reference inserts (a request-repository concern,
also carried forward unchanged), and — newly named here —
`DurableSignalIngressService`'s own enqueue path: the
`HostedDeliveryRepository.acceptInbox` `INSERT INTO inbox_messages` write and
`BackgroundTaskRepository`'s create/dedupe writes for a newly inbound signal.
`hostedDeliveryLeaseRecovery`'s own native function only leases, completes,
or fails an already-enqueued inbox row — no boundary qualified anywhere in
this repository yet reproduces the initial enqueue itself, which is exactly
what `signalIngressRepositoryParity` (still false) names.

SQLite remains authoritative; nothing is activated. `noNewRoleCreated`,
`noNewFunctionCreated`, and `noNewMutationPath` all stay true — this
composition proves closure, not a sixth qualified writer. Plan without a
database connection using `npm run
postgres:signal-evaluation-repository-composition -- plan`; verify against a
live database with `YOINK_POSTGRES_URL=... npm run
postgres:signal-evaluation-repository-composition -- verify` — there is no
`apply` step and no acknowledgement environment variable, the same as
0.98.0's own composition, because this module creates nothing new to apply
— and the [PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md)
runbook.

Version 1.0.0 adds the twenty-fourth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded post-creation action-job
lifecycle writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns
no application object, inherits no role, has zero direct/effective table or
column grants, and may call one strict security-definer function. The
boundary protects eight forced-RLS tenant tables — `action_events`,
`action_jobs`, `audit_events`, `missions`, `outbox_events`, `signal_events`,
`signal_incidents`, and `signal_occurrences` — but its mutation set is six:
`action_events`, `action_jobs`, `audit_events`, `missions`, `outbox_events`,
and `signal_incidents`. `signal_events` and `signal_occurrences` are
read-only, joined only for the same defensive cross-tenant incident guard
SQLite's `closeIncident` already performs.

PostgreSQL binds `session_user` to one exact tenant/user, revalidates the
qualified attribution-policy boundary as its declared predecessor, and
accepts one explicit `transition_job` operation under
`JOB_LIFECYCLE_TRANSITION_V1`. The complete 47-edge legal state-transition
table is derived at load time by calling the real `canTransitionJob` for
every pair over the real 19-state `JOB_STATES` enum — not hand-transcribed —
behind a startup count guard that throws if the domain source ever drifts
from 47 edges. Every request also carries a caller-declared
`expectedCurrentState`: the database locks the job row and its
incident/mission graph, then fails closed with `55000` on any mismatch, an
optimistic precondition SQLite's single-writer model never needed. A
`cancelled` transition out of any of the eight mutation-risk states
(`adding`, `cart_verified`, `checkout_review`, `submit_authorized`,
`submitting`, `confirmed`, `manual_review`, `submission_uncertain`) is
rejected with the same code unless the caller sets `manualResolution`,
mirroring SQLite's own guard against silently discarding a job that may have
already mutated a cart.

This boundary owns exactly the residual the v0.93 terminal
reservation-lifecycle writer leaves: `action_jobs.state`, the
`action_events` insert, `signal_incidents` close/lock transitions, and — for
a `confirmed` `submit_order` job only — `missions.fulfilled_quantity`/
`status`. Every `spend_reservations`/`spend_ledger_entries` write stays
exclusively the reservation-lifecycle writer's; this function never touches
either table, and consumes only the shared writer-lock protocol's `spend`
bit — the same bit the reservation-lifecycle writer consumes, since both
mutate state hanging off the same job row and `missions.fulfilled_quantity`
feeds the reservation writer's own capacity math. A fresh transition
atomically appends exactly one `action_events` row plus the applicable
incident/mission update and one `audit_events`/`outbox_events` pair;
PostgreSQL owns every timestamp.

The outcome model is deliberately two-valued — `applied` or
`already_applied` — narrower than the reservation-lifecycle writer's
three-outcome model, because `nextState` carries no binding to
`reasonCode`/`message`/`evidence` the way a release reason implies its own
state; only an exact replay, matched against the deterministic
`audit_events`/`outbox_events` row and a recomputed `requestFingerprint`, is
a mutation-free success, and any other mismatch fails closed.
`deviceCapabilityRevalidation` is honestly `false`: `transitionJob` itself
never checks a device or capability token — that lives one layer up, in
`ExecutionRepository.reconcileJob`, outside this residual's scope.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, zero direct and cross-boundary SQL, all 47 legal transitions and
rejection of every illegal one, the manual-resolution cancel guard,
expected-state precondition failure, cross-tenant incident-closure denial,
terminal/lock/confirmed branch semantics including mission fulfillment and
`satisfied` promotion, and fingerprint-guarded immutable replay. This closes
`jobLifecycleWriterParity`, the second of the three write families
`postgres-signal-evaluation-composition.ts` recorded as out of scope in
0.98.0 — attribution receipts closed first in 0.99.0. `writerLockProtocolParity`
stays false — none of `action_jobs`, `action_events`, or `signal_incidents`
sit inside any of the shared protocol's five domains; only `missions` does,
under the `spend` bit this boundary already consumes. Notification dispatch
(`NotificationRepository.ensureForJob`) and the operator dead-letter
inbox-reset remain open. SQLite remains authoritative; nothing is activated.
Use `npm run postgres:signal-job-lifecycle-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.99.0 adds the twenty-third independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded attribution-receipt
writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no
application object, inherits no role, has zero direct/effective table or
column grants, and may call one strict security-definer function. The
boundary protects five forced-RLS tenant tables — `action_jobs`,
`attribution_policies`, `attribution_receipts`, `audit_events`, and
`outbox_events` — but its mutation set is only three: `attribution_receipts`,
`audit_events`, and `outbox_events`.

PostgreSQL binds `session_user` to one exact tenant/user and accepts one
explicit `record_attribution_receipt` operation under
`ATTRIBUTION_RECEIPT_RECORD_V1`. Every request ID is derived from the
authenticated principal and the complete normalized payload. `provider`,
`routeUrl`, and `retailerId` are never trusted from the caller: they are read
straight off the locked `action_jobs` row (and its `listings` join for
`retailerId`) and revalidated for equality against the submitted payload, and
`canonicalUrlHash` is derived server-side from the job's own `canonical_url`
column using the same length-prefixed SHA-256 scheme SQLite's `stableHash`
uses — no raw canonical URL crosses the wire. `policyId` is looked up from
the current provisioned `attribution_policies` row for the job's retailer
and revalidated for equality against the submitted value.

`attribution_receipts` carries a `UNIQUE(job_id)` constraint, and this
boundary mirrors SQLite's own `INSERT OR IGNORE` idempotency exactly rather
than the audited-replay-graph check most sibling boundaries use: a receipt
already recorded for a job is an unconditional zero-write success that
returns the originally stored row, with no comparison against the newly
submitted payload. `insertOrIgnoreReplayParity` flags this as a deliberate
divergence from the request-graph replay every other apply boundary in this
family performs. The `policy_id` foreign key is `ON DELETE SET NULL`, so a
replayed receipt's stored `policy_id` is returned as-is rather than
re-validated against a live policy row.

A fresh insert atomically appends exactly one `attribution_receipts` row plus
one `audit_events` and one `outbox_events` record; PostgreSQL owns the
timestamp. `attribution_receipts` is not one of the five domains the shared
writer-lock protocol guards — the same as `attribution_policies` — so this
boundary never calls it; per-job serialization instead comes from
`SELECT ... FOR UPDATE OF job` on the locked `action_jobs` row plus the
`UNIQUE(job_id)` constraint itself.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, zero direct and cross-boundary SQL, job-ownership and
attribution-snapshot revalidation, provisioned-policy-row enforcement, true
INSERT-OR-IGNORE zero-write replay, audited-fresh-insert-only receipts, and
one winner under concurrent application for the same job. This closes
`attributionReceiptWriterParity`, the first of the three write families
`postgres-signal-evaluation-composition.ts` recorded as out of scope in
0.98.0. `writerLockProtocolParity` stays false — `attribution_receipts`
deliberately never joins the shared protocol, just like
`attribution_policies`. Notification dispatch
(`NotificationRepository.ensureForJob`) and post-creation job-lifecycle
(`SignalRepository.transitionJob`'s commit/release and fulfilled-quantity
branches) remain the two other write families still out of scope. SQLite
remains authoritative; nothing is activated. Use `npm run
postgres:signal-attribution-receipt-apply -- plan ...` and the [PostgreSQL
cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.98.0 adds the verification-level complete signal-evaluation apply
composition. It is not a twelfth qualification boundary: it creates no new
PostgreSQL role, function, or receipt table, and grants no new mutation
authority. It binds the eleven already-qualified signal-writer manifests —
catalog-apply, resolution-apply, source-reference refresh, terminal-decision
apply, offer-incident apply, post-incident decision apply, mission-binding
apply, strategy-evaluation apply, writer-lock protocol, constraint-config
apply, and action-spend apply — into one deterministic manifest, keyed by
SHA-256 fingerprint, in their structural predecessor order.

The composition proves, for the first time in one place, that the ten SQLite
`SignalEngine.process()` evaluation mutation families each map to exactly
one of those eleven boundaries, at (call-site, decision-outcome) granularity
rather than raw table name, with zero unmapped mutation families and zero
unmapped chain boundaries. The two writer-discipline boundaries —
writer-lock protocol and constraint-config apply — own no mutation family of
their own but remain required chain members: the first is a lock-only
advisory primitive with zero mutation tables, and the second's writes are
operator-driven configuration, consumed only as a read gate during
evaluation.

Every one of the eleven declared predecessor-manifest fingerprints is
compared, in-process, against the predecessor's own independently rebuilt
fingerprint; any drift fails closed with
`PostgresSignalEvaluationCompositionError`. Because each composed boundary's
own `verifyPostgresSignalXBoundary` function already cascades to its
predecessor's verify function, one live-database call to the chain's tip —
`verifyPostgresSignalActionSpendApplyBoundary` — transitively re-verifies
all eleven composed boundaries' live Postgres role, function, and RLS state,
plus the hosted-delivery/witness-refresh foundation beneath them.

This closes `signalEvaluationApplyRepositoryParity`.
`signalEvaluationRepositoryParity`, `signalIngressRepositoryParity`,
`hostedDeliveryHandlerRepositoryParity`, and `allHandlerRepositoryParity`
all remain false. Three write families are concretely out of scope, recorded
in the module's own constants rather than left implicit:
`AttributionRepository.recordReceipt`'s `attribution_receipts` writes
(governed by the attribution-policy boundary's policy table only, not
per-job receipts), `NotificationRepository.ensureForJob`'s notification/
outbox delivery handler surface (a different, handler-level composition),
and `SignalRepository.transitionJob`'s post-creation lifecycle branches
(spend-ledger commit/release and the `missions.fulfilled_quantity` update,
which mutate a job after it already exists). SQLite remains authoritative;
nothing is activated. Plan without a database connection using
`npm run postgres:signal-evaluation-composition -- plan`; verify against a
live database with `YOINK_POSTGRES_URL=... npm run
postgres:signal-evaluation-composition -- verify` — there is no `apply`
step, because this composition creates nothing new to apply — and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.97.0 evolves the tenth independently receipted piece of the
inactive PostgreSQL hosted-signal plane — the reviewed purchase-intent
action/spend boundary from 0.84 — with separately qualified trusted strategy
action semantics. This is a contract evolution of the existing reviewed
boundary, not a new boundary: the same `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`
role, the same one strict security-definer function, and the same nine-table
mutation set now also accept `decisionSource: "strategy"` requests.
`purchaseIntentOnly` is now false.

The boundary's protected forced-RLS tenant table set grows from 19 to 20 —
the `strategies` table joins for read-only revalidation — while its mutation
surface is unchanged; `strategies` is never mutated here. A strategy-sourced
request revalidates the exact strategy's current existence, ownership,
`enabled` state, and attested revision, then unconditionally, fail-closed,
produces a notify-only action job. SQL has no statement that ever writes a
cart action or a spend reservation for a strategy source: the reservation
and ledger inserts remain inside the `purchase_intent` branch only, and
immutable replay fails closed if a strategy-sourced job's
`spend_reservation_id` is ever non-`NULL`. Strategy action authority — cart
or spend-reservation — is structurally closed.

Strategy notifies still require the same exact, fresh, `trusted_exact`,
first-party, shipping evidence and a re-derived numeric unit cap that
purchase-intent requires — deliberately narrower than SQLite's own notify
path, which allows a null cap for a pure notify-only strategy. Quantity 1-99
is now permitted for a strategy job, unlike purchase-intent's fixed quantity
one, with the informational maximum all-in scaled by that quantity.

`contractVersion` stays 1: the evolution is additive, marked by a new
`strategySemanticsContractVersion: 2` field rather than a hard version bump.
`POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION` is a pinned literal
type consumed downstream by the Target-qualification boundary's manifest;
bumping it would ripple through that pin, so the hard bump is deliberately
deferred. v1's purchase-intent semantics are byte-for-byte unchanged.

Native PostgreSQL 16 proves notify-only job creation for every strategy
request, zero reservation or ledger writes across every strategy code path,
fail-closed strategy existence/ownership/enabled/revision revalidation, and
immutable strategy-sourced replay, alongside untouched purchase-intent
behavior. This closes the roadmap's separately qualified strategy action
semantics gap. Final action/inbox composition and every request-repository
family remain open; SQLite remains authoritative. Use
`npm run postgres:signal-action-spend-apply -- plan ...` and the [PostgreSQL
cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.96.0 adds the twenty-second independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded attribution-policy
replacement writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role
owns no application object, inherits no role, has zero direct/effective
table or column grants, and may call one strict security-definer function.
The boundary protects three forced-RLS tenant tables — `attribution_policies`,
`audit_events`, and `outbox_events` — and all three are in its mutation set.

PostgreSQL binds `session_user` to one exact tenant/user and accepts one
explicit `replace_attribution_policies` operation under
`ATTRIBUTION_POLICY_REPLACE_V1`, submitting a complete, alphabetically fixed
set of all thirteen supported retailers' affiliate-routing policies —
`amazon`, `bestbuy`, `booksamillion`, `disney`, `fanatics`, `kohls`, `macys`,
`pbandai`, `pokemoncenter`, `ravensburger`, `riot`, `target`, and `walmart`
— each restricted to the `canonical`, `howl`, or `amazon_associates`
provider. Every request ID is derived from the authenticated principal and
the complete normalized payload.

`attribution_policies` is not one of the five domains the shared writer-lock
protocol guards (source, retailer qualification, settings, mission policy,
and spend), so this boundary never calls that function. It instead
serializes concurrent replacements the ordinary PostgreSQL way: a
`SELECT ... FOR UPDATE ORDER BY retailer_id` over exactly the thirteen rows
scoped to the principal's own tenant/user, in the same fixed alphabetical
order the normalized payload already uses. Provisioning alone creates these
rows; a request against a principal whose complete set is not already fully
provisioned fails closed rather than creating any.

An identical submitted set is a true zero-write `unchanged` result — no row,
audit, or outbox record is touched. A changed set updates only the
retailers whose fields actually differ and atomically appends exactly one
audit and one outbox record in the same transaction; PostgreSQL owns every
timestamp. Replay of an already-receipted request is fingerprint-guarded: it
re-derives the same deterministic request ID, recomputes the payload's
SHA-256 fingerprint, and returns the original immutable result unchanged
only when both match exactly.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, zero direct and cross-boundary SQL, complete-set and fixed-order
enforcement, missing-row fail-closed rejection, row-level lock
serialization, true zero-write unchanged behavior, and fingerprint-guarded
immutable replay. This closes `attributionPolicyParity`. Trusted strategy
semantics, final action/inbox composition, and every request-repository
family remain open. SQLite remains authoritative; use
`npm run postgres:signal-attribution-policy-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.95.0 adds the twenty-first independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded source-connection
provisioning writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role
owns no application object, inherits no role, has zero direct/effective
table or column grants, and may call one strict security-definer function.
The boundary protects three forced-RLS tenant tables — `audit_events`,
`outbox_events`, and `source_connections` — and all three are in its
mutation set.

PostgreSQL binds `session_user` to one exact tenant/user, consumes only the
shared source lock (`10000`), and accepts one explicit
`provision_source_connections` operation under
`SOURCE_CONNECTION_PROVISIONING_V1`. Every request ID is derived from the
authenticated principal plus the fixed defaults version and confirmation.
The function provisions exactly the three default connections SQLite's
`PrincipalRepository` bootstrap creates — TrackaLacker and Browser
observations at `trusted_exact` with auto-create-missions enabled, and
Discord at `informational` without it — using the same content-derived
`ownedIdForUser` identity scheme SQLite uses, so the PostgreSQL and SQLite
connection IDs match bit-for-bit for the same principal.

Because the shared writer-lock protocol's source scope revalidates
ownership of a connection that must already exist, the function first
inserts a deterministic, conflict-safe TrackaLacker anchor row (`ON
CONFLICT DO NOTHING`) before taking the shared lock against it; PostgreSQL's
own unique-index semantics serialize concurrent first calls on that anchor,
and every other mutation happens strictly after the lock succeeds. Each
connection, whether freshly inserted or already present, is then
revalidated against its exact expected identity, and a conflicting existing
row fails closed rather than silently adopting a different one. A call that
finds all three connections already correctly provisioned is a true
zero-write `unchanged` result.

Only a call that actually creates at least one connection appends one
deterministic audit and outbox record; PostgreSQL owns every timestamp, and
immutable replay of an already-receipted request returns the original
result unchanged. Native PostgreSQL 16 proves wrong, same-tenant-peer, and
unmapped principal denial, zero direct and cross-boundary SQL, deterministic
SQLite-identical connection identity, anchor-then-lock source-scope
contention, existing-identity conflict rejection, true zero-write unchanged
behavior, and immutable audit/outbox replay. This closes
`connectionProvisioningWriterParity` and, with every source-domain writer
now qualified, aggregate `sourceWriterParity`. `writerLockProtocolParity`
remains false — eight signal boundaries still sit outside the shared
protocol — SQLite remains authoritative; use
`npm run postgres:signal-source-provisioning-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.94.0 adds the twentieth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the bounded TrackaLacker
catalog-import writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role
has zero direct/effective table or column grants and may call one strict
security-definer function. The boundary protects fourteen forced-RLS tenant
tables and five shared-catalog tables (`listing_urls`, `listings`,
`product_families`, `retailers`, `variants`); its exact mutation set is eleven
tenant tables plus four of those shared tables — every one except `retailers`,
which is revalidated only.

PostgreSQL binds `session_user` to one exact tenant/user, consumes only the
shared source lock (`10000`), and accepts one explicit operation — importing
one bounded TrackaLacker catalog item of up to 250 listings — under
`TRACKALACKER_CATALOG_IMPORT_V1`. Every request ID is derived from the
authenticated principal, operation, and the complete product/listing payload.
The database revalidates the active user-owned Chrome device, private
TrackaLacker source, and, when scoped to one, an active sync run, then
resolves exact product/listing identity across every source and
shared-catalog reference before accepting or rejecting the whole set.

One transaction creates or reuses a product family/variant, accepts every
listing candidate, maps each fully-identified listing — registered retailer,
revalidated canonical URL across thirteen supported retailers — into the
shared catalog, records an offer observation, attaches a disabled mission
target when an existing mission already targets the variant, refreshes each
retailer's current preferred route, marks the source connection connected,
and, when scoped to an active sync run, upserts one deterministic
per-product sync-item receipt. Stale or conflicting observation timestamps
and identities are rejected; the whole operation appends exactly one audit
and outbox record, and immutable replay returns the original result
unchanged.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, zero direct and cross-boundary SQL, registered-retailer and
canonical-URL revalidation, complete-set identity conflict rejection,
stale-observation rejection, device/source/run ownership revalidation, forced
late-failure rollback, source-lock contention, and immutable audit/outbox
replay. This closes `catalogImportWriterParity`. Source-connection
provisioning still sits outside the boundary, so aggregate
`sourceWriterParity` remains false. SQLite remains authoritative; use
`npm run postgres:signal-catalog-import-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.93.0 adds the nineteenth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the terminal spend-reservation
lifecycle writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has
zero direct/effective table or column grants and may call one strict security-
definer function. The boundary protects six forced-RLS tenant tables and can
mutate only `spend_reservations`, append-only `spend_ledger_entries`,
`audit_events`, and `outbox_events`.

PostgreSQL binds `session_user` to one exact tenant/user, consumes only the
shared spend lock (`00001`), and accepts two explicit operations under
`APPLY_SPEND_RESERVATION_LIFECYCLE_V1`. Release is limited to an exact active
action/reservation graph whose current job is rejected, expired, cancelled, or
confirmed without an order, plus expiry proven by the database clock only
before the job could have mutated a cart or order. Commit
is limited to an active `submit_order` reservation whose job is already
`confirmed` and whose latest confirmed action evidence contains one
unambiguous positive total equal to the requested amount and no greater than
the reserved amount.

An applied request updates one reservation and atomically appends one ledger,
audit, and outbox record. Request identity covers the authenticated principal,
operation, exact graph IDs, reason or amount, and confirmation. Immutable
replay tolerates normal outbox delivery but rejects partial or altered receipt
graphs. The function cannot change an action job, create action evidence, fill
checkout, submit an order, fulfill a mission, or complete an inbox message; it
only records a terminal fact already established by a separately authorized
executor.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, zero direct and cross-boundary SQL, exact graph binding, invalid-state
and ambiguous-total rejection, database-clock pre-mutation expiry, forced late-failure
rollback, spend-lock contention, release and commit replay, append-only ledger
accounting, and zero action or mission mutation. This closes
`reservationWriterParity`. Catalog import and source provisioning still sit
outside the shared protocol, so aggregate `writerLockProtocolParity` and
`sourceWriterParity` remain false. SQLite remains authoritative; use
`npm run postgres:signal-reservation-lifecycle-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.92.0 adds the eighteenth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the TrackaLacker source-sync run and
per-product receipt writer. Its separate `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role has zero direct/effective table or column grants and may call
one strict security-definer function. The boundary protects six forced-RLS
tenant tables and can mutate only `source_sync_runs`,
`source_sync_run_items`, `audit_events`, and `outbox_events`.

PostgreSQL binds `session_user` to one exact tenant/user, consumes only the
shared source lock (`10000`), and accepts three explicit operations under
`TRACKALACKER_SOURCE_SYNC_V1`: start a run, advance its full progress snapshot,
or upsert one imported-product receipt. Every request ID is derived from the
authenticated principal, operation, and complete payload. The database
revalidates the private TrackaLacker connection, active user-owned Chrome
device, and exact run ownership on every call.

Starts require zero counters and enforce one fresh active run per device; a
run inactive for more than 30 minutes is atomically closed as interrupted
before its replacement starts. Progress phases and all six counters are
monotonic, messages are privacy-bounded, and only the first terminal transition
adds a deterministic audit/outbox pair. Product receipts are accepted only
while the run is active and retain SQLite's latest-state upsert behavior.
Exact current progress/item retries write nothing; audited start and terminal
requests retain immutable replay after later state changes.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, active-device/private-source/TrackaLacker/run binding, zero direct and
cross-boundary SQL, forced late-failure rollback, source-lock contention,
fresh-run exclusion, stale-run interruption, monotonic progress, terminal
history, item insert/current/refresh behavior, and zero catalog or action
creation. This closes `sourceSyncWriterParity`, while catalog import and
connection provisioning remain separate, so aggregate `sourceWriterParity`
stays false. SQLite remains authoritative; use
`npm run postgres:signal-source-sync-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.91.0 adds the seventeenth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: the TrackaLacker push-status and
heartbeat writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has
zero direct/effective table or column grants and may call one strict
security-definer function. The boundary protects five forced-RLS tenant tables
and can mutate only `source_device_states`, `source_connections`,
`audit_events`, and `outbox_events`.

PostgreSQL binds `session_user` to one exact tenant/user, consumes only the
shared source lock (`10000`), and accepts the explicit
`RECORD_TRACKALACKER_STATUS_V1` operation for one exact private TrackaLacker
connection and active user-owned Chrome device. Every request ID is derived
from the authenticated principal plus the complete normalized payload. Client
observation timestamps must be exact and monotonic; stale updates and same-
timestamp state collisions fail closed. PostgreSQL owns the connection and
event timestamps while preserving the exact client observation time on the
device state.

An initial or materially changed state atomically writes the two status rows
plus deterministic audit/outbox receipts. A heartbeat that only advances
`updatedAt` refreshes those two rows without flooding history, and an exact
latest retry writes nothing. That nonmaterial path is deliberately described
as latest-state replay only; immutable replay is claimed only for material
requests with receipts, which remain replayable after later state changes.

Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, active-device/private-source/TrackaLacker binding, zero direct and
cross-boundary SQL, forced late-failure rollback, source-lock contention,
deterministic request identity, material replay, timestamp-only no-audit
refresh, exact-current replay, stale/collision rejection, and zero action
creation. This closes `sourceStatusWriterParity`, while source sync/import and
connection provisioning remain separate, so `sourceSyncWriterParity` and
aggregate `sourceWriterParity` stay false. SQLite remains authoritative; use
`npm run postgres:signal-source-status-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.90.0 adds the sixteenth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: one exact append-only mission-policy revision
writer. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has zero
direct/effective table or column grants and may call one strict
security-definer function. The boundary protects six forced-RLS tenant tables
and the shared `listings` catalog, but can mutate only
`mission_intent_revisions`, `audit_events`, and `outbox_events`.

PostgreSQL binds `session_user` to one exact tenant/user and accepts only a
full `revise_mission_policy` replacement with the explicit
`REVISE_MISSION_POLICY_V1` confirmation. It consumes settings then mission-
policy locks (`00110`), requires the exact current revision and `intent-policy-
v2` hash, and revalidates the mission, complete ordered target/listing graph,
USD currency, tax, and retailer allowances. A direct add-to-cart preference is
accepted only when at least one enabled target is execution-supported,
first-party, shipping, price-bounded, and covered by the submitted all-in cap.

A changed policy appends exactly one revision plus deterministic audit/outbox
receipts in one transaction; an unchanged policy is a true zero-write success.
Native PostgreSQL 16 proves wrong, same-tenant-peer, and unmapped principal
denial, zero direct SQL and cross-boundary access, stale revision/hash denial,
unsafe direct-purchase rejection, late-failure rollback, exact and altered
replay, settings and mission-lock contention, byte-identical policy hashes,
catalog tamper rejection, and zero action creation.

This closes `missionPolicyWriterParity` without granting action, shared-catalog,
or runtime authority. General source lifecycle/status and reservation writers
remain outside the boundary, so `sourceWriterParity`,
`configurationWriterParity`, `reservationWriterParity`, and
`writerLockProtocolParity` remain false. SQLite stays authoritative; use
`npm run postgres:signal-mission-policy-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.89.0 adds the fifteenth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: one exact activation writer for the packaged
Walmart, Amazon, and Best Buy add-only lanes. Its separate `NOLOGIN`,
`NOINHERIT`, `NOBYPASSRLS` role has zero direct/effective table or column
grants and may call one strict security-definer function. The boundary protects
nine forced-RLS tenant tables and the shared `retailers` and `listings` catalog;
its exact mutation set is five tenant tables plus those two shared tables.

PostgreSQL binds `session_user` to one exact tenant/user, accepts only the three
fixed activation operations and their current packaged observer/adapter
versions, consumes retailer-qualification then settings locks (`01100`), and
takes a global advisory lock for the exact retailer. It re-derives the current
30-day evidence hash, two-SKU coverage, first-party actionable and shipping
coverage, passed no-click rehearsal, latest companion capability, and Amazon's
ephemeral offer route when applicable. Shared capability flags can only move
from disabled to enabled for the exact Walmart, Amazon, or Best Buy identity;
arbitrary retailer/listing changes, disable, and retirement are impossible.

One transaction upserts the user qualification, monotonically enables that
retailer and its existing listings, promotes eligible first-party shipping,
quantity-one shadow jobs only when actions are already live and unpaused, and
appends deterministic action, audit, and outbox receipts. Native PostgreSQL 16
proves late-failure rollback across the tenant/shared graph, wrong,
same-tenant-peer, and unmapped principal rejection, zero direct SQL, exact and
altered replay behavior, real settings-writer and global-retailer contention,
shared-identity tamper rejection, Amazon offer-route validation, and all three
retailer branches.

This closes `nonTargetQualificationWriterParity`,
`sharedCatalogExecutionWriterParity`, and aggregate
`retailerQualificationWriterParity`. General source lifecycle/status,
mission-policy, and reservation writers remain outside the boundary, so
`sourceWriterParity`, `configurationWriterParity`,
`reservationWriterParity`, and `writerLockProtocolParity` remain false. SQLite
stays authoritative; browser mutation, checkout, orders, arbitrary retailers,
and production principals remain closed. Use
`npm run postgres:signal-retailer-qualification-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.88.0 adds the fourteenth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: bounded source-trust configuration.
Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has zero
direct/effective table or column grants and may call one strict
security-definer function over exactly three forced-RLS tenant tables:
`source_connections`, `audit_events`, and `outbox_events`.

PostgreSQL binds `session_user` to one exact tenant/user, consumes only the
shared source scope (`10000`), revalidates one private user-owned connection,
and requires its optimistic `updated_at` value plus the explicit
`CONFIGURE_SOURCE_TRUST_V1` confirmation. The transaction accepts only
`informational` or `trusted_exact`; an informational source can never receive
auto-mission authority. PostgreSQL owns the next timestamp and atomically
updates trust plus deterministic audit/outbox receipts. Exact replay is
mutation-free and remains valid after later outbox delivery, while changed,
partial, or stale requests fail closed.

Native PostgreSQL 16 proves late-outbox-failure rollback, wrong,
same-tenant-peer, and unmapped principal rejection, zero direct SQL, invalid
trust/auto-mission rejection, immutable replay, stale revision denial, and an
uncommitted source writer blocking an independent shared-lock consumer. This
closes `sourceTrustWriterParity`, but general source lifecycle/status remains
outside the boundary, so `sourceWriterParity`, non-Target
`retailerQualificationWriterParity`, `configurationWriterParity`,
`reservationWriterParity`, and `writerLockProtocolParity` remain false. SQLite
stays authoritative and no production principal is provisioned. Use
`npm run postgres:signal-source-trust-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.87.0 adds the thirteenth independently receipted piece of the
inactive PostgreSQL hosted-signal plane: complete Target add-only
qualification/settings activation. Its separate `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role has zero direct/effective table or column grants and may
call one strict security-definer function over nine forced-RLS tenant tables,
with a six-table mutation set.

PostgreSQL binds `session_user` to one exact tenant/user, consumes the shared
retailer-qualification then settings scopes (`01100`), and revalidates the
current 30-day Target dossier, exact evidence hash, passed no-click rehearsal,
active Target add-v1 Chrome capability, and settings revision. One transaction
upserts the user-scoped Target qualification, changes settings to live and
unpaused, promotes only fresh first-party shipping quantity-one shadow jobs,
and appends deterministic action, audit, and outbox receipts. Exact replay is
mutation-free; altered or partial receipt graphs fail closed.

Native PostgreSQL 16 proves late-outbox-failure rollback, wrong and unmapped
principal rejection, zero direct SQL, exact evidence recomputation, one-job
promotion, immutable replay, and real contention with the bounded settings
writer. This closes `qualificationSettingsWriterParity` for Target only. At
that boundary, Walmart, Amazon, and Best Buy activation still required a
separate writer that safely handles their shared retailer/listing capability
flags, so aggregate
`retailerQualificationWriterParity`, `configurationWriterParity`,
`reservationWriterParity`, and `writerLockProtocolParity` remain false.
SQLite stays authoritative and no production principal is provisioned. Use
`npm run postgres:signal-target-qualification-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.86.0 adds the twelfth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: one bounded configuration writer for the three
current user-facing safety operations—global action pause/resume, guardrail
settings, and periodic spend caps. Its separate `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role has zero direct/effective table or column grants and may call
one strict security-definer function across four forced-RLS tables.

Every request is bound to the authenticated `session_user`, exact tenant/user,
operation, deterministic request ID, and canonical payload. Settings updates
consume only the shared settings lock; spend-policy updates consume only the
shared spend lock. PostgreSQL owns timestamps, requires the expected settings
timestamp or policy revision, appends audit/outbox receipts atomically, permits
mutation-free exact replay, and rejects a changed payload under the same
request identity. Native PostgreSQL 16 proves late-failure rollback, principal
isolation, direct-table denial, unchanged spend-policy behavior, and a held
pause transaction blocking the reviewed action writer until commit.

This is partial writer parity, not runtime activation. At this 0.86 boundary,
qualification-settings, source-trust, retailer-qualification, strategy,
mission-policy, and reservation writers remained outside it, so `settingsWriterParity`,
`configurationWriterParity`, `reservationWriterParity`, and
`writerLockProtocolParity` remain false. SQLite stays authoritative and no
production principal is provisioned. Use
`npm run postgres:signal-constraint-config-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.85.0 adds the eleventh independently receipted piece of the inactive
PostgreSQL hosted-signal plane: a database-owned, lock-only coordination
protocol for source trust, retailer qualification, application settings,
mission policy, and spend constraints. Its separate `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role has zero direct/effective table or column grants, no mutation
tables, and one strict security-definer function across seven forced-RLS tenant
tables. PostgreSQL binds the caller through `session_user`, validates the exact
tenant/user, source, mission, and retailer identities, and acquires only the
requested scopes in the fixed global order.

The reviewed action/spend boundary now consumes the complete five-scope mask
before re-reading its current constraints. Native PostgreSQL 16 holds that
protocol from one session while two competing action applications block, then
proves one atomic writer and one mutation-free replay after release. The
protocol itself never changes configuration, reservations, actions, inbox
state, retailer sessions, checkout, or orders.

This is coordination infrastructure, not runtime activation. Existing source,
qualification, settings, mission-policy, and reservation writers have not yet
been ported through the helper, so `configurationWriterParity`,
`reservationWriterParity`, and `writerLockProtocolParity` remain false. There
are no production principals, SQLite remains authoritative, and attribution,
strategy action semantics, final inbox composition, and hosted cutover remain
closed. Use `npm run postgres:signal-writer-lock-protocol -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.84.0 adds the tenth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: atomic action-job and spend-reservation creation
for one exact, explicitly reviewed purchase intent. Its separate `NOLOGIN`,
`NOINHERIT`, `NOBYPASSRLS` role owns no application object, inherits no role,
has zero direct/effective table or column grants, and may execute one strict
security-definer function across 19 forced-RLS tenant tables.

PostgreSQL authenticates `session_user`, requires the complete v0.83
predecessor graph, and locks the inbox message, mission, target, policy,
settings, source, retailer qualification, and spend policy in fixed order. It
revalidates the exact product and active target, remaining quantity and sibling
claims, fulfilled quantity, cooldown, fresh trusted first-party evidence that
matches the saved Shipping or Pickup choice, the exact current add-only adapter,
quantity one, and per-order, daily, and monthly limits. A valid first application atomically appends the
exact offer/snapshot, action job and initial event, active reservation and
reserved ledger entry, qualified mission decision, audit event, and outbox
event across nine mutation tables. Complete immutable replay writes nothing
and tolerates only normal action/outbox lifecycle changes; partial or altered
graphs fail closed.

Action authority is intentionally purchase-intent-only; strategy-sourced
decisions remain notification-only. Marketplace offers, ambiguous or mismatched
fulfillment, noncanonical attribution, retailer DOM mutation, checkout, order
submission, and inbox completion are structurally closed. The role remains
inactive and SQLite remains authoritative. Existing
configuration/reservation writers still need the same lock protocol,
attribution-policy parity is incomplete, and final hosted-handler composition,
production principals, repository parity, and cutover drills remain required.
Use `npm run postgres:signal-action-spend-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.83.0 adds the ninth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: application-owned strategy and purchase-policy
evaluation after exact mission binding. Its separate `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role owns no application object, inherits no role, has zero
direct/effective table or column grants, and may execute one strict security-
definer function across 19 forced-RLS tenant tables. PostgreSQL authenticates
`session_user`, revalidates the live leased-inbox capability and immutable
signal/mission handoff, and serializes both the message and canonical
event/mission pair.

The reusable domain evaluator emits a complete fingerprinted attestation over
the exact signal, policy revision, full ordered strategy set, mission target,
freshness, seller/fulfillment policy, quantity, cap, action, and source-trust
restriction. PostgreSQL revalidates the current input snapshots on first
application. `matched` and `needs_price` are zero-write continuations;
`unmatched`, `stale`, and `quantity_limited` are forced to quantity-one,
notification-only terminal outcomes and atomically append exactly one mission
decision, audit event, and outbox event.

Replay is bound to the original immutable attestation and receipt graph, so a
later policy/strategy revision or normal outbox delivery cannot invalidate it.
Partial or changed graphs, fractional/missing numeric fields, widened mission
quantity, inactive actionable targets, stale first-write evidence, cross-
principal access, and concurrent duplicate-message races fail closed. Native
PostgreSQL 16 proves rollback of a forced third-insert failure, deterministic
IDs and timestamps, event/mission serialization, lifecycle-preserving replay,
direct-SQL denial, and immutable function-catalog verification.

The role remains inactive: SQLite is authoritative. This seam creates no
action job or spend reservation, does not complete the inbox message, and does
not authorize any retailer action. Its v0.84 successor now performs that
atomic recheck and composition only for an exact reviewed purchase intent, but
remains separately inactive. Use `npm run
postgres:signal-strategy-evaluation-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.82.0 adds the eighth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: exact mission binding after the v0.81
post-incident decision requests continuation. Its separate `NOLOGIN`,
`NOINHERIT`, `NOBYPASSRLS` role owns no application object, inherits no role,
has zero direct/effective table or column grants, and may execute one strict
security-definer function across 18 forced-RLS tenant tables. PostgreSQL binds
`session_user`, validates the live leased-inbox capability, revalidates the
entire predecessor chain, and serializes both the message and exact variant.

The boundary selects an unambiguous user-owned mission or creates one only for
a trusted exact source authorized to do so. It attaches every known listing for
the same exact variant, up to 10,000, and creates revision 1 of the existing
append-only purchase intent only when no policy exists, preserving the current
mission quantity (one for a newly created mission). Mission and initial-
policy creation each receive exact audit and outbox receipts. Concurrent calls
produce one writer and mutation-free replay; stale plans, ambiguous missions,
non-USD initial policy inputs, partial graphs, changed rows, and cross-principal
access abort the transaction.

Shared catalog, incidents, terminal decisions, strategies, action jobs, spend,
notifications, inbox lifecycle, retailer sessions, checkout, and order
submission remain untouched. Native PostgreSQL 16 proves existing and newly
created missions, complete variant-target attachment, initial policy semantics,
byte-identical SQLite policy hashes, principal/direct-SQL denial, concurrency,
replay, rollback, and immutable catalog tamper detection. The role remains
inactive: SQLite is authoritative,
strategy/policy evaluation, action composition, final inbox completion, and
production principals remain closed; complete handler coverage stays six of
seven and retailer authority is unchanged. Use `npm run
postgres:signal-mission-binding-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.81.0 adds the seventh independently receipted piece of the inactive
PostgreSQL hosted-signal plane: the bounded decision immediately after an exact
actionable offer and incident have settled. Its separate `NOLOGIN`,
`NOINHERIT`, `NOBYPASSRLS` role owns no application object, inherits no role,
has zero direct/effective table or column grants, and may execute one strict
security-definer function across 17 forced-RLS tenant tables. PostgreSQL binds
`session_user`, validates the live leased-inbox capability, and requires the
exact v0.80 predecessor to be fully applied and replay-stable before this
boundary can plan anything.

The boundary terminates only two repository-equivalent cases. A signal that
corroborates one existing user-owned action job requires at least two exact
incident observations. A source that is not both `trusted_exact` and permitted
to create missions records `no_mission` when no exact mission target exists.
Either case atomically inserts exactly one `mission_decisions`, one
`audit_events`, and one `outbox_events` row. Complete replay writes nothing;
partial or changed decision graphs, cross-user action jobs, ambiguous mission
bindings, and stale predecessor state abort the transaction.

Signals still needing an exact mission target or mission creation return
`continue_downstream` with explicit `missionBindingRequired` and
`missionCreationRequired` projections and zero writes. Catalog, source
references, terminal decisions, offers, incidents, missions, strategies,
purchase policy, action jobs, notifications, spend, and inbox lifecycle remain
untouched, and no raw signal payload or decision reason is returned.

Native PostgreSQL 16 proves principal isolation, direct-SQL denial, all three
outcomes, exact stored decision/audit/outbox semantics, simultaneous plan/apply
serialization, mutation-free replay, partial-state failure, corruption
detection, runtime-grantee-safe verification, and immutable function-catalog
tamper detection. The role remains inactive: SQLite is authoritative, mission
binding/creation, strategy and action composition, final inbox completion, and
production principals remain closed; complete handler coverage stays six of
seven and retailer authority is unchanged. Use `npm run
postgres:signal-post-incident-decision-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.80.0 adds the sixth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: the actionable offer-observation, incident, and
occurrence slice. Its separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has
zero direct/effective table or column grants and may execute one strict
security-definer function across 14 forced-RLS tenant tables. PostgreSQL binds
`session_user`, validates the current leased TrackaLacker capability, and
requires the exact v0.79 terminal predecessor to return the sealed
`continue_downstream` outcome before any mutation is planned.

The database derives the semantic key and opaque observation, occurrence, and
new-incident IDs from immutable committed evidence. Message and semantic-key
advisory locks serialize both replay and corroboration. A new actionable signal
inserts one `offer_observations` row and one `signal_occurrences` row, then
either inserts one open `signal_incidents` row or increments the exact recent
open incident selected under the configured 30–3600-second dedupe window. An
exact replay writes nothing; a partial graph, identity collision, changed row,
or inconsistent occurrence count aborts the transaction.

Shared catalog, source references, terminal decisions, missions, strategies,
purchase policy, actions, notifications, spend, and inbox lifecycle remain
untouched, and no raw signal payload is returned. Native PostgreSQL 16 proves
principal isolation, direct-SQL denial, same-message concurrency, deterministic
row semantics, replay, incident corroboration, partial-graph and corruption
recovery, clean membership removal, and immutable function-catalog tamper
detection. The role remains inactive: SQLite is authoritative, the remaining
mission/policy/action graph and final inbox composition remain closed, complete
handler coverage remains six of seven, and retailer authority is unchanged.
Use `npm run postgres:signal-offer-incident-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.79.0 adds the fifth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: terminal evaluation for test signals,
ambiguous or unresolved identities, and matched non-actionable events. Its
separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has zero direct/effective
table or column grants and may execute one strict security-definer function
across 11 forced-RLS tenant tables. PostgreSQL binds `session_user`, validates
the current leased TrackaLacker capability, requires the exact committed event
and resolution plus a settled v0.78 source-reference result, and rejects plans
older than 30 seconds.

Each terminal branch atomically inserts exactly one `signal_occurrences` row,
one terminal `mission_decisions` row, one `audit_events` row, and one
`outbox_events` row. Test signals remain dry-run-only; non-actionable offers
remain notification-only. A matched actionable signal returns
`continue_downstream` without writing. Complete replay is mutation-free, while
a partial or inconsistent terminal graph aborts. Shared catalog, source
references, incidents, offer observations, missions, strategies, action jobs,
and inbox lifecycle remain untouched, and no raw signal payload or reason is
returned to the application.

Native PostgreSQL 16 proves all four terminal outcomes, exact stored audit/
outbox semantics, actionable zero-write continuation, prerequisite ordering,
invalid-token and principal isolation, direct-SQL denial, one mutation under
simultaneous application, replay, partial-graph rollback and recovery,
membership cleanup, and immutable function-catalog tamper detection. The role
remains inactive: SQLite is authoritative, the remaining incident/offer/
mission/policy/action graph and final inbox composition remain closed,
complete handler coverage remains six of seven, and retailer authority is
unchanged. Use `npm run postgres:signal-terminal-decision-apply -- plan ...`
and the [PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.78.0 adds the fourth independently receipted piece of the inactive
PostgreSQL hosted-signal plane: known-product source-reference refresh after an
exact event and unique matched resolution have already committed. Its separate
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has zero direct/effective table or
column grants and may execute one strict security-definer function. PostgreSQL
binds `session_user` to the expected tenant/user, validates the current leased
TrackaLacker inbox capability before locks, re-derives the v0.75 resolution,
and rejects application plans older than 30 seconds.

The boundary can insert or refresh only `source_product_refs`,
`source_listing_refs`, and `source_product_aliases`. It requires a non-test,
matched event with exact source identities, never remaps an existing reference
to another catalog object, and makes replay mutation-free. Application plans
contain a SHA-256 identity hash rather than raw source IDs. Shared catalog,
occurrence, offer, incident, mission, policy, action, notification, spend, and
inbox-lifecycle state remain untouched.

Native PostgreSQL 16 proves exact insert and newer-observation update semantics,
zero-write ambiguous/test branches, invalid-token and principal isolation,
direct-SQL denial, one mutation under simultaneous refresh, mutation-free
replay, conflicting-remap rollback and recovery, clean membership removal, and
immutable function-catalog tamper detection. The role remains inactive:
SQLite is authoritative, the downstream occurrence/incident/offer/mission/
action graph and final inbox composition remain closed, complete handler
coverage remains six of seven, and retailer authority is unchanged. Use `npm
run postgres:signal-source-reference-refresh -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.77.0 adds a third independently receipted piece of the inactive
PostgreSQL hosted-signal plane: the exact signal-event and catalog-resolution
commit. Its dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no
objects, has zero direct/effective table or column grants, and may execute one
strict security-definer function. The application plans and applies in one
`READ COMMITTED` transaction while PostgreSQL binds the database-authenticated
tenant/user and leased inbox capability, serializes the exact transport
identity, re-derives the current v0.75 resolution plan, and rejects plans older
than 30 seconds.

The boundary either returns the existing event for a transport duplicate or
atomically inserts one `signal_events` row, updates the exact TrackaLacker
source heartbeat, and inserts one `resolution_decisions` row. Matched,
ambiguous, unresolved, and duplicate outcomes preserve the current SQLite
committed-state semantics. An unknown product that still requires catalog
creation fails closed until the separate v0.76 role has run. The function
cannot create or refresh catalog mappings, occurrences, offer observations,
incidents, missions, strategies, notifications, spend records, or action jobs;
it cannot complete the inbox message and returns no raw payload.

Native PostgreSQL 16 proves exact row deltas and stored semantics, wrong-token,
cross-tenant, same-tenant/different-user, unmapped-principal, replay, and direct-
SQL denial, one mutation under simultaneous application, catalog-first
composition, all four resolution outcomes, preserved inbox state, and immutable
function-catalog tamper detection. The role remains inactive: SQLite is still
authoritative, existing source-reference refresh and the downstream occurrence/
incident/mission/action graph remain closed, complete handler coverage remains
six of seven, and no retailer authority is widened. Use `npm run
postgres:signal-resolution-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.76.0 adds the next deliberately separate piece of the inactive
PostgreSQL hosted-signal plane: an insert-only shared-catalog creation boundary
for an unknown product from an already leased, `trusted_exact` TrackaLacker
signal. Its dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no
objects, has zero direct/effective table or column grants, and may execute one
strict security-definer function. The application plans and applies inside one
`READ COMMITTED` transaction; PostgreSQL re-derives the current v0.75
resolution plan, binds the database-authenticated tenant/user and one-use inbox
capability, locks the exact identities, and refuses plans older than 30 seconds.

Only missing rows may be inserted: family, variant, listing, canonical URL, and
the exact tenant source-product, source-listing, and TrackaLacker-slug
references. Canonical identities are constrained to the 13 packaged retailer
formats. Existing mappings cannot be refreshed, remapped, updated, or deleted.
The function cannot create signal events, resolutions, occurrences, offers,
missions, strategies, incidents, notifications, spend records, or action jobs;
it does not acknowledge the inbox message and returns no raw signal payload.

Native PostgreSQL 16 proves exact row deltas, subsequent resolution to the new
listing, no implicit inbox completion, wrong-token, cross-tenant, same-tenant/
different-user, unmapped-principal, replay, and direct-SQL denial, one winner
under concurrent application, and immutable catalog-tamper detection. The
qualification role and its mutation authority remain inactive: SQLite is still
the runtime source of truth, source-reference refresh and downstream signal-
evaluation apply remain closed, complete handler coverage remains six of
seven, and no retailer authority is widened. Use `npm run
postgres:signal-catalog-apply -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.75.0 advances the inactive hosted-delivery PostgreSQL qualification
plane to contract v3 with a third exact security-definer function. For a
currently leased `signal_event_v1` message, PostgreSQL revalidates the database-
authenticated principal, unexpired capability, stored payload hash, packaged
TrackaLacker parser contract, exact source connection, and transport identity,
then derives the same bounded catalog-resolution priority used by SQLite.

The result is a server-clocked plan valid for at most 30 seconds and sealed by
a length-delimited SHA-256 fingerprint. It contains only source metadata,
signal identity, duplicate/resolution outcome, and the matched public listing;
raw identity, offer, and evidence payloads are not returned. The routine takes
a shared lock on the leased inbox row but has no write statement, direct table
grant, or catalog/mission/strategy/incident/action authority. An unresolved
trusted exact identity merely declares that a separately qualified shared-
catalog mutation would be required.

Native PostgreSQL 16 proves exact listing and retailer-SKU matches, ambiguous
and unresolved outcomes, duplicate detection, payload/transport/plan hash
parity, wrong-token, cross-tenant, same-tenant/different-user, replay, unmapped,
and direct-SQL denial, plus zero changes across the catalog, signal, mission,
strategy, incident, observation, and action graphs. Plan application and the
remaining signal-evaluation mutations are still closed, so complete handler
coverage remains six of seven and no PostgreSQL runtime or retailer authority
is activated.

Version 0.74.0 extends the inactive PostgreSQL qualification plane from expired
hosted-delivery lease recovery to the complete transport lifecycle for the
fixed `signal_event_v1` inbox. Contract v2 retains one dedicated `NOLOGIN`,
`NOINHERIT`, `NOBYPASSRLS` role with zero direct/effective table or column
grants, but permits exactly two strict security-definer functions across the
same three forced-RLS tables. The new function binds `session_user` to the
expected tenant and user, leases one eligible TrackaLacker message with
`FOR UPDATE SKIP LOCKED`, and applies acknowledgement, retry, or attempt-20
dead-letter transitions using only PostgreSQL's statement clock.

The application generates each 60-second, 43-character capability; PostgreSQL
stores only its length-delimited SHA-256 hash, clears that hash on completion
or failure, and never writes the raw token into a row or receipt. Every
transition appends the existing deterministic delivery receipt. Native
PostgreSQL 16 proves one-winner contention, exact
same-tenant user and cross-tenant isolation, mismatched/unmapped/direct-SQL
denial, wrong-token rejection, completion, delayed retry, terminal dead letter,
receipt parity, and catalog-tamper detection. Inbox acceptance and durable
signal evaluation are not part of this slice: catalog, policy, mission,
notification, spend, and action-job mutations remain SQLite-only, complete
handler coverage remains six of seven, and no runtime or retailer authority is
activated.

Version 0.73.0 removes the last unresolved PostgreSQL tenant-ownership class
before signal evaluation receives any hosted write authority. Migration 48
rebuilds `signal_incidents` with exact tenant/user ownership and a composite
user foreign key. Existing ownership is derived only from durable event,
occurrence, decision, and action-job evidence; a missing or multi-principal
history aborts atomically instead of guessing. The signal repository now scopes
deduplication, corroboration, and lifecycle changes to the exact tenant/user.
The existing execution-recovery qualification now verifies all nine protected
relations under forced RLS and requires the same exact owner inside its
security-definer incident transition. User privacy exports include the owned
incident and occurrence history while excluding every other principal.

The deterministic PostgreSQL manifest now classifies all 95 portable tables:
83 tenant-scoped, six shared catalog, three authorization catalog, two
deployment control, and one tenant registry, with zero unresolved grants.
Upgrade tests prove preservation, child-reference integrity, restored foreign-
key enforcement, and ambiguous-owner rollback; signal-engine tests prove that
the same semantic offer creates independent incidents for different users.
Hosted signal evaluation itself remains closed, complete handler coverage stays
six of seven, SQLite remains authoritative, and no production principal or
retailer authority is activated.

Version 0.72.0 qualifies the compact lease-recovery half of the final
`hosted_delivery_recovery` PostgreSQL handler without overstating handler
parity. A new inactive `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role owns no objects,
has zero direct or effective table/column grants, and can execute one strict
security-definer routine across inbox, outbox, and append-only delivery receipt
tables. PostgreSQL binds `session_user` to the expected tenant/user, uses its
statement clock, and preserves the existing attempt-20 retry/dead-letter
transitions plus exact SHA-256 receipt construction.

Native PostgreSQL 16 proves stale/current boundaries, all four aggregate
results, deterministic receipt parity, idempotent replay, one winner under
concurrency, cross-tenant isolation, mismatched/unmapped/direct-SQL denial, and
catalog-tamper detection. Complete handler coverage deliberately remains six of
seven because the same worker task also evaluates durable TrackaLacker signals;
that wider catalog/mission/policy/action repository graph is not yet ported.
SQLite remains authoritative and no runtime principal or production authority
is activated. Use `npm run postgres:delivery-lease-recovery -- plan ...` and
the [PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.71.0 ports `observer_recipe_witness_refresh`, the sixth of seven
background-task handler families, to the inactive PostgreSQL qualification
plane. Its independent `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role has zero
direct/effective table or column grants and can execute one strict
security-definer routine across six forced-RLS tables. The application performs
HTTPS publication and pinned Ed25519 verification outside database
transactions; PostgreSQL independently derives the tenant-scoped public
checkpoint, revalidates the fresh two-phase plan and canonical receipt bytes,
and atomically appends only public receipt, check, audit, and outbox metadata.

Native PostgreSQL 16 proves signed acceptance, fresh no-op, renewal, bounded
outage recording, invalid-signature rejection without writes, one winner under
concurrent application, exact user attribution, tenant/unmapped/direct-SQL
denial, stale-plan rejection, and catalog-tamper detection. Witness endpoint
URLs, public-key SPKI configuration, and private keys are absent from the
routine and persisted evidence. SQLite remains authoritative and no runtime
principal or production authority is activated. Use
`npm run postgres:witness-refresh -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.70.0 completes the PostgreSQL repository boundary for
`adapter_alert_reconciliation`, bringing native handler parity to five of
seven. A new inactive `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role has zero direct
table or column grants and can execute one strict security-definer routine
across ten forced-RLS tables. It resolves the database-authenticated
tenant/user, serializes each principal, derives at most 50 repair groups from
the newest 2,000 sanitized diagnostics, and revalidates a two-phase plan before
applying any incident change.

The routine preserves the existing open, repeat, update, escalation,
auto-resolution, audit, outbox, dashboard-delivery, and secretless connector-
queue semantics. Application-generated opaque IDs and connector payload hashes
are revalidated in PostgreSQL; only endpoint references cross the boundary.
Raw webhook URLs, signing secrets, page evidence, product identifiers, retailer
mutation, and network egress remain inaccessible.

Native PostgreSQL 16 proves exact lifecycle/result parity, replay suppression,
reopen-after-recovery, same-tenant user and cross-tenant isolation,
mismatch/unmapped denial, stale and altered plan rejection, one winner under
concurrent reconciliation, direct SQL denial, production-handler routing, and
catalog-tamper rejection. The API and worker remain SQLite-authoritative; no
login, principal mapping, runtime role, or production cutover is activated.
Use `npm run postgres:alert-reconciliation -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.68.0 ports `observer_recipe_candidate_evaluation`, the fourth of
seven complete background-task handler families, to the inactive PostgreSQL
qualification plane. Its dedicated `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role
has zero direct table or column grants and can execute exactly one strict
security-definer routine. A two-phase call derives a server-owned evidence
plan from at most 2,000 sanitized diagnostics, proposes at most 25 candidates,
and revalidates that evidence in the same `READ COMMITTED` transaction before
inserting anything.

The only permitted output is the existing deterministic, unsigned, 30-day,
quarantined observer candidate plus its lifecycle, audit, and outbox receipts.
The routine cannot sign, promote, distribute, fill a field, execute a recipe,
or authorize a retailer action. Native PostgreSQL 16 proves exact result
parity, cross-tenant isolation, mismatch/unmapped denial, stale-plan and
payload-tamper rejection, idempotent replay, concurrent deduplication, direct
SQL denial, production-handler routing, and catalog-tamper rejection. Exactly
four of seven handlers are qualified; all PostgreSQL runtime authority remains
inactive. Use `npm run postgres:observer-candidates -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.67.0 ports the third complete background-task handler family to the
inactive PostgreSQL qualification plane. `operational_telemetry_retention` has
its own `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role with zero direct table, column,
insert, update, or delete grants and exactly one strict security-definer
routine. PostgreSQL's statement clock applies the existing 30-day operational
telemetry/task-history window and 90-day observer-recovery window; one call may
delete at most 500 eligible quarantined evidence rows.

The function resolves `session_user` through the server-owned principal
registry, serializes tenant-wide cleanup, attributes evidence receipts to that
authenticated database principal, and emits only the existing bounded
retention, audit, and outbox receipts. Native PostgreSQL 16 proves old/current
boundaries, recent-review preservation, cascade counts, cross-tenant isolation,
idempotent replay, concurrent one-winner deletion, direct SQL denial,
mismatched/unmapped rejection, production-handler routing, and catalog-tamper
rejection. Exactly three of seven handler families are qualified; all roles and
runtime authority remain inactive. Use
`npm run postgres:operational-retention -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.66.0 ports the second complete background-task handler family to the
inactive PostgreSQL qualification plane. `execution_recovery` has its own
`NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role with zero direct table or column
grants and exactly one strict security-definer routine. The database statement
clock—not caller time—drives stale lease, action-window, and spend-reservation
decisions. The routine preserves action events, append-only spend-ledger
entries, audit events, and outbox receipts while returning only three aggregate
counts.

The port also closed a latent multi-tenant edge in both SQLite and PostgreSQL:
an action transition could close or lock the then-shared `signal_incidents` row
only when every bound action and signal occurrence belonged to the exact
tenant/user. Version 0.73 adds direct ownership enforcement while retaining
those independent corruption guards. Native PostgreSQL 16 proves every pre/post-mutation state,
receipt parity, direct-SQL denial, mismatched/unmapped principal rejection,
cross-tenant shared-incident isolation, idempotent replay, concurrent one-winner
recovery, and catalog-tamper rejection. Exactly two of seven handler families
are qualified; runtime composition and PostgreSQL authority remain closed. Use
`npm run postgres:execution-recovery -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.65.0 ports the first complete background-task handler family to the
qualified PostgreSQL plane without activating it. `notification_recovery` now
has a dedicated `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` role with zero direct table
or column grants. It can execute exactly one strict security-definer routine;
that routine resolves `session_user` through the server-owned principal
registry, rejects an expected-principal mismatch, and performs only the three
existing notification expiry, exhausted-lease failure, and expired-lease
requeue transitions using PostgreSQL's statement clock, so callers cannot move
the expiry boundary. It returns three aggregate counts and no row content.

The production maintenance handler accepts this asynchronous repository seam,
while SQLite remains its default and authoritative runtime. Native PostgreSQL
16 proves handler-level result parity, cross-tenant isolation, unmapped and
mismatched principal denial, zero direct table access, idempotent replay,
one-winner concurrent recovery, cleanup of every temporary membership/mapping,
and receipt rejection after routine tamper. This is one of seven handler
families; the other six, all request repositories, production login
provisioning, and the authority switch remain closed. Use `npm run
postgres:notification-recovery -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.64.0 separates the last global background-worker control operations
from the all-powerful qualification connection. A new, inactive
`NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` fleet-control role has 19 exact column
privileges across three tables, grouped into four operations: it can paginate
user IDs, read the singleton deployment expectation, read the bounded heartbeat
fields needed for status, and update only four stop-related heartbeat columns.
Three explicit RLS policies bound those operations, and the update policy
requires the resulting state to be `stopped`. It cannot read
queue tasks, insert or delete rows, update user or deployment records, execute
application functions, use sequences, own objects, create schema objects, log
in, acquire membership, or authorize a retailer action.

The complete PostgreSQL worker-store qualification now routes principal
pagination, deployment status, and worker stopping through a dedicated
`READ COMMITTED` control adapter while tenant queue work continues through the
server-bound queue writer. Native PostgreSQL 16 proves both repository paths
together, including two-page principal enumeration, exact deployment coverage,
one-worker stopping, prohibited operations, and receipt rejection after policy
tamper. The role and principal registry remain inactive after verification;
the API and worker remain SQLite-backed. Use `npm run postgres:worker-control
-- plan ...` and the [PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md)
runbook.

Version 0.63.0 closes the time-of-check/time-of-use gap between standalone
worker deployment attestation and a tenant queue mutation. Queue-write contract
v3 adds one `SELECT`-only grant on the singleton API-owned
`background_worker_deployment_expectations` table. The server-bound writer now
validates the exact deployment contract, runtime version, and public deployment
fingerprint inside the same `READ COMMITTED` transaction before schedule
initialization, due enqueue, or a new lease runs. Already-leased completion and
bounded failure recovery deliberately remain available after expectation drift.

The role now has 12 exact operations across five tables, while its write surface
is unchanged: four tenant queue tables, four restrictive tenant policies, no
deployment update, and no delete. Native PostgreSQL proves the role can read the
expectation but cannot change it, and a deliberate attestation mismatch leaves
the schedule count unchanged. At the 0.63 boundary, principal enumeration,
fleet status, and worker stopping still used the qualification connection;
0.64 moves them to their separately qualified control role. No runtime
principal, handler, authority switch, dual write, or retailer capability is
activated.

Version 0.62.0 connects the complete PostgreSQL tenant queue repository to the
server-bound writer qualified in 0.61. Schedule creation, due enqueue, event
append, `SKIP LOCKED` lease, capability-protected completion/retry, and heartbeat
transactions now run through that exact role in the native qualification suite.
The first repository attempt correctly failed on a missing constraint-helper
permission; queue-write contract v2 adds only `EXECUTE` on the imported
`yoink_json_valid(text)` helper required by the task table. The helper is
strict, immutable, non-security-definer, accepts one text value, and is sealed
with the binder and scope functions in the exact catalog receipt.

Two independent server-bound writer pools now run the production queue-store
SQL through native PostgreSQL 16 and prove schedule/task/event creation, retry,
heartbeat, locked-row skipping, exact-one-winner contention, one-use completion,
tenant isolation, prohibited operations, helper-definition tamper detection,
and policy tamper detection. At that v2 boundary, principal enumeration,
deployment attestation/status, and worker stopping used the qualification/
control connection, and attestation was not atomic with the tenant write. No production principal,
handler repository, API repository, login, membership, runtime authority, dual
write, or retailer authority is activated; SQLite remains authoritative.

Queue-write contracts v1 and v2 are historical qualification evidence only.
Apply v3 only to a fresh cutover schema and fresh role namespaces; never modify
or adopt an earlier receipt. Use `npm run postgres:writes -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook.

Version 0.61.0 added the first server-bound PostgreSQL write boundary without
activating it. One fresh `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` queue-writer role
has exactly 11 `SELECT`/`INSERT`/`UPDATE` grants across schedules, tasks,
append-only task events, and worker heartbeats. It has no `DELETE`, `TRUNCATE`,
`REFERENCES`, `TRIGGER`, sequence, ownership, schema-creation, other-table, login,
membership, or runtime authority. Four restrictive policies intersect every
read and write with the server-owned tenant/user binding qualified in 0.60.

A production-driver adapter opens `READ COMMITTED READ WRITE` transactions,
assumes only the queue-writer role, invokes the zero-argument server binder, and
refuses a binding that differs from the authenticated principal expected by the
caller. Native PostgreSQL 16 tests prove two simultaneous tenant writers cannot
see or mutate each other's rows and explicitly deny cross-tenant insertion,
deletion, task-event updates, unrelated-table reads, mismatched identities, and
unmapped identities. The verifier seals the exact grants, function definitions,
and restrictive policy expressions and deliberately fails after policy tamper.

This remains qualification evidence: the principal registry is empty, no login
or membership is provisioned, task handlers and API repositories still use
SQLite, and PostgreSQL has no runtime or retailer authority. Use `npm run
postgres:writes -- plan ...` and the [PostgreSQL cutover
qualification](docs/POSTGRES_CUTOVER.md) runbook for the bounded operator flow.

Version 0.60.0 added a qualification-only PostgreSQL tenant-session boundary.
One `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` reader now receives exact `SELECT`
access to all 83 tenant-scoped tables after migration 48. A server-owned principal registry and
zero-argument security-definer binder derive tenant and user from PostgreSQL
`session_user`; callers never pass identity into the binder. Eighty-three
restrictive policies intersect that server-bound identity with the existing
forced RLS policies. PostgreSQL permits clients to change custom settings, so
Yoink does not claim otherwise: changing `yoink.tenant_id` or `yoink.user_id`
can narrow a session but cannot widen it beyond the registered principal.
An immutable receipt seals the exact policy expressions and security-definer
function definitions so later catalog drift fails verification.

A read-only production-driver adapter verifies the exact expected principal at
the start of every transaction. Native PostgreSQL 16 tests prove simultaneous
tenant isolation, mismatch and unmapped-principal denial, write denial, and
scope containment after hostile setting changes. The shipped registry is
empty, creates no login, grants no membership, and activates no API, worker,
retailer, or write authority. SQLite remains the sole runtime source of truth.
Use `npm run postgres:sessions -- plan ...` and the
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md) runbook for the
bounded operator workflow.

Version 0.59.0 adds a hermetic native PostgreSQL 16 qualification suite for the
asynchronous worker queue. After importing the complete verified archive and
applying the restricted read-role contract through the production `pg` driver,
three distinct server backend sessions prove locked-row skipping, delivery of
the next eligible task, an exact-one-winner two-worker race, one-use capability
completion, and invalid-capability denial. The test runs inside `npm test` and
can be invoked alone with `npm run test:postgres:native`.

Cutover contract v3 records this release-level proof while the unchanged schema
manifest remains at v2. This is qualification evidence, not a deployed worker
fleet: PostgreSQL request/task-handler repositories, authenticated runtime
session and write roles, idempotent handler replay, production load/outage,
backup/PITR, and authority-switch drills remain closed. SQLite remains the sole
runtime source of truth.

Version 0.58.0 added a deterministic, qualification-only PostgreSQL read-role
boundary over the table classifications completed in 0.57. Five fresh
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` roles originally received 94 exact
`SELECT` grants. Migration 48 now expands that same contract to all 95 tables:
83 tenant-RLS tables, six shared-catalog tables, three authorization-catalog
tables, two deployment-control tables, and the tenant registry. Source-less
mixed offers, every write privilege, role
membership, and application-schema routine or sequence access remain closed.
The verifier detects role-attribute, membership, ownership, schema, table,
column, routine, and sequence privilege drift, and records an immutable inert
receipt. Health and the admin Operations workspace expose the exact proof
without claiming active PostgreSQL roles or production authority.

The roles are group-role templates only: the API and worker do not assume them,
no login role is created, and no tenant session-binding or write-role contract
is implied. SQLite remains the sole runtime source of truth. See
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md).

Version 0.57.0 completed explicit tenant-scope classification for all 95
portable tables. Forced PostgreSQL RLS now covers 68 direct-owner tables and
13 tables whose ownership is inherited through exact foreign keys. The one
mixed-scope offer-observation table hides source-less shared rows from tenant
roles until separately governed shared-catalog roles are proven. Six shared
catalog, three authorization catalog, two deployment control, one tenant
registry, and one unresolved table are named rather than assigned guessed
policies.

The release also adds a qualification-only PostgreSQL implementation of the
complete asynchronous worker-store contract. On an inert verified schema it
passes bounded principal pagination, schedule/dedupe behavior, tenant-bound
`FOR UPDATE SKIP LOCKED` leasing, capability-protected completion and retry,
heartbeats, stopping, and deployment attestation. It is deliberately not wired
to the API or worker: PostgreSQL task handlers, independent multi-connection
contention, runtime login/session and write roles, backup/restore, and the
authority switch remain
closed. SQLite is still the sole runtime source of truth. See
[PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md).

Version 0.56.0 added the offline PostgreSQL cutover qualification plane without
changing runtime authority. A verified portability archive can be streamed in
bounded batches through the production `pg` driver into one new private schema
inside a serializable transaction. The importer preserves packaged keys,
foreign keys, indexes, safe defaults, checks, and state-guard triggers; forces
default-deny RLS on direct-tenant tables; and requires exact logical hashes
before issuing an inert verified receipt.

Version 0.55.0 makes internal service authorization workload-scoped and
deny-by-default. A hosted deployment must explicitly map each signed service
actor to exactly one of delivery processing, contributor-eligibility
attestation, or principal provisioning. Unconfigured actors receive no
internal permission; request headers and proxy signers cannot select a
capability; and each sensitive repository repeats the route-level check.

Health and the admin Access workspace expose only counts, coverage, a registry
fingerprint, and opaque service references. Raw actor IDs and secrets remain
deployment-private. This is a least-privilege authorization boundary, not yet
cryptographic workload identity: production still needs mTLS/OIDC workload
proof, managed secrets, and signed artifacts around the trusted proxy. No
database migration or retailer-lane state changes are involved. See
[internal service capability isolation](docs/INTERNAL_SERVICE_CAPABILITIES.md).

Version 0.54.0 adds a service-only contributor-eligibility boundary and a
seven-day regional conflict SLO for read-only observer recipes. Migration 47
stores one expiring, pre-pseudonymized account/device/coarse-region attestation
per paired device and snapshots only fully eligible proof onto new trials. Raw
identity, IP, postal location, and risk-provider payloads are outside the
contract, and old evidence can never become eligible retroactively.

The SLO counts only the latest eligible trial per account pseudonym, exact SKU,
layout, and recipe stage. It is measurable at 10 trials, three accounts, and
two coarse regions; more than 10% conflict can disable read-only distribution
only after at least two conflicts span two accounts and two regions. A known
packaged conflict remains an immediate kill. The local provider is deliberately
unconfigured, so local accounts remain private, unverified evidence—not
production public reputation. Eligibility and conflict enforcement cannot fill
a field, apply recovery evidence, sign or promote a recipe, qualify a store,
create a job, invoke Chrome, or mutate a retailer session. See the
[regional conflict SLO](docs/OBSERVER_RECIPE_REGIONAL_CONFLICT_SLO.md).

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
quarantined normalized store details introduced in 0.51. The Settings
workspace (then called Preferences) asks whether the exact public value was correct, incorrect, or
whether an earlier confirmation should be withdrawn. Requests accept only a
fixed decision and its exact confirmation phrase; free text and page/account
context are not part of the contract.

Migration 45 records each real decision as a sequenced append-only event bound
by composite tenant/user/evidence identity and a deterministic evidence hash.
Retries are idempotent, current state is a projection rather than an evidence
edit, and user deletion remains an intentional privacy cascade. Reviews are
included in self-service export and projected in the admin registry. They do
not fill observations, affect promotion or qualification, change plans, create
jobs, reserve spend, or invoke Chrome. Version 0.54 adds an expiring external
eligibility seam and measured regional conflict SLO, while a real production
identity/risk provider, public reputation/Sybil operations, and a separately
governed read-only application projection remain open. The bounded retention
policy arrived in 0.53. See
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
without an item-count cap. It can also qualify one new PostgreSQL schema through
an exact one-shot import and reconciliation receipt, but no API or worker uses
that schema. Local mode remains the default; see the hosted deployment contract
before enabling the boundary mode.

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
**Settings › Operations › Workers** in `/admin`. For an intentional maintenance stop,
set `YOINK_BACKGROUND_WORKER_MODE=disabled`; health then reports `disabled`,
schedules and queued tasks remain durable, and no task handler runs until the
worker is re-enabled. Signal intake still returns a durable queued receipt, but
evaluation waits for the worker. Disabling the worker does not cancel an
already leased store action—use the user-facing **Pause actions** control
for store cart changes. The legacy
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

For a separate offline PostgreSQL qualification, first export and verify an
archive, then run `npm run postgres:cutover -- preflight`, the acknowledged
one-shot `import`, and an independent `verify`. The subsequent inactive
least-privilege boundaries are operated with `npm run postgres:roles -- ...`,
`npm run postgres:sessions -- ...`, and `npm run postgres:writes -- ...`; every
apply command requires its documented explicit acknowledgement and none
provisions a runtime login or principal mapping. Follow the
[PostgreSQL cutover runbook](docs/POSTGRES_CUTOVER.md); the result is not a
runtime cutover and cannot authorize actions.

Observer-recipe trust initialization, renewal, rotation, revocation, restart,
and recovery procedures are documented in the [rooted trust
runbook](docs/OBSERVER_RECIPE_TRUST.md). The offline private root is never an
API input, server dependency, extension asset, release file, or portability
record.

## Load and pair the Chrome companion

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked**.
3. Choose `apps/extension` from this repository.
4. Open Yoink › **Settings › Chrome** and create a one-time pairing code (or
   use **Settings › Users** in `/admin`).
5. Enter the code in the extension popup within five minutes.

Pairing stores a hashed Chrome companion credential in Yoink and the runtime
credential in Chrome extension storage. The Chrome companion has no cookie API
access and no persistent store content script.

## Connect TrackaLacker

Stay signed in on a normal TrackaLacker tab, open the Yoink popup, and choose
**Reconnect** when calls need attention. The extension creates a real PushSubscription and
a minimal MAIN-world function submits the confirmed nested device contract from
the signed-in TrackaLacker origin. Push endpoint/key material, cookies, CSRF
values, Cloudflare/session values, and signed notification URLs never enter the
Yoink database, queue, telemetry, or logs.

Chrome 121+ supports a silent extension subscription, so TrackaLacker's normal
browser notification remains the visible alert. If Chrome reports that silent
push is unavailable, the popup states that the fallback can produce an extra
visible notification. Yoink still deduplicates calls and action jobs
independently of desktop toast presentation.

Choose **Sync products** from the popup overflow for a user-requested catalog pass. It has no
application product or plan-count limit and imports every source listing
returned by TrackaLacker, including out-of-stock, Best Buy, unsupported-store,
and alternate same-store records. Progress and per-product receipts are
durable. This is catalog synchronization, not stock polling; live inventory
events continue to arrive through Web Push.

## Configure behavior

The user dashboard stays focused on guided setup, exact products, plans,
Activity, and Settings. If the product is not yet approved,
choose **Add product link**, paste the store's exact product page and product
name, verify the extracted store/SKU, and explicitly send it for independent
review. That suggestion carries no stock or price claim and creates no plan.
For an approved listing, choose **Create purchase plan**,
then review the item/SKU, store-as-seller, fulfillment, quantity, unit and total
caps, timing, and allowed action before anything is created. Notifications are
the default; add-to-cart is offered only for a qualified mapping, requires an
explicit shipping choice and a total that covers the current conservative tax
and store-fee safety bound, and still leaves checkout manual. Later changes use
the same revisioned plan editor. Reviewed plans decide exact matches directly;
advanced ordered rules remain available as defaults for source-created
plans and specialist routing. Catalog
suggestions remain pending until reviewed in the admin control center. Detailed
source health, diagnostics, privacy-classified operator alerts, store
qualification, recipes, affiliate setup, catalog review, reversible
merge/split/compensation history, and role membership are intentionally
isolated under `/admin`.

There is no separate Calls start switch:

- Connected sources continuously ingest calls.
- A reviewed user plan directly produces its saved notification or qualified
  cart decision for a fresh exact offer; it does not require a hidden rule.
- The default catchall rule produces notifications for rule-owned
  source/import plans.
- An exact trusted call can create a new plan and attach all known store
  listings without overwriting user settings.
- A store listing discovered after a plan exists is attached disabled
  until the user explicitly includes it in a new plan revision.
- For rule-owned plans, higher rule rows win. Empty keywords mean
  catchall; quoted phrases, `+` terms, alternatives, and exclusions are
  supported.
- MSRP policies are maximums and include every lower price.
- Seller policy, allowed seller names, fulfillment, quantity, call age, price
  cap, and exact source/store selections are evaluated before a job is created.
- **Pause actions** persists and prevents new purchase jobs and leases while
  call intake and history continue.

When two stores or sources report the same product, one active purchase job
claims the plan. Corroborating calls are recorded but cannot create a
second purchase. A verified rejection or pre-mutation cancellation releases the
claim for a legitimate later repeat call. A potentially mutated or uncertain job
stays locked until the user explicitly reviews the store session.

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
not the normal Walmart product observer or `walmart-add-v8` qualification
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

The four action stores now use constrained local layout recovery. Packaged
selectors remain primary; a semantic Add control or price is accepted only when
it has one unique privacy-bounded landmark and the existing exact product,
seller, fulfillment, quantity, price-cap, offer-scope, and offer-token checks
all pass. Duplicate candidates fail closed. Remote observer recipes remain
read-only shadow evidence and cannot supply click targets.

Target's qualified `target-add-v7` runner requires:

- live execution mode, Actions unpaused, an online paired device, and a current
  adapter qualification;
- an immutable exact TCIN job with unit/total caps;
- quantity one, Target as seller, and exact Shipping or explicitly configured Pickup fulfillment;
- a complete pre-add baseline of at most 25 unique SKU-and-quantity lines;
- exact binding to Target's current fulfillment tiles and either its TCIN-scoped
  Add control or the one unique product-level Add control on the exact TCIN page;
- guarded selection of available Shipping, or available same-day Delivery when
  Shipping is unavailable, followed by immediate live SKU, stock, seller, price,
  and fulfillment revalidation;
- a durable `adding` receipt before one click;
- an exact +1 delta afterward, with every baseline quantity unchanged.

Walmart's separately gated `walmart-add-v8` runner applies the same immutable
job, bounded-baseline, at-most-once, cart-delta, and recovery boundaries. In addition,
the live buy box must exactly match Shipping or explicitly configured Pickup,
Walmart must be the seller, and
virtual queues, memberships, location prompts, authentication, MFA, or security
challenges stop the job before mutation. Walmart's current split layout can
bind its locally serialized selected offer only when exact item ID, offer ID,
new condition, USD price, internal Walmart seller, selected in-stock
fulfillment, quantity one, and one unambiguous primary Add control all agree.

Amazon's separately gated `amazon-add-v9` runner requires an exact ASIN,
Amazon.com as first-party seller and an exact Shipping or explicitly configured
Pickup offer, quantity one,
a provable Amazon cart baseline, and a unique offer token scoped with the price,
seller evidence, shipping evidence, and Add control. Observer v8 binds the
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
is never used. The resulting cart must show exactly one authorized quantity
added while every baseline quantity remains unchanged.

Best Buy's separately gated `bestbuy-add-v11` runner requires an exact numeric
SKU from a current or legacy product URL, explicit visible `Sold by Best Buy`
evidence in the same bounded offer scope as one Add-to-Cart control and price,
an exact Shipping or explicitly configured Pickup selection, and quantity one.
`Sold & shipped by` marketplace offers, mismatched fulfillment, high-demand
queues, location/account/security blocks, and ambiguous or conflicting SKU
evidence stop before mutation. Observer v10
recognizes current Best Buy test/automation attributes and safely reports when
a native Add-intent control exists outside the known selector set, allowing the
sanitized repair queue to distinguish selector drift from a genuinely missing
control. It also binds a seller name represented by bounded accessibility
metadata inside the exact seller element. Explicit in-store-only products are
manual/local evidence with unknown global availability rather than false
out-of-stock evidence. Migration 53 retires inherited qualifications for all
four stores, and migration 57 retires the prior Best Buy lane after the
rendered-security change, requiring fresh evidence and current-runner rehearsal before
explicit activation. Its bounded baseline, at-most-once receipt, immediate offer
revalidation, and exact cart-delta proof match the other guarded lanes. A historical
repair group is superseded only by a strictly newer packaged adapter's later
non-failure result for that same exact SKU. An exact first-party preorder with
an actionable Pre-order control uses this same guarded add path; preorder status
alone is never a rejection reason.

A generic retailer-mutation capability cannot authorize Target, Walmart,
Amazon, Best Buy, or any future lane.

Prepare-checkout and submit-order are displayed as eight independent future
qualification lanes. They have no packaged runner or activation endpoint.
Pickup is part of each exact add-only contract, but is never inferred: only an
explicit saved Pickup target can bind a live available Pickup offer; all legacy
or ambiguous fulfillment settings default to Shipping. Prepare/submit strategies remain non-leasable rehearsal
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

The local popup overflow's **Check for updates** item compares semantic versions against the
local Yoink release, validates exact filename/hash/size metadata, and downloads
the packaged ZIP when newer. Chrome does not allow an unpacked extension to
replace its own source directory. Extract the ZIP over the same companion
folder, then reload it on `chrome://extensions`. Pairing and local extension
state remain in Chrome storage.

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
contract](docs/HOSTED_DEPLOYMENT.md), [Worker deployment attestation](docs/WORKER_DEPLOYMENT_ATTESTATION.md), [Observer witness refresh](docs/OBSERVER_WITNESS_REFRESH.md), [Observer regional conflict SLO](docs/OBSERVER_RECIPE_REGIONAL_CONFLICT_SLO.md), [Hosted Chrome device transport](docs/HOSTED_DEVICE_TRANSPORT.md), [Durable signal ingress](docs/SIGNAL_INGRESS.md), [Adapter repair intelligence](docs/ADAPTER_REPAIR_INTELLIGENCE.md), [Durable repair candidate evaluation](docs/OBSERVER_REPAIR_CANDIDATE_EVALUATION.md), [Data portability and recovery](docs/DATA_PORTABILITY.md), [PostgreSQL cutover qualification](docs/POSTGRES_CUTOVER.md), [CartCollect browser-safety
migration](docs/CARTCOLLECT_MIGRATION.md), and [Roadmap](docs/ROADMAP.md).
