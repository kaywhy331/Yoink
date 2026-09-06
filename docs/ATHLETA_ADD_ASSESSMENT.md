# Athleta cart support — release validation

Two live One Size products were inspected through DOM/text and manually added
using their native Add to Bag controls. No images were viewed or checkout
submitted. A standalone adapter and guarded runner now pass four source tests;
the compiled runner has now passed live Add/cart proof for both products.
Application integration, packaging, native PostgreSQL and local deployment validation are complete for 1.27.0.

| Product | Selected SKU | Color | Unit price |
| --- | --- | --- | --- |
| On The Go Scrunchie 3 Pack | `7844640220000` | Black White | $15.00 (regular $25.00) |
| Intuition Wide Headband | `7678720420000` | Pearl | $15.00 |

Product pages use `athleta.gap.com/browse/product.do?pid=<SKU>`. Navigating
with a nine-digit product/color ID selected One Size and replaced `pid` with
the thirteen-digit child SKU. The structured Product offer agrees with that
SKU, visible name, selected color, USD price, stock, and Athleta seller.

The scoped product root is `#buy-box-wrapper-id`; its native control is
`button#pdp-atb-btn[type=button]`. Quantity has a visible
`#pdp-quantity-selector` button and hidden native select. Shipping and pickup
use radio inputs and `data-selected` attributes. Shipping was selected on both
assessed products. The cloned product HTML retains `data-selected` but does
not serialize the shipping input's live checked property; future captures and
replay must preserve that state explicitly.

The native bag is `https://secure-athleta.gap.com/shopping-bag`, a separate
host from product pages. The two-product bag independently reported two items,
each with quantity one and a matching full-SKU product link. Incrementing the
scrunchie produced quantity two while the headband stayed one and the bag count
became three. `data-testid=product-price` remains a **unit price**, even for
quantity two; the struck-through $25.00 is not the current $15.00 price.

Cart rows are `li[data-testid^=active-item-]`, with product-name links,
product-size, product-color, product-price and product-quantity fields. Shipping
is a checked radio within `data-testid=ship-to-address`. Recommendations and
saved-for-later items must be excluded. Opaque cart-row IDs in saved evidence
were replaced with stable fixture placeholders.

All three assessment units were removed using the exact rows' quantity-minus
and delete controls. At `2026-09-06T11:34:25.195Z`, a fresh reload showed zero
item rows, `0 items in your shopping bag`, and `Your bag is currently empty.`
The earlier loading state also showed a zero header but lacked empty text;
the reader must reject that incomplete state. Captures are under
`docs/store-evidence/athleta/`. All Athleta assessment tabs were closed.


## Standalone implementation and compiled live proof

`packages/browser-adapters/src/athleta.ts` binds the complete selected SKU,
One Size option, selected color, visible and structured USD prices, native
quantity controls, shipping selection and shipping stock. The URL and unique
structured Product offer agree with the primary product title and color. The
Product details accordion can be collapsed; its hidden text is not required
as visible SKU evidence. Both DOM property and data-selected must agree for
shipping. Prepared authorizations expire after ten seconds and are consumed
once, with document, button, root, job and offer fingerprint revalidation.

The DOM cart reader uses full-SKU links, One Size rows, checked shipping
selection, unit prices excluding struck-through list prices, separate item
count and exact quantity deltas. It rejects pickup, duplicate/omitted lines,
unsupported variants, security interruptions and loading-zero snapshots.

Four Athleta source tests and nine shared browser-safety tests passed. The
combined Athleta/safety/ASUS run passed all 19 tests. The runner was compiled
independently to `/tmp/yoink-athleta-action.js` and live-tested:

- Scrunchie added to an empty bag, exact +1 verified at 11:48:25 UTC.
- Headband added while the scrunchie remained one, verified at 11:50:38 UTC.
- Both rehearsals clicked zero times; both duplicate commitments were rejected.
- Both test units were removed. A fresh reload and the compiled cart reader
  verified an empty baseline at `2026-09-06T11:53:42.194Z`.

Proof: `docs/store-evidence/athleta/compiled-runner-2026-09-06.json`.
All Athleta tabs are closed. No test units remain.

## Application integration — 1.27.0

Athleta is the ninth guarded Add lane and seventeenth catalog/attribution
retailer. Contracts, versions, observer diagnostics, catalog/attribution,
TrackaLacker identity, device capabilities, qualification, readiness, leasing,
shopper/admin setup, replay and packaging are wired. Both exact optional hosts
are required for leasing. Product/manual handoffs accept both registry hosts;
completed-cart handoffs still require the secure shopping-bag path.

The API and execution repository now derive retailer-hint limits from the
registry, retaining all nine stores. A real HTTP integration test leases an
Athleta job with the full hint list. PostgreSQL qualification binds its exact
two-host domain list. The complete native PostgreSQL proof passed after this correction.

Standard repair captures retain current product-radio and quantity selections.
The capsule URL stays query-free; replay rejoins only the validated child SKU
on the exact US product route. Both promoted live captures passed the privacy
scan and replay through source and packaged runners. A wrong capsule SKU stops
the rehearsal. Two Chromium tests cover both captured products, separate product
and bag hosts, exact cart deltas, single-use commits and inactive setup screens.

The full application run exercised 1,094 tests: 1,080 passed and 14 failed.
All 14 failures now have passing targeted reruns. Most involved store-count
expectations; static UI loading copy was shortened to preserve the existing
word budget. Type/lint checks pass.

## Final release verification — 2026-09-06

The complete isolated native PostgreSQL proof passed (17.9 minutes), including
Athleta qualification/activation and the seventeen-store attribution policies.
The final five Chromium tests passed for Athleta, Pokémon Center and Best Buy.
The focused Pokémon Center/Best Buy/identity/release run passed all 31 tests.
The application type build and type/lint checks passed. No images were viewed;
the browser tests explicitly disabled screenshots and traces.

The extension was repackaged and the local service rebuilt and restarted.
Health and the release descriptor report 1.27.0. The served 396,297-byte download
matches the local ZIP SHA-256:
`5b8a076ca2a678cdde10900cb6ba6c228e43a7f4c6bbfb135d661baa2f278bb4`.
The ZIP manifest, registry, version map, background and Athleta/Pokémon Center/
Best Buy runners match their built files byte for byte. Both exact Athleta
optional origins are present. Best Buy remains Add v16 / observer v14 and
Pokémon Center remains Add v1 / observer v4.

The real database has zero Athleta qualification rows and its execution flag
is disabled, as are the other newly implemented lanes. Release verification
does not activate real-user execution. Audio Advice, Banana Republic and Banana
Republic Factory standalone work is not registered in this release.

Receipt: `docs/store-evidence/athleta/deployed-1.27.0-2026-09-06.json`.
Logs: `/tmp/yoink-athleta-postgres5.log`, `/tmp/yoink-athleta-check6.log`,
`/tmp/yoink-athleta-package2.log`, `/tmp/yoink-athleta-final-browser2.log`, and
`/tmp/yoink-athleta-release1.log`.
