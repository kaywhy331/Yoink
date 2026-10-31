import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESTOCK_RETRY_DEFAULTS, RESTOCK_RETRY_LIMITS } from "../../packages/contracts/src/index.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
export type Request = { path: string; method: string; body?: Record<string, unknown> };
export async function eventually(assertion: () => void, attempts = 40): Promise<void> {
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

export async function adminBrowser(options: {
  route?: string;
  policy?: { enabled: boolean; attempts: number; windowMinutes: number };
  respond?: (request: Request) => Promise<{ status: number; body: unknown } | undefined>;
} = {}) {
  const web = join(process.cwd(), "apps/web");
  const dom = new JSDOM(readFileSync(join(web, "index.html"), "utf8"), {
    url: `http://127.0.0.1:32991/admin#${options.route || "settings/automation"}`,
    runScripts: "outside-only", pretendToBeVisual: true
  });
  const browser = dom.window as Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  const requests: Request[] = [];
  const snapshot: Record<string, any> = {
    version: "admin-restoration-fixture", permissions: ["admin.read", "qualification.manage"],
    settings: { actionsPaused: true, executionMode: "test", restockRetry: { ...RESTOCK_RETRY_DEFAULTS, ...options.policy } },
    restockRetryLimits: structuredClone(RESTOCK_RETRY_LIMITS),
    actor: { displayName: "Administrator", roleLabels: ["Administrator"], sessionKind: "local" },
    counts: { onlineDevices: 1 }, capabilities: {}, trackalacker: {}, sources: [], strategies: [],
    devices: [], shadowObservations: [], shadowDiagnostics: [], adapterRepairQueue: [],
    targetQualification: { qualificationEvidenceReady: true, checks: [] },
    walmartQualification: { qualificationEvidenceReady: true, checks: [] }
  };
  Object.defineProperty(browser, "fetch", { configurable: true, value: async (path: string, init: {method?: string; body?: string} = {}) => {
    const request: Request = { path, method: init.method || "GET", ...(init.body ? { body: JSON.parse(init.body) } : {}) };
    requests.push(request);
    let response = await options.respond?.(request);
    if (!response && path.startsWith("/api/v1/admin/snapshot?")) response = { status: 200, body: { ...snapshot, view: new URL(path, browser.location.href).searchParams.get("view") } };
    if (!response && path === "/api/v1/admin/settings/restock-retry") {
      snapshot.settings.restockRetry = request.body;
      response = { status: 200, body: { settings: structuredClone(snapshot.settings) } };
    }
    if (!response && path === "/api/v1/admin/discord") response = { status: 200, body: { settings: { enabled: false }, channels: [] } };
    response ||= { status: 200, body: { items: [], total: 0, channels: [], settings: {}, policies: [], stores: [], windows: [], patterns: [] } };
    const saved = structuredClone(response.body);
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => saved };
  } });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", { configurable: true, value: { escape: (s: string) => s } });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  for (const file of ["status.js", "dialogs.js"]) browser.eval(readFileSync(join(web, file), "utf8"));
  const app = await browser.eval(`(async () => { ${readFileSync(join(web, "app.js"), "utf8")}\nreturn { refresh }; })()`) as { refresh(reload: boolean): Promise<void> };
  await eventually(() => assert.ok(requests.some(request => request.path.startsWith("/api/v1/admin/snapshot?"))));
  return { browser, requests, snapshot,
    refresh: async () => { await app.refresh(false); },
    close: () => browser.close()
  };
}
