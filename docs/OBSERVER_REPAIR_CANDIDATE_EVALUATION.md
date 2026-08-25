# Durable observer-repair candidate evaluation

Yoink 0.47 moves the narrow privacy-bounded repair miner into its own durable
worker family. The worker may compile sufficiently repeated structural evidence
into an **unsigned, quarantined observer-only candidate**. It cannot sign,
promote, distribute, trial, or execute that candidate.

This is the first automatic compilation step in the correction ladder. It is
not automatic repair publication, community truth, an LLM-generated script, or
retailer mutation.

## Input gate

The worker reads the existing user-scoped adapter repair projection. A group is
eligible only when all of the following are already true:

- it is an open failure from the packaged read-only `observe` operation;
- the failure is the allowlisted `add_control_selector_miss` case on an
  unblocked exact product page;
- no packaged Add selector matched and a unique generic Add-intent control was
  present;
- every retained landmark passed the independent companion and server privacy
  allowlists; and
- the same derived selector has current evidence from at least three distinct
  paired devices and two distinct exact retailer SKUs.

The device/SKU threshold reduces local layout noise. It does not prove
independent people, resist Sybil attacks, or create a production community
quorum. That is why it can create only a review candidate.

## Compiler boundary

One worker run examines at most 2,000 repair groups and creates or reuses at
most 25 candidates. Each candidate contains exactly one packaged read-only
field, `addControl`, in `disabled_state` mode with one through five unique
selectors. Selectors must be one of these fixed shapes:

- `button[allowlisted-attribute='allowlisted-value']`
- `input[allowlisted-attribute='allowlisted-value']`
- `[role='button'][allowlisted-attribute='allowlisted-value']`

The five attribute names and stable structural vocabulary are the same strict
allowlists used at diagnostic ingestion. Checkout, Buy Now, order submission,
payment, account, credential, contact, address, cookie, CSRF, and token-shaped
values fail closed. Code, XPath, regex, text, HTML, IDs/classes, navigation,
events, forms, URLs, product values, offer material, and arbitrary selectors
cannot enter this repository.

The standalone compiler depends on no observer trust authority or signing
class. A created row has:

- lifecycle state `quarantined`;
- no signature key, signature, signing time, or trust generation;
- no rollback target and no active distribution envelope;
- provenance `privacy_bounded_repair_miner`;
- a 30-day review lifetime; and
- an append-only lifecycle event plus privacy-bounded audit receipt.

Exact SKUs and device IDs are used to calculate the private threshold but are
not copied into the candidate or its audit data. The candidate stores the
bounded selector because that is the fixed declarative object being reviewed.

## Idempotency and ownership

The candidate version and recipe fingerprint are deterministic over the
tenant/user scope, retailer, layout fingerprint, sorted selectors, and exact
worker package version. The generated provenance and version namespace are
reserved from the ordinary admin proposal API. Migration 41 adds a partial
unique fingerprint index for generated candidates.

A repeated run returns the existing row without another lifecycle or audit
event. It does not renew an expired candidate, alter a reviewed candidate, or
replace an operator decision. A changed layout or selector set becomes a
separate quarantine candidate.

## Review and distribution gates

Automatic processing stops at quarantine. The existing governance path remains
unchanged:

1. An authorized maintainer explicitly requests promotion through the protected
   admin change-control path.
2. The recipe is signed only by the API-side package-rooted authority; the
   standalone worker never loads that private key.
3. Shadow and canary promotions require the existing exact-SKU/layout trials
   and no failures.
4. Trusted read-only delivery requires current rooted trust and, in hosted
   mode, a fresh independently signed transparency witness receipt.
5. The packaged interpreter may use the recipe only for fixed read-only fields.
   Mutation runners do not consume remote recipes.

The worker result explicitly reports `mutationAuthority: false` and
`generatedCandidatesExecutable: false`. Health additionally reports that
durable evaluation exists while execution and automatic promotion remain
false.

## Operations and recovery

**Admin → Operations → Background work** exposes the 60-second **Observer repair
candidate evaluation** schedule, bounded primitive results, retries, and dead
letters without lease capability material. Normal worker retry and manual
dead-letter recovery apply. Exception text is never retained.

**Admin → Retailers → Adapter repair queue** shows which suggestions are still
collecting evidence or have reached candidate-evaluation readiness. The
compiler still rejects any incompatible selector shape. The observer registry
labels generated candidates and keeps the same explicit promotion and
kill-switch controls.

Migration 41 rebuilds only the closed task-kind checks, preserves existing
schedules/tasks/events, and adds generated-candidate fingerprint uniqueness. It
does not change observations, qualifications, action jobs, spend state, or any
retailer execution setting.
