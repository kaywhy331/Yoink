# Yoink UX action plan (agent-executable)

Source: read-only UX design review of Yoink 1.18.1, 2026-09-01.
Review: https://claude.ai/code/artifact/f029151d-e667-4239-87de-8e1a18af118c
Plan (rendered): https://claude.ai/code/artifact/1628a0f9-39ac-422c-8d44-118ffd22100a

This file is the working copy for agents. One section per finding, `UX-01`
through `UX-61`. Each section is self-contained: problem, steps, files, done
criteria, dependencies, and the decision it waits on (if any). Claim an item by
editing its `Status` line; do not renumber or delete sections.

## How to use this file

**Claiming.** `Status` values: `todo` → `in_progress (<agent>, <YYYY-MM-DD>)` →
`review (<branch or PR>)` → `done (<commit>)`. Set `blocked (<reason>)` if a
dependency or decision is missing. One agent per item at a time.

**Scope.** Edit only the files listed under `Touches` plus their tests. If the
work needs another file, add it to `Touches` in the same change and say why in
the commit body. Do not fix neighbouring findings in the same branch.

**Order.** Phase 1 before Phase 2 before Phase 3 before Phase 4, except that
any `S` item with no `Depends on` may be picked up at any time. Inside a phase,
`Depends on` wins over listing order.

**Verify before you start.** The shopper dashboard (`apps/web/user.html`,
`user.js`) was being edited by another session on 2026-09-01. Re-read the
functions named under `Touches`; if a referenced string or function is gone,
update the section before changing code.

**Verify before you finish.** `npm run check` (types), `npm test` (suite), and
`npm run build:extension` when `packages/extension-ui` or `apps/extension/src`
changed. Add or update the tests named in the section. Manual check in a
browser for any layout or copy change.

**Guardrails (never change these).**
- The retailer safety boundary is out of scope for every item here: first-party
  seller, exact SKU, quantity one per guarded add, Shipping default or explicit
  Pickup, fresh DOM evidence, per-lane qualification, manual checkout and order
  submission, no evasion. UI work must not widen, weaken, or reword it into
  something looser.
- API confirmation strings (for example `CREATE_EXACT_PURCHASE_PLAN`,
  `APPROVE_CATALOG_PROPOSAL`) stay byte-identical.
- Do not add database tables casually. The PostgreSQL cutover tests hard-assert
  table counts. Prefer columns or JSON on existing tables; if a table is
  unavoidable, update the cutover manifest and its count assertions in the same
  change and call it out in the PR.
- Affiliate routing stays as designed (Howl wrap on opt-in click, Amazon
  Associates provider). Do not propose canonical-URL navigation or provider
  removal.
- Copy is product copy: active voice, plain words, no engineering vocabulary on
  shopper surfaces (see Glossary below).

**Commits.** Conventional prefix (`feat:`, `fix:`, `refactor:`), imperative
subject ≤ 72 chars, and the finding id in parentheses, e.g.
`fix: filter products on the server (UX-17)`. One item per branch.

## Decisions (D1–D8)

Plans proceed on the recommended answer until Kevin overrides it here.

| ID | Question | Recommended default | Used by |
| --- | --- | --- | --- |
| D1 | Accept a Got it amount above the reviewed cap, and count it against daily and monthly caps? | Yes: accept, flag `overCap`, count it. | UX-35 |
| D2 | Does “Available” include preorder? | Filter offers In stock / Preorder / Out of stock separately; badges never say “available”. | UX-17 |
| D3 | Keep p50/p95 latency on the shopper Insights tab? | No: move to admin. | UX-38 |
| D4 | Remove or disable unavailable options (Prepare checkout, Submit order, Verified equivalents)? | Remove from UI; keep in the data model. | UX-26, UX-45 |
| D5 | Walmart drawings: sub-tab or Calls filter? | Filter chip under Calls. | UX-32 |
| D6 | Maintainer area gating: permission or deployment flag? | Permission (`admin.maintainer`). | UX-55 |
| D7 | Admin top-level nav: Overview · Inbox · Stores · Sources · Catalog · Plans · Activity · Settings · Maintainer? | Approve as written. | UX-50 |
| D8 | Product accent: shopper green or admin mint? | Shopper green; admin keeps a dark theme via tokens. | UX-01 |

## Glossary (shared by every item)

Use these words in all UI strings, tests, and docs. Forbidden alternatives in
parentheses.

- **Plan** (not mission, purchase intent, purchase preferences)
- **Store** on shopper surfaces; **Lane** only in admin qualification copy (not retailer in shopper copy)
- **Call** for a signal shown to a shopper (not opportunity)
- **Sources** for TrackaLacker, Discord, API channels (not integrations, connections)
- **Handoff stages:** Queued · Checking · Ready to check out · Needs you · Closed
- **Rule** for an admin strategy (not strategy in UI)
- **Settings** (not preferences)
- **Chrome companion** for the extension (not device, executor)

## Summary

| ID | Title | Phase | Size | Lane | Depends on | Decision | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-51 | Drop windows from product names, editable | 1 | L | API, Web, Tests | — | — | review (worktree) |
| UX-54 | Admin onboards and supports users | 1 | L | API, Authz, Web | — | — | review (worktree) |
| UX-13 | Signed-in person in the header | 1 | M | API, Web | — | — | review (worktree) |
| UX-43 | Catalog reviews in the Inbox | 1 | M | Web, API | UX-03 (optional) | — | review (worktree) |
| UX-41 | Overview with pending work and a window | 1 | M | API, Web | — | — | review (worktree) |
| UX-52 | Every source gets a next step | 1 | M | Web, Copy | — | — | review (worktree) |
| UX-53 | Operator funnel and attribution view | 1 | L | API, Web | UX-41 | — | review (worktree) |
| UX-31 | Drops with clock time and countdown | 1 | M | Web, Domain | — | — | review (worktree) |
| UX-17 | Server-side product filters | 2 | M | API, Web, Tests | — | D2 | review (worktree) |
| UX-35 | Record over-cap purchases | 2 | M | Domain, API, Web | — | D1 | review (worktree) |
| UX-34 | Display names everywhere | 2 | S | Web | — | — | review (worktree) |
| UX-61 | Docs version and dead links | 2 | S | Docs, API | — | — | review (worktree) |
| UX-58 | One destination per popup item | 2 | S | Extension | — | — | review (worktree) |
| UX-15 | Finish onboarding dead-ends | 2 | S | Web | — | — | review (worktree) |
| UX-27 | Inline pause; proper labels | 2 | S | Web | — | — | review (worktree) |
| UX-20 | Explicit store choice in Quick add | 2 | M | Web, API | — | — | review (worktree) |
| UX-21 | Undo for Quick add | 2 | S | Web | — | — | review (worktree) |
| UX-22 | Add product stays on Products | 2 | S | Web | — | — | review (worktree) |
| UX-57 | Verb on the popup button | 2 | S | Extension, Tests | — | — | review (worktree) |
| UX-59 | Close the action from the popup | 2 | M | Extension, API policy | — | — | review (worktree) |
| UX-04 | Glossary and string lint | 3 | M | Design, Web, Tests | — | — | review (worktree) |
| UX-03 | Confirm component replaces native dialogs | 3 | M | Web | — | — | review (worktree) |
| UX-06 | Inline status; short success toasts | 3 | M | Web | — | — | review (worktree) |
| UX-02 | Copy diet | 3 | L | Copy, Web, Docs | UX-04 | — | review (worktree) |
| UX-05 | Chips only for live state | 3 | S | Web | — | — | review (worktree) |
| UX-07 | Type floor | 3 | S | CSS | — | — | review (worktree) |
| UX-11 | Status as word plus color | 3 | S | Web, CSS | — | — | review (worktree) |
| UX-08 | Real history, one hash per destination | 3 | M | Web, Extension, Docs | — | — | review (worktree) |
| UX-12 | Content stays during refresh; poll by view | 3 | M | Web | — | — | review (worktree) |
| UX-10 | State and tabs visible on phones | 3 | S | CSS | — | — | review (worktree) |
| UX-33 | Three tags per call card | 3 | S | Web | UX-03 | — | review (worktree) |
| UX-19 | No filler sentences | 3 | S | Web | — | — | review (worktree) |
| UX-24 | Remove manual fulfillment option | 3 | S | Web, API default | — | — | review (worktree) |
| UX-25 | Calmer preflight | 3 | S | Web | — | — | review (worktree) |
| UX-28 | Plain-language readiness | 3 | S | Domain copy | UX-04 | — | review (worktree) |
| UX-36 | Symmetric close-out | 3 | S | Web | UX-03 | — | review (worktree) |
| UX-37 | Stage pills that filter | 3 | S | Web | — | — | review (worktree) |
| UX-40 | Form details | 3 | S | Web | — | — | review (worktree) |
| UX-46 | Same words in the admin plan editor | 3 | S | Web | UX-04 | — | review (worktree) |
| UX-48 | Filterable audit | 3 | S | Web, API | — | — | review (worktree) |
| UX-49 | Trim Inbox explanations | 3 | S | Copy, Web | UX-02, UX-03 | — | review (worktree) |
| UX-56 | Header and guardrail details | 3 | S | Web | — | — | review (worktree) |
| UX-60 | Per-store re-verify, plain copy | 3 | S | Extension | — | — | review (worktree) |
| UX-01 | One token system for five surfaces | 4 | L | Design, CSS, Extension build | — | D8 | review (worktree) |
| UX-50 | Regroup admin navigation | 4 | L | Web, Tests | UX-08 | D7 | review (worktree) |
| UX-55 | Maintainer area | 4 | M | Web, Authz | UX-50 | D6 | review (worktree) |
| UX-47 | One list per Activity page; injector behind two steps | 4 | M | Web, API | — | — | review (worktree) |
| UX-45 | Rules as defaults | 4 | M | Web | — | D4 | review (worktree) |
| UX-39 | Split Settings by audience | 4 | M | Web | — | — | review (worktree) |
| UX-30 | Move Watch mode; selection toolbar | 4 | S | Web | — | — | review (worktree) |
| UX-18 | Storefront grid | 4 | M | Web, CSS | UX-01 | — | review (worktree) |
| UX-14 | Reorder Home | 4 | M | Web | UX-31 | — | review (worktree) |
| UX-16 | Quieter release notice | 4 | S | Web, CSS | — | — | review (worktree) |
| UX-23 | Slim Custom setup dialog | 4 | M | Web, Copy | UX-02 | — | review (worktree) |
| UX-26 | Hide the model in the plan editor | 4 | M | Web, API defaults | UX-04 | D4 | review (worktree) |
| UX-29 | Migration prompt only when it applies | 4 | S | Web | — | — | review (worktree) |
| UX-32 | Drawings as a Calls filter | 4 | S | Web | — | D5 | review (worktree) |
| UX-38 | Insights for shoppers, telemetry for admins | 4 | M | Web | UX-28 | D3 | review (worktree) |
| UX-42 | Links that say where they go | 4 | S | Web | UX-02 | — | review (worktree) |
| UX-44 | Paste-a-link flow for admins | 4 | M | Web | — | — | review (worktree) |
| UX-09 | One icon set or none | 4 | S | Design, CSS | UX-01 | — | review (worktree) |

---

## Phase 1 · Business unblockers

### UX-51 · Drop windows from product names, editable

