# Yoink Companion

The checked-in Manifest V3 extension uses Yoink's local runtime profile and
pairs with the loopback control plane. The same reviewed source can be packaged
under an explicit production profile. Both profiles report an authenticated
readiness heartbeat, receive TrackaLacker Web Push,
support explicit inspection for thirteen exact retailers, run separate Target,
Walmart, Amazon, and Best Buy no-click qualification rehearsals, and executes
only those four independently activated guarded add-only contracts. Disney
Store, Ravensburger, Riot Games Merch, Books-A-Million, Fanatics, Kohl's,
Macy's, Premium Bandai, and Pokémon Center remain catalog/read-only
integrations. Amazon inspection
also validates one exact ASIN-bound offer token entirely in page memory. It has
no persistent content scripts, cookie API access,
notification interception, checkout, or order capability. Page access is
optional and is requested only from a user click.

Walmart Collectibles Draw has a separate explicit **Inspect drawings**
action. It works only on the exact draw hub and sends a bounded list of public
item IDs, titles, prices, seller classification, closing times, condition and
quantity limits, plus draw/Add-control state. The companion sends sanitized
runtime failures to the draw ledger immediately. It never calls Walmart's draw
preferences or entry endpoints, clicks Enter, or reads/stores account, address,
payment, membership, session, cookie, entry-token, or entry-status data.
Drawing entry remains manual because submitting one irrevocably authorizes an
automatic order and charge if Walmart selects the user; it is not covered by
the qualified Walmart add-only capability.

Premium Bandai unavailable-page shells and Pokémon Center Imperva challenge
frames fail as manual/security blocks. They clear inventory and offer fields
before the sanitized diagnostic is sent, so an access-control response cannot
be shared as an out-of-stock observation.

After an exact product identity and optional host permission are confirmed,
observer startup/runtime failures are reported immediately to the local repair
queue using only a stable reason code, observer version, exact retailer/SKU,
timestamp, and zero-valued structural counts. Raw Chrome errors, query-bearing
URLs, DOM, and page text are not sent. Identity failures and permission denials
remain entirely local.

Companion 0.48 extends the same privacy-bounded repair path to availability,
unit price, seller, fulfillment, and add control. Field semantics stay inside
the isolated observer. The service worker accepts only one locally unique
allowlisted structural landmark per field plus bounded counts; it independently
rejects wrong-field vocabulary, sensitive/dynamic values, unknown properties,
and Add controls that are not button-like. Observed page text and offer values
never enter the diagnostic repair payload.

Companion 0.49 packages a second fixed observer-recipe reader. After rooted
signature verification, it compares recipe output with authoritative packaged
evidence and exact-product structured/semantic page evidence. It reports only
field/state enums and counts under trial contract v2. A packaged conflict is
sent immediately so the server can kill distribution; raw values, recipe
selectors, DOM, URLs, and session/account context are not sent. The oracle
bundle has no network or mutation path and none of the four add-only runners
consume its output.

Companion 0.50 uses the same value-free trial-v2 payload. The server—not the
extension—stamps the signed recipe's lifecycle stage, deduplicates repeated
evidence by authenticated tenant contributor/SKU/layout/stage, and assigns a
stable 25% account cohort for canary delivery. Multiple Chrome devices for one
account cannot multiply its contributor quorum. No new page data, account
identifier, region, or recipe value is added to the browser receipt; recipe
field-fill and every mutation runner remain disconnected.

Companion 0.51 adds trial contract v3 for one narrower case: when the bundled
observer is missing a fixed field and the signed recipe exactly agrees with the
separate packaged structured-page oracle. Only the normalized public commerce
value may accompany the existing state receipt. Chrome independently rejects
extra fields, mismatched recovery sets, unsafe seller text, unbounded cents,
and unknown enums before transport; the server repeats those checks. Accepted
values enter an append-only server quarantine as `not_applied`. They do not
change the observation shown to the user and cannot reach any Add runner.

If that canonical diagnostic cannot reach the loopback server because of a
transient network, timeout/rate-limit, or server failure, companion 0.17.0 keeps
it in a paired-device-bound local outbox and retries on startup and the
one-minute health cycle. The outbox deduplicates exact events, holds at most 50,
expires after nine minutes, discards entries from a previous pairing, and never
stores the raw transport error. Permanent client rejection is not retried, and
server ingestion is idempotent for an exact duplicate request.

To load it for development:

1. Start Yoink with `npm run dev`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select this `apps/extension` directory.
4. Open Yoink → **Preferences** and create a one-time pairing code (or use
   **Connections** in the `/admin` control center).
5. Open the Yoink toolbar popup, enter the code, and choose **Pair browser**.

For a Target, Walmart, Amazon, or Best Buy qualification check:

1. Open an exact product page for the retailer.
2. Open the Yoink popup.
3. Choose **Inspect product** and approve that store's optional permission if
   Chrome requests it.
4. Review the concise sanitized result in-place, or choose **View details** for
   the bounded evidence summary.

