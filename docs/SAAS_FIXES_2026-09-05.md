# SaaS audit implementation receipt

This change repairs collection access, state presentation, unsaved drafts, load recovery, pairing, several setup handoffs, static delivery and browser release checks. The original [51-finding audit](SAAS_AUDIT_2026-09-05.md) remains the source backlog. Production launch still requires the account, deployment and operational work listed below.

The implementation was developed and tested against the audited 1.22.6 working tree. Its pre-existing Best Buy, retailer adapter and release changes are preserved separately from this commit.

## Implemented behavior

- Plans use 50-item server pages, accurate totals and search by product, SKU, store or status. Readiness filtering happens before paging. Keyboard focus and open details survive a refresh. Bulk setup selection explicitly applies to the current page.
- Calls and Activity fetch older server records. Refresh reloads previously loaded pages and deduplicates stable IDs. Product and store refreshes retain collections larger than 200.
- Calls and product groups carry actor-owned plan identity from the server. A paused plan is labeled paused, including when its product or plan is beyond the initial collection pages. Calls retain selection and the chosen setup through refresh.
- Spending drafts survive focus changes and background refresh. Conflicting server revisions keep the draft and offer an explicit reload. Monetary inputs reject excess decimal places and exponential/hex notation.
- Failed initial loads replace skeletons with a route retry. Stale data remains available. HTTP errors retain status, error code and support reference. Both dashboards bound requests to 15 seconds and accept cancellation signals. A timed-out mutation explains that it may have saved and is never automatically retried.
- Shopper pairing includes Copy, a live countdown, expiry/regeneration and paired-success feedback. Settings lists browsers, version, last activity and individual revoke actions. Revocation does not claim to remove local extension data or existing store carts.
- Editing a reusable setup re-fetches its affected-plan count and requests a before/after review. A fingerprint rejects changes to the reviewed setup or linked-plan membership before applying the edit. Existing automatic retry of plans missing price/store evidence is disclosed.
- Notification destinations can be edited, including name, delivery key and event preferences. Setup explains the administrator handoff and requires a received test message for verification.
- Discord intake is labeled unavailable before configuration. API source setup links to operator instructions instead of a nonexistent credential screen. Store checks no longer present unverified state as healthy. Extension settings describe the implemented automatic-check cadence.
- Search/filter URLs survive navigation and reload; clearing an empty search actually clears its query. Leaving a workspace closes read-only dialogs. Unsaved dialogs require explicit discard, block accidental route departure and warn before page unload.
- Product details show observation age. Store directory cards distinguish browsing/notification support from store cart capability. Watch-mode changes disclose the current watch count and their effect before saving. Admin outcomes show Got it and Missed as alternatives.
- The privacy change notice dated 2026-09-05 describes default-enabled local sanitized HTML captures, operator access, retention, pruning and deletion separately from hosted diagnostics.
- JS/CSS use gzip when accepted, content-hash ETags and mandatory cache revalidation. Private API and HTML responses retain `no-store`; assets are not given an unsafe immutable lifetime at unversioned URLs.
- Playwright runs five isolated browser journeys and captures mobile evidence. GitHub CI runs checks, builds, the application/PostgreSQL suites and browser tests. No retailer cart or external destination is exercised by these browser fixtures.

## Initial validation · 99ce333

- Final type checking and UI-token/selector-pack checks: passed.
- Full extension and TypeScript build: passed.
- New API coverage: 1,001 reachable plans, filter-before-page behavior, 105 reachable calls, exact paused-plan association, foreign-scope exclusion, browser revocation, cache/compression behavior and stale profile-impact rejection.
- Browser coverage: all five Playwright journeys passed at 390 × 844. Includes plan paging/search, query restoration/clear, named paused-plan detail, route cleanup, initial-load failure/retry, spending draft preservation, keyboard focus return and pairing expiry/regeneration.
- Local performance comparison: Plans rendered 50 cards and 3,870 DOM elements, versus 200 cards and 12,098 in the audit. LCP was 1,498 ms (audit repeat: 3,379 ms); CLS was 0.02 (audit: 0.00). These are separate local samples without CPU/network throttling; no production or real-user performance claim is made. Render-blocking CSS again showed zero estimated LCP savings.
- [Mobile plan/search evidence](screenshots/saas-fixes-2026-09-05/plans-mobile.png), [empty-search recovery](screenshots/saas-fixes-2026-09-05/search-recovery.png).

Application regression run: `npm test` ran 968 application checks: 967 passed and one static heading assertion still expected the previous notification title. That expectation was updated to the new title; all five tests in `test/ui-information-architecture.test.ts` passed on rerun. The runner stopped before its PostgreSQL phase because of that assertion, so the native proof ran separately and passed. No application-code change was required for this last failure.

