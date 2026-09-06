# Unified store setup

Plans, Stores and Insights now open one per-store setup checklist. It separates the paired browser, Chrome permission, sign-in, product evidence, no-click rehearsal, explicit activation, store-check health, execution mode and purchase-action pause. Each unresolved check names its owner and provides the relevant action or instructions.

The shopper can open the selected store, follow the extension's actual **Store access** and **Store checks → Check again** controls, refresh the results, and return to a freshly fetched plan. Administrator links open the selected store's existing qualification page and preserve its evidence review, explicit confirmation and protected-change handling. Shoppers without those permissions see an account-specific handoff explanation; the dashboard does not send an administrator request.

## Boundaries and recovery

- `/api/v1/user/readiness` keeps its existing re-verification plan and adds a read-only setup projection. Optional `planId` returns the current actor-owned plan; unavailable or foreign plans return 404. The device and administrator re-verification contracts are unchanged.
- Chrome permission is always **Not verified here** because the companion does not report permission telemetry. A stale, future, wrong-version, offline or revoked-browser session cannot turn the sign-in check green. Passing checks do not produce an Add authorization.
- Readiness no longer equates the absence of a known session blocker with proof of sign-in. Store setup never activates a store, changes plan limits or resumes a paused plan. Purchase-action resume is an explicit existing API action and is offered only after at least one store is activated; independent-approval responses remain paused.
- Each store on a guarded plan has its own setup destination. Session recovery uses that store's exact plan target, falling back to a same-store check product or homepage. Links use the existing affiliate router, including when a setup URL loads before the dashboard.
- Setup URLs survive reload and browser history. A late response cannot reopen a closed view. Unsaved plan drafts block departure. Loading, retry and stale-result messages live inside the checklist, and a failed readiness request leaves store browsing usable. Closing setup restores keyboard focus after directory refreshes.
- Store-level checks describe setup only. Sources, plan status, spending limits, a fresh exact first-party offer, saved Shipping or explicit Pickup, quantity one, one-use Add authorization and exact cart delta remain required by their existing execution gates. Checkout is manual.

## Validation

- Domain/API checks cover browser capabilities, freshness, role ownership, actor isolation, missing and retired activation, independent pause/mode/health gates, qualification expiry and read-only return-to-plan state.
- Browser journeys cover saved setup URLs, Back, route departure during a pending load, retry and stale checks, keyboard focus restoration, draft preservation, paused plans, the selected store on a multi-store plan, affiliate-routing startup, and the actual administrator and Chrome-settings destinations.
- The desktop and mobile layouts were inspected: [mobile overview](screenshots/store-setup-2026-09-05/target-overview-mobile.png), [Chrome instructions](screenshots/store-setup-2026-09-05/target-instructions-mobile.png), [desktop](screenshots/store-setup-2026-09-05/target-desktop.png).

- Full application run: 977 checks, 973 passed and four failed. The failures covered obsolete readiness-renderer assertions, the replaced direct recovery link, shopper terminology, and an administrator journey that began its next action before a prior role operation finished refreshing. The affected suites passed on rerun: **39 checks, zero failures**. Warning behavior now has domain coverage, the glossary scans the new projection and distinguishes route templates from visible text, and the administrator test awaits completed UI operations before continuing. No administrator runtime change was required.
- Browser regression run: **23 journeys passed**. After the final copy changes, all **nine setup journeys passed again**, including the real local administrator and Chrome-settings destinations.
- Final type checking, UI-token/selector-pack checks, and extension/TypeScript builds passed on both the clean task and a combined snapshot containing all 37 pre-existing Best Buy/release files. The combined snapshot passed **31 targeted setup/API/readiness/registry checks**.
- A final review added a positive-evidence requirement to store-check health: no recorded failure alone is not a passed check. Its domain/API/glossary checks passed (**25 checks**), and all **nine setup browser journeys passed again**.
- Native PostgreSQL proof passed: **one proof, zero failures, 13 minutes 34 seconds**. It ran against a temporary local database and does not establish hosted HTTP cutover readiness.

## Remaining acceptance

YS-12's dashboard implementation is covered locally. Live acceptance of the handoff into an installed, paired Chrome companion remains outstanding; this run does not exercise a real store permission prompt, login, challenge, rehearsal or cart. Chrome permission telemetry remains unavailable and is explicitly labeled unknown.

YS-26 now includes the user's current setup status in the four guarded-store directory cards and selected-store view. Broader catalog and plan-editor capability treatment remains on the audit backlog.

No release version, deployment, service restart or retailer execution is included. The pre-existing Best Buy and release changes are excluded from this commit.
