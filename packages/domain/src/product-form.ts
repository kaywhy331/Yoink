/**
 * Which kind of sealed product a name or message is about (Kevin, 2026-10-13:
 * "booster bundle is booster bundle not display box. Please research and look
 * up terminology for pokemon, riftbound, lorcana, one piece, gundam, and
 * dragon ball z to help identify product fitment based on keywords").
 *
 * The rules come from each publisher's product pages and the names stores and
 * TCGplayer use (research of 2026-10-13). They are tried most specific first:
 * "Booster Bundle Display" before "Booster Bundle" before "Booster Display",
 * "Pokémon Center Elite Trainer Box" before "Elite Trainer Box", "Mini Tin"
 * before "Tin". Two different kinds are never the same product: a Booster
 * Bundle (6 packs) is not a Booster Display Box (36 packs).
 */

interface FormRule {
  form: string;
  pattern: RegExp;
}

// Most specific first. Each pattern runs on folded text: lowercase, accents and
// dashes folded, "&" as "and", brackets and punctuation as spaces.
const RULES: readonly FormRule[] = Object.freeze([
  // Several units in one carton.
  { form: "booster_box_case", pattern: /\bbooster (?:display )?box(?:es)? case\b|\bbooster display case\b/ },
  { form: "etb_case", pattern: /\b(?:elite trainer box|etb)(?:es)? case\b/ },
  { form: "booster_bundle_case", pattern: /\bbooster bundles? case\b/ },
  { form: "booster_bundle_display", pattern: /\bbooster bundles? display\b/ },
  { form: "sleeved_booster_case", pattern: /\bsleeved boosters? (?:case|display)\b/ },
  { form: "mini_tin_display", pattern: /\bmini tins? display\b/ },
  { form: "build_battle_display", pattern: /\bbuild and battle (?:box(?:es)? )?display\b/ },
  { form: "champion_deck_display", pattern: /\bchampion deck(?: [a-z]+)? display\b/ },
  { form: "mini_case_set", pattern: /\bmini case set\b/ },
  { form: "case", pattern: /\b(?:sealed |factory sealed |booster |display )?case\b(?! fresh)|\b12 ?box(?:es)?\b/ },
  // One Piece, Gundam and Dragon Ball Super (Bandai product pages and store names). A set code
  // ("OP-17", "GD04", "FB09") names the cards, not the kind: "Booster OP-17" may be a pack or a box.
  { form: "special_booster_bundle", pattern: /\bspecial booster bundle\b/ },
  { form: "deck_build_box", pattern: /\bdeck build box\b/ },
  { form: "illustration_box", pattern: /\billustration box\b/ },
  { form: "gift_collection", pattern: /\bgift collection\b/ },
  { form: "premium_card_collection", pattern: /\bpremium card collection\b/ },
  { form: "double_pack_set", pattern: /\bdouble pack(?: set)?\b|\bdp ?\d{1,2}\b/ },
  { form: "tin_pack_set", pattern: /\btin pack set\b/ },
  { form: "premium_pack_set", pattern: /\bpremium pack set\b/ },
  { form: "special_pack_set", pattern: /\bspecial pack set\b/ },
  { form: "treasure_boosters_set", pattern: /\btreasure boosters? set\b/ },
  { form: "draft_box", pattern: /\bdraft box\b/ },
  { form: "anniversary_set", pattern: /\banniversary (?:set|box)\b/ },
  { form: "edition_beta", pattern: /\bedition beta\b/ },
  { form: "assemble_starter_set", pattern: /\bgundam assemble\b/ },
  { form: "ultra_deck", pattern: /\bultra deck\b/ },
  { form: "ultimate_deck", pattern: /\bultimate deck\b/ },
  { form: "starter_deck_ex", pattern: /\bstarter deck ex\b/ },
  { form: "expert_deck", pattern: /\bexpert deck\b/ },
  // Cryptozoic's Dragon Ball Z Playpaks are activity packs, not a Bandai booster box.
  { form: "blaster_box", pattern: /\bblaster box\b/ },
  { form: "gravity_feed", pattern: /\bgravity feed\b/ },
  // Magic: The Gathering kinds the catalog holds, so they don't pass for each other.
  { form: "collector_booster_box", pattern: /\bcollector booster (?:display )?box\b|\bcollector booster display\b/ },
  { form: "play_booster_box", pattern: /\bplay booster (?:display )?box\b|\bplay booster display\b/ },
  { form: "draft_booster_box", pattern: /\bdraft booster (?:display )?box\b|\bdraft booster display\b/ },
  { form: "commander_deck", pattern: /\bcommander decks?\b/ },
  { form: "scene_box", pattern: /\bscene box\b/ },
  // Pokémon (pokemon.com product pages; TCGplayer and store names).
  { form: "trick_or_trade", pattern: /\btrick or trade\b/ },
  { form: "booster_art_bundle", pattern: /\b(?:booster pack )?art bundle\b/ },
  { form: "etb_plus", pattern: /\belite trainer box plus\b|\betb ?(?:\+|plus)/ },
  { form: "pc_etb", pattern: /\bpokemon center (?:exclusive )?(?:elite trainer box|etb)\b|\bpc ?etb\b|\belite trainer box pokemon center\b/ },
  { form: "etb", pattern: /\belite trainer box\b|\betb\b/ },
  { form: "enhanced_booster_box", pattern: /\benhanced booster (?:display )?box\b|\benhanced booster display\b/ },
  { form: "half_booster_box", pattern: /\bhalf booster box\b|\b18 ?(?:pack|ct) (?:booster )?box\b/ },
  { form: "booster_box", pattern: /\bbooster (?:pack )?(?:display )?box\b|\bbooster (?:pack )?display\b|\bdisplay box\b|\b(?:36|24) ?(?:pack|ct)\b/ },
  { form: "booster_bundle", pattern: /\bbooster bundle\b|\b6 ?pack bundle\b/ },
  { form: "build_battle_stadium", pattern: /\bbuild and battle stadium\b|\bb ?(?:and|n) ?b stadium\b/ },
  { form: "build_battle_box", pattern: /\bbuild and battle\b|\bb ?n ?b\b|\bprerelease kit\b/ },
  { form: "premium_checklane_blister", pattern: /\bpremium checklane\b/ },
  { form: "three_pack_blister", pattern: /\b(?:3|three) ?(?:pack|booster) blister\b|\bthree booster pack and promo card blister\b|\bpin blister\b/ },
  { form: "two_pack_blister", pattern: /\b(?:2|two) ?pack blister\b/ },
  { form: "checklane_blister", pattern: /\bcheck ?lane(?: blister)?\b|\b(?:single|1) ?pack blister\b/ },
  // Lorcana's and Riftbound's single pack in a retail sleeve, also sold as a "Booster Blister".
  { form: "sleeved_booster", pattern: /\bsleeved (?:blister )?(?:booster|pack)\b|\b(?<!\d |pack |three |two )booster blister\b|\bblister pack\b/ },
  { form: "mini_tin", pattern: /\bmini tins?\b/ },
  { form: "stacking_tin", pattern: /\bstacking tins?\b/ },
  { form: "poke_ball_tin", pattern: /\bpoke ?ball tins?\b/ },
  { form: "collector_chest", pattern: /\bcollector'?s? chest\b|\blunch box\b/ },
  { form: "ultra_premium_collection", pattern: /\bultra ?premium collection\b|\bupc\b(?! ?\d)/ },
  { form: "super_premium_collection", pattern: /\bsuper ?premium collection\b|\bspc\b/ },
  { form: "premium_poster_collection", pattern: /\bpremium poster collection\b/ },
  { form: "premium_figure_collection", pattern: /\bpremium figure collection\b/ },
  { form: "premium_tournament_collection", pattern: /\bpremium tournament collection\b/ },
  { form: "premium_collection", pattern: /\bpremium collection\b/ },
  { form: "special_collection", pattern: /\bspecial collection\b/ },
  { form: "poster_collection", pattern: /\bposter collection\b/ },
  { form: "binder_collection", pattern: /\bbinder collection\b/ },
  { form: "deluxe_pin_collection", pattern: /\bdeluxe pin collection\b/ },
  { form: "pin_collection", pattern: /\bpin collection\b/ },
  { form: "figure_collection", pattern: /\bfigure collection\b/ },
  { form: "tech_sticker_collection", pattern: /\btech sticker collection\b/ },
  { form: "knock_out_collection", pattern: /\bknock ?out collection\b/ },
  { form: "illustration_collection", pattern: /\billustration collection\b/ },
  { form: "deck_crafter_collection", pattern: /\bdeck crafter'?s collection\b/ },
  { form: "ex_box", pattern: /\bex box\b/ },
  { form: "league_battle_deck", pattern: /\bleague battle deck\b/ },
  { form: "deluxe_battle_deck", pattern: /\bdeluxe battle deck\b/ },
  { form: "battle_academy", pattern: /\bbattle academy\b/ },
  { form: "trainers_toolkit", pattern: /\btrainer'?s toolkit\b/ },
  { form: "surprise_box", pattern: /\bsurprise box\b/ },
  { form: "mini_portfolio", pattern: /\bmini portfolio\b/ },
  { form: "battle_deck", pattern: /\bbattle deck\b/ },
  // Disney Lorcana (Ravensburger product pages and store names).
  { form: "collector_booster", pattern: /\bcollector boosters?\b/ },
  { form: "illumineers_trove", pattern: /\billumineer'?s trove\b|\btrove\b/ },
  { form: "illumineers_quest", pattern: /\billumineer'?s quest\b/ },
  { form: "two_player_starter_set", pattern: /\b(?:2|two) ?player (?:starter (?:set|deck)|deck)\b/ },
  { form: "collection_starter_set", pattern: /\bcollect(?:ion|or) starter (?:set|kit)\b/ },
  { form: "gift_set", pattern: /\bgift set\b/ },
  { form: "gateway", pattern: /\bgateway\b/ },
  { form: "prerelease_box", pattern: /\bpre ?release (?:box|pack|kit)\b/ },
  { form: "book", pattern: /\blorebook\b/ },
  // Riftbound: League of Legends (Riot product pages and store names).
  { form: "showdown_deck", pattern: /\bshowdown(?: decks?)?\b/ },
  { form: "champion_deck", pattern: /\bchampions? decks?\b/ },
  { form: "proving_grounds", pattern: /\bproving grounds\b/ },
  { form: "vault", pattern: /\bvault\b/ },
  { form: "pre_rift_kit", pattern: /\bpre ?rift\b/ },
  { form: "box_set", pattern: /\bbox set\b/ },
  // Kinds a name may give without saying which: they fit any kind of their family.
  { form: "starter_deck", pattern: /\bstarter decks?\b/ },
  { form: "bundle", pattern: /\bbundles?\b/ },
  { form: "tin", pattern: /\btins?\b/ },
  { form: "blister", pattern: /\bblisters?\b/ },
  { form: "collection", pattern: /\bcollection\b/ },
  { form: "booster_pack", pattern: /\bbooster packs?\b|\bsingle booster\b|\bloose pack\b/ }
]);

/** A kind that names only its family ("a Collection", "a Blister") fits any kind of that family. */
const FAMILY_OF: Readonly<Record<string, string>> = Object.freeze({
  collection: "collection",
  blister: "blister",
  bundle: "bundle"
});
const FAMILY_MEMBERS: Readonly<Record<string, RegExp>> = Object.freeze({
  collection: /(?:_collection|^ex_box|^collector_chest)$/,
  // Lorcana's and Riftbound's blister is the sleeved booster.
  blister: /(?:_blister|^sleeved_booster)$/,
  bundle: /_bundle$/
});

/** Lowercase, accents, dashes and "&" folded, punctuation as spaces. */
function folded(value: string): string {
  return ` ${String(value ?? "")} `
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[‐-―\-—–]/g, " ")
    .replace(/[^a-z0-9'+]+/g, " ")
    .replace(/\s+/g, " ");
}

/** The kind of sealed product a name or message names, or "" when it names none. */
export function productFormOf(value: string): string {
  const text = folded(value);
  return RULES.find((rule) => rule.pattern.test(text))?.form ?? "";
}

/** Whether two kinds can be the same product: either names no kind, they match, or one names only the other's family. */
export function productFormsFit(first: string, second: string): boolean {
  if (!first || !second || first === second) return true;
  const family = FAMILY_OF[first] ?? FAMILY_OF[second];
  if (!family) return false;
  const specific = FAMILY_OF[first] ? second : first;
  return FAMILY_MEMBERS[family]!.test(specific);
}
