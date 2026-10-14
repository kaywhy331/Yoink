import assert from "node:assert/strict";
import test from "node:test";
import { ProductTextIndex, productTextKey, productTextTokens } from "../packages/domain/src/product-text-match.js";
import { isShortStoreLink, storeItemFromLink } from "../packages/domain/src/store-item-link.js";
import { itemTitleFromUrl } from "../packages/domain/src/collections.js";
import { readDropTime } from "../packages/sources/src/drop-time.js";
import {
  discordItemPages,
  discordMessageParts,
  discordMessageShape,
  discordNotificationChannel,
  discordProductTitle,
  discordShortLinks,
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
  assert.equal(read("Bot (#walmart, Group)", "Ascended Heroes ETB\nStatus: Out of Stock -> In Stock").availability, "in_stock");
  assert.equal(read("Bot (#walmart, Group)", "Ascended Heroes ETB\nStatus: In Stock -> Sold Out").availability, "out_of_stock");
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
  // Kevin's PC, 2026-10-13 (Retail Monitors #amazon-us): another set of the same line is another product.
  assert.equal(matched("Magic: The Gathering | Star Trek Collector Booster Box"), null);
  assert.match(index.match("Magic: The Gathering | Star Trek Collector Booster Box").reason,
    /^The message says “star trek” where Magic: The Gathering - The Hobbit Collector Booster Box says “hobbit”, so it may be another product\.$/);
  assert.equal(matched("Magic: The Gathering The Hobbit Collector Booster Box restock"), "Magic: The Gathering - The Hobbit Collector Booster Box");
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

// Kevin, 2026-10-13: "continue implementing the various types of discord signals".
test("every kind of store link a restock message carries names its one store item", () => {
  const item = (url: string) => {
    const found = storeItemFromLink(url);
    return found ? `${found.retailerId}:${found.retailerSku}` : null;
  };
  // Product pages, and add-to-cart links.
  assert.equal(item("https://www.target.com/p/pokemon-etb/-/A-94972381?preselect=1"), "target:94972381");
  assert.equal(item("https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B0GRSZ5TDC&Quantity.1=1"), "amazon:B0GRSZ5TDC");
  assert.equal(item("https://affil.walmart.com/cart/addToCart?items=17000001|1"), "walmart:17000001");
  assert.equal(item("https://www.walmart.com/cart?items=17000001"), "walmart:17000001");
  assert.equal(item("https://affil.walmart.com/cart/buynow?items=17000001:2"), "walmart:17000001");
  assert.equal(item("https://api.bestbuy.com/click/-/6601524/cart"), "bestbuy:6601524");
  assert.equal(item("https://www.bestbuy.com/site/6601524.p"), "bestbuy:6601524");
  assert.equal(item("https://amzn.com/B0GRSZ5TDC"), "amazon:B0GRSZ5TDC");
  assert.equal(item("http://www.target.com/p/-/A-94972381"), "target:94972381");
  // Affiliate and tracking redirects carry the store link inside them.
  assert.equal(item("https://goto.walmart.com/c/1/2/3?veh=aff&u=https%3A%2F%2Fwww.walmart.com%2Fip%2Fetb%2F17000001"), "walmart:17000001");
  assert.equal(item("https://bestbuy.7tiv.net/c/1/2/3?u=https%3A%2F%2Fwww.bestbuy.com%2Fsite%2Fps5%2F6601524.p%3FskuId%3D6601524"), "bestbuy:6601524");
  assert.equal(item("https://howl.link/link?url=https%3A%2F%2Fwww.target.com%2Fp%2F-%2FA-94972381&publisher_slug=a&article_url=https%3A%2F%2Fblog.example%2Fx"), "target:94972381");
  assert.equal(item("https://www.anrdoezrs.net/links/1/type/dlg/sid/x/https://www.target.com/p/-/A-94972381"), "target:94972381");
  assert.equal(item("https://click.linksynergy.com/deeplink?id=x&murl=https%253A%252F%252Fwww.walmart.com%252Fip%252F17000001"), "walmart:17000001");
  // None, or more than one, is no item.
  assert.equal(item("https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B0GRSZ5TDC&ASIN.2=B0GRSZ5TDD"), null);
  assert.equal(item("https://www.walmart.com/cart?items=17000001,17000002"), null);
  assert.equal(item("https://www.target.com/s?searchTerm=etb"), null);
  assert.equal(item("https://example.com/r?a=https%3A%2F%2Fwww.target.com%2Fp%2F-%2FA-94972381&b=https%3A%2F%2Fwww.walmart.com%2Fip%2F17000001"), null);
  assert.equal(item("not a link"), null);

  // Only known short-link and redirect services are ever followed.
  for (const link of ["https://amzn.to/4abc", "https://a.co/d/abc", "https://walmrt.us/abc", "https://bit.ly/x", "https://howl.me/x",
    "https://mavely.app.link/x", "https://bestbuy.7tiv.net/c/1/2/3", "https://goto.target.com/c/1/2/3"]) {
    assert.equal(isShortStoreLink(link), true, link);
  }
  for (const link of ["https://evil.example/c/1/2/3", "https://192.168.1.1/x", "https://localhost/x", "https://www.amazon.com/dp/B0GRSZ5TDC",
    "https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fip%2F17000001"]) {
    assert.equal(isShortStoreLink(link), false, link);
  }
});

test("a message's add-to-cart and redirect links are store links; its short links wait to be followed", () => {
  const toast = {
    app: "desktop" as const,
    title: "Monitor (#walmart-restocks, Group)",
    body: "Product: Pokemon Prismatic Evolutions Booster Bundle\nPrice: $26.94\nATC: https://affil.walmart.com/cart/addToCart?items=13816151308\nAmazon: https://amzn.to/4xyz"
  };
  assert.deepEqual(discordShortLinks(toast), ["https://amzn.to/4xyz"]);
  const read = readDiscordNotification(toast);
  assert.deepEqual(read.links.map((link) => link.canonicalUrl), ["https://www.walmart.com/ip/13816151308"]);
  assert.deepEqual(read.shortLinks, ["https://amzn.to/4xyz"]);
  assert.equal(read.productText, "Pokemon Prismatic Evolutions Booster Bundle");
  const followed = readDiscordNotification(toast, {
    "https://amzn.to/4xyz": { item: { retailerId: "amazon", retailerSku: "B0DPRISMAT", canonicalUrl: "https://www.amazon.com/dp/B0DPRISMAT" }, landing: "https://www.amazon.com/dp/B0DPRISMAT" }
  });
  assert.deepEqual(followed.links.map((link) => link.retailerSku), ["13816151308", "B0DPRISMAT"]);
  assert.deepEqual(followed.shortLinks, []);
  assert.deepEqual(followed.stores, ["walmart", "amazon"]);
  // A short link alone may lead to a store item, so the message is kept until it has been followed.
  const alone = readDiscordNotification({ app: "desktop", title: "Bot (#drops, Group)", body: "@everyone https://amzn.to/4xyz" });
  assert.equal(alone.relevant, true);
  assert.match(alone.relevance, /short link/);
  assert.equal(readDiscordNotification({ app: "desktop", title: "Pal (#general, Group)", body: "anyone tried https://bit.ly/x?" }).relevant, false);
});

test("a product Yoink first hears of on Discord is named from the message, without its stock and store words", () => {
  assert.equal(discordProductTitle("Pokemon Ascended Heroes ETB is LIVE!"), "Pokemon Ascended Heroes ETB");
  assert.equal(discordProductTitle("NeeDoh Nice Cube restocked at Walmart"), "NeeDoh Nice Cube");
  assert.equal(discordProductTitle("Mystery Mini Figure Series 3 back in stock on Amazon, hurry"), "Mystery Mini Figure Series 3");
  assert.equal(discordProductTitle("LIVE NOW"), "");
  assert.equal(discordProductTitle("Restock!"), "");
  assert.equal(discordProductTitle("Target"), "");
  // Kevin's PC, 2026-10-13 (#topps-flips): "@Topps Everyone Enter <link>" names no product.
  assert.equal(discordProductTitle("Everyone Enter"), "");
  // TrackaLacker Bot's alerts in a TCG Alerts server, as Kevin's PC showed them on 2026-10-13.
  assert.equal(discordProductTitle("IN STOCK ALERT - Pokemon Journey Together Booster Bundle"), "Pokemon Journey Together Booster Bundle");
});

test("Discord's direction marks around names are read through, and a store-alert server's channels are alert channels", () => {
  // As Kevin's PC showed them on 2026-10-13: Discord in Brave wraps each name in U+2068 … U+2069.
  const title = "\u2068Retail Bot\u2069 (\u2068#amazon-us\u2069, \u2068🚨 Retail Monitors 🎮\u2069)";
  const toast = discordToast("Brave", parseWindowsToast(browserToastXml(title, "\u2068Pokemon Ascended Heroes Elite Trainer Box\u2069", "discord.com")));
  assert.deepEqual(toast, { app: "browser", title: "Retail Bot (#amazon-us, 🚨 Retail Monitors 🎮)", body: "Pokemon Ascended Heroes Elite Trainer Box" });
  const channel = discordNotificationChannel(title);
  assert.deepEqual({ ...channel, key: undefined }, {
    key: undefined, name: "#amazon-us · 🚨 Retail Monitors 🎮", author: "Retail Bot", channel: "amazon-us", server: "🚨 Retail Monitors 🎮"
  });
  const read = (channelName: string, body: string) =>
    readDiscordNotification({ app: "browser", title: `Retail Bot (\u2068#${channelName}\u2069, \u2068🚨 Retail Monitors 🎮\u2069)`, body });
  const named = read("amazon-us", "Pokemon Ascended Heroes Elite Trainer Box");
  assert.equal(named.relevant, true, named.relevance);
  assert.deepEqual(named.stores, ["amazon"]);
  assert.equal(named.availability, "in_stock");
  assert.equal(read("walmart", "NeeDoh Gummy Bear").relevant, true);
  // The server's chat and notice channels are not store alerts.
  assert.equal(read("general", "Pokemon Ascended Heroes Elite Trainer Box").relevant, false);
  assert.equal(read("announcements", "Pokemon Ascended Heroes Elite Trainer Box").relevant, false);
});

test("a skipped message is described by counts only, never its words", () => {
  assert.equal(discordMessageShape({ body: "@Pokemon Pokemon ETB\nhttps://example.com/x" }), "2 lines, 3 words, 1 link, 1 mention");
  assert.equal(discordMessageShape({ body: "" }), "0 lines, 0 words, 0 links, 0 mentions");
  assert.doesNotMatch(discordMessageShape({ body: "secret plans" }), /secret|plans/);
});

test("TrackaLacker Bot's Discord alerts name their store by a role mention", () => {
  // As Kevin's PC showed them on 2026-10-13 (Discord in Brave, TCG Alerts server).
  const read = (body: string) => readDiscordNotification({
    app: "browser", title: "\u2068TrackaLacker Bot\u2069 (\u2068#pokemon\u2069, \u2068TCG Alerts\u2069)", body
  });
  const ebay = read("🛎️ IN STOCK ALERT 🛎️ - Pokemon Journey Together Booster Bundle\u2068@ebay\u2069");
  assert.equal(ebay.channel.name, "#pokemon · TCG Alerts");
  assert.deepEqual(ebay.stores, []);
  assert.equal(ebay.otherStore, "eBay");
  assert.equal(ebay.productText, "IN STOCK ALERT - Pokemon Journey Together Booster Bundle");
  const walmart = read("🛎️ IN STOCK ALERT 🛎️ - Pokemon Journey Together Booster Bundle\u2068@walmart\u2069");
  assert.deepEqual(walmart.stores, ["walmart"]);
  assert.equal(walmart.availability, "in_stock");
  assert.equal(walmart.relevant, true);
});

// Kevin, 2026-10-13: "validate the landing page to ensure that the signal is even an appropriate product. Sometimes
// discord alerts could just be a notification and not actually land on a product. Sometimes discord alerts could be
// multiple items that needs to intelligently parse the right signals or drop ETA."
test("notices name no product, a drawing or drop time is read, and a link off a product page is no product", () => {
  // Messages as Kevin's PC kept them on 2026-10-13 (10:52 am Eastern = 14:52Z).
  const arrivedAt = Date.parse("2026-10-13T15:52:36Z");
  const read = (channel: string, body: string) => readDiscordNotification(
    { app: "browser", title: `HOC BOT (#${channel}, 🚨 Retail Monitors 🎮)`, body }, {}, { arrivedAt, timeZone: "America/Los_Angeles" });
  for (const body of ["PokemonCenter Protection Changed, Monitor might be unstable.", "@Pokemon - QUEUE UP Monitor might be unstable",
    "🛎️ **Deal Alert** @pokemon-trading-cards", "🛎️ IN STOCK ALERT 🛎️ - Pokemon Center Queue Monitor @pokemon-trading-cards",
    "@Pokemon TCG Restocks Looks like only German-language TCG will be dropping on Pokémon Center today, there will not be any English TCG drops."]) {
    const notice = read("pokemon", body);
    assert.equal(notice.kind, "notice", body);
    assert.equal(notice.availability, "unknown", body);
  }
  const item = read("amazon-us", "Magic: The Gathering | Star Trek Collector Booster Box");
  assert.equal(item.kind, "item");
  assert.equal(item.availability, "in_stock");

  const drawing = read("walmart", "Pokemon Trading Card Game Scarlet & Violet 10 Destined Rivals 3Pk Blister 2-Pack Bundle Drawing starts Oct 14, 2:00pm PDT");
  assert.equal(drawing.kind, "drop");
  assert.equal(drawing.drop?.kind, "drawing");
  assert.equal(new Date(drawing.drop?.at ?? 0).toISOString(), "2026-10-14T21:00:00.000Z");
  assert.equal(drawing.eventType, "drop_window");
  assert.equal(drawing.availability, "unknown");
  assert.equal(drawing.productText, "Pokemon Trading Card Game Scarlet & Violet 10 Destined Rivals 3Pk Blister 2-Pack Bundle");
  assert.equal(drawing.relevant, true);
  assert.equal(read("walmart", "Ascended Heroes ETB queue opens 10/15 at 7am ET").eventType, "queue_open");
  // Without the arrival time no time is read.
  assert.equal(readDiscordNotification({ app: "browser", title: "Bot (#walmart, Group)", body: "ETB drops Oct 14, 2pm PT" }).drop, null);

  const search = read("walmart", "Pokemon restock https://www.walmart.com/search?q=pokemon+etb");
  assert.equal(search.kind, "notice");
  assert.deepEqual(search.landings, [{ url: "https://www.walmart.com/search?q=pokemon+etb", retailerId: "walmart", kind: "search" }]);
  // A followed short link that lands on a drawing page is no product either.
  const shortLanding = readDiscordNotification({ app: "browser", title: "Bot (#walmart, Group)", body: "Ascended Heroes ETB live https://bit.ly/drawing" },
    { "https://bit.ly/drawing": { item: null, landing: "https://www.walmart.com/cp/collectibles-drawings/123" } });
  assert.equal(shortLanding.kind, "notice");
  assert.equal(shortLanding.landings[0]?.kind, "drawing");
});

test("a message listing several items is read as one message per item", () => {
  const title = "Monitor (#restocks, Group)";
  const lines = discordMessageParts({ app: "desktop", title,
    body: "Restocks at Target:\nAscended Heroes ETB https://www.target.com/p/-/A-94972381\nCelebration ETB https://www.target.com/p/-/A-95120000" });
  assert.deepEqual(lines.map((part) => part.body), [
    "Restocks at Target:\nAscended Heroes ETB https://www.target.com/p/-/A-94972381",
    "Restocks at Target:\nCelebration ETB https://www.target.com/p/-/A-95120000"
  ]);
  const blocks = discordMessageParts({ app: "desktop", title,
    body: "Ascended Heroes ETB\nhttps://www.target.com/p/-/A-94972381\n\nNeeDoh Gummy Bear\nhttps://www.walmart.com/ip/1234567" });
  assert.deepEqual(blocks.map((part) => part.body), ["Ascended Heroes ETB\nhttps://www.target.com/p/-/A-94972381", "NeeDoh Gummy Bear\nhttps://www.walmart.com/ip/1234567"]);
  const bullets = discordMessageParts({ app: "desktop", title, body: "Live at Walmart now:\n- Ascended Heroes ETB\n- NeeDoh Gummy Bear\n- Celebration Tin" });
  assert.deepEqual(bullets.map((part) => part.body), ["Live at Walmart now:\n- Ascended Heroes ETB", "Live at Walmart now:\n- NeeDoh Gummy Bear", "Live at Walmart now:\n- Celebration Tin"]);
  // One item, or the same item linked twice, is one message.
  assert.equal(discordMessageParts({ app: "desktop", title, body: "Ascended Heroes ETB https://www.target.com/p/-/A-94972381" }).length, 1);
  assert.equal(discordMessageParts({ app: "desktop", title,
    body: "ETB https://www.target.com/p/-/A-94972381\nATC https://www.target.com/p/x/-/A-94972381" }).length, 1);
});

test("a drop, drawing or queue time is read in the zone it names, or the shopper's", () => {
  const at = Date.parse("2026-10-13T15:52:36Z");
  const read = (text: string) => {
    const drop = readDropTime(text, at, "America/Los_Angeles");
    return drop ? `${drop.kind} ${new Date(drop.at).toISOString()}${drop.zoneAssumed ? " (assumed zone)" : ""}` : null;
  };
  assert.equal(read("Drawing starts Oct 14, 2:00pm PDT"), "drawing 2026-10-14T21:00:00.000Z");
  assert.equal(read("Queue opens 10/15 at 7am ET"), "queue 2026-10-15T11:00:00.000Z");
  assert.equal(read("drops tomorrow 9AM EST"), "drop 2026-10-14T13:00:00.000Z");
  assert.equal(read("Restock at 12pm ET"), "drop 2026-10-13T16:00:00.000Z");
  assert.equal(read("Drop at noon"), "drop 2026-10-13T19:00:00.000Z (assumed zone)");
  assert.equal(read("Pokemon Center drop Friday 7am PT"), "drop 2026-10-16T14:00:00.000Z");
  assert.equal(read("queue up tonight at 9 ET"), "queue 2026-10-14T01:00:00.000Z");
  assert.equal(read("Release date: Nov 7"), "drop 2026-11-07T08:00:00.000Z (assumed zone)");
  // A time that has passed says when something happened, not when it drops; a bare number is no time.
  assert.equal(read("Went live at 8:40am PT"), null);
  assert.equal(read("Draw Oct 1 2pm PT"), null);
  assert.equal(read("restock 3pk"), null);
  assert.equal(read("Ascended Heroes ETB live at Target $49.99"), null);
  assert.equal(read("QUEUE UP Monitor might be unstable"), null, "Mon in Monitor is no Monday");
  // A day without a clock time is a window (Kevin, 2026-10-13: "stock loaded should drop tonight").
  const window = (text: string, arrival = at) => {
    const drop = readDropTime(text, arrival, "America/Los_Angeles");
    return drop?.until ? `${drop.kind} ${new Date(drop.at).toISOString()} → ${new Date(drop.until).toISOString()}` : null;
  };
  assert.equal(window("Stock loaded should drop tonight"), "drop 2026-10-14T01:00:00.000Z → 2026-10-14T10:00:00.000Z");
  assert.equal(window("Ascended Heroes ETB dropping today"), "drop 2026-10-13T15:52:36.000Z → 2026-10-14T07:00:00.000Z");
  assert.equal(window("drops tomorrow"), "drop 2026-10-14T07:00:00.000Z → 2026-10-15T07:00:00.000Z");
  assert.equal(window("restock Friday night"), "drop 2026-10-17T01:00:00.000Z → 2026-10-17T10:00:00.000Z");
  assert.equal(window("Release date: Nov 7"), "drop 2026-11-07T08:00:00.000Z → 2026-11-08T08:00:00.000Z");
  assert.equal(window("queue tomorrow morning"), "queue 2026-10-14T07:00:00.000Z → 2026-10-14T19:00:00.000Z");
  // Late in the evening, tonight starts now; a clock time is still an exact time.
  assert.equal(window("drops tonight", Date.parse("2026-10-14T06:30:00Z")), "drop 2026-10-14T06:30:00.000Z → 2026-10-14T10:00:00.000Z");
  assert.equal(window("queue up tonight at 9 ET"), null);
  // Daylight saving: a January date is read in Pacific standard time.
  assert.equal(read("Drop Jan 5 10am PT"), "drop 2027-01-05T18:00:00.000Z");
});

test("an app link carries its store page, whose address names the product when the message doesn't", () => {
  // As Kevin's PC kept it on 2026-10-13 (Retail / Flips, #topps-flips).
  const link = "https://fanaticsapp.onelink.me/ty1p?af_web_dp=https%3A%2F%2Fwww.fanatics.com%2Fmarvel%2Fmarvel%2F2026-topps-marvel-neon-factory-sealed-hobby-box%2Fo-2323621544%2Bt-7812744940%2Bp-421113924%2Bz-9-3463962895%3F_ref%3Dp-SRP&af_xp=custom&pid=fanapp_commerce";
  assert.equal(storeItemFromLink(link)?.retailerSku, "421113924");
  const [found] = discordItemPages({ body: `@Topps Everyone Enter ${link}` });
  assert.equal(found?.item.retailerId, "fanatics");
  assert.equal(itemTitleFromUrl(found?.page), "2026 Topps Marvel Neon Factory Sealed Hobby Box");
  assert.equal(itemTitleFromUrl("https://www.walmart.com/ip/Pokemon-Scarlet-Violet-Prismatic-Evolutions-Booster-Bundle/13816151308"),
    "Pokemon Scarlet Violet Prismatic Evolutions Booster Bundle");
  assert.equal(itemTitleFromUrl("https://www.walmart.com/ip/13816151308"), "");
});

test("Discord's own notices and AI helper bots are never kept (Kevin, 2026-10-13: \"those bot ai can be ignored\")", () => {
  const read = (title: string, body: string) => readDiscordNotification({ app: "browser", title, body });
  // As Kevin's PC showed it in TCG Alerts.
  const thread = read("TrackaLacker Bot AI (#lorcana, TCG Alerts)", "TrackaLacker Bot AI started a thread, \"Feedback Thread\"");
  assert.deepEqual([thread.relevant, thread.skip], [false, true]);
  assert.equal(read("Pal (#general, Group)", "Pal pinned a message to this channel.").skip, true);
  assert.equal(read("Helper Bot AI (#pokemon, TCG Alerts)", "🛎️ IN STOCK ALERT 🛎️ - Pokemon 30th Celebration Tin").skip, true);
  // TrackaLacker Bot itself still counts.
  const alert = read("TrackaLacker Bot (#pokemon, TCG Alerts)", "🛎️ IN STOCK ALERT 🛎️ - Pokemon 30th Celebration Tin@walmart");
  assert.deepEqual([alert.relevant, alert.skip], [true, false]);
});