The proposed commit was also checked against clean HEAD, excluding the pre-existing working-tree changes: its API, recovery, docs, dashboard and source checks passed after updating that notification-title expectation; 16 additional recovery/glossary checks passed on the final shopper script. The five browser journeys passed; the expanded plan-search case passed again with a 60-second multi-step test budget after a resource-contention startup timeout.

Native PostgreSQL proof: `npm run test:postgres:native` passed (1 proof, 0 failures; 11 minutes 45 seconds). This verifies the existing PostgreSQL isolation, concurrent-write and signal lifecycle boundaries in a temporary local database; it does not establish hosted HTTP deployment readiness.

## Follow-up implementation

- Browser names can be changed in Settings without changing their credentials. Revoked browsers have a Pair again action; the API acceptance check proves that re-pairing issues a new identity while the revoked credential stays invalid.
- Notification history uses 50-row server pages and destination filtering. Switching Settings sections loads history independently, with its own loading/error/retry state; a history outage leaves other Settings usable. Users can remove a destination and its history after explicit confirmation. A live delivery lease blocks removal; the UI explains that sent updates cannot be recalled. Removal retains an audit event and deletes queued deliveries.
- Failed notifications can be retried explicitly. Attempts remain cumulative, duplicate retry requests do not create new deliveries, and stale review data or changed destination bindings are rejected. The UI explains possible duplicate receipt after a connection failure. Invalid management input now returns readable client errors.
- Product and plan detail URLs restore records outside the loaded page. Back closes detail before leaving the list; reload restores detail; unavailable records have Retry and Return to list. Dirty plan edits block route departure, and late detail responses cannot open over another workspace.
- Insights offers 24-hour, 7-day, 30-day, 90-day and all-time periods plus store and product/SKU filters. Summaries, CSV and Activity drill-through share the same creation-time cohort and anchored end time. Outcomes remain current; cap headroom remains account-wide and is labeled accordingly. Empty results offer wider-filter guidance, and CSV text filters cannot become spreadsheet formulas.
- Editing a setup offers Save a separate setup for future use. Creating the copy preserves existing linked plan policies; making the copy the default affects future Quick adds. Existing-setup edits still require the impact review from the first change. Plan price inputs now also reject excess precision and exponential notation on save.
- Calls exposes watch history, including terminal reason, observation count, last check, plan review and stop controls for running watches. Filters distinguish running and ended watches; older entries are reachable.
- Future checkout/order capabilities are collapsed in reference details. Experimental sharing/observer tools state that network coverage is unverified. Notification management, history and Insights controls wrap on phone-sized screens.

Follow-up validation: `npm run check` and `npm run build` passed. All 973 application checks passed in the final full runner (7 minutes 30 seconds); the isolated native PostgreSQL proof passed (1 proof, 0 failures; 11 minutes 45 seconds). The full `npm test` command exited 0. A separate snapshot excluding pre-existing release/extension edits passed all 18 focused API, recovery and copy checks. The added API checks cover 105 delivery records, ownership boundaries, credential preservation/re-pair, retries and removal, exact product lookup, and consistent time/store/product filtering. Eleven browser journeys passed at 390 × 844 and cover the original flows plus entity routing, browser naming, notification history/removal, Insights drill-through and separate-setup preservation. Additional recovery checks cover terminal watch history and late detail responses. Two deterministic browser cases release older requests after newer successful actions to verify browser-name and restored-detail state cannot regress. History failure/retry is exercised while switching between Notifications and Chrome settings. These fixtures send no external notifications and perform no retailer cart actions.

[Mobile notification history evidence](screenshots/saas-fixes-2026-09-05/notifications-mobile.png).

## Plan management and product review completion

