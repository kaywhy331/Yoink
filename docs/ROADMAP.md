# Yoink roadmap

## Shipped through 0.24.0

### Package-rooted observer recipe trust (0.24.0)

- Migration 26 retires every active or signed trust-on-first-use recipe without
  changing retailer execution or qualification state. It adds immutable,
  tenant-scoped trust-manifest generations and append-only chained
  transparency events
- The server and companion pin the same Ed25519 public offline root. The root
  authorizes bounded online intermediate keys through exact-schema manifests;
  one active unrevoked key is required, generations and predecessor hashes are
  monotonic, prior keys cannot silently disappear, and revocation is permanent
- The paired companion validates the complete root-signed chain, current
  manifest/hash, active-key fingerprint and lifetime, transparency checkpoint,
  recipe signature, and selector schema. It persists the latest generation and
  event checkpoint so replay, conflicting generations, broken rotation chains,
  corrupted root signatures, expired manifests, and revoked signers fail closed
- `npm run recipe-trust` initializes, renews, or rotates the online
  intermediate while loading the offline root only inside the explicit CLI.
  Named intermediate key files support restart after rotation; private material
  is never printed, served, packaged, archived, or stored in SQLite
- `/admin` exposes public root/manifest/revocation/transparency health and an
  explicit signed-manifest install control. Rotation may temporarily close
  distribution; after the process loads the new intermediate, maintainers must
  explicitly and auditably re-sign already reviewed recipes without changing
  their selectors or lifecycle state
- Rooted recipes remain declarative data for five packaged read-only fields.
  They cannot determine product equivalence, navigate, click, fill a form,
  qualify an adapter, enter a drawing, check out, submit an order, or grant any
  retailer mutation capability. See the [operator
  runbook](OBSERVER_RECIPE_TRUST.md)

### Privacy-classified operator alerts (0.23.0)

- Migration 25 adds tenant-scoped operator alert rules, deduplicated incidents,
  append-only lifecycle events, and append-only delivery receipts. Existing
  and newly provisioned tenants receive one conservative adapter-repair rule
- Authenticated diagnostic ingestion and alert reconciliation share one
  transaction, so an accepted structural failure cannot be committed without
  its matching threshold/dedupe/routing decision. A recovered repair group
  automatically resolves its alert; a manually resolved historical group stays
  closed until a strictly later qualifying failure occurs
- Rules narrow the fixed `adapter_repair` family by retailer and operation and
  configure severity, occurrence threshold, dedupe window, escalation window,
  enabled state, and dashboard/audit-outbox routes. Every route, acknowledge,
  resolve, reopen, recovery, and escalation transition produces immutable
  operational evidence
- `/admin` now has an Alerts workspace for redacted incident triage, rule
  management, and delivery history. `admin.read` gates projections and the
  separate `alert.manage` permission plus explicit confirmation gates every
  mutation; tenant-forcing tests reject cross-tenant access
- Admin alert projections omit exact SKU, page URL/content, tokens, actor
  identity, account data, and free-form notes. The restricted append-only
  audit history retains actor identity for accountability. Alert records use
  stable allowlisted reason/stage enums, structural hashes, bounded counts, and
  tenant-scoped pseudonymous source cohorts. Companion/server allowlist parity
  is regression-tested
- This is a local adapter-repair alert vertical slice, not a production on-call
  system. External email/webhook/pager delivery, scheduled escalation workers,
  production retention operations, and broader alert families remain open.
  Alert configuration has no purchase or retailer-lane mutation authority

### Walmart Collectibles Draw read-only lifecycle (0.22.0)

- Migration 24 adds a tenant/user/device-scoped, idempotent Walmart Draw scan
  and exact-item ledger with bounded retention. It stores normalized public
  drawing facts only and reconstructs canonical Walmart item URLs server-side
- `walmart-draw-observer-v1` accepts only the exact Collectibles Draw hub. It
  parses bounded server-rendered draw modules with a visible-card fallback,
  detects security/manual blocks, normalizes PDT/PST close labels, deduplicates
  exact Walmart item IDs, and fails partial when price, seller, close time,
  draw control, or suppressed Add evidence is incomplete
- The companion runs this observer only from an explicit user click and posts
  authenticated sanitized scans. Bundle, execution, top-frame, runtime,
  collection, and contract failures are immediately recorded with allowlisted
  codes; raw browser errors and page/account data never leave the tab
- User and admin read models show current drawings, price, close time, quantity
  limit, exact plan matches, scan health, and failures. Expired active drawings
  leave the current projection, while historical evidence remains bounded
- The four validated live records on 2026-08-24 were Walmart item IDs
  `19624258216`, `19536452232`, `5631614124`, and `18029663536`; fixture and
  production-bundle tests preserve their exact prices and limits
- Drawing entry is intentionally not implemented. Entry is one per customer,
  cannot be canceled or changed, and authorizes Walmart to place and charge an
  order if selected. The observer collects no address, payment, account,
  membership, session, cookie, offer token, or entry status and is structurally
  unable to call the entry endpoint. Draw evidence never qualifies
  `walmart-add-v3`

### Reversible local catalog identity governance (0.21.0)

- Migration 23 adds separately authorized `catalog.identity.propose` and
  `catalog.identity.approve` capabilities plus tenant-scoped merge, split, and
  compensating-operation records
- Every proposal freezes a deterministic catalog topology hash. Approval
  rechecks the current topology and rejects stale state, active purchase jobs,
  active spend reservations, ambiguous mission targets, and shared-catalog
  mutation when more than one tenant exists
- Merge is deliberately narrow: it requires a reviewed, conflict-free strong
  identifier claim bound to the exact listing/variant pair, equal allowlisted
  variant dimensions, and approval by a different authorized user and actor.
  Titles, images, prices, and similar URLs remain insufficient evidence
- Split moves only explicitly selected listings, matching source-listing
  candidates, preferred routes, and wholly selected missions into a new exact
  variant. It requires a changed allowlisted dimension and leaves broad source
  product references on the original identity rather than guessing
