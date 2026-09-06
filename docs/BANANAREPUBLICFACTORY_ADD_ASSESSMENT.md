# Banana Republic Factory cart support — standalone live proof

The official store loaded successfully and two One Size caps were inspected
through DOM/text. Both native Adds succeeded, followed by independent compiled
runner Add/cart verification. No images were viewed or checkout submitted.
Application integration and packaging are complete; final release validation is in progress.

| Product | Selected SKU | Color | Product price | Cart unit price |
| --- | --- | --- | --- | --- |
| Mixed Media Baseball Cap | `11765980010000` | Olive Green Heather | $20.00 | $15.00 |
| Patterned Baseball Cap | `11765830010000` | Brown Houndstooth | $20.00 | $15.00 |

Product pages use `bananarepublicfactory.gapfactory.com/browse/product.do` and
the separate cart host is `secure-bananarepublicfactory.gapfactory.com` at
`/shopping-bag`. The native bag control established this handoff. One Size
selection expands the ten-digit product/color ID to a fourteen-digit child
SKU ending in `0000`. This version supports the assessed fourteen-digit One
Size offers; unresolved sizes and other SKU formats are rejected.

The independent adapter and `bananarepublicfactory-add-v1` runner bind the
exact child SKU, structured product/color identity, visible and structured USD
price, selected One Size and color controls, quantity one, checked shipping
property plus data-selected, stock, seller and product-scoped Add control.
The visible title uses uppercase CSS; its comparison to schema names ignores
case. Commit consumes a ten-second authorization once and rechecks document,
job, root, button and offer fingerprint.

Both product pages advertised an extra 25% discount at checkout. The actual
bag applies it automatically: its current unit price is $15.00, with a
separate promo label and struck-through $50.00 regular price. Incrementing the
mixed-media cap to quantity two leaves its displayed unit price at $15.00.
The cart reader reports that current price. Exact SKU/quantity deltas and the
job's price ceiling still apply. No coupon or checkout action was required.

The bag uses independently counted item totals, exact SKU product links,
One Size rows and checked shipping radios. A zero header without explicit
empty-bag text is rejected as incomplete. Captures preserve live checked
states and visibility, remove images and pickup-location text, and replace
opaque cart-row identifiers with fixture placeholders.

Four Factory tests and the Banana Republic/shared safety regressions passed:
17 tests total in `/tmp/yoink-bananafactory-action1.log`. Type and lint checks
passed in `/tmp/yoink-bananafactory-check1.log`. The standalone compiled runner
verified the mixed-media cap's exact +1 at 13:31:19 UTC on 2026-09-06, then
the patterned cap's exact +1 with the first unchanged at 13:32:14 UTC. Both
rehearsals made zero clicks; both duplicate commits were rejected.

Live evidence is under `docs/store-evidence/bananarepublicfactory/`. Native
assessment items were removed and an empty bag verified before compiled
testing. The compiled-runner receipt records final cleanup separately.

Final cleanup: after removing both compiled test units and reloading, the
compiled reader verified zero rows, zero count and explicit empty-bag text at
13:33:50 UTC. All Factory tabs are closed and no test units remain. Receipt:
`docs/store-evidence/bananarepublicfactory/compiled-runner-2026-09-06.json`.

## Application integration — 1.28.0 validation

Contracts, observer/diagnostics, catalog/attribution, source identity, device
capabilities, qualification, readiness, HTTP leasing, shopper/admin setup,
optional permissions, cart handoff, replay and packaging are integrated. Both
captured products passed source replay and promotion with zero privacy-scan
hits. Real Chromium passed the packaged runner and inactive setup tests.
Final full application/native PostgreSQL and local deployment checks remain
in progress; this release has not yet replaced the running 1.27.0 service.
