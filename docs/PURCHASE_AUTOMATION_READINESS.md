# Purchase automation readiness

Yoink 0.45 gives each user purchase plan one authoritative answer to a simple
question: **what can this plan safely do right now?** The answer is an
explanatory read model. It cannot qualify a retailer, activate a lane, create a
job, reserve spend, or authorize a browser click.

## Inputs

The server derives readiness from current private state; the browser does not
submit or choose the result:

- active, paused, satisfied, archived, and expiry state;
- direct reviewed policy versus legacy advanced-strategy decision mode;
- enabled exact listing targets and their item cap, seller, fulfillment, and
  packaged-mapping state;
- the user's exact retailer adapter qualification and adapter version;
- active paired companions at the current Yoink release, including notification,
  reconciliation, and retailer-specific add-runner capabilities;
- connected non-manual signal sources;
- live versus shadow execution mode and the global action pause.

The projection contains no raw page data, offer token, selector, session state,
credential, pairing code, action capability, account data, or checkout data.

## Contract

`automationReadiness.contractVersion` is `1`. The API attaches it to purchase
intent list, detail, create, update, and overview responses. Its closed state
set distinguishes:

- plans that are inactive, expired, legacy-strategy controlled, or missing an
  enabled exact target;
- missing signal, missing/current-version companion, and offline companion;
- notification-ready plans;
- incomplete guarded policy, unqualified retailer lane, and missing matching
  add runner;
- shadow mode, global pause, and fully armed guarded add.

Each result includes a headline, a next safe step, bounded checks, and
per-enabled-target mapping/policy/qualification/capability facts. A mixed-store
plan can be armed for one target while another target remains closed.

`readyForMonitoring` and `readyForGuardedAdd` are separate. A closed mutation
lane does not prevent exact monitoring. `effectiveAutomation` is `none`,
`notification`, or `guarded_add`; it describes current configuration readiness,
not a current stock claim.

## Meaning of armed

“Guarded add is armed” means the static prerequisites are present. It does not
mean a product is currently available and it is not a promise that a click will
occur. A fresh event from a `trusted_exact` source may trigger the guarded page
check even when the source does not carry price, seller, or fulfillment. Those
missing fields are never filled in or treated as evidence; the immutable source
snapshot remains unknown. Informational sources, advanced strategies, and
notification-only plans cannot use this deferred check. At action time the
production runner must still prove all of the following from a fresh exact page:

1. exact retailer and item identity;
2. first-party seller;
3. exact saved Shipping or explicitly selected Pickup fulfillment;
4. numeric price within both item and all-in bounds;
5. quantity exactly one;
6. a complete bounded cart baseline and one unambiguous usable Add control;
7. current intent, offer snapshot, spend reservation, qualification, adapter,
   device, expiry, and one-use capability.

Any mismatch stops before mutation. Checkout, payment, drawing entry, Buy Now,
and order submission remain closed.

An explicit source conflict is not deferrable. A reported third-party seller,
the wrong fulfillment mode, an over-cap numeric price, a stale event, or an
inexact product identity is rejected before a cart job is leased.

After a click, Yoink accepts success only when every baseline SKU quantity is
unchanged and the authorized SKU increased by exactly one. This permits several
qualified items to accumulate for one manual retailer checkout without allowing
one job to alter or silently absorb another cart line.

## Quantity semantics

The plan's quantity is the user's overall desired amount. A guarded cart
attempt always adds exactly one item; Yoink never changes a retailer quantity
selector. Reviewed direct plans already evaluate one unit at a time. In live
mode, a legacy advanced strategy that requests a multi-unit add is converted to
a notification before spend reservation. Shadow mode preserves the requested
quantity so administrators can see and correct the legacy configuration
without making it executable.

The same pre-reservation boundary applies to retailer qualification. In live
mode, a matched add request for an unqualified retailer and adapter version is
converted to a notification before any spend reservation is created. This
keeps the engine's executable state aligned with the readiness projection;
qualification is not deferred until device leasing.

## User experience

The Products view labels three different facts accurately:

- **Monitor only** — no packaged add runner;
- **Packaged mapping · lane pending** — code exists, but separate qualification
  is not active for this user;
- **Qualified guarded add** — the user's adapter qualification is current.

The purchase setup dialog warns when a packaged runner is still pending
qualification. Saving such a plan is allowed so the user can establish limits
ahead of activation, but its plan card remains explicitly closed. The plan card
shows the server-derived status and an expandable “Why this status” checklist.
The five-step setup guide uses that same projection and cannot declare a guarded
setup ready from catalog metadata alone.

## Troubleshooting

When a plan is not armed, follow its displayed next step and checklist. Common
causes are an out-of-date or offline companion, a disconnected signal source,
an unqualified retailer, a missing item cap/first-party/shipping restriction,
shadow mode, or the global pause. Do not activate a retailer merely to clear a
user-facing warning; qualification still requires its current evidence dossier,
no-click production-runner rehearsal, and explicit activation contract.