- Immutable before/after snapshots and append-only per-operation sequence
  events make every applied change auditable. A compensating operation restores
  exact recorded row IDs only when the applied topology has not drifted;
  re-expanding a prior split requires independent approval
- The admin catalog screen exposes proposals, review, rejection, history, and
  compensating rollback. HTTP authorization, error taxonomy, upgrade,
  portability, immutable-ledger, stale-state, active-work, and exact-restore
  tests cover the boundary
- This is a local single-tenant governance slice, not global catalog authority.
  Production IdP/step-up, privacy-classified operations, package-rooted recipe
  trust, and cross-tenant global curation remain Phase 0 exit requirements

### Exact intent and spending safety (0.20.0)

- Migration 22 adds tenant-owned immutable exact-offer keys and offer snapshots.
  The key combines the exact listing/SKU, allowlisted variant dimensions,
  condition, seller, fulfillment, and reserved region/store slots. Ephemeral
  Amazon offer tokens remain page-memory-only and never enter these tables
- Mission preferences now produce append-only intent revisions with optimistic
  concurrency. Each revision freezes quantity, exact target policies, unit and
  all-in caps, action ceiling, substitution policy, expiry, and cooldown
- User spend policy supports optional per-order, daily, and monthly caps.
  Transactional reservations claim quantity and bounded spend before a live job
  can be leased; an append-only ledger records reserve, release, and future
  verified commit events
- A live mutation lease requires the current intent revision, immutable offer
  snapshot, and active unexpired reservation. Revising a plan cancels safe
  unleased stale jobs and releases their reservations in the same transaction
- The user dashboard and canonical user API expose these controls and ledger
  state. The admin snapshot exposes aggregate reservation and ledger counts
  without enabling checkout, payment, or order submission
- Add-to-cart confirmation is no longer treated as fulfillment. It releases
  reserved capacity without recording spend; only a future verified
  `submit_order` result can commit spend and increase fulfilled quantity

### Trust, API, and product-surface foundation (0.19.0)

- Migration 20 adds persisted permissions, built-in roles, and tenant/user role
  memberships. The exact local bootstrap identity remains an explicit
  development exception; a hosted `maintainer` actor label has no implicit
  privilege. Device and service actors receive only fixed narrow capabilities
- Explicit `/api/v1/user`, `/api/v1/admin`, `/api/v1/devices/self`, and
  `/api/v1/internal` surfaces enforce server-side permissions. Classified
  compatibility routes remain temporarily available with deprecation headers;
  unclassified API routes fail closed
- Every HTTP error now carries an `X-Request-ID` and matching correlation ID,
  with distinct authentication, authorization, not-found, validation, and
  opaque internal-error status behavior
- Migration 21 adds a tenant-scoped catalog proposal/review queue. User
  suggestions are normalized to an allowlisted listing payload, deduplicated,
  audited, and held pending; only a curator can approve/reject and apply a
  change. Direct manual user writes to shared listings are disabled
- `/` is a minimal exact-product and purchase-plan dashboard. It exposes
  products, store/seller/fulfillment/quantity/price preferences, recent actions,
  pause/resume, catalog-review status, sources, and Chrome pairing without
  recipes, adapter versions, or parser internals
- `/admin` is a separate permission-gated bundle. It retains operations,
  diagnostics, retailer qualification, community/recipe, source, attribution,
  and audit controls and adds catalog review plus audited role membership
  management. Ordinary users cannot load its HTML, JavaScript, or stylesheet

### Local commerce control plane

- Normalized SQLite commerce graph with tenant/user ownership, exact variants,
  many retailer listings, source aliases/candidates, missions, mission targets,
  offers, incidents, decisions, jobs, notifications, and attribution receipts
- Transactional numbered migrations, integrity checks, and pre-migration backups
- Tenant-scoped audit plus transactional outbox for a future hosted control plane
- No mission-count cap; paginated/searchable Library, Missions, Opportunities,
  Actions, and Activity views
- One-mission-per-variant sibling-store claim so concurrent sources cannot create
  competing purchases
- Explicit manual resolution for post-mutation and submission uncertainty

### Signal and mission engine

- Source-neutral normalized signal contract
- Exact source-listing, retailer-SKU, preferred route, and source-slug resolution
- Trusted exact signals create missing catalog identity and user missions
- Ordered revisioned strategies: source, retailer, price maximum, seller type,
  allowed seller names, fulfillment, quantity, signal age, keywords, exclusions,
  and action
- MSRP is a cap and includes lower prices; missing trusted price/cap fails safe
- Transport dedupe, semantic incident corroboration, legitimate re-signals, and
  mission-wide execution dedupe
- Source reliability projections for exact matches, unresolved events,
  qualified events, and corroborations

### TrackaLacker production adapter

- Existing signed-in page-context device enrollment using the confirmed nested
  `device` payload
- Extension-owned Web Push with silent subscription on Chrome 121+, explicit
  visible-fallback diagnostic, durable sanitized queue, and restart draining
- Stock, restock, preorder, test, unsupported, duplicate, and redacted parser
  coverage
- Full user-requested followed-library synchronization with no application item
  cap; unavailable, unsupported-store, and alternate records are retained
- Durable sync-run progress and per-product import receipts
- No recurring TrackaLacker stock polling and no credential/push-secret storage

### Browser and retailer safety

- Authenticated Chrome pairing, heartbeat, scoped device capabilities, and
  capability-token job leasing
- Read-only visible-DOM observers for Target, Walmart, Amazon, Best Buy,
  Disney Store, Ravensburger, Riot Games Merch, Books-A-Million, Fanatics,
  Kohl's, Macy's, Premium Bandai, and Pokémon Center
- Exact product identities and sanitized canonical URLs for the nine added
  stores; their catalog, signal, notification, attribution, TrackaLacker sync,
  and diagnostic paths are enabled while mutation remains closed
