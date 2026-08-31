import { cleanText } from "./normalize.js";

export const HOWL_AFFILIATE_PROTOCOL_VERSION = 1;
export const HOWL_AFFILIATE_ENDPOINT = "https://howl.link/link";
export const HOWL_DEFAULT_PUBLISHER_SLUG = "collectwithdodo";

export interface HowlAffiliateStore {
  storeName: string;
  website: string;
  hostname: string;
  pathPrefix: string;
}

const HOWL_STORE_WEBSITES = Object.freeze([
  ["adidas", "adidas.com"],
  ["CVS", "cvs.com"],
  ["GameStop", "gamestop.com"],
  ["Target", "target.com"],
  ["Walmart", "walmart.com"],
  ["American Eagle", "ae.com/us/en"],
  ["Anine Bing", "aninebing.com"],
  ["Anker", "anker.com"],
  ["ASICS", "asics.com/us/en-us"],
  ["ASOS", "asos.com/us"],
  ["ASUS", "asus.com/us"],
  ["Athleta", "athleta.gap.com"],
  ["Audio Advice", "audioadvice.com"],
  ["B&H Photo Video", "bhphotovideo.com"],
  ["Banana Republic", "bananarepublic.gap.com"],
  ["Banana Republic Factory", "bananarepublicfactory.gapfactory.com"],
  ["Beauty Plus Salon", "beautyplussalon.com"],
  ["Benefit Cosmetics", "benefitcosmetics.com/en-us"],
  ["Bergdorf Goodman", "bergdorfgoodman.com"],
  ["BJ's Wholesale Club", "bjs.com"],
  ["Bluemercury", "bluemercury.com"],
  ["Blundstone", "blundstone.com"],
  ["Brooks Running", "brooksrunning.com"],
  ["Burga", "burga.com"],
  ["Canon", "usa.canon.com"],
  ["Champion", "champion.com"],
  ["Champs", "champssports.com"],
  ["Corsair", "corsair.com/us/en"],
  ["COS US", "cos.com/en_usd"],
  ["Crocs", "crocs.com"],
  ["Crutchfield", "crutchfield.com"],
  ["Dell", "dell.com/en-us"],
  ["Dermablend", "dermablend.com"],
  ["Dermaflash", "dermaflash.com"],
  ["Dermalogica", "dermalogica.com"],
  ["Dermstore", "dermstore.com"],
  ["DICK'S Sporting Goods", "dickssportinggoods.com"],
  ["DJIUSA", "dji.com"],
  ["Dreame US", "dreametech.com"],
  ["Dyson", "dyson.com"],
  ["EltaMD", "eltamd.com"],
  ["Exponent Beauty", "exponentbeauty.com"],
  ["Express", "express.com"],
  ["Fanatics", "fanatics.com"],
  ["Farfetch", "farfetch.com"],
  ["Fashionphile", "fashionphile.com"],
  ["Finish Line", "finishline.com"],
  ["Foot Locker", "footlocker.com"],
  ["FWRD", "fwrd.com"],
  ["Gap", "gap.com"],
  ["Gap Factory", "gapfactory.com"],
  ["Golf Galaxy", "golfgalaxy.com"],
  ["Grailed", "grailed.com"],
  ["H&M", "hm.com/en_us"],
  ["Hanacure", "hanacure.com"],
  ["Hanna Andersson", "hannaandersson.com"],
  ["Hatch", "hatch.co"],
  ["Herman Miller", "hermanmiller.com"],
  ["Hoka", "hoka.com/en/us"],
  ["HP", "hp.com/us-en"],
  ["HUM Nutrition", "humnutrition.com"],
  ["Hydro Flask", "hydroflask.com"],
  ["HyperX", "hyperx.com"],
  ["iHerb", "iherb.com"],
  ["ILIA Beauty", "iliabeauty.com"],
  ["iRobot", "irobot.com"],
  ["J. Crew", "jcrew.com"],
  ["J. Crew Factory", "factory.jcrew.com"],
  ["JB Tools", "jbtools.com"],
  ["JLab", "jlab.com"],
  ["Kate Spade Outlet", "katespadeoutlet.com"],
  ["Kids Foot Locker", "kidsfootlocker.com"],
  ["Kohl's", "kohls.com"],
  ["Kosas", "kosas.com"],
  ["Lake Pajamas", "lakepajamas.com"],
  ["LEGO", "lego.com/en-us"],
  ["Leica", "leica-camera.com/en-US"],
  ["Lenovo", "lenovo.com/us/en"],
  ["Lenovo CA", "lenovo.com/ca/en"],
  ["LG", "lg.com/us"],
  ["Lilly Pulitzer", "lillypulitzer.com"],
  ["Logitech", "logitech.com/en-us"],
  ["Macy's", "macys.com"],
  ["Madewell", "madewell.com"],
  ["Marshalls", "marshalls.com"],
  ["Maude", "getmaude.com"],
  ["Maytag", "maytag.com"],
  ["Moda Operandi", "modaoperandi.com"],
  ["Motorola", "motorola.com/us"],
  ["Mytheresa", "mytheresa.com/us/en"],
  ["Nanoleaf", "nanoleaf.me/en-US"],
  ["Neiman Marcus", "neimanmarcus.com"],
  ["NET-A-PORTER", "net-a-porter.com/en-us"],
  ["New Balance", "newbalance.com"],
  ["Nike", "nike.com"],
  ["Nomad Goods", "nomadgoods.com"],
  ["Nutricost", "nutricost.com"],
  ["Oakley", "oakley.com/en-us"],
  ["Old Navy", "oldnavy.gap.com"],
  ["Ozlo", "ozlosleep.com"],
  ["Playstation", "direct.playstation.com/en-us"],
  ["Pocket", "heypocket.com"],
  ["Polaroid", "polaroid.com"],
  ["Princess Polly", "us.princesspolly.com"],
  ["Puma", "us.puma.com/us/en"],
  ["Quince", "quince.com"],
  ["Revolve", "revolve.com"],
  ["ROKA", "roka.com"],
  ["Rothy's", "rothys.com"],
  ["Saie", "saiehello.com"],
  ["Saks Fifth Avenue", "saksfifthavenue.com"],
  ["Salomon", "salomon.com/en-us"],
  ["Sennheiser", "sennheiser-hearing.com/en-US"],
  ["Sephora", "sephora.com"],
  ["Sharp", "shop.sharpusa.com"],
  ["Sharper Image", "sharperimage.com"],
  ["SHEIN", "us.shein.com"],
  ["Shokz", "shokz.com"],
  ["Shopbop", "shopbop.com"],
  ["Skullcandy", "skullcandy.com"],
  ["Slam Jam", "slamjam.com/en-us"],
  ["sneakers.com", "sneakers.com"],
  ["Soft Services", "softservices.com"],
  ["Sonos", "sonos.com/en-us"],
  ["Sony", "electronics.sony.com"],
  ["Spanx", "spanx.com"],
  ["StackSocial", "stacksocial.com"],
  ["Steve Madden", "stevemadden.com"],
  ["StockX", "stockx.com"],
  ["Stylevana", "stylevana.com/en_US"],
  ["Sun Bum", "sunbum.com"],
  ["Supergoop", "supergoop.com"],
  ["Supermouth", "supermouth.com"],
  ["Surfshark VPN", "surfshark.com"],
  ["T.J. Maxx", "tjmaxx.tjx.com"],
  ["TCL", "us.tcl.com"],
  ["The Container Store", "containerstore.com"],
  ["The Home Depot", "homedepot.com"],
  ["The INKEY List", "theinkeylist.com"],
  ["The Outnet", "theoutnet.com/en-us"],
  ["The Webster", "thewebster.com"],
  ["Todd Snyder", "toddsnyder.com"],
  ["Tuft & Needle", "tuftandneedle.com"],
  ["Tula", "tula.com"],
  ["U Beauty", "ubeauty.com"],
  ["UGG", "ugg.com"],
  ["Ulta Beauty", "ulta.com"],
  ["Ultrahuman", "ultrahuman.com"],
  ["Urban Outfitters", "urbanoutfitters.com"],
  ["Verizon", "verizon.com"],
  ["Veronica Beard", "veronicabeard.com"],
  ["Versed Skin", "versedskin.com"],
  ["Viktor & Rolf", "viktor-rolf.com/en-us"],
  ["Wacoal", "wacoal-america.com"],
  ["Walmart Canada", "walmart.ca/en"],
  ["Wayfair CA", "wayfair.ca"],
  ["Whirlpool", "whirlpool.com"],
  ["Woot", "woot.com"],
  ["Yoox", "yoox.com/us"],
  ["Zappos", "zappos.com"]
] as const);

