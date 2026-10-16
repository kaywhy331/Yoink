# Readiness freshness contract

YOINK-02, October 16, 2026. The shared policy is `RETAILER_READINESS_POLICY` in
`packages/contracts/src/add-lanes.ts`; the extension registry bundles the same
values used by the server and dashboard.

| Evidence or work | Cadence / lifetime | Meaning |
| --- | --- | --- |
| Browser heartbeat and permission report | Health alarm every minute; current for 90 seconds | The matching paired browser recently reported its capabilities and Chrome store permissions. |
| Store sign-in evidence | Current for 30 minutes, with a current matching browser | The latest store check reported signed in, signed out, challenged, or unknown. It is an observation, not a guarantee that the account has remained unchanged. |
| Background warming | At most two eligible stores per cycle; each store at most once per 20 minutes | Read-only session/cart inspection, with a rotating cursor. Both successful and failed attempts consume the per-store interval. Retained cart tabs use the same limit. |
| Cart baseline | At most five minutes, and only until its recorded expiry | A short-lived cart snapshot. Extending sign-in freshness does not extend this proof. |
| Visible dashboard | Existing adaptive poll, normally 30 seconds (3–15 seconds during activity) | Refreshes the store list or open checklist from the read-only readiness endpoint. Hidden tabs resume on visibility; failed checklist refreshes show that the displayed checks may be out of date. |

With twelve packaged stores, two checks per one-minute cycle drain a complete
rotation in six health ticks. Normal eligible stores can be checked again in
roughly 20–26 minutes, leaving margin before the 30-minute sign-in expiry. This
assumes Chrome is awake, health calls succeed, and checks are not postponed by
active jobs, protected tabs, or manual challenges. There is no catch-up burst:
when work is delayed, evidence ages out and becomes unknown. Warming does not
leave additional cart tabs open to preserve apparent readiness.

## Permission and age

`accessibleRetailers` comes from the latest authenticated heartbeat, with its
server receipt time in `lastSeenAt`. A reported empty list means permission was
denied for every store. An absent report, including a Chrome permission API
failure, means unknown; a new heartbeat replaces the old report rather than
silently keeping a prior grant or denial. Pairing alone supplies no permission
evidence. A permission change appears on the next successful heartbeat and
dashboard refresh; permission is checked again before browser work.

The dashboard accepts permission only from an active, online browser on the
current extension version, with the store's current adapter and required
capabilities. When session evidence names a browser, permission must come from
that same browser. Another browser cannot lend its permission. Without a
session, the latest compatible browser may report permission, but sign-in
remains unverified. This does not authorize a cart action.

The API exposes `permissionEvidence` (granted, denied, or unknown; device ID,
receipt time and age in milliseconds) and `sessionEvidence` (freshness,
receipt time and age). The checklist renders each report's age. Missing,
malformed and future receipt times are unknown, including a one-millisecond
future value; future values have no valid nonnegative age. Device freshness is
inclusive through 90 seconds and session freshness through 30 minutes.
Revoked, offline or incompatible devices cannot make either check pass.
Unknown permission or sign-in prevents the dashboard from claiming cart adds
are ready, while preserving the user's store on/off choice.

## Opt-in and tab limits

Warming requires a connected, paired, compatible companion, explicit
`actionsPaused: false`, live mode, retailer actions enabled, the store's own
execution flag, and current Chrome host permission. It never requests host
permission or turns on actions. Saved control state takes precedence over a
queued caller's older state; it is reread between stores and after a cart tab
loads, so a new pause, store opt-out, incompatibility, or permission loss stops
the work. Concurrent requests coalesce and real action jobs have priority.

The warmer reuses eligible existing cart tabs without opening another, leaves
checkout/restock tabs alone, and does not replace a challenged tab redirected
away from the cart. A temporary background tab closes on success, failure or
access changes. A future persisted cadence timestamp is rebased to now and
waits the normal 20-minute interval, avoiding both an indefinite suppression
and a burst of replacement tabs after a clock rollback. Invalid cadence
timestamps allow one bounded attempt, which records a new valid timestamp.

Fresh signed-out/challenged evidence continues to defer an Add for the same
30-minute session lifetime; a subsequent signed-in report clears that blocker.
Unknown readiness is not proof of authorization. The existing job lease,
opt-in, fresh retailer offer/cart checks and final checkout validation still
decide execution. No purchase or checkout submission is added by this work,
and short notification text is unchanged.

## Verification and handoff

`test/store-setup.test.ts`, `test/store-setup-api.test.ts`,
`test/store-readiness-dashboard.test.ts`, `test/retailer-readiness-repository.test.ts`,
the session cases in `test/execution-repository.test.ts`, and the warming and
permission cases in `test/extension-runtime.test.ts` exercise this contract.
The YOINK-02 evidence receipt records exact commands, results and candidate
hashes. These checks use simulated Chrome, test databases and a DOM harness;
installed-extension, real retailer and phone acceptance remain separate work.