- Setup edits use a read-only preview of the same propagation calculation as saving. It shows each linked plan's quantity, action, wait, store caps, fulfillment and total cap before/after, with 20 displayed per page. Missing price/MSRP, disabled or unsupported stores, completed plans, expired plans, unsupported currency and excessive calculated limits remain unchanged with an explanation. The fingerprint binds the draft, existing setup, plan revisions/targets and relevant price evidence; changed inputs require another review. Editing the draft invalidates its preview. The review stays inside the setup dialog, and mobile error messages wrap below the action buttons.
- Plans filter by enabled store, active/paused/satisfied/archived/expired state and action, with global ordering by recent changes, creation or product name. Filtering precedes paging and shares its predicates with totals. URL restoration preserves these choices. Selection remains bounded to the current page; Pause and Resume show an explicit review for at most 50 plans. Per-plan fingerprints reject stale edits, expired plans cannot resume, limits remain unchanged, and a results list reports updated, unchanged and skipped plans. Repeated requests do not add revisions to already-changed plans.
- Applying an unchanged route preserves its open detail dialog. Escape closes routed details and clears their URL immediately, so a startup refresh cannot reopen a dialog while its native close event is queued. Unsaved plans retain their discard confirmation.
- Product reviews have complete 25-row history, submission/decision times, review notes and local retry after request failures. Rejected suggestions reopen a populated correction draft; successful resubmission creates a new independently reviewed request and preserves the earlier decision. Only the product URL and entered name are retained in session storage, scoped to the signed-in user, with a 24-hour restore limit; confirmations and preview results are never restored. Explicit discard and successful submission clear the draft. Recognized catalog links show their approved catalog name; other names are identified as user supplied, with no verified offer claim.

Validation: the full `npm test` command exited 0: 976 application checks passed, followed by the isolated native PostgreSQL proof (1 proof, 0 failures). After the final dialog-routing fix, a staged snapshot excluding pre-existing release and extension edits passed `npm run check`, `npm run build`, all 32 focused API/profile/recovery/copy checks, and all 14 browser journeys. The three new API checks cover pre-page filtering and ownership, stale/idempotent bounded status changes, propagation skip reasons with no preview writes, evidence-change rejection, and 61 reachable review records. All 14 mobile browser journeys passed, including the new bulk-plan, paged setup-impact/stale-draft, and review-history/retry/correction/reload flows. Existing profile and copy/glossary checks passed.

[Mobile plan management](screenshots/saas-fixes-2026-09-05/plan-management-mobile.png) · [Setup impact review](screenshots/saas-fixes-2026-09-05/setup-impact-mobile.png).

## Finding-by-finding disposition

“Fixed” refers to the identified application defect or the stated mitigation, not a production-launch certification. “Partial” names both the implemented portion and the remaining acceptance work. “Open” requires additional implementation or deployment acceptance.