- Premium Bandai observer v2 distinguishes preorder, in-stock, and closed item
  pages with exact letter-plus-ten-digit item IDs; Pokémon Center observer v2
  preserves the complete hyphenated product/variant ID so parent and child
  products cannot collapse
- Live production-bundle probes cover Premium Bandai's multilingual unavailable
  shell and Pokémon Center's Imperva `_Incapsula_Resource` frame. Both fail as
  manual/security blocks with unknown inventory and cleared offer fields, so
  access-control responses cannot poison community stock projections
- Amazon exact-ASIN offer binding and no-click route rehearsal; raw offer IDs
  never leave page memory
- Qualified `target-add-v1`: Target-sold shipping, quantity one, add-to-cart only
- Qualified `walmart-add-v3`: Walmart-sold explicit shipping, quantity one,
  add-to-cart only, activated from its completed live dossier and rehearsal
- Empty-cart preflight, immediate exact offer revalidation, durable pre-click
  receipt, at-most-once click, exact cart proof, lease recovery, and manual locks
- Walmart virtual-queue and interactive-block restraint, independent capability,
  v4 evidence dossier, exact-SKU offer scoping, split-price normalization,
  no-click rehearsal receipt, and explicit activation flow
- Separate Walmart Draw v1 discovery ledger, exact-item mission matching,
  closing-time projection, and immediate sanitized runtime-failure reporting;
  drawing entry and contingent-order authorization remain closed
- Qualification-ready `amazon-add-v5`: Amazon.com-sold explicit shipping,
  quantity one, add-to-cart only; live activation remains evidence-gated
- Amazon exact-offer scope requires price, seller, fulfillment, ASIN, unique
  offer token, and Add control to agree; the token is rechecked immediately
  before one click and is never persisted or returned. Observer v6 checks the
  exact nearest product form first, supports both combined `Shipper / Seller`
  and separate `Ships from` / `Sold by` fields, and retains Amazon-fulfilled
  third-party sellers as non-executable marketplace evidence. Non-rendered CSS
  and script text cannot supply fulfillment, and unrelated same-ASIN forms
  cannot make the selected Add form's offer token ambiguous
- Canonical Amazon offer fields take precedence over alternate payment tokens,
  while explicit checkout ASIN inputs take precedence over variation swatches
- Bounded Amazon hydration retries plus authenticated adapter diagnostics for
  observations, no-click rehearsals, and guarded live verification
- Qualification-ready `bestbuy-add-v3`: explicit Best Buy-sold, selected
  shipping, exact-SKU, quantity-one add-to-cart only; live activation remains
  evidence-gated
- Best Buy observer v4 supports current `/product/.../sku/<SKU>`, compact
  `/product/.../<SKU>`, legacy `/site/.../<SKU>.p`, and consistent `skuId`
  identities while rejecting opaque product tokens and conflicting SKU
  evidence. Current `data-testid`, `data-test-id`, automation, native-button,
  and accessible Add-control layouts are covered. Seller names carried by
  bounded accessibility metadata inside the exact seller element are accepted;
  explicit in-store-only pages are manual/local unknown evidence rather than
  false global out-of-stock assertions
- Best Buy current/legacy scoped-offer coverage, marketplace and pickup
  rejection, high-demand/interactive-block restraint, empty-cart preflight,
  no-click rehearsal, at-most-once click, exact cart proof, independent
  capability, bounded hydration retries, and sanitized adapter diagnostics
- Migration 19 retires every prior Best Buy qualification and closes inherited
  execution support for the v4/v3 boundary; new evidence, rehearsal, hash
  review, and explicit activation are required
- An older exact-SKU repair incident closes only when a strictly newer packaged
  adapter later returns a deliberate pass, recovery, or manual rejection for
  that same SKU; a same-version failure cannot dismiss itself
- Server-derived layout fingerprints, bounded diagnostic retention, and an
  open/recovered adapter repair queue; raw DOM, page text, tokens, cookies,
  CSRF values, addresses, and account data are never accepted
- Post-permission runtime diagnostics cover packaged observer injection,
  execution, top-frame delivery, runtime availability, collection, and
  contract validation. They send only an exact retailer/SKU, stable reason,
  adapter version, timestamp, and zero-content structural counts; raw Chrome
  errors and query-bearing URLs never leave the extension, while pre-permission
  failures remain completely local
- Zero-content runtime repair groups close automatically only after a later
  successful observation for every affected exact SKU, preventing both stale
  resolved incidents and cross-product false recovery
- Durable adapter-diagnostic delivery across local-server outages: a
  device-bound, canonical-only outbox retries transient failures on startup and
  health cycles, deduplicates exact events, retains at most 50 entries for less
  than the server acceptance window, and drops stale, foreign-device, or
  permanently rejected payloads. Server ingestion is exactly idempotent for an
  ambiguous-response retry
- Best Buy diagnostics separately count sanitized native Add-intent controls,
  so an unknown selector is logged immediately as selector drift instead of
  being indistinguishable from an unavailable offer
- Generic retailer-mutation capabilities are rejected; every mutation lane must
  name its exact adapter version
- Cold Manifest V3 worker coverage before and after the mutation boundary
- Durable Chrome notification delivery, click/dismiss receipts, and duplicate
  suppression

### Attribution and updates

- Per-retailer canonical, Howl, and Amazon Associates policies, including
  migration 18 defaults for Premium Bandai and Pokémon Center
- Dynamic exact-listing routes, safe canonical fallback/required-route modes,
  immutable job snapshots, and attribution receipts
- Exact-version local extension release feed with filename, size, and SHA-256
- Popup update check/download and explicit unpacked-extension reload workflow
- Release archive regression coverage proving every packaged observer and all
  four exact mutation runners are present (including Best Buy)

### Community evidence and observer maintenance

Status: these are **local pilot primitives**, not a production community
network or autonomous repair system. The current local deployment cannot form
an independent-user quorum, and its validation/rate limits are not Sybil
resistance or contributor reputation.

- Explicit per-retailer opt-in and one-click contribution; automatic sharing is
  off, deletion is physical, and a visible privacy version/consent receipt is
  retained
