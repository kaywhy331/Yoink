# Observer-recipe recovery retention

Yoink 0.53 adds bounded deletion to the quarantined recovery-evidence and
contributor-review ledgers. This is a privacy lifecycle, not an evidence
application path. Expired values and their review events are removed; they are
never copied into observations, catalog records, qualifications, purchase
plans, jobs, or browser instructions.

## Policy v1

`observer_recipe_recovery_retention_v1` retains an evidence row for 90 days
after its latest activity. Activity is the later of:

- the evidence `received_at`; or
- the most recent append-only confirm, reject, or revoke event.

A new review therefore resets the 90-day clock. At the exact expiry boundary,
the row is eligible for cleanup. The policy is package-owned and cannot be
remotely lengthened, shortened, or used to change application authority.

## Durable cleanup

The existing six-hour `operational_telemetry_retention` schedule is presented
as **Privacy and telemetry retention** and now invokes a signing-free recovery
retention repository. Each principal is processed in its own service scope.
One run deletes at most 500 eligible evidence rows for that exact tenant/user;
another user or tenant cannot be swept by the same repository call.

The transaction counts matching review events, deletes the eligible parent
rows, lets their review events cascade, and writes one aggregate receipt. A
retry after commit finds no matching evidence and creates no duplicate receipt.
A rollback preserves the evidence, reviews, and absence of a receipt together.

The maintenance handler does not instantiate recipe signing authority. Recipe
signing, promotion, delivery, field application, and every mutation runner
remain outside the retention repository.

## Migration 46

Migration 46 adds `observer_recipe_recovery_retention_receipts` with:

- composite tenant/user ownership and privacy deletion cascade;
- fixed policy version and 90-day duration;
- a cutoff and bounded deleted evidence/review counts;
- schema-locked `application_affected = 0` and `field_fill_applied = 0`;
- the service actor identifier and creation time; and
- `restricted_user_aggregate` privacy classification.

Receipt updates and ordinary deletes are rejected. The migration also adds
owner/activity indexes and changes the evidence/review delete triggers so they
allow only the time-qualified parent cleanup cascade or deletion of the owning
user. Fresh evidence, fresh reviews, direct review deletion, and receipt
tampering remain database-blocked.

## User and operator experience

The Preferences card tells a user that quarantined details disappear after 90
inactive days and shows the projected removal time for each item. Reviewing an
item updates that projection. The API returns the same owner-scoped policy and
aggregate receipt status.

The admin observer registry shows the tenant policy, eligible count, bounded
batch size, deletion totals, and opaque contributor references on recent
receipts. Receipts never contain the deleted value, SKU, recipe, layout, or
answer. Self-service user export includes the user's receipt history; deleting
the user removes evidence, reviews, and receipts through the privacy cascade.

## Safety and verification boundary

Automated coverage proves:

- migration from the pre-retention schema with integrity and foreign keys
  intact;
- service-only, tenant/user-scoped pruning;
- database rejection of premature and direct review deletion;
- latest-review activity resetting expiry;
- expired review-event cascade and immutable aggregate receipts;
- bounded batch configuration and idempotent no-op retries;
- owner-scoped policy/status and user-data export;
- absence of normalized values and exact item identifiers from receipts and
  retention audit metadata; and
- unchanged observations, qualifications, missions, jobs, application state,
  field fill, and browser invocation.

This release completes the local recovery-ledger retention/deletion policy.
Version 0.54 subsequently adds a bounded service-attested eligibility seam and
measured regional conflict SLO without changing retention or application. A
future read-only application projection still requires a deployed production
IdP/device-risk provider, reputable public-account and Sybil/abuse controls,
external consistency monitoring, and separately governed reversible
application. Mutation runners remain permanently outside the recipe registry.

See also [recovery evidence](OBSERVER_RECIPE_RECOVERY_EVIDENCE.md),
[recovery user review](OBSERVER_RECIPE_RECOVERY_USER_REVIEW.md),
[regional conflict SLO](OBSERVER_RECIPE_REGIONAL_CONFLICT_SLO.md), and
[canary governance](OBSERVER_RECIPE_CANARY_GOVERNANCE.md).
