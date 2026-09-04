# Privacy-bounded adapter repair intelligence

Yoink 0.37 added a narrow Add-control structural signal to the existing
immediate adapter diagnostic path. Yoink 0.48 extends that privacy boundary to
all five fixed read-only observer fields: availability, unit price, seller,
fulfillment, and add control. When a packaged field misses but one local
semantic candidate has a globally unique stable attribute, the companion may
report that structural landmark. The server can then show a maintainer the
corresponding CSS selector candidate without receiving page HTML, observed
field values, or making the candidate executable.

This began as an investigation aid and remains outside autonomous recipe
publication. Version 0.48 may compile mature evidence for multiple fixed fields
into one unsigned quarantine candidate, but no automated path may promote or
distribute it. It does not
change a retailer observation, qualify an add lane, click a control, or bypass
the observer-recipe quarantine, trial, signing, rollback, and independent
witness gates.

## Companion boundary

The observer considers a landmark only when all of these conditions hold:

- the exact product page is not behind authentication, MFA, location setup,
  membership, a queue, high-demand handling, or a security challenge;
- at least one packaged availability, unit-price, seller, fulfillment, or
  Add-control selector missed;
- the candidate is visible and non-merchandising, with locally unambiguous
  field semantics; Add control remains limited to button-like elements with
  Add/Cart/Bag or Preorder intent;
- one allowlisted structural attribute selects that exact element once in the
  current document;
- the value is short, every separated word belongs to a packaged structural/
  commerce vocabulary, and it contains no long numeric or hash-shaped
  component.

At most one landmark per fixed field may be sent. Add control accepts only
`button`, `input`, and `role_button`; input is rejected for every value field.
The other read-only fields may use `button`, `role_button`, `div`, `span`, `p`,
`label`, `section`, and `li`. The only accepted attributes are:

- `data-testid`
- `data-test-id`
- `data-automation-id`
- `data-button-state`
- `name`
- `itemprop`

IDs, classes, DOM paths, arbitrary selectors, element text, URLs, prices,
retailer SKUs, and form values are never part of the landmark. Values
containing checkout, order submission, payment, account, credential, contact,
address, cookie, CSRF, or token vocabulary fail closed. Long numeric and
hash-shaped values fail closed as likely dynamic/product-bound identifiers.

Before transport, the service worker reconstructs the diagnostic from its
allowlist and independently validates every landmark. Unknown fields from the
injected page result are discarded. Existing bounded retry storage retains the
same reconstructed payload during a transient server outage.

## Server boundary

The server repeats all landmark validation and additionally requires the
reported layout to be an unblocked product page, a field-specific selector-miss
reason/stage, and matching bounded candidate counts. Add-control evidence still
requires at least one generic Add-intent control. Only normalized landmark
objects enter `layout_json`; supplied selector strings and unknown fields are
never stored.

The layout fingerprint includes normalized landmarks while continuing to omit
`scopedControlCount`. This keeps evidence for different structural candidates
separate while allowing a later packaged observer to mark the same markup
recovered.

For an open read-only field-specific selector-miss group, Yoink derives one
quoted attribute selector from each landmark and reports:

- occurrence count;
- distinct paired-device count;
- distinct exact-retailer-SKU count;
- `collecting_evidence` until three devices and two exact SKUs are present;
- `maintainer_ready` after those local evidence minimums are met;
- `executable: false` in every state.

The device/SKU minimum reduces single-layout noise, but it is not a public
community quorum or an independent oracle. Current aggregation is scoped to
one tenant/user repair ledger. A future shared evidence plane must add
pseudonymous contributor reputation, Sybil resistance, cross-account
governance, retention/deletion operations, and independent page validation
before treating crowd evidence as global.

Since 1.19.5 three closure rules keep a repair group from driving automatic
rechecks forever. A `rehearse_add` diagnostic that passes for the same exact
product on the same or a newer packaged add adapter supersedes an earlier
`live_add` failure at a binding stage, because the automatic loop can only
rehearse, never place a live add. A product page that no longer resolves to
the exact product records an observe diagnostic with outcome `rejected`,
stage `page_identity`, and reason `product_page_unavailable`, which closes that
product's open failure. A group whose newest failure is older than fourteen
days without a fresher failure reports `aged_out`; its operator incident
resolves with `adapter_aged_out` rather than `adapter_recovered`. Policy and
interactive-block rejections keep the strict same-operation rule.

## Maintainer workflow

The local repair loop is specified in
[Adapter repair loop](ADAPTER_REPAIR_LOOP_SPEC.md). A local-profile Chrome
companion may save a sanitized page snapshot and adapter trace beside this
hosted-safe diagnostic. Those capsules remain under `data/evidence` on the
machine that captured them; they never enter this diagnostic, alerts,
community evidence, portability archives, hosted delivery, or observer
recipes. A production-profile companion and every hosted server keep capsule
transport disabled.

The executable eight-step workflow, release recheck states, verification
commands, and resolution-distribution query are in the
[adapter repair playbook](ADAPTER_REPAIR_PLAYBOOK.md). Start there after
claiming a queue item; `npm run repair` is the read-only entry point.

The suggestion appears in **Admin → Retailers → Adapter repair queue**. A
maintainer may use it to reproduce the layout and update a packaged observer or
manually author a read-only observer recipe. Starting in 0.48, the dedicated
60-second worker may group thresholded allowlisted availability, unit-price,
seller, fulfillment, and Add-control selectors for one layout into an unsigned
quarantined candidate. Interpretation modes are fixed (`text` for the four
value fields and `disabled_state` for Add control). It uses a deterministic
scoped fingerprint, creates no duplicate on replay, and copies no device ID,
SKU, page text, or observed offer value into the candidate or its audit receipt.

Automatic processing ends there. Any recipe still begins in quarantine and
requires explicit protected maintainer promotion, then must pass the existing shadow and
canary evidence requirements before trusted-read-only promotion. It must be
signed under package-rooted trust, retain rollback/kill-switch behavior, and—
in hosted mode—match a fresh independently witnessed transparency checkpoint.
Remote recipes remain permanently unable to authorize retailer mutation.

Health advertises `privacyBoundedRepairLandmarks=true` and
`nonExecutableRepairSuggestions=true`. Version 0.48 additionally advertises
`durableObserverRepairCandidateEvaluation=true`,
`privacyBoundedObserverRepairFieldCount=5`, and the still-open independent
oracle requirement while keeping
`generatedObserverRepairCandidatesExecutable=false` and
`generatedObserverRepairCandidatesAutoPromoted=false`. These flags do not
indicate production community readiness.

No schema migration was required for 0.37 because the normalized optional
landmarks use the existing bounded diagnostic JSON column. Migration 35 was
current for that release; 0.38 later adds migration 36 for device credential
rotation without changing this evidence format. Migration 41 adds only the
seventh closed worker task and generated-candidate fingerprint uniqueness; it
does not change the diagnostic format or any retailer authority. See
[durable observer-repair candidate evaluation](OBSERVER_REPAIR_CANDIDATE_EVALUATION.md).

Version 0.48 also requires no migration: the existing bounded JSON and recipe
field-map columns already represent the additive structural evidence. Migration
41 remains current.
