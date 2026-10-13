import assert from "node:assert/strict";
import test from "node:test";
import { ProductTextIndex, productTextKey, productTextTokens } from "../packages/domain/src/product-text-match.js";
import {
  discordNotificationChannel,
  discordToast,
  discordToastApp,
  readDiscordNotification
} from "../packages/sources/src/discord-notification.js";
import { parseWindowsToast, windowsFiletimeMs } from "../packages/sources/src/windows-toast.js";
import { browserToastXml, discordDesktopToastXml } from "./helpers/discord-toasts.js";

// Kevin, 2026-10-12: "make it discord signal will be able to be captured by
// various notifications that populates to my windows notification tab and be
// able to trace the listing to the yoink product."

test("a Windows toast's lines, site line, entities and encodings read as Windows shows them", () => {
  const desktop = parseWindowsToast(new TextEncoder().encode(discordDesktopToastXml("Restock Bot (#target-restocks, Cook Group)",
    "Ascended Heroes ETB & Tin <LIVE> \"now\"\nhttps://www.target.com/p/-/A-94972381")));
  assert.deepEqual(desktop.texts.map((line) => line.text), [
    "Restock Bot (#target-restocks, Cook Group)",
    "Ascended Heroes ETB & Tin <LIVE> \"now\"\nhttps://www.target.com/p/-/A-94972381"
  ]);
  assert.equal(desktop.attribution, "");
  const browser = parseWindowsToast(browserToastXml("Bot (#drops, Group)", "It&apos;s live &#x1F525; &#128293;", "discord.com"));
  assert.equal(browser.attribution, "discord.com");
  assert.equal(browser.texts[1]?.text, "It's live 🔥 🔥");
  assert.match(browser.launch, /^0\|0\|Default/);
  // A byte-order mark and UTF-16 payloads read the same.
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<toast><visual><binding><text>Hi</text></binding></visual></toast>")]);
  assert.equal(parseWindowsToast(bom).texts[0]?.text, "Hi");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<toast><text>Pokémon</text></toast>", "utf16le")]);
  assert.equal(parseWindowsToast(new Uint8Array(utf16)).texts[0]?.text, "Pokémon");
  assert.deepEqual(parseWindowsToast(null).texts, []);
  // FILETIME: 100 ns ticks since 1601.
  const at = Date.parse("2026-10-13T05:00:00.000Z");
  assert.equal(windowsFiletimeMs(BigInt(at + 11_644_473_600_000) * 10_000n), at);
  assert.ok(Number.isNaN(windowsFiletimeMs(0n)));
  assert.ok(Number.isNaN(windowsFiletimeMs(Number.NaN)));
});

test("only Discord's app or a browser showing discord.com counts as Discord, never message text", () => {
  const plain = { attribution: "" };
  assert.equal(discordToastApp("com.squirrel.Discord.Discord", plain), "desktop");
  assert.equal(discordToastApp("com.squirrel.DiscordPTB.DiscordPTB", plain), "desktop");
  assert.equal(discordToastApp("Brave", { attribution: "discord.com" }), "browser");
  assert.equal(discordToastApp("Chrome", { attribution: "canary.discord.com" }), "browser");
  assert.equal(discordToastApp("Brave", { attribution: "trackalacker.com" }), null);
  assert.equal(discordToastApp("Microsoft.Office.OUTLOOK.EXE.15", plain), null);
  assert.equal(discordToastApp("Brave", { attribution: "discord.com.evil.example" }), null);
  const outlook = parseWindowsToast(discordDesktopToastXml("Discord (#restocks, Group)", "Walmart restock"));
  assert.equal(discordToast("Microsoft.Office.OUTLOOK.EXE.15", outlook), null);
  const toast = discordToast("Brave", parseWindowsToast(browserToastXml("Bot (#drops, Group)", "Restock", "discord.com")));
  assert.deepEqual(toast, { app: "browser", title: "Bot (#drops, Group)", body: "Restock" });
});

test("Discord's notification title names the sender, channel and server", () => {
  assert.deepEqual(discordNotificationChannel("Restock Bot (#target-restocks, Cook Group (US))"), {
    key: "cook group (us)\u0000target-restocks",
    name: "#target-restocks · Cook Group (US)",
    author: "Restock Bot",
    channel: "target-restocks",
    server: "Cook Group (US)"
  });
  assert.equal(discordNotificationChannel("Bot (#drops)").name, "#drops");
  assert.equal(discordNotificationChannel("A Friend").name, "Direct messages");
  assert.equal(discordNotificationChannel("A Friend (Weekend crew)").name, "Weekend crew");
});