- Status: review (worktree)
- Phase: 1 · Size: L · Lane: API, Web, Tests
- Severity: Critical · Review area: Admin › Settings › Integrations & stores › Drop tools
- Depends on: — · Decision: —
- Touches: `apps/api/src/app.ts` (drop-window routes near `/api/v1/admin/drop-windows`), `packages/contracts/src/action-platform.ts` (typed edit/cancel input), the drop-window repository under `packages/database/src/`, `apps/web/index.html` (drops panel, `#dropWindowForm`, `#restockPatternForm`), `apps/web/app.js` (`renderActionPlatformAdmin`, `renderDropWindowSupersedeOptions`, `useRestockPatternForWindow`, `#dropWindowForm` submit), `apps/web/styles.css` (picker/detail styles), admin UI tests, repository tests

**Problem.** The form requires raw listing IDs pasted into a textarea; no picker, search, or preview. Timezone is free text; “Spread (seconds)” is unexplained; confidence is a bare percentage. Existing windows are read-only cards with no edit, cancel, item list, or opt-in view. Restock patterns also take a raw Listing ID. Only `GET`/`POST /api/v1/admin/drop-windows` exist today.

**Steps.**
1. API: `GET /api/v1/admin/drop-windows/:id` returning items (listing title, store, SKU, canonical URL) with per-item watch state and opt-in counts.
2. API: `PATCH /api/v1/admin/drop-windows/:id` for title, starts/closes, stagger, confidence, early-access note; allowed while status is `scheduled` only.
3. API: `POST /api/v1/admin/drop-windows/:id/cancel` with a reason code; cancels queued watches, never touches in-flight action jobs (fail closed), writes an audit event. Keep `supersedesId` on create.
4. UI picker: search input over the existing listing search (`GET /api/v1/user/library?q=`) rendering title · store · SKU rows; chosen items as removable chips; max 50; retailer inferred from the selection (single-store windows).
5. UI times: date + time inputs plus an IANA timezone `<select>` defaulting to the tenant setting; show computed duration (“6 h window”). Rename Spread to “Stagger: items may appear over N minutes” (minutes input, stored as seconds). Confidence becomes Rumored / Likely / Confirmed → basis points.
6. UI cards: clicking a window opens a detail drawer with items, watch states, opt-in count, status timeline, and Edit · Cancel · Replace (Replace = create form prefilled with `supersedesId`).
7. Restock patterns use the same picker instead of a Listing ID input.
8. Tests: rendered admin form test (picker, drawer, cancel); repository tests for PATCH/cancel semantics.

**Done when.** An admin authors a 10-item window from product names in under a minute, sees who opted in, and cancels a mistaken window with an audit entry. No raw id field remains on the form.

### UX-54 · Admin onboards and supports users

- Status: review (worktree)
- Phase: 1 · Size: L · Lane: API, Authz, Web
- Severity: Critical · Review area: Admin › Settings › Access
- Depends on: — · Decision: —
- Touches: `packages/database/src/migrations.ts` (user lifecycle column and permissions), `packages/database/src/authorization-repository.ts`, `packages/database/src/device-repository.ts` (`createPairingCode` subject user), `apps/api/src/hosted-request-auth.ts` (disabled-session enforcement), `apps/api/src/api-route-policy.ts`, `apps/api/src/app.ts` (new `/api/v1/admin/users*` routes), `apps/web/index.html` (access view), `apps/web/app.js` (`renderAuthorization`), authorization tests

**Problem.** Pairing codes bind to the acting user (`device_pairing_codes.user_id`), so the admin's “Create pairing code” pairs the admin's own Chrome. Admin Plans/Actions/Activity call the shopper's user-scoped routes with no user selector. Access has role grant/revoke only; “No users exist in this tenant.” has no call to action.

**Steps.**
1. Permissions: add `admin.users.read`, `admin.users.support` (issue a pairing code for another user, pause their actions), `admin.users.manage` (create, disable). Grants go through the existing protected-change control.
2. API: `GET /api/v1/admin/users?q=` (display name, roles, plan count, online devices, last activity); `GET /api/v1/admin/users/:id` (plans, recent actions, devices, pending proposals, spend summary) — user-scoped repositories accept a subject user id when the actor holds `admin.users.read`; `POST /api/v1/admin/users` (display name, initial role); `POST /api/v1/admin/users/:id/pairing-code` (subject-bound, audited); `PATCH /api/v1/admin/users/:id` (status active/disabled).
3. UI: Access becomes Users: searchable list → user detail page with tabs Plans · Actions · Devices · Reviews and actions Issue pairing code · Pause actions · Grant role · Disable.
4. Replace the empty state with a Create user call to action.
5. Tests: cross-user reads denied without permission; a support-issued pairing code pairs the subject's device, not the admin's; audit rows written for issue/pause/disable.

**Done when.** An admin creates a shopper, issues their pairing code, and sees their Chrome come online, all from the UI.

### UX-13 · Signed-in person in the header

- Status: review (worktree)
- Phase: 1 · Size: M · Lane: API, Web
- Severity: Major · Review area: both headers; Admin › Inbox › Approvals
- Depends on: — · Decision: —
- Touches: `apps/api/src/app.ts` (overview and admin snapshot builders), `apps/web/user.html` and `apps/web/index.html` (headers), `apps/web/user.js` (`renderOverview`), `apps/web/app.js` (`renderStatus`, `renderAdminChanges`)

**Problem.** Neither header shows who is signed in, the tenant, or a sign-out. Approvals says “Sign in again before changing protected settings” but there is no sign-in surface.

**Steps.**
1. Add `actor` (display name, user id, tenant name, role labels, assurance level) to `GET /api/v1/user/overview` and `GET /api/v1/admin/snapshot`.
2. Account menu in both headers: initial avatar, name, role; links to the other dashboard (replaces the bare “Admin” link), Docs, Privacy; “Local session” label locally, Sign out when a hosted identity provider exists.
3. Approvals assurance copy derives from the actor's assurance level instead of three fixed sentences.

**Done when.** Both headers show the actor; the admin link lives inside the account menu.

### UX-43 · Catalog reviews in the Inbox

- Status: review (worktree)
- Phase: 1 · Size: M · Lane: Web, API (display name)
- Severity: Critical · Review area: Admin › Catalog, Admin › Inbox
- Depends on: UX-03 for note capture (interim: inline note field) · Decision: —
- Touches: `apps/web/app.js` (`ADMIN_NAV_GROUPS`, `renderCatalogGovernance`, nav badge), `apps/web/index.html` (inbox views), catalog proposals query (join `users.display_name`)

**Problem.** Every new shopper's first product waits on a proposal approval, but the queue is a panel inside Catalog; Inbox omits it; Overview has no pending count; proposals show a raw `proposerUserId`; approve/reject use `confirm()`/`prompt()`.

**Steps.**
1. Add Inbox secondary view “Catalog reviews” rendering the pending proposals list (reuse the list body of `renderCatalogGovernance`); merge/split operations stay under Catalog.
2. Nav badge on Inbox = pending proposals + pending change requests + open incidents from snapshot counts.
3. Show the proposer's display name; move the payload hash behind Details.
4. Approve/Reject through the confirm component (UX-03) with a note; until then, an inline note field on the card.

**Done when.** A pending proposal is visible from Inbox on load, the nav shows a badge, and the proposer is named.

### UX-41 · Overview with pending work and a window

- Status: review (worktree)
- Phase: 1 · Size: M · Lane: API, Web
- Severity: Major · Review area: Admin › Overview
- Depends on: — · Decision: —
- Touches: `apps/api/src/app.ts` (snapshot builder), `apps/web/app.js` (`deriveAdminOverview`, `renderMetrics`, `renderReadinessGuide`, `renderStatus`)

**Problem.** Metrics are cumulative totals (Products, Plans, Signals, Actions). Pending proposals, open incidents, today's handoffs and conversions are absent. Readiness guide shows one step with no progress; hero labels are all caps.

**Steps.**
1. Snapshot adds 24 h and 7 d counts: signals received, jobs created, carted, got it, missed, pending proposals, open incidents, dead letters, devices online.
2. Metric grid shows these with a 24 h / 7 d toggle; remove the cumulative tiles.
3. Readiness guide shows “Step N of 5” from the existing checks array; hero status labels in sentence case.
4. “Needs your review” list (proposals, approvals, incidents) with direct links.

**Done when.** Overview answers “what happened today and what is waiting on me” without navigation.

### UX-52 · Every source gets a next step

- Status: review (worktree)
- Phase: 1 · Size: M · Lane: Web, Copy
- Severity: Major · Review area: Admin › Settings › Integrations & stores › Signal channels, TrackaLacker panel
- Depends on: — · Decision: —
- Touches: `apps/web/app.js` (`renderActionPlatformAdmin`, `renderSources`), `apps/web/index.html` (`#sourceChannelForm`, TrackaLacker panel)

**Problem.** Adding a Discord channel asks for an unexplained “Channel reference”; no Discord client exists, so channels show health “attention” with nothing to do. TrackaLacker can only be connected from the extension.

**Steps.**
1. Channel cards render provider-specific setup steps (Discord: invite the bot, copy the channel id, paste it; API: endpoint and key from Operations).
2. Rename “Channel reference” to “Discord channel ID” with an example value and format validation; API provider shows its own label.
3. Discord channels show “Not connected yet: client pending” instead of health “attention” until the client ships.
4. TrackaLacker panel gains “Copy instructions for the user” and a docs link.

**Done when.** A newly added channel shows what to do next, not an alarm.

### UX-53 · Operator funnel and attribution view

- Status: review (worktree)
- Phase: 1 · Size: L · Lane: API, Web
- Severity: Major · Review area: Admin (no current page)
- Depends on: UX-41 (shares the windowed counts) · Decision: —
- Touches: `apps/api/src/app.ts` (new `GET /api/v1/admin/analytics?window=`), execution and attribution repositories, click receipt recording for cart-handoff and store links, `apps/web/index.html` and `app.js` (new Analytics secondary view under Activity)

**Problem.** Attribution is the business model, but the admin has a receipts list and a 160-row directory; no clicks, conversions, or per-store funnel. The only funnel lives on the shopper Insights tab.

**Steps.**
1. Define the funnel: signals → matched → jobs → carted → got it → missed, by store and by day; attribution: routes issued, clicks, conversions (got it after an affiliate route).
2. Record clicks on cart-handoff and store links for all stores the way `/api/v1/user/purchase-handoffs/:id/click` does for Walmart (reuse that table or add a column; see the table-count guardrail).
3. API aggregating jobs, outcomes, attribution receipts and click receipts; CSV export.
4. UI: the Overview strip (UX-41) plus an Analytics view with per-store tables and a daily chart.
5. Report clicks and conversions, not dollars, until Howl/Associates reporting is imported.

**Done when.** The admin can answer “how many carted, how many bought this week, per store, and how many went through an affiliate route”.

### UX-31 · Drops with clock time and countdown

- Status: review (worktree)
- Phase: 1 · Size: M · Lane: Web, Domain
- Severity: Major · Review area: Shopper › Calls, Home
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`relative`, `watchWindowSummary`, `renderCalls`, home render), `apps/web/user.html` (calls and home sections); `GET /api/v1/user/drop-windows`, `/watch-queue/:id/enroll|cancel` already exist

**Problem.** Drop windows appear as call cards with relative times; `relative()` rounds to hours past 60 minutes; no absolute clock time or timezone anywhere on the shopper side.

