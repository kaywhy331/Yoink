# Bluemercury cart assessment

Two live products were inspected and tested with their native Add to bag
controls on 2026-09-06. Both exact variants appeared in the guest cart.
The guarded runner and application registration are not yet implemented.
All evidence uses DOM/text; no images or screenshots were viewed.

| Product | Variant ID | Merchant SKU | Product price | Cart price |
| --- | --- | --- | --- | --- |
| SkinCeuticals C E Ferulic | `32352032096331` | `3549426300` | $185.00 | $185.00 |
| M-61 PowerGlow Peel, 30 treatments | `31691401265227` | `1723701177` | $72.00 | $50.40 |

The exact host is `bluemercury.com`. Product pages use `/products/<handle>`
or `/collections/<collection>/products/<handle>`. The selected variant is in
the `variant` query when present. The main product, variant picker, and Add
section are siblings within `main > .ProductRefreshed`. The scoped button is
`[data-section-type="add-to-cart"] #addToCart .AddToCart__Add[type="submit"]`.
Recommendation Add buttons have separate scopes and must be excluded.

There is no native `/cart/add` form. Two scoped application/json scripts bind
the selection: the main section's `data-section-data` contains productId,
variantIds and selectedVariant; `data-add-to-cart-product-json` contains
productData and variantData. Both agree on the selected ID, price and SKU.
The peel's checked Size radio is 30 treatments; 10 treatments is unavailable.
The visible quantity-one input and its alternate mobile select agree.

The main price group has `aria-label="Price $72."` on the peel. Its visible
price span is marked aria-hidden; a sticky display elsewhere still says $36.
Use the main selected price, not that stale sticky value. Both products have
USD structured offers, an in-stock selected offer, shipping metadata for the
US and requires_shipping=true. Brand/vendor is the manufacturer, not seller.

Structured Product @id is a valid canonical product URL, but offer URLs have
duplicated `/products/<handle>` paths. They cannot establish canonical identity.
The native selected variant and matching merchant SKU provide separate evidence.

The site leaves an empty `#global-modal[aria-modal=true]` container in the DOM.
Its inner `.GlobalModal` has display:none; the outer height is zero. An actual
visible dialog must still block the runner. No security or account dialog
was encountered during native Add testing.

The observed cart destination is `/cart`; fresh same-origin `/cart.js` reads
return JSON with text/javascript Content-Type. The cart page was stale after
an Add in another tab until reloaded, so its pre-existing DOM is insufficient.
The API confirms exact variant URLs, quantities, unit/line prices, USD currency,
item count and total. Native properties are `_noGiftBoxing`, `_sku`, `_upc`,
`_vendor`, `_skuLimit` and `Brand`; these are merchant metadata. Unknown custom
properties, selling plans and gift-card items need to be rejected.

The initial cart was empty at 14:12:26 UTC. Ferulic's native Add was verified
at 14:16:08 UTC. The peel's Add was verified at 14:17:03 UTC with Ferulic
unchanged, item count two and total $235.40. The advertised 30% peel discount
applied automatically; no coupon or checkout action was needed. No free gift
was automatically inserted. A fresh cart page showed both items and prices.

Each exact row's native Remove button removed its unit. At 14:19:20 UTC,
a fresh cart API response reported zero items and total zero. No test items
remain, and no checkout was submitted. Evidence is in
`docs/store-evidence/bluemercury/`.