- Server-reconstructed, nonce-bound assertions from already-sanitized browser
  evidence; the contribution API never accepts product fields, DOM, page text,
  screenshots, cookies, tokens, account fields, addresses, or payment data
- Observation keys include retailer SKU, seller, fulfillment, and location;
  the current `variantFingerprint` is only a retailer/SKU placeholder and does
  not yet identify a selected size, color, edition, child offer, or condition.
  Store-local pickup scopes, 60-second local/server dedupe, TTLs, basic conflict
  quarantine, and a three-user/device projection are implemented
- Provenance-bearing exact identity claims using validated GTIN/UPC/EAN/ISBN or
  brand+MPN plus bounded variant attributes; claims never remap the catalog or
  transfer missions. The current manual UI path does not attach a paired device,
  so it cannot satisfy the projected healthy-device quorum
- Manually proposed, signed, expiring observer-only recipes with strict
  five-field CSS extraction, lifecycle labels, extension-side Ed25519
  verification/first-use pinning, kill switch, rollback, and bundled fallback.
  This is a shadow-validation scaffold, not autonomous selector discovery,
  independent truth verification, production key rotation, or self-repair
- Remote observer data is permanently unable to navigate, click, submit,
  identify products, or authorize mutation

### Hosted portability foundation

Status: this is an authenticated request/delivery/portability seam around the
local synchronous SQLite application with persisted application RBAC and split
user/admin bundles. It is not a production identity system, step-up/two-person
admin plane, hosted extension transport, worker fleet, or PostgreSQL deployment.

- Async request-local tenant/user/actor scope across every repository with the
  existing local principal retained as an explicit default
- HMAC-authenticated reverse-proxy scopes bound to method/path/principal,
  durable one-use replay nonces, explicit Host/HTTPS-Origin allowlists, and
  paired-device token-to-scope resolution
- Idempotent service-only principal provisioning with private settings,
  sources, strategies, and attribution policies
- Per-user retailer mutation qualification so one account's activation cannot
  authorize another account
- Sanitized 64 KiB inbox envelopes, content-hash idempotency conflicts,
  tenant/user isolation, one-use capability leases, bounded retries,
  dead-letter state, tenant outbox leasing, and append-only delivery receipts
- Future pickup, prepare-checkout, and submit-order prerequisite matrix; all
  twelve per-retailer lanes remain closed and prepare/submit jobs are never
  leasable even when add-only execution is live

### Operational portability and recovery

- Read-only SQLite source opening that performs no migration, seed, or
  permission mutation
- Streaming, item-count-unbounded `yoink-portability-ndjson-v1` archive with an
  exact migration/schema manifest, tagged integers/blobs, stable primary-key
  ordering, per-table counts/hashes, aggregate logical-data hash, and complete
  file SHA-256
- Private `0600` archive creation, overwrite refusal, corruption/truncation
  rejection, and no archive download API
- Fresh-database-only restore with schema parity, foreign-key and integrity
  checks, exact table/data reconciliation, and cleanup limited to output files
  created by the failed restore
- Export, verify, compare, restore, and complete recovery-drill CLI commands;
  changed source tables are named and a non-quiescent drill fails closed

## Architecture assessment after 0.24.0

Yoink 0.24.0 is a strong local commerce safety kernel with a production-shaped
trust/API/UI spine. It is not yet the full
community-driven, self-correcting purchasing application. The existing exact
identity graph, immutable action capabilities, Chrome-side final verification,
diagnostic ledger, and outbox are valuable foundations; the next work should
finish production catalog authority, externally witnessed recipe transparency,
privacy operations, and step-up authority while propagating stable
child-offer/location identity before adding checkout or more autonomous
behavior.

| Product goal | Current repository truth | Critical gap |
| --- | --- | --- |
| Primary backend database | Transactional migration-26 SQLite schema plus deterministic portability, immutable offer/intent/catalog-topology evidence, append-only spend/catalog/trust events, and tenant-scoped alert history | No async PostgreSQL implementation, production identity provider, backup/PITR service, worker deployment, or hosted cutover |
| Admin control plane | Separate permission-gated `/admin`, persisted roles, listing review, reversible local merge/split/compensation, role administration, diagnostics, privacy-classified adapter-repair alerts, retailer/source/affiliate controls, and audit | No production IdP/step-up, secret references, external alert connectors/background escalation worker, break-glass workflow, cross-tenant global curator, or retailer-configuration rollback |
| Minimal user application | Separate `/` dashboard for exact products, revisioned intent, store/seller/fulfillment/unit/all-in limits, action ceiling, expiry/cooldown/substitution preferences, periodic spend caps, activity, pause, pairing, and source/review status | Stable child-offer/region/store dimensions are not yet supplied by every observer; verified-equivalent substitution is policy-only and non-executable |
| Community inventory | Consent, nonce-bound assertions, TTL/conflict projections, and deletion exist inside one tenant | No production shared evidence plane, selected-variation key, contributor reputation/Sybil defense, robust aggregation, privacy operations, or meaningful live quorum |
| Autonomous correction | Sanitized failure groups feed deduplicated redacted operator alerts; observer recipes now use offline-root manifests, rotation/revocation, rollback pins, and transparency receipts | Count-only diagnostics cannot synthesize a selector; bundled-parser agreement is not an independent oracle; canary is not cohort deployment; transparency is not yet externally witnessed |
| Automatic verification | Four packaged add runners revalidate exact browser state and two are qualified | Community truth is advisory, recipe truth is not independent, location/variation identity is incomplete, and no checkout/final-total verifier is packaged |
| Automatic purchasing | Target and Walmart can perform guarded first-party shipping add-to-cart behind current intent/snapshot/reservation checks; Amazon and Best Buy are implemented but separately gated | No checkout-review runner, submit-order runner, destination/payment fingerprinting, committed-order recovery, or live spend-commit path |
| Contingent-order drawings | Exact Walmart Draw cards, deadlines, limits, scan failures, and private plan matches are observed without mutation | No independently authorized drawing-entry capability, frozen terms/fee snapshot, payment/address fingerprint proof, entry/selection reconciliation, or legal/security approval |

