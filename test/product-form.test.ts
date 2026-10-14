import assert from "node:assert/strict";
import test from "node:test";
import { productFormOf, productFormsFit } from "../packages/domain/src/product-form.js";
import { ProductTextIndex } from "../packages/domain/src/product-text-match.js";

// Kevin, 2026-10-13: "booster bundle is booster bundle not display box. Please research and look up
// terminology for pokemon, riftbound, lorcana, one piece, gundam, and dragon ball z to help identify
// product fitment based on keywords." Research notes and sources: docs/PRODUCT_FORMS.md.

test("each game's product kinds are read from names as stores and Discord monitors write them", () => {
  const kinds: Array<[string, string]> = [
    // Pokémon
    ["Pokémon TCG: Mega Evolution—Pitch Black Booster Bundle", "booster_bundle"],
    ["Pokemon Mega Evolution Pitch Black Booster Display Box", "booster_box"],
    ["Pokemon Scarlet Violet Destined Rivals Booster Box", "booster_box"],
    ["Mega Evolution Booster Display (36 packs)", "booster_box"],
    ["Mega Evolution Enhanced Booster Display Box", "enhanced_booster_box"],
    ["Pokemon 151 Booster Bundle Display", "booster_bundle_display"],
    ["Prismatic Evolutions Booster Bundle Case", "booster_bundle_case"],
    ["Pokemon 30th Celebration Elite Trainer Box", "etb"],
    ["Ascended Heroes ETB", "etb"],
    ["Pokemon Center Elite Trainer Box", "pc_etb"],
    ["Ascended Heroes PC ETB", "pc_etb"],
    ["Pokemon Center restock: Ascended Heroes Booster Bundle", "booster_bundle"],
    ["Pokemon Prismatic Evolutions Super-Premium Collection - 15 Booster Packs", "super_premium_collection"],
    ["Pokemon 30th Celebration Ultra-Premium Collection", "ultra_premium_collection"],
    ["Pokemon Mega Greninja ex Premium Collection", "premium_collection"],
    ["Charizard ex Special Collection", "special_collection"],
    ["Pokemon 30th Celebration Poster Collection", "poster_collection"],
    ["Pokemon 30th Celebration Knock Out Collection", "knock_out_collection"],
    ["Pokémon TCG: 30th Celebration Mini Tin", "mini_tin"],
    ["Pokemon Mega Moonlit Tin", "tin"],
    ["Pokemon Hop's Zacian ex Box", "ex_box"],
    ["Pokemon Mega Greninja ex League Battle Deck", "league_battle_deck"],
    ["Destined Rivals Build & Battle Box", "build_battle_box"],
    ["Destined Rivals 3 Pack Blister", "three_pack_blister"],
    ["Pokemon Destined Rivals Sleeved Booster", "sleeved_booster"],
    ["Pokemon Scarlet & Violet Obsidian Flames Booster Pack", "booster_pack"],
    // Disney Lorcana
    ["Disney Lorcana Hyperia City Booster Box Display", "booster_box"],
    ["Disney Lorcana Fabled Sleeved Booster", "sleeved_booster"],
    ["Disney Lorcana Attack of the Vine Illumineer's Trove", "illumineers_trove"],
    ["Disney Lorcana Rapunzel Collector Starter Set", "collection_starter_set"],
    ["Disney Lorcana Hyperia City 2-Player Starter Set", "two_player_starter_set"],
    ["Disney Lorcana Quest of Wonders: Illumineer's Lorebook", "book"],
    ["Disney Lorcana Winterspell Gift Set", "gift_set"],
    // Riftbound
    ["Riftbound League of Legends - Fiora Champion Deck", "champion_deck"],
    ["Riftbound Vendetta Showdown Deck - Zed vs Shen", "showdown_deck"],
    ["Riftbound League of Legends Unleashed Booster Blister", "sleeved_booster"],
    ["Riftbound Origins: Proving Grounds", "proving_grounds"],
    ["Riftbound Origins Booster Display", "booster_box"],
    // One Piece, Gundam, Dragon Ball
    ["One Piece The Time of Battle Booster Box (OP-16)", "booster_box"],
    ["One Piece The World's Strongest Warriors Double (DP-17)", "double_pack_set"],
    ["One Piece Illustration Box Vol. 3", "illustration_box"],
    ["One Piece Ultra Deck The Three Brothers ST-13", "ultra_deck"],
    ["One Piece Card Game Case (12 Boxes) OP-16", "case"],
    ["Gundam TCG: Phantom Aria Booster Box [GD04]", "booster_box"],
    ["Gundam Card Game Deck Build Box SC01 Freedom Ascension", "deck_build_box"],
    ["Gundam Special Booster Bundle EVX09", "special_booster_bundle"],
    ["DBS Fusion World Dual Evolution Booster Box FB09", "booster_box"],
    ["Dragon Ball Z Playpaks Saiyan Saga Blaster Box", "blaster_box"],
    // Magic: The Gathering in the catalog
    ["Magic: The Gathering - The Hobbit Collector Booster Box", "collector_booster_box"],
    ["MTG Secrets of Strixhaven Commander Deck", "commander_deck"],
    // No kind named: a set code alone, or no card product.
    ["One Piece the World's Strongest Warriors Booster OP-17", ""],
    ["NeeDoh Gummy Bear", ""],
    ["Pokemon UPC 196214112568", ""]
  ];
  for (const [name, kind] of kinds) assert.equal(productFormOf(name), kind, name);
});

