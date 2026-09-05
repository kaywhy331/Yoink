# Adapter repair loop: PRD, spec sheet, and completion criteria (agent-executable)

Source: read-only review of Yoink 1.19.5 at 0ffb630, 2026-09-04.
Review (rendered): https://claude.ai/code/artifact/8e9bf326-a88a-4603-aaf6-672ee5311d38
Status of this document: **accepted; engineering implementation complete in the
working tree on 2026-09-04**. Pieces marked
`needs D<n>` must not start until the decision line below says `yes`.

This file is the working copy for agents. Part 1 is the product requirements
document. Part 2 is the spec sheet, one section per piece `P1` through `P7`,
each self-contained: purpose, numbered requirements, data contracts, files,
tests, completion criteria, dependencies, and the decision it waits on. Part 3
is the program-level definition of done with two acceptance scenarios taken
from the local ledger. Claim a piece by editing its `Status` line; do not
renumber or delete sections.

## How to use this file

**Claiming.** `Status` values: `todo` → `in_progress (<agent>, <YYYY-MM-DD>)` →
`review (<branch or PR>)` → `done (<commit>)`. Set `blocked (<reason>)` if a
dependency or decision is missing. One agent per piece at a time. A piece with
sub-items (`P5a`, `P5b`) may be claimed per sub-item.

**Scope.** Edit only the files listed under `Touches` plus their tests. If the
work needs another file, add it to `Touches` in the same change and say why in
the commit body. Do not fix neighbouring pieces in the same branch.

**Order.** Sprint 1 (`P1`, `P2`, `P3`) before Sprint 2 (`P4`, `P5a`) before
Sprint 3 (`P5b`, `P6`). `P7` is unscheduled. Inside a sprint, `Depends on` wins
over listing order. Nothing in Sprint 2 or 3 removes the tedium this document
targets if Sprint 1 is not done: an agent still cannot see the page that failed.

**Verify before you start.** Re-read the functions named under `Touches`. The
extension service worker (`apps/extension/background.js`) and the adapters are
edited often; if a referenced string or function is gone, update the section
before changing code.

**Verify before you finish.** `npm run check` (types, token lint, and from
`P5b` the pack lint), the application suite (`node --import tsx --test
--test-concurrency=2 test/*.test.ts` minus `test/postgres-native.test.ts`;
886 tests, about 6 minutes at 0ffb630), `npm run build:extension` when
`apps/extension/src`, `packages/browser-adapters`, `packages/browser-safety`,
or `packages/extension-ui` changed, and the native PostgreSQL proof
(`npm run test:postgres:native`, detached, over 10 minutes, one TAP line at the
end) whenever `packages/database` changed.

**Commits.** Conventional prefix, imperative subject ≤ 72 chars, piece id in
parentheses, e.g. `feat: capture local evidence capsules on failed store checks (P1)`.
One piece per branch.

**Guardrails (never change these).**
- The retailer safety boundary is out of scope for every piece: first-party
  seller, exact SKU, quantity one per guarded add, Shipping default or explicit
  Pickup, fresh DOM evidence, per-lane qualification, manual checkout and order
  submission, no evasion of interstitials, queues, or challenges.
- The sanitized hosted diagnostic (`retailerDiagnosticPayload` in the
  companion, `adapter-diagnostic-repository.ts` on the server) keeps rejecting
  unknown fields. Capsules and traces travel beside it, never inside it.
- Capsule and trace content never enters operator alerts, community evidence,
  portability archives, hosted delivery, the observer-recipe channel, or any
  request when the server runs with `config.hosted !== null` or the companion
  is packaged with `--profile=production`.
- Adapters never read visibility, scope, or selection state from attributes a
  page could plant. The replay harness supplies visibility through an
  explicitly passed environment object; production callers pass none.
- Add-control selectors are packaged and code-signed with the extension. They
  are never loaded from a remote source, a recipe, or a database row. Remote
  recipes stay read-only and unable to authorize mutation.
- Do not add tenant-scoped tables. The PostgreSQL cutover tests hard-assert the
  tenant table count (93 at 0ffb630). Prefer filesystem storage, columns on
  existing tables, or JSON; if a column is added, update the schema manifest
  and cutover assertions in the same change and call it out in the PR.
- Manual first activation and manual retirement of a lane stay manual (Kevin,
  30 Aug 2026). Automatic renewal applies only to selector-pack changes (`P5b`).
- Shopper copy (`options.js`, `popup*`, `user.js`, readiness labels, release
  announcement) is linted by `test/ui-glossary.test.ts`: never "guarded",
  "lane", "qualif*", "rehearsal", "read-only", "armed". Say "store check",
  "cart adds", "snapshot". Admin copy (`apps/web/app.js`) is not linted but
  follows the same tone.

## Decisions (D1–D5)

Work proceeds on the recommended answer only once Kevin writes it here.

| Id | Question | Recommendation | Decision |
|---|---|---|---|
| D1 | May the companion keep sanitized page snapshots for failed store checks on this machine (local profile only, never transported in hosted mode, 30-day cap, admin switch)? | yes | yes |
| D1b | May promoted snapshots (re-sanitized, scanned) be committed to the repository as test fixtures? | yes, with the scan in `P3` | yes |
| D2 | May a selector-pack-only change renew a qualified lane automatically after one passing automatic no-click check, with first activation and retirement staying manual? | yes | yes |
| D3 | Stop bumping all four add adapter versions together; bump only the store whose adapter changed. | yes, from the next release | yes, from the next release |
| D4 | Should Best Buy interstitials (security challenge, queue, high demand, account gates) count toward lane degradation? | no | no |
| D5 | May the server re-run packaged adapters against stored snapshots at release time and mark incidents "fixed, awaiting a live check"? | yes | yes |

---

# Part 1 · Product requirements

## 1.1 Problem

Getting an item into the cart at each store still costs hands-on work every
time a store changes. At 0ffb630 the local ledger shows:

- 165 adapter diagnostics since 24 Aug across 47 products; none carries a
  repair landmark, the only evidence the pipeline may attach.
- The same reason codes recur across adapter versions (Best Buy interstitials
  on six add versions; Walmart `price_binding_missing` on observer v5, v6 and
  v7 for one SKU, closed as "recovered" only because the item restocked).
- Ten commits bumped add adapter versions in eleven days, three of them all
  four stores at once. Each bump retires the store's qualification. Walmart v7
  was qualified for eleven hours.
- 148 signal jobs, all `notify_only`; no live add has ever been leased.
- 12 repair incidents, 7 open, 5 of those on adapter versions that no longer
  ship, none closed by a fix.
- 50 hand-written fixture stubs (32 KB) stand in for pages that are 1–3 MB.

Root causes: the hosted-community privacy allowlist is applied to the local
developer loop (no page, no trace ever exists); repair always means code plus a
version bump; qualification is keyed to the version string and bumps are
lockstep; there is no replay harness; the outcome taxonomy conflates
unpurchasable pages and interstitials with adapter defects; each store is
hand-wired in about a dozen files.

## 1.2 Goals

- **G1 Reproducible.** Every failed store check on a local-profile companion
  leaves a sanitized snapshot and a decision trace on the machine where it
  happened.
- **G2 Replayable.** An agent can rerun the exact packaged adapter pipeline
  against that snapshot offline, see why it failed, and prove a fix against it
  without visiting the site.
- **G3 Accumulating.** Real captured pages become the regression corpus, so the
  suite fails when a store changes and never forgets a layout.
- **G4 Honest.** Only adapter defects open repair work or degrade a lane;
  unpurchasable pages, interstitials, and policy stops are labelled as such.
- **G5 Cheap to ship.** A selector-only fix is a data change with a fixture; it
  bumps one store's pack version, retires nothing, and the lane renews itself
  after one automatic passing check. Incidents close when a release
  demonstrably handles the captured page.

