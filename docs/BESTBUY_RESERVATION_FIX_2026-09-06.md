# Best Buy reservation handling · 1.22.7

This receipt covers gates present before Add. For queues that appear after the
click, see [Best Buy post-Add queues · 1.28.1](BESTBUY_POST_ADD_QUEUE_2026-09-06.md).

The two local captures in repair group `22b0e27c` belong to Best Buy's
high-velocity reservation layout for SKU 6669869. The page replaces the usual
selected Shipping/Pickup controls with a reservation message and available
locations. The previous detector only recognized demand dialogs and gates,
so both captures appeared to have a broken fulfillment binding and Shipping
selection kept trying a control that was absent.

## Change

- Recognize the visible reservation header, message and availability tile
  belonging to the exact page SKU within its fulfillment panel. Hidden panels,
  other products, merchandising content and passive demand badges do not
  trigger this rule.
- Report `interactive_high_demand` and show **Reservation required**, with
  instructions to complete Best Buy's steps in Chrome and inspect again.
  Shipping selection and Add preparation stop with `manual_action_required`;
  availability tiles never become selected fulfillment evidence.
- Keep ordinary Shipping selection, exact-offer verification and existing
  security/account/queue checks. The new path performs no clicks.
- Report interactive replay outcomes as needing a manual store step, separate
  from adapter failures. This does not mark an incident fixed or resolved,
  authorize an offer, or change store qualification.
- Publish Best Buy observer v14 / add v16 with the unchanged selector pack v2.
  The admin activation confirmation and companion bundles match those versions.

## Evidence and verification

Both original capture IDs (`cap_7f0b656cbc12430d8b3c9cd9da2eb393` and
`cap_35baf0c2cbc442aa82810c7ab32df0ec`) now replay in source and packaged modes
as `rejected / interactive_block / interactive_high_demand`, with no actionable
Add control. Their recorded failure remains unchanged; replay does not claim
to reproduce the obsolete fulfillment error or pass the offer.

A reduced fixture removes personal location and unrelated page content. Its
promoted capsule passed the privacy scan with no hits and no exceptions.
Observer and action regressions failed before the fix. Coverage includes
normal Shipping, passive badges, hidden/foreign/accessory panels, no-click
selection/rehearsal/preparation, popup guidance, and manual-step reporting
without incident closure or cart jobs. Real Chromium exercised the packaged
observer/action/popup modules on synthetic reservation and normal-offer pages.

Type checking and UI-token/selector-pack lint passed. The build passed, all
158 adapter checks passed, and all 182 targeted extension/runtime checks
passed. The Chromium test passed with the packaged modules. Packaging produced
`Yoink-Companion-1.22.7.zip`; its manifest, observer, action and popup modules
match the final workspace. Recheck output: 2 manual store steps, 0 adapter
failures, 0 replay errors, and no incident marked fixed or resolved by replay.

The full application suite passed all 1,034 tests (exit 0). The independent
native PostgreSQL proof was not rerun for this adapter/UI change; its earlier
passing result is recorded in the scheduling receipt.

`npm run release:local -- --no-package` rebuilt and restarted the local service
successfully. The live health endpoint reports ready, app 1.22.7, Best Buy
observer v14 and add v16. The live release descriptor advertises the ready
1.22.7 ZIP, and downloading it produces the same SHA-256 as the verified local
artifact: `fa7b14c0d1f3e98437fcff80dbd0fa9617a5f7d497d00cda0e35fd5bc00b1f08`.

No images were viewed. No live retailer reservation, queue or cart action was
performed. Installed-companion acceptance still requires a fresh page check;
the shopper completes Best Buy's reservation steps when that flow is present.