test("different kinds are never one product; a name that gives only the family fits any of it", () => {
  assert.equal(productFormsFit("booster_bundle", "booster_box"), false, "a Booster Bundle is not a Booster Display Box");
  assert.equal(productFormsFit("etb", "pc_etb"), false);
  assert.equal(productFormsFit("mini_tin", "tin"), false);
  assert.equal(productFormsFit("premium_collection", "super_premium_collection"), false);
  assert.equal(productFormsFit("champion_deck", "showdown_deck"), false);
  assert.equal(productFormsFit("collection", "premium_collection"), true);
  assert.equal(productFormsFit("blister", "three_pack_blister"), true);
  assert.equal(productFormsFit("blister", "sleeved_booster"), true, "Lorcana's and Riftbound's blister is the sleeved booster");
  assert.equal(productFormsFit("bundle", "booster_bundle"), true);
  assert.equal(productFormsFit("", "booster_box"), true, "a name that gives no kind fits any");
});

test("a message matches only a product of its own kind", () => {
  const titles = [
    "Pokemon Pitch Black Booster Bundle", "Pokemon Mega Evolution Pitch Black Booster Display Box",
    "Pokemon Prismatic Evolutions Super Premium Collection", "Pokemon Prismatic Evolutions Booster Bundle",
    "Pokemon Prismatic Evolutions Elite Trainer Box", "Pokemon Prismatic Evolutions Pokemon Center Elite Trainer Box",
    "Pokemon Lumiose City Mini Tin", "Riftbound League of Legends Unleashed Booster Blister",
    "Riftbound League of Legends Unleashed Champion Deck", "NeeDoh Gummy Bear"
  ];
  const index = new ProductTextIndex(titles.map((title, position) => ({ id: `v${position}`, title })));
  const matched = (text: string) => {
    const result = index.match(text);
    return result.confident ? result.best?.title : null;
  };
  // Kevin's PC, 2026-10-13: these two fitted the bundle and the display box equally.
  assert.equal(matched("Pokémon TCG: Mega Evolution—Pitch Black Booster Bundle"), "Pokemon Pitch Black Booster Bundle");
  assert.equal(matched("Pokémon TCG: Mega Evolution—Pitch Black Booster Display Box"), "Pokemon Mega Evolution Pitch Black Booster Display Box");
  // "yes those are the same items": series words and a pack count don't make another product.
  assert.equal(matched("Pokemon TCG: Scarlet & Violet—Prismatic Evolutions Super-Premium Collection - 15 Booster Packs"),
    "Pokemon Prismatic Evolutions Super Premium Collection");
  assert.equal(matched("Prismatic Evolutions Pokemon Center ETB"), "Pokemon Prismatic Evolutions Pokemon Center Elite Trainer Box");
  assert.equal(matched("Prismatic Evolutions ETB restock"), "Pokemon Prismatic Evolutions Elite Trainer Box");
  assert.equal(matched("Riftbound Unleashed Sleeved Booster Pack (Styles May Vary)"), "Riftbound League of Legends Unleashed Booster Blister");
  // A kind Yoink has no product of: no match, though the closest is still offered to link.
  const tin = index.match("Pokemon Lumiose City Tin");
  assert.equal(tin.confident, false);
  assert.match(tin.reason, /is another kind of product/);
  assert.equal(tin.ranked[0]?.title, "Pokemon Lumiose City Mini Tin");
  assert.equal(matched("Prismatic Evolutions Booster Box"), null, "no display box of that set in Yoink");
});