## 1.3 Non-goals

- **N1** The companion never rewrites selectors on a live page, never retries
  through an interstitial, and never clicks anything it did not already prove.
- **N2** No change to the browser-safety contract, cart baseline and delta
  verification, or the at-most-once click receipt.
- **N3** No change to the hosted diagnostic format, landmark allowlists, or
  observer-recipe governance ladder.
- **N4** No community or cross-account evidence plane. Capsules are per device.
- **N5** No LLM-generated selectors or adapters inside the product. Agents work
  outside the product with the replay harness.
- **N6** `P7` (lane registry) is specified but not scheduled.

## 1.4 Users

| User | Job | What changes |
|---|---|---|
| Operator (Kevin) | Field-tests stores, decides which lanes are on, approves fixes | Sees why a check failed, downloads the snapshot, stops re-enabling lanes after selector fixes |
| Implementing agent | Turns an incident into a verified fix | Runs `npm run repair`, replays, edits a pack or adapter, promotes the snapshot, ships |
| Shopper | Watches products, receives cart adds, checks out by hand | One new optional action ("Save this page for a store repair"); nothing else visible |

## 1.5 Principles

1. Safety envelope first; every piece must be droppable without weakening it.
2. Local-first: evidence lives on the device and host that produced it.
3. Evidence over guesswork: a reason code without a trace is a bug.
4. Closure by proof: an incident is fixed when the fix passes the captured page,
   confirmed by the next live check.

## 1.6 Success metrics

| Id | Metric | Target | Measured by |
|---|---|---|---|
| M1 | Failed checks with a capsule (local profile, switch on) | 100% | `evidence_capsules` index vs `retailer_adapter_diagnostics` over one week after 1.20.0 |
| M2 | Capsules whose replay reproduces the recorded outcome, stage, and reason on the same versions | ≥ 95% | `npm run replay -- --all --expect reproduce` |
| M3 | Promoted real-page fixtures | ≥ 3 per add-lane store (in stock first-party, unavailable, third-party) plus one per defect class seen | `test/fixtures/capsules/**` |
| M4 | Agent time from incident to verified fix for selector-class incidents, with zero live-site visits | ≤ 1 hour | first three real incidents after 1.22.0 |
| M5 | Qualification retirements caused by pack-only changes | 0 | `retailer_adapter_qualifications` audit trail |
| M6 | Open repair groups on superseded versions; lanes degraded by interstitials | 0 and 0 | admin repair queue after 1.21.0 |
| M7 | Defect incidents resolved by replay or live recovery rather than age-out | ≥ 90% | `operator_alert_incidents.resolution_code` after 1.22.0 |

## 1.7 Release plan (proposal)

| Release | Pieces | Theme |
|---|---|---|
| 1.20.0 | P1, P2, P3 | Evidence capsules, decision trace, replay and promotion |
| 1.21.0 | P4, P5a | Defect classes, superseded groups, per-lane versions, generated constants |
| 1.22.0 | P5b, P6 | Selector packs, automatic renewal, repair command, closure by replay |
| later | P7 | Lane registry |

Implementation note: the completed working tree delivers `P1` through `P7`
together as 1.22.0. The table above is retained as the original staged release
proposal. Post-release field measurements remain distinguished from engineering
completion in Part 3.

---

# Part 2 · Spec sheet

## P1 · Evidence capsule (local only)

Status: done (working tree; verified 2026-09-04)
Effort: M
Depends on: —
Needs: D1

**Purpose.** On a failed store check, keep a sanitized copy of the page and
everything the adapter knew, on this machine, so the failure can be reproduced
without revisiting the site.

**Requirements.**

- **R-P1-01 Triggers.** Capture when (a) a diagnostic has outcome `failed`;
  (b) a `rehearse_add` or `live_add` diagnostic has outcome `failed` or
  `rejected` with a binding stage (`availability_binding`, `add_control`,
  `sku_binding`, `offer_binding`, `price_binding`, `seller_binding`,
  `fulfillment_binding`, `quantity_binding`, `route_binding`); (c) the shopper
  chooses "Save this page for a store repair" in the popup or the page context
  menu on any supported product page. Do not capture `rejected` results at
  stage `interactive_block` or `policy` unless triggered manually.
- **R-P1-02 Capture point.** Runs in the isolated world through
  `chrome.scripting.executeScript` with a new bundle `evidence-capsule.js`
  (built from `apps/extension/src/evidence-capsule.ts`, added to
  `build:extension`), on the same tab, immediately after the failing
  diagnostic is collected and before any navigation. Budget 1,500 ms; on
  timeout the capsule records `truncated: true` with what was serialized.
- **R-P1-03 Sanitization (closed rules, applied to a cloned document).**
  1. Remove every `<script>` except those whose `type` is `application/json`
     or `application/ld+json`. Parse each kept block; replace the value of any
     key matching
     `/(account|session|token|auth|credential|password|secret|email|phone|address|zip|postal|cookie|csrf|payment|card|customer|user|profile|visitor|device|fingerprint|geo|latitude|longitude)/i`
     with `"[redacted]"`, recursing into objects and arrays. Drop blocks that
     do not parse. Product, offer, price, availability, seller, and fulfillment
     keys are kept verbatim (the Walmart structured path needs them).
  2. Remove every attribute whose name starts with `on`. Remove `href`, `src`,
     `action`, and `formaction` values that start with `javascript:` or `data:`.
  3. `<input>` and `<textarea>`: clear `value`, except `input[type=hidden]`,
     which is kept because the Amazon offer binding reads
     `input[name='offeringID.1']` and ASIN inputs; clear a hidden input whose
     `name` or `id` matches the pattern in rule 1. Keep `checked` and the
     selected state of `<select>`.
  4. `<iframe>`: drop children and `srcdoc`; keep the element with `src`
     reduced to origin plus pathname (Target's challenge detection reads
     `iframe[src*='captcha' i]`).
  5. `<img>`, `<source>`, `<video>`, `<audio>`: strip `src`, `srcset`,
     `poster`; keep `alt`, `width`, `height`.
  6. Remove `<link rel="stylesheet">` (cannot be fetched offline); keep
     `<style>`; keep `<meta>` (adapters read `meta[itemprop='price']`).
  7. In text nodes, replace e-mail-shaped and North-American phone-shaped
     substrings with `[redacted]`.
- **R-P1-04 Visibility stamp.** For every element (cap 20,000), set
  `data-yoink-vis="1"` when computed `display` is not `none`, `visibility` is
  not `hidden`, `opacity` is not `0`, and `getClientRects().length > 0`;
  otherwise `"0"`. For elements matching
  `button, input, select, a[href], meta, [role='button'], [data-test], [data-testid], [data-test-id], [data-automation-id], [itemprop], [aria-label]`
  also set `data-yoink-rect="x,y,w,h"` in integer viewport pixels. Stamps go
  on the clone only; the live DOM is never modified.
- **R-P1-05 Envelope.** JSON, `contractVersion: 1`:

  ```json
  {
    "contractVersion": 1,
    "id": "cap_01J9...",
    "capturedAt": "2026-09-05T18:54:10.000Z",
    "retailerId": "walmart",
    "retailerSku": "20895014480",
    "operation": "observe",
    "trigger": "diagnostic_failed",
    "outcome": "failed",
    "failureStage": "price_binding",
    "reasonCode": "price_binding_missing",
    "observerVersion": "walmart-observer-v7",
    "addAdapterVersion": "walmart-add-v8",
    "packVersion": "",
    "extensionVersion": "1.20.0",
    "url": "https://www.walmart.com/ip/20895014480",
    "viewport": { "width": 1440, "height": 900, "devicePixelRatio": 2 },
    "requiredFulfillment": "shipping",
    "diagnostic": { "...": "the sanitized diagnostic exactly as posted" },
    "trace": [ { "...": "P2 entries; empty until P2 ships" } ],
    "snapshot": { "encoding": "gzip+base64", "bytes": 1834211, "sha256": "…", "html": "…" },
    "redactions": { "scriptsRemoved": 42, "jsonBlocksKept": 2, "keysRedacted": 7, "inputsCleared": 5, "iframesReduced": 3, "mediaStripped": 88, "textRedactions": 1 },
    "reductionApplied": [],
    "truncated": false
  }
  ```

  `url` keeps origin and pathname only; query and fragment are dropped.
  `trigger` ∈ `diagnostic_failed | rehearsal_non_pass | live_add_non_pass | manual`.