### Target trust-domain layout

```text
signal providers ----------> authenticated ingress / durable inbox
user web app --------------> user API
admin web app -------------> admin API
Chrome companions ---------> package-allowlisted HTTPS device API
                                  |
                                  v
                    modular application services
        +----------------+----------------+----------------+
        | private intent | shared catalog | community trust|
        | and preferences| and identity   | and evidence   |
        +----------------+----------------+----------------+
        | execution ledger / spend reservations / audit    |
        | operator config / releases / diagnostics / alerts|
        +---------------------------------------------------+
                                  |
                     PostgreSQL + durable workers
                                  |
             short-lived exact job capability to Chrome
```

`tenant` means one private account, household, or organization. Community
quorum must not be manufactured by putting unrelated consumers into one tenant.
Shared catalog and community evidence need a separately governed plane and
database role, with pseudonymous contributor identity/reputation held behind a
restricted trust service. Private follows, intents, budgets, retailer-account
state, and purchase history never enter that shared plane.

Keep this as a modular monolith until load or ownership demands otherwise. The
important split is contracts, authorization, data ownership, and worker
boundaries—not premature microservices. Use separate `/api/v1/user`,
`/api/v1/admin`, `/api/v1/devices/self`, and `/api/v1/internal` surfaces with
server-side permission checks; a signed `actorKind` header is identity context,
not RBAC.

Production companions should call one package-allowlisted HTTPS device origin
directly. Loopback remains a local/offline development mode, not a cloud sync
peer, and local/cloud dual writes are prohibited. Production extension updates
belong to the Chrome Web Store release channel; the local ZIP feed remains a
development channel.

### Revised delivery order and exit gates

#### Phase 0 — correct trust boundaries and roadmap claims

0.19.0 completed persisted RBAC, explicit API surfaces, correlated errors,
split bundles, and initial catalog candidate review. 0.21.0 adds authorized,
reversible, topology-bound local merge/split/compensation. 0.23.0 adds the first
privacy-classified adapter-repair alert path with allowlisted inputs, redacted
projections, immutable receipts, and separate management permission. 0.24.0
completes the local package-rooted observer-recipe trust slice with monotonic
rotation/revocation, extension rollback protection, and transparency receipts.
The phase exit gate remains **open**: the current shared catalog has no
cross-tenant global curator; general structured metrics/log retention,
externally witnessed transparency, and production IdP step-up are not
implemented.

- Persist operator memberships and granular permissions; deny every route by
  default and explicitly authorize user, device, support, catalog-curator,
  affiliate-manager, retailer-maintainer, security, and service capabilities
- Split user/admin/device/internal API contracts before splitting processes;
  retain `/api/v1` only as a compatibility facade during migration
- Move direct writes to the shared catalog behind candidate, review,
  accept/reject, merge/split, provenance, and rollback workflows. A user import
  may update private source evidence but not silently rewrite an accepted global
  SKU's URL, status, variant, or execution flag
- Add structured server error classes, correct 4xx/5xx behavior, correlation
  IDs, privacy-classified logs, metrics, and sanitized aggregate diagnostics
- Publish production trust checkpoints to an independently witnessed log and
  integrate its availability/consistency alarms; the local append-only receipt
  chain and companion rollback pin are shipped
- Pause implementation or activation of any new mutation retailer beyond the
  four already packaged until this exit gate passes. Existing Amazon/Best Buy
  qualification work and additional read-only observer coverage may continue

Exit gate: hosted user/device scopes receive a tested `403` for every admin or
cross-user operation; identifier-forcing and enumeration tests prove tenant
isolation; catalog mutation requires an authorized, reversible review event;
all material operations have a correlation ID and audit receipt; production
recipe delivery requires rooted rotation/revocation plus an external witness;
local mode remains backward-compatible.

#### Phase 1 — exact offer identity and a product-centric user model

0.20.0 ships the local Phase 1 safety spine: immutable selected-offer keys and
snapshots, revisioned mission-owned policy, all-in/action/substitution/expiry/
cooldown controls, transactional quantity/spend reservations, and an
append-only ledger. Concurrent quantity and daily-budget tests pass, stale
policy leases fail closed, and cart-only confirmation cannot record a purchase.
The broader phase exit remains **open** until live observers supply stable
child-offer plus applicable region/store scope, verified-equivalent selection
has independently governed identity evidence, and a future checkout/order path
can prove and commit a final total without weakening the closed mutation lanes.

- Extend listing identity to an exact selected-offer key: retailer SKU/child
  offer, normalized size/color/edition/language/pack/condition, seller,
  fulfillment, and applicable region/store scope. Never infer equivalence from
  title, image, URL similarity, or price
- Add a revisioned mission-owned `intent_policy` for per-product retailer and
  seller choices, unit and all-in caps, quantity, fulfillment, action ceiling,
  expiry, cooldown, and substitution policy. Keep ordered strategies as an
  optional advanced/default layer instead of generating hidden strategies
- Add spend reservations and an append-only purchase/spend ledger so concurrent
  jobs cannot exceed desired quantity, per-intent caps, or daily/monthly user
  budgets
- Build a user API/read model over missions, targets, current verified offers,
  and receipts; do not create a competing product-intent source of truth
- Replace the current end-user navigation with a minimal `/app`: **Interested
  products**, **Purchases/activity**, and **Preferences/connections**. A product
  card should answer what item, which store/seller, current and maximum price,
  quantity, and what Yoink may do

Exit gate: a non-technical user can create and change an exact purchase intent
without seeing recipes, adapter versions, source parsers, incident dedupe, or
affiliate internals; selected variants cannot collapse; concurrent-job tests
prove quantity and budget reservations.

#### Phase 2 — production backend and device transport

