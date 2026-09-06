# Product-first onboarding (YS-06)

## Implementation plan

1. Domain/API: lead with an exact product and reviewed plan; use the full saved-plan count, including inactive plans. Keep authoritative monitoring and guarded Add checks.
2. Shopper: explicit notify/cart intent, reviewed first-plan buttons, actor-scoped expiring session hint, visible saved/monitoring/cart milestones, and a credential-free desktop continuation link. Existing action handoffs keep priority.
3. Acceptance: domain counts/readiness, clean-account real-browser phone and desktop journeys, unsupported stores, reload and stale review, actor isolation, and existing dashboard regressions. Run check/build and the application suite.
4. Delivery: record evidence and limitations, validate a combined snapshot with the 37 pending main files, commit the isolated branch, integrate into main, and verify the pending-file hashes and empty index.

No execution authority, durable default, or existing plan is changed by selecting an onboarding intent. The existing exact-plan preflight and explicit confirmation remain mandatory. Scripted timing is not a human usability study; YS-06 stays Partial until that study is performed.

## Result

Home leads with product exploration and an explicit notify/cart choice. First-plan product buttons open the reviewed setup dialog even when reusable profiles exist. The intent hint expires after 24 hours, is scoped by the signed-in user, and carries no confirmation, price, pairing credential, or execution authority. Unsupported products explain notification-only behavior in the form.

A first save returns to Home with separate saved-plan, monitoring, and cart-action milestones. A phone can copy a link reconstructed from the origin, excluding all query and hash data; the same signed-in account retrieves the durable saved plan on desktop. Clipboard denial leaves a selectable link. Chrome installation and source connection retain their existing checks. Cart and Needs you handoffs retain priority.

The overview supplies the full non-deleted plan count instead of deriving first use from its 20-row sample. Paused, archived, and satisfied plans remain saved and route to review without being resumed.

Acceptance exposed two existing preflight issues. A server-adjusted reserve total now appears in the editable form and summary before consent. The fingerprint binds the normalized draft, every cost amount and spending result, and current readiness; it excludes only the presentation flag describing whether the preview raised that total. Changed prices, reserves, or readiness still invalidate the preview. Rejected stale/missing previews clear cached consent and request a fresh check. Previews issued before this fingerprint update require a fresh review.

## Validation

- Isolated `npm run check` and `npm run build`: passed.
- Focused domain, API, dashboard, onboarding, and copy checks: 22 passed.
- Full Playwright acceptance: 34 passed, including six new first-plan journeys. Phone and desktop screenshots inspected; no horizontal overflow. Dynamic first-use Home is bounded below 150 words before save and 180 afterward; static copy budgets remain unchanged.
- Combined snapshot with the 37 pre-existing Best Buy/release files: check/build and 28 focused API/dashboard checks passed.
- Full application run: 1,001 checks; 1,000 passed initially. The sole failure was an obsolete companion-first expectation in the catalog-link API test. Updated it to expect pending product review and reran successfully.
- Final affected dashboard/catalog/copy checks after the actor-key guard: 18 passed in each of the isolated and combined snapshots.
- Native PostgreSQL proof: passed in 15m 5s.

Scripted timings use isolated local fixtures with an approved exact product; they do not measure human discovery, catalog-review time, Chrome installation, retailer setup, or notification delivery. YS-06 remains Partial pending a human first-value timing study. No deployment or live notification send is part of this change.

## Delivery

Implemented on `feat/first-plan-onboarding-20260905` from `61be3a0`, with combined validation in `/tmp/yoink-first-plan-combined-20260905`. The main worktree’s 37 pre-existing pending files are excluded from this commit and checked against `/tmp/yoink-first-plan-baseline-20260905.json` before and after integration. No new database table, migration, deployment, or service restart.
