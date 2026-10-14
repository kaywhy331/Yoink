# Product kinds for name matching

Kevin, 2026-10-13: "booster bundle is booster bundle not display box. Please research and look up terminology for
pokemon, riftbound, lorcana, one piece, gundam, and dragon ball z to help identify product fitment based on keywords."

`packages/domain/src/product-form.ts` reads which kind of sealed product a name or message is about.
`ProductTextIndex.match` (product-text-match.ts) only matches a message to a product of a kind that fits. A name that
states no kind ("Booster OP-17") fits any kind. "Collection", "Blister" and "Bundle" on their own fit any kind of
their family. Rules run most specific first. The tests are in `test/product-form.test.ts`.

The research below was done on 2026-10-13. Sources are listed at the end. Pack counts are English retail.

## Pokémon TCG

| Kind | Read from | Contents |
|---|---|---|
| Booster Pack / Sleeved Booster | booster pack · sleeved booster | 1 pack (10 cards + Energy) |
| Booster Bundle | booster bundle | 6 packs |
| Booster Display Box | booster box · booster display (box) · display box · 36 pack | 36 packs |
| Enhanced Booster Display / Half Box | enhanced booster display · half booster box · 18 pack box | 36 packs + promo / 18 packs |
| Elite Trainer Box | elite trainer box · ETB | 9 packs (Scarlet & Violet, Mega Evolution) |
| Pokémon Center ETB | Pokemon Center Elite Trainer Box · PC ETB | 11 packs + 2 promos |
| ETB Plus | elite trainer box plus · ETB+ | Sword & Shield era |
| Mini Tin / Tin / Stacking Tin / Poké Ball Tin | mini tin · tin · stacking tin · poke ball tin | 2 / 4 / 3 / 3 packs |
| Blisters | checklane · 1-pack blister · 2-pack blister · 3 pack blister · premium checklane | 1 / 2 / 3 packs + promo or coin |
| Collections | premium · super-premium (SPC) · ultra-premium (UPC) · special · poster · binder · pin · figure · tech sticker · knock out · illustration · ex box | Each is a different product |
| Decks | league battle deck · battle deck · deluxe battle deck · battle academy · build & battle box / stadium | Different products |
| Multi-unit | booster box case (6) · ETB case (10) · booster bundle display (10) / case (25) · mini tin display (10) | Different products from one unit |

Notes:
- "Pokémon Center" before "Elite Trainer Box" names the PC ETB. Anywhere else it names the store.
- "UPC" followed by digits is a barcode.
- Series words ("Scarlet & Violet—", "Mega Evolution—") and pack counts ("15 Booster Packs") don't change the kind. The matcher counts series words at a fifth and drops booster-pack counts.
- Special sets (151, Prismatic Evolutions, 30th Celebration) had no English 36-pack booster box.

## Disney Lorcana

| Kind | Read from | Contents |
|---|---|---|
| Booster Pack / Sleeved Booster | booster pack · sleeved booster · blister | 1 pack (12 cards) |
| Booster Display | booster box · booster display · booster pack display | 24 packs |
| Booster Case | booster case | 4 displays |
| Illumineer's Trove | illumineer's trove · trove | 8 packs + dice and accessories |
| Starter Deck / 2-Player Starter Set / Collection Starter Set | starter deck · 2-player starter set · collector/collection starter set | 1 deck / 2 decks (set 12 on) / 4 boosters + portfolio |
| Gift Set · Illumineer's Quest · Gateway · Prerelease box | as named | Different products |
| Lorebook | lorebook | A book, not cards |

Notes:
- "Illumineer's", "Starter", "Collector", "Quest" and "Set" alone are never enough to name a kind.
- "Wonder Bundle" is an unconfirmed product and is read as a plain bundle.

## Riftbound (League of Legends TCG)

| Kind | Read from | Contents |
|---|---|---|
| Booster Pack / Sleeved Booster | booster pack · sleeved booster · booster blister · blister pack | 1 pack |
| Booster Display | booster display · booster box | 24 packs |
| Champion Deck | champion deck | 1 precon deck + booster |
| Champion Deck Display | champion deck … display | 4 copies of one deck |
| Showdown Deck | showdown (deck) | 2 decks ("Zed vs Shen") |
| Proving Grounds · Vault · Box Set · Pre-Rift Kit | as named | Different products |

## One Piece, Gundam, Dragon Ball Super (Bandai)

| Kind | Read from | Contents |
|---|---|---|
| Booster Box | booster box · display · 24 pack | 24 packs |
| Case | case · 12 boxes | 12 boxes |
| Double Pack Set (One Piece) | double pack (set) · DP-n | 2 packs + DON!! card |
| Tin Pack Set / Mini Case Set (One Piece) | tin pack set · mini case set | 2 packs + extras |
| Illustration Box · Gift Collection · Premium Card Collection | as named | Not booster boxes |
| Starter Deck / Starter Deck EX / Ultra Deck (One Piece) / Ultimate Deck (Gundam, DBS) | as named | Different decks |
| Deck Build Box · Special Booster Bundle · Edition Beta · Gundam Assemble (Gundam) | as named | Not booster boxes or booster bundles |
| Premium / Special Pack Set · Draft Box · Expert Deck (DBS Masters) | as named | |

Notes:
- A set code (OP-17, GD04, FB09, EB-02, PRB-02) names the cards, not the kind. "Booster OP-17" may be a pack or a box.
- Double Pack numbers don't follow booster numbers: the OP-17 Double Pack Set is DP-12.
- ST01 is a Gundam starter deck but a Fusion World Story Booster.
- No Dragon Ball Z card game makes sealed product today. "Dragon Ball Z" in a listing usually means Dragon Ball Super. Cryptozoic's DBZ Playpaks "Blaster Box" is not a booster box.

## Magic: The Gathering (in the catalog)

Collector Booster Box, Play Booster Box, Draft Booster Box, Commander Deck and Scene Box are each their own kind.

## Sources

- Pokémon:
  - pokemon.com product showcases (https://www.pokemon.com/us/pokemon-news/pokemon-tcg-mega-evolution-product-showcase, and the July and March 2026 release pages)
  - Prismatic Evolutions SPC gallery page
  - TCGplayer seller blog on 30th Celebration
  - codedyellow.com product guide
  - cardgamer.com tin types
  - pricecharting.com set pages
  - case counts from flipsidegaming.com, cardcodex.com and folio.fyi
- Lorcana:
  - disneylorcana.com news
  - starcitygames.com set coverage
  - wargamer.com set list
  - Amazon listing B0FM5V92TN (24 × 12 display)
  - tlamagames.com (2-Player Starter Set)
  - mushureport.com (Gateway)
- Riftbound:
  - playriftbound.com roadmap and set overviews
  - wiki.leagueoflegends.com Riftbound set pages
  - riftbound.gg
  - GameStop sleeved booster listing
  - tcgplayer.com product 635372 (Champion Deck Display)
- Bandai:
  - en.onepiece-cardgame.com product pages (OP-17, DP-12, TS-01/02/03, IB-01/03, Gift Collection, ST-10, PRB-02)
  - gundam-gcg.com/en products (GD04, ST01, ST09, EVX09)
  - dbs-cardgame.com Fusion World and Masters product pages
  - Target and Walmart listings
  - icv2.com (Cryptozoic DBZ Playpaks)