- **R-P1-06 Size.** Gzip the snapshot; cap 3 MiB gzipped. On overflow apply in
  order and record each step in `reductionApplied`: drop `<svg>` children;
  drop `<style>`; drop elements with `data-yoink-vis="0"` that contain no
  stamped candidate; finally cut at the cap and set `truncated: true`.
- **R-P1-07 Transport.** `POST /api/v1/devices/self/evidence-capsules/:retailerId`
  with the device bearer token. Responses: `202` accepted; `409` duplicate
  (same `snapshot.sha256` and SKU within 10 minutes); `413` over cap; `403`
  whenever `config.hosted !== null`. The companion never attempts the call when
  `YoinkRuntimeConfig.profile !== "local"`. Retry through a bounded outbox
  modelled on the diagnostic queue (`yoinkEvidenceCapsuleQueueV1`, max 3
  attempts, then drop silently).
- **R-P1-08 Storage.** `data/evidence/<retailerId>/<id>.json.gz` plus an
  index `data/evidence/index.json` rewritten atomically (write temp, rename).
  Index entry: `id, retailerId, retailerSku, operation, trigger, outcome,
  failureStage, reasonCode, observerVersion, addAdapterVersion, packVersion,
  extensionVersion, layoutFingerprint, sha256, bytes, capturedAt, receivedAt,
  expiresAt, incidentKeyHash, path`. No SQL table, no tenant scope, excluded
  from portability archives and backups produced by the app.
- **R-P1-09 Retention.** 50 capsules per store (oldest dropped on write);
  automatic captures expire after 30 days, manual after 90; prune on write and
  through `npm run capsules:prune`. Admin setting `evidenceCapsulesEnabled`
  (default `true` for local profile) on Admin → Retailers with the copy "Keep
  page snapshots for store repairs on this device".
- **R-P1-10 Health.** The capability block on `/api/v1/health` (the object that
  carries `privacyBoundedRepairLandmarks`) adds `localEvidenceCapsules`
  (`true|false`) and `evidenceCapsuleTransport` (`"loopback" | "none"`);
  hosted is always `"none"`.
- **R-P1-11 Admin surface.** `GET /api/v1/admin/evidence-capsules?retailerId=&fingerprint=&limit=`
  (index entries only), `GET /api/v1/admin/evidence-capsules/:id` (full
  capsule), `DELETE /api/v1/admin/evidence-capsules/:id`. The repair queue row
  in `renderAdapterRepairQueue` shows "N snapshots · latest <relative time>"
  and a "Download latest snapshot" button.
- **R-P1-12 Copy.** Popup and context menu: "Save this page for a store
  repair"; confirmation "Saved on this computer"; failure "Could not save this
  page. Open the product page and try again." No forbidden glossary words.

**Touches.** `apps/extension/src/evidence-capsule.ts` (new),
`apps/extension/background.js` (`recordTabOperationDiagnostic`, the inspection
paths that post diagnostics, popup message handlers, context menu
definition near `contextMenuCallback`, a capsule outbox beside
`drainAdapterDiagnosticQueue`), `apps/extension/manifest.json` (no new
permissions expected), `package.json` (`build:extension`, `capsules:prune`),
`scripts/package-extension.mjs` (bundle list), `apps/api/src/app.ts` (routes,
health block, hosted refusal), `apps/api/src/api-route-policy.ts`,
`packages/database/src/evidence-capsule-store.ts` (new, filesystem),
`scripts/prune-evidence-capsules.ts` (new; required by `capsules:prune`),
`packages/contracts/src/index.ts` (capsule contract types),
`apps/web/app.js` (`renderAdapterRepairQueue`, settings), `apps/web/index.html`,
`apps/extension/popup.js`, `packages/extension-ui/src/popup-state.ts` (one new
action), `docs/ADAPTER_REPAIR_INTELLIGENCE.md` (cross-reference).

**Tests.** `test/evidence-capsule.test.ts` (sanitizer rules on a fixture with
scripts, handlers, an e-mail in text, a hidden token input, a retained
`offeringID.1` input, `meta[itemprop=price]`; visibility stamps; reduction
ladder on a synthetic 6 MiB page), `test/evidence-capsule-api.test.ts` (accept,
duplicate, over cap, hosted `403`, retention prune of the 51st capsule, admin
list/detail/delete, health flags), `test/extension-runtime.test.ts` (trigger
set: one capsule per failed observe; none for interstitial rejections; manual
capture), `test/extension-release.test.ts` (bundle packaged),
`test/ui-glossary.test.ts` unchanged and green.

**Completion criteria.**
- [x] A failed observe in the runtime test yields exactly one capsule whose
      snapshot passes every rule in R-P1-03 and carries R-P1-04 stamps.
- [x] Interstitial and policy rejections yield no automatic capsule; manual
      capture works on any supported product page.
- [x] Hosted config returns `403`; a production-profile companion never calls
      the route (unit test on the transport guard); hosted health reports
      `evidenceCapsuleTransport: "none"`.
- [x] Reduction ladder brings a 6 MiB synthetic page under 3 MiB and records
      each step; `truncated` set only when the cut was reached.
- [x] Retention, duplicate detection, admin list/detail/delete, and the
      queue-row snapshot count work against a seeded `data/evidence`.
- [x] Diagnostic validators remain closed; `test/adapter-diagnostic-api.test.ts`
      still rejects unknown fields.
- [x] `npm run check`, application suite, `npm run build:extension` green; no
      new tables; native proof not required (no `packages/database` SQL change).

## P2 · Decision trace inside the adapters

Status: done (working tree; verified 2026-09-04)
Effort: M
Depends on: P1 (for storage; the trace API itself has no dependency)
Needs: —

**Purpose.** Replace "price binding missing" with the list of selectors tried,
what each matched, and which condition rejected the survivor.

**Requirements.**

- **R-P2-01 Environment parameter.** Every exported adapter entry point
  (`observeRetailerOffer`, `retailerAddControl`, `retailerAdapterLayoutEvidence`,
  `observeRetailerSelectedOfferScope`, `observeTargetOffer`, `targetAddBinding`,
  `targetAdapterLayoutEvidence`, `observeTargetSelectedOfferScope`, the shadow
  collectors, and the four `prepare*Add` / `rehearse*Add` / `commit*Add`
  runners) accepts a trailing optional `AdapterEnvironment`:
  `{ trace?: { record(entry: AdapterTraceEntry): void }; isVisible?: (element: Element) => boolean }`.
  Production callers pass nothing. `isVisible` is consulted only when supplied;
  it is never read from the DOM.
- **R-P2-02 Entry schema.** `AdapterTraceEntry` in contracts:
  `{ step, selector?, matched?, visible?, scoped?, chosen?, reject?, condition?, expected?, actual?, passed? }`.
  `step` ∈ `page_identity | interactive_block | structured_offer | offer_scope | add_control | availability | price | seller | fulfillment | quantity | route | sku_binding`.
  `reject` ∈ `not_visible | outside_offer_root | merchandising_scope | sku_mismatch | disabled | ambiguous | intent_mismatch | pattern_mismatch | no_price_text | foreign_currency | condition_failed | not_selected | not_actionable`.
  `selector` ≤ 200 chars, `condition` ≤ 80, `expected` and `actual` ≤ 60 chars.
  A sink keeps at most 300 entries and records one final `{ step: "trace", truncated: true }` beyond that.
