# Four-store Add-to-cart audit — September 6, 2026

The audit found and fixed defects in cart completeness, Target authorization timing, and post-Add page preservation. Automated fixture coverage passes for all four retailers. **Live Add-to-cart verification is incomplete**: store access barriers and an unresolved Amazon guest-cart attempt prevent an honest all-products pass.

No screenshots or images were used. Tests used DOM/text, guest carts, and intercepted fixture pages. No checkout, purchases, challenge bypasses, or retailer activation were performed. Real-user execution remains paused.

## Every known product is accounted for

The inventory combines catalog listings, source candidates, observations, trials, diagnostics, exact-offer identities, saved capsules, and exact product references in tests and documents. Historical test identities remain distinguishable from catalog products. URL/SKU validation establishes identity syntax only.

| Retailer | Known identities | Catalog listings | Live identities inspected | Verified live Add and cleanup | Live identities unattempted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Best Buy | 226 | 200 | 1 | 0 | 225 |
| Target | 419 | 358 | 1 | 0 | 418 |
| Walmart | 483 | 458 | 1 | 0 | 482 |
| Amazon | 507 | 472 | 8 | 2 | 499 |
| Total | 1,635 | 1,488 | 11 | 2 | 1,624 |

The [product matrix as CSV](evidence/cart-audit-2026-09-06/product-results.csv) has one row for every identity, including actual live status, fixture cart coverage, provenance, and the reason live testing stopped. The [JSON matrix](evidence/cart-audit-2026-09-06/product-results.json) retains individual attempts and capsule/layout outcomes. It also lists **25 unresolved source references**. Every audit result maps to an inventory identity.

## Defects and corrections

1. **Best Buy and Amazon omitted visible cart rows with unreadable identities.** That allowed a partial cart to become a baseline or pass exact +1 verification. Both readers now count every recognized visible active row before validating identity. An unreadable row blocks verification. Before the fix, four new regressions failed; Target and Walmart already rejected the same condition.
2. **Amazon retained removed-item acknowledgements as active items.** A live removal left a `.sc-list-item` with `data-removed="true"`. The reader now excludes that acknowledgement while still requiring independent empty-cart evidence and rejecting unresolved active rows.
3. **Target could use expired authorization after changing fulfillment.** Fulfillment rebinding can await DOM updates for several seconds. Final validation now includes that elapsed time and rechecks both job expiry and page authorization expiry before Add. The regression advances time during selection and requires zero Add clicks for either expiry.
4. **Target, Walmart, and Amazon unloaded the Add page to inspect cart.** A quiet DOM interval does not establish that the store's request has finished. Cart verification now uses a separate tab and preserves the product document. The verification tab is saved for worker recovery; cart handoff points to it. Receipt consumption and automatic retry locks remain in force. The regression reproduced same-tab navigation before the change and verifies separate-tab behavior afterward.
5. **A cart loaded before Add completed could remain stale.** After the bounded DOM wait, these three retailers now allow at most two read-only cart refreshes, only when a fresh complete baseline proves every item and quantity unchanged. Conflicts, unreadable rows, expiry, and store gates stop this path. The refresh count survives worker recovery and Add is never repeated. Tests reproduce the original false failure and verify delayed success, the refresh ceiling, and conflict rejection.

Best Buy's existing queue work remains included: preserve the original page, observe immediate or delayed queues without another Add, keep admission/account steps manual, verify cart separately, bound waiting by evidence/job freshness, and recover a durable receipt without reusing authorization. A reservation page before Add remains a store step. This audit does **not** qualify an unknown offer such as SKU 6685080 by relaxing seller, shipping, reservation, or no-click requirements.

## What was tested

- **36 packaged Chromium product-layout cases**, covering every plain product HTML fixture for the four stores plus selected Pickup cases. Eligible cases rehearse with zero Add clicks, commit once, and reject a duplicate commit. Negative layouts must reject. Target's static fulfillment fixture simulates the store's selection render explicitly.
- **Four packaged cart fixtures**, one per retailer, prove an exact +1 delta and reject both an unreadable additional row and quantity 2. These use the fixtures' existing identities; catalog SKUs were not substituted into a generic page.
- **20 saved capsule replays** compare source and packaged observations/rehearsals: zero parity differences, five successful rehearsals, 13 guarded rejections, and two understood diagnostic failures. The Target selector-miss fixture is intentionally negative. Target SKU 89157414's failed capture contains a visible price placeholder and hidden price nodes; a separate hydrated capture passes. Hidden prices were not made actionable.
- **Three additional packaged Best Buy browser tests** cover immediate queue, delayed queue, manual admission, eventual exact cart proof, no duplicate Add, and pre-Add reservation rejection.
- Action and worker regressions cover exact identity, seller, price caps, quantity, stock, fulfillment, changed controls/offer tokens, consumed authorization, baseline reuse, bounded draining, uncertain mutation, and worker recovery. The full application suite, type check, selector-pack checks, and local build are recorded in the final verification receipt. Two scheduling-sensitive tests were stabilized by controlling timers or asserting the actual requested recheck interval rather than measuring CPU load and database fixture construction.

Fixture clicks and cart proofs validate the retained layouts and runners. They do not establish that every catalog product is currently available or can be added on a live store.

The source review followed the entire execution path. Preparation binds the exact product, selected offer, allowed seller, unit cap, stock and fulfillment. Commit consumes the page authorization before mutation and revalidates the bound control; Amazon additionally checks the ephemeral offer binding. The worker acknowledges the durable Add receipt before invoking commit and locks uncertain mutations against automatic retry. Cart verification checks every recognized active row, requires exactly +1 for the authorized SKU, and preserves all baseline quantities. When a cart omits price or seller, the shared verifier uses the fresh pre-Add proof; explicitly conflicting cart evidence still rejects. This fallback is part of the existing contract, not independent live seller confirmation in every cart layout.

