import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import {
  HOWL_AFFILIATE_ENDPOINT,
  HOWL_AFFILIATE_PROTOCOL_VERSION,
  HOWL_AFFILIATE_STORES,
  HOWL_DEFAULT_PUBLISHER_SLUG
} from "../packages/domain/src/howl-affiliate-stores.js";

// Kevin, 2026-10-12: Discord messages from Windows notifications become calls,
// each traced to the Yoink product it is about.
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 60): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

const overview = {
  actor: { displayName: "Shopper Fixture", userId: "user_fixture", tenantName: "Fixture", roleLabels: ["Shopper"], sessionKind: "local", signOutUrl: "" },
  settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
  counts: { products: 0, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
  sources: [],
  permissions: [],
  spend: { activeReservationCount: 0, activeReservedCents: 0, spentTodayCents: 0,
    policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null } },
  walmartDraws: { latestScan: null, items: [] }
};

const CHANNEL_ADD = "signal_channel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHANNEL_LOG = "signal_channel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("Setup › Discord shows what Yoink reads and sets each channel; Calls › Discord links an unmatched message to a product", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#setup/discord",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const now = Date.now();
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let enabled = true;
  const discordOverview = () => ({
    settings: { enabled },
    reader: {
      supported: true, state: enabled ? "watching" : "off", readMode: "direct",
      lastCheckedAt: new Date(now - 1_000).toISOString(), lastError: "", lastErrorMessage: "", lastErrorAt: "",
      notificationsInCentre: 9, discordAppInCentre: 2, discordSeen: 5, calls: 3, ignored: 2, olderSkipped: 0,
      lastDiscordAt: new Date(now - 120_000).toISOString(), lastCallAt: new Date(now - 120_000).toISOString(),
      startedAt: new Date(now - 3_600_000).toISOString(), recent: []
    },
    channels: [
      { id: CHANNEL_ADD, name: "#target-restocks · Cook Group", mode: "add", calls: 2, matched: 2, lastCallAt: new Date(now - 120_000).toISOString() },
      { id: CHANNEL_LOG, name: "#general · Friends", mode: "log", calls: 1, matched: 0, lastCallAt: new Date(now - 600_000).toISOString() }
    ],
    recent: []
  });
  const discordCalls = [{
    id: "signal:discord:matched",
    kind: "signal",
    listingId: "listing_etb_target",
    retailerId: "target",
    retailerSku: "94972381",
    canonicalUrl: "https://www.target.com/p/-/A-94972381",
    title: "Pokemon Ascended Heroes Elite Trainer Box",
    occurredAt: new Date(now - 120_000).toISOString(),
    receivedAt: new Date(now - 119_000).toISOString(),
    unitPriceCents: 4999,
    currency: "USD",
    source: "discord",
    sourceChannelId: CHANNEL_ADD,
    discord: {
      channel: "#target-restocks · Cook Group",
      message: "Restock Bot (#target-restocks, Cook Group): Ascended Heroes ETB is LIVE $49.99",
      trace: "Yoink matched the Target link in the message to Pokemon Ascended Heroes Elite Trainer Box at Target.",
      matched: true,
      trust: "trusted_exact"
    },
    result: { kind: "added", label: "Added to cart", reason: "", detail: "", tone: "good", fix: "" }
  }, {
    id: "signal:discord:unmatched",
    kind: "signal",
    listingId: "",
    retailerId: "walmart",
    retailerSku: "",
    canonicalUrl: "",
    title: "Squishy Gummy Bear Stress Toy restock",
    occurredAt: new Date(now - 60_000).toISOString(),
    receivedAt: new Date(now - 59_000).toISOString(),
    unitPriceCents: 999,
    currency: "USD",
    source: "discord",
    sourceChannelId: CHANNEL_ADD,
    discord: {
      channel: "#walmart-restocks · Cook Group",
      message: "Bot (#walmart-restocks, Cook Group): Squishy Gummy Bear Stress Toy restock $9.99",
      trace: "Yoink couldn't match the product name: the closest product, NeeDoh Gummy Bear, shares too few words with the message.",
      matched: false,
      trust: "trusted_exact"
    },
    result: { kind: "no_action", label: "No action", reason: "Not matched to a product",
      detail: "Yoink couldn't match the product name. Link it to a product and Yoink matches it next time.", tone: "muted", fix: "link_product" }
  }];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      const method = options.method || "GET";
      const ok = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => "" }, json: async () => body });
      if (method !== "GET") writes.push({ path, method, body: JSON.parse(options.body || "{}") });
      if (path === "/api/v1/affiliate-routing") {
        return ok({ affiliateRouting: { protocolVersion: HOWL_AFFILIATE_PROTOCOL_VERSION, endpoint: HOWL_AFFILIATE_ENDPOINT,
          publisherSlug: HOWL_DEFAULT_PUBLISHER_SLUG, stores: HOWL_AFFILIATE_STORES, registeredRetailerDomains: ["target.com", "walmart.com"] } });
      }
      if (path === "/api/v1/user/overview") return ok(overview);
      if (path === "/api/v1/user/discord") return ok(discordOverview());
      if (path === "/api/v1/user/discord/settings") {
        enabled = (JSON.parse(options.body || "{}") as { enabled: boolean }).enabled;
        return ok({ settings: { enabled } });
      }
      const channel = /^\/api\/v1\/user\/discord\/channels\/(signal_channel_[a-f0-9]{32})$/.exec(path);
      if (channel) {
        const mode = (JSON.parse(options.body || "{}") as { mode: string }).mode;
        return ok({ channel: { id: channel[1], name: "#target-restocks · Cook Group", mode } });
      }
      if (path.startsWith("/api/v1/user/calls?source=discord")) return ok({ items: discordCalls, signalTotal: discordCalls.length, total: discordCalls.length });
      if (path.startsWith("/api/v1/user/discord/suggestions?")) {
        const query = new URL(path, "http://127.0.0.1").searchParams.get("q");
        return ok({ items: query
          ? [{ variantId: "variant_cats", title: "Schylling Needoh Wild Cats Fuzz Ball", score: 0.7, imageUrl: "", stores: ["Walmart"] }]
          : [{ variantId: "variant_gummy", title: "NeeDoh Gummy Bear", score: 0.8, imageUrl: "", stores: ["Walmart"] },
            { variantId: "variant_gumdrop", title: "NeeDoh Gumdrop", score: 0.3, imageUrl: "", stores: ["Target", "Walmart"] }] });
      }
      if (path === "/api/v1/user/discord/links") return ok({ linked: { variantId: "variant_gummy", title: "NeeDoh Gummy Bear" } });
      return ok({ items: [] });
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new browser.Event("close")); }
  });
  const adminDb = new YoinkDatabase();
  const adminServer = createYoinkServer({ db: adminDb, webRoot, version: "discord-admin-test" });
  adminServer.listen(0, "127.0.0.1"); await once(adminServer, "listening");
  const adminOrigin = `http://127.0.0.1:${(adminServer.address() as AddressInfo).port}`;
  const adminBrowser = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${adminOrigin}/admin#settings/automation`, runScripts: "outside-only", pretendToBeVisual: true
  }).window;
  const adminDocument = adminBrowser.document;
  const adminWrites: typeof writes = [];
  Object.defineProperty(adminBrowser, "fetch", { configurable: true, value: async (path: string, options: RequestInit = {}) => {
    const method = options.method || "GET";
    if (method !== "GET") adminWrites.push({ path, method, body: JSON.parse(String(options.body || "{}")) });
    if (path === "/api/v1/admin/discord") return Response.json(discordOverview());
    if (path === "/api/v1/admin/discord/settings") {
      enabled = JSON.parse(String(options.body)).enabled;
      return Response.json({ settings: { enabled } });
    }
    if (path.startsWith("/api/v1/admin/discord/channels/")) return Response.json({ channel: JSON.parse(String(options.body)) });
    return fetch(new URL(path, adminOrigin), options);
  }});
  Object.defineProperty(adminBrowser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(adminBrowser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(adminBrowser.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(adminBrowser, "CSS", { configurable: true, value: { escape: (value: string) => value } });
  const document = browser.document;
  try {
    await adminBrowser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.equal(adminDocument.querySelector("#adminDiscordReaderStatus")?.textContent, "Reader: Watching"));
    assert.equal((adminDocument.querySelector("#adminDiscordEnabled") as HTMLInputElement).checked, true);
    assert.equal(adminDocument.querySelectorAll("#adminDiscordChannels [data-admin-discord-channel]").length, 2);
    const adminSelects = [...adminDocument.querySelectorAll<HTMLSelectElement>("#adminDiscordChannels select")];
    assert.deepEqual(adminSelects.map(select => select.value), ["add", "log"]);
    assert.deepEqual([...adminSelects[0]!.options].map(option => option.textContent), ["Add to cart", "Log only", "Ignore"]);
    adminSelects[0]!.value = "ignore";
    adminSelects[0]!.dispatchEvent(new adminBrowser.Event("change", { bubbles: true }));
    await eventually(() => assert.deepEqual(adminWrites[0], { path: `/api/v1/admin/discord/channels/${CHANNEL_ADD}`, method: "PATCH", body: { mode: "ignore" } }));
    const adminToggle = adminDocument.querySelector("#adminDiscordEnabled") as HTMLInputElement;
    adminToggle.checked = false;
    adminToggle.dispatchEvent(new adminBrowser.Event("change", { bubbles: true }));
    await eventually(() => assert.deepEqual(adminWrites[1], { path: "/api/v1/admin/discord/settings", method: "PATCH", body: { enabled: false } }));
    assert.equal((adminDocument.querySelector("#adminDiscordEnabled") as HTMLInputElement).checked, false);
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=discord-dashboard-test.js`);
    assert.equal(document.querySelector("#discordReaderStatus"), null);
    assert.equal(document.querySelector("#discordEnabled"), null);
    assert.equal(document.querySelector("#discordChannelList"), null);
    assert.equal(writes.length, 0);
    browser.location.hash = "cart/calls/discord";
    await eventually(() => assert.equal(document.querySelectorAll("#discordCallList .discord-call").length, 2));
    assert.equal(browser.location.hash, "#cart/calls/discord");
    assert.equal((document.querySelector("#callDiscordResults") as HTMLElement).hidden, false);
    assert.equal((document.querySelector("#callProductResults") as HTMLElement).hidden, true);
    assert.equal((document.querySelector("#callDrawingResults") as HTMLElement).hidden, true);
    assert.equal(document.querySelector('[data-call-filter="discord"]')?.getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector("#callCount")?.textContent?.trim(), "2 Discord calls");
    const [matched, unmatched] = [...document.querySelectorAll("#discordCallList .discord-call")] as HTMLElement[];
    assert.equal(matched?.querySelector("h3")?.textContent, "Pokemon Ascended Heroes Elite Trainer Box");
    assert.match(matched?.textContent ?? "", /Discord #target-restocks · Cook Group · Target · \$49\.99/);
    assert.equal(matched?.querySelector(".discord-message")?.textContent, "Restock Bot (#target-restocks, Cook Group): Ascended Heroes ETB is LIVE $49.99");
    assert.match(matched?.querySelector(".discord-trace p")?.textContent ?? "", /^Matched: Yoink matched the Target link/);
    assert.equal(matched?.querySelector("[data-discord-link]"), null);
    assert.equal(unmatched?.querySelector("h3")?.textContent, "Not matched to a product");
    assert.match(unmatched?.querySelector(".discord-trace p")?.textContent ?? "", /^Not matched: Yoink couldn't match the product name/);

    (unmatched?.querySelector("[data-discord-link]") as HTMLButtonElement).click();
    const dialog = document.querySelector("#discordLinkDialog") as HTMLDialogElement;
    assert.equal(dialog.hasAttribute("open"), true);
    assert.equal(document.querySelector("#discordLinkMessage")?.textContent, "Bot (#walmart-restocks, Cook Group): Squishy Gummy Bear Stress Toy restock $9.99");
    await eventually(() => assert.equal(document.querySelectorAll("#discordLinkChoices input[type=radio]").length, 2));
    const submit = document.querySelector('#discordLinkForm button[type="submit"]') as HTMLButtonElement;
    assert.equal(submit.disabled, true, "nothing is linked until a product is picked");
    const first = document.querySelector('#discordLinkChoices input[value="variant_gummy"]') as HTMLInputElement;
    first.checked = true;
    first.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(submit.disabled, false);
    (document.querySelector("#discordLinkForm") as HTMLFormElement).dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    assert.deepEqual(writes[0], { path: "/api/v1/user/discord/links", method: "POST", body: { signalId: "discord:unmatched", variantId: "variant_gummy" } });
    assert.match(document.querySelector("#toast")?.textContent ?? "", /Discord messages with these product words now match NeeDoh Gummy Bear\./);
  } finally {
    browser.close();
    adminBrowser.close();
    await new Promise<void>(resolve => adminServer.close(() => resolve()));
    adminDb.close();
  }
});