- **R-P2-03 Coverage.** Record an entry for every selector evaluated in
  `selectedControl`, `walmartPrimaryActionControls`, `walmartOfferScope`,
  `amazonOfferScope`, `bestBuyOfferScope`, `recoveredBestBuyOfferScope`,
  `sellerEvidence`, `adaptiveReadPrice`, `fulfillmentEvidence`,
  `retailerInteractiveBlock`, and in Target's `addControls`,
  `modernTargetAddBinding`, `controlFulfillment`, `adaptiveTargetPrice`,
  `targetInteractiveBlock`. Record one `structured_offer` entry per condition in
  `walmartStructuredOffer` with `condition` set to the dotted path
  (for example `product.availabilityStatus`), `expected`, `actual`, `passed`.
- **R-P2-04 Shadow collectors.** `collectRetailerShadowAttempt` and
  `collectTargetShadowAttempt` accept the environment and return `trace` beside
  `observation` and `diagnostic`. `recordTabOperationDiagnostic` and the
  inspection paths pass a sink when a capsule will be captured and store the
  trace in the capsule (`trace`). The hosted diagnostic is unchanged.
- **R-P2-05 Runner traces.** On `add_control_changed` and
  `offer_binding_changed`, record the authorized element and the newly bound
  element as `{ step: "add_control", condition: "authorized" | "rebound", actual: "<tag> <allowlisted attributes> <text ≤ 80 chars>" }`.
- **R-P2-06 No behaviour change.** With no environment, every existing test
  passes unchanged and the packaged bundles export the same globals.

**Touches.** `packages/contracts/src/index.ts`,
`packages/browser-adapters/src/retailers.ts`,
`packages/browser-adapters/src/target.ts`,
`packages/browser-adapters/src/{walmart,amazon,bestbuy}.ts`,
`apps/extension/src/retailer-shadow.ts`, `apps/extension/src/target-shadow.ts`,
`apps/extension/src/{target,walmart,amazon,bestbuy}-action.ts`,
`apps/extension/background.js` (pass a sink where capsules are captured).

**Tests.** `test/adapter-trace.test.ts`: a new fixture
`test/fixtures/retailers/walmart-unavailable-structured.html` with a real-shaped
`__NEXT_DATA__` whose `availabilityStatus` is `OUT_OF_STOCK` yields a
`structured_offer` entry `condition: "product.availabilityStatus"`,
`actual: "OUT_OF_STOCK"`, `passed: false`, followed by `price` entries with
`matched > 0`, `scoped: 0`; a Target selector-miss fixture yields `add_control`
entries with `matched: 0` for each packaged selector and one generic add-intent
candidate; the runner records `authorized` and `rebound` on
`add_control_changed`. Existing adapter tests unchanged.

**Completion criteria.**
- [x] Every function in R-P2-03 records entries; a coverage test asserts at
      least one entry per step for the Walmart, Amazon, Best Buy, and Target
      fixtures that reach that step.
- [x] Trace is present in capsules captured after this piece; absent from
      diagnostics (validator test).
- [x] The 300-entry cap and the `truncated` marker are tested.
- [x] Existing adapter expectations pass unchanged when no environment is supplied.

## P3 · Replay harness and fixture promotion

Status: done (working tree; verified 2026-09-04)
Effort: M
Depends on: P1, P2
Needs: D1, D1b (for promotion into the repository)

**Purpose.** Reproduce a captured failure offline, prove a fix against it, and
turn the capture into a permanent real-page test.

**Requirements.**

- **R-P3-01 Replay command.** `scripts/replay-capsule.mjs`, wired as
  `npm run replay -- <capsule-id | path> [--fulfillment shipping|pickup] [--json] [--expect reproduce|pass] [--bundle] [--all [--retailer <id>]]`.
  Loads the capsule from `data/evidence/index.json` or a file, gunzips the
  snapshot, builds a JSDOM with the capsule `url`, supplies
  `isVisible = element => element.getAttribute("data-yoink-vis") === "1"` and a
  trace sink, and runs the same pipeline the companion runs: shadow collect →
  layout evidence → diagnostic state; when `operation` is `rehearse_add` or
  `live_add`, also builds the rehearsal job the way `<store>RehearsalJob` does
  and runs `rehearse<Store>Add`. Prints observation, diagnostic
  (outcome / stage / reason), and the trace; diffs against the capsule's
  recorded triple.
- **R-P3-02 Exit codes.** `0` ran (and the expectation, if any, held); `1`
  expectation failed; `2` capsule unreadable; `3` adapter threw. `--all`
  summarises reproduced / not reproduced / errored per store (feeds M2).
- **R-P3-03 Sources.** Default replays the TypeScript sources through `tsx`
  so an edit under test is replayed immediately; `--bundle` replays through
  `apps/extension/*.js` to prove the packaged build.
- **R-P3-04 Promotion.** `scripts/promote-capsule.mjs`, wired as
  `npm run capsule:promote -- <id> --slug <kebab> --expect-outcome <o> --expect-stage <s> --expect-reason <r> [--expect-availability …] [--expect-price-cents N] [--expect-seller-type …] [--expect-fulfillment …] [--strip-styles] [--allow "<reason>"]`.
  Re-runs the R-P1-03 sanitizer, runs `scripts/capsule-scan.mjs` (e-mail,
  phone, and a configurable name list in `test/fixtures/capsules/scan-terms.json`),
  refuses on hits unless `--allow` is given with a reason recorded in the
  metadata, refuses gzipped size > 1.5 MiB (suggest `--strip-styles`), and
  writes `test/fixtures/capsules/<retailerId>/<slug>.html.gz` plus
  `<slug>.json` (`capsuleId, capturedAt, url, retailerSku, observerVersion,
  addAdapterVersion, packVersion, sha256, expectations, notes, allowReason`).
- **R-P3-05 Corpus test.** `test/adapter-capsule-corpus.test.ts` walks
  `test/fixtures/capsules/**/*.json`, replays each with the current sources
  under a subtest named `<retailerId>/<slug>`, and asserts every expectation.
  It is discovered by `scripts/run-tests.mjs` like any other test.
- **R-P3-06 Corpus policy.** ≤ 80 fixtures total; every fixture is a captured
  page (metadata carries `capsuleId` and `sha256`); hand-written stubs stay
  where they are. A fix for one store must keep every fixture for that store
  passing; expectations change only with a stated reason in `notes`.

**Touches.** `scripts/replay-capsule.mjs`, `scripts/promote-capsule.mjs`,
`scripts/capsule-scan.mjs` (all new), `package.json`,
`test/adapter-capsule-corpus.test.ts` (new), `test/fixtures/capsules/` (new),
`docs/ADAPTER_REPAIR_INTELLIGENCE.md` (cross-reference).

**Tests.** `test/replay-capsule.test.ts`: a synthetic capsule fixture built from
`test/fixtures/retailers/walmart-unavailable-structured.html` replays to the
recorded triple with exit `0` under `--expect reproduce`; a capsule edited to
pass returns `1`; unreadable returns `2`. `test/promote-capsule.test.ts`:
promotion writes both files, the scan refuses a planted e-mail, `--allow`
records the reason, and the corpus test discovers the new fixture.

**Completion criteria.**
- [ ] **Post-release field gate:** `npm run replay -- --all --expect reproduce` reports ≥ 95% reproduced
      on the capsules captured during the first week of field use (M2); the
      not-reproduced cases are listed in `docs/ADAPTER_REPAIR_INTELLIGENCE.md`
      with a cause.
- [x] The Walmart 20895014480 and Target 95238329 cases (or their equivalents
      captured after 1.20.0) reproduce, and the trace names the failing
      condition or the missed selectors.