## Live findings and limits

**Best Buy:** SKU 6667316 failed to load with `net::ERR_HTTP2_PROTOCOL_ERROR`; the retained modern product URL also failed in the same audit context. No live Add occurred. Queue coverage is automated fixture evidence; the live queue has not been certified by this audit.

**Target:** SKU 13331333 loaded, then displayed a visible full-page `px-captcha-modal` iframe. Packaged rehearsal rejected with `manual_action_required`. No Add occurred.

**Walmart:** SKU 803927017 redirected to `/blocked` with “Robot or human?” No Add occurred.

**Amazon:** ASIN B00000IV34, SET card game, was sold by Amazon.com at $12.99. An empty baseline was captured, one packaged v10 Add clicked, exact ASIN/quantity +1 proof passed, and an independent DOM read confirmed the row. Only that test item was deleted; a reloaded cart independently verified empty. This live proof predates the v11 bundle and remains recorded with its original version. After local deployment, packaged **v11** also added Bicycle cards **B000BUUTJ6** sold by Amazon.com for **$5.64** in the original guest context. Exact +1 proof and an independent active-row read passed; a scoped Delete followed by a reloaded empty-cart proof confirmed cleanup. Page navigation timed out while the DOM was usable, so this outcome relies on explicit cart evidence, not navigation completion.

A later batch inspected eight Amazon identities. Its first seven observations were unknown/missing-control states sampled too early, so the matrix labels them `loading_or_unknown`, not proven unavailable. ASIN B08DJ7BM11 passed rehearsal and returned `clicked`, but exact cart verification failed and the independent active-row read was empty. **That Add outcome and cleanup are unverified.** The original runner then closed its temporary nonpersistent context; retained state cannot recover that guest cart. The batch remains stopped and will not repeat the Add. The script now retains a private persistent profile for future recovery, waits for loading evidence, records HTTP barriers, and refuses resumption after unresolved mutation or a recorded store stop.

Normal store access must be restored before the remaining live products can be tested. The unresolved Amazon attempt needs manual disposition; its cleanup must not be asserted from another browser context. No fixture result or syntactically valid URL replaces those missing live checks.

## Connection follow-up

The remaining Best Buy connection error is **unresolved**. It reproduces outside Yoink: ordinary Chromium 145 reports `ERR_HTTP2_PROTOCOL_ERROR` on the product document, curl over HTTP/2 reports a stream error with no response bytes, and both curl and a disposable Chromium restricted to HTTP/1.1 time out without a verified usable product document. Disabling HTTP/2 is therefore not a verified fix; no permanent browser or network settings were changed.

The existing audit browser loaded Best Buy's homepage and SKU search with HTTP 200. Best Buy's own search for 6667316 then redirected to `/product/disney-lorcana-winterspell-playmat-dragon-fire/CJ6QGKQ8QQ/sku/6667316`, whose document failed with the same HTTP/2 error. Both legacy and retained modern product URLs failed. A separate HTTPS control, `https://example.com/`, returned HTTP 200 over HTTP/2. DNS and TLS succeeded. This isolates a Best Buy connection failure from this environment, but does not establish a retailer-wide outage or prove filtering as its cause. No queue or usable offer was reached.

The follow-up independently confirmed local API version 1.28.2, database readiness, and a healthy running background worker. The paired active device last reported **extension 1.28.1** at `2026-09-06T23:33:19.453Z`; server packaging alone has not updated that installed browser extension. Load the 1.28.2 companion package into the paired browser using the existing installation instructions, then verify its displayed version. This supplies the audited cart fixes; it is not a claim that the update repairs Best Buy transport errors. Automated actions remain paused (`actions_paused = 1`).

The outstanding diagnostic is whether the exact Best Buy product opens in the user's regular Chrome session. If it does, use that paired browser for fresh DOM capture and no-click rehearsal after updating the companion. If it also fails there, store access must recover before live product testing can continue. Target's visible security challenge and Walmart's “Robot or human?” page remain separate access barriers. No challenges were bypassed and no Add was repeated during this connection investigation.

The [connection evidence](evidence/cart-audit-2026-09-06/connection-results.json) retains the disposable-browser results and distinguishes current local checks from the preceding connection probes. No runtime fix or new live Add success is claimed by this follow-up.

## Reproduction and release

Read-only inventory: `node --import tsx scripts/audit-cart-products.mjs`.

Saved evidence replay: `node --import tsx scripts/audit-cart-replay.mjs`.

Intercepted Chrome fixture audit: `node --import tsx scripts/audit-cart-browser.mjs`.

Result matrix: `node scripts/report-cart-audit.mjs`.

`scripts/audit-amazon-live.mjs` is a guest-cart mutation command, not part of normal tests. Its existing report blocks rerunning until the unresolved attempt is reviewed. Its private browser profile belongs under ignored `data/`, never in a report or commit.

Release 1.28.2 packages Target Add v10, Walmart Add v10, Amazon Add v11, and Best Buy Add v18. Observer versions are unchanged. Updated action contracts require current qualifications; execution is not enabled by this release. The companion must be reloaded to use the new code. Working changes remain uncommitted and unpushed.

The [verification receipt](evidence/cart-audit-2026-09-06/verification-results.json) records the initial 1,149-test application run (1,147 passed, two failures subsequently addressed), the passing 159-test worker and nine-test availability reruns, type/lint/build results, and tested file hashes. A second uninterrupted full-suite run was not performed. The [local release receipt](evidence/cart-audit-2026-09-06/local-release.json) confirms service 1.28.2 and a matching download/archive hash. Startup took longer than the initial health window and was verified once ready.
