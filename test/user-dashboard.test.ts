import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  HOWL_AFFILIATE_ENDPOINT,
  HOWL_AFFILIATE_PROTOCOL_VERSION,
  HOWL_AFFILIATE_STORES,
  HOWL_DEFAULT_PUBLISHER_SLUG
} from "../packages/domain/src/howl-affiliate-stores.js";

const require = createRequire(import.meta.url);
const AFFILIATE_ROUTING_FIXTURE = {
  protocolVersion: HOWL_AFFILIATE_PROTOCOL_VERSION,
  endpoint: HOWL_AFFILIATE_ENDPOINT,
  publisherSlug: HOWL_DEFAULT_PUBLISHER_SLUG,
  stores: HOWL_AFFILIATE_STORES,
  registeredRetailerDomains: [
    "target.com", "walmart.com", "amazon.com", "bestbuy.com", "disneystore.com",
    "ravensburger.us", "merch.riotgames.com", "booksamillion.com", "fanatics.com",
    "kohls.com", "macys.com", "p-bandai.com", "pokemoncenter.com"
  ]
};
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 40): Promise<void> {
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

/**
 * A virtual clock for one stretch of a page's timers (PLAT-16): positive-delay
 * `setTimeout`s queue against virtual time and fire only when the test
 * advances it, so debounce windows are checked without real sleeps. Zero-delay
 * yields stay real. `restore()` hands still-pending timers back to the real
 * clock with their remaining delay.
 */
function installPageClock(page: Window & typeof globalThis) {
  const realSetTimeout = page.setTimeout as unknown as (callback: (...args: unknown[]) => unknown, delay?: number, ...args: unknown[]) => number;
  const realClearTimeout = page.clearTimeout as unknown as (id?: number) => void;
  const timers = new Map<number, { at: number; run: () => unknown }>();
  let now = 0;
  let nextId = 1_000_000;
  Object.defineProperty(page, "setTimeout", {
    configurable: true,
    value: (callback: (...args: unknown[]) => unknown, delay = 0, ...args: unknown[]) => {
      if (!(Number(delay) > 0)) return realSetTimeout.call(page, callback, 0, ...args);
      const id = nextId++;
      timers.set(id, { at: now + Number(delay), run: () => callback(...args) });
      return id;
    }
  });
  Object.defineProperty(page, "clearTimeout", {
    configurable: true,
    value: (id: number) => {
      if (!timers.delete(id)) realClearTimeout.call(page, id);
    }
  });
  return {
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        await due[1].run();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      now = target;
    },
    restore(): void {
      Object.defineProperty(page, "setTimeout", { configurable: true, value: realSetTimeout });
      Object.defineProperty(page, "clearTimeout", { configurable: true, value: realClearTimeout });
      for (const timer of timers.values()) realSetTimeout.call(page, timer.run, Math.max(0, timer.at - now));
      timers.clear();
    }
  };
}

test("Home surfaces one affiliate-aware urgent handoff and polls the compact action state only", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#cart",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const fetchCalls: string[] = [];
  const polls: Array<{ callback: () => Promise<void>; delay: number }> = [];
  let availabilityEpoch = "a".repeat(32);
  let availabilityVersion = 7;
  let compact: {
    contractVersion: number;
    generatedAt: string;
    counts: { queued: number; checking: number; readyToCheckout: number; needsYou: number };
    primary: null | {
      id: string;
      stage: string;
      statusLabel: string;
      statusSummary: string;
      title: string;
      retailerId: string;
      retailerSku: string;
      canonicalUrl: string;
      createdAt: string;
    };
  } = {
    contractVersion: 1,
    generatedAt: "2026-08-31T18:00:00.000Z",
    counts: { queued: 0, checking: 0, readyToCheckout: 1, needsYou: 1 },
    primary: {
      id: "job_target_home_review",
      stage: "needs_you",
      statusLabel: "Needs you",
      statusSummary: "Check the store cart because Chrome cannot safely infer the result.",
      title: "Home Handoff Fixture",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      createdAt: "2026-08-31T17:59:59.000Z"
    }
  };
  const watchResolvers: Array<(value: {
    actionHandoff: typeof compact;
    availabilityEpoch: string;
    availabilityVersion: number;
  }) => void> = [];
  const watchResult = new Promise<{
    actionHandoff: typeof compact;
    availabilityEpoch: string;
    availabilityVersion: number;
  }>((resolve) => {
    watchResolvers.push(resolve);
  });
  let watchRequestCount = 0;
  const overview = {
    actor: {
      displayName: "Shopper Fixture",
      userId: "user_shopper_fixture",
      tenantName: "Fixture tenant",
      roleLabels: ["Shopper"],
      assuranceLevel: "local_trusted",
      assuranceFresh: true,
      assuranceExpiresAt: "local_session",
      sessionKind: "local",
      signOutUrl: ""
    },
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 1, purchaseIntents: 1, actions: 2, pendingCatalogProposals: 0 },
    actionHandoff: compact,
    actionHandoffAvailabilityEpoch: availabilityEpoch,
    actionHandoffAvailabilityVersion: availabilityVersion,
    sources: [],
    permissions: ["admin.read"],
    spend: {
      activeReservationCount: 1,
      activeReservedCents: 2499,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] },
    announcement: {
      id: "release_current_fixture",
      version: "1.18.0",
      publishedAt: new Date(Date.now() - 13 * 24 * 60 * 60_000).toISOString(),
      title: "A quieter current release",
      summary: "This long summary must not occupy Home.",
      docsUrl: "/docs"
    }
  };
  const nextDropStartsAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const nextDropClosesAt = new Date(Date.now() + 90 * 60_000).toISOString();
  const homeDropWindows = [{
    id: "drop_window_home_fixture",
    retailerId: "target",
    title: "Tonight's card drop",
    startsAt: nextDropStartsAt,
    closesAt: nextDropClosesAt,
    timezone: "America/Los_Angeles",
    status: "scheduled",
    items: []
  }];
  const homeRecentActions = [{
    id: "job_home_got_it",
    title: "Recent purchase fixture",
    retailerId: "target",
    retailerSku: "95280894",
    currency: "USD",
    userReportOutcome: "got_it",
    userReportedTotalCents: 2599,
    userReportedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 20 * 60_000).toISOString()
  }, {
    id: "job_home_missed",
    title: "Recent missed fixture",
    retailerId: "walmart",
    retailerSku: "19988614228",
    currency: "USD",
    userReportOutcome: "missed_it",
    userReportedTotalCents: null,
    userReportedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 40 * 60_000).toISOString()
  }];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string) => {
      fetchCalls.push(path);
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/overview") {
        return { ok: true, status: 200, json: async () => overview };
      }
      if (path === "/api/v1/user/drop-windows") {
        return { ok: true, status: 200, json: async () => ({ items: homeDropWindows }) };
      }
      if (path === "/api/v1/user/jobs?limit=5&offset=0&q=user_reported_") {
        return { ok: true, status: 200, json: async () => ({ items: homeRecentActions }) };
      }
      if (path === "/api/v1/user/action-platform") {
        return { ok: true, status: 200, json: async () => ({ analytics: { spend: {
          dailyCapCents: 10_000,
          availableTodayCents: 7_500,
          monthlyCapCents: 50_000,
          availableThisMonthCents: 32_000
        } } }) };
      }
      if (path.startsWith("/api/v1/user/action-handoff?")) {
        watchRequestCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => watchRequestCount === 1
            ? watchResult
            : { actionHandoff: compact, availabilityEpoch, availabilityVersion }
        };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", {
    configurable: true,
    value: () => 1
  });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "setTimeout", {
    configurable: true,
    value: (callback: () => Promise<void>, delay = 0) => {
      if (delay === 15_000) return -1; // Request deadlines are separate from dashboard polls.
      polls.push({ callback, delay: Number(delay) });
      return polls.length;
    }
  });
  Object.defineProperty(browser, "clearTimeout", { configurable: true, value: () => undefined });

  try {
    browser.eval(`${script}\n//# sourceURL=user-home-action-handoff-test.js`);
    await eventually(() => assert.equal(browser.document.querySelector("#homeActionHandoff")?.hasAttribute("hidden"), false));
    await eventually(() => assert.match(browser.document.querySelector("#homeRecentList")?.textContent ?? "", /Recent purchase fixture/));
    await eventually(() => assert.equal((browser.document.querySelector("#homeUpcomingDrops") as HTMLElement).hidden, false));
    assert.equal(browser.document.querySelector("#homeHeadline")?.textContent, "A cart needs you.");
    assert.equal((browser.document.querySelector("#homeFallback") as HTMLElement).hidden, true,
      "the urgent handoff replaces the passive Home hero");
    assert.match(browser.document.querySelector("#homeActionHandoff")?.textContent ?? "", /Review Home Handoff Fixture/);
    assert.match(browser.document.querySelector("#homeActionHandoff")?.textContent ?? "", /1 more cart is below/);
    assert.equal(browser.document.querySelectorAll("#homeActionHandoff .button.primary").length, 1);
    assert.equal(browser.document.querySelector("#userAccountName")?.textContent, "Shopper Fixture");
    assert.equal(browser.document.querySelector("#userAccountRole")?.textContent, "Shopper");
    assert.equal(browser.document.querySelector("#userAccountSession")?.textContent, "Local session");
    assert.equal((browser.document.querySelector("#adminLink") as HTMLElement).hidden, false);
    assert.equal((browser.document.querySelector("#userSignOutLink") as HTMLElement).hidden, true);
    const storeLink = browser.document.querySelector("#homeActionHandoff .home-cart-handoff-link") as HTMLAnchorElement;
    const route = new URL(storeLink.href);
    assert.equal(storeLink.textContent?.trim(), "Review store ↗");
    assert.equal(route.origin, "https://howl.link");
    assert.equal(route.searchParams.get("url"), "https://www.target.com/cart");
    assert.match(storeLink.rel, /sponsored/);
    assert.equal((browser.document.querySelector("#homeActionHandoff button[data-tab='activity']") as HTMLButtonElement).textContent, "Details");
    const homeChildren = [...(browser.document.querySelector('[data-panel="cart"]') as HTMLElement).children];
    const homeOrder = ["homeNow", "wantedSection", "homeCalls", "homeUpcomingDrops", "homeRecent"]
      .map((id) => homeChildren.findIndex((element) => element.id === id));
    assert.deepEqual(homeOrder, [...homeOrder].sort((first, second) => first - second));
    assert.equal(browser.document.querySelector("#metrics"), null, "Home has no cumulative product, plan, or action counters");
    assert.match(browser.document.querySelector("#homeUpcomingDrops")?.textContent ?? "", /Drops.*Tonight's card drop/s);
    assert.match(browser.document.querySelector("#homeUpcomingDrops")?.textContent ?? "", /\d{1,2}:\d{2}/);
    assert.match(browser.document.querySelector("#homeRecentList")?.textContent ?? "", /Recent purchase fixture.*\$25\.99.*Got it/s);
    assert.match(browser.document.querySelector("#homeRecentList")?.textContent ?? "", /Recent missed fixture.*Missed/s);
    // Limits moved to Setup; Cart no longer loads store action status for them.
    assert.equal(browser.document.querySelector("#homeLimitGrid"), null);
    assert.equal(fetchCalls.includes("/api/v1/user/action-platform"), false);
    assert.equal((browser.document.querySelector("#releaseAnnouncement") as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector("#releaseAnnouncement")?.textContent ?? "", /New in 1\.18\.0.*A quieter current release.*What changed/s);
    assert.equal(browser.document.querySelector("#releaseAnnouncementSummary"), null,
      "the release notice does not duplicate its long summary on Home");
    overview.announcement.publishedAt = new Date(Date.now() - 15 * 24 * 60 * 60_000).toISOString();
    await browser.eval("renderAnnouncement()");
    assert.equal((browser.document.querySelector("#releaseAnnouncement") as HTMLElement).hidden, true,
      "release notices automatically hide after fourteen days");
    overview.announcement.publishedAt = new Date(Date.now() - 1 * 24 * 60 * 60_000).toISOString();
    await browser.eval("renderAnnouncement()");
    (browser.document.querySelector("#dismissReleaseAnnouncement") as HTMLButtonElement).click();
    assert.equal((browser.document.querySelector("#releaseAnnouncement") as HTMLElement).hidden, true);
    assert.equal(browser.localStorage.getItem("yoinkDismissedAnnouncementV1"), "release_current_fixture");
    const initialWatch = fetchCalls.find((path) => path.startsWith("/api/v1/user/action-handoff?")
      && new URL(path, "http://127.0.0.1:32991").searchParams.get("wait") === "5000");
    assert.ok(initialWatch);
    const initialWatchUrl = new URL(initialWatch, "http://127.0.0.1:32991");
    assert.equal(initialWatchUrl.searchParams.get("wait"), "5000");
    assert.equal(initialWatchUrl.searchParams.get("version"), "7");
    assert.equal(initialWatchUrl.searchParams.get("epoch"), "a".repeat(32));

    const replacedProcessResult = {
      contractVersion: 1,
      generatedAt: "2026-08-31T18:00:05.000Z",
      counts: { queued: 0, checking: 0, readyToCheckout: 0, needsYou: 0 },
      primary: null
    };
    assert.equal(polls.length, 1);
    assert.equal(polls[0]?.delay, 30_000);
    assert.equal(watchResolvers.length, 1);

    availabilityEpoch = "b".repeat(32);
    availabilityVersion = 0;
    compact = {
      contractVersion: 1,
      generatedAt: "2026-08-31T18:00:06.000Z",
      counts: { queued: 0, checking: 0, readyToCheckout: 1, needsYou: 0 },
      primary: {
        id: "job_target_home_ready",
        stage: "ready_to_checkout",
        statusLabel: "Ready to check out",
        statusSummary: "The exact cart is ready for manual checkout.",
        title: "Restart-safe fixture",
        retailerId: "target",
        retailerSku: "95280894",
        canonicalUrl: "https://www.target.com/p/-/A-95280894",
        createdAt: "2026-08-31T18:00:05.000Z"
      }
    };
    overview.actionHandoff = compact;
    overview.actionHandoffAvailabilityEpoch = availabilityEpoch;
    overview.actionHandoffAvailabilityVersion = availabilityVersion;
    await browser.eval("refresh()");
    await eventually(() => assert.equal(browser.document.querySelector("#homeHeadline")?.textContent, "Your cart is ready."));

    watchResolvers[0]?.({
      actionHandoff: replacedProcessResult,
      availabilityEpoch: "a".repeat(32),
      availabilityVersion: 8
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(browser.document.querySelector("#homeHeadline")?.textContent, "Your cart is ready.",
      "A late response from the replaced API process must not overwrite the current handoff.");

    compact = replacedProcessResult;
    availabilityVersion = 2;
    const currentCursorRequestStart = fetchCalls.length;
    await browser.eval("refreshCompactActionHandoff(0)");
    const currentCursorRequest = fetchCalls.slice(currentCursorRequestStart)
      .find((path) => path.startsWith("/api/v1/user/action-handoff?"));
    assert.ok(currentCursorRequest);
    const currentCursorUrl = new URL(currentCursorRequest, "http://127.0.0.1:32991");
    assert.equal(currentCursorUrl.searchParams.get("epoch"), "b".repeat(32));
    assert.equal(currentCursorUrl.searchParams.get("version"), "0");
    await eventually(() => assert.equal(browser.document.querySelector("#homeActionHandoff")?.hasAttribute("hidden"), true));
    compact = overview.actionHandoff;
    availabilityVersion = 1;
    const staleVersionRequestStart = fetchCalls.length;
    await browser.eval("refreshCompactActionHandoff(0)");
    const staleVersionRequest = fetchCalls.slice(staleVersionRequestStart)
      .find((path) => path.startsWith("/api/v1/user/action-handoff?"));
    assert.ok(staleVersionRequest);
    assert.equal(new URL(staleVersionRequest, "http://127.0.0.1:32991").searchParams.get("version"), "2");
    assert.equal(browser.document.querySelector("#homeActionHandoff")?.hasAttribute("hidden"), true,
      "A lower version from the current API process must not restore stale state.");
    assert.equal(fetchCalls.some((path) => path.startsWith("/api/v1/user/action-handoff?")), true);
    assert.equal(fetchCalls.some((path) => path === "/api/v1/user/jobs?limit=5&offset=0&q=user_reported_"), true);
  } finally {
    browser.close();
  }
});

test("Home surfaces one validated Walmart purchase handoff and consumes it across dashboard views", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#cart",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const itemId = "19988614228";
  const jobId = "job_walmart_home_purchase";
  const reviewOrderUrl = `https://www.walmart.com/affil/cart/reviewOrder?items=${itemId}&cn=nc&veh=aff`;
  const howlUrl = new URL("https://howl.link/link");
  howlUrl.searchParams.set("url", reviewOrderUrl);
  howlUrl.searchParams.set("publisher_slug", "collectwithdodo");
  howlUrl.searchParams.set("article_name", "Walmart Home fixture");
  howlUrl.searchParams.set("article_url", "https://yoink.example/alerts");
  howlUrl.searchParams.set("u1", `walmart_${itemId}`);
  const handoff = {
    contractVersion: 1,
    generatedAt: new Date().toISOString(),
    counts: { queued: 0, checking: 0, readyToCheckout: 0, needsYou: 0 },
    primary: {
      id: jobId,
      stage: "purchase_ready",
      statusLabel: "Buy at Walmart",
      statusSummary: "Validated in stock and within your saved price, seller, and shipping rules.",
      title: "Walmart Home fixture",
      retailerId: "walmart",
      retailerSku: itemId,
      canonicalUrl: `https://www.walmart.com/ip/${itemId}`,
      createdAt: new Date().toISOString(),
      purchaseHandoff: {
        kind: "walmart_review_order",
        walmartItemId: itemId,
        destinationUrl: howlUrl.href,
        directFallbackUrl: reviewOrderUrl,
        pdpFallbackUrl: `https://www.walmart.com/ip/${itemId}`,
        trackingId: `walmart_${itemId}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }
    }
  };
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 1, purchaseIntents: 1, actions: 1, pendingCatalogProposals: 0 },
    actionHandoff: handoff,
    actionHandoffAvailabilityEpoch: "e".repeat(32),
    actionHandoffAvailabilityVersion: 1,
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const clicks: Array<Record<string, unknown>> = [];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: Record<string, unknown> = {}) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/overview") {
        return { ok: true, status: 200, json: async () => overview };
      }
      if (path.startsWith("/api/v1/user/action-handoff?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            actionHandoff: handoff,
            availabilityEpoch: "e".repeat(32),
            availabilityVersion: 1
          })
        };
      }
      if (path === `/api/v1/user/purchase-handoffs/${jobId}/click`) {
        clicks.push({
          keepalive: options.keepalive,
          body: JSON.parse(String(options.body || "{}"))
        });
        return { ok: true, status: 202, json: async () => ({ click: { recorded: true } }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });

  try {
    browser.eval(`${script}\n//# sourceURL=user-home-walmart-handoff-test.js`);
    await eventually(() => assert.equal(
      browser.document.querySelector("#homeActionHandoff")?.hasAttribute("hidden"),
      false
    ));
    assert.equal(browser.document.querySelector("#homeHeadline")?.textContent, "Buy at Walmart is ready.");
    assert.match(browser.document.querySelector("#homeActionHandoff")?.textContent ?? "", /Walmart Home fixture is ready to add/);
    const link = browser.document.querySelector("#homeActionHandoff [data-walmart-buy]") as HTMLAnchorElement;
    assert.ok(link);
    assert.equal(link.dataset.walmartSurface, "home");
    assert.equal(link.dataset.walmartJob, jobId);
    assert.equal(link.href, howlUrl.href);
    assert.match(link.rel, /sponsored/);
    assert.equal(
      (browser.document.querySelector("#homeActionHandoff button[data-tab='calls']") as HTMLButtonElement).textContent,
      "Details"
    );

    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.click();
    await eventually(() => assert.equal(clicks.length, 1));
    assert.deepEqual(clicks[0], {
      keepalive: true,
      body: {
        routeKind: "howl",
        surface: "home",
        confirmation: "OPEN_WALMART_PURCHASE_HANDOFF"
      }
    });
    await eventually(() => assert.equal(
      browser.document.querySelector("#homeActionHandoff")?.hasAttribute("hidden"),
      true
    ));
    link.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(clicks.length, 1, "The same dashboard handoff must remain one-use after it opens.");
  } finally {
    browser.close();
  }
});

test("cold Home renders a ready cart before overview and attribution finish", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#cart",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const epoch = "d".repeat(32);
  const handoff = {
    contractVersion: 1,
    generatedAt: "2026-09-01T18:00:00.000Z",
    counts: { queued: 0, checking: 0, readyToCheckout: 1, needsYou: 0 },
    primary: {
      id: "job_cold_home_ready",
      stage: "ready_to_checkout",
      statusLabel: "Ready to check out",
      statusSummary: "The exact cart is ready for manual checkout.",
      title: "Cold Home fixture",
      retailerId: "target",
      retailerSku: "95280902",
      canonicalUrl: "https://www.target.com/p/-/A-95280902",
      createdAt: "2026-09-01T18:00:00.000Z"
    }
  };
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 1, purchaseIntents: 1, actions: 1, pendingCatalogProposals: 0 },
    actionHandoff: handoff,
    actionHandoffAvailabilityEpoch: epoch,
    actionHandoffAvailabilityVersion: 3,
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 1,
      activeReservedCents: 2499,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const fetchCalls: string[] = [];
  let overviewBlocked = false;
  let routingBlocked = false;
  let releaseOverview: () => void = () => undefined;
  let releaseRouting: () => void = () => undefined;

  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string) => {
      fetchCalls.push(path);
      if (path === "/api/v1/user/overview") {
        await new Promise<void>((resolve) => {
          overviewBlocked = true;
          releaseOverview = resolve;
        });
        return { ok: true, status: 200, json: async () => overview };
      }
      if (path === "/api/v1/affiliate-routing") {
        await new Promise<void>((resolve) => {
          routingBlocked = true;
          releaseRouting = resolve;
        });
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path.startsWith("/api/v1/user/action-handoff?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ actionHandoff: handoff, availabilityEpoch: epoch, availabilityVersion: 3 })
        };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });

  try {
    browser.eval(`${script}\n//# sourceURL=user-cold-home-handoff-test.js`);
    const compactIndex = fetchCalls.findIndex((path) => path.startsWith("/api/v1/user/action-handoff?"));
    const overviewIndex = fetchCalls.indexOf("/api/v1/user/overview");
    const routingIndex = fetchCalls.indexOf("/api/v1/affiliate-routing");
    assert.ok(compactIndex >= 0 && overviewIndex > compactIndex && routingIndex > compactIndex,
      "Cold Home must request the compact handoff before overview and attribution.");
    await eventually(() => assert.equal(browser.document.querySelector("#homeHeadline")?.textContent, "Your cart is ready."));
    assert.equal(overviewBlocked, true);
    assert.equal(routingBlocked, true);
    const directLink = browser.document.querySelector("#homeActionHandoff .home-cart-handoff-link") as HTMLAnchorElement;
    assert.equal(directLink.href, "https://www.target.com/cart");
    assert.equal(directLink.rel.includes("sponsored"), false);

    releaseOverview();
    releaseRouting();
    await eventually(() => assert.equal(browser.document.querySelector("#modePill")?.textContent, "On"));
    await eventually(() => assert.equal(
      new URL((browser.document.querySelector("#homeActionHandoff .home-cart-handoff-link") as HTMLAnchorElement).href).origin,
      "https://howl.link"
    ));
  } finally {
    releaseOverview();
    releaseRouting();
    browser.close();
  }
});

