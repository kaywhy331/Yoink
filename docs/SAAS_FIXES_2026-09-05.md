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

## Validation

- Final type checking and UI-token/selector-pack checks: passed.
- Full extension and TypeScript build: passed.
- New API coverage: 1,001 reachable plans, filter-before-page behavior, 105 reachable calls, exact paused-plan association, foreign-scope exclusion, browser revocation, cache/compression behavior and stale profile-impact rejection.
- Browser coverage: all five Playwright journeys passed at 390 × 844. Includes plan paging/search, query restoration/clear, named paused-plan detail, route cleanup, initial-load failure/retry, spending draft preservation, keyboard focus return and pairing expiry/regeneration.
- Local performance comparison: Plans rendered 50 cards and 3,870 DOM elements, versus 200 cards and 12,098 in the audit. LCP was 1,498 ms (audit repeat: 3,379 ms); CLS was 0.02 (audit: 0.00). These are separate local samples without CPU/network throttling; no production or real-user performance claim is made. Render-blocking CSS again showed zero estimated LCP savings.
- [Mobile plan/search evidence](screenshots/saas-fixes-2026-09-05/plans-mobile.png), [empty-search recovery](screenshots/saas-fixes-2026-09-05/search-recovery.png).

Application regression run: `npm test` ran 968 application checks: 967 passed and one static heading assertion still expected the previous notification title. That expectation was updated to the new title; all five tests in `test/ui-information-architecture.test.ts` passed on rerun. The runner stopped before its PostgreSQL phase because of that assertion, so the native proof ran separately and passed. No application-code change was required for this last failure.

The proposed commit was also checked against clean HEAD, excluding the pre-existing working-tree changes: its API, recovery, docs, dashboard and source checks passed after updating that notification-title expectation; 16 additional recovery/glossary checks passed on the final shopper script. The five browser journeys passed; the expanded plan-search case passed again with a 60-second multi-step test budget after a resource-contention startup timeout.

Native PostgreSQL proof: `npm run test:postgres:native` passed (1 proof, 0 failures; 11 minutes 45 seconds). This verifies the existing PostgreSQL isolation, concurrent-write and signal lifecycle boundaries in a temporary local database; it does not establish hosted HTTP deployment readiness.

## Finding-by-finding disposition

“Fixed” refers to the identified application defect or the stated mitigation, not a production-launch certification. “Partial” names both the implemented portion and the remaining acceptance work. “Open” requires additional implementation or deployment acceptance.

