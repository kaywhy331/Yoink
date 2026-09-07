# Best Buy waiting and verification alerts — 1.28.3

After a verified offer's Add control returns a successful click, the companion immediately publishes **Best Buy Add triggered**, a `WAIT` toolbar badge, and a persistent popup message. If Best Buy then presents account, SMS, security, or admission steps, the badge becomes `!`, the desktop notification requires attention, and the popup offers **Complete verification**. The shopper enters any SMS code in Best Buy's tab. The extension never reads or submits that code.

The popup's button and desktop notification focus the saved waiting tab, including a verification tab that entered its own queue. They do not navigate or refresh it. A changed tab or a receipt recovered across a full browser restart cannot focus an unrelated tab. Verification prompts can be inspected while the page still loads; cart validation waits for a complete page.

The popup and badge survive desktop notification failures and ordinary health refreshes. Notifications are grouped by waiting/needs-action state so polling does not repeatedly alert the shopper. The existing optional action-handoff sound setting applies. Persisted popup data contains only the job ID, SKU, reason, whether the runner acknowledged the click, attention state, and wait deadline. An uncertain click says **Checking Best Buy add**, not **Add triggered**.

The existing post-Add worker still preserves the original tab, never repeats Add, and requires the exact authorized +1 cart delta before **Cart ready**. Successful validation clears the waiting alert. Expiry, lost access, changed pages, and conflicting cart evidence clear the wait and retain the existing review handoff. Waiting remains bounded by the earliest job, offer-proof, or baseline expiry (at most five minutes, with five seconds reserved for handoff).

## Scope

This release covers queues and manual verification **after an allowed Add click**. It does not start an Add on a page already blocked by Best Buy's reservation panel before fulfillment is selected. That separate scope choice was asked during implementation and remained unanswered at release preparation. The saved high-velocity reservation fixture continues to require a manual store step. Seller, price, stock, fulfillment, and qualification checks before Add are unchanged. Add v18, observer v14, and selector pack v2 are unchanged.

The Best Buy product-page connection failure from the four-store audit remains unresolved. These changes do not claim a live reservation, SMS, or cart success. Automated actions remain paused, and this work performs no live Add, checkout, or purchase. No images or screenshots were used.

## Verification

- All **222 tests** passed across the extension worker, popup state, popup UI, and Best Buy action suites. Tests include waiting/SMS/cart transitions, one Add only, notification failure, health refresh, uncertain click, expiry/review cleanup, changed-tab rejection, and existing worker/browser restart recovery.
- All **three packaged Chromium checks** passed: immediate queue, delayed queue, manual SMS input left untouched, eventual exact cart proof, and the existing pre-Add reservation rejection. Screenshots, traces, and video were disabled.
- Type checking, UI-token and selector-pack lint, compiled app build, extension packaging, JavaScript syntax checks, and whitespace checks passed.
- Packaging replayed five retained repair capsules: two manual store steps, three existing failing captures, zero replay errors. These are not new live passes.

The first expanded test run found an unchanged Target test object receiving an unnecessary `injectImmediately: false` option. The option was restricted to Best Buy, and the final complete 222-test run passed. The full application/PostgreSQL suite was not repeated for this extension alert change.

Artifact: `release/Yoink-Companion-1.28.3.zip`. SHA-256: `d6bfb13522385e473e2c57ceacc341dcf128aa79cc3c1f759ca71f66b399db19`.

The [release verification receipt](evidence/bestbuy-wait-alerts-2026-09-06/verification.json) records packaged-file comparison, local health, installed-device version, and the paused state. The paired browser must load/reload 1.28.3 to use this alert behavior. Changes remain uncommitted and unpushed.