test("returning to a visible dashboard renders cart-ready before a slow workspace refresh", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#cart",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const epoch = "c".repeat(32);
  type CompactHandoffFixture = {
    contractVersion: number;
    generatedAt: string;
    counts: { queued: number; checking: number; readyToCheckout: number; needsYou: number };
    primary: null | {
      id: string;
      stage: string;
      statusLabel: string;
      statusSummary: string;
      title: string;
      retailerId: string;
      retailerSku: string;
      canonicalUrl: string;
      createdAt: string;
    };
  };
  const emptyHandoff: CompactHandoffFixture = {
    contractVersion: 1,
    generatedAt: "2026-09-01T17:00:00.000Z",
    counts: { queued: 0, checking: 0, readyToCheckout: 0, needsYou: 0 },
    primary: null
  };
  const readyHandoff: CompactHandoffFixture = {
    contractVersion: 1,
    generatedAt: "2026-09-01T17:00:01.000Z",
    counts: { queued: 0, checking: 0, readyToCheckout: 1, needsYou: 0 },
    primary: {
      id: "job_resume_cart_ready",
      stage: "ready_to_checkout",
      statusLabel: "Ready to check out",
      statusSummary: "The exact cart is ready for manual checkout.",
      title: "Resume-priority fixture",
      retailerId: "walmart",
      retailerSku: "19988614228",
      canonicalUrl: "https://www.walmart.com/ip/Resume-Priority/19988614228",
      createdAt: "2026-09-01T17:00:01.000Z"
    }
  };
  let compact = emptyHandoff;
  let availabilityVersion = 1;
  let blockOverview = false;
  let overviewBlocked = false;
  let releaseOverview: () => void = () => undefined;
  let completedOverviewResponses = 0;
  let completedHandoffResponses = 0;
  const fetchCalls: string[] = [];
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 1, purchaseIntents: 1, actions: 1, pendingCatalogProposals: 0 },
    actionHandoff: emptyHandoff,
    actionHandoffAvailabilityEpoch: epoch,
    actionHandoffAvailabilityVersion: 1,
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const jsonResponse = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: async () => payload
  });

  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string) => {
      fetchCalls.push(path);
      if (path === "/api/v1/affiliate-routing") {
        return jsonResponse({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE });
      }
      if (path === "/api/v1/user/overview") {
        if (blockOverview) {
          await new Promise<void>((resolve) => {
            overviewBlocked = true;
            releaseOverview = resolve;
          });
        }
        completedOverviewResponses += 1;
        return jsonResponse(overview);
      }
      if (path.startsWith("/api/v1/user/action-handoff?")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            completedHandoffResponses += 1;
            return {
              actionHandoff: compact,
              availabilityEpoch: epoch,
              availabilityVersion
            };
          }
        };
      }
      return jsonResponse({ items: [] });
    }
  });
  Object.defineProperty(browser, "setInterval", {
    configurable: true,
    value: () => 1
  });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });

  try {
    browser.eval(`${script}\n//# sourceURL=user-resume-priority-test.js`);
    await eventually(() => assert.equal(completedOverviewResponses, 1));
    await eventually(() => assert.equal(completedHandoffResponses, 2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fetchCalls.length = 0;
    compact = readyHandoff;
    availabilityVersion = 2;
    overview.actionHandoff = readyHandoff;
    overview.actionHandoffAvailabilityVersion = 2;
    blockOverview = true;

    browser.document.dispatchEvent(new browser.Event("visibilitychange"));

    const compactIndex = fetchCalls.findIndex((path) => path.startsWith("/api/v1/user/action-handoff?"));
    const overviewIndex = fetchCalls.indexOf("/api/v1/user/overview");
    assert.ok(compactIndex >= 0, "Visibility resume must start the compact handoff request.");
    assert.ok(overviewIndex > compactIndex, "The compact handoff request must start before the broader overview refresh.");
    await eventually(() => assert.equal(browser.document.querySelector("#homeHeadline")?.textContent, "Your cart is ready."));
    assert.equal(overviewBlocked, true, "The broader overview should still be waiting when cart-ready renders.");

    releaseOverview();
    blockOverview = false;
    await eventually(() => assert.equal(completedOverviewResponses, 2));
  } finally {
    releaseOverview();
    browser.close();
  }
});

test("all six checkout links fall back directly when affiliate routing is unavailable", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#activity",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const fetchCalls: string[] = [];
  const storeClickBodies: Array<Record<string, unknown>> = [];
  let overviewBlocked = false;
  let routingBlocked = false;
  let releaseOverview: () => void = () => undefined;
  let releaseRouting: () => void = () => undefined;
  const retailers = [
    {
      id: "target",
      sku: "95280902",
      canonicalUrl: "https://www.target.com/p/-/A-95280902",
      cartUrl: "https://www.target.com/cart"
    },
    {
      id: "walmart",
      sku: "19988614228",
      canonicalUrl: "https://www.walmart.com/ip/Direct-Fallback/19988614228",
      cartUrl: "https://www.walmart.com/cart"
    },
    {
      id: "amazon",
      sku: "B00E4AMFKK",
      canonicalUrl: "https://www.amazon.com/dp/B00E4AMFKK",
      cartUrl: "https://www.amazon.com/gp/cart/view.html"
    },
    {
      id: "bestbuy",
      sku: "6685081",
      canonicalUrl: "https://www.bestbuy.com/site/-/6685081.p",
      cartUrl: "https://www.bestbuy.com/cart"
    },
    {
      id: "pokemoncenter",
      sku: "10-10320-101",
      canonicalUrl: "https://www.pokemoncenter.com/product/10-10320-101/binder",
      cartUrl: "https://www.pokemoncenter.com/cart"
    },
    {
      id: "aninebing", sku: "41205281521736",
      canonicalUrl: "https://www.aninebing.com/products/anine-clutch-tango-red?variant=41205281521736",
      cartUrl: "https://www.aninebing.com/cart"
    }
  ];
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: retailers.length, purchaseIntents: retailers.length, actions: retailers.length, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const actions = retailers.map((retailer) => ({
    id: `job_direct_fallback_${retailer.id}`,
    title: `${retailer.id} direct fallback fixture`,
    retailerId: retailer.id,
    retailerSku: retailer.sku,
    canonicalUrl: retailer.canonicalUrl,
    action: "add_to_cart",
    state: "confirmed",
    stage: "ready_to_checkout",
    statusLabel: "Ready to check out",
    decisionSource: "purchase_intent",
    maxUnitPriceCents: 10_000,
    currency: "USD",
    spendReservationStatus: "committed"
  }));

  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: RequestInit = {}) => {
      fetchCalls.push(path);
      if (path === "/api/v1/user/store-link-clicks") {
        storeClickBodies.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        return { ok: true, status: 201, json: async () => ({ recorded: true }) };
      }
      if (path === "/api/v1/affiliate-routing") {
        await new Promise<void>((resolve) => {
          routingBlocked = true;
          releaseRouting = resolve;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            affiliateRouting: {
              protocolVersion: 999,
              endpoint: "https://howl.link/link",
              publisherSlug: "collectwithdodo",
              stores: [],
              registeredRetailerDomains: ["attacker.example"]
            }
          })
        };
      }
      if (path === "/api/v1/user/overview") {
        await new Promise<void>((resolve) => {
          overviewBlocked = true;
          releaseOverview = resolve;
        });
        return { ok: true, status: 200, json: async () => overview };
      }
      if (path === "/api/v1/user/jobs?limit=100&offset=0") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: actions,
            insights: { stages: { ready_to_checkout: retailers.length }, latency: { hops: {} } },
            glossary: {}
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });

  try {
    browser.eval(`${script}\n//# sourceURL=user-direct-checkout-fallback-test.js`);
    const jobsIndex = fetchCalls.indexOf("/api/v1/user/jobs?limit=100&offset=0");
    const overviewIndex = fetchCalls.indexOf("/api/v1/user/overview");
    const routingIndex = fetchCalls.indexOf("/api/v1/affiliate-routing");
    assert.ok(jobsIndex >= 0, "Cold Activity startup must request urgent actions immediately.");
    assert.ok(overviewIndex > jobsIndex && routingIndex > jobsIndex,
      "Urgent actions must start before overview and attribution routing.");
    await eventually(() => assert.equal(
      browser.document.querySelectorAll("#actionList .cart-handoff-link").length,
      retailers.length
    ));
    assert.equal(overviewBlocked, true);
    assert.equal(routingBlocked, true);
    const links = [...browser.document.querySelectorAll("#actionList .cart-handoff-link")] as HTMLAnchorElement[];
    assert.deepEqual(links.map((link) => link.href), retailers.map((retailer) => retailer.cartUrl));
    assert.equal(links.every((link) => !link.rel.includes("sponsored")), true);
    assert.equal(links.every((link) => link.rel.includes("noopener") && link.rel.includes("noreferrer")), true);
    links[0]?.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }));
    await eventually(() => assert.equal(storeClickBodies.length, 1));
    assert.deepEqual(storeClickBodies[0], {
      jobId: "job_direct_fallback_target",
      canonicalUrl: "https://www.target.com/cart",
      routeKind: "direct",
      destinationKind: "cart",
      surface: "activity",
      confirmation: "RECORD_STORE_LINK_CLICK"
    });

    releaseOverview();
    releaseRouting();
    await eventually(() => assert.equal(browser.document.querySelector("#modePill")?.textContent, "On"));
    assert.equal(fetchCalls.filter((path) => path === "/api/v1/user/jobs?limit=100&offset=0").length, 1,
      "The cold-start action response must be reused by the completed dashboard refresh.");
    assert.equal(
      browser.eval("retailerLinkMarkup('https://attacker.example/cart', 'Unsafe', 'Open')"),
      "",
      "Affiliate failure must not turn arbitrary HTTPS URLs into direct links."
    );
  } finally {
    releaseOverview();
    releaseRouting();
    browser.close();
  }
});

