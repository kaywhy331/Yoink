# TrackaLacker signals produced no cart actions

Read-only inspection of the running local Yoink database on September 6, 2026 (America/Los_Angeles), after the administrator resumed actions. No live signals were replayed and no purchase settings were changed.

## Findings

| Check | Observed state | Meaning |
| --- | --- | --- |
| Global actions | Live mode, actions not paused; most recent resume September 6 at 6:27 PM PDT (`2026-09-07T01:27:18.914Z`). | The global pause is lifted. |
| Latest received TrackaLacker signal | August 28 at 5:45 PM PDT (`2026-08-29T00:45:50.803Z`). | No new TrackaLacker signals reached this server after the recent resume. |
| Durable signal inbox | All 185 TrackaLacker entries processed. | There is no outstanding TrackaLacker queue or dead-letter backlog. |
| Active Chrome companion | Checking in, extension 1.28.2. | The paired device can reach the server; this does not prove TrackaLacker is sending push messages to its subscription. |
| Embedded worker | Running, version 1.28.3, recent heartbeat without an error. | The server worker is operating. |
| Active plans | All 31 use reviewed `notify` action ceilings. | A fresh matching signal can notify; it cannot create a cart action for these plans. |
| Saved Quick add setup | `add 1 to cart` exists, with quantity one and store-price mode. | Saving a setup does not apply it to existing plans. |
| Setup attachment | None of the 31 active plans has a Quick add profile attached. | These plans are not waiting for automatic price-based reconciliation of that cart setup. |
| Default rule | Enabled `Default catchall`, action `notify`. | This rule does not request cart actions either. |
| Historical jobs | All 148 jobs are `notify_only`, with action `notify`. | The history is consistent with notification-only configuration. |

There are two independent issues: no recent inbound TrackaLacker signals, and plans that currently authorize notification only. Turning on global actions changes neither source delivery nor a plan's action ceiling.

## Why “connected” is insufficient evidence

The Chrome companion posts its saved TrackaLacker registration state. `SourceRepository.recordTrackalackerPushStatus` uses that reported `ready` value to label the source connected. `trackalackerStatus()` also derives readiness from this value. The stored last-registration and last-notification timestamps can remain old while the companion continues checking in.

These records establish that no recent signal reached Yoink. They do not distinguish a disabled upstream notification destination, missing provider alerts, or a broken/changed Chrome push subscription. Inspecting and testing the subscription on the Windows PC is still required. Catalog/library sync is separate from receiving a push signal.

## Next verification

1. On the Windows PC, verify the Yoink Chrome device is enabled in TrackaLacker's notification settings and renew its registration if necessary.
2. Confirm a newly sent TrackaLacker alert appears in Yoink's Calls feed and advances the source's delivery time. A provider test notification should remain a dry run; it proves delivery, not cart execution.
3. In Plans, select the intended products, choose the saved `add 1 to cart` Quick add setup, and review **Apply setup**. Check the reported result for plans that still need price or store evidence.
4. Verify the intended plan now shows **Add to cart**, then follow a fresh matching alert through decision, job creation, and the Chrome handoff. Store qualification, price, seller, fulfillment, and quantity checks still apply. Previously processed alerts are not automatically replayed when actions resume.

## Validation

- Three focused signal-engine tests passed: reviewed cart plans, linked store-price profile reconciliation, and protection of reviewed notification-only plans.
- All nine TrackaLacker parser/enrollment/ingress tests passed.
- The guarded cart-trigger test passed for all six stores in its fixture.

These tests use isolated databases and simulated source/retailer evidence. They verify the engine's behavior; they do not verify live delivery from TrackaLacker to the user's Windows browser.
