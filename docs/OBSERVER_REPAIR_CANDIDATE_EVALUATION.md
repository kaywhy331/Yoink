# Durable observer-repair candidate evaluation

Yoink 0.47 moved the narrow privacy-bounded Add-control repair miner into its
own durable worker family. Yoink 0.48 extends the same closed compiler contract
to all five fixed read-only observer fields: availability, unit price, seller,
fulfillment, and add control. The worker may compile sufficiently repeated
structural evidence into an **unsigned, quarantined observer-only candidate**.
It cannot sign, promote, distribute, trial, or execute that candidate.
Yoink 0.68 qualifies the same handler contract behind an inactive,
function-only PostgreSQL role without changing SQLite runtime authority.

This is the first automatic compilation step in the correction ladder. It is
not automatic repair publication, community truth, an LLM-generated script, or
retailer mutation.

## Input gate

The worker reads the existing user-scoped adapter repair projection. A group is
eligible only when all of the following are already true:

- it is an open failure from the packaged read-only `observe` operation;
- the failure is one of the five field-specific selector-miss cases on an
  unblocked exact product page;
- the missing field has one locally unambiguous semantic candidate and every
  contributed field has one globally unique stable-attribute selector;
- every retained landmark passed the independent companion and server privacy
  allowlists; and
- the same derived selector has current evidence from at least three distinct
  paired devices and two distinct exact retailer SKUs.

The device/SKU threshold reduces local layout noise. It does not prove
independent people, resist Sybil attacks, or create a production community
quorum. That is why it can create only a review candidate.

## Compiler boundary

One worker run examines at most 2,000 repair groups and creates or reuses at
most 25 candidates. It groups every mature compatible field for one layout
into one candidate. Each field accepts one through five unique selectors and a
fixed interpretation mode:

- availability, unit price, seller, and fulfillment use `text`;
- add control uses `disabled_state`.

Add-control selectors must use one of these fixed shapes:

- `button[allowlisted-attribute='allowlisted-value']`
- `input[allowlisted-attribute='allowlisted-value']`
- `[role='button'][allowlisted-attribute='allowlisted-value']`

The other four fields may additionally use the packaged structural elements
`div`, `span`, `p`, `label`, `section`, or `li`, but never `input`. Attributes are limited
to `data-testid`, `data-test-id`, `data-automation-id`, `data-button-state`,
`name`, or `itemprop`. Field-specific stable structural vocabularies are the
same strict allowlists used at diagnostic ingestion. Checkout, Buy Now, order submission,
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
not copied into the candidate or its audit data. Page text, prices, seller
names, fulfillment labels, availability text, DOM, and offer material never
enter the candidate. It stores only field, fixed mode, and bounded selector
because those are the declarative objects being reviewed.

## Idempotency and ownership

The candidate version and recipe fingerprint are deterministic over the
tenant/user scope, retailer, layout fingerprint, ordered field/mode/selector
map, and exact worker package version. The generated provenance and version namespace are
reserved from the ordinary admin proposal API. Migration 41 adds a partial
unique fingerprint index for generated candidates.

A repeated run returns the existing row without another lifecycle or audit
event. It does not renew an expired candidate, alter a reviewed candidate, or
replace an operator decision. A changed layout or selector set becomes a
separate quarantine candidate.

## PostgreSQL qualification boundary

The optional 0.68 PostgreSQL adapter preserves this compiler contract through
one server-principal-bound security-definer routine and zero direct table or
column grants. Its `plan` phase reads at most the newest 2,000 sanitized
diagnostics and returns at most 25 aggregate candidate descriptions. Device and
SKU identifiers are used only to enforce the existing private thresholds; they
are never returned or copied into candidates.

The `apply` phase must receive the exact fresh plan and re-derives its evidence
under the same per-principal lock and `READ COMMITTED` transaction. It may only
create or reuse the deterministic unsigned, 30-day quarantine candidate plus
its lifecycle, audit, and outbox receipts. It cannot sign, promote, distribute,
fill an observed field, execute a recipe, process a signal, or authorize any
retailer action. The role and principal registry remain inactive outside the
qualification fixture, so SQLite remains authoritative.

Run `npm run postgres:observer-candidates -- plan ...` and follow the
[PostgreSQL cutover qualification](POSTGRES_CUTOVER.md) runbook before any
operator-controlled qualification apply.

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

The worker result explicitly reports five supported fields,
`mutationAuthority: false`, and `generatedCandidatesExecutable: false`. Health
additionally reports a field count of five, that an independent oracle remains
required and unimplemented, and that execution and automatic promotion remain
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

Yoink 0.48 requires no schema migration. The optional field-specific counts and
landmarks remain inside the existing bounded diagnostic JSON column, and the
candidate recipe already stores a fixed field map. Migration 41 remains the
current schema.
