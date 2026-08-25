# Privacy-bounded adapter repair intelligence

Yoink 0.37 adds a narrow structural signal to the existing immediate adapter
diagnostic path. When a packaged read-only observer sees one visible control
whose semantics say **Add to cart** but none of its packaged selectors match,
the companion may report a stable attribute landmark. The server can then show
a maintainer the corresponding CSS selector candidate without receiving page
HTML or making that candidate executable.

This began as an investigation aid and remains outside autonomous recipe
publication. Version 0.47 may compile mature evidence into an unsigned
quarantine candidate, but no automated path may promote or distribute it. It does not
change a retailer observation, qualify an add lane, click a control, or bypass
the observer-recipe quarantine, trial, signing, rollback, and independent
witness gates.

## Companion boundary

The observer considers a landmark only when all of these conditions hold:

- the exact product page is not behind authentication, MFA, location setup,
  membership, a queue, high-demand handling, or a security challenge;
- no packaged Add-control selector matched;
- a visible, non-merchandising button-like element has unambiguous Add/Cart/Bag
  or Preorder intent;
- one allowlisted structural attribute selects that exact element once in the
  current document;
- the value is short, every separated word belongs to a packaged structural/
  commerce vocabulary, and it contains no long numeric or hash-shaped
  component.

At most five landmarks may be sent. The only accepted element kinds are
`button`, `input`, and `role_button`. The only accepted attributes are:

- `data-testid`
- `data-test-id`
- `data-automation-id`
- `data-button-state`
- `name`

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
reported layout to be an unblocked product page with zero packaged Add-control
matches and at least one generic Add-intent control. Only the normalized
landmark objects enter `layout_json`; supplied selector strings and unknown
fields are never stored.

The layout fingerprint includes normalized landmarks while continuing to omit
`scopedControlCount`. This keeps evidence for different structural candidates
separate while allowing a later packaged observer to mark the same markup
recovered.

For an open read-only `add_control_selector_miss` group, Yoink derives one
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

## Maintainer workflow

The suggestion appears in **Admin → Retailers → Adapter repair queue**. A
maintainer may use it to reproduce the layout and update a packaged observer or
manually author a read-only observer recipe. Starting in 0.47, the dedicated
60-second worker may copy only a thresholded allowlisted Add-control selector
into an unsigned quarantined candidate. It uses a deterministic scoped
fingerprint, creates no duplicate on replay, and copies no device ID or SKU into
the candidate or its audit receipt.

Automatic processing ends there. Any recipe still begins in quarantine and
requires explicit protected maintainer promotion, then must pass the existing shadow and
canary evidence requirements before trusted-read-only promotion. It must be
signed under package-rooted trust, retain rollback/kill-switch behavior, and—
in hosted mode—match a fresh independently witnessed transparency checkpoint.
Remote recipes remain permanently unable to authorize retailer mutation.

Health advertises `privacyBoundedRepairLandmarks=true` and
`nonExecutableRepairSuggestions=true`. Version 0.47 additionally advertises
`durableObserverRepairCandidateEvaluation=true` while keeping
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
