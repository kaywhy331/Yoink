# American Eagle cart support

Release 1.25.0 adds `americaneagle-add-v1` and observer v1. The first supported
layout is available **One Size** products on `www.ae.com/us/en`. Store checks
and activation remain independent; installation does not enable execution.

The product adapter requires one primary product panel, its visible USD price
and product name, matching structured style/color identity, quantity one,
and one active One Size option with a ten-digit child SKU. Recommendations and
pickup controls cannot replace the product's Add to Bag control. The canonical
link retains the style/color product path and `?sku=<child>`. This query carries
an identity constraint; the runner verifies the actual selection and does not
assume that the query selects a size.

Rehearsal performs no clicks. Preparation grants a single-use authorization
that expires after ten seconds. Commit rechecks the document, product root,
button, job, price, selected child SKU, style/color and security state. Cart
evidence uses row child SKUs, matching product links, quantities, line totals,
and a separate bag count. Verification requires exactly +1 for the requested
child SKU and unchanged quantities for all other items. Cart reads never alter
quantities. Empty carts require explicit empty text and a zero count.

Other sizes need a proven way to restore the intended size on fresh navigation.
Preorders, pickup, subscriptions, ambiguous prices or selections, security
challenges and modal interruptions remain unsupported. Checkout is manual.

## Live guest-cart proof — September 6, 2026

| Product | Style/color | Child SKU | Price | Compiled-runner result |
| --- | --- | --- | --- | --- |
| AE Halloweenie Bag Charm | `0577_9778_900` | `0045350782` | $17.95 | Added one; tote remained one |
| AE Off-Duty Snoopy Tote Bag | `0427_9775_410` | `0045503992` | $34.95 | Increased from one to two; charm remained one |

Both live rehearsals passed, both commits clicked once, and duplicate commits
were rejected. The three-unit cart displayed a $69.90 tote line, confirming
that the cart field is a line total and each tote costs $34.95. The initial
tote Add also reached the cart, but its 60-second job expired during a slow
reload; that rejected verification is retained in the receipt. The later tote
test used a five-minute job and passed the complete verification flow.

All three test units were removed with the exact cart rows' Remove controls.
At `2026-09-06T09:42:48.972Z` the compiled reader verified an empty baseline,
zero rows and bag count zero. No images were viewed and no checkout was
submitted. Full proof: `docs/store-evidence/americaneagle-2026-09-06.json`.

The original reduced captures are under `docs/store-evidence/americaneagle/`.
Fixtures under `test/fixtures/retailers/americaneagle/` retain their actual DOM;
product structured data was captured separately and rejoined for replay.
Both promoted product capsules passed the standard sanitizer/privacy scan
without exceptions and replay successfully through source and packaged code.

## Integration and verification

The lane includes host permissions, plain-link child-SKU resolution, catalog
and TrackaLacker identities, attribution, notifications, diagnostic ingestion,
repair replay, qualification, readiness, device capabilities, job leasing,
shopper setup and admin activation. SQLite and PostgreSQL reject unsupported
fulfillment during execution. Existing private workspaces receive missing
disabled store policies through a general backfill that preserves saved
configuration.

Source tests cover both real products, stale authorizations, changed bindings,
ambiguous evidence, exact cart deltas, line totals, unrelated item preservation,
qualification, permissions and leasing. Chromium tests cover the compiled
runner and both setup screens.

## Final validation and local release

- The broad application run exercised 1,067 tests: 1,048 passed and 19 failed.
  All 19 failures have passing targeted reruns after correcting integration
  mistakes and stale UI/store-count expectations. A separate asynchronous
  cart-runtime test now uses controlled timers to avoid CPU-load flakes while
  still checking serial reads, rejection, deadlines, and ignored late results.
- The final adapter/integration/replay group passed 15 tests, the latest popup
  and PostgreSQL contract group passed 32, and both AE promoted capsules replayed
  through source and packaged code. AE Chromium runner and setup tests passed;
  the Anine Bing, Pokémon Center and Best Buy browser regressions also passed.
- `npm run check`, `npm run build:types`, and `npm run package:extension` passed.
  Four release-feed tests passed, including exact archive/hash binding.
- The native PostgreSQL proof passed in 1,374 seconds. It includes AE
  qualification/activation, allowance persistence, missing-store rejection, and
  forced transaction rollback. It caught a redundant six-key settings limit;
  removing that limit preserves validation of required and permitted keys.
- `release/Yoink-Companion-1.25.0.zip` is 360,388 bytes. The AE, Anine Bing,
  Pokémon Center and Best Buy runners, background worker, registry and version
  map match the built files byte for byte. SHA-256:
  `8f14234822d5b7adcc6e9032808034a4c12e5751a4075f67019f22ba2b311356`.
- After restarting `yoink-local-api.service`, verification at
  `2026-09-06T10:45:47.621Z` found ready health, version 1.25.0, and a served ZIP
  matching that hash. AE reports Add v1 / observer v1. Best Buy retains Add v16 /
  observer v14; Pokémon Center retains Add v1 / observer v4. Read-only inspection
  of the actual `data/yoink.sqlite` database found zero qualification records
  for AE, Anine Bing, or Pokémon Center, so these lanes remain inactive.