- [x] At least one promoted fixture per add-lane store is in the repository
      and green in the corpus test (M3 partial).
- [x] Application suite green; corpus test runtime ≤ 60 s.

## P4 · Split product state from adapter defects

Status: done (working tree; verified 2026-09-04)
Effort: S
Depends on: —
Needs: D4

**Purpose.** Only adapter defects open repair work and degrade lanes.

**Requirements.**

- **R-P4-01 Classification.** New pure function
  `classifyAdapterDiagnostic({ operation, outcome, failureStage, reasonCode })`
  in `packages/domain/src/adapter-diagnostic-class.ts` returning
  `adapter_defect | listing_state | interactive_block | policy | infrastructure | none`
  per Appendix A. Computed at read time; no schema change. A test asserts every
  code in `RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES` maps to exactly one class,
  so a new reason code fails the suite until it is mapped.
- **R-P4-02 New reason codes (companion and contracts).**
  `listing_unavailable_layout` (outcome `rejected`, stage
  `availability_binding`): emitted by `observationDiagnosticState` and
  `targetObservationDiagnosticState` when no packaged add control is
  actionable and any of these hold: observation availability is
  `out_of_stock`; the structured offer reported a non-`IN_STOCK` status
  (Walmart); the explicit-unavailable check matches. This replaces the
  Walmart-only special case. `listing_variant_unselected` (outcome `rejected`,
  stage `offer_binding`) replaces `selected_offer_binding_unresolved` when the
  page shows a variant chooser and no exact child is selected; the old code
  stays accepted for older companions and maps to `listing_state`.
- **R-P4-03 Repair queue.** In `listRepairQueue`: a group is `open` only when
  its latest failure classifies as `adapter_defect`; a new status
  `superseded` applies when the group's latest failing adapter version is older
  than the packaged version for that store (the contracts constants) and no
  failure exists on the packaged version for the same fingerprint;
  `recovered` and `aged_out` unchanged. Counts gain `supersededAdapterRepairGroups`.
  Operator incidents for superseded groups auto-resolve with the existing
  `superseded_by_release` code.
- **R-P4-04 Lane degradation.** `recent_rehearsals_rejected` counts only trials
  whose `reason_code` classifies as `adapter_defect` or `infrastructure`;
  `open_repair_current_version` counts only `open` groups.
- **R-P4-05 Automatic loop.** `requalificationCandidates.repairableObserverFailure`
  is true only for `adapter_defect`; listing-state failures keep the SKU in the
  restock watch and never mark it repairable.
- **R-P4-06 Admin copy.** Queue row shows the class: "Store page changed"
  (adapter_defect), "Item not purchasable" (listing_state), "Store asked for a
  person" (interactive_block), "Outside plan limits" (policy), "Check could not
  run" (infrastructure); status label "Superseded by a newer version".
- **R-P4-07 Compatibility.** Diagnostics from older companions classify through
  the mapping; a `price_binding_missing` from an unavailable page remains
  `adapter_defect` until that companion updates. Accepted and documented.

**Touches.** `packages/domain/src/adapter-diagnostic-class.ts` (new),
`packages/contracts/src/index.ts`, `apps/extension/src/retailer-shadow.ts`,
`apps/extension/src/target-shadow.ts`, `apps/extension/background.js`
(reason allowlist), `packages/database/src/adapter-diagnostic-repository.ts`
(`listRepairQueue`, `laneDegradation`, `counts`),
`packages/database/src/retailer-readiness-repository.ts`
(`requalificationCandidates`), `packages/database/src/operator-alert-repository.ts`
(auto-resolve superseded), `apps/web/app.js` (`renderAdapterRepairQueue`),
`docs/ADAPTER_REPAIR_INTELLIGENCE.md`, `docs/PURCHASE_AUTOMATION_READINESS.md`.

**Tests.** `test/adapter-diagnostic-class.test.ts` (total mapping);
`test/adapter-diagnostic-repository.test.ts` (listing-state failure does not
open a group; superseded status; three interstitial rejections do not degrade;
one defect rejection plus two interstitials do not degrade);
`test/retailer-shadow-bundle.test.ts` and `test/target-shadow-bundle.test.ts`
(new reason codes on unavailable fixtures); `test/retailer-readiness-repository.test.ts`;
`test/operator-alert-repository.test.ts` (superseded auto-resolve);
`test/admin-qualification-readiness-ui.test.ts` (copy).

**Completion criteria.**
- [x] Mapping test is total and green; new codes accepted end to end (companion
      allowlist, server validator, repository, UI).
- [x] Replaying the Walmart unavailable fixture yields `listing_unavailable_layout`
      and opens no repair group.
- [x] Seeded ledger from 0ffb630 (transactionally consistent copy of
      `data/yoink.sqlite`): all seven historical Best Buy groups from 24 and
      29 Aug show `superseded`; the historical Target v5 selector miss is also
      superseded after the integrated v6 observer bump, while the promoted v6
      case proves current-version open behavior; no lane is degraded by
      interstitials.
- [x] Suite green; native proof green because `packages/database` SQL changed.

## P5a · Per-lane versions and generated constants

Status: done (working tree; verified 2026-09-04)
Effort: S
Depends on: —
Needs: D3

**Requirements.**

- **R-P5a-01 One store per bump.** A contract version bump in
  `packages/contracts/src/index.ts` is accompanied by a change under that
  store's adapter or runner; lockstep bumps stop. Enforced by review and by the
  release checklist in `README.md`; `scripts/lint-selector-packs.mjs` (P5b)
  later warns when a bump has no matching diff.
- **R-P5a-02 Generated constants.** `scripts/generate-extension-tokens.mjs`
  additionally emits `apps/extension/adapter-versions.js` from contracts
  (observer, add contract, and from P5b pack versions per store).
  `background.js` loads it with `importScripts("adapter-versions.js")` at the
  top of the worker and drops its literal copies (`TARGET_OBSERVER_VERSION`,
  the observer map, `*_ADD_ADAPTER_VERSION`, `WALMART_DRAW_OBSERVER_VERSION`).
  `npm run lint:ui-tokens --check` fails when the generated file is stale.
- **R-P5a-03 Skew test.** `test/extension-release.test.ts` asserts
  `background.js` contains no literal matching `/-(add|observer)-v\d+/` and
  that `adapter-versions.js` equals the contracts values.

**Touches.** `scripts/generate-extension-tokens.mjs`,
`apps/extension/adapter-versions.js` (generated), `apps/extension/background.js`,
`scripts/package-extension.mjs`, `README.md` (release checklist),
`test/extension-release.test.ts`, `test/extension-runtime.test.ts`.

**Completion criteria.**
- [x] Generated file present, packaged, loaded; runtime tests pass with the
      generated constants.
- [x] Skew test green; a deliberate stale file fails `npm run check`.
- [x] README release checklist states the one-store-per-bump rule.

## P5b · Selector packs and automatic renewal

Status: done (working tree; verified 2026-09-04)
Effort: M
Depends on: P3, P4, P5a
Needs: D2

**Purpose.** A selector-only fix is a data change with a fixture; it retires
nothing and the lane renews itself after one automatic passing check.

**Requirements.**

- **R-P5b-01 Versions.** Contracts export, per store,
  `<STORE>_ADD_CONTRACT_VERSION` (alias of today's `<STORE>_ADD_ADAPTER_VERSION`,
  same value at introduction, for example `target-add-v8`) and
  `<STORE>_SELECTOR_PACK_VERSION` (`target-pack-v1`, `walmart-pack-v1`,
  `amazon-pack-v1`, `bestbuy-pack-v1`, `retailers-pack-v1` for the nine
  observe-only stores). Qualification rows stay keyed by the contract version;
  no data migration.