| Finding | Disposition | Remaining work or acceptance boundary |
| --- | --- | --- |
| YS-01 | Open | Select hosting/PostgreSQL authority, finish HTTP repository composition and prove cutover, restore and outages in the deployed service. |
| YS-02 | Open | Select/connect the identity provider and verify full login, invitation, recovery and revocation lifecycle. |
| YS-03 | Open | Implement governed global catalog curation and tenant-safe propagation; retain the existing guard. |
| YS-04 | Open | Implement durable account cleanup, identity revocation and receipts; user data export remains available. |
| YS-05 | Partial | Inventory and revoke added. Browser renaming and full re-pair acceptance remain. |
| YS-06 | Partial | Desktop handoff and product-first guidance added to setup docs. A new intent-choice onboarding flow and first-value timing study remain. |
| YS-07 | Fixed | Copy/countdown/expiry/regeneration and new-browser success transition implemented. |
| YS-08 | Partial | Removed the nonexistent Operations credential path. Provision a real authenticated sender and verify a received event through the target deployment. |
| YS-09 | Fixed mitigation | Discord intake is unavailable before configuration. Shipping an ingestion client remains separate integration work. |
| YS-10 | Partial | Administrator handoff and test instructions are explicit. A tracked connection request or self-service provisioning flow remains. |
| YS-11 | Partial | Destination edits and event choices added. Removal, paged delivery history and supported recovery/retry UI remain. |
| YS-12 | Open | Unify per-store responsibility, permission, sign-in, rehearsal, activation and return-to-plan actions. |
| YS-13 | Fixed | Unverified checks no longer read as healthy. |
| YS-14 | Partial | Cadence copy matches current runtime. Shared scheduling metadata and next-eligible-check presentation remain. |
| YS-15 | Open | Managed distribution, store review, staged rollout and installed update/recovery acceptance. |
| YS-16 | Fixed | Full plan pagination/search and totals; tested with 1,001 plans. |
| YS-17 | Fixed | Older Calls/Activity retrieval and loaded-page preservation. Offset pages still require refresh to reconcile concurrent inserts. |
| YS-18 | Fixed | Exact server-side actor-owned associations replace the truncated joins. |
| YS-19 | Fixed | Product and call plan labels use actual status rather than existence-based readiness. |
| YS-20 | Partial | Pre-save impact review and stale-impact rejection added. A distinct future-default-only edit choice and detailed skipped-plan preview remain. |
| YS-21 | Fixed | Stable call selection survives refresh and reconciles ineligible products. |
| YS-22 | Open | Complete proposal history, verified metadata and retained correction drafts. |
| YS-23 | Fixed | Query-aware empty state with working Clear search and filters. |
| YS-24 | Partial | Query/filter URLs and dialog route cleanup added. Product/plan entity deep links and invalid-entity recovery remain. |
| YS-25 | Partial | Product detail observation age added. Card-level source/freshness states and direct recheck remain. |
| YS-26 | Partial | Store capability labels added. Per-user readiness in store selection remains. |
| YS-27 | Partial | Global product/SKU/store/status search added. Dedicated store/action filters and bulk pause/resume remain. |
| YS-28 | Partial | Explicit dialog discard, navigation protection and unload warnings added. Cross-reload draft storage remains. |
| YS-29 | Open | Audited corrective spend/refund ledger entries and idempotent correction UI. |
| YS-30 | Partial | Watch count and consequences reviewed before mode changes. Terminal history/reason/recovery view remains. |
| YS-31 | Open | Decide discovery-only versus user-reported drawing participation/reminders and implement that scope. |
| YS-32 | Open | Authorized installed-extension release acceptance for each store; fixtures never perform real adds. |
| YS-33 | Open | Shopper Insights period/store/product filters and action drill-through. |
| YS-34 | Fixed | Reported outcomes shown as alternatives, with window and unreported-outcome caveats. |
| YS-35 | Open | Move inactive future order gates out of the primary qualification workflow. |
| YS-36 | Open | Unified incident/case ownership, evidence, next action and customer-visible resolution. |
| YS-37 | Open | Requester notification, expiry and return-to-operation journey after independent approval. |
| YS-38 | Open | Production SLOs, ownership, independent monitoring, incident communication and restore exercises. |
| YS-39 | Open | Explicit experimental/local labels and deployed independent witness/community acceptance. |
| YS-40 | Fixed | Spending draft/revision preservation and explicit reload. |
| YS-41 | Fixed | Initial failure/retry and stale-data recovery. |
| YS-42 | Partial | Deadlines, cancellation support, stale-read sequencing and safe timeout messaging added. Broader active cancellation of obsolete reads and “still working” states remain. |
| YS-43 | Fixed locally | Bounded plan DOM, retained expansion/focus and measured local improvement. Slower-device/production measurements remain. |
| YS-44 | Fixed delivery | Gzip plus content-hash revalidation; private responses remain uncached. Route splitting remains measurement-driven. |
| YS-45 | Partial | Dialog names and real keyboard focus checks added. Full assistive-technology acceptance and eliminating stacked confirmation dialogs remain. |
| YS-46 | Partial | Five phone-sized browser journeys and desktop guidance added. Wider device/zoom coverage and duplicated CSS-generated status announcements remain. |
| YS-47 | Fixed disclosure | Policy and change notice now distinguish local captures from hosted diagnostics; existing controls remain authoritative. |
| YS-48 | Partial | Install, API source and notification guides added. Searchable troubleshooting, contextual support and release-specific documentation remain. |
| YS-49 | Partial | Real-browser acceptance and CI workflow added. CI must execute in the hosting repository; broader axe/assistive-technology and live extension coverage remain. |
| YS-50 | Partial | Setup and failure copy improved. Cross-surface editorial review and first-use comprehension testing remain. |
| YS-51 | Open decision | Confirm affiliate-funded/free versus subscription-funded; subscription billing is conditional on that decision. |

## Running the browser gate

Run `npm ci`, `npx playwright install --with-deps chromium`, then `npm run test:browser`. The fixture server uses an in-memory database on loopback port 33993. To use an existing Chrome binary, set `YOINK_TEST_CHROME` to its executable path. Browser reports and temporary results are ignored by Git; CI retains artifacts for 14 days. The checked-in screenshots use synthetic data.
