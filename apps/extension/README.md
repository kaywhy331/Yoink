# Yoink Companion

The checked-in Manifest V3 extension uses Yoink's local runtime profile and
pairs with the loopback control plane. The same reviewed source can be packaged
under an explicit production profile. Both profiles report an authenticated
readiness heartbeat, receive TrackaLacker Web Push,
support explicit inspection for twenty supported stores, run separate Target,
Walmart, Amazon, Best Buy, Pokémon Center, Anine Bing, American Eagle, ASUS, Athleta, Audio Advice, Banana Republic, and Banana Republic Factory no-click qualification rehearsals, and execute
only those twelve independently activated guarded add-only contracts. Disney
Store, Ravensburger, Riot Games Merch, Books-A-Million, Fanatics, Kohl's,
Macy's and Premium Bandai remain catalog-only
sources. Amazon inspection
also validates one exact ASIN-bound offer token entirely in page memory. It has
no persistent content scripts, cookie API access,
notification interception, checkout, or order capability. Page access is
optional and is requested only from a user click.

Athleta `athleta-add-v1` supports exact One Size child SKUs with quantity one,
current USD prices and shipping selected. Both `athleta.gap.com` and
`secure-athleta.gap.com` permissions are required. The cart reader uses exact
SKU rows, current unit prices and an independent bag count. Other sizes and
pickup are unsupported. See `docs/ATHLETA_ADD_ASSESSMENT.md`.

ASUS `asus-add-v1` supports simple US products with a fixed part number,
quantity one, and matching USD prices. Configurations, bundles, extras,
preorders, and pickup are unsupported. The cart reader checks the fresh
cart section for an exact +1 while preserving unrelated quantities.
See `docs/ASUS_ADD_ASSESSMENT.md`.

American Eagle `americaneagle-add-v1` supports One Size products on the US
storefront. The child SKU, style/color, visible price, quantity and selected
size must agree before Add. Cart rows bind the same child SKU and a separate
bag count; exact +1 verification preserves other quantities. Other sizes,
pickup, memberships, preorders and ambiguous layouts are unsupported.
See `docs/AMERICANEAGLE_ADD_ASSESSMENT.md`.

Anine Bing `aninebing-add-v1` binds the selected product-form variant to its
visible USD price and structured offer. It supports quantity-one US shipping
and verifies the cart using same-origin GET `/cart.js`. Cart reads have a
bounded deadline and never overlap retries. Two live guest-cart tests passed;
the items were removed after verification. Its setup and activation remain
independent. See `docs/ANINEBING_ADD_ASSESSMENT.md`.

Pokémon Center `pokemoncenter-add-v1` supports quantity-one US shipping.
It binds the complete page SKU to one Add control, visible USD price, selected
quantity, and shipping evidence. Commit rechecks the document, job, control,
price, and variant choices. Cart verification requires a separate item count,
complete SKU/quantity/price rows, and exactly one added unit with every prior
quantity unchanged. Preorders, security checks, queues, login gates, and
ambiguous layouts stop the flow. Live qualification is still required; the
initial implementation is covered by synthetic source and Chromium fixtures.

Best Buy defaults to Shipping: inspection, scheduled checks, and Shipping Add
preparation may select the exact offer's Shipping radio/tab and wait for the
updated page. Inspection still never clicks Add or Buy now. An unavailable
or unverified Shipping selection stops the flow without a Pickup fallback;
passive observers and saved-page capture do not change fulfillment.

Best Buy's **High Demand Product** reservation panels can show available
Shipping and Pickup locations without a selectable fulfillment control.
These offers show **Reservation required**. Complete Best Buy's reservation
or queue steps in the tab, then inspect again. Yoink does not click the
reservation flow's Add control or claim that a Shipping offer was verified.
Passive high-demand badges on otherwise verified offers remain supported.

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
queue using only a stable reason code, observer version, exact store/SKU,
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
4. Open Yoink › **Settings › Chrome** and create a one-time pairing code (or
   issue one from **Settings › Users** in `/admin`).
5. Open the Yoink toolbar popup, enter the code, and choose **Pair browser**.

For a Target, Walmart, Amazon, or Best Buy qualification check:

1. Open an exact product page for the store.
2. Open the Yoink popup.
3. Choose **Inspect product** and approve that store's optional permission if
   Chrome requests it.
4. Review the concise sanitized result in-place, or choose **View details** for
   the bounded evidence summary.

To inspect Walmart drawings, open
`https://www.walmart.com/shop/collectibles/draw`, choose **Inspect
drawings**, and review the exact current cards in Yoink's **Calls › Drawings**
view. This is observation only and performs no rehearsal
or entry.

Best Buy product links may end in a ten-character product code instead of a
numeric SKU. These pages offer **Inspect product**, including while store
actions are paused. After Best Buy page access is granted, the companion waits
up to eight seconds for the page's own SKU evidence. A missing or conflicting
SKU stops inspection with an explicit message. Observer v11 and add v12
revalidate the numeric identity during inspection and at the add boundary.

The rehearsal runs the production offer verifier to its final click boundary,
then discards the authorization without clicking. After explicit activation in
Yoink, the background runner checks only the local job queue. A cycle performs
one health, live/pause, optional store-access, and Chrome companion preflight, then
processes at most four freshly server-validated leases, one at a time. It
continues after a clean pre-click rejection but stops on any mutation-uncertain
or manual-review result. A Yoink-created tab may be reused only for the same
store during that cycle; different stores retain separate cart tabs. For
each qualified Target, Walmart, Amazon, or Best
Buy job the runner binds up to 25 existing
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