**Steps.**
1. Shared formatter: “Tue 12:00 AM PT · closes 6:00 AM” in the viewer's local zone (source zone shown when different); under 60 minutes a live countdown with minute precision.
2. `relative()` gains minute precision below six hours.
3. Upcoming strip at the top of Calls and on Home from `GET /api/v1/user/drop-windows`, with the opt-in toggle wired to the existing enroll/cancel endpoints.

**Done when.** Every drop shows an absolute local time and counts down under an hour.

---

## Phase 2 · Correctness and clarity

### UX-17 · Server-side product filters

- Status: review (worktree)
- Phase: 2 · Size: M · Lane: API, Web, Tests
- Severity: Critical (functional) · Review area: Shopper › Products
- Depends on: — · Decision: D2
- Touches: `packages/database/src/catalog-repository.ts` (`listLibraryProducts`), `apps/api/src/app.ts` (`/api/v1/user/library/products` route), `apps/web/user.js` (`browseFilteredGroups`, `renderProducts`, `loadUserRoute`, browse select handlers), `packages/domain` (availability helper), `test/user-dashboard.test.ts`

**Problem.** `loadUserRoute("products")` fetches 48 groups; the Store/Availability/Plans/Price selects filter that page client-side while the count reads “N of {total}”. “Available now” requires `in_stock` while `listingAvailable()` counts preorder as available.

**Steps.**
1. API: add `store`, `availability` (`in_stock|preorder|unavailable`), `planned` (needs the actor's plans), `priceMin`, `priceMax`, `sort` to the products endpoint; `total` reflects the filtered set.
2. UI: filter/sort changes call `loadUserRoute("products", { force: true })` with the parameters; delete the client filter; count reads the server total.
3. One availability helper in `packages/domain` used by badge and filter; options become In stock / Preorder / Out of stock (D2).
4. Test: 200 products, Store filter returns every match and the count equals the server total.

**Done when.** Filter results and counts are correct beyond the first 48 products.

### UX-35 · Record over-cap purchases

- Status: review (worktree)
- Phase: 2 · Size: M · Lane: Domain, API, Web
- Severity: Critical (business data) · Review area: Shopper › Activity › Got it dialog
- Depends on: — · Decision: D1
- Touches: `apps/api/src/app.ts` (jobs outcome route), `packages/database/src/execution-repository.ts`, `apps/web/user.js` (`openCartOutcomeDialog`, `#cartOutcomeForm` submit), `test/execution-repository.test.ts`, user dashboard tests

**Problem.** The amount input carries `max` = reviewed maximum and submit rejects higher values, so real spend above the reservation cannot be recorded.

**Steps.**
1. Confirm the current server-side bound in the outcome handler before changing it.
2. Server accepts `actualTotalCents > maxOrderTotalCents`, stores both, sets `overCap: true`, releases the reservation, applies the actual to the spend ledger (D1).
3. Dialog: remove `max`; show “Above your reviewed maximum by $X; recorded as actual spend” as a warning, not an error.
4. Insights (and UX-53) show over-cap count and amount.
5. Tests for over-cap acceptance and ledger effect.

**Done when.** An actual of cap + $5 is recorded as Got it with a flag and appears in spend.

### UX-34 · Display names everywhere

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Web
- Severity: Major · Review area: Shopper › Activity; Admin › Actions, Signals
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`renderActions`, glossary render), `apps/web/app.js` (`renderJobs`, `signalMarkup`, `renderNotifications`, `renderAttributionReceipts`)

**Steps.**
1. Replace `escapeHtml(action.retailerId)` and the admin equivalents with `retailerDisplayName()` / `retailerName()`.
2. Status glossary hides machine ids behind a “Show ids” toggle.
3. Add a grep-style test asserting no `retailerId)` inside render templates.

**Done when.** No raw id such as “bestbuy” renders on either dashboard.

**Implementation review (2026-09-01).** Store identifiers resolve to display
names on both dashboards. UX-37 subsequently replaced the inline status
glossary with the canonical `/docs#statuses` destination, so machine ids stay
out of product copy instead of being exposed through the originally proposed
“Show ids” toggle. Source scans and rendered Best Buy coverage enforce the
final no-raw-id criterion.

### UX-61 · Docs version and dead links

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Docs, API
- Severity: Minor · Review area: `/docs`, `/privacy`, `/llms.txt`
- Depends on: — · Decision: —
- Touches: `apps/web/docs.html`, `apps/web/privacy.html`, `apps/web/llms.txt`, `apps/api/src/app.ts` (static serving or a version endpoint)

**Steps.**
1. Inject the version from the release announcement model at serve time, or fetch it client-side from the overview.
2. “Diagnostics” links and `llms.txt` point to a shopper-visible destination (Settings › Chrome); admin link only for admins.
3. Add a Glossary section (from UX-04).

**Done when.** Docs show the running version and every link opens a page the reader can access.

### UX-58 · One destination per popup item

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Extension
- Severity: Minor · Review area: Extension popup menus
- Depends on: UX-08 for canonical hashes (interim: use existing hashes) · Decision: —
- Touches: `packages/extension-ui/src/popup-state.ts` (`APP_DESTINATION_ROUTES`, `derivePopupView` pairing copy), `apps/extension/popup.html`, `apps/extension/popup.js`, `test/extension-popup-state.test.ts`; rebuild with `npm run build:extension`

**Steps.**
1. Remove the duplicate Diagnostics; rename the remaining item to match its destination (“Connection details” → Settings › Chrome) or route admins to Connections › Diagnostics once hashes exist.
2. Merge “Settings” and “Manage store access” into “Extension settings”.
3. Pairing copy: “Enter the code from Yoink → Settings → Chrome”.
4. Update tests.

**Done when.** Each menu item's label matches the title of the page it opens.

### UX-15 · Finish onboarding dead-ends

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Home next-step card
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (setup action handlers `connect_signal`, `choose_product`, `renderHomePriority`), `apps/web/user.html` (home)

**Steps.**
1. `connect_signal` opens a small dialog with the three steps (pin the extension, open the popup, choose Connect) and a “Re-check” button that refreshes the overview.
2. `choose_product` switches to Products and focuses the first Quick add; the toast names the real button.
3. Show “Step N of 5” from `completedSteps` / `totalSteps`.

**Done when.** No onboarding action ends in a toast alone.

### UX-27 · Inline pause; proper labels

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Plans list
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`renderPlans`, click handler), `apps/web/user.html` (plans empty state)

**Steps.**
1. Pause / Resume button on each card (PATCH status) beside Review or change.
2. Status tag via label map (Active, Paused, Satisfied).
3. Empty state: “Quick add a product from Products to create your first plan.”

**Done when.** Pausing a plan is one click; no raw state renders.

### UX-20 · Explicit store choice in Quick add

- Status: review (worktree)
- Phase: 2 · Size: M · Lane: Web, API
- Severity: Major · Review area: Shopper › Products detail dialog, setup dialog
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`openProductDetail`, `quickAdd`, `openSetup`), purchase-intent create contract in `apps/api/src/app.ts` (or a follow-up target PATCH)

**Problem.** Every store row has its own Quick add, but a plan is per product with all stores attached, so the click implies a choice the model does not make.

**Steps.**
1. Detail dialog: one Quick add and one Custom setup for the product at the top; store rows become offers with a “Use this store” toggle.
2. Creation passes the chosen store set (extend create with `targets: [{ listingId, enabled }]`, or PATCH targets right after create).
3. Setup dialog Store box lists all stores with the chosen one marked and a link to change.

**Done when.** Quick add from a store row yields a plan where that store is enabled and the others are visible.

### UX-21 · Undo for Quick add

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Products
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`quickAdd`, `toast`), `apps/web/user.css` (interactive toast action)

**Steps.**
1. Success toast gains Undo for ten seconds calling the existing DELETE with confirmation (safe: nothing in flight yet).
2. Shorten the success message to the product name and profile used.

**Done when.** A mistaken Quick add is reversed in one click.

### UX-22 · Add product stays on Products

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Products › Add product link
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`#productLinkForm` submit, `renderProducts`), `apps/web/user.html`

**Steps.**
1. After Send for review stay on Products; render an “In review” row at the top from `GET /api/v1/user/catalog/proposals`.
2. When a proposal is approved, surface it inline on the next Products load.

**Done when.** Adding a product never leaves the Products tab.

### UX-57 · Verb on the popup button

- Status: review (worktree)
- Phase: 2 · Size: S · Lane: Extension, Tests
- Severity: Major · Review area: Extension popup primary action
- Depends on: — · Decision: —
- Touches: `packages/extension-ui/src/popup-state.ts` (`derivePopupView` product branch), `apps/extension/popup.js` (`render`), `apps/extension/popup.css`, `test/extension-popup-state.test.ts`, `test/extension-popup-ui.test.ts`; rebuild with `npm run build:extension`

**Steps.**
1. Label stays “Inspect product” / “Inspect again”; the outcome becomes a separate status line with color.
2. Remove `data-outcome` tinting from the primary button.
3. Update tests.

**Done when.** The button never reads “Blocked”, “Error”, “Qualified” or “Inspected”.

### UX-59 · Close the action from the popup

- Status: review (worktree)
- Phase: 2 · Size: M · Lane: Extension, API policy
- Severity: Minor · Review area: Extension popup cart-ready state
- Depends on: — · Decision: —
- Touches: `packages/extension-ui/src/popup-state.ts`, `apps/extension/popup.html`, `popup.css`, `popup.js`, `background.js` (outcome message), `apps/api/src/app.ts`, `api-route-policy.ts` (device actor on the jobs outcome route), `test/extension-popup-state.test.ts`, `extension-popup-ui.test.ts`, `extension-runtime.test.ts`, `action-platform-route-policy.test.ts`, `action-job-availability.test.ts`

**Steps.**
1. After Open cart, show “Did you check out?” with Got it / Missed it; Got it reveals an amount prefilled with the reviewed maximum.
2. Background posts to the jobs outcome route with the device credential; if `api-route-policy.ts` does not allow a device actor there, deep-link to Activity with the action row focused instead.

**Done when.** A shopper can close the handoff without opening the dashboard, or in one click to the highlighted row.

---

## Phase 3 · Interaction system

### UX-04 · Glossary and string lint

- Status: review (worktree)
- Phase: 3 · Size: M · Lane: Design, Web, Tests
- Severity: Major · Review area: all surfaces
- Depends on: — · Decision: —
- Touches: `docs/GLOSSARY.md` (new), `apps/web/docs.html`, `apps/web/user.html`, `user.js`, `index.html`, `app.js`, `packages/extension-ui/src/popup-state.ts`, `packages/domain/src/action-status.ts` (added because its summaries render verbatim on shopper and popup surfaces), `test/ui-glossary.test.ts`, and affected rendered-copy tests

**Steps.**
1. Adopt the Glossary at the top of this file; write `docs/GLOSSARY.md`.
2. Rename UI strings in all surfaces; add hash alias `#settings` (see UX-08).
3. Add a test that greps UI files for forbidden words with an allowlist for API field names.

**Done when.** The same object has one label across shopper, admin, popup and docs, enforced by a test.

### UX-03 · Confirm component replaces native dialogs

