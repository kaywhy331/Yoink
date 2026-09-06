# Product observation age and source

Addresses the presentation portion of SaaS audit finding YS-25.

Product and store cards now distinguish a recently reported stock state from
stale or unknown information. A source report is never labeled as a live stock
guarantee. Five minutes is a display threshold; it does not authorize an action
or replace Chrome's fresh offer checks.

## Evidence model

- Catalog projections return the latest stock report and the latest priced
  report separately. A newer unpriced stock report cannot refresh an older
  price. Neither a catalog edit nor a late older event refreshes observation
  age. Matching timestamps use the observation ID as a deterministic tie break.
- An unknown latest stock report remains unknown. Missing, invalid, and future
  timestamps do not produce a recent-stock label. Original catalog status,
  filtering, and action policy remain unchanged.
- Source labels are restricted to known source types belonging to the current
  tenant and user. Shared catalog evidence remains visible; other users'
  connection metadata, names, identifiers, and custom source values are not
  returned as provenance. Unavailable attribution reads “Recorded update.”

## Shopper behavior

- Cards identify the store behind the displayed price and show independent
  stock and price ages with their sources. A recent purchasable report takes
  priority over older reports when selecting the featured store.
- Product details retain per-store report history and distinguish catalog
  prices from observed prices. “Check [store]” opens the existing outbound
  route, preserving attribution. Supported Chrome pages include guidance to
  use **Inspect product** in the companion.
- Labels age every thirty seconds while the page is visible and immediately
  when returning to the tab, including an open product dialog. Aging updates
  the text in place and preserves keyboard focus.

## Acceptance

Repository regression coverage verifies independent timestamps, unpriced
updates, out-of-order events, unknown latest reports, deterministic ties,
missing evidence, and provenance isolation across both user and tenant scopes.
Both flat and grouped library projections are checked.

Real Chromium journeys verify independently aged stock and price, aging while
a dialog remains open, retained link focus, stale/unknown/future reports,
catalog price labels, recent preorder selection across stores, store-check
links, and phone/desktop layout. Screenshot data is synthetic.

- `npm run check` and `npm run build`: passed as the first stages of verify.
- Focused catalog/repository/API checks: 10 passed.
- Shopper dashboard regressions: 13 passed after updating stock-label fixtures.
- Final full `npm run test:browser`: 42 passed, including all three evidence
  journeys and the later plan-store/routing cases. Phone screenshots
  inspected; phone/desktop overflow checks passed.
- Full application run: 1,022 tests; 1,021 passed. The sole failure caught a
  repeated checkout reminder in product details. Removed the repetition; the
  persistent header retains the boundary. All 34 affected copy, shopper, and
  recovery tests passed after the subsequent plan-editor and routing fixes.
- Native PostgreSQL proof: the initial separate process ended with signal 15
  (exit 143), without a test result. The bounded background rerun completed
  successfully: 1 test passed, 0 failed, exit 0, about 16 minutes 15 seconds
  including runner overhead. Its result and TAP output were recovered and
  verified when resuming the session.
- Resume verification completed 1,028 application checks: 1,027 passed and
  an unchanged Operations dashboard timing assertion failed. That test passed
  unchanged on its isolated rerun. All 43 Chromium journeys passed, including
  the product-evidence cases. See the [scheduling receipt](AUTOMATIC_STORE_CHECKS_2026-09-05.md)
  for the continuation's complete verification record.

## Remaining acceptance

The check link opens the store for the shopper to review; it does not claim to
refresh saved catalog observations or remotely command Chrome. Direct
dashboard-to-companion inspection and installed-companion acceptance remain
open under YS-25/YS-32. Hosted production acceptance and the broader product
goal remain open.
