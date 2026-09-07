# Best Buy post-Add queues · 1.28.1

Best Buy Add v17 preserves the page where Add was clicked. Previously, the
worker waited at most 1.5 seconds for page settling and then navigated that
same tab to `/cart`, which could interrupt a queue appearing after the click.
Observer v14 and selector pack v2 are unchanged.

## Behavior

- Persist the at-most-once receipt before Add. Poll the original page without
  clicking, refreshing or navigating it. Detect visible queue messages,
  SKU-scoped “Please Wait” controls and queue routes such as `/qp`.
- Leave account, verification and admission steps to the shopper. An account
  dialog takes precedence over a lingering “Please Wait” button. Notifications
  focus the tab that needs attention without changing its URL.
- Check cart in a separate inactive tab when the original page permits it.
  If that tab enters or redirects into a queue, preserve it too. Recheck the
  original page before publishing success, including queues that appear late.
- Require the exact authorized +1 quantity change with the baseline quantities
  preserved. A fully observed, unchanged cart remains pending; conflicting
  items or quantities require review. A click or queue admission alone never
  means “Cart ready.”
- Never click Add again for the job, including when admission exposes a second
  Add button or the first click destroys its execution context.

## Bounds and recovery

The worker polls every two seconds while running. The existing 30-second alarm
resumes observation after worker suspension. It heartbeats the lease every
15 seconds and refreshes an ordinary verification cart no more frequently than
every 10 seconds. It does not refresh a page observed in a queue or manual step.

Waiting ends before the earliest original job expiry, cart-baseline expiry or
offer-proof expiry. Evidence is valid for at most five minutes; the worker
reserves five seconds for handoff. A long Best Buy queue can therefore outlast
automatic observation. The browser tab stays open and automatic retry remains
locked for review. Waiting does not extend authorization.

The receipt survives worker suspension in session storage and is also saved
in trusted local extension storage with its page authorization removed. A full
browser restart invalidates the saved tab IDs: recovery opens Activity for
review rather than touching an unrelated tab with a reused ID. Closed tabs,
navigation away, permission loss, lease failures and cart conflicts stop
automatic handling without repeating Add.

## Validation and live limitation

Source and worker regressions cover immediate and delayed queues, manual
admission, a pending cart followed by an exact delta, conflicting deltas,
secondary cart queues and redirects, deadlines, lost access/leases, worker
recovery and a full browser restart. Chromium exercises the packaged runner
against synthetic product and cart responses, including one-shot Add and
account dialogs. Screenshots, traces and video are disabled for these tests.

Type checking, UI-token/selector-pack lint, extension and app builds passed.
All three Chromium checks passed. The application suite completed 1,135 tests:
1,134 passed and one old worker assertion still expected cart navigation to
overlap the heartbeat. After updating that assertion to require the post-Add
queue probe first, the entire 155-test worker suite passed. The independent
native PostgreSQL proof was not rerun for this browser-only change.

Packaging rechecked both saved reservation capsules: two manual store steps,
zero replay errors or adapter failures. The 1.28.1 archive's manifest and six
key worker/runner/registry/UI modules match the workspace byte for byte.

The local service was restarted and reports ready on 1.28.1, with Best Buy
Add v17 / observer v14. Its release descriptor advertises the ready ZIP and
the downloaded bytes match the verified local archive, SHA-256
`ff6a4db3a14be47674c728a31d93110c00598d41a49a069dda3413669a39712e`.
Post-release database checks confirm actions remain paused and there are zero
active Add qualifications. Changes remain uncommitted and were not pushed.

The live assessment of the previously observed Lorcana product URL failed with
`net::ERR_HTTP2_PROTOCOL_ERROR` on both attempts. No live Add, queue admission,
checkout or purchase occurred. This release implements and tests queue
handling; it does not establish live Best Buy queue acceptance or complete
live retailer readiness. Real-user execution lanes remain inactive.
