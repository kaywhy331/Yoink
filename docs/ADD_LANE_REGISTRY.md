# Guarded add-lane registry

`packages/contracts/src/add-lanes.ts` is the source of truth for guarded add
lane identity, packaged versions, runner operations, capabilities, activation
confirmation, seller policy, and operator guidance. The API, local
qualification repository, PostgreSQL non-Target qualification writer, and
Chrome companion consume that registry. The four store-specific API and
message URLs remain compatibility aliases for one release; they dispatch to
the same parameterized paths.

Selector packs remain local build inputs. They are bundled into the companion
and are never obtained from a remote endpoint. Adding a lane must not add a
database table.

## Pokémon Center implementation

Release 1.23.0 registers `pokemoncenter-add-v1` with observer v4 and the shared
retailers pack v1. The implementation includes product/cart evidence binding,
all five runner operations, device capability validation, job leasing,
qualification/readiness, and shopper/admin setup. It extends the historical
dry run below; that eight-file proof did not cover all later runtime paths.
The lane remains subject to independent live qualification and activation.
See `docs/POKEMONCENTER_ADD_ASSESSMENT.md` for validation and remaining live evidence.

## Anine Bing implementation

Release 1.24.0 adds Anine Bing with observer v1, Add v1, and shared retailers
pack v1. Variant identity is resolved from the product form and preserved in
canonical URLs. Its asynchronous cart reader uses same-origin GET requests;
the worker enforces a bounded deadline and serial retries. Two live product
Add/cart tests passed in an isolated guest cart, and the test items were
removed. See `docs/ANINEBING_ADD_ASSESSMENT.md` for validation details.

The diagnostic server now obtains Add versions from the registry, so a newly
registered runner can submit its repair/rehearsal diagnostics without another
version allowlist. Store-specific identity checks remain independent.

## Fifth-store dry run (historical)

The proof branch is `p7/pokemoncenter-add-dry-run` at
`8596b64a38d45432dffc010e35bd83877269ddce`. Its commit changes exactly the
eight paths below and passes the registry build plus promoted-corpus tests.
Pokémon Center is used
because its read-only adapter, selector pack entry, and optional host
permission already exist. Promoting it to guarded add therefore changes the
following eight files:

1. `packages/contracts/src/add-lanes.ts`
2. `apps/extension/src/pokemoncenter-action.ts`
3. `test/fixtures/capsules/pokemoncenter/first-party-shipping.json`
4. `test/fixtures/capsules/pokemoncenter/first-party-shipping.html.gz`
5. `test/fixtures/capsules/pokemoncenter/unavailable.json`
6. `test/fixtures/capsules/pokemoncenter/unavailable.html.gz`
7. `test/fixtures/capsules/pokemoncenter/third-party.json`
8. `test/fixtures/capsules/pokemoncenter/third-party.html.gz`

The registry-driven build discovers the runner and the packager includes only
registered runner files. Generated `apps/extension/add-lanes.js`,
`adapter-versions.js`, and `pokemoncenter-action.js` outputs are build
artifacts, not hand-edited onboarding surfaces. The dry-run branch does not
ship the lane; it demonstrates the integration budget and keeps live
activation closed.

## American Eagle implementation

Release 1.25.0 adds `americaneagle-add-v1` and observer v1 with the shared
retailers pack. Product identity uses the selected ten-digit child SKU and
preserves its style/color URL plus `?sku=<child>`; that query constrains the
identity and does not select another size. Only verified One Size layouts
are currently executable. The full qualification, device, job, catalog and
shopper setup paths are integrated. See `docs/AMERICANEAGLE_ADD_ASSESSMENT.md`.

## ASUS implementation

Release 1.26.0 adds `asus-add-v1` and observer v1 with the shared retailers
pack. Simple US products require a fixed part number, quantity one, and
agreeing USD prices. A read-only cart-section request verifies the exact
quantity change. Registration does not activate the lane; qualification and
activation remain independent. See [assessment and live evidence](ASUS_ADD_ASSESSMENT.md).

## Athleta implementation

Release 1.27.0 adds `athleta-add-v1` and observer v1 using the shared retailers
pack. It supports the full thirteen-digit One Size child SKU on
`athleta.gap.com/browse/product.do?pid=...`, with US shipping selected.
The secure bag uses a separate host, `secure-athleta.gap.com`; the registry
explicitly lists both page hosts, and leasing requires both optional origins.
Qualification, catalog/attribution, readiness, shopper/admin setup and cart
handoff are independent. Query-free repair capsules rejoin the validated SKU
for replay; current radio and quantity selections survive serialization.
See [assessment and live evidence](ATHLETA_ADD_ASSESSMENT.md).

## Audio Advice and Banana stores — 1.28.0 validation

Audio Advice, Banana Republic, and Banana Republic Factory bring the registry
to twelve guarded Add lanes and twenty catalog stores. Each uses its own
live-assessed observer and Add v1 runner. Audio Advice binds the selected
Shopify variant and reads fresh cart JSON; the Banana stores bind One Size
child SKUs and their separate secure shopping bags. Both exact optional origins
are required for the Banana stores. Qualification, store setup, capabilities,
leases, replay and packaging are integrated. Six promoted product captures pass
source replay and privacy scans, and six Chromium runner/setup tests pass.
Final application/native PostgreSQL and local release validation is in progress.