test("guided dashboard setup does not create a plan before review and submits explicit exact limits", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#find",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const posts: Array<Record<string, unknown>> = [];
  const preflights: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const deletions: Array<Record<string, unknown>> = [];
  const transitions: Array<Record<string, unknown>> = [];
  const bulkApplications: Array<Record<string, unknown>> = [];
  let created = false;
  let transitioned = false;
  const product = {
    variantId: "variant_dashboard_test",
    title: "Exact Dashboard Fixture",
    listingId: "listing_dashboard_test",
    retailerId: "target",
    retailerName: "Target",
    retailerSku: "95280900",
    canonicalUrl: "https://www.target.com/p/-/A-95280900",
    status: "in_stock",
    executionSupported: true,
    msrpCents: 2495,
    currentPriceCents: 798,
    currency: "USD",
    variantAttributes: { edition: "First", color: "Forest" }
  };
  const libraryGroup = {
    variantId: product.variantId,
    familyId: "family_dashboard_test",
    title: product.title,
    brand: "",
    variantAttributes: product.variantAttributes,
    createdAt: "2026-08-25T17:00:00.000Z",
    storeCount: 1,
    listingCount: 1,
    availableListingCount: 1,
    bestPriceCents: product.currentPriceCents,
    currency: product.currency,
    lastActivityAt: "2026-08-25T17:30:00.000Z",
    listings: [{
      listingId: product.listingId,
      retailerId: product.retailerId,
      retailerName: product.retailerName,
      retailerSku: product.retailerSku,
      canonicalUrl: product.canonicalUrl,
      status: product.status,
      executionSupported: product.executionSupported,
      msrpCents: product.msrpCents,
      currency: product.currency,
      currentPriceCents: product.currentPriceCents,
      priceObservedAt: "2026-08-25T17:30:00.000Z",
      updatedAt: "2026-08-25T17:30:00.000Z"
    }]
  };
  const overview = {
    settings: {
      actionsPaused: true,
      executionMode: "shadow",
      taxBps: 0,
      storeAllowancesCents: { target: 0 }
    },
    counts: { products: 1, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const planSummary = {
    id: "mission_dashboard_test",
    variantId: product.variantId,
    title: product.title,
    status: "active",
    targetQuantity: 2,
    targetCount: 1,
    enabledTargetCount: 1,
    actionCeiling: "add_to_cart",
    decisionMode: "purchase_intent",
    maxAllInCents: 2000,
    primaryRetailerName: "Target",
    primaryRetailerSku: product.retailerSku,
    primaryCanonicalUrl: product.canonicalUrl,
    primaryCurrentPriceCents: 798,
    primaryMaxUnitPriceCents: 1000,
    primaryFulfillment: "shipping",
    automationReadiness: {
      contractVersion: 1,
      state: "guarded_add_lane_closed",
      level: "attention",
      readyForMonitoring: true,
      readyForGuardedAdd: false,
      headline: "Target is not switched on for cart adds yet",
      summary: "Yoink will keep watching. Turn on cart adds for this store before expecting an item in your cart.",
      technicalReason: "readiness:guarded_add_lane_closed · target:lane_not_qualified",
      nextActionLabel: "Review plan",
      checks: [{
        id: "lane",
        label: "Store cart adds",
        state: "attention",
        detail: "Target is not switched on for cart adds yet."
      }]
    }
  };
  const planDetail = {
    ...planSummary,
    intentPolicy: {
      revision: 1,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      decisionMode: "purchase_intent",
      maxSignalAgeSeconds: 120,
      substitutionPolicy: "exact_only",
      cooldownSeconds: 900,
      expiresAt: ""
    },
    targets: [{
      id: "mission_target_dashboard_test",
      listingId: product.listingId,
      retailerId: product.retailerId,
      retailerName: product.retailerName,
      retailerSku: product.retailerSku,
      canonicalUrl: product.canonicalUrl,
      executionSupported: true,
      enabled: true,
      maxUnitPriceCents: 1000,
      sellerPolicy: "first_party_only",
      fulfillment: "manual",
      legacyFulfillmentMapped: true,
      currency: "USD",
      lastObservedPriceCents: 798
    }]
  };
  const monitoringPlanSummary = {
    ...planSummary,
    id: "mission_dashboard_monitoring_test",
    title: "Monitoring-only fixture",
    actionCeiling: "notify",
    automationReadiness: {
      contractVersion: 1,
      state: "notification_ready",
      level: "off",
      readyForMonitoring: true,
      readyForGuardedAdd: false,
      headline: "Monitoring only",
      summary: "No store control is authorized.",
      checks: []
    }
  };
  const bulkProfile = {
    id: "purchase_profile_bulk_dashboard",
    name: "Fast shipping",
    targetQuantity: 1,
    actionCeiling: "add_to_cart",
    fulfillment: "shipping",
    priceMode: "fixed_cap",
    maxUnitPriceCents: 1_000,
    msrpOffsetPercent: null,
    isDefault: false,
    cooldownSeconds: 0,
    createdAt: "2026-08-25T17:00:00.000Z",
    updatedAt: "2026-08-25T17:00:00.000Z"
  };
  const payloadFor = (path: string) => {
    if (path === "/api/v1/affiliate-routing") return { affiliateRouting: AFFILIATE_ROUTING_FIXTURE };
    if (path === "/api/v1/user/overview") return overview;
    if (path === "/api/v1/user/privacy") return { inventory: {
      totalRecords: 12,
      credentialMaterialsExcluded: true,
      categories: [{ id: "catalog_and_plans", label: "Products and purchase plans", recordCount: 12 }]
    } };
    if (path.startsWith("/api/v1/user/library")) return { items: [{ ...libraryGroup, purchaseIntent: created ? planSummary : null }], total: 1 };
    if (path === "/api/v1/user/purchase-intents/legacy-transition") return { preview: {
      contractVersion: 1,
      eligibleCount: transitioned ? 0 : 1,
      activeCount: transitioned ? 0 : 1,
      pausedCount: 0,
      previewFingerprint: "b".repeat(64),
      outcome: "notification_only",
      retailerMutationAuthorized: false,
      checkoutAuthorized: false,
      samplePlans: transitioned ? [] : [{ id: "mission_imported_test", title: "Imported Signal Fixture", status: "active" }]
    } };
    if (path === "/api/v1/user/purchase-intents/mission_dashboard_test") return { purchaseIntent: planDetail };
    if (path.startsWith("/api/v1/user/purchase-intents")) return { items: created ? [planSummary, monitoringPlanSummary] : [] };
    if (path === "/api/v1/user/purchase-profiles") return { items: [bulkProfile] };
    if (path.startsWith("/api/v1/user/jobs")) return { items: [] };
    if (path.startsWith("/api/v1/user/catalog/proposals")) return { items: [] };
    return {};
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (path === "/api/v1/user/purchase-intents/legacy-transition" && options.method === "POST") {
        transitions.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        transitioned = true;
        return { ok: true, status: 200, json: async () => ({ transition: { transitionedCount: 1, preview: { eligibleCount: 0 } } }) };
      }
      if (path === "/api/v1/user/purchase-intents/want/preview" && options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ preview: {
          contractVersion: 1, noPlanSaved: true, listingId: product.listingId, variantId: product.variantId,
          title: product.title, imageUrl: "", msrpCents: product.msrpCents, requestedMode: "add_to_cart", mode: "add_to_cart",
          summary: "When Target has it in stock for $24.95 or less, Yoink adds it to your cart. You check out yourself.",
          targetQuantity: 1, maxUnitPriceCents: 2495, maxAllInCents: 2495,
          stores: [{ listingId: product.listingId, retailerId: "target", retailerName: "Target", retailerSku: product.retailerSku,
            priceCents: product.currentPriceCents, availability: "in_stock", cartReady: false, watch: "add_to_cart", note: "Alerts you until Target's store check passes" }],
          spendingLimit: { allowed: true, reasonCode: "within_spending_limits", message: "" }, plan: null, canSave: true,
          previewFingerprint: "d".repeat(64), previewedAt: "2026-08-25T18:00:00.000Z", validForSeconds: 300
        } }) };
      }
      if (path === "/api/v1/user/purchase-intents/preflight" && options.method === "POST") {
        const draft = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        preflights.push(draft);
        const itemSubtotalCapCents = Number(draft.targetQuantity) * Number(draft.maxUnitPriceCents);
        return { ok: true, status: 200, json: async () => ({ preflight: {
          contractVersion: 1,
          noPurchasePlanSaved: true,
          draft,
          cost: {
            currency: "USD",
            itemSubtotalCapCents,
            taxReserveCents: 0,
            storeReserveCents: 0,
            minimumAllInCents: itemSubtotalCapCents,
            reviewedAllInCents: Number(draft.maxAllInCents),
            headroomCents: Number(draft.maxAllInCents) - itemSubtotalCapCents
          },
          automationReadiness: {
            headline: "Target is not switched on for cart adds yet",
            summary: "Yoink will keep watching until cart adds are switched on."
          },
          preflightFingerprint: "a".repeat(64),
          preflightedAt: "2026-08-25T18:00:00.000Z",
          validUntil: "2026-08-25T18:05:00.000Z",
          validForSeconds: 300
        } }) };
      }
      if (path === "/api/v1/user/purchase-profiles/apply" && options.method === "POST") {
        const request = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        bulkApplications.push(request);
        (planSummary as Record<string, unknown>).quickAddProfileId = bulkProfile.id;
        (monitoringPlanSummary as Record<string, unknown>).quickAddProfileId = bulkProfile.id;
        return { ok: true, status: 200, json: async () => ({ applied: {
          profile: bulkProfile,
          selectedMissionCount: 2,
          linkedMissionCount: 2,
          propagation: {
            matchedMissionCount: 2,
            updatedMissionCount: 1,
            skipped: [{ missionId: monitoringPlanSummary.id, title: monitoringPlanSummary.title, reasonCode: "price_unavailable" }]
          }
        } }) };
      }
      if (path === "/api/v1/user/purchase-intents/mission_dashboard_test" && options.method === "DELETE") {
        deletions.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        created = false;
        return { ok: true, status: 200, json: async () => ({ deletion: { id: "mission_dashboard_test", deleted: true } }) };
      }
      if (options.method === "POST") {
        posts.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        created = true;
        return { ok: true, status: 201, json: async () => ({ created: true, purchaseIntent: {} }) };
      }
      if (options.method === "PATCH") {
        const request = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        patches.push(request);
        if (path === "/api/v1/user/purchase-intents/mission_dashboard_test"
          && ["active", "paused"].includes(String(request.status))) {
          planSummary.status = String(request.status);
          planDetail.status = String(request.status);
        }
        return { ok: true, status: 200, json: async () => ({ purchaseIntent: planDetail }) };
      }
      return { ok: true, status: 200, json: async () => payloadFor(String(path)) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: true, note: "" }) }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); }
  });

  try {
    assert.equal(browser.document.querySelector("[data-legacy-plan-transition]"), null,
      "the document reserves no migration-specific panel before eligibility is known");
    assert.equal(browser.document.querySelector("#legacyPlanTransitionDialog"), null,
      "the document reserves no migration dialog for accounts without eligible plans");
    browser.eval(`${script}\n//# sourceURL=user-dashboard-test.js`);
    await eventually(() => assert.equal(browser.document.querySelector("#productList [data-want-listing]")?.textContent?.trim(), "Want it"));
    assert.equal(browser.document.querySelector("[data-quick-menu], [data-quick-add]"), null, "Want it replaced every Quick add entry point");
    (browser.document.querySelector('.tabs [data-tab="cart"]') as HTMLButtonElement).click();
    let transitionPanel: HTMLElement | null = null;
    await eventually(() => {
      transitionPanel = browser.document.querySelector("[data-legacy-plan-transition]") as HTMLElement;
      assert.ok(transitionPanel);
    });
    const visibleTransitionPanel = browser.document.querySelector("[data-legacy-plan-transition]") as HTMLElement;
    assert.ok(visibleTransitionPanel);
    assert.match(visibleTransitionPanel.textContent ?? "", /1 imported plan needs review/);
    (browser.document.querySelector("#reviewLegacyPlanTransitionButton") as HTMLButtonElement).click();
    const transitionDialog = browser.document.querySelector("#legacyPlanTransitionDialog") as HTMLDialogElement;
    assert.equal(transitionDialog.hasAttribute("open"), true);
    assert.match(transitionDialog.textContent ?? "", /Make these plans notification-only/);
    const transitionForm = browser.document.querySelector("#legacyPlanTransitionForm") as HTMLFormElement;
    const transitionReviewed = transitionForm.elements.namedItem("reviewed") as HTMLInputElement;
    const transitionButton = browser.document.querySelector("#transitionLegacyPlansButton") as HTMLButtonElement;
    assert.equal(transitionButton.disabled, true);
    transitionReviewed.checked = true;
    transitionReviewed.dispatchEvent(new browser.Event("change", { bubbles: true }));
    assert.equal(transitionButton.disabled, false);
    transitionForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(transitions.length, 1));
    assert.deepEqual(transitions[0], {
      contractVersion: 1,
      previewFingerprint: "b".repeat(64),
      confirmation: "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    });
    await eventually(() => assert.equal(transitionDialog.hasAttribute("open"), false));
    await eventually(() => assert.equal(browser.document.querySelector("[data-legacy-plan-transition]"), null));
    assert.equal(browser.document.querySelector("#legacyPlanTransitionDialog"), null);
    (browser.document.querySelector('.tabs [data-tab="find"]') as HTMLButtonElement).click();
    const productList = browser.document.querySelector("#productList") as HTMLElement;
    assert.ok(productList.querySelector(".compact-product-card"));
    assert.equal(browser.document.querySelector('.product-view-toggle'), null);
    assert.match(productList.querySelector(".product-offer-summary")?.textContent ?? "", /Target.*Stock unknown/,
      "catalog availability without a timestamp must not imply a recent stock report");
    assert.equal(productList.querySelector(".product-price > strong")?.textContent?.trim(), "$7.98");
    assert.equal(productList.querySelector(".card-actions [data-product-detail]")?.textContent?.trim(), "Details");
    (productList.querySelector(".card-actions [data-product-detail]") as HTMLButtonElement).click();
    const affiliateDialog = browser.document.querySelector("#productDialog") as HTMLDialogElement;
    assert.equal(affiliateDialog.hasAttribute("open"), true);
    const outboundLink = affiliateDialog.querySelector("a.canonical") as HTMLAnchorElement;
    const outbound = new URL(outboundLink.href);
    assert.equal(outbound.origin, "https://howl.link");
    assert.equal(outbound.pathname, "/link");
    assert.equal(outbound.searchParams.get("url"), product.canonicalUrl);
    assert.equal(outbound.searchParams.get("publisher_slug"), "collectwithdodo");
    assert.equal(outbound.searchParams.get("article_name"), product.title);
    assert.equal(outbound.searchParams.get("article_url"), "http://127.0.0.1:32991/");
    assert.match(outboundLink.rel, /\bsponsored\b/);
    (affiliateDialog.querySelector("[data-close-dialog]") as HTMLButtonElement).click();
    (browser.document.querySelector('.tabs [data-tab="setup"]') as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#privacySummary")?.textContent ?? "", /12 records/));
    const timezoneSelect = (browser.document.querySelector("#spendForm") as HTMLFormElement)
      .elements.namedItem("timezone") as HTMLSelectElement;
    assert.equal(timezoneSelect.tagName, "SELECT");
    assert.equal(timezoneSelect.value, browser.Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    assert.ok(timezoneSelect.options.length > 1);
    // Want it replaced Quick add setups: Setup has no setup editor to open.
    assert.equal(browser.document.querySelector("#profileDialog"), null);
    assert.equal(browser.document.querySelector("[data-profile-edit], #newProfileButton"), null);
    (browser.document.querySelector('.tabs [data-tab="find"]') as HTMLButtonElement).click();
    assert.equal((browser.document.querySelector("#privacyExportLink") as HTMLAnchorElement).pathname, "/api/v1/user/privacy/export");
    assert.equal(posts.length, 0);
    (browser.document.querySelector("[data-product-detail]") as HTMLButtonElement).click();
    const productDialog = browser.document.querySelector("#productDialog") as HTMLDialogElement;
    assert.equal(productDialog.hasAttribute("open"), true);
    assert.equal(posts.length, 0);
    // The full setup form stays one step away: Want it › More options.
    (browser.document.querySelector("#productDialogBody [data-want-listing]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(productDialog.hasAttribute("open"), false));
    const wantDialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.ok(wantDialog.querySelector("#wantMore")));
    assert.equal(posts.length, 0);
    (wantDialog.querySelector("#wantMore") as HTMLButtonElement).click();
    await eventually(() => assert.equal(wantDialog.hasAttribute("open"), false));
    const dialog = browser.document.querySelector("#setupDialog") as HTMLDialogElement;
    assert.equal(dialog.hasAttribute("open"), true);
    assert.equal(posts.length, 0);
    await eventually(() => assert.equal(preflights.length, 1));
    assert.equal(((browser.document.querySelector("#setupForm") as HTMLFormElement).elements.namedItem("reviewed") as HTMLInputElement).disabled, false);
    assert.match(browser.document.querySelector("#setupPreflight")?.textContent ?? "", /Ready for your review/);
    assert.match(browser.document.querySelector("#setupPreflight")?.textContent ?? "", /No plan was saved/);
    assert.match(browser.document.querySelector("#setupProductSummary")?.textContent ?? "", /95280900/);
    assert.match(browser.document.querySelector("#setupProductSummary")?.textContent ?? "", /\$7\.98/);
    assert.match(browser.document.querySelector("#setupReviewRows")?.textContent ?? "", /Notify only/);
    assert.doesNotMatch(browser.document.querySelector("#setupReviewRows")?.textContent ?? "", /Notify me/);
    assert.match(browser.document.querySelector("#setupReviewRows")?.textContent ?? "", /DeliveryShipping/);
    assert.deepEqual(
      [...(dialog.querySelector('select[name="fulfillment"]') as HTMLSelectElement).options].map((option) => option.textContent),
      ["Shipping", "Pickup"]
    );
    assert.match(dialog.querySelector("#setupFulfillmentHelp")?.textContent ?? "", /Shipping is the default\. Pickup is opt-in\./);
    assert.match(browser.document.querySelector("#setupPreflight span")?.textContent ?? "", /^Checked$/);
    assert.equal(dialog.querySelectorAll("fieldset.setup-section").length, 2);
    assert.deepEqual([...dialog.querySelectorAll("fieldset.setup-section legend")].map((item) => item.textContent?.replace(/\s+/g, " ").trim()), [
      "1 Item and price",
      "2 When it matches"
    ]);
    assert.equal(dialog.querySelector(".setup-advanced summary")?.textContent?.trim(), "Advanced");
    assert.equal(dialog.querySelector(".review-confirm span")?.textContent?.trim(), "I reviewed these limits");
    assert.equal(dialog.querySelectorAll("#setupReviewRows .review-row").length, 7);
    assert.ok((dialog.querySelector(".setup-layout") as HTMLElement).compareDocumentPosition(
      dialog.querySelector("#setupExecutionNote") as HTMLElement
    ) & browser.Node.DOCUMENT_POSITION_FOLLOWING, "the single action boundary follows the fields and review");
    assert.match(readFileSync(join(webRoot, "user.css"), "utf8"), /\.setup-dialog \{ width: min\(760px,/);

    const form = browser.document.querySelector("#setupForm") as HTMLFormElement;
    const quantity = form.elements.namedItem("targetQuantity") as HTMLInputElement;
    const maxUnit = form.elements.namedItem("maxUnitPrice") as HTMLInputElement;
    const maxAllIn = form.elements.namedItem("maxAllIn") as HTMLInputElement;
    const fulfillment = form.elements.namedItem("fulfillment") as HTMLSelectElement;
    const add = form.querySelector('input[value="add_to_cart"]') as HTMLInputElement;
    const reviewed = form.elements.namedItem("reviewed") as HTMLInputElement;
    assert.equal(fulfillment.value, "shipping");
    assert.deepEqual([...fulfillment.options].map((option) => option.value), ["shipping", "pickup"]);
    assert.equal(browser.document.querySelector("#setupQuantityHelp")?.textContent, "Yoink adds one at a time until you have 1.");
    // The debounce checks below run on a virtual clock instead of real sleeps.
    const clock = installPageClock(browser);
    quantity.value = "2";
    maxUnit.value = "10.00";
    maxAllIn.value = "20.00";
    fulfillment.value = "pickup";
    add.checked = true;
    add.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(browser.document.querySelector("#setupQuantityHelp")?.textContent, "Yoink adds one at a time until you have 2.");
    assert.equal(fulfillment.value, "pickup");
    assert.equal(fulfillment.disabled, false);
    assert.equal(reviewed.disabled, true);
    assert.equal(reviewed.checked, false);
    await clock.advance(300);
    assert.equal(preflights.length, 1, "ordinary edits wait for the 600 ms debounce");
    await clock.advance(350);
    await eventually(() => assert.equal(preflights.length, 2));
    assert.deepEqual(preflights[1], {
      contractVersion: 2,
      listingId: "listing_dashboard_test",
      targetQuantity: 2,
      maxUnitPriceCents: 1000,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "pickup",
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 900,
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    });
    assert.equal(reviewed.disabled, false);

    maxUnit.value = "9.00";
    maxUnit.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(reviewed.disabled, true, "changing a reviewed value immediately invalidates that review");
    await clock.advance(650);
    assert.equal(preflights.length, 2, "money typing never preflights before change or blur");
    maxUnit.dispatchEvent(new browser.Event("blur"));
    await clock.advance(650);
    await eventually(() => assert.equal(preflights.length, 3));
    assert.equal(preflights[2]?.maxUnitPriceCents, 900);
    assert.equal(reviewed.disabled, false);
    maxUnit.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await clock.advance(650);
    assert.equal(preflights.length, 3, "an unchanged field event keeps the successful preflight and review state");
    clock.restore();
    assert.equal(reviewed.disabled, false);
    reviewed.checked = true;
    reviewed.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((browser.document.querySelector("#createPlanButton") as HTMLButtonElement).disabled, false);
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      contractVersion: 2,
      listingId: "listing_dashboard_test",
      targetQuantity: 2,
      maxUnitPriceCents: 900,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "pickup",
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 900,
      preflightFingerprint: "a".repeat(64),
      preflightedAt: "2026-08-25T18:00:00.000Z",
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    });
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Plan created/));

    // The shared card keeps saved choices behind its button, which now reads Yoink.
    await eventually(() => assert.equal(
      browser.document.querySelector('#productList [data-want-listing="listing_dashboard_test"]')?.textContent?.trim(),
      "Yoink"
    ));
    assert.match(browser.document.querySelector("#productList .card-plan-state")?.textContent ?? "", /Alerts for now/);
    browser.eval('setTab("cart")');
    await eventually(() => assert.match(browser.document.querySelector("#planSummary")?.textContent ?? "", /2 items · 1 add to cart · 1 alert only/));
    // Wanted uses the same card, with status, price limit and two primary actions.
    const cartRow = browser.document.querySelector('[data-plan-id="mission_dashboard_test"]') as HTMLElement;
    assert.match(cartRow.querySelector(".card-plan-state")?.textContent ?? "", /Alerts for now · 2 wanted/);
    assert.match(cartRow.querySelector(".product-price")?.textContent ?? "", /Your limit \$10\.00/);
    // Auto-cart is off in this fixture, so a cart item alerts for now.
    assert.equal(cartRow.querySelector(".card-plan-state > span")?.textContent, "Alerts for now · 2 wanted");
    assert.equal(cartRow.querySelector(".card-plan-state > span")?.getAttribute("title"), "Target is not switched on for cart adds yet");
    assert.equal(cartRow.querySelectorAll("button").length, 2, "an active item offers Want it and Details");
    const monitoringRow = browser.document.querySelector('[data-plan-id="mission_dashboard_monitoring_test"]') as HTMLElement;
    assert.equal(monitoringRow.querySelector(".card-plan-state > span")?.textContent, "Alerts · 2 wanted");
    // The view chips ask the server for that subset.
    (browser.document.querySelector('[data-plan-view="notify"]') as HTMLButtonElement)?.click();
    await eventually(() => assert.equal(browser.location.hash, "#cart?view=notify"));
    (browser.document.querySelector('[data-plan-view="all"]') as HTMLButtonElement)?.click();
    await eventually(() => assert.equal(browser.location.hash, "#cart"));
    // A paused item offers Resume beside Edit.
    planSummary.status = "paused";
    planDetail.status = "paused";
    await browser.eval("refresh()");
    await eventually(() => assert.equal(
      browser.document.querySelector('[data-toggle-plan-status="mission_dashboard_test"]')?.textContent, "Resume"));
    assert.equal(browser.document.querySelector('[data-plan-id="mission_dashboard_test"] .card-plan-state > span')?.textContent, "Paused · Adds to cart · 2 wanted");
    (browser.document.querySelector('[data-toggle-plan-status="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(patches.length, 1));
    assert.equal(patches[0]?.status, "active");
    assert.deepEqual(patches[0]?.targets, [{
      id: "mission_target_dashboard_test",
      enabled: true,
      maxUnitPriceCents: 1000,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping"
    }]);
    assert.deepEqual(patches[0]?.policy, {
      expectedRevision: 1,
      changeReason: "Plan resumed from the user dashboard."
    });
    await eventually(() => assert.equal(browser.document.querySelector('[data-toggle-plan-status="mission_dashboard_test"]'), null));
    // Quick add's bulk tools are gone with it.
    assert.equal(browser.document.querySelector("#togglePlanBulk, #planBulkBar, [data-plan-select]"), null);
    (planSummary as Record<string, unknown>).automationReadiness = {
      contractVersion: 1,
      state: "guarded_add_session_blocked",
      configuredAction: "add_to_cart",
      targets: [{ retailerId: "target" }],
      level: "waiting",
      readyForMonitoring: true,
      readyForGuardedAdd: false,
      headline: "Target needs attention in Chrome",
      summary: "The store session is showing a security check.",
      nextAction: "open_chrome",
      nextActionLabel: "Open store in Chrome",
      checks: []
    };
    await browser.eval("refresh()");
    await eventually(() => assert.equal(
      browser.document.querySelector('[data-plan-id="mission_dashboard_test"] .card-plan-state > span')?.getAttribute("title"),
      "Target needs attention in Chrome"
    ));
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    const editDialog = browser.document.querySelector("#planDialog") as HTMLDialogElement;
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    const targetOutbound = new URL((browser.document.querySelector("#targetEditors a.canonical") as HTMLAnchorElement).href);
    assert.equal(targetOutbound.origin, "https://howl.link");
    assert.equal(targetOutbound.searchParams.get("url"), product.canonicalUrl);
    assert.equal(targetOutbound.searchParams.get("publisher_slug"), "collectwithdodo");
    assert.match(browser.document.querySelector("#planExecutionNote")?.textContent ?? "", /Each cart attempt adds one item/);
    const editForm = browser.document.querySelector("#planForm") as HTMLFormElement;
    assert.deepEqual([...((editForm.elements.namedItem("status") as HTMLSelectElement).options)].map((option) => option.value), ["active", "paused"]);
    assert.equal(editForm.elements.namedItem("substitutionPolicy"), null);
    assert.equal((browser.document.querySelector("#prepareGuardedPlanButton") as HTMLButtonElement).textContent?.trim(), "Switch to cart mode");
    assert.match(browser.document.querySelector('[data-target-id="mission_target_dashboard_test"] .target-fixed-seller')?.textContent ?? "", /Seller.*Store only/s);
    assert.equal(browser.document.querySelector('[data-target-id="mission_target_dashboard_test"] [data-field="sellerPolicy"]'), null);
    const targetEditors = browser.document.querySelector("#targetEditors") as HTMLElement;
    const controlsAboveTargets = [...editForm.querySelectorAll("input:not([type=hidden]), select, #prepareGuardedPlanButton")]
      .filter((control) => control.compareDocumentPosition(targetEditors) & browser.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(controlsAboveTargets.length <= 6);
    const legacyFulfillment = browser.document.querySelector('[data-target-id="mission_target_dashboard_test"] [data-field="fulfillment"]') as HTMLSelectElement;
    assert.deepEqual([...legacyFulfillment.options].map((option) => option.value), ["shipping", "pickup"]);
    assert.equal(legacyFulfillment.value, "shipping");
    assert.match(browser.document.querySelector(".legacy-fulfillment-note")?.textContent ?? "", /legacy Manual setting is shown as Shipping/);
    assert.equal(browser.document.querySelector("#planQuantityHelp")?.textContent, "Yoink adds one at a time until you have 2.");
    editForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(patches.length, 2));
    assert.equal((patches[1]?.targets as Array<Record<string, unknown>>)[0]?.fulfillment, "shipping");
    assert.deepEqual((patches[1]?.policy as Record<string, unknown>), {
      expectedRevision: 1,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      decisionMode: "purchase_intent",
      maxSignalAgeSeconds: 120,
      cooldownSeconds: 900,
      expiresAt: "",
      changeReason: "Updated from the user purchase dashboard."
    });
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /plan saved/i));

    planDetail.intentPolicy.decisionMode = "strategy";
    planDetail.intentPolicy.actionCeiling = "add_to_cart";
    planDetail.targets.push({
      id: "mission_target_monitor_only",
      listingId: "listing_monitor_only",
      retailerId: "amazon",
      retailerName: "Amazon",
      retailerSku: "B0MONITOR1",
      canonicalUrl: "https://www.amazon.com/dp/B0MONITOR1",
      executionSupported: false,
      enabled: true,
      maxUnitPriceCents: 1200,
      sellerPolicy: "inherit",
      fulfillment: "inherit",
      legacyFulfillmentMapped: false,
      currency: "USD",
      lastObservedPriceCents: 1200
    });
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    assert.equal((editForm.elements.namedItem("actionCeiling") as HTMLSelectElement).value, "notify");
    assert.match(browser.document.querySelector("#planModeCopy")?.textContent ?? "", /direct notify-only plan/i);
    assert.match(browser.document.querySelector("#planModeTitle")?.textContent ?? "", /uses the default rules/);
    assert.doesNotMatch(editDialog.textContent ?? "", /advanced (?:default|rule)|Direct plan\./i);
    const preparedTarget = browser.document.querySelector('[data-target-id="mission_target_dashboard_test"]') as HTMLElement;
    (preparedTarget.querySelector('[data-field="fulfillment"]') as HTMLSelectElement).value = "pickup";
    (browser.document.querySelector("#prepareGuardedPlanButton") as HTMLButtonElement).click();
    assert.equal((editForm.elements.namedItem("actionCeiling") as HTMLSelectElement).value, "add_to_cart");
    assert.match(preparedTarget.querySelector(".target-fixed-seller")?.textContent ?? "", /Store only/);
    assert.equal((preparedTarget.querySelector('[data-field="fulfillment"]') as HTMLSelectElement).value, "pickup");
    const monitorOnlyTarget = browser.document.querySelector('[data-target-id="mission_target_monitor_only"]') as HTMLElement;
    assert.equal((monitorOnlyTarget.querySelector('[data-field="enabled"]') as HTMLInputElement).checked, false);
    assert.equal((monitorOnlyTarget.querySelector('[data-field="enabled"]') as HTMLInputElement).disabled, true);
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /explicit Pickup choice was retained/);
    editDialog.close();

    planDetail.status = "satisfied";
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    const satisfiedStatus = editForm.elements.namedItem("status") as HTMLSelectElement;
    assert.equal(satisfiedStatus.value, "satisfied");
    assert.equal(satisfiedStatus.disabled, true);
    assert.equal(satisfiedStatus.selectedOptions[0]?.disabled, true);
    editDialog.close();
    planDetail.status = "active";

    assert.equal(editForm.querySelector('option[value="archived"]'), null);
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    (browser.document.querySelector("#deletePlanButton") as HTMLButtonElement).click();
    await eventually(() => assert.equal(deletions.length, 1));
    assert.deepEqual(deletions[0], { confirmation: "DELETE_PURCHASE_PLAN" });
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#planList")?.textContent ?? "", /Find a product and tap Want it/i));
    assert.equal(browser.document.querySelector("#planList [data-tab=find]")?.textContent, "Find products");
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /purchase plan deleted/i);
  } finally {
    browser.close();
  }
});