- **R-P5b-02 Pack files.** `packages/browser-adapters/packs/<store>.json`
  per Appendix B, imported at build time and frozen. Every selector list now in
  TypeScript (`addSelectors`, `priceSelectors`, `sellerSelectors`, the Walmart
  and Best Buy scope lists, Amazon offer input selectors, Target price,
  fulfillment root, fulfillment tile, recommendation scope, explicit-unavailable
  selectors, quantity selectors) moves into packs. Regex patterns (seller text,
  intent, availability wording, price parsing) stay in TypeScript because they
  are part of the verification contract.
- **R-P5b-03 Pack lint.** `scripts/lint-selector-packs.mjs`, run by
  `npm run check`: validates Appendix B grammar and limits; forbids
  `:has(`, `:contains(`, `javascript`, `url(`, `expression(`, `@`, `<`, `/`;
  forbids attribute values containing any of `checkout, buy-now, buynow,
  place-order, placeorder, submit-order, payment, credit, debit, address,
  email, phone, account, password, cookie, csrf, token` (case-insensitive);
  requires `packVersion` to change whenever the pack content hash changes
  (hashes in `packages/browser-adapters/packs/lock.json`).
- **R-P5b-04 Version signals.** Diagnostics and trials carry the pack version.
  Diagnostic: a new bounded string field `packVersion` matching
  `^[a-z]+-pack-v\d{1,4}$`, added to the companion reconstruction and the
  server validator (the only allowed addition to the payload). Trials: migration
  65 adds nullable `pack_version TEXT` to `retailer_adapter_trials` and
  `retailer_adapter_diagnostics`; update `postgres-schema-manifest.ts` and the
  cutover column assertions in the same change.
- **R-P5b-05 Renewal semantics.** A pack change does not retire the lane. The
  readiness lane gains warning `pack_unverified` when the newest passing
  rehearsal for the current contract version was recorded on a different pack
  than the packaged one. While `pack_unverified`: `readyForGuardedAdd` is false,
  `automaticCheckNeeded` is true, and the checklist shows "Store check pending
  after update". One passing trial on the packaged pack clears it with no
  admin action (audit event `retailer_adapter_pack_verified`). Contract
  changes retire as today. The reverification plan signature includes pack
  versions so a pack change starts a run.
- **R-P5b-06 Equivalence.** With packs populated from today's constants, every
  existing adapter test and the capsule corpus pass unchanged.

**Touches.** `packages/browser-adapters/packs/*.json` and `lock.json` (new),
`packages/browser-adapters/src/retailers.ts`, `packages/browser-adapters/src/target.ts`,
`packages/contracts/src/index.ts`, `scripts/lint-selector-packs.mjs` (new),
`package.json`, `apps/extension/background.js` (`retailerDiagnosticPayload`,
`reverificationPlanSignature`), `packages/database/src/migrations.ts`
(migration 65), `packages/database/src/postgres-schema-manifest.ts`,
`packages/database/src/adapter-diagnostic-repository.ts`,
`packages/database/src/qualification-repository.ts` (trial rows carry pack),
`packages/database/src/retailer-readiness-repository.ts` (`lane`, warning),
`packages/domain/src/purchase-automation-readiness.ts`, `apps/web/app.js`,
`apps/web/user.js` (readiness copy, glossary-safe),
`docs/PURCHASE_AUTOMATION_READINESS.md`, `README.md`.

**Tests.** `test/selector-packs.test.ts` (grammar, forbidden tokens, hash lock,
equivalence snapshot against the pre-pack constants); `test/qualification-repository.test.ts`
and `test/retailer-readiness-repository.test.ts` (pack change → `pack_unverified`
→ one passing trial clears; contract change still retires);
`test/adapter-diagnostic-api.test.ts` (`packVersion` accepted, any other new
field rejected); `test/postgres-cutover.test.ts` and the native proof
(migration 65); `test/extension-runtime.test.ts` (plan signature).

**Completion criteria.**
- [x] All four add-lane adapters and the nine observe-only stores read
      selectors from packs; no selector string literal remains in the two
      adapter modules (lint test).
- [x] Changing one selector in `walmart.json` without bumping `packVersion`
      fails `npm run check`; with the bump, the existing Walmart qualification
      row is untouched and the lane reports `pack_unverified` until a passing
      trial arrives (repository test).
- [x] Migration 65 applied; schema manifest and cutover assertions updated;
      native proof green.
- [x] Zero qualification retirements in the test ledger caused by pack-only
      changes (M5 in test form).

## P6 · Repair command, playbook, closure by replay

Status: done (working tree; verified 2026-09-04)
Effort: M
Depends on: P3, P4, P5b
Needs: D5

**Requirements.**

- **R-P6-01 Repair command.** `scripts/repair.mjs`, wired as
  `npm run repair -- <incident-id | <retailerId>:<fingerprint> | capsule-id>`.
  Read-only. Prints: incident summary and class; capsules (id, captured at,
  versions); the replay of the newest capsule under `--expect reproduce`; the
  trace filtered to the failing stage; the pack field involved; the candidate
  elements from the snapshot that carry add, price, seller, or fulfillment
  intent (tag, allowlisted attributes, text ≤ 80 chars); and the suggested
  `npm run capsule:promote` command with a slug. Never edits packs or adapters.
- **R-P6-02 Playbook.** `docs/ADAPTER_REPAIR_PLAYBOOK.md`: the eight steps
  (claim the incident here or in the admin queue → `npm run repair` → replay
  reproduces → edit the pack, or the adapter with a contract bump when the
  grammar cannot express the fix → replay passes → promote the capsule →
  `npm run check`, suite, corpus → package, then confirm the lane renewed),
  the guardrails above, the commit format
  `fix: <store> <field> selector (<incident-id>)`, and the rule that every
  fixture for that store must still pass.
- **R-P6-03 Release recheck.** `scripts/recheck-capsules.mjs`, wired as
  `npm run capsules:recheck` and executed by `npm run package:extension`
  before zipping. For every `open` or `superseded` group with at least one
  capsule: replay the newest capsule with `--bundle`; when it passes, or now
  classifies as `listing_state`, write audit event `adapter_repair_recheck`
  (`data_json`: group key, capsule id, packaged versions, result) and move the
  incident to new status `fixed_pending_live`. The first later non-failed
  diagnostic on the same fingerprint and packaged version resolves it with new
  resolution code `adapter_fixed_by_replay`; a later `adapter_defect` failure
  on the packaged version reopens it with reason `regressed_after_replay_fix`.
  Contracts gain both codes; if `operator_alert_incidents.status` is
  constrained by a CHECK, migration 66 widens it.
- **R-P6-04 Admin queue row.** Class tag (P4); "N snapshots · latest
  <relative time>"; "Current version: still fails (replayed 1.22.0)" or
  "Passes since 1.22.0 · waiting for a live check"; buttons "Download latest
  snapshot" and "Copy repair command".
- **R-P6-05 Alerts.** Operator alert copy for `fixed_pending_live` and for
  `regressed_after_replay_fix`.

**Touches.** `scripts/repair.mjs`, `scripts/recheck-capsules.mjs`,
`docs/ADAPTER_REPAIR_PLAYBOOK.md` (all new), `package.json`,
`scripts/package-extension.mjs`, `packages/contracts/src/index.ts`,
`packages/database/src/operator-alert-repository.ts`,
`packages/database/src/adapter-diagnostic-repository.ts`,
`packages/database/src/audit-repository.ts`, `packages/database/src/migrations.ts`
(66, only if a CHECK exists), `apps/api/src/app.ts` (incident state
transitions), `apps/web/app.js`, `docs/OPERATOR_ALERT_CONNECTORS.md`.

**Tests.** `test/repair-command.test.ts` (seeded ledger plus a synthetic
capsule: output names the field and candidates; exits `0`);
`test/recheck-capsules.test.ts` (transitions `open → fixed_pending_live →
resolved`, and `→ open` on regression); `test/operator-alert-repository.test.ts`;
`test/admin-qualification-readiness-ui.test.ts` (row copy and buttons).

