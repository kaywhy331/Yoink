# Observer-recipe canary governance

Yoink 0.50 adds contributor-deduplicated, stage-aware governance to the signed
observer-recipe lifecycle. It limits how read-only recipes accumulate promotion
evidence and how a canary is distributed. It does not authorize automatic
signing, automatic promotion, product-evidence field fill, or browser mutation.

Version 0.51 leaves these cohort and promotion rules unchanged. It can retain
oracle-agreed normalized values only in a separate append-only `not_applied`
quarantine; those values do not count as additional contributors or trials and
cannot fill an observation. See
[observer-recipe recovery evidence](OBSERVER_RECIPE_RECOVERY_EVIDENCE.md).

Version 0.52 likewise leaves promotion unchanged. Contributor confirmation,
rejection, and revocation are separate review events; they do not become trial
votes, add contributors/devices, advance lifecycle state, or authorize field
fill. See
[observer-recipe recovery user review](OBSERVER_RECIPE_RECOVERY_USER_REVIEW.md).

## Canonical trial cohort

Migration 43 adds `recipe_state_at_trial` to the bounded trial receipt. The
server derives this value from the signed candidate row at ingestion; Chrome
cannot claim a more trusted stage. Existing rows are retained as
`legacy_unknown` and remain visible, but cannot become canary-stage evidence.

Raw trials remain append-only for incident review. Promotion quorum uses only
the newest row for an exact tuple of:

- tenant user;
- retailer SKU;
- layout fingerprint; and
- server-derived recipe stage.

The user boundary comes from the authenticated device credential. Multiple
paired devices, retries, or duplicate submissions by one account therefore do
not create additional contributor votes for the same SKU/layout/stage. Device
diversity is counted separately and is required alongside user diversity for a
worker-generated recipe.

## Promotion gates

All prior structural validation, rooted signature, expiry, sequential
promotion, packaged-oracle, conflict, rollback, kill-switch, and witness gates
still apply.

A worker-generated shadow recipe cannot enter canary until it has two
oracle-complete cohort passes from two distinct tenant users and two devices on
two exact SKUs. A canary cannot become trusted read-only until:

- at least 24 hours have elapsed since its recorded canary lifecycle event;
- the whole lifecycle has five contributor-deduplicated clean passes on three
  SKUs and two layouts;
- the canary stage itself has three clean passes on three SKUs and two layouts;
- a worker-generated candidate has three oracle-complete canary passes from
  three distinct tenant users and devices; and
- no packaged conflict, oracle conflict, raw failed trial, or canary regression
  breach exists.

Manual recipes retain maintainer signing and review, but the 24-hour canary and
stage-specific coverage gates apply before trusted-read-only promotion.

## Deterministic canary delivery

The authenticated tenant user ID and exact recipe ID are hashed locally on the
server into a stable bucket. Canary recipes are delivered only to the first 25
percent of buckets. Extra devices for the same account receive the same cohort
decision. An excluded account falls back to the next valid signed recipe, when
one exists, or the packaged observer. No cohort identifier is included in the
signed recipe or returned to Chrome.

Shadow and trusted-read-only distribution are unchanged. This cohort is a
bounded rollout control, not random experimentation, cross-tenant tracking, or
a substitute for production account reputation.

## Regression auto-kill

After every accepted canary trial, the server recomputes the current cohort. A
recipe is transactionally disabled and undistributed with reason
`canary_regression_slo_breach` when all of these conditions hold:

- at least four current canary cohort trials exist;
- at least two current trials failed;
- failures came from at least two distinct tenant contributors; and
- failing contributors are at least 50 percent of current canary contributors.

The transition clears the signature, activates the existing kill switch, and
appends one lifecycle plus audit/outbox receipt. The conditional database
update makes concurrent reports idempotent. Known packaged-evidence conflict
retains its stronger one-report immediate kill behavior.

## Deliberately closed

- Tenant user IDs are not proven public identities. Production IdP assurance,
  account age/risk, reputation, abuse response, and Sybil resistance remain
  required before calling this a public independent-account quorum.
- Region is not present in the recipe-trial receipt, so regional cohorts and
  locality-specific correctness gates remain closed.
- Recipe values still do not fill stored observations. A future field-fill
  record must expose per-field provenance and cannot affect identity,
  qualification, jobs, mutation, checkout, or order submission.
- Generated candidates remain unsigned quarantine rows until explicit
  maintainer action. No worker has recipe signing authority.
- Remote recipes remain read-only selector data interpreted by packaged code;
  they cannot navigate, click, submit forms, invoke add runners, or enter
  payment/checkout frames.
