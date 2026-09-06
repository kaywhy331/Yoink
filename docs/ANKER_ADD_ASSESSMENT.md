# Anker cart assessment — September 6, 2026

Both assessed products reached the guest cart using their primary Add to Cart
control. No Anker adapter is implemented or activated. These are manual DOM
assessment results, not packaged-runner qualification.

| Product | Variant | Choice | Product / cart price |
| --- | --- | --- | --- |
| Nano Charger (45W, Smart Display, 180° Foldable) | `46070529196182` | Black Stone, 1-Pack | $39.99 / $25.99 |
| Nano Charger (45W) with USB-C to USB-C Cable | `45136446554262` | Black | $25.99 / $25.99 |

The first product received an automatic $14 discount. Each assessment added
quantity one without selecting membership or subscriptions. The second cart
was also corroborated by the storefront's own GraphQL cart query: quantity one
and USD $25.99. Both items were removed through their exact removal dialogs.
Final DOM inspection at `2026-09-06T10:27:42.225Z` found no cart quantity inputs,
the empty drawer message, and no count on either Shopping cart button. No
checkout was submitted and no images were viewed.

## Roadblock: fresh cart evidence and navigation

Anker uses a Next.js storefront backed by a Shopify Storefront API cart.
`/cart.js` returned an unrelated empty Ajax cart while the real drawer held an
item. It must not be reused from the ANINE BING adapter. `/cart` renders a
missing-page message and opens the drawer; its empty state says **Your Cart is
Ready!** and omits a numeric zero count. The existing strict empty-baseline
contract therefore needs a proven reader for this separate cart, plus a
reliable navigation/handoff strategy. This is an integration roadblock, not an
Add-button failure. Continue the directory assessment and retain these captures
for the headless-cart reader work.

Product identity comes from the numeric Shopify variant in the URL,
`#__NEXT_DATA__` product variants, and settled Product structured data. Early
hydration can briefly expose metadata for another variant. Scope the primary
control to `[class*="ProductInfo_ProductSidebar"]`: two buttons share
`#netlify_dtctest_add_to_cart`, but only the primary button's third ancestor
contains the exact name, choice, quantity, shipping evidence and price.
Membership upsells have separate controls and must not be included.

Cart lines are divs around `input[type="number"]` without the product quantity
input's `tag` attribute. The third ancestor contains identity and prices; the
fourth is the complete row. Recommendation list items are not cart rows. The
third row button opens a named removal confirmation; Confirm removes the item.

Sanitized DOM captures and the assessment receipt are under
`docs/store-evidence/anker/`. No cart IDs, checkout URLs, tokens, raw network
headers, or full network responses were promoted into the repository.
