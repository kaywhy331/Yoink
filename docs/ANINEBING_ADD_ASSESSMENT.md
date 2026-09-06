# Anine Bing cart support

Anine Bing has a dedicated US shipping Add runner (`aninebing-add-v1`) and
observer (`aninebing-observer-v1`). Its retailer identity is the selected
Shopify variant ID. Canonical links preserve the product handle and `variant`
query parameter. A product link without a variant can be inspected in Chrome
to resolve the selection from its actual form.

The adapter requires agreement between the selected form variant, product,
merchant SKU, Add button, visible USD price, and structured offer. It accepts
quantity one and rejects unavailable stock, preorders, app-exclusive items,
subscriptions, ambiguous selections, challenges, and modal interruptions.
Commit repeats these checks and consumes a ten-second, single-use authorization.

The cart reader makes a same-origin GET to `/cart.js` and parses its JSON data.
Verification requires exactly one additional unit of the intended variant,
unchanged quantities for other items, and an independent item count matching
the cart rows. The service worker bounds asynchronous reads, retries transient
results serially, and ignores completions received after its deadline.

## Live evidence — September 6, 2026

The source runner was compiled and injected into isolated guest context
`howl-aninebing`. Rehearsal and Add/cart verification succeeded on two products:

| Product | Variant | Price | Verified change |
| --- | --- | --- | --- |
| Anine Clutch — Tango Red | `41205281521736` | $450 | +1 |
| York Scarf Anine Bing — Tango Red | `41205281194056` | $150 | +1, clutch unchanged |

The reloaded cart showed two items and a $600 subtotal. Both test items were
then removed individually with the normal Remove item controls. At
08:31:46 UTC, a fresh cart read confirmed zero items. No checkout was submitted.
No images or screenshots were viewed.

Detailed proof is in `store-evidence/aninebing-2026-09-06.json`. Reduced live
product captures are under `test/fixtures/retailers/aninebing/`. Promoted repair
captures under `test/fixtures/capsules/aninebing/` pass through the standard
privacy sanitizer and replay successfully through source and packaged code.

## Integration and validation

The sixth Add lane is wired through device capabilities and optional host
permission filtering, observation and diagnostics, independent qualification
and activation, plan creation, signal handling, leasing, shopper setup, admin
setup, cart handoff, notifications, attribution, and catalog URL validation.
Installation does not activate the lane for a real user.

The packaged runner and setup screens passed Chromium checks, alongside
Pokémon Center and the Best Buy reservation regression (five tests total).
The integration test exercises both captured products through observation,
rehearsal, independent activation, readiness, plan creation, a browser signal,
and permission-filtered leasing. The complete application run exercised 1,054 tests: 1,042 passed and 12
failed during integration. All 12 failures were corrected and their affected
files passed on recheck (55 tests in the first group and 45 in the second).
Two new promoted-corpus tests exposed a missing Add version allowlist entry;
both passed after the diagnostic server switched to the lane registry.
Additional checks passed for asynchronous runtime reads and permissions (2),
all six TrackaLacker-to-job paths (1), and private-workspace upgrades (1).
The final type/lint check passed. Native PostgreSQL passed its full isolated
proof, including Anine Bing qualification and activation, optional store
allowances, and the expanded catalog/attribution boundaries (about 18.3 minutes).
Local release 1.24.0 was packaged and the service restarted successfully.
Health reports 1.24.0, with Best Buy Add v16 / observer v14 and Pokémon Center
Add v1 / observer v4 preserved. The served ZIP matches the local package and
its included runners, worker, observer, registry, and version map match the
built files byte for byte. ZIP size: 336,391 bytes; SHA-256:
`8a8c23e0f2fc7bcc6216d207d8e3466955ecb46568edd2e6ad4e86199eacf045`.
The actual running service database has no Anine Bing or Pokémon Center
qualification records, and both retailer execution flags remain zero.

Live compatibility is established for these two one-size products and their
observed layout. Other sizes and storefront layouts still need live evidence.
The complete 160-store Howl objective remains tracked in
`HOWL_STORE_IMPLEMENTATION.json`.
