# Selected-offer identity

Yoink 0.25.0 adds a read-only selected-offer scope to sanitized retailer
observations and community inventory assertions. It prevents two sizes, colors,
editions, sellers, fulfillment modes, or localities from becoming one stock
state merely because they share a product page.

## Accepted browser contract

The packaged observer may return only:

- schema version `1`
- selection state `exact`, `listing_only`, or `unresolved`
- a public child-offer key equal to the exact retailer SKU already verified by
  the packaged URL adapter
- selected `size`, `color`, `edition`, `language`, `pack`, `condition`,
  `finish`, and `style` values

The scope excludes opaque offer IDs, page HTML/text, screenshots, URLs, form
payloads, cookies, account data, postal addresses, payment data, and precise
location. Amazon's live offer token remains ephemeral and is never used as a
community identifier.

## Server authority

The server reconstructs the durable scope. It rejects a child key that differs
from the server-verified retailer SKU, rejects every unknown dimension,
normalizes attribute values, and derives the fingerprint. The companion cannot
submit a chosen fingerprint.

The complete community key is:

```text
retailer + retailer SKU + selected-offer fingerprint
+ seller type/name + fulfillment + consented location scope
```

Country and region scopes remain explicit consent configuration. Pickup
requires a one-way store fingerprint. Those fields are not inferred from page
copy and are never folded into product equivalence.

## Fail-closed states

`exact` assertions may participate in the local advisory projection.
`listing_only` and `unresolved` assertions are retained as sanitized evidence
but immediately quarantined, receive zero identity confidence, and cannot
publish availability. For each exact key, only each contributor's latest
eligible assertion is a current vote. Material price or availability
disagreement among current independent votes is quarantined, while a newer
assertion may supersede that contributor's own stale state. Prices use the
median after three current price votes and retain only bounded range metadata.
When a packaged observer recognizes variant controls but cannot bind one unique
selection, its
normal sanitized diagnostic path reports `selected_offer_binding_unresolved`
to the adapter repair queue.

Target, Walmart, Amazon, Best Buy, Ravensburger, Books-A-Million, Premium
Bandai, and Pokémon Center currently treat their exact public item IDs as child
identities. Disney Store, Riot Games Merch, Fanatics, Kohl's, and Macy's remain
`listing_only` unless the packaged observer sees one unique selected allowlisted
dimension. A future observer version must independently bind any distinct
style-level child ID before the server will accept it.

## Non-goals

This scope is advisory evidence only. It does not change catalog equivalence,
mission targets, action jobs, retailer qualification, checkout, drawing entry,
order submission, or mutation authority. It is also not contributor
reputation, Sybil resistance, a global community quorum, or proof that a
consented locality matches the live offer. The one-vote projection is still
tenant-local and does not provide pseudonymous cross-account identity,
reputation, or Sybil resistance; those remain roadmap gates.