**Completion criteria.**
- [x] On an equivalent seeded Target 95238329 incident with a capsule,
      `npm run repair -- target:<fingerprint of the 3 Sep group>`
      prints the missed packaged selectors, the one generic add-intent
      candidate with its attributes, and a promote command.
- [x] Packaging a release re-checks open groups and writes
      `adapter_repair_recheck` events; the transitions in R-P6-03 are tested.
- [x] Playbook exists, links from `docs/ADAPTER_REPAIR_INTELLIGENCE.md`, and
      an agent following it on a synthetic incident reaches "lane renewed"
      without manual admin steps other than claiming.
- [x] M7 measurable: `resolution_code` distribution query documented.

## P7 · Lane registry

Status: done (working tree; dry-run branch 8596b64a38d45432dffc010e35bd83877269ddce)
Effort: L
Depends on: P5b, P6
Needs: —

**Requirements (requirement level only; detail before scheduling).**

- **R-P7-01** `packages/contracts/src/add-lanes.ts` registry per store: id,
  name, contract/pack/observer versions, cart URL, runner file and global,
  operation names, SKU pattern, supported fulfillment, trial route slug.
- **R-P7-02** Server: one `recordAddRehearsal(retailerId, …)`,
  `addQualified(retailerId)`, `activateAdd(retailerId, …)` replacing the four
  parallel sets in `qualification-repository.ts`; one trial route
  `/api/v1/devices/self/qualification-trials/:retailerId-add` with the same
  body; the four legacy paths kept as aliases for one release; the PostgreSQL
  apply (`postgres-signal-retailer-qualification-apply.ts`) mirrored
  generically without new tables.
- **R-P7-03** Companion: `ADD_LANES` generated from the registry; the four
  rehearsal functions collapse to one parameterised by lane with per-lane
  policy hooks for the rehearsal job.
- **R-P7-04** Adding a store = adapter module + pack + at least three promoted
  capsules + registry entry + host permission. Demonstrated on a branch with a
  fifth store touching ≤ 8 files.

**Completion criteria.**
- [x] The dry-run fifth-store branch exists and its file list is exactly 8 files.
- [x] All four existing lanes qualify, renew, and retire through the generic
      paths with the existing tests unchanged in expectations.

---

# Part 3 · Program completion criteria

The program is complete when all of the following hold on a release after
1.22.0, measured on Kevin's local deployment.

- **C1 Evidence.** 100% of `failed` diagnostics and binding-stage rehearsal or
  live non-passes have a capsule (M1).
- **C2 Reproduction.** ≥ 95% of capsules replay to the recorded outcome, stage,
  and reason on the same versions (M2).
- **C3 Corpus.** Per add-lane store, promoted real-page fixtures for in-stock
  first-party, unavailable, and third-party pages, plus one per defect class
  encountered (M3).
- **C4 Repair time.** A selector-class incident goes from incident to verified
  fix (replay passes, corpus and suite green) with zero live-site visits in
  ≤ 1 hour of agent time, on the first three real incidents (M4).
- **C5 Lanes.** Zero qualification retirements from pack-only changes; a pack
  change renews within one automatic run (M5).
- **C6 Queue hygiene.** No `open` group on a superseded version; no lane
  degraded by interstitials; every `open` group is `adapter_defect` (M6).
- **C7 Closure.** ≥ 90% of defect incidents opened after 1.22.0 resolve with
  `adapter_fixed_by_replay` or `adapter_recovered`; none by age-out (M7).
- **C8 Safety.** `packages/browser-safety` tests unchanged and green; the
  diagnostic validator rejects capsule and trace fields; hosted config refuses
  the capsule route; a production-profile companion never posts capsules; no
  adapter honours DOM-provided visibility without a supplied environment;
  add-control selectors never load from a remote source (each is a test).
- **C9 Engineering.** `npm run check`, application suite, `npm run build:extension`,
  and the native proof are green; tenant table count unchanged; README release
  notes, `ARCHITECTURE.md`, and `ADAPTER_REPAIR_INTELLIGENCE.md` updated.

## Implementation verification receipt · 2026-09-04

Engineering delivery is complete. The following was verified from the final
working tree without migrating or writing the live database:

- `npm run check` passed TypeScript, generated-token skew, and selector-pack
  lint.
- The required application command passed **927/927** tests in 466.138 s.
- The capsule corpus contains 13 promoted page pairs: first-party,
  unavailable, and third-party cases for every add store, plus the Target
  selector-miss defect. Its 14 TAP checks passed in under 4 s.
- `npm run build:extension` passed, and isolated local packaging produced
  `Yoink-Companion-1.22.0.zip` with SHA-256
  `5e6efa59703219543b964b28682356597751cb22f0044ffd710b9ba0012c8356`.
- The native PostgreSQL proof passed **1/1** in 774.981 s. Migrations 65 and 66
  are covered and the sealed table count remains 93.
- A transactionally consistent read-only copy of the live ledger migrated and
  audited cleanly: seven historical Best Buy groups and the older Target v5
  group were superseded by packaged versions, current-version recovery was
  recognized, and no lane was degraded.
- The fifth-store dry run is preserved on branch
  `p7/pokemoncenter-add-dry-run` at
  `8596b64a38d45432dffc010e35bd83877269ddce`. Its change contains exactly
  eight files and passed type-check, dynamic build, registry, and corpus tests
  in an isolated checkout.

The field-window portions of C1, C2, C4, C5, C6, and C7 remain operational
acceptance measurements after deployment; they cannot be created by an
implementation test. Their collection paths, queries, thresholds, and safe
failure behavior are implemented. C3, C8, and C9 are satisfied by the receipts
above.

## Acceptance scenario A1 · Walmart 20895014480 (unavailable layout)

1. With 1.20.0 installed, open the product page while it is unavailable and
   run the store check. Expected: diagnostic recorded, one capsule in
   `data/evidence/walmart/`, trace present.
2. `npm run replay -- <capsule> --expect reproduce`. Expected: exit `0`;
   trace shows `structured_offer` `product.availabilityStatus`
   `actual: OUT_OF_STOCK`, then `price` entries with `matched > 0`,
   `scoped: 0`.
3. With 1.21.0: the same check records `listing_unavailable_layout`,
   `rejected`, opens no repair group, and the SKU stays in the restock watch.
4. When the item restocks, the check passes and no incident needed closing.

## Acceptance scenario A2 · Target 95238329 (selector miss)

1. With 1.20.0, a check on a page whose add control uses an attribute the
   Target pack does not list records `add_control_selector_miss` and a capsule.
2. `npm run repair -- target:<fingerprint>`. Expected: packaged selectors
   listed with `matched: 0`; one generic add-intent candidate with its
   allowlisted attributes; a promote command.
3. Add the selector to `packs/target.json`, bump `target-pack-v<n+1>`, replay
   with `--expect pass` (exit `0`), promote the capsule, run `npm run check`,
   suite, corpus. Expected: all green; contract version unchanged.
4. `npm run package:extension`. Expected: the incident moves to
   `fixed_pending_live` with an `adapter_repair_recheck` audit event.
5. Load the ZIP. Expected: the Target lane shows "Store check pending after
   update"; the automatic loop rehearses a prior passing TCIN within its
   cooldown; the lane renews with no admin action; the incident resolves as
   `adapter_fixed_by_replay` on the next non-failed live diagnostic.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A capsule holds personal data (a signed-in name in the header) | Local only, 30-day retention, admin switch, re-sanitize and scan before promotion, D1 and D1b are explicit |