To inspect Walmart drawings, open
`https://www.walmart.com/shop/collectibles/draw`, choose **Inspect
drawings**, and review the exact current cards in Yoink's Walmart drawings view
or `/admin` → Connections. This is observation only and performs no rehearsal
or entry.

The rehearsal runs the production offer verifier to its final click boundary,
then discards the authorization without clicking. After explicit activation in
Yoink, the background runner checks only the local job queue. For one qualified
Target, Walmart, Amazon, or Best Buy job it binds up to 25 existing
SKU-and-quantity lines, revalidates exact SKU, first-party seller, the saved
Shipping or Pickup choice, stock, and price, writes the add receipt,
clicks at most once, and verifies that only the authorized SKU increased by one
while every baseline quantity stayed unchanged. Walmart queues and other
interactive blocks stop before mutation. Amazon additionally requires one
unique offer token bound to the exact ASIN and control; it rechecks that token
without persisting or returning it. Buy Now remains disabled. Ambiguous
post-click results lock for review. Best Buy additionally requires an explicit
`Sold by Best Buy` label in the exact selected-fulfillment offer scope;
marketplace and high-demand queue layouts remain closed. Observer v8 can
read a bounded accessibility label inside that exact seller element, while an
explicit in-store-only product becomes manual/local evidence with unknown
global availability. The paired add runner is v8, and upgrading retires every
earlier Best Buy qualification.

The popup overflow can also offer **Share evidence** after the user enables
that retailer in Yoink's Community view and opens an eligible exact page. A
visible confirmation is still required, and sharing is never automatic. The
extension sends only IDs for a sanitized observation/diagnostic the server
already accepted; the server reconstructs the exact SKU, variant, seller,
fulfillment, location scope, price, and availability behind a one-use nonce.
No DOM, page text, screenshot, cookie, form value, account field, or offer token
is accepted. A local 60-second key gate and server rate/dedupe rules prevent
background flooding.

Promoted observer-only recipes are signed, expiring JSON data for five fixed
read-only fields. The extension pins a packaged public offline Ed25519 root,
verifies the complete root-signed intermediate manifest chain, permanent
revocations, active key, transparency checkpoint, recipe signature, and strict
selector schema, then evaluates it only in a packaged isolated interpreter. It
persists the latest generation/checkpoint against rollback and reports selector
counts/agreement plus a sanitized layout fingerprint—not extracted values.
Invalid root or recipe signatures, expiry, revoked keys, broken rotations,
rollback, or schema violations fail closed and leave the bundled observer
authoritative.

For TrackaLacker:

1. Sign in to TrackaLacker in the same Chrome profile.
2. Open the Yoink popup and choose **Reconnect** when signals need attention.
3. Optionally choose **Sync products** from the overflow menu for one bounded
   catalog pass.

Enrollment uses the page's legitimate cookies and runtime CSRF token only in a
MAIN-world same-origin request. The real subscription endpoint, p256dh, and auth
key are never hardcoded, logged, or stored. The durable signal queue contains
only sanitized notification text and exact public product/listing identities.
The library pass includes unavailable and unsupported-store records and never
becomes a recurring stock watcher.

Chrome 121+ uses a silent companion subscription so the ordinary TrackaLacker
browser alert remains visible. If the runtime requires a visible fallback, the
popup reports that an additional alert can appear; signal and action dedupe are
still enforced by Yoink.

For a local source update, build `npm run package:extension` from the repository
and choose **Check for updates** in the popup overflow. A newer exact-version ZIP is
downloaded only when its filename, size, and SHA-256 metadata validate. Because
Chrome does not let an unpacked extension overwrite its own directory, extract
the ZIP over the same folder and reload it on `chrome://extensions`. Chrome
storage preserves the pairing and bridge state.

The popup is a single context-aware action surface. Its header summarizes
health; clicking it reveals browser, TrackaLacker, action-mode, store-access,
and last-check details. Exact retailer pages expose one **Inspect product**
action, Walmart Draw exposes **Inspect drawings**, and healthy idle pages expose
no invented primary action. One secondary activity row carries the highest
priority background state. Secondary controls live in overflow, while the
extension action context menu is limited to Open Yoink, the exact current-page
action when eligible, Reconnect when needed, Sync products, and Settings. Every
context-menu selection revalidates the current tab and health before work
starts; its visible label is never treated as authorization.

For a production artifact, set exact non-loopback HTTPS origins and run:

```bash
YOINK_EXTENSION_API_ORIGIN=https://api.yoink.example \
YOINK_EXTENSION_APP_ORIGIN=https://app.yoink.example \
npm run package:extension:production
```

The generated production archive has only the configured API host permission,
opens only the configured app origin, reports its production transport profile,
and delegates updates to Chrome's managed release channel. It cannot query or
open the local unpacked-ZIP feed. Hosted Yoink must separately pin the final
package ID with `YOINK_HOSTED_EXTENSION_ORIGINS`; packaging does not publish or
assign that ID.

Periodic requests remain restricted to the single package-owned control-plane
origin: loopback in the local profile or exact HTTPS in production. They cover
health, heartbeat, notification, durable signal-drain, and qualified-job checks
and do not poll TrackaLacker or any retailer.