For a valid TrackaLacker push, Chrome starts durable call delivery and the
bounded 25-second action-job watch concurrently. The lease is still entirely
server-authoritative; opening the watch early only removes a serial network
round trip. The server wakes it as soon as durable evaluation yields an action,
before the rest of the in-process worker cycle finishes. Fresh ingress also
arms a 2.5-second call-only shared-database window at 250 ms for a separately
supervised worker, then returns to the one-second idle fallback. The recurring
30-second alarm remains a recovery path. After the server accepts ingress,
Chrome opens a parallel bounded notification watch on the same availability
pulse; notify-only results no longer wait for that alarm. Ready deliveries
drain through the full 20-item ingress-batch bound, while overlapping alarm and
call requests coalesce. Retryable or rejected receipts do not start the
watch. An in-stock drop-window observation uses the same shared job and
notification wake after its call is queued. Visible notification and status
updates do not delay the guarded-job handoff. A clean rejection before mutation may yield
to another queued job, but an uncertain result stops the bounded drain and no
click is retried. The server selects only currently qualified, session-eligible
lanes before queue ordering, so an older unavailable store cannot delay a later
eligible store. Qualification activation and retirement both wake the bounded
job watch immediately. Each lease request also advertises only the optional
store origins Chrome currently grants. The server treats this solely as a
narrowing hint beneath its authoritative Chrome companion and adapter checks, preserving
jobs for stores whose optional page access is not currently available.

Warm readiness rotates across two guarded stores per health cycle. A store
without a cart tab left open by an earlier add is checked in an inactive
background tab that closes again as soon as the sign-in and cart read finish,
and at most once every 20 minutes, so warming never leaves cart tabs open
between calls. Only a tab an add left open is kept for reuse, with a
privacy-bounded cart inventory for at most five minutes. If the
25-second priority job watch overlaps the health alarm, the warm request is
coalesced and runs immediately after job work settles instead of being dropped.
It never runs beside an active Add and never invokes a store mutation
operation. A fresh `signed_out` or `challenged` result from this exact Chrome
companion temporarily defers only that store's queued jobs; it does not consume them or block other
stores. Reporting a recovered session immediately wakes the bounded job watch.
When an exact store page finishes loading, Chrome coalesces one read-only
session recheck: a still-rendered challenge remains blocked, while a completed
sign-in or security check clears the stale blocker and resumes the preserved
job watch immediately. Unknown, stale, and prior-adapter session evidence
remains non-blocking.

Exact cart confirmation stores only a bounded local handoff, updates the
extension badge, and raises a Chrome **Cart ready** notification. The popup
shows the same state. Opening it revalidates and focuses the existing exact
store cart tab, acknowledges that one handoff, and never creates a checkout
or order action. A fresh, exact post-add cart inventory may become the next
same-lane job's in-memory baseline; ordinary post-click delta proof remains
mandatory. Bounded lease-to-cart and click-to-cart durations accompany the
sanitized evidence.

A separately qualified Walmart notify-only call can include a manual
**Buy at Walmart** notification handoff. Clicking it opens the exact,
expiry-bound review-order route, optionally through Howl with Yoink's `u1`
tracking ID. An invalid affiliate wrapper falls back to the raw Walmart route;
stale or invalid offer evidence opens the exact product page instead. Merely
receiving the notification never navigates to Walmart or changes the cart.
Until that call is opened or dismissed, the popup offers the same
one-use action. The review-order URL remains private to the service worker: the
popup receives only sanitized item identity and expiry, and the worker
revalidates and consumes the route before opening it. If the same handoff is
opened first from Home or Calls, the bounded notification watch removes its
local popup route and OS notification without navigating.

If no warm baseline exists, the exact product and an inactive temporary cart
tab load concurrently. The temporary tab performs only the allowlisted
read-only baseline inspection and closes before Add; the visible product tab
still waits for durable authorization, and the final exact cart-delta proof is
unchanged on every guarded store.

The popup overflow can also offer **Share evidence** after that store is
enabled for evidence sharing in Yoink and the user opens an eligible exact page. A
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
2. Open the Yoink popup and choose **Reconnect** when calls need attention.
3. Optionally choose **Sync products** from the overflow menu for one bounded
   catalog pass.

Enrollment uses the page's legitimate cookies and runtime CSRF token only in a
MAIN-world same-origin request. The real subscription endpoint, p256dh, and auth
key are never hardcoded, logged, or stored. The durable call queue contains
only sanitized notification text and exact public product/listing identities.
The library pass includes unavailable and unsupported-store records and never
becomes a recurring stock watcher.

Chrome 121+ uses a silent companion subscription so the ordinary TrackaLacker
browser alert remains visible. If the runtime requires a visible fallback, the
popup reports that an additional alert can appear; call and action dedupe are
still enforced by Yoink.

For a local source update, build `npm run package:extension` from the repository
and choose **Check for updates** in the popup overflow. A newer exact-version ZIP is
downloaded only when its filename, size, and SHA-256 metadata validate. Because
Chrome does not let an unpacked extension overwrite its own directory, extract
the ZIP over the same folder and reload it on `chrome://extensions`. Chrome
storage preserves the pairing and bridge state.

The popup is a single context-aware action surface. Its header summarizes
health; clicking it reveals browser, TrackaLacker, action-mode, store-access,
and last-check details. Exact store pages expose one **Inspect product**
action, Walmart Draw exposes **Inspect drawings**, and healthy idle pages expose
no invented primary action. One secondary activity row carries the highest
priority background state. Secondary controls live in overflow, while the
extension action context menu is limited to Open Yoink, the exact current-page
action when eligible, Reconnect when needed, Sync products, and Extension settings. Every
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
health, heartbeat, notification, durable call-drain, and qualified-job checks
and do not poll TrackaLacker or any store.
