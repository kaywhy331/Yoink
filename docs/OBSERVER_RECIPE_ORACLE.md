# Packaged observer-recipe oracle

Yoink 0.49 adds a second, fixed, read-only interpretation path for signed
observer recipes. Its purpose is to test a candidate against evidence that was
not selected by that recipe. It is a packaged safety oracle, not an external
service, independent-account vote, or license for automatic promotion.

## Trust boundary

The Chrome companion first verifies the offline-root manifest chain,
revocations, recipe signature, expiry, minimum extension version, fixed field
schema, and bounded selector grammar. It then injects the packaged
`observer-recipe-oracle.js` bundle into the isolated world. Downloaded recipe
data can select only the five existing read-only commerce fields and cannot
provide code, navigation, events, network requests, or mutation behavior.

The evaluator has three inputs:

- the signed recipe's bounded selectors;
- the packaged observer's normalized value and a per-field known/missing bit;
- a second packaged reader restricted to exact-product JSON-LD, semantic
  microdata/meta, and a unique accessible Add control.

The second reader binds structured Product data to the exact retailer SKU when
an identifier is present. Multiple products, conflicting normalized values,
multiple accessible Add controls, malformed structured data, or unsupported
semantics become missing or ambiguous evidence. They never become a guess.

## Trial contract

Trial contract version 2 returns one entry for every signed recipe field. Each
entry contains only:

- the fixed field name;
- recipe state: `value`, `missing`, `ambiguous`, or `unrecognized`;
- packaged state: `agreed`, `conflict`, `missing`, or `not_evaluated`;
- oracle state: `agreed`, `conflict`, `missing`, `ambiguous`, or
  `not_evaluated`;
- disposition: `verified`, `conflict`, or `insufficient`.

The server independently validates the exact field set, state combinations,
derived counts, and overall pass/fail outcome. Migration 42 stores only those
enums, counts, exact SKU, observer version, and layout fingerprint. Extracted
prices, sellers, availability text, fulfillment text, selectors, DOM, URLs,
and account/session data are absent from the trial contract. Version-1 trial
receipts remain ingestible for older companions and are labeled
`legacy_packaged_comparison`; they never satisfy an oracle promotion gate.

## Authority and promotion

Packaged observer evidence is authoritative whenever that field is known. A
recipe disagreement is a failed trial and immediately sets the candidate to
`disabled`, activates its kill switch, clears distribution, and appends
lifecycle plus audit/outbox evidence with reason
`packaged_evidence_conflict`. The browser still returns the original packaged
observation.

An explicitly reviewed worker-generated candidate may enter `shadow` so that
trials can be collected. It cannot enter `canary` until every recipe field has
packaged-oracle agreement in two passing trials on two exact SKUs. It cannot
enter `trusted_read_only` without five oracle-complete trials, three exact
SKUs, two layout fingerprints, and no failures or conflicts. All existing
maintainer, rooted-signature, expiry, rollback, witness, and sequential
promotion requirements remain in force.

## Deliberately closed

- Generated candidates are not automatically signed or promoted.
- A recipe is not used to fill a stored observation yet. Provenance-aware
  observation storage and conflict projection must exist first.
- The packaged oracle is not a Sybil-resistant community quorum or an
  independently operated correctness service.
- No recipe can affect selected-offer identity, qualifications, jobs,
  navigation, clicks, cart actions, checkout, drawing entry, or order
  submission.
- A second packaged reader can share implementation assumptions with the
  bundled observer. Redacted maintainer fixtures, explicit normalized user
  confirmation, public reputable-account/Sybil controls, regional cohorts,
  long-horizon false-positive SLOs, and external consistency monitoring remain
  roadmap work.

## 0.50 governance follow-on

Version 0.50 implements the tenant-scoped portion of the final bullet:
latest-per-contributor/SKU/layout/stage quorum, distinct user/device gates, a
deterministic 25% canary, a 24-hour burn-in, and a multi-contributor regression
auto-kill. It does not turn tenant user IDs into reputable public identities;
production IdP/device risk, region, reputation, and Sybil defenses remain
closed. See [observer-recipe canary governance](OBSERVER_RECIPE_CANARY_GOVERNANCE.md).