function normalizedPathPrefix(pathname: string): string {
  const compact = `/${pathname}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return compact === "" ? "/" : compact;
}

function normalizedHostname(hostname: string): string {
  const lower = hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

function storeDefinition(storeName: string, website: string): HowlAffiliateStore {
  const parsed = new URL(`https://${website}`);
  return Object.freeze({
    storeName,
    website,
    hostname: normalizedHostname(parsed.hostname),
    pathPrefix: normalizedPathPrefix(parsed.pathname)
  });
}

export const HOWL_AFFILIATE_STORES: readonly HowlAffiliateStore[] = Object.freeze(
  HOWL_STORE_WEBSITES.map(([storeName, website]) => storeDefinition(storeName, website))
);

function safeHttpsDestination(value: unknown): URL | null {
  try {
    const destination = new URL(cleanText(value, 4_096));
    if (destination.protocol !== "https:" || destination.username || destination.password || destination.port) return null;
    return destination;
  } catch {
    return null;
  }
}

function pathMatches(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix === "/") return true;
  const path = normalizedPathPrefix(pathname).toLocaleLowerCase("en-US");
  const prefix = pathPrefix.toLocaleLowerCase("en-US");
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function howlAffiliateStoreForDestination(value: unknown): HowlAffiliateStore | null {
  const destination = safeHttpsDestination(value);
  if (!destination) return null;
  const hostname = normalizedHostname(destination.hostname);
  const matches = HOWL_AFFILIATE_STORES
    .filter((store) => store.hostname === hostname && pathMatches(destination.pathname, store.pathPrefix))
    .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length);
  return matches[0] ?? null;
}

export function buildHowlAffiliateRoute(input: {
  destinationUrl: unknown;
  publisherSlug: unknown;
  articleName: unknown;
  articleUrl: unknown;
}): string {
  const destination = safeHttpsDestination(input.destinationUrl);
  if (!destination || !howlAffiliateStoreForDestination(destination.href)) return "";
  const publisherSlug = cleanText(input.publisherSlug, 80).toLocaleLowerCase("en-US");
  const articleName = cleanText(input.articleName, 200) || "Product";
  const articleUrl = safeHttpsDestination(input.articleUrl);
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(publisherSlug) || !articleUrl) return "";
  const route = new URL(HOWL_AFFILIATE_ENDPOINT);
  route.searchParams.set("url", destination.href);
  route.searchParams.set("publisher_slug", publisherSlug);
  route.searchParams.set("article_name", articleName);
  route.searchParams.set("article_url", articleUrl.href);
  return route.href;
}