- Implement async repository contracts and PostgreSQL migrations/importer with
  transactional and isolation parity, row-level tenant tests, lease-contention
  tests, idempotent workers, and no dual-write shortcut
- Add production IdP sessions, lifecycle/provisioning, TLS ingress, CSRF/session
  protection, secrets management, encryption, retention/deletion/export,
  backups/PITR, restore drills, load tests, SLOs, and on-call alerting
- Run durable inbox/outbox, signal evaluation, projection cleanup, recipe
  evaluation, and notification work outside request latency
- Ship separate dev and production extension configurations. Production uses
  rotatable device credentials, a package-allowlisted HTTPS origin,
  authenticated pull, Web Push only as a wake hint, and alarms as fallback.
  Chrome retains an independent local pause and action ceiling even when the
  hosted control plane is healthy

Exit gate: a staged PostgreSQL deployment passes restore, isolation, replay,
contention, device revocation, outage, and cutover drills; no production request
depends on the local SQLite process or an unpacked-extension ZIP update.

#### Phase 3 — dedicated admin control plane

0.19.0 establishes the separate permission-gated bundle and implements the
existing local operations views, catalog review queue, and role membership UI.
0.23.0 adds the local adapter-repair Alerts workspace with rules, severity,
thresholds, dedupe, escalation state, dashboard/audit-outbox routing, delivery
history, acknowledgement, and resolution. Production connectors, scheduled
workers, broader alert families, and the approval controls below remain open.

Build `/admin` as a separate permission-gated application, with aggregate and
redacted views by default:

- signal provider definitions, user connections, parser versions, trust,
  credentials-by-secret-reference, rate limits, sync health, and replay/dead
  letters
- retailer/domain identity configuration, adapter/release compatibility,
  qualification evidence, lane status, location semantics, and emergency kill
  switches. Remotely editable metadata may narrow behavior but cannot widen a
  packaged mutation runner
- operator-owned affiliate program configuration and validation, separated from
  user disclosure/preferences and immutable per-job attribution receipts
- Extend the shipped adapter-repair alert family with scheduled escalation and
  external email/webhook/on-call connectors, connector health, retry/dead-letter
  receipts, and privacy-classified alert families for the remaining material
  operations; keep all of them distinct from users' product notifications
- catalog candidates, exact-identifier conflicts, merge/split history, item and
  offer state, community quarantine, contributor abuse, and repair/recipe queues
- user/device lifecycle, consent/export/deletion support, and audited
  support-consent/break-glass access; routine admins never see raw browsing,
  account, address, payment, or private intent data

Recipe signing/promotion, mutation-lane activation, affiliate changes, and
global kill-switch changes require step-up authentication; safety-expanding
changes require two-person approval.

Exit gate: every requested admin area has an explicit permission, immutable
audit event, alert path, and redacted support view; ordinary users cannot load
the admin bundle or call its APIs.

#### Phase 4 — production community evidence and catalog governance

- Publish accepted assertions through the separate shared evidence plane using
  pseudonymous contributor IDs. One contributor receives at most one current
  vote regardless of device count; a distinct healthy paired device remains an
  additional eligibility signal. Use the latest eligible assertion per
  contributor, robust median/range price projections, short TTLs, location/
  variation isolation, account/device age, historical accuracy, source
  diversity, rate limits, abuse review, and quarantine
- Make identity claims contributor-backed and independently reviewed; only the
  catalog governance workflow may accept a mapping. Validated equivalence may
  expose sibling-store availability but never transfer a private mission
- Keep one-click sharing as the initial mode. A later continuous PDP-observation
  mode may run only after granular per-domain affirmative consent, a persistent
  visible state/pause control, minimum optional permissions, local/server
  throttling, retention/deletion controls, external privacy/security review,
  and a published user-facing community feature. It observes pages the user
  ordinarily visits; it never crawls, records interactions, or inspects forms

Exit gate: independent-account canaries demonstrate useful freshness and
measured false-positive/poisoning rates without exposing tenant identity;
deletion and consent revocation propagate; community evidence remains advisory
and cannot directly authorize mutation.

#### Phase 5 — bounded autonomous observer correction

- Add a packaged candidate miner for the five fixed read-only fields. It may
  emit only stability-checked, k-anonymous selector candidates and bounded
  structural tokens from a packaged exact-SKU/offer root; editable, form,
  account, checkout, and sensitive elements are structurally excluded
- Cluster sanitized failures and candidates server-side, compile bounded recipe
  candidates, and validate with the strongest available independent oracle:
  maintainer-redacted fixtures, a second packaged/structured reader, explicit
  user confirmation of normalized fields, then reputable multi-device agreement
- Deduplicate trials by latest independent contributor/device and require
  multiple SKUs, layouts, regions, minimum canary time, deterministic cohorts,
  regression SLOs, expiry, auto-kill, rollback, and transparency history
- A recipe may fill a missing read-only field; it cannot override conflicting
  packaged evidence. Conflict becomes unknown/quarantined. Mutation runners
  must ignore remote recipes by type and execution boundary, not convention
- LLMs may rank sanitized candidate recipes or explain clusters, but never
  receive checkout/form data and never produce directly executable logic

Exit gate: staged read-only repairs recover known fixture and live canary
failures without increasing false positives; forced bad recipes auto-kill; a
contract test proves no recipe can affect navigation, identity, clicks, jobs,
qualifications, or mutation. Initial promotion remains maintainer-reviewed and
requires Chrome Web Store/security approval; mutation changes always require a
packaged release and fresh qualification.

#### Phase 6 — autonomous verification and purchasing ladder

- Community/source evidence may wake evaluation, but every action still requires
  an active exact user intent and a fresh Chrome proof of identity, selected
  variant, seller, fulfillment, location, price, quantity, and cart state

##### Phase 6A — packaged add-only expansion

Standardize fixtures, diagnostics, recovery, live evidence, and no-click
qualification per retailer. Each retailer/action/version must independently
prove exact identity, allowed seller, fulfillment, price, empty-cart preflight,
at most one Add click, exact cart result, uncertain recovery, and explicit
activation. Marketplace and pickup remain separate lanes.