test("shopper Setup omits maintainer recovery evidence and does not request it", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#settings",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: string[] = [];
  const overview = {
    settings: { actionsPaused: true, executionMode: "shadow", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 0, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string) => {
      requests.push(path);
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => overview };
      if (path === "/api/v1/user/privacy") return { ok: true, status: 200, json: async () => ({ inventory: {
        totalRecords: 1,
        credentialMaterialsExcluded: true,
        categories: []
      } }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });

  try {
    browser.eval(`${script}\n//# sourceURL=user-recovery-review-dashboard-test.js`);
    await eventually(() => assert.notEqual(browser.document.querySelector("#privacySummary")?.textContent, "Checking…"));
    assert.equal(browser.document.querySelector("#recoveryReviewList"), null);
    assert.equal(browser.document.querySelector("[data-recovery-evidence]"), null);
    assert.equal(requests.some((path) => path.includes("community/recovery-evidence")), false);
    // The old #settings link lands on the one Setup page.
    assert.equal(browser.location.hash, "#setup");
    assert.deepEqual(
      [...browser.document.querySelectorAll("[data-setup-section]")].map((item) => item.textContent?.trim()),
      ["Stores", "Chrome", "Alerts", "Limits", "Your data"]
    );
  } finally {
    browser.close();
  }
});

test("ready checkout actions render one direct affiliate-aware cart handoff", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#activity",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const outcomePosts: Array<Record<string, unknown>> = [];
  const confirmationRequests: Array<Record<string, unknown>> = [];
  const fetchCalls: string[] = [];
  let blockOverview = false;
  let overviewBlocked = false;
  let completedOverviewResponses = 0;
  let failNextOverview = false;
  let releaseOverview: () => void = () => undefined;
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 1, purchaseIntents: 1, actions: 1, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 1,
      activeReservedCents: 2499,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const action = {
    id: "job_target_cart_handoff",
    title: "Exact Target Fixture",
    retailerId: "target",
    retailerSku: "95280902",
    canonicalUrl: "https://www.target.com/p/-/A-95280902",
    action: "add_to_cart",
    state: "confirmed",
    stage: "ready_to_checkout",
    statusLabel: "Ready to check out",
    decisionSource: "purchase_intent",
    maxUnitPriceCents: 2499,
    maxOrderTotalCents: 3000,
    currency: "USD",
    spendReservationStatus: "committed",
    latency: {
      observedToReceivedMs: 90,
      receivedToJobMs: 210,
      jobToLeaseMs: 300,
      leaseToBaselineMs: 2500,
      baselineToOfferMs: 4000,
      offerToClickMs: 110,
      clickToSettleMs: 410,
      settleToCartReadyMs: 1220,
      leaseToCartReadyMs: 8240,
      clickToCartReadyMs: 1630,
      secretBrowserEvidence: "must not render"
    }
  };
  type DashboardAction = typeof action & { userReportOutcome?: "got_it" | "missed_it" };
 const missedAction: DashboardAction = {
   ...action,
   id: "job_target_cart_missed",
    title: "Best Buy Fixture",
    retailerId: "bestbuy",
    retailerSku: "6685081",
    canonicalUrl: "https://www.bestbuy.com/site/-/6685081.p",
    state: "manual_review",
    stage: "needs_you",
    statusLabel: "Needs you",
    latency: { ...action.latency }
  };
  const recordedOutcomes = new Map<string, "got_it" | "missed_it">();
  const actionPayload = (items: DashboardAction[] = [action, missedAction]) => {
    const renderedItems = items.map((item) => {
      const outcome = recordedOutcomes.get(item.id);
      return outcome ? {
        ...item,
        stage: "closed",
        state: "confirmed",
        statusLabel: outcome === "got_it" ? "Got it" : "Missed it",
        userReportOutcome: outcome
      } : item;
    });
    const stageCounts = renderedItems.reduce<Record<string, number>>((counts, item) => {
      const stage = String(item.stage || "closed");
      counts[stage] = Number(counts[stage] || 0) + 1;
      return counts;
    }, {});
    return ({
    items: renderedItems,
    insights: {
      stages: stageCounts,
      latency: {
        hops: {
          leaseToCartReadyMs: { samples: 2, p50Ms: 6000, p95Ms: 8240 },
          leaseToBaselineMs: { samples: 2, p50Ms: 1800, p95Ms: 2500 },
          baselineToOfferMs: { samples: 2, p50Ms: 3000, p95Ms: 4000 },
          offerToClickMs: { samples: 2, p50Ms: 90, p95Ms: 110 },
          clickToSettleMs: { samples: 2, p50Ms: 350, p95Ms: 410 },
          settleToCartReadyMs: { samples: 2, p50Ms: 900, p95Ms: 1220 },
          secretBrowserEvidence: { samples: 2, p50Ms: 999999, p95Ms: 999999 }
        }
      }
    },
    glossary: {
      ready_to_checkout: { label: "Ready to check out", summary: "The exact item is in the store cart." },
      needs_you: { label: "Needs you", summary: "Review the store cart or session." }
    }
  });
  };
  type ActionPayload = ReturnType<typeof actionPayload>;
  const queuedJobPayloads: Array<Promise<ActionPayload>> = [];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      fetchCalls.push(path);
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/overview") {
        if (failNextOverview) {
          failNextOverview = false;
          return {
            ok: false,
            status: 503,
            json: async () => ({ message: "Activity refresh fixture failed." })
          };
        }
        if (blockOverview) {
          await new Promise<void>((resolve) => {
            overviewBlocked = true;
            releaseOverview = resolve;
          });
        }
        completedOverviewResponses += 1;
        return { ok: true, status: 200, json: async () => overview };
      }
      if (path === "/api/v1/user/jobs?limit=100&offset=0") {
        const queuedPayload = queuedJobPayloads.shift();
        return { ok: true, status: 200, json: async () => queuedPayload || actionPayload() };
      }
      const outcomeMatch = path.match(/^\/api\/v1\/user\/jobs\/([^/]+)\/outcome$/);
      if (outcomeMatch && options.method === "POST") {
        const body = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        outcomePosts.push(body);
        recordedOutcomes.set(
          decodeURIComponent(outcomeMatch[1]!),
          body.outcome as "got_it" | "missed_it"
        );
        return { ok: true, status: 200, json: async () => ({ outcome: body.outcome }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "confirm", {
    configurable: true,
    value: () => { throw new Error("The explicit cart outcome must not open a second confirmation dialog."); }
  });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: {
      confirmDialog: async (options: Record<string, unknown>) => {
        confirmationRequests.push(options);
        return { confirmed: true, note: "" };
      }
    }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new browser.Event("close"));
    }
  });

  try {
    browser.eval(`${script}\n//# sourceURL=user-cart-handoff-dashboard-test.js`);
    await eventually(() => assert.ok(browser.document.querySelector("#actionList .cart-handoff-link")));
    await eventually(() => assert.equal(completedOverviewResponses, 1));

    fetchCalls.length = 0;
    action.title = "Resume-priority Target Fixture";
    blockOverview = true;
    browser.document.dispatchEvent(new browser.Event("visibilitychange"));
    const jobsIndex = fetchCalls.indexOf("/api/v1/user/jobs?limit=100&offset=0");
    const overviewIndex = fetchCalls.indexOf("/api/v1/user/overview");
    assert.ok(jobsIndex >= 0, "Activity resume must request the urgent action state.");
    assert.ok(overviewIndex > jobsIndex, "Activity state must start loading before the broader overview.");
    await eventually(() => assert.match(
      browser.document.querySelector("#actionList")?.textContent ?? "",
      /Resume-priority Target Fixture/
    ));
    assert.equal(overviewBlocked, true, "The action list should render while the overview is still blocked.");
    assert.equal(fetchCalls.filter((path) => path === "/api/v1/user/jobs?limit=100&offset=0").length, 1,
      "The prioritized Activity response must be reused instead of issuing a duplicate jobs request.");
    releaseOverview();
    blockOverview = false;
    await eventually(() => assert.equal(completedOverviewResponses, 2));

    let resolveOlder!: (payload: ActionPayload) => void;
    let resolveNewer!: (payload: ActionPayload) => void;
    queuedJobPayloads.push(
      new Promise<ActionPayload>((resolve) => { resolveOlder = resolve; }),
      new Promise<ActionPayload>((resolve) => { resolveNewer = resolve; })
    );
    const reverseCompletion = browser.eval(
      "Promise.all([refreshActionActivity(), refreshActionActivity()])"
    ) as Promise<unknown>;
    resolveNewer(actionPayload([{ ...action, title: "Newest Activity state" }]));
    await eventually(() => assert.match(
      browser.document.querySelector("#actionList")?.textContent ?? "",
      /Newest Activity state/
    ));
    resolveOlder(actionPayload([{ ...action, title: "Older Activity state" }]));
    await reverseCompletion;
    assert.match(browser.document.querySelector("#actionList")?.textContent ?? "", /Newest Activity state/);
    assert.doesNotMatch(browser.document.querySelector("#actionList")?.textContent ?? "", /Older Activity state/);
    action.title = "Exact Target Fixture";
    await browser.eval("refreshActionActivity()");
   await eventually(() => assert.equal(browser.document.querySelectorAll("#actionList [data-action-job]").length, 2));
    assert.match(browser.document.querySelector("#actionList")?.textContent ?? "", /Best Buy/);
    assert.doesNotMatch(browser.document.querySelector("#actionList")?.textContent ?? "", /bestbuy/);
    const allStageFilter = browser.document.querySelector('[data-action-stage-filter="all"]') as HTMLButtonElement;
    const readyStageFilter = browser.document.querySelector('[data-action-stage-filter="ready_to_checkout"]') as HTMLButtonElement;
    const needsStageFilter = browser.document.querySelector('[data-action-stage-filter="needs_you"]') as HTMLButtonElement;
    assert.equal(allStageFilter.textContent, "All · 2");
    assert.equal(readyStageFilter.textContent, "Ready to check out · 1");
    assert.equal(needsStageFilter.textContent, "Needs you · 1");
    assert.equal(readyStageFilter.title, "The exact item is in the store cart.");
    assert.equal(needsStageFilter.title, "Review the store cart or session.");
    needsStageFilter.click();
    assert.equal(browser.document.querySelector('[data-action-stage-filter="needs_you"]')?.getAttribute("aria-pressed"), "true");
    assert.equal(browser.document.querySelectorAll("#actionList [data-action-job]").length, 1);
    assert.match(browser.document.querySelector("#actionList")?.textContent ?? "", /Best Buy Fixture/);
    assert.doesNotMatch(browser.document.querySelector("#actionList")?.textContent ?? "", /Exact Target Fixture/);
    (browser.document.querySelector('[data-action-stage-filter="all"]') as HTMLButtonElement).click();
    assert.equal(browser.document.querySelectorAll("#actionList [data-action-job]").length, 2);
    const glossaryLink = browser.document.querySelector("#actionStatusGlossaryLink") as HTMLAnchorElement;
    assert.equal(new URL(glossaryLink.href).pathname + new URL(glossaryLink.href).hash, "/docs#statuses");

    const cartLink = browser.document.querySelector("#actionList .cart-handoff-link") as HTMLAnchorElement;
    const cartRoute = new URL(cartLink.href);
    assert.equal(cartLink.textContent?.trim(), "Open cart ↗");
    assert.equal(cartRoute.origin, "https://howl.link");
    assert.equal(cartRoute.searchParams.get("url"), "https://www.target.com/cart");
    assert.equal(cartRoute.searchParams.get("publisher_slug"), "collectwithdodo");
    assert.match(cartRoute.searchParams.get("article_name") || "", /cart handoff/);
    assert.match(cartLink.rel, /sponsored/);
    assert.match(browser.document.querySelector("#actionHandoff")?.textContent ?? "", /1 cart is ready/);
    assert.equal(browser.document.querySelector("#actionLatencySummary"), null);
    assert.equal(browser.document.querySelectorAll("#actionList .latency-breadcrumb").length, 0);
    assert.doesNotMatch(browser.document.querySelector("#actionList")?.textContent ?? "", /p50|p95|\bms\b/);
    assert.doesNotMatch(browser.document.querySelector("#actionList")?.textContent ?? "", /must not render/);
    assert.equal(browser.document.querySelectorAll("#actionList .cart-outcome").length, 0,
      "Exact spend entry must not be repeated inside every action card.");
    assert.equal(browser.document.querySelectorAll("#actionList .cart-closeout").length, 2);
    const firstCloseout = browser.document.querySelector("#actionList .cart-closeout") as HTMLElement;
    const firstCloseoutButtons = [...firstCloseout.querySelectorAll("button")];
    assert.equal(firstCloseoutButtons.length, 2);
    assert.ok(firstCloseoutButtons.every((button) => button.classList.contains("secondary")),
      "Got it and Missed it must have equal visual weight.");

    const gotIt = browser.document.querySelector(
      '[data-cart-got-it="job_target_cart_handoff"]'
    ) as HTMLButtonElement;
    const gotItCard = gotIt.closest("[data-action-job]") as HTMLElement;
    assert.ok(gotItCard.querySelector(".cart-handoff-link"), "Retailer navigation must remain the dominant card action.");
    gotIt.click();
    const outcomeDialog = browser.document.querySelector("#cartOutcomeDialog") as HTMLDialogElement;
    const outcomeForm = browser.document.querySelector("#cartOutcomeForm") as HTMLFormElement;
    const amountInput = outcomeForm.querySelector('[name="actualTotal"]') as HTMLInputElement;
    await eventually(() => assert.equal(outcomeDialog.hasAttribute("open"), true));
    await eventually(() => assert.equal(browser.document.activeElement, amountInput));
    assert.match(browser.document.querySelector("#cartOutcomeSummary")?.textContent ?? "", /Exact Target Fixture.*95280902/);
    assert.match(browser.document.querySelector("#cartOutcomeLimit")?.textContent ?? "", /\$30\.00/);
    assert.equal(amountInput.value, "30.00", "the reviewed maximum is editable but prefilled");
    assert.equal(amountInput.hasAttribute("max"), false);
    assert.equal(confirmationRequests.length, 0, "Got it opens the amount form directly");

    (outcomeForm.querySelector(".dialog-actions [data-close-dialog]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(outcomeDialog.hasAttribute("open"), false));
    await eventually(() => assert.equal(browser.document.activeElement, gotIt));
    gotIt.click();
    await eventually(() => assert.equal(browser.document.activeElement, amountInput));
    assert.equal(amountInput.value, "30.00");

    const submitOutcome = () => outcomeForm.dispatchEvent(new browser.Event("submit", {
      bubbles: true,
      cancelable: true
    }));
    amountInput.value = "35.00";
    amountInput.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.match(browser.document.querySelector("#cartOutcomeLimit")?.textContent ?? "", /Above your reviewed maximum by \$5\.00.*actual spend/);
    submitOutcome();
    await eventually(() => assert.equal(outcomePosts.length, 1));
    assert.deepEqual(outcomePosts[0], {
      outcome: "got_it",
      actualTotalCents: 3500,
      confirmation: "I_REVIEWED_CHECKOUT_RESULT"
    });
    await eventually(() => assert.equal(outcomeDialog.hasAttribute("open"), false));
    await eventually(() => assert.equal(
      browser.document.querySelector('[data-action-job="job_target_cart_handoff"] .cart-closeout'),
      null
    ));
    await eventually(() => assert.match(
      browser.document.querySelector("#toast")?.textContent ?? "",
      /Purchase recorded/
    ));

    failNextOverview = true;
    (browser.document.querySelector(
      '[data-cart-missed-it="job_target_cart_missed"]'
    ) as HTMLButtonElement).click();
    await eventually(() => assert.equal(confirmationRequests.length, 1));
    assert.deepEqual(JSON.parse(JSON.stringify(confirmationRequests[0])), {
      title: "Mark this cart as missed?",
      summary: "This closes the action without recording a purchase or spend.",
      scope: ["Best Buy Fixture · Best Buy · 6685081"],
      confirmLabel: "Mark missed"
    });
    await eventually(() => assert.equal(outcomePosts.length, 2));
    assert.deepEqual(outcomePosts[1], {
      outcome: "missed_it",
      actualTotalCents: null,
      confirmation: "I_REVIEWED_CHECKOUT_RESULT"
    });
    await eventually(() => assert.match(
      browser.document.querySelector("#toast")?.textContent ?? "",
      /result was recorded, but Activity could not refresh yet/
    ));
    const missedCard = browser.document.querySelector(
      '[data-action-job="job_target_cart_missed"]'
    ) as HTMLElement;
    assert.match(missedCard.querySelector("[data-outcome-status]")?.textContent ?? "", /Result recorded/);
    assert.equal((missedCard.querySelector("[data-cart-missed-it]") as HTMLButtonElement).disabled, true,
      "A confirmed mutation must not be offered again merely because the refresh failed.");
  } finally {
    releaseOverview();
    browser.close();
  }
});

