# Pokémon Center cart support

Release 1.23.0 implements `pokemoncenter-add-v1`, with observer v4 and the
shared retailers selector pack v1. Pokémon Center now has an independent
qualification and activation flow, US shipping cart runner, and shopper setup.
Installation does not qualify or activate it.

## Behavior

The adapter requires the complete hyphenated SKU in both the product URL and
product DOM, one visible product-scoped Add control, a visible USD price,
quantity one within the displayed control limits, and shipping evidence.
Recommendation buttons cannot substitute for the product's Add control.
The official US storefront supplies the first-party identity; conflicting
seller evidence is rejected. Missing or ambiguous evidence stops the action.

The runner supports all five operations: no-click rehearsal, cart baseline,
preparation, commit, and cart verification. Authorization is single-use and
expires after ten seconds. Commit rechecks the document, job, product root,
control, price, quantity, variant selections, and security state. A changed
binding stops the click, even when the new price is below the saved cap.

Cart verification requires identifiable SKU/quantity/price rows and a separate
cart item count matching their summed quantities. An explicit empty-cart
message and zero count are required for an empty baseline. Success requires
exactly one additional unit of the intended SKU and unchanged quantities for
every other item. An ambiguous result goes to the existing manual-review flow;
the service worker does not repeat the Add after a recorded click.

This first version supports in-stock US shipping offers. Pickup, preorders,
subscriptions, non-USD offers, security challenges, queues, and unresolved
variants are unsupported. Checkout and order submission remain manual.

## Integration

The implementation includes device capability/version validation, authenticated
job leasing and optional-host filtering, qualification evidence and activation,
SQLite and PostgreSQL qualification wiring, store readiness/rechecks, shopper
cart handoff, and admin setup. Readiness and lease batches retain all five
stores. TrackaLacker recognizes both Pokémon Center and Pokemon Center names.

The historical `p7/pokemoncenter-add-dry-run` commit
`8596b64a38d45432dffc010e35bd83877269ddce` only proved registry/build integration:
its runner returned `unsupported_action` from every operation. The current
implementation extends that proof across the later app/runtime paths.

## Live validation still required

The inspected URL was:

https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder

It returned HTTP 200 containing an Imperva `/_Incapsula_Resource` frame with
**Additional security check is required** and hCaptcha frames. Product and cart
DOM could not be inspected beyond that challenge. No images were viewed and
no live Add, reservation, queue, or purchase action was taken.

The product/cart tests and promoted replay fixtures are explicitly synthetic.
They establish the implemented contract, not compatibility with every current
Pokémon Center layout or successful live cart qualification. Accessible live
product and cart evidence is still needed before declaring the lane live-ready.

In the local Companion, open an accessible product, complete any security check
manually, select **Inspect product**, and use **More options → Save this page
for a store repair** if the layout needs adjustment. Cart evidence is needed
separately; the current repair-page command is offered on product pages.

## Validation and local package — 2026-09-06

- `npm run check`, `npm run build:types`, and `npm run package:extension` passed.
- The full application run exercised 1,046 tests: 1,044 passed, with an API
  status-field expectation and release-notice terminology failing. Both were
  corrected. Rerunning the API/signal tests passed all 7 tests; rerunning the
  glossary/dashboard files passed all 19 tests.
- The final extension runtime checks passed both tests, covering the fifth
  lane in permission filtering and rechecks, read-only inspection, and
  preservation of the full Pokémon Center product path.
- Three Chromium tests passed: Pokémon Center's packaged cart runner and
  setup screens, plus the Best Buy reservation regression.
- `npm run test:postgres:native` passed its complete isolated PostgreSQL
  proof (about 13.5 minutes), including Pokémon Center qualification and
  activation, persistence of its optional allowance, and rejection of a
  settings payload missing a required historical store.
- All three synthetic Pokémon Center capsules replayed identically through
  source and packaged runners: successful shipping, unsupported quantity two,
  and a security challenge. Packaging rechecked the two existing local repair
  capsules: both require a manual store step, with zero adapter failures or
  replay errors.
- `release/Yoink-Companion-1.23.0.zip` includes `pokemoncenter-action.js`.
  The packaged runner, registry, version map, and Best Buy runner match the
  built files byte for byte. ZIP SHA-256:
  `03b18e4559ef341caf0ac4975c4ee095e42863003cf0f0bddec6873bc5f89f28`.
- After the successful build and checks, `yoink-local-api.service` was
  restarted. Health and the release descriptor report 1.23.0. The served
  download matches the local ZIP SHA-256; the package is 311,285 bytes.
  The running service reports Pokémon Center Add v1 / observer v4 and retains
  Best Buy Add v16 / observer v14. Its actual open database contains zero
  Pokémon Center qualification records, so the new lane remains inactive.
  The public health response omits activation flags; inactivity was verified
  directly against that database in read-only mode.

## Fresh check — 2026-09-06 12:12 UTC

The existing live product tab was reloaded without cache. Its Imperva frame
now says **Access denied / Error 15 / This request was blocked by our security
service**. No product DOM was available and no live cart mutation was attempted.
All 31 focused Pokémon Center, Best Buy, identity and release tests passed,
as did all three packaged Chromium runner/setup/reservation tests (text only).
The integrated Pokémon Center runner remains live-unverified and inactive.
Logs: `/tmp/yoink-pokemoncenter-resume-tests.log` and
`/tmp/yoink-pokemoncenter-resume-browser.log`.

## Resumed validation — 2026-09-06 13:20 UTC

The open live page still contains the same Error 15 denial from 12:12 UTC.
Its text accessibility tree was inspected; no product DOM or live Add was
available. All 31 focused Pokémon Center, Best Buy, identity and release tests
passed again against the current 1.27.0 workspace. Five Chromium tests passed,
covering the packaged Pokémon Center and Athleta runners/setup and Best Buy
reservation handling. Screenshots and traces were disabled. Logs:
`/tmp/yoink-pokemoncenter-resume2-tests.log` and
`/tmp/yoink-athleta-final-browser2.log`. The real local database still has zero
Pokémon Center qualification rows and execution remains disabled.
