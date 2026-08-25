# Observer-recipe regional conflict SLO

Yoink 0.54.0 adds a fail-closed measurement boundary for read-only observer
recipes. It distinguishes tenant-local contributors from externally eligible
accounts and measures oracle conflicts only after account, device, and coarse
region eligibility have been attested by a trusted service.

This does not make local Yoink accounts reputable public identities. The local
deployment has no configured production identity/risk provider, so its trials
remain `unverified` and cannot satisfy this SLO.

## Eligibility contract

The canonical service route is:

`POST /api/v1/internal/observer-recipes/contributor-eligibility`

It requires the fixed `internal.eligibility` permission, which is available
only to an authenticated `service` actor. A local maintainer, normal user, or
Chrome device cannot call the repository operation. In hosted mode the request
scope must already have passed the signed-proxy authentication boundary.

The fixed `observer_recipe_contributor_eligibility_v1` contract accepts only:

- the exact active Chrome device ID in the scoped tenant/user;
- a 64-character account pseudonym hash produced before ingestion;
- a coarse `country:CC` or `subdivision:CC-REGION` scope;
- separate account, device, and region eligibility booleans;
- a 64-character proof hash, never a proof payload;
- the fixed `external_identity_risk_v1` source;
- a fresh attestation time and an expiry no more than 24 hours later.

Unknown fields are rejected. Raw IdP subjects, names, email addresses, IP
addresses, street/postal locations, risk features, tokens, and proof payloads
are outside the schema. Region eligibility can be true only for a canonical
subdivision scope.

One current state is retained per tenant/user/device. A newer attestation
atomically replaces it, exact replay is idempotent, an older attestation cannot
roll it back, and conflicting content at the same time fails closed. The state
is bounded by the number of paired devices and cascades with device or account
deletion. Each effective replacement emits a redacted audit event.

## Immutable trial snapshot

At trial ingestion the server—not the extension payload—looks up the current
eligibility state for the authenticated device. A trial receives
`externally_attested` only when all three eligibility decisions are true, the
coarse scope is a subdivision, and the proof has not expired. Otherwise the
trial is permanently `unverified`.

The eligibility policy version, pseudonym hash, proof hash, and coarse region
are snapshotted onto the trial. A later attestation cannot retroactively make
old evidence eligible. Recovery-evidence cards expose only a short derived
account/region reference to administrators; the owner may see their own coarse
region. Normalized recovered values remain in the separate `not_applied`
quarantine.

## Conflict measurement

The fixed `observer_recipe_conflict_slo_v1` policy uses a rolling seven-day
window. For each recipe it counts only the latest packaged-structured-oracle
trial for each:

`account pseudonym + exact retailer SKU + layout fingerprint + recipe stage`

The SLO becomes measurable only after all of these gates are met:

- at least 10 eligible trials;
- at least 3 externally eligible account pseudonyms;
- at least 2 eligible coarse regions.

A breach additionally requires:

- at least 2 conflict trials;
- conflicts from at least 2 eligible accounts;
- conflicts from at least 2 eligible regions;
- a conflict rate greater than 10 percent.

Both packaged and oracle conflict states are visible in the measurement.
Packaged evidence remains authoritative and one packaged conflict still kills
distribution immediately, regardless of eligibility, because continuing to
serve a known-conflicting reader would be unsafe. The regional SLO is therefore
the multi-party enforcement path for oracle conflicts not already covered by
that immediate boundary.

## Enforcement boundary

An SLO breach can atomically:

- set the affected recipe's kill switch;
- clear its online signature;
- move it to `disabled` with
  `regional_oracle_conflict_slo_breach`;
- append lifecycle and redacted aggregate audit receipts.

It cannot sign or promote a recipe, fill an observation, apply recovery
evidence, change catalog identity, qualify a retailer, create a mission or job,
navigate Chrome, click, reserve spend, check out, or submit an order. Remote
recipes remain structurally incapable of mutation.

## Operator and user visibility

The admin observer workspace reports the policy thresholds, bounded current
eligibility counts, per-recipe measurements, and breach state without raw
account or proof hashes. The user recovery workspace explains whether evidence
was externally eligible or remains private review-only; eligibility is an
automatic hosted concern, not another setup step.

Health and snapshot capabilities report the seam and SLO as implemented while
separately reporting the production identity/risk provider as unconfigured.
This distinction must remain visible until a real independent provider is
deployed and monitored.