- Status: review (worktree)
- Phase: 3 · Size: M · Lane: Web
- Severity: Critical · Review area: both dashboards
- Depends on: — · Decision: —
- Touches: shared `apps/web/dialogs.js` and `apps/web/dialogs.css`, `apps/web/user.html`/`index.html` (one `<dialog id="confirmDialog">` per dashboard), `apps/web/app.js`, `apps/web/user.js`, `test/dialogs-ui.test.ts`, and affected dashboard UI tests

**Steps.**
1. Build `confirmDialog({ title, summary, scope, note: { label, required }, confirmLabel, danger })` on `<dialog>`, returning a promise; trap and return focus; Escape cancels.
2. Replace every `confirm()` and `prompt()`; lane activations get scope bullets; incident, proposal and identity decisions get the note field with the privacy hint as helper text.
3. Keep server confirmation strings unchanged.

**Done when.** `grep -c "confirm(\|prompt(" apps/web/*.js` is 0 and every flow works by keyboard.

### UX-06 · Inline status; short success toasts

- Status: review (worktree)
- Phase: 3 · Size: M · Lane: Web
- Severity: Major · Review area: both dashboards
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` and `app.js` (`toast`, form submit handlers, `quickAdd`, profile save), `apps/web/status.js`, `apps/web/status.css`, `apps/web/user.html`, `apps/web/index.html`, `apps/web/user.css`, `apps/web/styles.css`, `apps/api/src/app.ts` (shared static assets), `test/inline-status-ui.test.ts`, `test/user-dashboard.test.ts`, `test/api.test.ts`

**Steps.**
1. `setInlineStatus(element, { state, message, reference })` rendered beside the triggering control.
2. Errors persist inline until dismissed with Copy reference (correlation id).
3. Toasts stack (max two); success text ≤ 60 characters; long quick-add and profile-propagation messages move inline.

**Done when.** No error is shown only in a toast; a test asserts toast lengths.

### UX-02 · Copy diet

- Status: review (worktree)
- Phase: 3 · Size: L · Lane: Copy, Web, Docs
- Severity: Critical · Review area: both dashboards, popup copy
- Depends on: UX-04 · Decision: —
- Touches: `apps/web/index.html`, `apps/web/user.html`, `app.js`/`user.js` toasts and dialog copy, `apps/web/docs.html` (receives moved rationale), UI tests asserting old strings

**Rules.** A panel intro is one sentence naming the job, ≤ 90 characters. Rationale moves to a docs anchor. One boundary line (“Checkout stays manual.”) per surface in header or footer; remove from panels, dialogs, toasts, popup copy. Remove “exact” except where it separates a SKU from a product family.

**Done when.** `index.html` static copy < 1,200 words and `user.html` < 500; the boundary appears once per page; tests updated.

### UX-05 · Chips only for live state

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Major · Review area: Admin
- Depends on: — · Decision: —
- Touches: `apps/web/index.html` (27 `.mode-chip`), `apps/web/app.js` (chip setters), `apps/web/styles.css` (plain-state replacement), `test/admin-status-chip.test.ts`

**Steps.**
1. Keep chips bound to data (readiness gate, TrackaLacker, adapter repair, alerts, background work, catalog queue, change queue); delete static ones (DRY RUN, NEVER EXECUTES, FAIL CLOSED, NOT APPLIED, SANITIZED, ALL CLOSED, READ ONLY).
2. Values OK / Attention / Off in sentence case.

**Done when.** ≤ 10 chips, each driven by data.

### UX-07 · Type floor

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: CSS
- Severity: Major · Review area: both dashboards
- Depends on: — · Decision: —
- Touches: `apps/web/styles.css` (`.tag`, `.decision-pill`, `.operator-alert-detail`, repair-row `code`, `.fine-print`, `.metric span`, `.qualification-check p`, `.readiness-step p`), `apps/web/user.css` (`.setup-preflight span`, `.preflight-costs small`, `.home-boundary`, `.automation-readiness li small`), `test/ui-type-floor.test.ts`

**Steps.**
1. 9px → 11px (uppercase labels only, `.06em` tracking); 10px → 12px.
2. Add a CSS lint: no `font-size` below 11px.

**Done when.** Nothing readable renders under 12px.

**Implementation review (2026-09-01).** The final acceptance criterion is
stricter than the intermediate 11px step, so the shared dashboard floor is
12px for labels and supporting copy. The CSS lint enforces that floor across
both dashboard stylesheets.

### UX-11 · Status as word plus color

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web, CSS
- Severity: Major · Review area: both dashboards
- Depends on: — · Decision: —
- Touches: `apps/web/app.js` (`statusDot` call sites), `apps/web/user.js` (`.dot` rows), `styles.css`, `user.css`, `test/ui-status-semantics.test.ts`

**Steps.**
1. Every `.status-dot` / `.dot` gets an adjacent word or `aria-label`.
2. Dark-theme tags use solid fills meeting 4.5:1.

**Done when.** No status is color-only; contrast passes in both themes.

### UX-08 · Real history, one hash per destination

- Status: review (worktree)
- Phase: 3 · Size: M · Lane: Web, Extension, Docs
- Severity: Major · Review area: both dashboards, popup, docs
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`setTab`, `applyHashRoute`), `apps/web/app.js` (`setView`, hashchange), `packages/extension-ui/src/popup-state.ts` (`APP_DESTINATION_ROUTES`), `apps/web/docs.html`, `llms.txt`, `test/ui-route-history.test.ts`, and affected dashboard/popup route tests

**Steps.**
1. `pushState` on top-level tab/view change; `popstate` re-applies the route.
2. Canonical hashes: shopper `#home #products #calls #plans #activity #settings` with sub-routes like `#settings/chrome`; admin `#connections/readiness/target` style.
3. Alias table for `#preferences`, `#health`, `#diagnostics`.
4. Update popup destinations, docs and `llms.txt`.

**Done when.** Back returns to the previous tab; every published link lands where its label says.

### UX-12 · Content stays during refresh; poll by view

- Status: review (worktree)
- Phase: 3 · Size: M · Lane: Web
- Severity: Minor · Review area: Admin (mainly), shopper lists
- Depends on: — · Decision: —
- Touches: `apps/web/app.js` (`setView`, `refresh`, `refreshFromLoopback`, adaptive poll scheduler), `apps/web/user.js` (list renders and adaptive poll scheduler), `apps/web/styles.css`, `apps/web/user.css` (shared skeleton treatment), `test/view-refresh-behavior.test.ts`, and affected dashboard tests

**Steps.**
1. Admin `setView` stops clearing loaded views; refresh only the active view's collection and keep old rows until new ones arrive.
2. Skeleton rows on first load in both apps.
3. Poll cadence per view: 3 s only where a job is active, 15–30 s elsewhere.

**Done when.** A nav click never blanks a populated list; static views make ≤ 1 snapshot request per 15 s.

### UX-10 · State and tabs visible on phones

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: CSS
- Severity: Minor · Review area: both dashboards
- Depends on: — · Decision: —
- Touches: `apps/web/user.css` (`@media (max-width: 560px)`, `@media (max-width: 700px) .tabs`), `apps/web/styles.css` (`@media (max-width: 760px)`), `apps/web/user.js` and `apps/web/app.js` (compact mode labels), `apps/web/user.html` and `apps/web/index.html` (initial compact labels), `test/mobile-dashboard-navigation.test.ts`

**Steps.**
1. Mode pill collapses to dot + one word instead of `display:none`.
2. Tabs stay one horizontally scrollable row at every width.

**Done when.** At 375px the system state is visible and tabs are one row.

### UX-33 · Three tags per call card

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Calls
- Depends on: UX-03 (false-positive confirm) · Decision: —
- Touches: `apps/web/user.js` (`renderCalls`), `docs/GLOSSARY.md` and `test/ui-glossary.test.ts` (narrow Signal/Drop/Queue type-tag exception), `test/user-dashboard.test.ts` (rendered tag-density and confirmation coverage)

**Steps.**
1. Tags: type (Signal, Drop, Queue), state (colored), one qualifier; membership and queue-expected move into the detail line.
2. Report false positive uses the confirm component.

**Done when.** No call card shows more than three tags.

### UX-19 · No filler sentences

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Products cards and detail dialog
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`productCardMarkup`, `renderProductDetail`), `test/user-dashboard.test.ts` (empty-variant rendered coverage)

**Steps.** Omit the paragraph when `variantSummary` is empty; omit the detail-dialog filler sentence.

**Done when.** No fixed sentence renders on product cards.

### UX-24 · Remove manual fulfillment option

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web, API default
- Severity: Minor · Review area: Shopper › setup and plan dialogs
- Depends on: — · Decision: —
- Touches: `apps/web/user.html` and `apps/web/user.css` (fulfillment selects, quantity helpers, legacy note), `apps/web/user.js` (`syncSetupAction`, `openPlan`, `planTargetDrafts`), `apps/api/src/purchase-intent-presentation.ts` and `apps/api/src/app.ts` (legacy presentation mapping), `packages/database/src/control-repository.ts` (legacy input default), `test/purchase-intent-presentation.test.ts`, `test/control-repository.test.ts`, and `test/user-dashboard.test.ts`

**Steps.**
1. Offer Shipping and Pickup only; legacy `manual` maps to Shipping with a note.
2. Quantity helper: “Yoink adds one at a time until you have N.”

**Done when.** No “manual” fulfillment option exists in the shopper UI.

### UX-25 · Calmer preflight

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Custom setup dialog
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`scheduleSetupPreflight`, `invalidateSetupPreflight`, setup form input/change/blur handlers), `test/user-dashboard.test.ts` (debounce, money-field, and review-state coverage)

**Steps.**
1. Debounce 600 ms; money fields preflight on change or blur.
2. Disable the review checkbox only when values changed since the last successful preflight.

**Done when.** At most one preflight per field edit.

### UX-28 · Plain-language readiness

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Domain copy
- Severity: Minor · Review area: Shopper › Plans readiness, Insights
- Depends on: UX-04 · Decision: —
- Touches: `packages/domain/src/purchase-automation-readiness.ts` (headline/summary strings; add `technicalReason`), `apps/web/user.js` (technical detail disclosure), `test/purchase-automation-readiness.test.ts`, `test/user-dashboard.test.ts`, string lint

