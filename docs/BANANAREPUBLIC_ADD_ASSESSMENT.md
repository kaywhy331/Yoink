# Banana Republic cart support — standalone live proof

Two live One Size products were inspected through DOM/text, added with native
controls, and then independently tested with the compiled guarded runner.
No images were viewed, no checkout was submitted, and all test items were removed.
Application registration and packaging are complete; final release validation is in progress.

| Product | Selected SKU | Color | Unit price |
| --- | --- | --- | --- |
| Signature Bandana | `9067620520000` | Patchwork Blue | $25.00 (regular $40.00) |
| Merino Lightweight Striped Beanie | `9067580020000` | Olive | $50.00 |

Product URLs use `bananarepublic.gap.com/browse/product.do?pid=<SKU>`; the
separate bag host is `secure-bananarepublic.gap.com/shopping-bag`. Native One Size
selection resolves a nine-digit product/color ID to the full thirteen-digit
child SKU. Shipping must finish hydrating: checked properties and data-selected
attributes must both agree. The visible primary heading uses uppercase CSS,
so comparison against structured Product names is case-insensitive.

The adapter binds the exact SKU, structured offer, selected color and One Size
option, visible and structured USD price, quantity one, shipping selection and
stock, and the product-scoped native Add to Bag control. Authorizations expire
after ten seconds and are consumed once. Commit rechecks document, job, control,
root and offer fingerprint. The standalone version is `bananarepublic-add-v1`.

Cart rows use full-SKU product links, checked shipping radios, quantity and
current unit prices. At quantity two the bandana price remains $25.00; its
struck-through $40.00 is excluded. A zero header alone is a loading state, not
an empty baseline. Explicit empty-bag text is also required.

Four source tests pass, including both captured products, binding mutations,
single-use commits, loading versus empty carts, current unit prices and exact
cart deltas. The combined Banana Republic, Audio Advice and shared safety run
passed all 16 tests (`/tmp/yoink-banana-action2.log`). Type and lint checks pass.

Compiled live verification on 2026-09-06:

- Bandana: exact +1 at 13:19:04 UTC, unit price $25.00.
- Beanie: exact +1 at 13:20:05 UTC, unit price $50.00; bandana unchanged at one.
- Both rehearsals made zero clicks; each commit clicked once and its duplicate
  was rejected.
- Both units were removed. After a fresh reload, the compiled reader verified
  zero rows, zero bag count and explicit empty text at 13:21:27 UTC.

Native assessment cleanup was also completed before the compiled tests. At
quantity two, the bandana has a minus control; only quantity one has a delete
control. All Banana Republic tabs are closed and no test units remain.

Evidence: `docs/store-evidence/bananarepublic/compiled-runner-2026-09-06.json`,
the two product captures, and empty/two-item/three-unit cart captures in the
same directory. Captures remove images, location labels and opaque cart-row IDs.

## Application integration — 1.28.0 validation

Contracts, observer/diagnostics, catalog/attribution, source identity, device
capabilities, qualification, readiness, HTTP leasing, shopper/admin setup,
optional permissions, cart handoff, replay and packaging are integrated. Both
captured products passed source replay and promotion with zero privacy-scan
hits. Real Chromium passed the packaged runner and inactive setup tests.
Final full application/native PostgreSQL and local deployment checks remain
in progress; this release has not yet replaced the running 1.27.0 service.