##### Phase 6B — prepare-checkout review

Add packaged review-only runners using user-approved destination and payment
fingerprints held locally. Verify item, selected variant, seller, quantity,
fulfillment, tax, shipping, discounts, and exact all-in total without reading or
transmitting payment-form values. A production-runner rehearsal must prove that
no order submission occurs.

##### Phase 6C — submit order

Add explicit per-user opt-in, local high-risk authorization, spend commitment,
cooldowns, confirmation reconciliation, and ambiguity locks. Require step-up
approval for the first submit intent, material policy changes, and operator-
defined high-value thresholds. Exclude unsupported, restricted, subscription,
marketplace, queue, and unverifiable payment flows by default.

Exit gate: retailer-specific recovery/chaos suites prove at most one automatic
submit click per capability—not exactly-once merchant ordering, which cannot be
guaranteed after a lost response. An ambiguous post-click result never retries
automatically and retains its spend reservation until order-history or manual
reconciliation. Merchant confirmation evidence/order ID, budget and quantity
limits, revocation, recovery, and legal/privacy/security/Chrome Web Store review
must pass. Fully autonomous submit may remain unsupported for retailers whose
flows cannot meet these proofs.

##### Phase 6D — contingent-order drawings

Treat entering a drawing as a dedicated high-risk contingent-order capability,
not add-to-cart and not an ordinary availability signal. The shipped Walmart
Draw observer remains read-only. Any future entry runner must require explicit
per-drawing user authorization after presenting the exact item, quantity,
price, estimated shipping fee, terms/rules version, closing time, saved-address
fingerprint, payment-method fingerprint, and worst-case all-in cap. It must
enforce Walmart's one-entry rule, freeze the user's choices, handle duplicate
and high-traffic responses without retry ambiguity, and reconcile entry,
selection, automatic order, charge, and non-returnable outcomes. A generic
submit-order or Walmart-add capability must never authorize drawing entry.

Exit gate: legal/privacy/Chrome Web Store review, step-up consent, a no-entry
production rehearsal, durable pre-entry receipt, at-most-one submit proof,
selection/order reconciliation, fee and spend commitment, revocation semantics
before the entry boundary, and explicit acknowledgement that a submitted entry
cannot be canceled or changed. Until all gates exist, entry stays manual.

## Retailer qualification workstream

These are deliberately closed until each adapter has current live evidence,
no-click rehearsal receipts, recovery tests, and explicit activation:

1. Bring a current Amazon-v5-capable companion online and explicitly activate
   the already complete live v5 evidence dossier. Activation still requires the
   user's review and cannot be forged by a migration or server process.
2. Complete Best Buy's live v3 add-lane/v4 observer evidence dossier and
   explicitly activate the
   implemented first-party shipping lane.
3. Pickup as a separately qualified fulfillment lane.
4. Prepare-checkout review per retailer.
5. Submit-order only after user-approved destination/payment fingerprints,
   total verification, confirmation evidence, and uncertain-submit recovery.
6. Keep Walmart Draw entry manual until the separate Phase 6D contingent-order
   consent, fee, terms, idempotency, and reconciliation gates are complete.

No generic mutation flag will authorize these lanes.

## Community evidence and observer maintenance

This direction is feasible and fits Yoink only as a staged, opt-in,
**read-only evidence network**. The current retailer-listing graph, paired
devices, sanitized shadow observations, adapter diagnostics, server-derived
layout fingerprints, and repair queue are the local foundation. The selected-
variation model described below is a target, not a claim about the current
retailer/SKU-only community fingerprint. A meaningful community quorum must
wait for the hosted shared-evidence plane; multiple events from one local user,
device, or private tenant are not independent evidence.

### Accepted scope

1. Add an explicit **Share read-only stock evidence** control with per-domain
   optional permission, a visible contribution state, deletion controls, and a
   clear privacy disclosure. Browsing data may be collected only for that
   user-facing feature. Automatic contribution remains off by default. A later
   continuous contribution mode must be a separate affirmative per-domain
   choice with a persistent visible indicator, immediate pause/revocation, and
   no background crawling beyond product pages the user ordinarily visits.
2. Submit a signed, nonce-bound observation envelope containing only normalized
   fields already accepted by the evidence ledger: exact retailer/listing
   identity, selected variant fingerprint, availability, bounded price, seller
   class/name when visible, fulfillment, coarse location scope when necessary,
   observer/recipe version, timestamp, and sanitized layout evidence. Never
   accept DOM, page text, screenshots, form values, account data, cookies,
   tokens, addresses, or payment data.
3. Rate-limit locally by the complete observation key and again on the server.
   The key is not merely a base URL or title; it is at least
   `retailer + retailer SKU + selected variant + seller + fulfillment +
   location scope`. Pickup observations are store-local, and shipping evidence
   that varies by postal region cannot be promoted to a global state.
4. Store observations as append-only assertions with short availability TTLs.
   A contribution never overwrites MSRP, catalog identity, or another user's
   private mission. Material conflicts become `unknown`/quarantined rather
   than choosing the newest or majority value blindly.
5. Build per-field confidence projections for identity, availability, price,
   seller, and fulfillment. Quorum must use independent established accounts
   and paired devices, device/version health, historical accuracy, temporal
   proximity, variant agreement, and source diversity. "Three user IDs" alone
   is not Sybil resistance and is insufficient for publication or mutation.

### Exact product and variant governance

- Keep retailer listing identity (`retailer_id + retailer_sku`) separate from
  cross-retailer product equivalence (`variant_id`). A title, image, price, or
  similar URL is never enough to merge products.
- Accept equivalence claims only from exact identifiers such as GTIN/UPC/EAN,
  ISBN, or a validated brand plus MPN, supplemented by normalized variant
  attributes such as size, color, edition, language, pack count, and condition.
  Parent IDs and selected child IDs (for example, a parent product with a
  size-specific child offer) must remain distinct.