function wantFixtureBrowser(options: { purchaseIntent?: Record<string, unknown> | null; msrpNeeded?: boolean; testCallItems?: Array<Record<string, unknown>>; msrpFillItems?: Array<Record<string, unknown>>; priceHistory?: Record<string, unknown>; wantedAfterSave?: boolean } = {}) {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#products",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const listing = (retailerId: string, retailerName: string, sku: string, cents: number) => ({
    listingId: `listing_want_${retailerId}`, retailerId, retailerName, retailerSku: sku,
    canonicalUrl: retailerId === "target" ? `https://www.target.com/p/-/A-${sku}` : `https://www.walmart.com/ip/${sku}`,
    status: "in_stock", executionSupported: retailerId === "target", msrpCents: 2499, currency: "USD",
    currentPriceCents: cents, priceObservedAt: "2026-09-30T17:30:00.000Z", updatedAt: "2026-09-30T17:30:00.000Z"
  });
  const group = {
    variantId: "variant_want", familyId: "family_want", title: "Want It Fixture", brand: "", imageUrl: "",
    variantAttributes: {}, createdAt: "2026-09-30T17:00:00.000Z", storeCount: 2, listingCount: 2,
    availableListingCount: 2, bestPriceCents: 2399, currency: "USD", lastActivityAt: "2026-09-30T17:30:00.000Z",
    listings: [listing("target", "Target", "95000777", 2599), listing("walmart", "Walmart", "777000", 2399)],
    purchaseIntent: options.purchaseIntent ?? null
  };
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const confirmations: Array<Record<string, unknown>> = [];
  let previewCount = 0;
  const preview = (requested: Record<string, unknown>) => {
    previewCount += 1;
    const mode = requested.mode === "notify" ? "notify" : "add_to_cart";
    const max = Number(requested.maxUnitPriceCents ?? (options.purchaseIntent ? options.purchaseIntent.maxUnitPriceCents : 2499));
    const plan = options.purchaseIntent
      ? { id: String(options.purchaseIntent.id), status: "active", origin: "user_want", revision: 3, mode: String(options.purchaseIntent.actionCeiling), maxUnitPriceCents: max, targetQuantity: 1 }
      : null;
    return {
      contractVersion: 1, noPlanSaved: true, listingId: requested.listingId, variantId: group.variantId, title: group.title,
      imageUrl: "", msrpCents: 2499, requestedMode: mode, mode,
      summary: mode === "add_to_cart"
        ? `When Target has it in stock for $${(max / 100).toFixed(2)} or less, Yoink adds it to your cart. You check out yourself. Walmart isn't on for cart adds, so it isn't watched; choose Alert me to watch every store.`
        : `Yoink alerts you when Target or Walmart has it in stock for $${(max / 100).toFixed(2)} or less.`,
      targetQuantity: Number(requested.targetQuantity ?? 1), maxUnitPriceCents: max, maxAllInCents: max + 300,
      stores: [
        { listingId: "listing_want_target", retailerId: "target", retailerName: "Target", retailerSku: "95000777", priceCents: 2599, availability: "in_stock", cartReady: true, watch: mode === "notify" ? "alert" : "add_to_cart", note: mode === "notify" ? "Alerts you" : "Adds to cart" },
        { listingId: "listing_want_walmart", retailerId: "walmart", retailerName: "Walmart", retailerSku: "777000", priceCents: 2399, availability: "in_stock", cartReady: false, watch: mode === "notify" ? "alert" : "off", note: mode === "notify" ? "Alerts you" : "Off: Walmart isn't on for cart adds" }
      ],
      spendingLimit: { allowed: true, reasonCode: "within_spending_limits", message: "" }, plan, canSave: true,
      previewFingerprint: String(previewCount).repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, "a"),
      previewedAt: `2026-09-30T18:00:0${previewCount % 10}.000Z`, validForSeconds: 300,
      ...(options.msrpNeeded ? msrpPreview(requested, mode, max) : {})
    };
  };
  // Target needs an MSRP before it adds to cart; the shopper confirms TrackaLacker's $24.99 or corrects it.
  // "Any price up to my max" sets the MSRP aside: the max is Target's price limit.
  const msrpPreview = (requested: Record<string, unknown>, mode: string, max: number) => {
    const anyPrice = requested.priceRule === "max_price";
    const confirmed = typeof requested.confirmedMsrpCents === "number" ? requested.confirmedMsrpCents : null;
    const cart = mode === "add_to_cart" && (anyPrice || confirmed !== null);
    return {
      priceRule: anyPrice ? "max_price" : "msrp",
      msrpConfirmation: { needed: mode === "add_to_cart" && !anyPrice && confirmed === null, suggestedCents: 2499, confirmedCents: anyPrice ? null : confirmed },
      canSave: mode === "notify" || (cart && (anyPrice || max <= Number(confirmed))),
      stores: [
        { listingId: "listing_want_target", retailerId: "target", retailerName: "Target", retailerSku: "95000777", priceCents: 2599, availability: "in_stock", cartReady: true,
          watch: mode === "notify" ? "alert" : cart ? "add_to_cart" : "off",
          note: mode === "notify" ? "Alerts you" : cart ? "Adds to cart" : "Off: confirm the MSRP to add to cart here",
          ...(cart ? { officialMsrp: { id: "", cents: anyPrice ? max : confirmed, sourceUrl: "", desiredVariant: "Want It Fixture", expiresAt: "", confirmedByYou: true, ...(anyPrice ? { maxPriceOnly: true } : {}) } } : {}) },
        { listingId: "listing_want_walmart", retailerId: "walmart", retailerName: "Walmart", retailerSku: "777000", priceCents: 2399, availability: "in_stock", cartReady: false, watch: mode === "notify" ? "alert" : "off", note: mode === "notify" ? "Alerts you" : "Off: Walmart isn't on for cart adds" }
      ]
    };
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      requests.push({ path, method, body });
      if (path === "/api/v1/affiliate-routing") return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      if (path === "/api/v1/user/purchase-intents/want/preview") return { ok: true, status: 200, json: async () => ({ preview: preview(body) }) };
      if (path === "/api/v1/user/settings/restock-retry") return { ok: true, status: 200, json: async () => ({ settings: { restockRetry: body } }) };
      if (path.startsWith("/api/v1/user/purchase-intents/want/price-history?")) {
        return { ok: true, status: 200, json: async () => ({ history: options.priceHistory ?? { variantId: group.variantId, title: group.title, msrpCents: null, sinceAt: "", stores: [] } }) };
      }
      if (path === "/api/v1/user/purchase-intents/msrp-fill") {
        return method === "POST"
          ? { ok: true, status: 200, json: async () => ({ updated: (body.planIds as string[]).map((planId) => ({ planId, title: "Filled", msrpCents: 759 })), skipped: [] }) }
          : { ok: true, status: 200, json: async () => ({ contractVersion: 1, items: options.msrpFillItems ?? [] }) };
      }
      if (path.startsWith("/api/v1/user/test-calls/candidates")) return { ok: true, status: 200, json: async () => ({ items: options.testCallItems ?? [] }) };
      if (path === "/api/v1/user/test-calls/link") return { ok: true, status: 202, json: async () => ({ decision: "qualified", reason: "", actionJobId: "action_job_link", actionJobState: "awaiting_executor" }) };
      if (path === "/api/v1/user/test-calls") return { ok: true, status: 202, json: async () => ({ decision: "qualified", reason: "", actionJobId: "action_job_test", actionJobState: "awaiting_executor" }) };
      if (path === "/api/v1/user/purchase-intents/want") {
        if (options.wantedAfterSave) {
          (group as Record<string, unknown>).purchaseIntent = { id: "mission_want_fixture", variantId: group.variantId, status: "active", origin: "user_want", actionCeiling: "add_to_cart", maxUnitPriceCents: 2499 };
        }
        return { ok: true, status: 201, json: async () => ({ created: true, purchaseIntent: { id: "mission_want_fixture" } }) };
      }
      if (/^\/api\/v1\/user\/purchase-intents\/mission_[a-z_]+$/.test(path) && method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ deletion: { deleted: true } }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => ({
        settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
        counts: { products: 1, purchaseIntents: options.purchaseIntent ? 1 : 0, actions: 0, pendingCatalogProposals: 0 },
        sources: [], permissions: [],
        spend: { activeReservationCount: 0, activeReservedCents: 0, spentTodayCents: 0, policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null } },
        walmartDraws: { latestScan: null, items: [] }
      }) };
      if (path.startsWith("/api/v1/user/library")) return { ok: true, status: 200, json: async () => ({ items: [group], total: 1 }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async (options: Record<string, unknown>) => { confirmations.push(options); return { confirmed: true, note: "" }; } }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new browser.Event("close")); }
  });
  browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=user-dashboard-want-test.js`);
  return { browser, requests, confirmations, group };
}

test("Want it covers every store in one tap, re-checks as the max changes, and saves exactly what it showed", async () => {
  const { browser, requests } = wantFixtureBrowser();
  try {
    await eventually(() => assert.equal(browser.document.querySelector("#productList [data-want-listing]")?.textContent?.trim(), "Want it"));
    assert.equal(browser.document.querySelector("#productList [data-product-detail][data-choose-store]"), null,
      "a product sold at two stores no longer asks which store to use");
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    assert.equal(dialog.hasAttribute("open"), true);
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement | null)?.disabled, false));
    const previews = () => requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want/preview");
    assert.deepEqual(previews()[0]?.body, {
      contractVersion: 1, listingId: "listing_want_walmart", mode: "add_to_cart", confirmation: "PREVIEW_PRODUCT_WANT"
    }, "the first check lets the server choose the starting max; any listing of the product anchors it");
    assert.equal(browser.document.querySelector("#wantDialogTitle")?.textContent, "Want It Fixture");
    assert.equal((dialog.querySelector('input[name="wantMax"]') as HTMLInputElement).value, "24.99");
    assert.deepEqual([...dialog.querySelectorAll(".want-store")].map((row) => [
      row.querySelector("strong")?.firstChild?.textContent,
      row.querySelector("strong small")?.textContent, row.querySelector(".tag")?.textContent
    ]), [["Target", "Item 95000777", "Adds to cart"], ["Walmart", "Item 777000", "Off"]]);
    assert.match(dialog.querySelector("#wantSummary")?.textContent ?? "", /Walmart isn't on for cart adds/);
    assert.equal(dialog.querySelector("#wantSave")?.textContent?.trim(), "Want it");
    assert.equal(dialog.querySelector("#wantStop"), null, "nothing to stop before the item is wanted");

    const clock = installPageClock(browser);
    const max = dialog.querySelector('input[name="wantMax"]') as HTMLInputElement;
    max.value = "19.99";
    max.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement).disabled, true, "saving waits for the new check");
    await clock.advance(200);
    assert.equal(previews().length, 1, "typing waits for the debounce");
    await clock.advance(300);
    await eventually(() => assert.equal(previews().length, 2));
    assert.deepEqual(previews()[1]?.body, {
      contractVersion: 1, listingId: "listing_want_walmart", mode: "add_to_cart",
      maxUnitPriceCents: 1999, priceRule: "msrp", targetQuantity: 1, confirmation: "PREVIEW_PRODUCT_WANT"
    });
    max.value = "19.999";
    max.dispatchEvent(new browser.Event("input", { bubbles: true }));
    await eventually(() => assert.match(dialog.querySelector("#wantSummary")?.textContent ?? "", /at most two decimal places/));
    assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement).disabled, true);
    max.value = "19.99";
    max.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement).disabled, false));
    const alertMe = dialog.querySelector('input[name="wantMode"][value="notify"]') as HTMLInputElement;
    alertMe.checked = true;
    alertMe.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await clock.advance(0);
    await eventually(() => assert.equal(previews().at(-1)?.body.mode, "notify"));
    await eventually(() => assert.deepEqual([...dialog.querySelectorAll(".want-store .tag")].map((tag) => tag.textContent), ["Alerts you", "Alerts you"]));
    clock.restore();
    const lastPreviewRequest = previews().at(-1)!;
    (dialog.querySelector("#wantSave") as HTMLButtonElement).click();
    await eventually(() => assert.equal(requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want").length, 1));
    const save = requests.find((request) => request.path === "/api/v1/user/purchase-intents/want")!;
    assert.equal(save.body.confirmation, "SAVE_PRODUCT_WANT");
    assert.equal(save.body.mode, "notify");
    assert.equal(save.body.maxUnitPriceCents, 1999);
    assert.equal(save.body.listingId, lastPreviewRequest.body.listingId);
    assert.match(String(save.body.previewFingerprint), /^[a-f0-9]{64}$/);
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "",
      /Want It Fixture: Yoink alerts you when Target or Walmart has it for up to \$19\.99\..*Undo/s));
    (browser.document.querySelector("#toast .toast-action") as HTMLButtonElement).click();
    await eventually(() => assert.ok(requests.some((request) => request.method === "DELETE" && request.path === "/api/v1/user/purchase-intents/mission_want_fixture")));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /off your Want list/));
  } finally {
    browser.close();
  }
});

test("Add to cart asks for the MSRP, starts from TrackaLacker's, keeps the max at or below it, and saves the confirmed MSRP", async () => {
  // Kevin, 2026-10-08: the shopper confirms the MSRP in Want it instead of a manufacturer page.
  const { browser, requests } = wantFixtureBrowser({ msrpNeeded: true });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    const previews = () => requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want/preview");
    await eventually(() => assert.ok(dialog.querySelector('input[name="wantMsrp"]')));
    const msrp = dialog.querySelector('input[name="wantMsrp"]') as HTMLInputElement;
    assert.equal(msrp.value, "24.99", "TrackaLacker's MSRP is filled in");
    assert.match(dialog.querySelector("#wantMsrpHelp")?.textContent ?? "", /^From TrackaLacker\. Check it's the regular price/);
    // The filled-in MSRP is checked right away, so Want it can be pressed.
    await eventually(() => assert.equal(previews().at(-1)?.body.confirmedMsrpCents, 2499));
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement).disabled, false));
    assert.match(dialog.querySelector(".want-store")?.textContent ?? "", /MSRP \$24\.99, confirmed by you/);

    const clock = installPageClock(browser);
    msrp.value = "21.99";
    msrp.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((dialog.querySelector('input[name="wantMax"]') as HTMLInputElement).value, "21.99", "a lower MSRP pulls the max down");
    await clock.advance(500);
    await eventually(() => assert.equal(previews().at(-1)?.body.confirmedMsrpCents, 2199));
    assert.equal(previews().at(-1)?.body.maxUnitPriceCents, 2199);
    clock.restore();
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement).disabled, false));
    (dialog.querySelector("#wantSave") as HTMLButtonElement).click();
    await eventually(() => assert.equal(requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want").length, 1));
    const save = requests.find((request) => request.path === "/api/v1/user/purchase-intents/want")!;
    assert.equal(save.body.confirmedMsrpCents, 2199);
    assert.equal(save.body.maxUnitPriceCents, 2199);
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "",
      /Want It Fixture: Yoink adds it to your cart at Target for up to \$21\.99\./));
  } finally {
    browser.close();
  }
});

test("Want it turns the button into Yoink, which draws its mark once", async () => {
  // Kevin, 2026-10-09: "the 'want it' buttons turn into 'Yoink' buttons" with a check mark drawn, then a stem forming a Y.
  const { browser } = wantFixtureBrowser({ wantedAfterSave: true });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    const button = () => browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement;
    assert.equal(button().textContent?.trim(), "Want it");
    assert.equal(button().querySelector("svg"), null);
    button().click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement | null)?.disabled, false));
    (dialog.querySelector("#wantSave") as HTMLButtonElement).click();
    await eventually(() => assert.equal(button().textContent?.trim(), "Yoink"));
    assert.equal(button().getAttribute("aria-label"), "Yoink: Want It Fixture — edit saved choices");
    assert.equal(button().classList.contains("yoink-draw"), true, "the new Yoink button draws its mark");
    const paths = [...button().querySelectorAll("svg.yoink-mark path")];
    assert.deepEqual(paths.map((path) => path.getAttribute("class")), ["yoink-mark-check", "yoink-mark-stem"], "the check, then the stem");
    assert.ok(paths.every((path) => path.getAttribute("pathLength") === "1"));
    paths[1]!.dispatchEvent(new browser.Event("animationend", { bubbles: true }));
    assert.equal(button().classList.contains("yoink-draw"), false, "drawn once");
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Want It Fixture/));
  } finally {
    browser.close();
  }
});

test("Setup › Stores › Retry when sold out shows what it will do and saves tries and minutes", async () => {
  // Kevin, 2026-10-09: "add a config to auto retry the sku X amount of times over Y amount of timeframe".
  const { browser, requests } = wantFixtureBrowser();
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector('.tabs [data-tab="setup"]') as HTMLButtonElement).click();
    const form = browser.document.querySelector("#restockRetryForm") as HTMLFormElement;
    await eventually(() => assert.match(browser.document.querySelector("#restockRetrySummary")?.textContent ?? "", /^Off: a sold-out item waits for the next call\.$/));
    const elements = form.elements as unknown as Record<string, HTMLInputElement>;
    assert.equal(elements.enabled!.checked, false);
    assert.equal((form.querySelector(".restock-retry-fields") as HTMLElement).hidden, true);
    elements.enabled!.checked = true;
    elements.attempts!.value = "4";
    elements.windowMinutes!.value = "12";
    form.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((form.querySelector(".restock-retry-fields") as HTMLElement).hidden, false);
    assert.equal(browser.document.querySelector("#restockRetrySummary")?.textContent,
      "Up to 4 more tries, about every 3 min, within 12 minutes of the first. Each try checks the price, seller and stock again before adding, and never adds a second one.");
    elements.attempts!.value = "11";
    form.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(browser.document.querySelector("#restockRetrySummary")?.textContent, "Tries are 1 to 10, over 1 to 60 minutes.");
    elements.attempts!.value = "4";
    form.dispatchEvent(new browser.Event("input", { bubbles: true }));
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.ok(requests.some((request) => request.path === "/api/v1/user/settings/restock-retry")));
    const save = requests.find((request) => request.path === "/api/v1/user/settings/restock-retry")!;
    assert.equal(save.method, "PATCH");
    assert.deepEqual(save.body, { enabled: true, attempts: 4, windowMinutes: 12 });
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Retry when sold out is on\./));
  } finally {
    browser.close();
  }
});

test("Find shows each product's cheapest store, hides stores Yoink can't act on, and remembers In stock only", async () => {
  // Kevin, 2026-10-09: "pricing > availability", no "unsupported", and a toggle to shop only in-stock items.
  const { browser, requests } = wantFixtureBrowser();
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    const offer = (retailerId: string, status: string, cents: number) => ({ listingId: `l_${retailerId}`, retailerId,
      retailerName: retailerId === "target" ? "Target" : "Walmart", offerRole: "primary", status, currentPriceCents: cents });
    const group = { variantId: "v_price", title: "Price First", listings: [offer("target", "in_stock", 4999), offer("walmart", "out_of_stock", 3999)],
      storeCount: 2, otherStoreCount: 3 };
    const best = () => String(browser.eval(`bestListing(${JSON.stringify(group)}).retailerId`));
    assert.equal(best(), "walmart", "the cheapest store, even sold out");
    const card = String(browser.eval(`productCardMarkup(${JSON.stringify(group)}, new Map())`));
    assert.match(card, /Walmart \+ 1 more/);
    assert.doesNotMatch(card, /unsupported/i, "stores Yoink can't act on stay hidden");
    assert.doesNotMatch(browser.document.querySelector("#findChips")?.textContent ?? "", /In stock now/, "the switch replaces the chip");

    const toggle = browser.document.querySelector("#inStockOnly") as HTMLInputElement;
    assert.equal(toggle.checked, false);
    toggle.checked = true;
    toggle.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.ok(requests.some((request) => request.path.startsWith("/api/v1/user/library/products?") && request.path.includes("availability=in_stock"))));
    assert.equal(browser.localStorage.getItem("yoinkFindInStockOnly"), "1", "remembered on this browser");
    assert.equal((browser.document.querySelector("#browseAvailability") as HTMLSelectElement).value, "in_stock", "in step with More filters");
    assert.equal(best(), "target", "In stock only: the store that has it");
    const before = requests.length;
    toggle.checked = false;
    toggle.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.ok(requests.slice(before).some((request) => request.path.startsWith("/api/v1/user/library/products?")
      && !request.path.includes("availability="))));
    assert.equal(browser.localStorage.getItem("yoinkFindInStockOnly"), "0");
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    browser.close();
  }
});

test("Alert me hides the MSRP and never sends it", async () => {
  const { browser, requests } = wantFixtureBrowser({ msrpNeeded: true });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement | null)?.disabled, false));
    const alertMe = dialog.querySelector('input[name="wantMode"][value="notify"]') as HTMLInputElement;
    alertMe.checked = true;
    alertMe.dispatchEvent(new browser.Event("change", { bubbles: true }));
    const previews = () => requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want/preview");
    await eventually(() => assert.equal(previews().at(-1)?.body.mode, "notify"));
    assert.equal("confirmedMsrpCents" in (previews().at(-1)?.body ?? {}), false);
    await eventually(() => assert.equal((dialog.querySelector("#wantMsrpRow") as HTMLElement).hidden, true));
  } finally {
    browser.close();
  }
});

test("Any price up to my max skips the MSRP, uses the max as the price limit, and saves that rule", async () => {
  // Kevin, 2026-10-08: buy at the store's own price whatever it is, up to a max, never from a third-party seller.
  const { browser, requests } = wantFixtureBrowser({ msrpNeeded: true });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    const previews = () => requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want/preview");
    await eventually(() => assert.ok(dialog.querySelector('input[name="wantAnyPrice"]')));
    await eventually(() => assert.equal(previews().at(-1)?.body.confirmedMsrpCents, 2499));
    assert.equal(previews().at(-1)?.body.priceRule, "msrp");
    const anyPrice = dialog.querySelector('input[name="wantAnyPrice"]') as HTMLInputElement;
    assert.equal(anyPrice.checked, false, "the MSRP rule stays the default");
    anyPrice.checked = true;
    anyPrice.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.equal(previews().at(-1)?.body.priceRule, "max_price"));
    assert.equal("confirmedMsrpCents" in (previews().at(-1)?.body ?? {}), false, "the MSRP isn't sent");
    await eventually(() => assert.equal((dialog.querySelector("#wantMsrpRow") as HTMLElement).hidden, true));
    await eventually(() => assert.match(dialog.querySelector(".want-store")?.textContent ?? "", /Any price up to \$24\.99; MSRP not checked/));
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement).disabled, false));
    (dialog.querySelector("#wantSave") as HTMLButtonElement).click();
    await eventually(() => assert.equal(requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want").length, 1));
    const save = requests.find((request) => request.path === "/api/v1/user/purchase-intents/want")!;
    assert.equal(save.body.priceRule, "max_price");
    assert.equal(save.body.maxUnitPriceCents, 2499);
    assert.equal("confirmedMsrpCents" in save.body, false);
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Want It Fixture/));
  } finally {
    browser.close();
  }
});

test("Any price up to my max is hidden for Alert me", async () => {
  const { browser, requests } = wantFixtureBrowser({ msrpNeeded: true });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.ok(dialog.querySelector("#wantAnyPriceRow")));
    const alertMe = dialog.querySelector('input[name="wantMode"][value="notify"]') as HTMLInputElement;
    alertMe.checked = true;
    alertMe.dispatchEvent(new browser.Event("change", { bubbles: true }));
    const previews = () => requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want/preview");
    await eventually(() => assert.equal(previews().at(-1)?.body.mode, "notify"));
    assert.equal("priceRule" in (previews().at(-1)?.body ?? {}), false);
    await eventually(() => assert.equal((dialog.querySelector("#wantAnyPriceRow") as HTMLElement).hidden, true));
  } finally {
    browser.close();
  }
});

test("Want it charts each store's price history with the MSRP and the max, and as a table", async () => {
  // Kevin, 2026-10-08: "show a graph of the price history to show trends, plotting out each vendor's price history".
  const { browser, requests } = wantFixtureBrowser({ priceHistory: {
    variantId: "variant_want", title: "Want It Fixture", msrpCents: 2499, sinceAt: "2026-04-01T00:00:00.000Z",
    stores: [
      { retailerId: "target", retailerName: "Target", points: [{ at: "2026-09-01T12:00:00.000Z", priceCents: 2499 }, { at: "2026-09-20T12:00:00.000Z", priceCents: 2599 }] },
      { retailerId: "walmart", retailerName: "Walmart", points: [{ at: "2026-09-05T12:00:00.000Z", priceCents: 3499 }, { at: "2026-09-25T12:00:00.000Z", priceCents: 2399 }] }
    ],
    summary: {
      windowDays: 90,
      lowest: { priceCents: 2399, retailerId: "walmart", retailerName: "Walmart", at: "2026-09-25T12:00:00.000Z" },
      highest: { priceCents: 3499, retailerId: "walmart", retailerName: "Walmart", at: "2026-09-05T12:00:00.000Z" },
      suggested: { priceCents: 2599, retailerId: "target", retailerName: "Target" },
      toleranceCents: 500,
      stores: [
        { retailerId: "target", retailerName: "Target", usualCents: 2599, counted: true },
        { retailerId: "walmart", retailerName: "Walmart", usualCents: 3499, counted: false }
      ]
    }
  } });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.ok(dialog.querySelector("#wantHistory svg.history-chart")));
    assert.ok(requests.some((request) => request.path === "/api/v1/user/purchase-intents/want/price-history?listingId=listing_want_walmart"));
    const chart = dialog.querySelector("#wantHistory svg.history-chart")!;
    assert.match(chart.getAttribute("aria-label") ?? "", /Latest: Target \$25\.99; Walmart \$23\.99\. MSRP \$24\.99\./);
    assert.equal(chart.querySelectorAll(".history-line").length, 2, "one line per store");
    assert.deepEqual([...dialog.querySelectorAll(".history-legend li")].map((item) => item.textContent), ["Target", "Walmart"]);
    // A store keeps its color whatever else is plotted.
    assert.equal(chart.querySelectorAll(".history-line")[0]!.classList.contains("series-2"), true, "Target is always the second color");
    assert.equal(chart.querySelectorAll(".history-line")[1]!.classList.contains("series-1"), true, "Walmart is always the first color");
    assert.deepEqual([...chart.querySelectorAll(".history-label")].map((label) => label.textContent).sort(), ["Target $25.99", "Walmart $23.99"]);
    assert.deepEqual([...chart.querySelectorAll(".history-ref-label")].map((label) => label.textContent), ["MSRP $24.99", "Your max $24.99"]);
    assert.equal(dialog.querySelectorAll(".history-table tbody tr").length, 4);
    // The numbers under the chart (Kevin, 2026-10-09).
    const stats = [...dialog.querySelectorAll(".history-stats > div")].map((item) => [
      item.querySelector("dt")?.textContent, item.querySelector("strong")?.textContent, item.querySelector("small")?.textContent]);
    assert.equal(stats.length, 3);
    assert.deepEqual(stats.map(([label, price]) => [label, price]), [["90-day low", "$23.99"], ["90-day high", "$34.99"], ["Yoink suggests", "$25.99"]]);
    assert.match(stats[0]![2] ?? "", /^Walmart · /);
    assert.equal(stats[2]![2], "Usual price at Target");
    assert.match(dialog.querySelector(".history-stats-help")?.textContent ?? "", /within \$5\.00 of the cheapest\. Left out: Walmart \(\$34\.99\)\./);
    const previews = () => requests.filter((request) => request.path === "/api/v1/user/purchase-intents/want/preview");
    const before = previews().length;
    (dialog.querySelector("[data-use-suggested]") as HTMLButtonElement).click();
    assert.equal((dialog.querySelector('input[name="wantMax"]') as HTMLInputElement).value, "25.99", "Use as my max fills in the suggestion");
    await eventually(() => assert.ok(previews().length > before && previews().at(-1)?.body.maxUnitPriceCents === 2599));
    await eventually(() => assert.equal(dialog.querySelector("[data-use-suggested]"), null, "nothing to use once the max is the suggestion"));

    const clock = installPageClock(browser);
    const max = dialog.querySelector('input[name="wantMax"]') as HTMLInputElement;
    max.value = "30.00";
    max.dispatchEvent(new browser.Event("input", { bubbles: true }));
    await clock.advance(500);
    clock.restore();
    await eventually(() => assert.deepEqual([...dialog.querySelectorAll("#wantHistory .history-ref-label")].map((label) => label.textContent),
      ["MSRP $24.99", "Your max $30.00"]));
  } finally {
    browser.close();
  }
});

test("Want it says when no prices are recorded yet", async () => {
  const { browser } = wantFixtureBrowser();
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    (browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#wantHistory")?.textContent ?? "", /No prices recorded for this item yet\./));
    assert.equal(browser.document.querySelector("#wantHistory svg"), null);
  } finally {
    browser.close();
  }
});

test("a store's Test call lists the items, explains those not ready, and sends the chosen one", async () => {
  // Kevin, 2026-10-08: Setup › Stores › Test call adds a real item to the cart without waiting for a restock.
  const { browser, requests } = wantFixtureBrowser({ testCallItems: [
    { listingId: "listing_ready", title: "Ready Puzzle", retailerId: "walmart", retailerName: "Walmart", retailerSku: "1", priceCents: 2499, maxUnitPriceCents: 2999, msrpCents: 2999, ready: true, reason: "" },
    { listingId: "listing_waiting", title: "Waiting Puzzle", retailerId: "walmart", retailerName: "Walmart", retailerSku: "2", priceCents: null, maxUnitPriceCents: 2999, msrpCents: null, ready: false, reason: "Confirm the MSRP in Want it first." }
  ] });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    void browser.eval('openTestCall("walmart")');
    const dialog = browser.document.querySelector("#testCallDialog") as HTMLDialogElement;
    await eventually(() => assert.equal(dialog.querySelectorAll('input[name="testCallListing"]').length, 2));
    const [ready, waiting] = [...dialog.querySelectorAll('input[name="testCallListing"]')] as HTMLInputElement[];
    assert.equal(ready!.checked, true);
    assert.equal(waiting!.disabled, true);
    assert.match(dialog.textContent ?? "", /Confirm the MSRP in Want it first\./);
    assert.match(dialog.textContent ?? "", /\$24\.99 · your max \$29\.99 · MSRP \$29\.99/);
    assert.equal((dialog.querySelector("#testCallSend") as HTMLButtonElement).disabled, false);
    (dialog.querySelector("#testCallSend") as HTMLButtonElement).click();
    await eventually(() => assert.ok(requests.some((request) => request.path === "/api/v1/user/test-calls")));
    assert.deepEqual(requests.find((request) => request.path === "/api/v1/user/test-calls")?.body,
      { contractVersion: 1, listingId: "listing_ready", confirmation: "SEND_TEST_CALL" });
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "",
      /Test call sent\. Chrome will add Ready Puzzle to your this store cart and open checkout\./));
  } finally {
    browser.close();
  }
});

test("Fill in MSRPs shows each item's MSRP and source, lets a resale price be left out, and sends the ticked ones", async () => {
  // Kevin, 2026-10-08: "fill it in with the Best Buy or Target or Walmart MSRP".
  const { browser, requests } = wantFixtureBrowser({ msrpFillItems: [
    { planId: "plan_cream_cone", title: "NeeDoh Nice Cream Cone", msrpCents: 759, sourceLabel: "Target's price", currentMaxCents: 899, newMaxCents: 759, canFill: true, reason: "" },
    { planId: "plan_evolving_skies", title: "Pokemon Evolving Skies Elite Trainer Box", msrpCents: 69999, sourceLabel: "Walmart's price", currentMaxCents: 89999, newMaxCents: 69999, canFill: true, reason: "" },
    { planId: "plan_gundam", title: "Gundam TCG Phantom Aria", msrpCents: null, sourceLabel: "", currentMaxCents: 12995, newMaxCents: null, canFill: false,
      reason: "No MSRP from TrackaLacker and no Best Buy, Target or Walmart price yet. Set it in Want it." }
  ] });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    browser.eval(`renderMsrpFillNotice([
      { id: "plan_cream_cone", actionCeiling: "add_to_cart", automationReadiness: { state: "guarded_add_policy_incomplete" } },
      { id: "plan_ready", actionCeiling: "add_to_cart", automationReadiness: { state: "ready" } },
      { id: "plan_alerts", actionCeiling: "notify", automationReadiness: { state: "notification_ready" } }
    ]);`);
    assert.match(browser.document.querySelector("#msrpFillNotice")?.textContent ?? "", /1 cart item needs an MSRP\./);
    (browser.document.querySelector("#fillMsrps") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#msrpFillDialog") as HTMLDialogElement;
    await eventually(() => assert.equal(dialog.querySelectorAll('input[name="msrpFillId"]').length, 2));
    assert.match(dialog.textContent ?? "", /MSRP \$7\.59 from Target's price · your max goes from \$8\.99 to \$7\.59/);
    assert.match(dialog.textContent ?? "", /Set it in Want it\./);
    assert.equal((dialog.querySelector("#applyMsrpFill") as HTMLButtonElement).textContent, "Set 2 MSRPs");
    const resale = dialog.querySelector('input[value="plan_evolving_skies"]') as HTMLInputElement;
    resale.checked = false;
    resale.dispatchEvent(new browser.Event("change", { bubbles: true }));
    assert.equal((dialog.querySelector("#applyMsrpFill") as HTMLButtonElement).textContent, "Set 1 MSRP");
    (dialog.querySelector("#applyMsrpFill") as HTMLButtonElement).click();
    await eventually(() => assert.ok(requests.some((request) => request.path === "/api/v1/user/purchase-intents/msrp-fill" && request.method === "POST")));
    assert.deepEqual(requests.find((request) => request.method === "POST" && request.path === "/api/v1/user/purchase-intents/msrp-fill")?.body,
      { contractVersion: 1, planIds: ["plan_cream_cone"], confirmation: "FILL_MISSING_MSRPS" });
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Set the MSRP for 1 item\. Yoink can now add it to your cart\./));
  } finally {
    browser.close();
  }
});

test("Test call can use any in-stock item: a pasted link and its MSRP", async () => {
  // Kevin, 2026-10-08: called items are usually sold out when he tests.
  const { browser, requests } = wantFixtureBrowser({ testCallItems: [] });
  try {
    await eventually(() => assert.ok(browser.document.querySelector("#productList [data-want-listing]")));
    void browser.eval('openTestCall("walmart")');
    const dialog = browser.document.querySelector("#testCallDialog") as HTMLDialogElement;
    await eventually(() => assert.ok(dialog.querySelector('input[name="testCallUrl"]')));
    assert.match(dialog.textContent ?? "", /You have no items set to Add to cart/);
    (dialog.querySelector("#testCallLinkSend") as HTMLButtonElement).click();
    await eventually(() => assert.match(dialog.querySelector("#testCallStatus")?.textContent ?? "", /MSRP/));
    (dialog.querySelector('input[name="testCallUrl"]') as HTMLInputElement).value = "https://www.walmart.com/ip/5551234";
    (dialog.querySelector('input[name="testCallMsrp"]') as HTMLInputElement).value = "12.99";
    (dialog.querySelector("#testCallLinkSend") as HTMLButtonElement).click();
    await eventually(() => assert.ok(requests.some((request) => request.path === "/api/v1/user/test-calls/link")));
    assert.deepEqual(requests.find((request) => request.path === "/api/v1/user/test-calls/link")?.body,
      { contractVersion: 1, url: "https://www.walmart.com/ip/5551234", msrpCents: 1299, retailerId: "walmart", confirmation: "SEND_TEST_CALL" });
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Test call sent\. Chrome will add the linked item/));
  } finally {
    browser.close();
  }
});

test("a wanted product shows what Yoink does, edits in the same sheet, and can stop being wanted", async () => {
  const { browser, requests, confirmations } = wantFixtureBrowser({
    purchaseIntent: { id: "mission_wanted_fixture", variantId: "variant_want", status: "active", origin: "user_want", actionCeiling: "notify", maxUnitPriceCents: 2200 }
  });
  try {
    await eventually(() => assert.match(browser.document.querySelector("#productList .card-plan-state")?.textContent ?? "", /Alerts/));
    const edit = browser.document.querySelector("#productList [data-want-listing]") as HTMLButtonElement;
    assert.equal(edit.textContent?.trim(), "Yoink", "a wanted item's Want it button reads Yoink");
    assert.ok(edit.querySelector("svg.yoink-mark"));
    assert.equal(edit.classList.contains("yoink-draw"), false, "an item wanted earlier shows the finished mark");
    edit.focus();
    edit.click();
    const dialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.equal((dialog.querySelector("#wantSave") as HTMLButtonElement | null)?.textContent?.trim(), "Save"));
    assert.equal(requests.find((request) => request.path === "/api/v1/user/purchase-intents/want/preview")?.body.mode, "notify",
      "editing starts from the plan's own choice");
    assert.equal(browser.document.querySelector("#wantDialogEyebrow")?.textContent, "On your Want list");
    assert.equal((dialog.querySelector('input[name="wantMode"][value="notify"]') as HTMLInputElement).checked, true);
    assert.equal((dialog.querySelector('input[name="wantMax"]') as HTMLInputElement).value, "22.00");
    (dialog.querySelector("[data-close-dialog]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    assert.equal(browser.document.activeElement, edit, "closing returns focus to the product");
    assert.equal(requests.some((request) => request.path === "/api/v1/user/purchase-intents/want"), false);

    edit.click();
    await eventually(() => assert.ok(dialog.querySelector("#wantStop")));
    (dialog.querySelector("#wantStop") as HTMLButtonElement).click();
    await eventually(() => assert.ok(requests.some((request) => request.method === "DELETE" && request.path === "/api/v1/user/purchase-intents/mission_wanted_fixture")));
    assert.equal(confirmations[0]?.title, "Stop wanting “Want It Fixture”?");
    assert.equal(requests.find((request) => request.method === "DELETE")?.body.confirmation, "DELETE_PURCHASE_PLAN");
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Want It Fixture is off your Want list/));
  } finally {
    browser.close();
  }
});

test("Calls combines source feedback, queue-open facts, affiliate routing, and Want it on each call", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#cart/calls",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const createdListingIds = new Set<string>();
  const wantPreviews: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  const feedback: Array<Record<string, unknown>> = [];
  const watchModeUpdates: Array<Record<string, unknown>> = [];
  const watchItemMutations: string[] = [];
  const walmartPurchaseClicks: Array<{
    path: string;
    keepalive: boolean;
    body: Record<string, unknown>;
  }> = [];
  let falsePositiveReported = false;
  let watchQueueMode = "auto_armed";
  let stripWatch: null | { id: string; state: string } = null;
  const stripStartsAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const stripClosesAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const profile = {
    id: "profile_calls_fixture",
    name: "Guarded shipping",
    isDefault: false,
    targetQuantity: 2,
    priceMode: "fixed_cap",
    maxUnitPriceCents: 2500,
    msrpOffsetPercent: null,
    actionCeiling: "add_to_cart",
    fulfillment: "pickup",
    cooldownSeconds: 120
  };
  const listings = [
    {
      variantId: "variant_calls_signal",
      listingId: "listing_calls_signal",
      retailerId: "target",
      retailerName: "Target",
      retailerSku: "94972381",
      canonicalUrl: "https://www.target.com/p/-/A-94972381",
      currentPriceCents: 1999
    },
    {
      variantId: "variant_calls_queue",
      listingId: "listing_calls_queue",
      retailerId: "walmart",
      retailerName: "Walmart",
      retailerSku: "20252562938",
      canonicalUrl: "https://www.walmart.com/ip/20252562938",
      currentPriceCents: 2497
    },
    {
      variantId: "variant_calls_walmart_buy",
      listingId: "listing_calls_walmart_buy",
      retailerId: "walmart",
      retailerName: "Walmart",
      retailerSku: "19988614228",
      canonicalUrl: "https://www.walmart.com/ip/19988614228",
      currentPriceCents: 8497
    }
  ].map((item) => ({
    ...item,
    status: "in_stock",
    executionSupported: true,
    msrpCents: 2999,
    currency: "USD",
    priceObservedAt: "2026-08-30T08:00:00.000Z",
    updatedAt: "2026-08-30T08:00:00.000Z"
  }));
  const groups = listings.map((listing) => ({
    variantId: listing.variantId,
    familyId: `family_${listing.variantId}`,
    title: listing.retailerId === "target" ? "Signal fixture" : "Queue fixture",
    brand: "",
    imageUrl: "",
    variantAttributes: {},
    createdAt: "2026-08-30T07:00:00.000Z",
    storeCount: 1,
    listingCount: 1,
    availableListingCount: 1,
    bestPriceCents: listing.currentPriceCents,
    currency: "USD",
    lastActivityAt: "2026-08-30T08:00:00.000Z",
    listings: [listing]
  }));
  let showWalmartPurchase = false;
  let walmartPurchaseMode: "howl" | "raw" | "bad_destination" | "bad_direct" | "short" = "howl";
  const walmartPurchaseJobId = () => `job_walmart_purchase_${walmartPurchaseMode}`;
  const walmartDirectCartUrl = "https://www.walmart.com/affil/cart/reviewOrder?items=19988614228&cn=nc&veh=aff";
  const walmartPurchaseHandoff = () => {
    const howlRoute = new URL("https://howl.link/link");
    howlRoute.searchParams.set("url", walmartDirectCartUrl);
    howlRoute.searchParams.set("publisher_slug", "collectwithdodo");
    howlRoute.searchParams.set("article_name", "Walmart direct-cart fixture");
    howlRoute.searchParams.set("article_url", "https://yoink.example/alerts");
    howlRoute.searchParams.set("u1", "walmart_19988614228");
    return {
      kind: "walmart_review_order",
      walmartItemId: "19988614228",
      destinationUrl: walmartPurchaseMode === "howl"
        ? howlRoute.href
        : walmartPurchaseMode === "raw" || walmartPurchaseMode === "short"
          ? walmartDirectCartUrl
          : "https://www.walmart.com/cart",
      directFallbackUrl: walmartPurchaseMode === "bad_direct"
        ? "https://www.walmart.com/cart"
        : walmartDirectCartUrl,
      pdpFallbackUrl: "https://www.walmart.com/ip/19988614228",
      trackingId: "walmart_19988614228",
      expiresAt: new Date(Date.now() + (walmartPurchaseMode === "short" ? 250 : 60_000)).toISOString()
    };
  };
  const calls = () => [{
    id: "signal:signal_calls_fixture",
    kind: "signal",
    listingId: listings[0]!.listingId,
    retailerId: "target",
    retailerSku: "94972381",
    canonicalUrl: listings[0]!.canonicalUrl,
    title: "Signal fixture",
    occurredAt: "2026-08-30T08:00:00.000Z",
    status: "in_stock",
    unitPriceCents: 1999,
    currency: "USD",
    source: "Collector alerts",
    sourceChannelId: "provider_channel_calls_fixture",
    falsePositiveReported
  }, {
    id: "drop:drop_window_item_calls_fixture",
    kind: "queue_open",
    listingId: listings[1]!.listingId,
    retailerId: "walmart",
    retailerSku: "20252562938",
    canonicalUrl: listings[1]!.canonicalUrl,
    title: "Queue fixture",
    occurredAt: "2026-08-30T09:00:00.000Z",
    status: "scheduled",
    unitPriceCents: null,
    currency: "USD",
    source: "drop_window",
    dropWindowItemId: "drop_window_item_calls_fixture",
    startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    closesAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    timezone: "America/New_York",
    earlyAccess: { membership: "Walmart+", queueExpected: true },
    watch: {
      id: "watch_item_calls_fixture",
      state: "queued",
      enrollment: "auto_armed",
      observationStartsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      observationClosesAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      observationCount: 1,
      lastAvailability: "out_of_stock",
      lastObservedAt: new Date(Date.now() - 60_000).toISOString(),
      readiness: { readOnly: true, reasonCode: "read_only_observation" }
    }
  }, ...(showWalmartPurchase ? [{
    id: "signal:signal_calls_walmart_buy",
    kind: "signal",
    actionJobId: walmartPurchaseJobId(),
    listingId: listings[2]!.listingId,
    retailerId: "walmart",
    retailerSku: "19988614228",
    canonicalUrl: listings[2]!.canonicalUrl,
    title: "Walmart direct-cart fixture",
    occurredAt: new Date(Date.now() - 5_000).toISOString(),
    status: "qualified",
    unitPriceCents: 8497,
    currency: "USD",
    source: "Collector alerts",
    sourceChannelId: "provider_channel_walmart_buy_fixture",
    falsePositiveReported: false,
    purchaseHandoff: walmartPurchaseHandoff()
  }] : [])];
  const dropWindows = () => [{
    id: "drop_window_calls_strip_fixture",
    retailerId: "target",
    kind: "drop_window",
    title: "Upcoming strip fixture",
    startsAt: stripStartsAt,
    closesAt: stripClosesAt,
    timezone: "America/New_York",
    status: "scheduled",
    items: [{
      id: "drop_window_item_strip_fixture",
      listingId: listings[0]!.listingId,
      retailerId: "target",
      retailerSku: "94972381",
      canonicalUrl: listings[0]!.canonicalUrl,
      title: "Signal fixture",
      watch: stripWatch
    }]
  }];
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 3, purchaseIntents: 1 + createdListingIds.size, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: ["worker.manage"],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: {
      latestScan: { outcome: "passed", observedCardCount: 1, expectedCardCount: 1, observedAt: "2026-08-30T08:00:00.000Z" },
      items: [{
        retailerSku: "19988614228",
        title: "Drawing fixture",
        drawState: "active",
        sellerName: "Walmart",
        unitPriceCents: 2499,
        currency: "USD",
        closesAt: "2026-09-02T08:00:00.000Z",
        tracked: false,
        canonicalUrl: "https://www.walmart.com/ip/19988614228"
      }]
    }
  };
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: true, note: "" }) }
  });
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string; keepalive?: boolean } = {}) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (/^\/api\/v1\/user\/purchase-handoffs\/job_walmart_purchase_(?:howl|raw|bad_destination|bad_direct|short)\/click$/.test(path)
        && options.method === "POST") {
        walmartPurchaseClicks.push({
          path,
          keepalive: options.keepalive === true,
          body: JSON.parse(String(options.body || "{}")) as Record<string, unknown>
        });
        return { ok: true, status: 202, json: async () => ({ click: { recorded: true } }) };
      }
      if (path === "/api/v1/user/source-feedback/false-positive" && options.method === "POST") {
        feedback.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        falsePositiveReported = true;
        return { ok: true, status: 200, json: async () => ({ recorded: true }) };
      }
      if (path === "/api/v1/user/watch-queue/settings" && options.method === "PATCH") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        watchModeUpdates.push(requested);
        watchQueueMode = requested.mode === "auto_armed" ? "auto_armed" : "manual";
        return { ok: true, status: 200, json: async () => ({ watchQueue: {
          mode: watchQueueMode,
          previousMode: watchQueueMode === "manual" ? "auto_armed" : "manual",
          newlyEnrolledCount: 0
        } }) };
      }
      if (path === "/api/v1/user/watch-queue/drop_window_item_strip_fixture/enroll" && options.method === "POST") {
        watchItemMutations.push(path);
        stripWatch = { id: "watch_item_strip_fixture", state: "queued" };
        return { ok: true, status: 201, json: async () => ({ watch: stripWatch }) };
      }
      if (path === "/api/v1/user/watch-queue/watch_item_strip_fixture/cancel" && options.method === "POST") {
        watchItemMutations.push(path);
        stripWatch = { id: "watch_item_strip_fixture", state: "cancelled" };
        return { ok: true, status: 200, json: async () => ({ watch: stripWatch }) };
      }
      if (path === "/api/v1/user/purchase-intents/want/preview" && options.method === "POST") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        wantPreviews.push(requested);
        const listing = listings.find((item) => item.listingId === requested.listingId);
        return { ok: true, status: 200, json: async () => ({ preview: {
          contractVersion: 1, noPlanSaved: true, listingId: requested.listingId, variantId: listing?.variantId ?? "",
          title: calls().find((call) => call.listingId === requested.listingId)?.title ?? "Call product", imageUrl: "", msrpCents: 2500,
          requestedMode: requested.mode, mode: requested.mode,
          summary: "When Walmart has it in stock for $25.00 or less, Yoink adds it to your cart. You check out yourself.",
          targetQuantity: 1, maxUnitPriceCents: Number(requested.maxUnitPriceCents ?? 2500), maxAllInCents: 2800,
          stores: [{ listingId: requested.listingId, retailerId: "walmart", retailerName: "Walmart", retailerSku: "1",
            priceCents: 2500, availability: "in_stock", cartReady: true, watch: "add_to_cart", note: "Adds to cart" }],
          spendingLimit: { allowed: true, reasonCode: "within_spending_limits", message: "" }, plan: null, canSave: true,
          previewFingerprint: "c".repeat(64), previewedAt: "2026-08-30T08:01:00.000Z", validForSeconds: 300
        } }) };
      }
      if (path === "/api/v1/user/purchase-intents/want" && options.method === "POST") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        posts.push(requested);
        createdListingIds.add(String(requested.listingId));
        return { ok: true, status: 201, json: async () => ({ created: true, purchaseIntent: { id: `mission_${requested.listingId}` } }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => overview };
      if (path.startsWith("/api/v1/user/library/products")) {
        return { ok: true, status: 200, json: async () => ({ items: groups, total: groups.length }) };
      }
      if (path === "/api/v1/user/purchase-intents?limit=200&offset=0") {
        return { ok: true, status: 200, json: async () => ({ items: listings
          .filter((listing) => createdListingIds.has(listing.listingId))
          .map((listing) => ({ id: `mission_${listing.listingId}`, variantId: listing.variantId })) }) };
      }
      if (path === "/api/v1/user/purchase-profiles") {
        return { ok: true, status: 200, json: async () => ({ items: [profile] }) };
      }
      if (path.startsWith("/api/v1/user/calls?")) {
        return { ok: true, status: 200, json: async () => ({ items: calls().map((call) => ({ ...call,
          product: listings.find((listing) => listing.listingId === call.listingId) || null,
          purchaseIntent: createdListingIds.has(call.listingId)
            ? { id: `mission_${call.listingId}`, status: "active", origin: "user_want", actionCeiling: "add_to_cart", maxUnitPriceCents: 2500 }
            : null
        })) }) };
      }
      if (path === "/api/v1/user/drop-windows") {
        return { ok: true, status: 200, json: async () => ({ items: dropWindows() }) };
      }
      if (path === "/api/v1/user/action-platform") {
        return { ok: true, status: 200, json: async () => ({
          watchQueueMode,
          readiness: [],
          connectors: [],
          connectorDeliveries: [],
          sources: [],
          orderConfirmations: [],
          analytics: { funnel: {}, spend: { overCapCount: 2, overCapAmountCents: 500 }, retailers: [] }
        }) };
      }
      if (path === "/api/v1/user/health") return { ok: true, status: 200, json: async () => ({
        contractVersion: 1,
        generatedAt: "2026-08-30T08:02:00.000Z",
        version: "calls-health-fixture",
        worker: { state: "running", healthy: true, lastHeartbeatAt: "2026-08-30T08:01:59.000Z" },
        counts: { onlineDevices: 1, watchQueue: 1, sourceAttention: 0, connectorFailures: 0 },
        readiness: [],
        sources: [],
        connectors: [],
        diagnosticBundle: {
          containsSecrets: false,
          containsUrls: false,
          containsDom: false,
          containsAccountOrPaymentData: false,
          workerState: "running",
          workerErrorCode: "",
          deviceStates: []
        }
      }) };
      if (path === "/api/v1/user/privacy") return { ok: true, status: 200, json: async () => ({ inventory: {
        totalRecords: 0, credentialMaterialsExcluded: true, categories: []
      } }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
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

  try {
    browser.eval(`${script}\n//# sourceURL=user-dashboard-calls-test.js`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("#callList [data-want-listing]").length, 2));
    assert.equal(browser.document.querySelector("#callCount")?.textContent?.trim(), "3 calls");
    assert.equal(browser.document.querySelectorAll("#calls .subtabs").length, 0);
    assert.equal(browser.document.querySelectorAll("[data-call-filter]").length, 3);
    assert.equal((browser.document.querySelector("#callDrawingResults") as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector("#callDrawingResults")?.textContent ?? "", /Drawing fixture/);
    assert.doesNotMatch(browser.document.querySelector("#callDrawingResults")?.textContent ?? "", /Manual entry only/);
    (browser.document.querySelector('[data-call-filter="drawings"]') as HTMLButtonElement).click();
    assert.equal(browser.location.hash, "#cart/calls/drawings");
    assert.equal((browser.document.querySelector("#callProductResults") as HTMLElement).hidden, true);
    assert.equal((browser.document.querySelector("#callDrawingResults") as HTMLElement).hidden, false);
    assert.equal(browser.document.querySelector("#callCount")?.textContent?.trim(), "1 drawing");
    assert.equal((browser.document.querySelector('[data-call-filter="drawings"]') as HTMLButtonElement).getAttribute("aria-pressed"), "true");
    (browser.document.querySelector('[data-call-filter="products"]') as HTMLButtonElement).click();
    assert.equal(browser.location.hash, "#cart/calls");
    assert.equal((browser.document.querySelector("#callProductResults") as HTMLElement).hidden, false);
    assert.equal((browser.document.querySelector("#callDrawingResults") as HTMLElement).hidden, true);
    assert.equal(browser.document.querySelector("#callCount")?.textContent?.trim(), "2 product calls");
    (browser.document.querySelector('[data-call-filter="all"]') as HTMLButtonElement).click();
    assert.equal((browser.document.querySelector("#callDrawingResults") as HTMLElement).hidden, false);
    assert.equal(browser.document.querySelector("#callSelectionToolbar"), null, "Calls has no bulk toolbar");
    const callText = browser.document.querySelector("#callList")?.textContent ?? "";
    assert.equal([...browser.document.querySelectorAll("#callList .call-card .card-top .tag")]
      .some((tag) => tag.textContent?.trim() === "Queue"), true);
    assert.match(callText, /Walmart\+/);
    assert.match(callText, /Queue expected/);
    assert.doesNotMatch(callText, /read-only|\barmed\b|Observation remains/i);
    assert.match(callText, /Watching starts/);
    assert.match(callText, /Watched automatically for your plan/);
    assert.match(callText, /1 check · Out of stock/);
    assert.match(callText, /Watching for stock/);
    assert.equal([...browser.document.querySelectorAll("#callList [data-watch-enroll]")].every((button) => button.textContent?.trim() === "Watch"), true,
      "cards and the strip share one watch vocabulary");
    const drawingCard = browser.document.querySelector("#walmartDrawList .product-card") as HTMLElement;
    assert.equal(drawingCard.querySelectorAll(".tag").length <= 3, true, "a drawing card exposes at most type, state, and one qualifier tag");
    assert.deepEqual([...drawingCard.querySelectorAll(".tag")].map((tag) => tag.textContent?.trim()), ["Drawing", "Open"]);
    assert.match(drawingCard.textContent ?? "", /Closes \w{3} \d{1,2}:\d{2}/);
    assert.doesNotMatch(drawingCard.textContent ?? "", /\bactive\b|Not tracked/);
    assert.match(browser.document.querySelector("#walmartDrawSummary")?.textContent ?? "", /Latest check.*Checked/s);
    assert.equal((browser.document.querySelector("#callsUpcomingDrops") as HTMLElement).hidden, false);
    assert.equal((browser.document.querySelector("#homeUpcomingDrops") as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector("#callsUpcomingDrops")?.textContent ?? "", /Upcoming strip fixture/);
    assert.match(browser.document.querySelector("#homeUpcomingDrops")?.textContent ?? "", /Upcoming strip fixture/);
    assert.match(browser.document.querySelector("#callsUpcomingDrops")?.textContent ?? "", /starts in (?:29|30) minutes/);
    assert.match(browser.document.querySelector("#callsUpcomingDrops")?.textContent ?? "", /source/);
    assert.match(String(browser.eval("relative(new Date(Date.now() + 305 * 60_000).toISOString())")), /305 minutes/);
    (browser.document.querySelector("#callsUpcomingDrops [data-watch-enroll]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(watchItemMutations.length, 1));
    await eventually(() => assert.equal((browser.document.querySelector("#callsUpcomingDrops [data-watch-cancel]") as HTMLButtonElement)?.getAttribute("aria-pressed"), "true"));
    (browser.document.querySelector("#callsUpcomingDrops [data-watch-cancel]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(watchItemMutations.length, 2));
    await eventually(() => assert.match(browser.document.querySelector("#callsUpcomingDrops")?.textContent ?? "", /Watch ended/));
    assert.deepEqual(watchItemMutations, [
      "/api/v1/user/watch-queue/drop_window_item_strip_fixture/enroll",
      "/api/v1/user/watch-queue/watch_item_strip_fixture/cancel"
    ]);
    assert.deepEqual([...browser.document.querySelectorAll("#callList [data-want-listing]")].map((button) => button.textContent?.trim()),
      ["Want it", "Want it"], "each product call offers one Want it, whatever Quick add setups exist");
    assert.equal(browser.document.querySelectorAll("#callList [data-quick-add], #callList [data-quick-menu]").length, 0);
    const initialCallCards = [...browser.document.querySelectorAll("#callList .call-card")];
    assert.equal(initialCallCards.every((card) => card.querySelectorAll(".tag").length <= 3), true,
      "a call card exposes at most type, state, and one qualifier tag");
    const queueCard = initialCallCards.find((card) => card.textContent?.includes("Queue fixture"));
    assert.match(queueCard?.textContent ?? "", /Access: Walmart\+.*Queue expected/);
    assert.equal([...queueCard?.querySelectorAll(".tag") || []].some((tag) => /Walmart\+|Queue expected/.test(tag.textContent || "")), false,
      "membership and queue expectations belong in the detail line");
    const watchMode = browser.document.querySelector("#watchQueueMode") as HTMLSelectElement;
    assert.equal(watchMode.value, "auto_armed");
    const outbound = new URL((browser.document.querySelector("#callList a.canonical") as HTMLAnchorElement).href);
    assert.equal(outbound.origin, "https://howl.link");
    assert.equal(outbound.searchParams.get("publisher_slug"), "collectwithdodo");
    (browser.document.querySelector('.tabs [data-tab="setup"]') as HTMLButtonElement).click();
    (browser.document.querySelector('[data-setup-section="alerts"]') as HTMLButtonElement).click();
    assert.match(browser.document.querySelector("#notifications")?.textContent ?? "", /Discord, Slack and webhooks/);
    assert.equal(browser.document.querySelector("#notifications button[type='submit']")?.textContent?.trim(), "Add destination");
    assert.match(browser.document.querySelector("#watchQueueModeStatus")?.textContent ?? "", /watched automatically without adding to cart/);
    // Insights moved to Admin; Setup carries no analytics panel.
    assert.equal(browser.document.querySelector("#analyticsMetrics"), null);
    assert.equal(browser.document.querySelector("#restartWorker"), null);
    assert.equal(browser.document.querySelector("#healthDetails"), null);
    (browser.document.querySelector('#homeCalls [data-tab="calls"]') as HTMLButtonElement).click();

    watchMode.value = "manual";
    watchMode.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.equal(watchModeUpdates.length, 1));
    assert.deepEqual(watchModeUpdates[0], {
      mode: "manual",
      confirmation: "SET_WATCH_QUEUE_MODE"
    });
    await eventually(() => assert.equal(
      browser.document.querySelector('[data-panel="setup"]')?.classList.contains("active"),
      true,
      "saving Watch mode stays in Setup"
    ));
    assert.equal(watchMode.value, "manual");
    assert.equal(browser.document.querySelector('[data-setup-section="limits"]')?.getAttribute("aria-current"), "true");
    (browser.document.querySelector('#homeCalls [data-tab="calls"]') as HTMLButtonElement).click();

    (browser.document.querySelector("[data-false-positive]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(feedback.length, 1));
    assert.deepEqual(feedback[0], {
      channelId: "provider_channel_calls_fixture",
      signalId: "signal_calls_fixture",
      confirmation: "REPORT_FALSE_POSITIVE"
    });
    await eventually(() => assert.match(browser.document.querySelector("#callList")?.textContent ?? "", /False positive reported/));
    assert.equal([...browser.document.querySelectorAll("#callList .call-card")]
      .every((card) => card.querySelectorAll(".tag").length <= 3), true);

    const wantButton = browser.document.querySelector('#callList [data-want-listing="listing_calls_signal"]') as HTMLButtonElement;
    wantButton.click();
    const wantDialog = browser.document.querySelector("#wantDialog") as HTMLDialogElement;
    await eventually(() => assert.equal((wantDialog.querySelector("#wantSave") as HTMLButtonElement | null)?.disabled, false));
    assert.equal(wantPreviews[0]?.listingId, "listing_calls_signal");
    assert.equal(wantPreviews[0]?.mode, "add_to_cart");
    assert.match(wantDialog.textContent ?? "", /Walmart.*Adds to cart/s);
    (wantDialog.querySelector("#wantSave") as HTMLButtonElement).click();
    await eventually(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      contractVersion: 1,
      listingId: "listing_calls_signal",
      mode: "add_to_cart",
      maxUnitPriceCents: 2500,
      targetQuantity: 1,
      confirmation: "SAVE_PRODUCT_WANT",
      previewFingerprint: "c".repeat(64),
      previewedAt: "2026-08-30T08:01:00.000Z"
    });
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Yoink adds it to your cart at Walmart for up to \$25\.00/));
    await eventually(() => assert.equal(
      browser.document.querySelector('#callList [data-want-listing="listing_calls_signal"]')?.textContent?.trim(),
      "Yoink"
    ));

    showWalmartPurchase = true;
    await browser.eval("refresh()");
    await eventually(() => assert.equal(browser.document.querySelectorAll("[data-walmart-buy]").length, 1));
    const buyAtWalmart = browser.document.querySelector("[data-walmart-buy]") as HTMLAnchorElement;
    assert.equal(buyAtWalmart.textContent?.trim(), "Buy at Walmart ↗");
    assert.equal(buyAtWalmart.dataset.walmartJob, "job_walmart_purchase_howl");
    assert.equal(buyAtWalmart.dataset.walmartRoute, "howl");
    const affiliateRoute = new URL(buyAtWalmart.href);
    assert.equal(affiliateRoute.origin, "https://howl.link");
    assert.equal(
      affiliateRoute.searchParams.get("url"),
      "https://www.walmart.com/affil/cart/reviewOrder?items=19988614228&cn=nc&veh=aff"
    );
    assert.equal(affiliateRoute.searchParams.get("u1"), "walmart_19988614228");
    assert.match(buyAtWalmart.rel, /sponsored/);
    assert.equal(buyAtWalmart.closest(".call-card")?.querySelectorAll("[data-quick-add]").length, 0);
    assert.match(
      (buyAtWalmart.closest(".call-card")?.querySelector("a.canonical") as HTMLAnchorElement).href,
      /howl\.link/
    );
    buyAtWalmart.addEventListener("click", (event) => event.preventDefault(), { once: true });
    buyAtWalmart.click();
    await eventually(() => assert.equal(walmartPurchaseClicks.length, 1));
    assert.deepEqual(walmartPurchaseClicks[0], {
      path: "/api/v1/user/purchase-handoffs/job_walmart_purchase_howl/click",
      keepalive: true,
      body: {
        routeKind: "howl",
        surface: "calls",
        confirmation: "OPEN_WALMART_PURCHASE_HANDOFF"
      }
    });

    const howlEndpoint = AFFILIATE_ROUTING_FIXTURE.endpoint;
    try {
      walmartPurchaseMode = "raw";
      AFFILIATE_ROUTING_FIXTURE.endpoint = "";
      await browser.eval("refresh()");
      const rawWalmartBuy = browser.document.querySelector("[data-walmart-buy]") as HTMLAnchorElement;
      assert.equal(
        rawWalmartBuy.href,
        walmartDirectCartUrl
      );
      assert.equal(rawWalmartBuy.dataset.walmartRoute, "direct");
      assert.doesNotMatch(rawWalmartBuy.rel, /sponsored/);
      assert.equal(
        (rawWalmartBuy.closest(".call-card")?.querySelector("a.canonical") as HTMLAnchorElement).href,
        "https://www.walmart.com/ip/19988614228"
      );
      rawWalmartBuy.addEventListener("click", (event) => event.preventDefault(), { once: true });
      rawWalmartBuy.click();
      await eventually(() => assert.equal(walmartPurchaseClicks.length, 2));
      assert.equal(walmartPurchaseClicks[1]?.body.routeKind, "direct");
    } finally {
      AFFILIATE_ROUTING_FIXTURE.endpoint = howlEndpoint;
    }

    walmartPurchaseMode = "bad_destination";
    await browser.eval("refresh()");
    const invalidHowlFallback = browser.document.querySelector("[data-walmart-buy]") as HTMLAnchorElement;
    assert.equal(invalidHowlFallback.href, walmartDirectCartUrl);
    assert.equal(invalidHowlFallback.dataset.walmartRoute, "direct");
    assert.doesNotMatch(invalidHowlFallback.rel, /sponsored/);

    walmartPurchaseMode = "bad_direct";
    await browser.eval("refresh()");
    assert.equal(browser.document.querySelectorAll("[data-walmart-buy]").length, 0);
    const pdpFallback = [...browser.document.querySelectorAll("#callList a.canonical")].find((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("url") === "https://www.walmart.com/ip/19988614228") as HTMLAnchorElement;
    const pdpAffiliateRoute = new URL(pdpFallback.href);
    assert.equal(pdpAffiliateRoute.origin, "https://howl.link");
    assert.equal(pdpAffiliateRoute.searchParams.get("url"), "https://www.walmart.com/ip/19988614228");

    walmartPurchaseMode = "short";
    await browser.eval("refresh()");
    assert.equal(browser.document.querySelectorAll("[data-walmart-buy]").length, 1);
    await new Promise((resolve) => setTimeout(resolve, 325));
    assert.equal(browser.document.querySelectorAll("[data-walmart-buy]").length, 0,
      "An expired direct-cart handoff must be removed without waiting for a page refresh.");
  } finally {
    browser.close();
  }
});

function shopperOverviewFixture(overrides: Record<string, unknown> = {}) {
  return {
    actor: {
      displayName: "Shopper Fixture",
      userId: "user_shopper_fixture",
      tenantName: "Fixture tenant",
      roleLabels: ["Shopper"],
      sessionKind: "local",
      signOutUrl: ""
    },
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 0, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] },
    ...overrides
  };
}

