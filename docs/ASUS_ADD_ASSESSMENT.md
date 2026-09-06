# ASUS cart support

`asus-add-v1` now includes the product adapter, guarded runner, application
registration, host permissions, qualification, readiness, permission-filtered
job leasing, shopper/admin setup and replay integration. Two live products
passed compiled-runner Add and cart verification. Release 1.26.0 is built, packaged, deployed and verified. Installation
does not activate the lane; the actual running database has zero ASUS
qualification records and execution remains disabled.

| Product | Part number | Price | Compiled-runner verification |
| --- | --- | --- | --- |
| ROG Harpe Mini Core | `90MP04D0-BMAA02` | $44.99 | Added one to an empty cart at 10:50 UTC |
| ROG Scabbard II Arctic Gray XXL | `90MP03H0-BPAA00` | $49.99 | Added one while preserving the mouse at one, 10:51 UTC |

Both rehearsals performed no clicks. Each prepared authorization committed
once; duplicate commits returned `authorization_missing`. Cart verification
used the same-origin, read-only ASUS US cart-section endpoint and required an
exact +1 for the intended part number with unchanged unrelated quantities.
Proof is in `docs/store-evidence/asus/compiled-runner-2026-09-06.json`.

## Assessed scope and evidence

The first scope is simple, unbundled, in-stock ASUS US products whose URLs
contain a fixed part number. Configurable products, bundles, addons, freebies,
preorders, subscriptions, and pickup are rejected. The adapter binds the part
number in the URL, product form and visible product text; numeric product ID
and native form action; quantity one; visible, attributed and metadata USD
prices; and shipping evidence. It checks the primary form's Add control and
ignores recommendation controls. Authorization expires after ten seconds and
rechecks the exact document, control, product root, job and offer fingerprint.

The native cart path is `https://eshop.asus.com/us/checkout/cart/`. Product Add
normally navigates there. Empty carts display **You have no items in your
shopping cart.** The fresh cart section at
`/us/customer/section/load/?sections=cart&force_new_section_timestamp=true`
returns a separate `summary_count`, item SKUs, quantities, types, flags, unit
prices and subtotal. No customer/profile sections are requested. The parser
rejects malformed, duplicate, omitted, conflicting or unsupported lines.

Earlier assessment clicks also tested mouse quantity one → two. The DOM row
then displayed $89.98 and `product_origin_price` was 89.98, while
`product_price_value` remained 44.99. The reader uses the latter unit-price
field. The independent summary count was three across two cart rows. These
three assessment units were removed; a fresh read at 10:46:50 UTC confirmed
zero items and subtotal zero before compiled-runner tests began.

## Validation and remaining integration

Six source adapter/runner tests passed, covering the two captured products,
changed bindings, authorization lifetime, exact deltas, malformed cart data,
failed requests and read-only endpoint scope. Nine shared browser-safety tests
passed, and `npm run check` passed. The live runner was compiled independently
to `/tmp/yoink-asus-action.js`; source is
`apps/extension/src/asus-action.ts` and
`packages/browser-adapters/src/asus.ts`.

Application integration now passes the two-product observation → qualification
→ activation → signal → permitted lease test in an isolated database, including
quantity-two, pickup and wrong-permission rejection. Existing-user policy
backfill preserves saved choices. Both sanitized product capsules pass source
and bundled replay, with no privacy-scan exceptions. Four Chromium checks
passed for ASUS and Pokémon Center runners/setup; Best Buy's reservation
regression also passed, using DOM only.

The broad application run exercised 1,082 tests: 1,069 passed, 13 failed.
All 13 have passing targeted reruns. The updates corrected registry/count
expectations and kept the static copy within its existing limit. Type and lint
checks passed. Both catalog URL predicates were executed in PostgreSQL through
PGlite, covering actual ASUS and American Eagle URLs and invalid alternatives.
The full native PostgreSQL proof passed in 1,154 seconds, including ASUS
qualification/activation, allowance persistence and direct execution of both
catalog URL predicates. Its first attempt found remaining policy-count
expectations; those were corrected before the successful complete rerun.

The final type/lint check and application build pass, including the standalone
Athleta reader. Packaging passed and rechecked the two existing repair
capsules: both need a manual store step, zero adapter failures or replay
errors. All 31 focused ASUS/Pokémon Center/Best Buy/release tests pass. The
latest ASUS capsules still replay identically through source and bundle.
The archive's runners, registry, version map and manifest match their built
files byte for byte.

Release 1.26.0 was verified running at `2026-09-06T12:06:04.100Z` after
restarting `yoink-local-api.service`. Initial startup exceeded the first
25-second health probe; the subsequent health, descriptor and download
verification passed. The served ZIP matches the local archive exactly:

- File: `release/Yoink-Companion-1.26.0.zip`
- Size: 376,509 bytes
- SHA-256: `0189f15b09647f913a8087693430c0f87fe9209c917f5975a441557e9e2b5c0e`
- Active runtime: ASUS Add v1 / observer v1; Best Buy Add v16 / observer v14;
  Pokémon Center Add v1 / observer v4.
- The service's open database is `data/yoink.sqlite`. Read-only queries found
  zero ASUS qualification records and `execution_supported=0`. No actual
  user lane was activated.

Both compiled-runner test items were removed through their exact cart-row
removal dialogs. At `2026-09-06T10:55:59.248Z` the compiled cart reader
verified a fresh empty baseline with zero lines. All ASUS test units are gone.
