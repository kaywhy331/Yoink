# Observer-recipe recovery evidence

Yoink 0.51 adds a deliberately non-operative bridge between observer-recipe
validation and future field recovery. When the bundled observer is missing one
of the five fixed public commerce fields, a signed recipe may produce a
normalized value. That value enters the server only when the separately
packaged structured-page oracle reads the same exact value.

The result is evidence, not a fill. It cannot change a stored observation,
catalog listing, community assertion, retailer qualification, purchase plan,
job, browser action, or mutation runner.

Yoink 0.52 adds a separate contributor-owned append-only review ledger. A
confirmation, rejection, or revoked confirmation labels this evidence but
still cannot apply it. See
[observer-recipe recovery user review](OBSERVER_RECIPE_RECOVERY_USER_REVIEW.md).

Yoink 0.53 adds a 90-day latest-activity retention policy, bounded durable
cleanup, and value-free aggregate deletion receipts. Expiry removes evidence
and reviews; it does not apply them. See
[observer-recipe recovery retention](OBSERVER_RECIPE_RECOVERY_RETENTION.md).

## Trial contract v3

Contract v3 retains every value-free v2 field-state receipt and adds an
optional `recoveryEvidence` array. The array must cover exactly the fields whose
receipt says all of the following:

- the signed recipe extracted one unambiguous value;
- the authoritative bundled observer marked that field missing;
- the fixed packaged structured-page oracle independently agreed; and
- the final disposition is `verified`.

Known bundled evidence remains authoritative. A field with packaged evidence
never enters recovery storage, even if the recipe and oracle agree. A packaged
conflict continues to kill and undistribute the recipe immediately.

Chrome and the server independently enforce the same small value grammar:

| Field | Accepted normalized value |
| --- | --- |
| Availability | `in_stock`, `preorder`, or `out_of_stock` |
| Unit price | Positive integer USD cents, at most 100,000,000 |
| Seller | Lowercase public seller name, at most 160 safe characters; URLs, account/contact vocabulary, long digit runs, and sensitive terms are rejected |
| Fulfillment | `shipping` or `pickup` |
| Add control | Boolean actionable state |

Selectors, DOM, HTML, arbitrary text, URLs, account identifiers, cookies,
tokens, addresses, checkout/form values, and payment data remain outside the
contract. Older v1 and v2 companions remain ingestible, but cannot submit
recovery values. A v3 receipt also requires the paired device to advertise the
packaged recovery-evidence capability.

## Append-only quarantine

Migration 44 creates `observer_recipe_recovery_evidence`. Each row is bound to
the authenticated tenant user and device, exact trial and recipe, retailer and
SKU, layout fingerprint, server-known recipe lifecycle stage, field, typed
normalized value, and observation/receipt times. Its provenance is fixed to
`recipe_packaged_oracle_agreement_v1`.

Every row is permanently born as:

- `evidence_state = quarantined`; and
- `application_state = not_applied`.

Database constraints allow no other state, and append-only triggers reject
ordinary updates or deletes. The user's data export includes the complete
ledger. Backup, portability, and restore include it automatically with the
rest of the current schema.

The admin registry shows the normalized value, opaque contributor reference,
exact SKU, layout fingerprint prefix, recipe stage, provenance, and explicit
`Application: never` status. Audit events contain only field names and counts;
they never duplicate recovered values.

## Append-only user review

Migration 45 binds a sequenced review stream to the same tenant, user, and
evidence identity with a composite foreign key and deterministic evidence
hash. The user API accepts only a fixed decision and exact confirmation phrase;
free text is excluded. Repeating the current answer is idempotent, and the
current state is derived from the latest event without editing evidence.

The minimal user dashboard presents confirm, reject, and withdraw controls.
The admin registry shows review state and event count. Review history is part
of the user's data export. Direct updates and premature deletes remain blocked.
Version 0.53 permits only bounded time-qualified evidence cleanup (with review
cascade and aggregate receipt) or deletion of the owning user.

## Closed application boundary

There is intentionally no approve, apply, observation-update, contribution,
qualification, job, or action endpoint for recovery evidence. Health and
snapshot contracts separately report:

- recovery-evidence storage implemented: `true`;
- recovery-evidence retention and receipts implemented: `true`;
- recovery-evidence retention days: `90`;
- recovery-evidence application enabled: `false`; and
- observer-recipe field fill enabled: `false`.

Before a later release may apply even a read-only fill, Yoink still needs
production-reputable independent accounts and device-risk controls,
contributor/region quorum, measured conflict handling, external consistency
monitoring, and a separately governed reversible provenance-aware projection.
The local retention policy and contributor
confirmation/rejection/revocation now exist but supply no application
authority. Remote recipes remain permanently isolated from navigation,
identity decisions, clicks, checkout, and mutation.

## Verification boundary

Automated coverage proves that:

- v1/v2 trials remain compatible and cannot smuggle recovery values;
- v3 values must match exactly the eligible missing-field set;
- malformed, sensitive, extra, duplicate, or wrongly typed values fail closed
  in Chrome and again on the server;
- accepted evidence is append-only, tenant-scoped, exportable, and visibly
  quarantined;
- contributor reviews are owner-scoped, sequenced, idempotent, revocable,
  exportable, and never edit evidence;
- latest activity controls bounded expiry, and receipts contain counts rather
  than deleted values or item identifiers;
- evidence ingestion changes no observation, qualification, mission, or job;
  and
- the fixed oracle still has no click, navigation, fetch, or mutation path.

See also [packaged observer-recipe oracle](OBSERVER_RECIPE_ORACLE.md) and
[contributor-deduplicated canary governance](OBSERVER_RECIPE_CANARY_GOVERNANCE.md).