test("product cards drop the variant line when the summary is empty and render enum values in sentence case", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#products",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const listing = (id: string, retailerId: string, extra: Record<string, unknown> = {}) => ({
    listingId: id,
    retailerId,
    retailerName: retailerId === "target" ? "Target" : "Walmart",
    retailerSku: `${id}_sku`,
    status: "in_stock",
    executionSupported: true,
    currency: "USD",
    currentPriceCents: 1999,
    msrpCents: 2499,
    canonicalUrl: retailerId === "target" ? "https://www.target.com/p/-/A-95280900" : "https://www.walmart.com/ip/19988614228",
    ...extra
  });
  const groups = [{
    variantId: "variant_plain",
    title: "Plain Fixture",
    imageUrl: "",
    variantAttributes: {},
    currency: "USD",
    storeCount: 1,
    listings: [listing("listing_plain", "walmart", { purchasable: false, observedAvailability: "in_stock", availabilityObservedAt: new Date().toISOString() })]
  }, {
    variantId: "variant_detailed",
    title: "Detailed Fixture",
    imageUrl: "",
    variantAttributes: { edition: "First", color: "Forest" },
    currency: "USD",
    storeCount: 1,
    listings: [listing("listing_detailed", "target", { observedAvailability: "in_stock", availabilityObservedAt: new Date().toISOString() })]
  }];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => shopperOverviewFixture() };
      if (path.startsWith("/api/v1/user/library/products?")) {
        return { ok: true, status: 200, json: async () => ({ items: groups, total: groups.length }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=user-variant-line-test.js`);
    Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function(this: HTMLDialogElement) { this.setAttribute("open", ""); }
    });
    await eventually(() => assert.equal(browser.document.querySelectorAll("#productList .product-card").length, 2));
    const cards = [...browser.document.querySelectorAll("#productList .product-card")] as HTMLElement[];
    const plain = cards.find((card) => card.textContent?.includes("Plain Fixture")) as HTMLElement;
    const detailed = cards.find((card) => card.textContent?.includes("Detailed Fixture")) as HTMLElement;
    assert.equal(plain.querySelector(".product-variant"), null, "an empty variant summary renders no variant paragraph");
    assert.equal(detailed.querySelector(".product-variant")?.textContent, "Color Forest · Edition First");
    assert.equal(plain.querySelector(".product-offer-summary strong")?.className, "warn",
      "a server-side purchasable=false listing is not shown as available even when its status is in stock");
    assert.equal(detailed.querySelector(".product-offer-summary strong")?.className, "good");
    assert.equal(browser.eval('words("out_of_stock")'), "Out of stock");
    assert.equal(browser.eval('words("seen_in_stock")'), "Seen in stock");
    assert.equal(browser.eval('words("version_changed")'), "Version changed");
    assert.equal(browser.eval('listingAvailable({ status: "in_stock", purchasable: false })'), false);
    assert.equal(browser.eval('listingAvailable({ status: "out_of_stock", purchasable: true })'), true);
    assert.equal(browser.eval('listingAvailable({ status: "in_stock" })'), true);
    // Kevin, 2026-10-09: a store checked minutes ago still said "Stock info stale".
    const evidence = (minutes: number, status: string) => JSON.parse(String(browser.eval(`JSON.stringify(listingStockEvidence({ status: "${status}",
      observedAvailability: "${status}", availabilityObservedAt: new Date(Date.now() - ${minutes} * 60000).toISOString() }))`))) as
      { freshness: string; label: string; available: boolean };
    assert.deepEqual(evidence(1, "in_stock"), { ...evidence(1, "in_stock"), freshness: "recent", label: "Reported in stock", available: true });
    assert.deepEqual(evidence(30, "in_stock"), { ...evidence(30, "in_stock"), freshness: "aging", label: "Reported in stock", available: false },
      "half an hour after a check it still shows the status, no longer as available");
    assert.equal(evidence(30, "out_of_stock").label, "Reported sold out");
    assert.equal(evidence(90, "preorder").label, "Reported preorder");
    assert.deepEqual(evidence(150, "in_stock"), { ...evidence(150, "in_stock"), freshness: "stale", label: "Stock info stale", available: false },
      "stale only once it has missed an hourly refresh");
    (plain.querySelector("[data-product-detail]") as HTMLButtonElement).click();
    await eventually(() => assert.equal((browser.document.querySelector("#productDialog") as HTMLDialogElement).open, true));
    const row = browser.document.querySelector("#productDialogBody .detail-row") as HTMLElement;
    assert.equal(row.classList.contains("muted"), true);
    assert.equal(row.querySelector(".tag")?.textContent, "Reported in stock");
    assert.equal(row.querySelector(".tag")?.className, "tag warn");
    // One action per product, whatever the number of stores: Want it.
    for (const card of [plain, detailed]) {
      assert.deepEqual([...card.querySelectorAll("[data-want-listing]")].map((button) => button.textContent?.trim()), ["Want it"]);
    }
    assert.equal(browser.document.querySelector("#quickAddMenu, [data-quick-menu], [data-choose-store]"), null);
  } finally {
    browser.close();
  }
});

test("the header Auto-cart switch explains a blocked turn-on and keeps toggle failures in plain words", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#cart",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const overview = shopperOverviewFixture({
    settings: { actionsPaused: true, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    // A paused shopper with no plans reads "Setting up"; one plan makes it a real pause.
    counts: { products: 1, purchaseIntents: 1, actions: 0, pendingCatalogProposals: 0 },
    guardedAddLanes: { target: false, walmart: false, amazon: false, bestbuy: false }
  }) as unknown as { settings: { actionsPaused: boolean; executionMode: string }; guardedAddLanes: Record<string, boolean> };
  const toggles: Array<Record<string, unknown>> = [];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => overview };
      if (path === "/api/v1/user/settings/actions" && options.method === "PATCH") {
        toggles.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        // The server's resume guard: a plain blocker in details, as app.ts sends it.
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "resume_blocked",
            message: "Turn on cart adds for at least one store before resuming actions.",
            correlationId: "corr_resume_fixture",
            details: {
              blockers: [{
                code: "no_store_ready",
                message: "Turn on cart adds for at least one store before resuming actions.",
                nextAction: { kind: "open_stores", label: "Open Stores", route: "stores" }
              }],
              nextAction: { kind: "open_stores", label: "Open Stores", route: "stores" },
              summary: []
            }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: true, note: "" }) }
  });
  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=user-pause-reason-test.js`);
    const pill = browser.document.querySelector("#modePill") as HTMLElement;
    const pauseButton = browser.document.querySelector("#pauseButton") as HTMLButtonElement;
    const reason = browser.document.querySelector("#pauseReason") as HTMLElement;
    await eventually(() => assert.equal(pill.textContent, "Off"));
    assert.equal(pill.dataset.mobileState, "off");
    assert.equal(pauseButton.getAttribute("role"), "switch");
    assert.equal(pauseButton.getAttribute("aria-checked"), "false");
    assert.equal(pauseButton.getAttribute("aria-label"), "Auto-cart is off");
    assert.equal(pauseButton.getAttribute("aria-describedby"), "pauseReason");
    assert.equal(pauseButton.disabled, true, "Auto-cart waits until one store passes its checks");
    assert.equal(reason.hidden, false);
    assert.equal(reason.textContent, "Turn on a store in Setup before turning on Auto-cart. Open Setup");
    assert.equal(reason.querySelector("[data-resume-next-action]")?.getAttribute("data-resume-route"), "stores");
    assert.equal(pauseButton.title, "Turn on a store in Setup before turning on Auto-cart.");

    overview.guardedAddLanes.target = true;
    await browser.eval("refresh()");
    assert.equal(pauseButton.disabled, false);
    // A deliberate pause is the switch's own state; the header adds no strip.
    assert.equal(reason.hidden, true);
    assert.equal(pauseButton.title, "Off. Calls still alert you.");
    pauseButton.click();
    await eventually(() => assert.equal(toggles.length, 1));
    assert.deepEqual(toggles[0], { paused: false, reason: "Resumed from the user dashboard." });
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Turn on cart adds for at least one store before resuming actions\./));
    assert.doesNotMatch(browser.document.querySelector("#toast")?.textContent ?? "", /retailer lane|qualified|corr_resume_fixture/i);

    overview.settings.actionsPaused = false;
    await browser.eval("refresh()");
    assert.equal(pill.textContent, "On");
    assert.equal(pill.dataset.mobileState, "on");
    assert.equal(pauseButton.getAttribute("aria-checked"), "true");
    assert.equal(reason.hidden, true);
    assert.equal(reason.textContent, "");

    overview.settings.executionMode = "shadow";
    await browser.eval("refresh()");
    assert.equal(pill.textContent, "Test");
    assert.equal(pill.dataset.mobileState, "test");
    assert.equal(pauseButton.disabled, false);
    assert.equal(browser.document.querySelector("#userSignOutLink")?.hasAttribute("href"), false,
      "the sign-out link carries no dead href until the actor supplies one");
  } finally {
    browser.close();
  }
});

