# Checkout report corrections (YS-29)

Implemented. The original report, financial entries and browser action history remain immutable. A reviewed correction records a new outcome/amount/refund receipt, its prior values, reason, actor and idempotency key. It never starts or repeats a retailer action.

## Implementation decisions

- Keep the existing adjusted/refunded ledger entry types and metadata; add no tables. Reservation amounts are a current projection, while ledger entries and report events preserve the original facts and every correction.
- Corrections and refunds affect the original report's spending period. The new entry's creation time records when the correction was made; metadata carries the original accounting time. SQLite and PostgreSQL budget calculations must agree, so an old refund cannot manufacture today's headroom.
- Corrected gross charges, cumulative refunds and net spend remain separate. Refunds change net spend, not the historical checkout outcome or MSRP savings. Correcting a report can also fix an erroneously recorded refund total.
- Outcome changes require the user to review the resulting fulfilled quantity for the associated plan, bounded to its target. This avoids guessing how older capped counts, prior purchases or recreated plans contributed. Active plans pause for review; paused/archived/deleted plans are never resumed. Pending actions are cancelled through the existing state transition; uncertain active actions must be resolved before changing plan progress.
- Preview fingerprints cover the current report and relevant plan state. Confirmation rejects stale reviews. Identical retries return the saved receipt; reusing a key for different input is rejected.
- Activity, stage counts, Insights and CSV use the current report; history retains all reports. The correction dialog shows before/after values, effective spending date, plan effect, errors and a retry-safe submission state.

## Work phases

1. Shared current-report projection and correction repository; SQLite/PostgreSQL budget-period semantics; domain/repository tests.
2. Consistent Activity/Insights queries, actor-owned API and correction/history UI; API and browser acceptance.
3. Full checks/builds and native PostgreSQL proof; combined snapshot verification preserving pre-existing Best Buy/release edits; implementation receipt and commit.

Validation and final disposition will be recorded after implementation.

## Implemented surface

- Actor-owned GET `/api/v1/user/checkout-reports/:jobId`, POST `/preview`, and POST `/corrections`. Permissions, canonical paths, telemetry resource grouping, and static script registration are explicit.
- Activity offers Correct report / History and Record refund. The named dialog reviews gross charge, cumulative refunds, net spend, spending date and plan effects before confirmation. A stable request ID survives a lost save response; stale reviews offer reload. History is paged independently of an unsaved draft. Pending saves, Escape, navigation and focus return are handled.
- SQLite writes the adjustment, reservation projection, reviewed plan progress, cancelled pending actions and correction/audit receipts in one transaction. Original report events and ledger entries remain intact. Receipt retries return the original receipt even after later corrections.
- Shared projections update user Activity, stage counts, Insights and CSV, plus admin totals and conversions. Refunds retain Got it and the gross-charge savings/over-cap comparison. Admin historical windows stay anchored to the original report; correction events are excluded from cart-execution and latency counts.
- Pending plan actions beyond the leased state require manual resolution before an outcome change. Only cancellable pre-execution jobs are cancelled automatically. Financial-only edits do not change plan progress or status.

## Acceptance evidence

- Twenty repository checks passed, covering charge increases/decreases, full/partial refunds, refund corrections, both outcome directions, all plan statuses, pending execution safety, actor/tenant isolation, invalid values, stale reviews, transactional rollback, immutable originals, same-time revisions and stable retry receipts.
- The API acceptance test passed, including simultaneous identical requests (one correction), conflicting reuse, foreign ownership, preview without writes and no additional retailer jobs or notification deliveries.
- PostgreSQL cap-expression tests passed. A prior-month refund cannot create today's spending headroom; gross corrections and refunds retain the original accounting period. The same probe is included in the native PostgreSQL proof.
- UTC and America/Los_Angeles reset boundaries passed, including a manual-review report written one millisecond after its original ledger commit at a month boundary.
- The five correction browser journeys passed: mobile correction/refund/history, explicit progress review and discard protection, lost-response retry, stale reload, and paged history retaining a draft. Mobile screenshots were inspected.
- Clean-worktree type checking, UI token/selector lint checks and extension/TypeScript build passed.

- The full application/cutover-contract run completed 999 checks: 998 passed; the sole failure was the aggregate static-copy budget. The new dialog has a separate 50-word cap, the total page allowance increased by 50 words, and the existing 200-word workspace caps remain. All three affected copy checks then passed.
- Browser acceptance covered all 28 journeys. The final broad run passed 27; its single preview-wait timeout was corrected by explicitly awaiting the API response, and all five correction journeys then passed in 15.6 seconds. Store-setup regression checks also passed after the existing setup test stopped selecting a fixture by mutable list order.
- The combined snapshot includes all 37 preserved Best Buy/release files. Its type check, lint checks, extension/TypeScript build, 98 focused checks, two admin overview checks, and three copy-budget checks passed. Production source bytes match the validated clean worktree. The final clean type/lint check passed after the test refinements.

- The native PostgreSQL proof passed in 12m29s (748,973 ms), including the new original-period refund/charge accounting probe and the existing isolation, writer-lock, execution, configuration, and recovery boundaries.

Delivery uses an isolated feature commit based on `a8bfa44`, applied to main after combined-snapshot validation. Main's 37 pre-existing Best Buy/release files are preserved byte-for-byte and excluded from this commit. No deployment or service restart was performed.
