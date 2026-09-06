# Audio Advice cart assessment — standalone runner verified

Two live products were inspected using DOM/text and native Add controls. Both
were verified in the guest cart through `/cart` and a fresh read-only
`/cart.js` request. A standalone adapter and guarded runner are now implemented and live-verified; application integration is complete and final release validation is in progress.

| Product | Variant ID | Merchant SKU | Unit price |
| --- | --- | --- | --- |
| AudioQuest HDMI 48G > A Coupler | `41907724615764` | `AQ:HDM48GCOUPLER` | $19.95 |
| AudioQuest HDMI Noise-Stopper Caps | `41907725598804` | `AQ:CAPHDM` | $35.00 |

The official host is `www.audioadvice.com`. Public product JSON at the product
path plus `.js` reported exactly one available, shippable Default Title variant
for each product. The native form's variant ID and quantity one matched the
product JSON, visible price and `In Stock: Free 2-Day Shipping` message.

The primary root is `.product-column-right` within the main `product-form`
custom element. Each page has two `/cart/add` forms, but only one has the
native submit button and quantity input. Its `id`, `product-id`, and `section-id`
inputs provide product bindings. Read the form ID with `getAttribute('id')`:
the hidden input named `id` masks the form's normal JavaScript `id` property.

The cart API's `item_count` was zero before the first Add, one afterward, and
two after the second Add. The final cart retained one of each variant, USD
currency and a $54.95 total. Its rows and API agreed on numeric variant IDs,
merchant SKUs, product links with variant queries, quantities, `final_price`
and `final_line_price`. Both products reported `requires_shipping=true`,
`product_has_only_default_variant=true`, empty properties and no selling plan.
Saved DOM evidence replaces opaque cart-line suffixes with fixture placeholders.

The exact rows' native Remove links removed both test units. A fresh cart API
read returned zero items and total zero; the live page displayed
`Your cart is empty`. Cleanup is saved in
`docs/store-evidence/audioadvice/empty-cart-2026-09-06.json`. All Audio Advice
tabs are closed. No images were viewed, checkout submitted or user lane enabled.

## Standalone runner and compiled live proof

The adapter binds the unique native Add form, hidden variant/product/section
IDs, visible quantity one, merchant SKU, current USD price, in-stock shipping
message and the page's unique structured Product offer. The form ID is read
with getAttribute to avoid the hidden id input. The caps product's visible
subtitle differs from its schema name; its title prefix, exact merchant SKU
and exact variant URL bind the same offer. Both display and schema names are
included in the prepared offer fingerprint.

The native cart reader fetches fresh same-origin /cart.js data. It checks USD,
variant IDs and URLs, Default Title products, shipping, empty custom properties,
no selling plan, current unit/line prices, item count and total. Authorization
is consumed once and rechecks the document, offer, control, job and expiry.

All three new tests and nine shared browser-safety tests passed. Fresh live
Product schema evidence was saved separately for both products. The compiled
runner added the coupler at 12:45:21 UTC and verified its exact +1 at 12:45:46.
It added the caps at 12:46:12 and verified its exact +1 with the coupler unchanged
at 12:46:34. Both rehearsals clicked zero times and both duplicate commits were
rejected. A fresh cart page showed one of each and a $54.95 subtotal.

Both native Remove links removed the test units. At 12:49:14 UTC, the live
page showed Your cart is empty, zero Remove links, and a fresh compiled reader
returned zero lines. No test units remain. Receipt:
`docs/store-evidence/audioadvice/compiled-runner-2026-09-06.json`.

Next: integrate contracts, observer/diagnostics, registry, catalog/attribution,
permissions, qualification, setup, leasing, sanitized replay and packaging.
The standalone runner is not an application lane and has not been activated.

## Application integration — 1.28.0 validation

Contracts, observer/diagnostics, catalog/attribution, source identity, device
capabilities, qualification, readiness, HTTP leasing, shopper/admin setup,
optional permissions, cart handoff, replay and packaging are integrated. Both
captured products passed source replay and promotion with zero privacy-scan
hits. Real Chromium passed the packaged runner and inactive setup tests.
Final full application/native PostgreSQL and local deployment checks remain
in progress; this release has not yet replaced the running 1.27.0 service.
