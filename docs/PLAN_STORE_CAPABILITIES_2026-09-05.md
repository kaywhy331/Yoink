# Store capabilities in plan editing

Continues SaaS finding YS-26 and fixes a reproduced loss of notification-only
store selections while editing a plan.

## Behavior

The editor shows supported store actions in plain text, with separate
readiness explicitly labeled **Saved plan**. A cart-capable store is not
presented as ready merely because it has an adapter. Paused plans, notification
plans, missing readiness, and setup blockers remain distinct. Setup links are
available for cart-capable stores before changing a notification plan to cart
mode, including stores not yet enabled in the plan.

Switching to cart mode excludes notification-only stores and explains the
effect next to each excluded store. Switching back to Notify only before
saving restores those stores' selections, prices, and fulfillment choices.
Both the action selector and **Switch to cart mode** use this behavior.
Previously unselected stores stay unselected.

This restoration lasts only within the current editor. Saving cart mode sends
the displayed disabled-store choices to the existing API. Reopening the plan
loads the saved choices and does not revive selections from a previous draft.
No store qualification, global pause, or saved plan changes before Save.

## Verification

Two real Chromium regression cases failed on the old implementation: both
cart-mode entry points left the previously selected notification-only store
unchecked after returning to Notify only. Both passed after the fix, together
with the nine existing store-setup acceptance cases.

Additional browser coverage checks the submitted selections for each saved
action, reopening after saving, supported-action copy, setup links on notify
plans, unchanged draft prices/Pickup choices, and phone layout. Save requests
use a synthetic fixture; these tests never authorize a retailer cart action.
All 34 affected copy, dashboard, and recovery checks pass. Final full Chromium
acceptance passes all 42 tests, including the four new plan-store cases and
the new delayed Return-to-plan case. Type checking and both lint gates pass;
phone screenshots were inspected and dialog overflow checks passed.

Acceptance also exposed a Return-to-plan race: a delayed plan request could
lose its destination when startup refreshed the route. The saved paused plan
was unchanged, but its dialog never opened. The handoff now publishes the
requested plan route before loading and preserves a matching pending request
when the route is refreshed. A deterministic delayed-response case reproduced
the prior failure. The existing stale-response test now deliberately navigates
away and back, rather than relying on a duplicate startup request, and still
requires that the older response cannot replace or close the newer detail.

Installed-companion acceptance and the broader store capability presentation
outside these plan controls remain separate work. This change does not claim
production readiness or completion of the overall product goal.