test("a Discord message gives its store links, item numbers, stores, price, stock words and product words", () => {
  const read = (title: string, body: string) => readDiscordNotification({ app: "desktop", title, body });
  const linked = read("Restock Bot (#target-restocks, Cook Group)",
    "**Pokemon Ascended Heroes ETB** is LIVE! $49.99 :fire:\nhttps://www.target.com/p/pokemon-ascended-heroes/-/A-94972381?ref=x.");
  assert.deepEqual(linked.links, [{ retailerId: "target", retailerSku: "94972381", canonicalUrl: "https://www.target.com/p/-/A-94972381" }]);
  assert.deepEqual(linked.stores, ["target"]);
  assert.equal(linked.priceCents, 4999);
  assert.equal(linked.eventType, "restock");
  assert.equal(linked.availability, "in_stock");
  assert.equal(linked.relevant, true);
  assert.equal(linked.productText, "Pokemon Ascended Heroes ETB is LIVE!");
  assert.match(linked.text, /^Restock Bot \(#target-restocks, Cook Group\): \*\*Pokemon Ascended Heroes ETB\*\*/);

  const labelled = read("Monitor (#bestbuy, Group)", "Disney Lorcana Fabled Sleeved Booster\nSKU: 6680138\nPrice: $5.99\nSeller: Best Buy");
  assert.deepEqual(labelled.stores, ["bestbuy"]);
  assert.deepEqual(labelled.identifiers, [{ retailerId: "bestbuy", retailerSku: "6680138", label: "SKU" }]);
  assert.equal(labelled.priceCents, 599);
  assert.equal(labelled.productText, "Disney Lorcana Fabled Sleeved Booster");
  // A Best Buy channel is a store-alert channel even without stock words.
  assert.equal(labelled.relevant, true);

  const amazon = read("Deals (#amazon, Group)", "NeeDoh Teenie Color Change B0GRSZ5TDC UPC: 819865026612");
  assert.deepEqual(amazon.identifiers, [{ retailerId: "amazon", retailerSku: "B0GRSZ5TDC", label: "ASIN" }]);
  assert.deepEqual(amazon.gtins, ["00819865026612"]);

  const sold = read("Bot (#walmart, Group)", "Ascended Heroes ETB went OOS at Walmart");
  assert.equal(sold.eventType, "unknown");
  assert.equal(sold.availability, "out_of_stock");
  assert.equal(sold.relevant, true);

  const back = read("Bot (#chat, Group)", "Ascended Heroes ETB back in stock at Walmart");
  assert.equal(back.availability, "in_stock");
  // The later stock word wins; pickup being unavailable says nothing about shipping.
  assert.equal(read("Bot (#walmart, Group)", "Status: Out of Stock -> In Stock").availability, "in_stock");
  assert.equal(read("Bot (#walmart, Group)", "Status: In Stock -> Sold Out").availability, "out_of_stock");
  assert.equal(read("Bot (#walmart, Group)", "Ascended Heroes ETB live. Shipping: available | Pickup: unavailable").availability, "in_stock");
  // The price is the current one, not the MSRP or a crossed-out price.
  assert.equal(read("Bot (#walmart, Group)", "MSRP: $49.99\nPrice: $64.99").priceCents, 6499);
  assert.equal(read("Bot (#walmart, Group)", "Was $59.99, now 20% off $47.99").priceCents, 4799);
  assert.equal(read("Bot (#walmart, Group)", "Ascended Heroes ETB MSRP $49.99").priceCents, 4999);

  const center = read("Bot (#drops, Group)", "Pokemon Center Elite Trainer Box restock at Target");
  assert.deepEqual(center.stores, ["target"], "Pokémon Center in a product name is not the store");
  assert.deepEqual(read("Bot (#drops, Group)", "Live at Pokemon Center: Ascended Heroes ETB").stores, ["pokemoncenter"]);

  const gamestop = read("Bot (#drops, Group)", "GameStop restock: Ascended Heroes ETB");
  assert.deepEqual(gamestop.stores, []);
  assert.equal(gamestop.otherStore, "GameStop");

  assert.equal(read("Pal (#general, Group)", "anyone get the ascended heroes etb at target?").relevant, false);
  assert.equal(read("Pal (#general, Group)", "lol same").relevant, false);
  assert.equal(read("A Friend", "dinner at 7?").relevant, false);
  const embedOnly = read("Restock Bot (#target-restocks, Cook Group)", "");
  assert.equal(embedOnly.relevant, false);
  assert.match(embedOnly.relevance, /no message text/);
  // A store-alert channel's message is a call even without stock words; chat in the same server is not.
  assert.equal(read("Bot (#target-restocks, Group)", "Pokemon Ascended Heroes ETB").relevant, true);
  assert.equal(read("Pal (#restock-chat, Group)", "Pokemon Ascended Heroes ETB").relevant, false);
  assert.equal(read("Pal (#general, Group)", "Pokemon Ascended Heroes ETB $49.99 at Walmart").relevant, true);
});

const TITLES = [
  "All New Needoh", "Bicycle Playing Cards, 2 Pack, Standard Index (Red & Blue)", "Charizard ex Special Collection",
  "DBS Fusion World Dual Evolution Booster Box FB09", "Disney Lorcana Attack of the Vine Booster Pack",
  "Disney Lorcana Attack of the Vine Illumineer's Trove", "Disney Lorcana Fabled Sleeved Booster",
  "Disney Lorcana Rapunzel Collector Starter Set", "Disney Lorcana Wilds Unknown Single Booster Pack",
  "Gundam TCG: Phantom Aria Booster Box [GD04]", "Magic: The Gathering - The Hobbit Collector Booster Box",
  "NeeDoh Dream Drop", "NeeDoh Fuzz Ball", "NeeDoh Gumdrop", "NeeDoh Gummy Bear", "NeeDoh Mello Mallo", "NeeDoh Nice Cube",
  "NeeDoh Nice Cube Glitter and Glow", "NeeDoh Nice Ice Baby", "NeeDoh Teenie Funky Pups",
  "One Piece The Time of Battle Booster Box (OP-16)", "One Piece World's Strongest Warriors Blister (OP-17)",
  "One Piece the World's Strongest Warriors Booster OP-17", "PlayStation 5 Pro Console",
  "Pokemon 30th Celebration Elite Trainer Box", "Pokemon 30th Celebration Ex Box", "Pokemon 30th Celebration Tin",
  "Pokemon Ascended Heroes Elite Trainer Box", "Pokemon Chaos Rising Elite Trainer Box", "Pokemon Evolving Skies Elite Trainer Box",
  "Pokemon First Partner Illustration Collection Series 2", "Pokemon First Partner Illustration Collection Series 3",
  "Pokemon Mega Evolution Ascended Heroes Tin", "Pokemon Mega Greninja ex League Battle Deck", "Pokemon Mega Moonlit Tin",
  "Pokemon Team Rocket’s Mewtwo ex League Battle Deck", "Riftbound League of Legends - Fiora Champion Deck",
  "Riftbound League of Legends Unleashed Champion Deck", "Schylling Needoh Teenie Color Change Needoh"
];

test("a message matches a product by its distinctive words, and stays unmatched when it could be several or another item", () => {
  const index = new ProductTextIndex(TITLES.map((title, position) => ({ id: `v${position}`, title })));
  const matched = (text: string) => {
    const result = index.match(text);
    return result.confident ? result.best?.title : null;
  };
  assert.equal(matched("Pokemon Ascended Heroes Elite Trainer Box is LIVE at Target! $49.99"), "Pokemon Ascended Heroes Elite Trainer Box");
  assert.equal(matched("Ascended Heroes ETB restock - Walmart"), "Pokemon Ascended Heroes Elite Trainer Box");
  assert.equal(matched("Pokémon TCG: Mega Evolution—Ascended Heroes Elite Trainer Box"), "Pokemon Ascended Heroes Elite Trainer Box");
  assert.equal(matched("Pokémon TCG: Mega Evolution—Ascended Heroes Tin"), "Pokemon Mega Evolution Ascended Heroes Tin");
  assert.equal(matched("NeeDoh Gummy Bear restock"), "NeeDoh Gummy Bear");
  assert.equal(matched("Schylling NeeDoh Teenie Color Change"), "Schylling Needoh Teenie Color Change Needoh");
  assert.equal(matched("Needoh nice cube glitter glow"), "NeeDoh Nice Cube Glitter and Glow");
  assert.equal(matched("NeeDoh Nice Cube"), "NeeDoh Nice Cube");
  assert.equal(matched("PS5 Pro in stock"), "PlayStation 5 Pro Console");
  assert.equal(matched("Team Rocket's Mewtwo ex League Battle Deck"), "Pokemon Team Rocket’s Mewtwo ex League Battle Deck");
  assert.equal(matched("One Piece Card Game: The World's Strongest Warriors Booster Box (OP-17)"), "One Piece the World's Strongest Warriors Booster OP-17");
  assert.equal(matched("OP16 booster box live"), "One Piece The Time of Battle Booster Box (OP-16)");
  assert.equal(matched("Riftbound Unleashed Champion Deck"), "Riftbound League of Legends Unleashed Champion Deck");
  assert.equal(matched("Bicycle Playing Cards 2 pack"), "Bicycle Playing Cards, 2 Pack, Standard Index (Red & Blue)");
  // Several products fit, or the message names one Yoink doesn't have.
  assert.equal(matched("Pokemon Elite Trainer Box restock at Target"), null);
  assert.equal(matched("Lorcana booster pack"), null);
  assert.equal(matched("OP-17 restock"), null);
  assert.equal(matched("NeeDoh Gummy Worm restock"), null);
  assert.equal(matched("Prismatic Evolutions Super Premium Collection"), null);
  assert.equal(matched("Pokemon Mega restock"), null);
  assert.equal(index.match("").best, null);
  assert.equal(new ProductTextIndex([]).match("NeeDoh").confident, false);
});

test("product words fold shorthand, accents, plurals and set codes the same way on both sides", () => {
  assert.deepEqual(productTextTokens("Pokémon ETBs"), ["pokemon", "elite", "trainer", "box"]);
  assert.deepEqual(productTextTokens("OP-17 OP17 op 17"), ["op17", "op17", "op17"]);
  assert.deepEqual(productTextTokens("Team Rocket’s Mewtwo — restock at Walmart!"), ["team", "rocket", "mewtwo"]);
  assert.equal(productTextKey("Ascended Heroes ETB"), productTextKey("etb ascended HEROES restock"));
  assert.notEqual(productTextKey("Ascended Heroes ETB"), productTextKey("Ascended Heroes Tin"));
  assert.equal(productTextKey("restock at Target!"), "");
});