| Finding | Disposition | Remaining work or acceptance boundary |
| --- | --- | --- |
| YS-01 | Open | Select hosting/PostgreSQL authority, finish HTTP repository composition and prove cutover, restore and outages in the deployed service. |
| YS-02 | Open | Select/connect the identity provider and verify full login, invitation, recovery and revocation lifecycle. |
| YS-03 | Open | Implement governed global catalog curation and tenant-safe propagation; retain the existing guard. |
| YS-04 | Open | Implement durable account cleanup, identity revocation and receipts; user data export remains available. |
| YS-05 | Fixed locally | Inventory, naming, revoke and Pair again controls added; credential preservation and re-pair isolation verified. Installed-extension release acceptance remains under YS-15/YS-32. |
| YS-06 | Partial | Desktop handoff and product-first guidance added to setup docs. A new intent-choice onboarding flow and first-value timing study remain. |
| YS-07 | Fixed | Copy/countdown/expiry/regeneration and new-browser success transition implemented. |
| YS-08 | Partial | Removed the nonexistent Operations credential path. Provision a real authenticated sender and verify a received event through the target deployment. |
| YS-09 | Fixed mitigation | Discord intake is unavailable before configuration. Shipping an ingestion client remains separate integration work. |
| YS-10 | Partial | Administrator handoff and test instructions are explicit. A tracked connection request or self-service provisioning flow remains. |
| YS-11 | Fixed | Editing, event choices, removal, paged/filterable history and explicit retry are implemented. Removal discloses history deletion and rejects live leases; retries preserve the original binding and attempts. |
| YS-12 | Partial | [Unified per-store setup](STORE_SETUP_IMPLEMENTATION_2026-09-05.md) connects Plans, Stores and Insights with separate gates, owners, recovery and a fresh return-to-plan check. Live paired-companion handoff acceptance remains. |
| YS-13 | Fixed | Unverified checks no longer read as healthy. |
| YS-14 | Partial | Cadence copy matches current runtime. Shared scheduling metadata and next-eligible-check presentation remain. |
| YS-15 | Open | Managed distribution, store review, staged rollout and installed update/recovery acceptance. |
| YS-16 | Fixed | Full plan pagination/search and totals; tested with 1,001 plans. |
| YS-17 | Fixed | Older Calls/Activity retrieval and loaded-page preservation. Offset pages still require refresh to reconcile concurrent inserts. |
| YS-18 | Fixed | Exact server-side actor-owned associations replace the truncated joins. |
| YS-19 | Fixed | Product and call plan labels use actual status rather than existence-based readiness. |
| YS-20 | Fixed | Read-only paged before/after impact, exact skip reasons, stale plan/evidence rejection and separate-setup choice are implemented and verified. |
| YS-21 | Fixed | Stable call selection survives refresh and reconciles ineligible products. |
| YS-22 | Fixed workflow | Complete history, review times/notes, scoped correction drafts and new independently reviewed submissions are implemented. Existing catalog names are labeled approved; raw links do not claim verified offers. |
| YS-23 | Fixed | Query-aware empty state with working Clear search and filters. |
| YS-24 | Fixed | Query/filter and product/plan detail URLs restore through reload; Back, invalid-entity recovery and late-response protection are verified. |
| YS-25 | Partial | Product detail observation age added. Card-level source/freshness states and direct recheck remain. |
| YS-26 | Partial | Four guarded-store directory cards and selected-store views now show actor-specific setup and recovery. Broader plan-editor capability treatment remains. |
| YS-27 | Fixed | Search plus store/status/action filters and global sorting precede paging. Reviewed bulk pause/resume is bounded to 50 selected plans with stale checks and per-item results. |
| YS-28 | Partial | Explicit dialog discard, navigation protection and unload warnings added. Product-link correction drafts survive reload within a user-scoped tab session. Cross-reload storage for other forms remains. |
| YS-29 | Open | Audited corrective spend/refund ledger entries and idempotent correction UI. |
| YS-30 | Partial | Mode consequences plus terminal watch history/reasons, plan review and running-watch stop controls are implemented. Restart eligibility for cancelled watches remains. |
| YS-31 | Open | Decide discovery-only versus user-reported drawing participation/reminders and implement that scope. |
| YS-32 | Open | Authorized installed-extension release acceptance for each store; fixtures never perform real adds. |
| YS-33 | Fixed | Period/store/product filters, matching CSV and Activity drill-through, outcome sample counts and no-data guidance are implemented; budget headroom is explicitly account-wide. |
| YS-34 | Fixed | Reported outcomes shown as alternatives, with window and unreported-outcome caveats. |
| YS-35 | Fixed | Inactive order gates are collapsed in reference details with the manual-checkout boundary explained. |
| YS-36 | Open | Unified incident/case ownership, evidence, next action and customer-visible resolution. |
| YS-37 | Open | Requester notification, expiry and return-to-operation journey after independent approval. |
| YS-38 | Open | Production SLOs, ownership, independent monitoring, incident communication and restore exercises. |
| YS-39 | Partial | Experimental labels and production-coverage limits are explicit; deployed independent witness/community acceptance remains. |
| YS-40 | Fixed | Spending draft/revision preservation and explicit reload. |
| YS-41 | Fixed | Initial failure/retry and stale-data recovery. |
| YS-42 | Partial | Deadlines, cancellation support, stale-read sequencing and safe timeout messaging added. Broader active cancellation of obsolete reads and “still working” states remain. |
| YS-43 | Fixed locally | Bounded plan DOM, retained expansion/focus and measured local improvement. Slower-device/production measurements remain. |
| YS-44 | Fixed delivery | Gzip plus content-hash revalidation; private responses remain uncached. Route splitting remains measurement-driven. |
| YS-45 | Partial | Dialog names and real keyboard focus checks added. Full assistive-technology acceptance and eliminating stacked confirmation dialogs remain. |
| YS-46 | Partial | Fourteen phone-sized browser journeys and desktop guidance added. Wider device/zoom coverage and duplicated CSS-generated status announcements remain. |
| YS-47 | Fixed disclosure | Policy and change notice now distinguish local captures from hosted diagnostics; existing controls remain authoritative. |
| YS-48 | Partial | Install, API source and notification guides added. Searchable troubleshooting, contextual support and release-specific documentation remain. |
| YS-49 | Partial | Real-browser acceptance and CI workflow added. CI must execute in the hosting repository; broader axe/assistive-technology and live extension coverage remain. |
| YS-50 | Partial | Setup and failure copy improved. Cross-surface editorial review and first-use comprehension testing remain. |
| YS-51 | Open decision | Confirm affiliate-funded/free versus subscription-funded; subscription billing is conditional on that decision. |

## Running the browser gate

Run `npm ci`, `npx playwright install --with-deps chromium`, then `npm run test:browser`. The fixture server uses an in-memory database on loopback port 33993. To use an existing Chrome binary, set `YOINK_TEST_CHROME` to its executable path. Browser reports and temporary results are ignored by Git; CI retains artifacts for 14 days. The checked-in screenshots use synthetic data.
