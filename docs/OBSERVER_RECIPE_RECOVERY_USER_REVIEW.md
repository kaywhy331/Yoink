# Observer-recipe recovery user review

Yoink 0.52 adds a contributor-owned review layer above the quarantined
normalized recovery evidence introduced in 0.51. A user can say that a public
store detail was correct, incorrect, or withdraw an earlier confirmation from
the minimal user dashboard.

A review is provenance, not permission. It cannot change the evidence value,
fill an observation, promote or sign a recipe, qualify a retailer, change a
purchase plan, enqueue a job, reserve spend, or invoke Chrome.

## Closed review contract

The user API accepts exactly three fields: contract version, decision, and the
decision-specific confirmation phrase. Free text is deliberately excluded so
the review path cannot become a side channel for DOM, URLs, account context,
addresses, checkout fields, or payment data.

| Decision | Exact confirmation |
| --- | --- |
| `confirmed` | `CONFIRM_NORMALIZED_RECOVERY_EVIDENCE` |
| `rejected` | `REJECT_NORMALIZED_RECOVERY_EVIDENCE` |
| `revoked` | `REVOKE_NORMALIZED_RECOVERY_CONFIRMATION` |

Only the authenticated contributor can list or review their evidence through
`/api/v1/user/community/recovery-evidence`. A user cannot infer whether
another contributor's evidence ID exists. Confirmation and rejection may
supersede an earlier answer. Revocation is accepted only when the current
state is confirmed. Repeating the current decision is idempotent and does not
append another event.

## Immutable event ledger

Migration 45 creates `observer_recipe_recovery_reviews`. A composite foreign
key binds every event to the same tenant, user, and evidence row at the
database layer. Each evidence stream has a monotonically increasing sequence
and stores:

- the fixed decision and exact confirmation code;
- a deterministic hash of the immutable evidence binding;
- the authenticated actor kind and identifier; and
- the event time.

Updates and premature or direct review deletes are rejected by triggers. The
current state is a projection of the highest sequence; the evidence row itself
is never updated. Version 0.53 adds a separate 90-day inactivity policy: once
eligible, bounded service cleanup removes the evidence and lets its review
events cascade. Deleting the owning user remains the other intentional privacy
cascade. Self-service data export includes current history plus aggregate
retention receipts.

Audit receipts include the evidence ID/hash, retailer, fixed field name,
previous/current review states, and explicit negative safety facts. They do
not duplicate the normalized value.

## User and admin experience

The Preferences workspace presents a plain-language “Help improve store
reading” card. It shows the exact store item, field, normalized public value,
current answer, and a persistent `Quarantined · never applied` boundary. The
available controls follow the server state and support correction and
withdrawal without asking for technical selector knowledge.

The admin registry projects current review state and event count beside the
existing opaque contributor, recipe, SKU, layout, and provenance metadata.
Administrators cannot use that projection to apply a value.

Health and snapshot contracts report independently that user review and
revocation are implemented while review application and recipe field fill are
disabled.

## Verification boundary

Automated coverage proves:

- tenant/user ownership in both repository queries and database constraints;
- exact closed request shapes and decision-specific confirmation phrases;
- idempotent retries and sequenced confirm/reject/reconfirm/revoke history;
- rejection of revocation without a current confirmation;
- append-only event behavior plus intentional bounded retention and
  owner-deletion cascades;
- latest-review activity resetting the 0.53 retention clock and bounded expiry;
- user-data export and value-free audit metadata;
- canonical user/admin API-surface separation; and
- unchanged observations, qualifications, missions, jobs, application state,
  field fill, and browser invocation.

Before a later release can use confirmed evidence in even a read-only
observation projection, Yoink still needs production IdP and device-risk
eligibility, reputable independent-account and region quorum, conflict SLOs,
external consistency monitoring, and a separately governed reversible
application projection. The local retention/deletion policy ships in 0.53;
mutation runners remain permanently outside the recipe registry.

See also [recovery evidence](OBSERVER_RECIPE_RECOVERY_EVIDENCE.md),
[recovery retention](OBSERVER_RECIPE_RECOVERY_RETENTION.md),
[packaged oracle](OBSERVER_RECIPE_ORACLE.md), and
[canary governance](OBSERVER_RECIPE_CANARY_GOVERNANCE.md).