- Record every proposed mapping as a provenance-bearing identity claim. A
  conflict with an existing exact mapping is quarantined for review; it does
  not remap the listing or transfer an active mission automatically.
- Inventory consensus attaches to the exact listing/variant observation key.
  Only after identity claims are independently validated may the UI present
  sibling-store availability for the same item.

### Declarative observer registry

The extension may eventually download signed, expiring **observer-only data**:
bounded CSS selector candidates plus fixed extraction modes implemented in the
packaged extension. Candidate recipes move through `quarantined -> shadow ->
canary -> trusted-read-only`, retain rollback/kill-switch metadata, require a
minimum compatible extension version, and fall back to the bundled observer.

The packaged interpreter must enforce a small allowlisted schema and reject
XPath, scripts, expressions, loops, navigation, events, arbitrary regular
expressions, unbounded selectors, credential fields, and every mutation
operation. Exact URL/SKU identity remains a packaged or separately reviewed
contract; a downloaded selector cannot decide that two products are the same.
Community proposals are untrusted until structurally validated, replayed
against redacted fixtures, corroborated across independent layouts/items, and
canaried without clicks. Promotion should initially require maintainer review;
automatic read-only promotion is a later experiment only after abuse testing
and Chrome Web Store review.

An LLM may cluster sanitized failure fingerprints or suggest selector changes
to maintainers. It must not receive raw checkout DOM or user-entered values,
and its output is never executed directly or allowed to authorize an action.

### Explicitly excluded

- No background recorder of clicks, keystrokes, text entry, addresses,
  credentials, checkout forms, or payment fields.
- No injection into Stripe, PayPal, wallet, bank, or other payment-origin
  frames for learning or contribution.
- No remotely supplied checkout scripts, click sequences, arbitrary command
  interpreter, or remotely generated code. Mutation remains implemented in a
  reviewed, packaged, exact-version retailer adapter and must pass Yoink's
  independent qualification and activation gates.
- No attempt to evade retailer protections, virtual queues, rate limits,
  anti-bot systems, or site access controls. Community evidence comes only
  from ordinary user-visible pages with informed permission.

These boundaries are also distribution constraints. Manifest V3 requires
extension logic to remain reviewable and specifically identifies complex
remote-command interpreters as a policy violation; remote configuration is
acceptable only when the extension's functionality remains in its packaged
code. Chrome also treats form data, page contents, URLs, and browsing activity
as user data, and host access should remain optional and user-granted. Chrome's
July 2026 policy update requires every collection practice to be prominently
disclosed and every collected datum to be strictly necessary for the disclosed
single purpose; enforcement began August 1, 2026. A published privacy policy,
in-product disclosure, affirmative consent, change notice, data inventory, and
verified deletion flow are release gates rather than documentation follow-ups.
See the
[Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements),
[Chrome Web Store user-data guidance](https://developer.chrome.com/docs/webstore/user_data),
[July 2026 policy update](https://developer.chrome.com/blog/cws-policy-updates-2026),
and [optional permission guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions).

### Delivery sequence

1. **Local scaffold implemented:** request-scoped user/device identity,
   per-retailer consent, physical contribution deletion, nonce validation, and
   basic device rate limiting. Production IdP, privacy policy/operations,
   reputation, and Sybil/abuse controls remain open.
2. **Local scaffold implemented:** identity-claim, inventory-assertion,
   contribution-receipt, and advisory-projection schemas without changing
   catalog truth. The manual identity path cannot currently satisfy its own
   healthy-device quorum.
3. **Local pilot implemented:** explicit one-click contribution with dedupe,
   TTL, basic conflict quarantine, retailer-SKU/seller/fulfillment/location
   isolation. Exact selected-variation isolation remains open.
4. **Local pilot implemented:** tenant-scoped aggregate availability appears in
   the control center. It is not a production cross-account community result.
5. **Shadow-validation prototype implemented:** manually proposed signed
   declarative selectors, trial counts, lifecycle labels, kill switch,
   rollback, and bundled fallback. Cohorted canaries, independent oracles,
   autonomous candidate generation, production key management, and automatic
   correction remain open.
6. **Production blocked:** trusted-read-only delivery requires RBAC, signing-
   root hardening, real staged canaries, privacy/security review, and Chrome Web
   Store approval. Mutation and checkout remain outside this registry
   permanently.

## Hosted multi-user evolution

Shipped local/hosted seams:

- Authenticated tenant/user resolver seam plus a deployable signed-proxy mode;
  all local repositories now consume request scope instead of hard-coded local
  ownership
- Per-user private follows/sources, strategies, missions, settings/order-total
  guardrails, notifications, attribution policy, and mutation qualification.
  Periodic spending policy, transactional reservations, and an append-only
  ledger are implemented. Normalized catalog proposal/review and reversible
  single-tenant merge/split/compensation are implemented; independent
  production global curation remains open
- Inbox/outbox delivery, idempotent device/job queues, signed short-lived
  capabilities, durable wake/reconcile, and bounded source reliability scoring
- Streaming logical export, exact fresh-SQLite restore, table-level parity, and
  an operator cutover/recovery drill; signing keys remain separately backed up

Deployment-dependent work that cannot be truthfully completed in this local
repository alone:

- PostgreSQL source of truth and production migration/cutover. The logical
  archive and reconcile receipt are implemented, but the current synchronous
  repository is SQLite; a real PostgreSQL port/importer must be async and pass
  migration parity, contention, isolation, PostgreSQL backup/restore, and
  reconcile tests. Dual-write emulation is explicitly rejected. See
  [HOSTED_DEPLOYMENT.md](HOSTED_DEPLOYMENT.md).
- Production identity provider, TLS reverse proxy, secrets manager, monitoring,
  abuse operations, and independent security/privacy review
- Windows/Electron packaged lifecycle only after install, upgrade, backup,
  rollback, recovery, code signing, and background-service behavior are proven
  on the target distribution infrastructure

Chrome remains the only component allowed to mutate a retailer session in the
hosted architecture.
