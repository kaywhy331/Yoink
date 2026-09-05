import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SignalProviderRepository } from "../packages/database/src/signal-provider-repository.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 300): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test("Connections gives Discord, API, and TrackaLacker a concrete next step", async () => {
  const db = new YoinkDatabase();
  const providers = new SignalProviderRepository(db);
  const discord = providers.createChannel({
    provider: "discord",
    name: "Collector alerts",
    externalReference: "112233445566778899",
    trustLevel: "informational"
  });
  providers.createChannel({
    provider: "api",
    name: "Private API feed",
    externalReference: "operations:primary-feed",
    trustLevel: "informational"
  });
  db.run("UPDATE signal_provider_channels SET last_error_code = 'client_not_installed', rejected_event_count = 1 WHERE id = ?", discord.id);

  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-source-setup-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#sources/channels`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  let copied = "";
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    })
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "setTimeout", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(browser.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value: string) => { copied = value; } }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("#sourceChannelList .card").length, 2));

    const discordCard = browser.document.querySelector(`[data-source-channel-status="${discord.id}"]`)?.closest(".card") as HTMLElement;
    assert.match(discordCard.textContent ?? "", /Client pending/);
    assert.match(discordCard.textContent ?? "", /Not connected yet: client pending/);
    assert.match(discordCard.textContent ?? "", /invite it to the server/);
    assert.doesNotMatch(discordCard.querySelector(".card-top")?.textContent ?? "", /attention/i);
    assert.equal(browser.document.querySelector("#sourceChannelGate")?.textContent, "OK");

    const apiCard = [...browser.document.querySelectorAll<HTMLElement>("#sourceChannelList .card")]
      .find((card) => /Private API feed/.test(card.textContent ?? ""));
    assert.ok(apiCard);
    assert.match(apiCard.textContent ?? "", /operator must provision the authenticated sender/);
    assert.ok(apiCard.querySelector('a[href="/docs#api-sources"]'));

    assert.match(browser.document.querySelector("#connectionList")?.textContent ?? "", /Next:/);
    assert.match(browser.document.querySelector("#connectionList")?.textContent ?? "", /Connect from the Yoink extension/);
    assert.equal((browser.document.querySelector('#sourceChannelProvider option[value="discord"]') as HTMLOptionElement).disabled, true);
    assert.equal(browser.document.querySelector("#sourceChannelReferenceLabel")?.textContent, "API key reference");

    const provider = browser.document.querySelector("#sourceChannelProvider") as HTMLSelectElement;
    provider.value = "api";
    provider.dispatchEvent(new browser.Event("change", { bubbles: true }));
    assert.equal(browser.document.querySelector("#sourceChannelReferenceLabel")?.textContent, "API key reference");
    assert.equal((browser.document.querySelector("#sourceChannelReference") as HTMLInputElement).placeholder, "operations:primary-feed");

    const guide = browser.document.querySelector('a[href="/docs#trackalacker"]') as HTMLAnchorElement;
    assert.ok(guide);
    (browser.document.querySelector("#copyTrackalackerInstructions") as HTMLButtonElement).click();
    await eventually(() => assert.match(copied, /Choose Reconnect/));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /instructions copied/i));
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