| Repository growth from promoted fixtures | 1.5 MiB gzipped cap per fixture, 80 fixtures max, `--strip-styles` |
| Replay fidelity after client-side hydration | Capture after the diagnostic (post-hydration wait already exists), visibility stamps, `--bundle` mode, M2 tracked; unreproducible cases documented |
| Pack grammar cannot express a needed selector | The selector stays in TypeScript with a contract bump; documented escape hatch in the playbook |
| Cutover assertions on columns (migration 65) | Manifest and assertions updated in the same change; native proof run |
| `importScripts` in the MV3 worker | Verify in runtime tests; fallback is a generated marked region inside `background.js` written by the token generator |
| Older companions after 1.21.0 | Classification is server-side; old reason codes map conservatively to `adapter_defect` |

---

## Appendix A · Reason-code classes (P4)

Every code in `RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES` appears exactly once.
The test in R-P4-01 enforces totality; add new codes here first.

| Class | Reason codes |
|---|---|
| `none` | `verified`, `dom_hydration_recovered`, `semantic_layout_recovered`, `offer_route_verified`, `clicked`, `not_applicable` |
| `adapter_defect` | `availability_selector_miss`, `add_control_selector_miss`, `add_control_missing`, `add_control_ambiguous`, `explicit_sku_binding_missing`, `explicit_sku_binding_ambiguous`, `offer_binding_missing`, `offer_binding_ambiguous`, `price_selector_miss`, `price_binding_missing`, `seller_selector_miss`, `seller_binding_missing`, `fulfillment_selector_miss`, `fulfillment_binding_missing`, `offer_id_missing_or_ambiguous`, `route_validation_failed`, `route_binding_failed`, `rehearsal_failed`, `add_control_unavailable`, `add_control_changed`, `fulfillment_selection_failed`, `offer_binding_changed`, `seller_unverified`, `price_unavailable`, `fulfillment_unverified`, `offer_unverified`, `cart_unverified`, `verified_empty` |
| `listing_state` | `out_of_stock`, `product_page_unavailable`, `product_identity_missing`, `listing_mismatch`, `offer_not_actionable`, `offer_scope_not_actionable`, `add_control_disabled`, `selected_offer_binding_unresolved`, `listing_unavailable_layout` (new), `listing_variant_unselected` (new), `preorder_not_supported`, `quantity_unavailable` |
| `interactive_block` | `security_challenge`, `interactive_auth`, `interactive_mfa`, `interactive_location`, `interactive_membership`, `interactive_queue`, `interactive_high_demand`, `interactive_unknown`, `manual_action_required` |
| `policy` | `third_party_seller`, `signal_seller_mismatch`, `over_unit_cap`, `fulfillment_not_supported`, `seller_policy_not_supported`, `quantity_not_supported`, `unsupported_action`, `job_expired`, `offer_stale`, `currency_mismatch`, `foreign_cart_line` |
| `infrastructure` | `observer_bundle_injection_failed`, `observer_execution_failed`, `observer_top_frame_missing`, `observer_runtime_unavailable`, `observer_collection_failed`, `observer_contract_invalid`, `runner_unavailable`, `runner_failed`, `runner_no_result`, `adapter_version_mismatch`, `contract_version_mismatch`, `job_identity_invalid`, `canonical_url_invalid`, `quantity_invalid`, `unit_cap_invalid`, `total_cap_invalid`, `authorization_missing`, `authorization_expired`, `click_failed`, `click_uncertain`, `cart_evidence_stale`, `offer_proof_mismatch`, `product_page_unverified`, `cart_page_unverified` |

Rules: `open` repair groups and `open_repair_current_version` use
`adapter_defect` only; `recent_rehearsals_rejected` uses `adapter_defect` and
`infrastructure`; `listing_state` feeds the restock watch; `interactive_block`
surfaces to the shopper as "needs you" and to nothing else.

## Appendix B · Selector pack grammar (P5b)

```json
{
  "packVersion": "walmart-pack-v1",
  "retailerId": "walmart",
  "fields": {
    "addControl":           { "selectors": ["button[data-automation-id='atc']", "button[data-testid='add-to-cart-button']"] },
    "price":                { "selectors": ["[data-automation-id='product-price']", "meta[itemprop='price']"] },
    "seller":               { "selectors": ["[data-testid='seller-display-name']"] },
    "availability":         { "selectors": ["[data-testid*='availability' i]"] },
    "fulfillmentRoot":      { "selectors": [] },
    "fulfillmentTile":      { "selectors": [] },
    "quantity":             { "selectors": ["select[name*='quantity' i]"] },
    "primaryScope":         { "selectors": ["[data-testid='buy-box']"] },
    "merchandisingScope":   { "selectors": ["[data-testid*='carousel' i]"] },
    "secondaryActionScope": { "selectors": [] },
    "structuredData":       { "selectors": ["script#__NEXT_DATA__"] }
  }
}
```

- One file per add-lane store plus `retailers.json` keyed by store id for the
  observe-only stores. Unknown field names fail the lint.
- A selector is CSS only: type, `#id`, `.class`, attribute selectors (with the
  `i` flag), descendant and child combinators, and the pseudo-classes
  `:not(`, `:first-child`, `:last-child`, `:checked`, `:disabled`, `:enabled`.
  Forbidden substrings: `:has(`, `:contains(`, `javascript`, `url(`,
  `expression(`, `@`, `<`, `/`.
- Limits: ≤ 200 characters per selector, ≤ 40 selectors per field, ≤ 12
  fields, ≤ 32 KiB per file.
- Forbidden attribute-value tokens (case-insensitive): `checkout`, `buy-now`,
  `buynow`, `place-order`, `placeorder`, `submit-order`, `payment`, `credit`,
  `debit`, `address`, `email`, `phone`, `account`, `password`, `cookie`,
  `csrf`, `token`.
- `packVersion` must change whenever the content hash in `lock.json` changes.
- Packs are bundled into the extension at build time and are never fetched,
  signed as recipes, or distributed remotely.

## Appendix C · Copy for new surfaces

| Surface | Copy |
|---|---|
| Popup and context menu action | Save this page for a store repair |
| Popup confirmation | Saved on this computer |
| Popup failure | Could not save this page. Open the product page and try again. |
| Admin setting | Keep page snapshots for store repairs on this device |
| Readiness checklist while `pack_unverified` | Store check pending after update |
| Repair queue class tags | Store page changed · Item not purchasable · Store asked for a person · Outside plan limits · Check could not run |
| Repair queue status | Repair needed · Superseded by a newer version · Newer version, not yet re-checked · Recovered · Item changed, adapter not re-checked · Aged out · Fixed, waiting for a live check |
| Popup menu | Check stores now · Checking stores… |

## Changelog

- 2026-09-04 (evening, 1.22.1): field review found the loop had never run
  (0 capsules, 0 automatic run receipts). Fixed the Target diagnostic
  rejection (page-wide TCIN count in an Amazon-only layout field returned a
  masked 500; the server now zeroes it for non-Amazon stores, Target no longer
  sends it, validation failures are 400s, and the corpus test records every
  replayed fixture through the server validator). Automatic checks now start
  two minutes after startup, wake hourly while any lane needs evidence, and
  post a skipped receipt for held decisions; **Check stores now** in the
  companion menu forces a run. The API journals every 5xx and every rejected
  device post. `/api/v1/health` reports packaged versions and a local
  unpacked companion reloads itself once when they change.
  `npm run release:local` builds, packages, restarts the unit, and prints
  the versions; `npm run test:adapters` is the fast lane;
  `npm run repair -- <id> --apply "<selector>"` edits the pack, bumps and
  locks it, and keeps the change only when replay passes. Closed repair groups
  carry `recoveryKind` and `currentVersionVerified` so a restock or a
  release no longer reads as a verified fix.

- 2026-09-04: implemented P1–P7 for 1.22.0; recorded engineering verification
  and separated post-release field gates from code completion.
- 2026-09-04: first draft from the repair-loop review; decisions D1–D5 pending.
