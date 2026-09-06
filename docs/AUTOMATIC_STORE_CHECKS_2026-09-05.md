# Automatic store-check scheduling

Completes the local scheduling and presentation work for SaaS finding YS-14.

## Behavior

The background runner and companion Settings use the same eligibility
calculation. Each store's wait starts at its own recorded result, so a later
check at another store cannot postpone it. Older records without a per-store
timestamp retain their existing last-run fallback.

Settings displays the last check, the next eligible time, and setup blockers
for each store. The summary includes the automatic daily count, its UTC reset
in the shopper's local time, and Chrome's next scheduled review when available.
Eligibility is distinct from an alarm: Chrome may delay the actual review.
The policy explanation is generated from the runtime's scheduling constants.

Manual checks bypass automatic waits and the daily limit. Turning automation
off prevents future automatic runs; an already-running check remains visible.
Refreshing the schedule is read-only. It neither requests store access nor
starts a check. Unavailable schedules offer refresh recovery and update when
the tab becomes visible or during its periodic refresh.

A regression test reproduced a race where Refresh schedule restored an old
enabled setting while a pause was still saving. Reads cannot now replace the
pending choice, unlock its toggle, or overwrite its progress message. Reads
started during that write are also discarded if they arrive after it finishes.

A second reproduced regression kept Settings stuck on a running background
check: disabling the manual button also disabled its periodic status refresh.
Polling now continues through background checks and transient status outages,
so a completed check becomes visible and manual checks become available again.
Local settings writes and requested manual checks retain their pending controls
and progress messages until their responses arrive.

## Verification

- Final type checking, UI-token and selector-pack checks, extension build,
  and TypeScript build passed.
- The existing 159 focused extension, packaging, copy and glossary checks
  passed. All seven final Settings tests passed. The pause and background
  completion regressions each failed against the prior implementation.
- All 43 Chromium journeys passed. The expanded scheduling journey passed
  again on the final implementation, covering the delayed pause, periodic
  completion refresh, phone overflow and desktop controls. No store access
  was requested and no check was started by the scheduling views.
- The full application run completed: 1,028 tests, 1,027 passed, 1 failed,
  exit 1. The unchanged Operations dashboard test exhausted its roughly
  one-second polling budget waiting for a schedule pause. It passed unchanged
  on an isolated rerun (1 test, 0 failures). This is consistent with timing
  sensitivity under contention; the aggregate run remains recorded as failed.
- The local companion ZIP was rebuilt successfully after the final changes.
  Packaging rechecked both existing repair captures: 2 still failing, 0 errors.
- The earlier isolated native PostgreSQL proof completed with 1 passing test,
  0 failures and exit 0. This continuation changes no database behavior.

No images were viewed during this continuation. The tests use synthetic
retailer responses. Installed-companion delivery, real Chrome alarm timing,
and hosted production acceptance remain unverified.

## Existing repair captures

The two Best Buy captures from 2026-09-05 16:30 UTC were replayed against the
packaged adapter. Both fail at fulfillment binding with
`fulfillment_binding_missing`; the recorded reason was
`fulfillment_unverified`, so exact reproduction is false. Their saved markup
contains availability tiles but no selected fulfillment control. This evidence
does not establish a selector repair or a passing Shipping offer. The
incidents remain unresolved pending suitable live evidence; this continuation
does not change the retailer adapter or the stored captures.

Follow-up: [1.22.7 reservation handling](BESTBUY_RESERVATION_FIX_2026-09-06.md)
identifies the exact reservation panel in these captures. Both now replay as
requiring a manual Best Buy step; the repair report separates that outcome
from adapter failures. The original saved evidence remains unchanged.