**Steps.**
1. Shopper headline/summary in plain words (“Target isn't switched on for cart adds yet”, “Open Chrome to resume”, “Sign in to Target in Chrome”); keep `technicalReason` for admin and Details.
2. Lint: no “runner”, “lane”, “qualification” in shopper-visible readiness strings.

**Done when.** A shopper can act on every readiness message without asking what it means.

### UX-36 · Symmetric close-out

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Activity
- Depends on: UX-03 · Decision: —
- Touches: `apps/web/user.js` (`openCartOutcomeDialog`, missed-it handler, `renderActions`), `test/user-dashboard.test.ts` (rendered close-out flow)

**Steps.**
1. Prefill the amount with the reviewed maximum or last observed price (editable).
2. Missed it gets a light confirm or an Undo toast; both buttons share visual weight.

**Done when.** Got it is one click plus Enter in the common case.

### UX-37 · Stage pills that filter

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Activity
- Depends on: — · Decision: —
- Touches: `apps/web/user.js` (`renderActions`, stage summary), `apps/web/user.html`, `apps/web/user.css` (filter controls), `test/user-dashboard.test.ts` (rendered filtering/tooltips)

**Steps.**
1. Pills toggle a filter on the action list and show counts, with All.
2. Glossary becomes a docs link plus a tooltip per status.

**Done when.** Clicking “Needs you · 2” filters the list.

### UX-40 · Form details

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Settings; both headers
- Depends on: — · Decision: —
- Touches: `apps/web/user.html` (`#spendForm`, `#profileForm`, profile dialog), `apps/web/user.js` (`renderSpend`, profile editor, shopper pause label), `apps/web/app.js` (`renderStatus` pause label), `apps/web/index.html` (initial pause label), `test/user-dashboard.test.ts`, `test/user-onboarding-dashboard.test.ts`, `test/admin-overview-ui.test.ts`

**Steps.**
1. Timezone `<select>` from `Intl.supportedValuesOf("timeZone")`, default browser zone.
2. Profile editor opens in a dialog from New profile / Edit.
3. Pause labels “Pause actions” / “Resume actions” in both apps.

**Done when.** No free-text timezone input remains.

### UX-46 · Same words in the admin plan editor

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Admin › Plans › Edit mission
- Depends on: UX-04 · Decision: —
- Touches: `apps/web/app.js` (`openMission`, `renderMissions`), `apps/web/index.html` (`#missionDialog`), `test/admin-plan-editor-copy.test.ts` (shared-field parity)

**Steps.** Align labels with the shopper plan dialog (Use store, Store only, Cart mapping available); drop the “Intent r3” tag.

**Done when.** The two editors use identical labels for the same fields.

### UX-48 · Filterable audit

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web, API
- Severity: Minor · Review area: Admin › Activity › Audit
- Depends on: — · Decision: —
- Touches: `apps/api/src/app.ts` (`/api/v1/user/audit` params), `packages/database/src/audit-repository.ts` (filtered query and actor provenance), `packages/database/src/migrations.ts` (actor-kind column), `apps/web/index.html` (audit filter bar), `apps/web/app.js` (`loadAudit`, `renderAudit`), `apps/web/styles.css`, `test/audit-filtering.test.ts`, `test/admin-audit-dashboard.test.ts`

**Steps.**
1. Add `type`, `actor`, `since` parameters; UI offers event family, actor kind, date range.
2. Correlation id collapses to Copy id; outbox banner becomes one line or is removed.

**Done when.** “Safety decisions, last 24 hours” is two clicks.

### UX-49 · Trim Inbox explanations

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Copy, Web
- Severity: Minor · Review area: Admin › Inbox
- Depends on: UX-02, UX-03 · Decision: —
- Touches: `apps/web/index.html` (approvals and alerts views), `apps/web/app.js` (compact summaries and note capture in acknowledge/resolve), `apps/web/docs.html` (independent-review explanation), `test/admin-change-dashboard.test.ts`, `test/operator-alert-connector-dashboard.test.ts`

**Steps.**
1. Approvals: one intro sentence and the queue; two-person control explained in docs.
2. Incidents: one-line panel intros; notes via the confirm component.

**Done when.** Each Inbox view fits its queue above the fold at 900px height.

### UX-56 · Header and guardrail details

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Web
- Severity: Minor · Review area: Admin header, Settings › Guardrails & affiliate
- Depends on: — · Decision: —
- Touches: `apps/web/app.js` (`renderStatus`, `renderAttributionPolicies`, `renderHowlStoreDirectory`), `apps/web/index.html`

**Steps.**
1. Pause control labels the action with a state pill beside it; disabled reason is visible text.
2. Affiliate policy editors collapse to a table with Edit per row; directory shows 25 rows with Show all and a store filter.

**Done when.** Pause controls match across apps; the reason for a disabled toggle is visible.

### UX-60 · Per-store re-verify, plain copy

- Status: review (worktree)
- Phase: 3 · Size: S · Lane: Extension
- Severity: Minor · Review area: Extension options page
- Depends on: — · Decision: —
- Touches: `apps/extension/options.html`, `options.js`, `options.css`

**Steps.**
1. One Re-verify per store row requesting only that store's origin.
2. Copy: “Check Target again without adding to cart.” One status column per row.

**Done when.** No all-origin permission request from the options page.

---

## Phase 4 · Visual system and information architecture

### UX-01 · One token system for five surfaces

- Status: review (worktree)
- Phase: 4 · Size: L · Lane: Design, CSS, Extension build
- Severity: Critical · Review area: all surfaces
- Depends on: — · Decision: D8
- Touches: `apps/web/tokens.css` and `components.css` (new), `apps/web/user.css`, `styles.css`, `docs.css`, `dialogs.css`, `status.css`, `apps/web/user.html`, `index.html`, `docs.html`, `privacy.html` (stylesheet links), `apps/api/src/app.ts` (serve shared assets), `apps/extension/popup.css`, `options.css` (generated token block), `scripts/generate-extension-tokens.mjs`, `scripts/capture-ui-token-surfaces.mjs`, `docs/screenshots/ux-01/`, `test/ui-token-system.test.ts`, build step in `package.json`. Shared dialog/status styles, static routing, generated visual proof, and generator tests were added because the acceptance gates span those files.

**Steps.**
1. `tokens.css`: color (ground, surface, ink, muted, rule, accent, good, warning, bad), type scale (12/13/14/16/20/28/40), radius (4/8/12), 4px spacing grid, shadows; light and dark via `prefers-color-scheme` with a `data-theme` override.
2. `components.css`: button, tag, chip, card, panel, inputs, dialog, toast, status dot; loaded by all web pages.
3. Extension gets the same token values generated into `popup.css` / `options.css` at build time.
4. Apply D8; migrate `user.css` and `styles.css` to tokens; delete duplicated rules.

**Done when.** No hex literal outside `tokens.css` (lint); one screenshot set shows one button, tag and dialog style on all five surfaces; text meets 4.5:1 in both themes.

### UX-50 · Regroup admin navigation

- Status: review (worktree)
- Phase: 4 · Size: L · Lane: Web, Tests
- Severity: Critical · Review area: Admin nav and Settings group
- Depends on: UX-08 · Decision: D7
- Touches: `apps/web/app.js` (`ADMIN_NAV_GROUPS`, `setView`, `setConnectionsView`, `setQualificationRetailer`, `renderActiveView`), `apps/web/index.html` (`data-view-panel` sections), `packages/extension-ui/src/popup-state.ts` destinations, admin dashboard tests

**Steps.**
1. Top level (D7): Overview · Inbox (approvals, catalog reviews, incidents) · Stores (qualification and activation, lane readiness, adapter repair, evidence) · Sources (TrackaLacker, channels, drop windows, restock patterns) · Catalog · Plans (plans, rules) · Activity (actions, signals, audit) · Settings (guardrails, affiliate, access, operations) · Maintainer (UX-55).
2. Rewrite `ADMIN_NAV_GROUPS`; move panels between views; replace the retailer fourth level with a store picker at the top of Stores.
3. Remove duplicated readiness: keep the qualification panel, fold lane readiness cards into it.
4. Update hash aliases, popup destinations, tests.

**Done when.** Lane activation is two clicks from Overview; no destination deeper than three levels.

### UX-55 · Maintainer area

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web, Authz
- Severity: Major · Review area: Admin › Settings › Evidence, System › Data plane, Catalog merge/split
- Depends on: UX-50 · Decision: D6
- Touches: `apps/web/app.js`, `apps/web/index.html`, `apps/api/src/api-route-policy.ts` (permission), `packages/database/src/authorization-repository.ts` (new permission id)

**Steps.**
1. Move Community evidence (sharing, identity, inventory, observers, contributions), Operations › Data plane, observer trust forms and catalog merge/split into a Maintainer nav group.
2. Gate by permission (D6); hide the group without it.
3. Danger buttons move from page headers to a Danger zone at the bottom of each page.

**Done when.** The default admin nav shows no JSON textarea and no header-level delete button.

### UX-47 · One list per Activity page; injector behind two steps

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web, API
- Severity: Major · Review area: Admin › Activity › Actions, Signals
- Depends on: — · Decision: —
- Touches: `apps/web/index.html` (activity views, Operations tools, `#signalDialog`), `apps/web/app.js` (collection loaders/renderers and guarded `#signalForm` submit), `apps/web/styles.css` (segmented mode/preview), `apps/api/src/app.ts` and `apps/api/src/api-route-policy.ts` (scoped endpoints and permissions), `packages/database/src/notification-repository.ts` and `packages/database/src/attribution-repository.ts` (authoritative pagination/search), plus focused repository, API, and rendered UI tests

**Steps.**
1. Actions shows jobs only; notification deliveries and attribution receipts get their own secondary views with paginated, searchable endpoints.
2. “Advanced signal” moves to Operations › Tools with a Live / Dry-run segmented control and a preview of what will be created; dry-run stays default.

**Done when.** Actions has one list; a live signal needs two explicit steps and shows consequences first.

### UX-45 · Rules as defaults

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web
- Severity: Major · Review area: Admin › Plans › Rules
- Depends on: — · Decision: D4
- Touches: `apps/web/index.html` (`#strategyDialog`), `apps/web/app.js` (`openStrategy`, `renderStrategies`)

**Steps.**
1. Remove Prepare checkout and Submit order from the Action select (D4); keep in the model.
2. Rename the view “Rules (defaults for auto-created plans)”; inline help popover with three keyword examples; hide Quantity “Max allowed” unless the action adds to cart.

**Done when.** No unavailable action is selectable; keyword syntax is documented where it is typed.

### UX-39 · Split Settings by audience

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web
- Severity: Major · Review area: Shopper › Settings
- Depends on: — · Decision: —
- Touches: `apps/web/user.html` and `apps/web/user.js` (settings routes/cards/loaders), `apps/web/index.html` and `apps/web/app.js` (operator restart control and existing Maintainer evidence ownership), `apps/web/docs.html` and `apps/web/llms.txt` (canonical routes and support guidance), plus focused shopper/admin rendered, routing, docs, and API tests

**Steps.**
1. Tabs: Purchase defaults · Chrome · Notifications (connectors renamed “Send updates to Discord, Slack or a webhook”; deployment reference explained or admin-only) · Privacy.
2. System health and Restart worker move to admin Operations; Store-reading review moves to admin Evidence or an opt-in “Help improve” page.

**Done when.** A shopper sees no server environment reference and no admin control.

### UX-30 · Move Watch mode; selection toolbar

- Status: review (worktree)
- Phase: 4 · Size: S · Lane: Web
- Severity: Major · Review area: Shopper › Calls header
- Depends on: — · Decision: —
- Touches: `apps/web/user.html` (calls header, settings purchase panel), `apps/web/user.js` (`renderCalls`, `#watchQueueMode` handler, `#callList` change handler), `apps/web/user.css` (contextual toolbar and Watch mode field), `test/user-dashboard.test.ts`, `test/ui-information-architecture.test.ts`

**Steps.**
1. Watch mode select moves to Settings › Purchase defaults (same PATCH).
2. Selection toolbar (profile, Quick add selected, Clear) appears only when a checkbox is checked.

**Done when.** The Calls header shows only the title and count.

### UX-18 · Storefront grid

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web, CSS
- Severity: Major · Review area: Shopper › Products
- Depends on: UX-01 · Decision: —
- Touches: `apps/web/user.css` (`.card-grid`, `.product-group`, `.card-media`), `apps/web/user.js` (`productCardMarkup`, `mediaMarkup`, view toggle state), `apps/web/user.html` (accessible Grid/List control), `test/user-dashboard.test.ts`, `test/ui-information-architecture.test.ts`

**Steps.**
1. Grid: 3 columns ≥ 1100px, 2 ≥ 700px, 1 below; 4:3 images; price is the largest number on the card; store count and availability on one line; actions Quick add + Details.
2. Grid/list toggle persisted in `localStorage`; the current row layout becomes list mode.

**Done when.** At 1180px the default Products view shows ≥ 6 products with images and prices above the fold.

### UX-14 · Reorder Home

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web
- Severity: Major · Review area: Shopper › Home
- Depends on: UX-31 · Decision: —
- Touches: `apps/web/user.html` (home workspace), `apps/web/user.js` (`deriveUserHome`, `renderHomePriority`, `renderOverview`, `loadUserRoute("home")`), `apps/web/user.css` (Home sections), `test/user-dashboard.test.ts`, `test/user-onboarding-dashboard.test.ts`, `test/view-refresh-behavior.test.ts`

**Steps.**
1. Order: Now (handoff) → Next (Upcoming strip from UX-31) → Recent (last five closed actions with Got it / Missed) → Limits (daily and monthly headroom from action-platform analytics).
2. Remove cumulative counters or make them seven-day counts; announcement becomes a one-line notice (UX-16).
3. Home loads drop windows and the last five jobs.

**Done when.** Home shows the next drop with a clock time and the last outcomes without a click.

### UX-16 · Quieter release notice

- Status: review (worktree)
- Phase: 4 · Size: S · Lane: Web, CSS
- Severity: Minor · Review area: Shopper › Home
- Depends on: — · Decision: —
- Touches: `apps/web/user.html` (`#releaseAnnouncement`), `apps/web/user.css` (`.release-announcement`), `apps/web/user.js` (`renderAnnouncement`)

**Steps.** One-line notice on the surface color under the header with What changed; auto-hide after 14 days or on dismiss.

**Done when.** The handoff panel is the highest-contrast element on Home.

**Implementation review (2026-09-01).** The Home release notice is now a single compact surface-colored row containing only the version, title, `What changed` link, and accessible dismiss control. Its long summary is no longer repeated on Home, valid publication timestamps expire after 14 days, and dismissal persists by announcement ID. The urgent handoff retains the stronger green/amber treatment. Focused Home, routing, and refresh tests cover current, expired, and dismissed states.

### UX-23 · Slim Custom setup dialog

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web, Copy
- Severity: Major · Review area: Shopper › Custom setup dialog
- Depends on: UX-02 · Decision: —
- Touches: `apps/web/user.html` (`#setupDialog`), `apps/web/user.css` (`.setup-dialog`, `.setup-layout`, `.plan-review`), `apps/web/user.js` (`renderSetupReview`, `syncSetupAction`)

**Steps.**
1. One boundary line at the bottom; remove the review-boundary aside block and repeated fieldset notes; keep the preflight block.
2. Two fieldsets (Item and price; When it matches) plus Advanced; width 760px; review checkbox label “I reviewed these limits”.

**Done when.** The dialog fits 760px without scrolling at 900px height and states the boundary once.

**Implementation review (2026-09-01).** Custom setup is now capped at 760px and uses two numbered fieldsets (`Item and price`, `When it matches`) plus collapsed `Advanced` timing. Store, fulfillment, and action controls share the second fieldset; the summary is limited to seven decision rows; the server preflight remains visible; and one short execution-boundary line follows the layout. The sole acknowledgement now reads `I reviewed these limits`. Focused dashboard coverage asserts the structure, width, field order, summary bound, and explicit preflight-before-save contract.

### UX-26 · Hide the model in the plan editor

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web, API defaults
- Severity: Major · Review area: Shopper › Plans › Review or change
- Depends on: UX-04 · Decision: D4
- Touches: `apps/web/user.html` (`#planDialog`), `apps/web/user.js` (`openPlan`, `syncPlanAction`, `prepareGuardedPlanDraft`, `#planForm` submit), purchase-intent PATCH defaults in `apps/api/src/app.ts`

**Steps.**
1. Remove Satisfied from the state select (read-only when reached); remove the Substitutions field; Seller becomes fixed text “Store only”.
2. “Prepare guarded cart draft” becomes “Switch to cart mode”, which prepares and selects add to cart.
3. API accepts omitted `substitutionPolicy` and `sellerPolicy` with the fixed defaults.

**Done when.** ≤ 6 controls above the store targets.

**Implementation review (2026-09-01).** The plan editor now exposes only Active/Paused as editable states; a reached Satisfied (or legacy Archived) state is injected as a disabled read-only value. Substitution controls are removed, each store shows fixed `Seller · Store only` text, and the primary conversion affordance is `Switch to cart mode`. Timing moved below store targets into `Advanced`, leaving five relevant controls above targets. Shopper PATCH requests omit seller and substitution fields; the user API normalizes omissions to `first_party_only` and `exact_only` before the repository boundary. UI and API tests cover the fixed display, omitted-field defaults, cart-mode preparation, and satisfied-state lock.

### UX-29 · Migration prompt only when it applies

- Status: review (worktree)
- Phase: 4 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Plans
- Depends on: — · Decision: —
- Touches: `apps/web/user.html` (`#legacyPlanTransition`), `apps/web/user.js` (`renderLegacyPlanTransition`)

**Steps.** Inline notice inside the Plans summary when `eligibleCount > 0`; remove the reserved section.

**Done when.** No transition markup exists for accounts without eligible plans.

**Implementation review (2026-09-01).** The reserved migration section is removed from the document. `renderLegacyPlanTransition()` now injects one compact notice inside the Plans summary only when the authoritative preview reports eligible plans, and removes that markup when the count returns to zero. The review action uses delegated handling so no dormant button is required. Focused coverage proves the initial document and post-transition account contain no migration-specific markup while eligible accounts retain the deliberate confirmation dialog.

### UX-32 · Drawings as a Calls filter

- Status: review (worktree)
- Phase: 4 · Size: S · Lane: Web
- Severity: Minor · Review area: Shopper › Calls
- Depends on: — · Decision: D5
- Touches: `apps/web/user.html` (calls sub-tabs, drawings workspace), `apps/web/user.js` (`renderCalls`, `renderWalmartDraws`, `PRIMARY_TAB_FOR_PANEL`)

**Steps.** Drawings filter chip under Calls (D5); remove the sub-tab and the per-card “Manual entry only” tag; state the rule once in the section intro.

**Done when.** Calls has at most one row of filters and no sub-tab.

**Implementation review (2026-09-01).** Calls now owns one horizontally bounded `All / Products / Drawings` filter row and no call-type sub-tabs or separate Drawings workspace. The legacy `#calls/drawings` route restores the Drawings chip on the canonical Calls panel and participates in browser history. Product bulk actions hide when Drawings is selected; counts follow the active filter; the view-only/manual-entry rule appears once in the section heading; and per-card `Manual entry only` tags are removed. Focused tests cover the combined/default view, each filter, ARIA pressed state, route restoration, and unchanged bulk Quick add behavior.

### UX-38 · Insights for shoppers, telemetry for admins

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web
- Severity: Minor · Review area: Shopper › Activity › Analytics; Admin
- Depends on: UX-28 · Decision: D3
- Touches: `apps/web/user.html` (insights workspace), `apps/web/user.js` (`renderActionPlatform`), `apps/web/index.html` and `apps/web/app.js` (admin analytics), `packages/database/src/admin-analytics-repository.ts` (tenant-wide hop telemetry), admin analytics and action-platform UI tests. The analytics repository is included because moving hop telemetry to admin requires an authoritative tenant-wide aggregate rather than shopper-scoped data.

**Steps.**
1. Shopper Insights keeps actions, ready, needs you, hit rate, spend, headroom, savings, per-store outcomes; latency hops and source scorecards move to admin (D3).
2. Store readiness stays as a plain list using UX-28 messages.

**Done when.** Shopper Insights shows no millisecond values.

**Implementation review (2026-09-01).** Shopper Insights now contains only action outcomes, hit rate, spend/headroom/savings, per-store outcomes, and the plain-language readiness list. It has no latency or source-scorecard mount points and its renderer contains no millisecond, p50, or p95 presentation. Admin Analytics now computes tenant-wide latency hops over the selected window, renders samples plus p50/p95 timing, and exports those rows; Admin Sources retains the per-channel accuracy, false-positive, and source-latency scorecards. Repository, API, rendered admin UI, static shopper UI, type, and copy-budget tests pass.

### UX-42 · Links that say where they go

- Status: review (worktree)
- Phase: 4 · Size: S · Lane: Web
- Severity: Minor · Review area: Admin › Overview
- Depends on: UX-02 · Decision: —
- Touches: `apps/web/index.html` (overview buttons, `#safetyBanner`), `apps/web/app.js` (remove the retired disclosure renderer), `apps/web/styles.css` (remove its dead rules), and the rendered Overview test. The additional files remove code that would otherwise target missing markup and leave an unused component behind.

**Steps.** Buttons read “Open Signals” and “Open Sources”; remove the duplicated safety disclosure once UX-02 places the boundary line.

**Done when.** Every Overview link label matches its destination's title.

**Implementation review (2026-09-01).** The timeline action now says `Open Calls` and targets the `Calls` destination; the system-readiness action says `Open Sources` and targets `Sources`. The duplicate store-gate disclosure, its runtime writes, and its unused CSS are removed because the linked header boundary already owns that explanation. Rendered Overview tests cover both label/destination pairs and the disclosure's absence; navigation, route-history, type, copy-budget, and whitespace checks pass.

### UX-44 · Paste-a-link flow for admins

- Status: review (worktree)
- Phase: 4 · Size: M · Lane: Web
- Severity: Minor · Review area: Admin › Catalog › Add exact listing
- Depends on: — · Decision: —
- Touches: `apps/web/index.html` (`#listingDialog`, Maintainer raw form), `apps/web/app.js` (preview and proposal flow), `apps/web/styles.css` (compact preview treatment), `packages/database/src/catalog-link-repository.ts` (optional reviewed MSRP), and catalog-link UI/API/repository tests. The repository is included because the required optional MSRP must survive the governed proposal rather than remain display-only.

**Steps.**
1. Replace the ten-field form with the shopper flow (link preview → send) plus optional MSRP; button “Send for review”.
2. Keep the raw form under Maintainer for edge cases.

**Done when.** An admin adds a listing by pasting a URL.

**Implementation review (2026-09-01).** Admin Catalog now opens a four-input governed flow: URL, name, optional MSRP, and an explicit review checkbox. `Check link` normalizes the exact store ID and canonical URL before `Send for review` can run. Optional MSRP is accepted only for an actor with admin permission, carried under an `admin_link` provenance source, and never treated as observed offer evidence; availability remains unknown and no listing, observation, plan, or action is created. The ten-field form is retained as a `Raw listing` tool under the permission-gated Maintainer catalog panel. A rendered browser test exercises preview through proposal, with repository/API tests for permission and MSRP semantics; type, copy-budget, navigation, and whitespace checks pass.

### UX-09 · One icon set or none

- Status: review (worktree)
- Phase: 4 · Size: S · Lane: Design, CSS
- Severity: Minor · Review area: Shopper › Settings cards; Admin banners
- Depends on: UX-01 · Decision: —
- Touches: `apps/web/user.html` (`.icon` spans), `apps/web/user.css` (icon-column layout), `apps/web/styles.css` (retired `.safety-icon` rule), and the information-architecture test. The active selectors live in the surface stylesheets rather than `components.css`.

**Steps.** Twelve-glyph inline SVG sprite (chrome, link, health, bolt, check, question, download, dollar, shield, refresh, alert, box) replacing Unicode glyphs, or remove icons from the preference cards.

**Done when.** No bare-glyph `.icon` or `.safety-icon` remains.

**Implementation review (2026-09-01).** The no-icon branch was selected: all decorative bare-glyph `.icon` spans are removed from shopper Settings, preference cards no longer reserve an empty icon column, and both `.icon` and the retired admin `.safety-icon` rules are gone. Semantic status dots and labeled close buttons remain separate controls, not decorative preference-card glyphs. Static searches and rendered information-architecture tests prove no `.icon` or `.safety-icon` element remains; Settings, token-system, responsive dashboard, type, copy-budget, and whitespace checks pass.

---

## Change log

- 2026-09-01 — Created from the UX design review and action plan. All items `todo`.
- 2026-09-01 — UX-51 implemented in the shared worktree: named product pickers, typed detail/edit/cancel API, recalculated watch timing, reasoned cancellation/audit, detail drawer, replacement flow, timezone/confidence/stagger controls, and rendered/repository/API tests.
- 2026-09-01 — UX-54 implemented in the shared worktree: tenant-user lifecycle permissions and migration, cross-user support repositories and API routes, subject-bound pairing, disabled-session and credential revocation enforcement, protected initial-role grants, searchable Access UI with create/detail/support flows, and rendered/API/auth/migration tests.
- 2026-09-01 — UX-13 implemented in the shared worktree: actor identity/tenant/role/assurance projections on shopper and admin payloads, account menus in both headers, local-session labeling, contextual cross-dashboard/docs/privacy links, and actor-derived Approvals assurance copy with API and rendered tests.
- 2026-09-01 — UX-43 implemented in the shared worktree: Catalog reviews as an Inbox view, aggregate Inbox badge counts, named proposers, payload details disclosure, inline review notes, shared proposal rendering, and rendered/repository/snapshot tests for approve and reject paths.
- 2026-09-01 — UX-41 implemented in the shared worktree: tenant-scoped 24-hour and 7-day activity windows, six-stage metric toggle, sentence-case hero states, numbered readiness progress, direct-link review queue, and repository/snapshot/rendered tests.
- 2026-09-01 — UX-52 implemented in the shared worktree: provider-specific channel setup guidance and labels, server/client Discord ID validation, non-alarming client-pending state, per-source next steps, copyable TrackaLacker instructions, a linked docs section, and rendered/provider tests.
- 2026-09-01 — UX-53 implemented in the shared worktree: tenant-scoped 24-hour/7-day/30-day signal-to-outcome funnels, affiliate route/click/conversion correlation, immutable cross-store link-click receipts without URL retention, CSV export, a windowed Overview attribution strip, a dedicated Analytics view, least-privilege route classification, and repository/API/rendered click tests across all four stores.
- 2026-09-01 — UX-31 implemented in the shared worktree: local and differing source-timezone schedules, minute precision below six hours, live sub-hour start/close countdowns, compact Home and Calls upcoming strips, in-place per-item watch toggles, source timezone propagation into Calls, and rendered/API tests for enroll and cancel behavior.
- 2026-09-01 — UX-17 implemented in the shared worktree: actor-scoped store/availability/plan/price/sort filtering before pagination, authoritative filtered totals and store facets, canonical In stock/Preorder/Out of stock states with backward-compatible unavailable/planned query aliases, server-driven filter reloads, and repository/API/rendered coverage beyond 200 products.
- 2026-09-01 — UX-35 implemented in the shared worktree: manual checkout can record actual spend above the reviewed maximum, preserving the original maximum and excess as typed evidence/audit fields, committing the full actual amount to the spend ledger, warning inline without blocking, and reporting over-cap count/amount in shopper Insights, admin Analytics, and CSV with repository and rendered tests.
- 2026-09-01 — UX-34 implemented in the shared worktree: shopper actions/proposals and admin signals/actions/notifications/attribution receipts now resolve store display names; UX-37 later moved the status glossary to linked docs, keeping machine ids out of product copy; source-scan and rendered Best Buy coverage prevent raw retailer ids from leaking into dashboard copy.
- 2026-09-01 — UX-59 implemented in the shared worktree: opened cart and Needs-you handoffs now expose an in-place Got it/Missed it closeout, Got it is prefilled from the sanitized reviewed maximum, the paired-device API records the byte-identical confirmation contract, locally bound handoffs clear only after server acceptance, and reducer/rendered/service-worker/API tests cover both outcomes.
- 2026-09-01 — UX-04 implemented in the shared worktree: a canonical product glossary now governs shopper, admin, Chrome companion, help, and rendered action-status copy; the stable `#settings` alias is proven; machine identifiers and maintainer protocol evidence remain untouched; and an AST/DOM string lint prevents forbidden product terms from returning while allowing stable API, route, selector, and protocol names.
- 2026-09-01 — UX-03 implemented in the shared worktree: both dashboards now share one promise-based confirmation surface with required/optional notes, scope bullets, danger labels, focus trapping/restoration, and Escape cancellation; every native `confirm()`/`prompt()` site was migrated, catalog review notes moved into the dialog, lane activations show their bounded scope, and byte-identical server confirmation strings remain intact under rendered-flow and keyboard tests.
- 2026-09-01 — UX-06 implemented in the shared worktree: both dashboards now share persistent inline status beside the triggering control, API errors retain copyable correlation references until dismissed, transient notices stack to two, success-toast copy is runtime-capped at 60 characters, and detailed Quick add/profile propagation results remain inline while short cues preserve Undo and completion feedback; shared assets, runtime behavior, server delivery, and affected flows are covered by tests.
- 2026-09-01 — UX-02 implemented in the shared worktree: static dashboard copy is below the 500/1,200-word budgets, every panel introduction is bounded to one concise sentence, each dashboard carries one linked manual-checkout boundary, longer rationale moved to the safety documentation anchor, repetitive dialog/toast/popup language was removed, product-identity uses of “exact” were retained while operational filler was replaced, and copy-budget, glossary, rendered-dashboard, popup, API, typecheck, extension-build, and diff checks pass.
- 2026-09-01 — UX-05 implemented in the shared worktree: admin status chips are reserved for nine data-bound page states plus the single runtime Overview state, static slogans and duplicate badges were removed, secondary counts and technical gates became quiet plain text, retained chips use calm sentence-case OK/Attention/Off language, and DOM/runtime count assertions plus affected admin, API, typecheck, copy, glossary, syntax, and diff checks pass.
- 2026-09-01 — UX-07 implemented in the shared worktree: every dashboard font-size declaration now resolves to at least 12px, a unit-aware CSS lint prevents regressions below that floor, and focused UI, copy-budget, responsive-navigation, typecheck, and diff checks pass.
- 2026-09-01 — UX-11 implemented in the shared worktree: every admin status-dot call now supplies a contextual accessible label, all shopper dots expose role and aria-label semantics, dark-theme tags use solid state fills whose foreground/background pairs meet WCAG AA contrast, and source/runtime accessibility assertions plus rendered admin/shopper, typecheck, glossary, copy, type-floor, syntax, and diff checks pass.
- 2026-09-01 — UX-08 implemented in the shared worktree: shopper tabs, settings sections, activity/call subviews, admin views, nested admin sections, and store-readiness lanes now serialize to one canonical hash; user navigation pushes history while programmatic redirects replace it; Back/Forward restores the prior destination; legacy preferences/connections/health/diagnostics hashes canonicalize; popup, docs, privacy, and machine-guide links use distinct destinations; and 52 route, dashboard, popup, docs, glossary, typecheck, extension-build, syntax, and diff checks pass.
- 2026-09-01 — UX-12 implemented in the shared worktree: both dashboards retain populated rows while refreshing, first loads use accessible reduced-motion-aware skeletons, recurring refreshes use state-aware 3/15/30-second schedules and pause while hidden, the immediate compact checkout watch remains event-driven on startup and resume, and 19 affected UI tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-10 implemented in the shared worktree: 375px headers retain a compact dot-plus-word action state instead of hiding it, both shopper and admin navigation remain single horizontally scrollable rows, long header rationale is suppressed at phone widths, and 19 affected layout/render tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-33 implemented in the shared worktree: every Calls card now renders at most type, colored state, and one qualifier tag; membership and queue expectations moved into the detail line; plan/report states no longer add extra badges; the shared confirmation dialog remains mandatory for false-positive reports; and 16 rendered, dialog, glossary, typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-19 implemented in the shared worktree: product cards omit the variant paragraph when no real attributes exist, product details omit the fixed catalog filler sentence while preserving meaningful selected-store/plan state, and 16 rendered, copy-budget, glossary, typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-24 implemented in the shared worktree: shopper fulfillment controls offer only Shipping and Pickup, legacy Manual and other non-pickup values present as Shipping with a targeted save note, every shopper write path normalizes the value, legacy API inputs default to Shipping without mutating stored evidence on read, setup/plan quantity helpers explain one-at-a-time adds, and 34 API, repository, presentation, rendered, copy, glossary, typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-25 implemented in the shared worktree: ordinary setup edits use a 600 ms deduplicating debounce, money typing invalidates stale review state without calling the server until change or blur, successful draft signatures preserve the checkbox across unchanged events, in-flight/stale responses remain revision-gated, and 13 rendered/debounce/copy tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-28 implemented in the shared worktree: all 15 readiness states now use actionable shopper copy without runner/lane/qualification terminology, internal state and target reason codes remain available through `technicalReason` in the collapsed Details disclosure, and exhaustive domain/rendered/glossary tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-48 implemented in the shared worktree: audit events now persist actor provenance, repository/API queries combine event family, actor, date, and text filters, legacy rows remain available as Unknown, the admin timeline copies compact ids, and migration/repository/API/rendered tests pass.
- 2026-09-01 — UX-49 implemented in the shared worktree: Approvals and Incidents open directly onto their queues with one live summary line, independent-review details moved to docs, and rendered tests prove acknowledgement/resolution notes use the shared confirmation component.
- 2026-09-01 — UX-56 implemented in the shared worktree: the header pairs Running/Paused state with its action and exposes blocked-resume copy, affiliate policies use one-row editing, the Howl directory defaults to 25 rows with Show all/filter, and integration tests pass.
- 2026-09-01 — UX-60 implemented in the shared worktree: extension options now provide one Re-verify action and one live status per store, each gesture requests only that store's origins and sends one retailer id, and the extension tests/build pass.
- 2026-09-01 — UX-36 implemented in the shared worktree: Got it opens an editable amount dialog prefilled from the reviewed maximum or observed-price fallback, submits without another confirmation, Missed it uses the shared lightweight confirmation, both close-out controls have equal visual weight, and 10 rendered shopper tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-37 implemented in the shared worktree: action-stage counts are accessible filter pills with All, filtering occurs before pagination, each status uses model-backed tooltip copy, the inline glossary is now a `/docs#statuses` link, and 18 rendered/navigation/docs/glossary tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-40 implemented in the shared worktree: spending policy uses a browser-populated timezone select with the browser zone default, Quick-add profile creation and editing share one closed-by-default dialog, both headers use Pause actions/Resume actions, and 19 rendered/copy/navigation tests plus typecheck, syntax, and diff checks pass.
- 2026-09-01 — UX-46 implemented in the shared worktree: admin purchase-plan cards omit internal revision tags, the editor matches shopper Plan state/Quantity wanted/Use store/Maximum price/Seller/Fulfillment language and options, legacy Manual maps visibly to Shipping, and a rendered parity test plus copy/glossary/typecheck/syntax/diff checks pass.
- 2026-09-01 — UX-01 implemented in the shared worktree: one light/dark semantic token source now supplies shopper green and admin mint themes, shared low-specificity primitives cover buttons/tags/chips/cards/panels/fields/dialogs/toasts/status dots, all web surfaces load the shared assets, extension builds regenerate the same dark tokens and primitives without hex literals, duplicate surface primitives were removed, WCAG contrast is tested, and five real-browser screenshots prove the component styles across shopper, admin, docs, popup, and options.
- 2026-09-01 — UX-50 implemented in the shared worktree: admin navigation now follows Overview, Inbox, Stores, Sources, Catalog, Plans, Activity, Settings, and Maintainer; Stores and Sources share one physical payload without duplicating routes or fetch scope; qualification and lane readiness are consolidated behind a top-of-page store picker; legacy hashes canonicalize to bounded three-segment destinations; Store activation is exposed directly after opening Stores from Overview; and focused source, store, overview, route-history, responsive-navigation, syntax, and diff checks pass. Extension destinations remain shopper-scoped and already resolve to distinct canonical shopper routes under UX-08/UX-58, so no admin hash was introduced there.
- 2026-09-01 — UX-55 implemented in the shared worktree: migration 60 adds the `admin.maintainer` capability to curated maintainer roles; the scoped Maintainer snapshot fails closed without it; the client hides and canonicalizes unauthorized routes; observer JSON tooling, catalog merge/split, and data-plane qualification now live only under permission-filtered Maintainer tabs; Operations retains health and workers; destructive evidence actions moved into bottom danger zones; and 11 focused authorization, snapshot, routing, rendered, migration-backed, TypeScript, token, syntax, and diff checks pass.
- 2026-09-01 — UX-47 implemented in the shared worktree: Actions now owns only action jobs; Notifications and Affiliate routes are independent searchable, paginated Activity destinations backed by tenant/user-scoped endpoints; the simulator and advanced injector moved to Operations › Tools; Dry-run is the default segmented mode; Live shows its production consequences and requires a separate shared-dialog confirmation before submission; and repository, route-policy, API, information-architecture, and rendered confirmation tests pass.
- 2026-09-01 — UX-45 implemented in the shared worktree: Rules is identified as the default policy for auto-created plans; unavailable checkout/order actions are absent from the editor; legacy rules require an explicit supported replacement instead of being silently rewritten; Max allowed appears only for Add to cart; three in-place keyword examples document AND, OR, and exclusion syntax; and rendered behavior, information-architecture, plan-copy, TypeScript, token, syntax, and diff checks pass.
- 2026-09-01 — UX-39 implemented in the shared worktree: shopper Settings now has only Purchase defaults, Chrome, Notifications, and Privacy; notification connectors use shopper-facing connection-key guidance; system health, diagnostics, and worker restart were removed from the shopper payload and UI; restart is permission- and deployment-gated under admin Operations › Workers; quarantined store-reading evidence remains under permission-gated Maintainer › Observers; legacy settings routes canonicalize; and 26 focused rendered/API/docs/routing tests plus TypeScript, token, syntax, source-scan, and diff checks pass.
- 2026-09-01 — UX-30 implemented in the shared worktree: the Calls header now contains only its title and authoritative call count; Watch mode moved to Settings › Purchase defaults without changing its confirmed PATCH contract; profile, Quick add selected, and Clear controls appear only after selecting a call; Clear restores focus to the list; responsive styling and rendered route/visibility/focus tests were added; and 15 focused tests, TypeScript, token, syntax, and diff checks pass.
- 2026-09-01 — UX-18 implemented in the shared worktree: Products now defaults to a compact three-column storefront grid at 1100px and above, two columns from 700px, and one below; six eager media slots, 4:3 imagery, prominent prices, one-line store/availability summaries, and Quick add/Details actions establish the card hierarchy; multi-store Quick add still requires explicit store selection; the former row layout is available as a persisted List view; affiliate store links remain in Details; and 14 rendered/static tests plus TypeScript, token, syntax, and diff checks pass.
- 2026-09-01 — UX-61 implemented in the shared worktree: served docs, privacy, and machine guidance use the running release version; shopper-facing links resolve to canonical accessible destinations; the shared glossary and safety anchors are present; and API/rendered link tests pass.
- 2026-09-01 — UX-58 implemented in the shared worktree: popup navigation exposes one accurately named destination per item, consolidates extension settings and store access, uses the canonical Chrome settings route in pairing copy, and passes reducer, rendered-popup, options, and runtime routing tests.
- 2026-09-01 — UX-15 implemented in the shared worktree: Home onboarding actions now open actionable pairing guidance with Re-check or move to Products and focus Quick add, progress is expressed as Step N of 5, and rendered onboarding tests prove no toast-only dead end.
- 2026-09-01 — UX-27 implemented in the shared worktree: every plan card has a one-click Pause/Resume action, state values render through product labels, the first-plan empty state points to Products, and rendered/API tests cover both transitions.
- 2026-09-01 — UX-20 implemented in the shared worktree: Quick add requires an explicit store, creation sends the complete enabled-target set through server preflight, other stores remain visible for review, and repository/API/rendered tests prove only the selected store is enabled.
- 2026-09-01 — UX-21 implemented in the shared worktree: Quick add success presents a ten-second one-click Undo that invokes the confirmed safe delete path, restores the product state, and has rendered interaction coverage.
- 2026-09-01 — UX-22 implemented in the shared worktree: link submission remains on Products, pending proposals render inline as In review, approved products surface on refresh, and rendered onboarding/dashboard tests cover the route and proposal lifecycle.
- 2026-09-01 — UX-57 implemented in the shared worktree: popup product actions remain Inspect product/Inspect again while outcome text renders separately, outcome tinting no longer owns the button, and reducer/rendered tests forbid result nouns as action labels.
- 2026-09-01 — UX-14 implemented in the shared worktree: Home is ordered Now, Next, Recent, Limits; it loads upcoming windows and five recent outcomes; clock times, countdowns, handoffs, Got it/Missed it history, and spend headroom render without another navigation; rendered and refresh tests pass.
- 2026-09-01 — UX-16 implemented in the shared worktree: the release announcement is a dismissible one-line surface notice that expires after 14 days while the urgent handoff retains the strongest contrast; current, expired, and dismissed states have rendered coverage.
- 2026-09-01 — UX-23 implemented in the shared worktree: Custom setup is capped at 760px with two primary fieldsets, collapsed Advanced timing, one boundary line, a bounded review summary, and explicit preflight-before-save coverage at the reviewed layout contract.
- 2026-09-01 — UX-26 implemented in the shared worktree: the shopper plan editor exposes five controls before store targets, locks terminal state, removes substitution controls, fixes seller policy to Store only, moves timing under Advanced, and defaults omitted API fields safely; UI/API tests pass.
- 2026-09-01 — UX-29 implemented in the shared worktree: legacy transition markup is generated inside the Plans summary only for an authoritative positive eligible count and is removed when eligibility clears; initial, eligible, and completed states are tested.
- 2026-09-01 — UX-32 implemented in the shared worktree: Drawings is one accessible filter in the Calls row, no sub-tab or per-card manual tag remains, the manual contingent-order rule appears once, legacy routing canonicalizes, and rendered/safety tests pass.
- 2026-09-01 — UX-38 implemented in the shared worktree: shopper Insights retains outcomes, spend, headroom, savings, and plain readiness without millisecond telemetry; tenant-wide hop percentiles and source scorecards live in admin; repository/API/rendered/static tests pass.
- 2026-09-01 — UX-42 implemented in the shared worktree: Overview actions say Open Calls and Open Sources and resolve to matching canonical titles, while the duplicate safety disclosure and dead renderer/styles are removed; rendered routing and copy tests pass.
- 2026-09-01 — UX-44 implemented in the shared worktree: Admin Catalog accepts a URL-first reviewed listing proposal with name and optional governed MSRP, previews canonical identity before sending, retains raw entry only in Maintainer, and passes repository/API/rendered tests.
- 2026-09-01 — UX-09 implemented in the shared worktree: the no-icon branch removes decorative `.icon` and `.safety-icon` markup and layout rules while retaining labeled semantic status controls; DOM/source scans and information-architecture tests pass.
- 2026-09-02 — Gap-analysis fix pass (rounds 1–3 findings, https://claude.ai/code/artifact/0b5d6890-40d3-4fdd-86df-c4ca6e597df0): admin stylesheet's five undefined variables mapped to tokens and a `var()` resolution lint added (`test/ui-token-system.test.ts`); options page rem sizes replaced with px and the type-floor lint made root-aware; shopper header gained a pause reason line and plain-copy toggle failures; readiness checklist labels rewritten in plain words and their repository added to the glossary scan (plus `read-only`/`armed`); `words()` is sentence case with label maps for action, reservation, reason, availability, fulfillment and drawing enums; drop cards and drawing cards lost their filler sentence, show local close times and at most three tags; setup/plan copy dropped "Server check", "advanced rules", "Direct plan."; Home notice moved under the header, Limits button says Settings, connect-source dialog lists three steps; quick-add menu is keyboard operable; Notifications card id no longer collides with the `#connections` alias; admin overview rows say "Open {title}", single-item nav labels equal page titles, `#users`/`#drop-windows` aliases added, detail dialogs close with Back; Catalog shows a review summary instead of a duplicate queue; source cards, eyebrows, maintainer checklist and identity cards use display names and plain labels; drop windows count only active opt-ins, list who opted in, and drop the Supersedes select; call preview and daily chart derive from data; library polls capped at the server clamp; products carry `purchasable` from the domain helper; blocked-resume API error is product copy; popup items name their destinations, pending outcomes rank first, per-result boundary lines removed, tokens replace rgb() literals and shared buttons replace bespoke ones; options page has two-step delete, a pairing path, retry, and px sizes; docs glossary carries Settings and Closed with Got it / Missed it as close-out choices, direct links complete, READMEs and llms.txt in glossary words, and a test guards the announcement version against package.json; shared toast/dialog primitives live only in `components.css`; dialog keydown no longer throws on pages without the dialog. Deferred: type/spacing token adoption across ~250 px literals, real-page proof screenshots (no browser on the host), extension light theme, chip vocabulary (conflicts with UX-41 step 3), 13-store guardrails (backend contract), Lane in the shopper docs glossary (forbidden on shopper surfaces).
- 2026-09-02 — Palette refresh (Kevin: "far too plain… modern high-end palette… alignments don't flow"): tokens.css rewritten (navy ink, emerald accent + bright variant, violet admin accent, new --color-info, store identity tokens, coloured shadows/gradients, self-hosted Manrope at /fonts/manrope.woff2 served by app.ts); components.css primitives refreshed; user.css/styles.css/docs.css/popup.css/options.css/status.css/dialogs.css restyled; header flow fixed on both dashboards (admin nav no longer clipped 1051–1500px, no sideways scroll at 768/390, shopper header 2 rows max on phones); data-store/data-stage/data-metric hooks added in user.js/app.js; extension token generator extended. Deferred: product imagery (no imageUrl in catalog contract), font bundle for the extension, extension icon asset.