test("Cart lists the latest calls with what Yoink did, why, and the one next step", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const call = (id: string, title: string, retailerId: string, result: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id: `signal:${id}`, kind: "signal", listingId: `listing_${id}`, retailerId, retailerSku: id, title,
    canonicalUrl: retailerId === "target" ? `https://www.target.com/p/-/A-${id}` : `https://www.walmart.com/ip/${id}`,
    occurredAt: minutesAgo(3), receivedAt: minutesAgo(3), unitPriceCents: 6499, currency: "USD", actionJobId: "",
    purchaseIntent: null, result: { priceVsMax: "", priceVsMsrp: "", ...result }, ...extra
  });
  const unwanted = {
    kind: "no_action", label: "No action", reason: "Not on your Want list", tone: "muted", fix: "want_it",
    detail: "Target listed it at $64.99, above its $49.99 MSRP. Tap Want it to have Yoink add it to your cart next time."
  };
  const calls = [
    call("95000001", "Unwanted Elite Trainer Box", "target", unwanted),
    // The store re-sent the same restock: it folds into the row above.
    call("95000004", "Unwanted Elite Trainer Box", "target", unwanted, { listingId: "listing_95000001", occurredAt: minutesAgo(4), receivedAt: minutesAgo(4) }),
    call("95000002", "Paused Booster Box", "walmart", {
      kind: "alert", label: "Alert sent", reason: "Cart adds paused", tone: "good", fix: "resume_actions",
      detail: "Cart adds are paused, so Yoink sent an alert instead. Resume them to add to cart."
    }, { purchaseIntent: { id: "mission_paused", status: "active", origin: "user_want", actionCeiling: "add_to_cart", maxUnitPriceCents: 7000 } }),
    call("95000003", "Carted Collection Box", "target", {
      kind: "added", label: "Added to cart", reason: "In your Target cart", tone: "good", fix: "open_cart",
      detail: "Chrome added it and confirmed your Target cart. Check out there before it sells out."
    }, { actionJobId: "job_carted" })
  ];
  const requests: string[] = [];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string) => {
      requests.push(path);
      if (path === "/api/v1/affiliate-routing") return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      if (path === "/api/v1/user/calls?limit=24") return { ok: true, status: 200, json: async () => ({
        items: calls, total: 4, signalTotal: 4, nextSignalOffset: 4, hasMore: false,
        summary: { windowHours: 24, total: 12, added: 1, adding: 0, needsYou: 0, alerts: 2, notAdded: 0, noAction: 9, truncated: false, lastCallAt: minutesAgo(3) }
      }) };
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => ({
        settings: { actionsPaused: true, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
        counts: { products: 3, purchaseIntents: 1, actions: 1, pendingCatalogProposals: 0 },
        sources: [], permissions: [],
        spend: { activeReservationCount: 0, activeReservedCents: 0, spentTodayCents: 0, policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null } },
        walmartDraws: { latestScan: null, items: [] }
      }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=user-dashboard-call-log-test.js`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("#homeCallList .call-log-row").length, 3));
    assert.equal(browser.document.querySelector("#homeCallSummary")?.textContent,
      "Last 24 hours: 12 calls · 1 added · 2 alerts · 9 no action · last call 3 minutes ago.");
    const rows = [...browser.document.querySelectorAll("#homeCallList .call-log-row")] as HTMLElement[];
    assert.deepEqual(rows.map((row) => row.querySelector(".tag")?.textContent), ["No action", "Alert sent", "Added to cart"]);
    assert.deepEqual(rows.map((row) => row.dataset.result), ["no_action", "alert", "added"]);
    assert.match(rows[0]!.textContent ?? "", /Unwanted Elite Trainer Box.*Not on your Want list · Target · \$64\.99 · 3 minutes ago · 2 calls.*above its \$49\.99 MSRP/s);
    // The long explanation stays one tap away.
    assert.equal(rows[0]!.querySelector("details.call-log-why summary")?.textContent, "Why");
    assert.equal(rows[0]!.querySelector("[data-want-listing]")?.textContent?.trim(), "Want it");
    assert.equal(rows[1]!.querySelector("[data-home-resume-actions]")?.textContent?.trim(), "Turn on Auto-cart");
    const cart = rows[2]!.querySelector("a.cart-handoff-link") as HTMLAnchorElement;
    assert.equal(cart.textContent?.trim(), "Open cart ↗");
    assert.equal(new URL(cart.href).searchParams.get("url") ?? cart.href, "https://www.target.com/cart");
    assert.ok(rows.every((row) => [...row.querySelectorAll("a")].some((link) => link.textContent?.trim() === "Store page ↗")),
      "every call links to its store page");
    assert.equal(requests.filter((path) => path.startsWith("/api/v1/user/calls")).length, 1, "Home asks for one page of calls");
  } finally {
    browser.close();
  }
});
