import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";

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

test("Access creates and supports a shopper through subject-bound pairing and user detail tabs", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({
    db,
    webRoot,
    version: "admin-user-dashboard-test",
    requestScopeResolver: async (_request, context = {}) => {
      const pairingCode = (context.body as { pairingCode?: unknown } | undefined)?.pairingCode;
      if (pairingCode !== undefined) {
        const subject = new DeviceRepository(db).resolvePairingCodeScope(pairingCode);
        if (subject) {
          return {
            tenantId: subject.tenantId,
            userId: subject.userId,
            actorKind: "user" as const,
            actorId: subject.userId
          };
        }
      }
      return LOCAL_REQUEST_SCOPE;
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#access`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
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
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  const confirmations: Array<Record<string, unknown>> = [];
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async (options: Record<string, unknown>) => {
      confirmations.push(options);
      return { confirmed: true, note: "" };
    } }
  });
  const dialogPrototype = browser.HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value: function close(this: HTMLDialogElement) { this.removeAttribute("open"); }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.match(browser.document.querySelector("#authorizationUserList")?.textContent ?? "", /Local user/i));

    (browser.document.querySelector("#createAdminUserButton") as HTMLButtonElement).click();
    assert.equal(browser.document.querySelector("#adminUserCreateDialog")?.hasAttribute("open"), true);
    const createForm = browser.document.querySelector("#adminUserCreateForm") as HTMLFormElement;
    (createForm.elements.namedItem("displayName") as HTMLInputElement).value = "Support Test Shopper";
    createForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));

    await eventually(() => assert.equal(browser.document.querySelector("#adminUserDialog")?.hasAttribute("open"), true));
    assert.equal(browser.document.querySelector("#adminUserDialogTitle")?.textContent, "Support Test Shopper");
    assert.equal(browser.document.querySelectorAll("[data-admin-user-tab]").length, 4);
    assert.match(browser.document.querySelector("#adminUserSupportActions")?.textContent ?? "", /Issue pairing code/);
    assert.match(browser.document.querySelector("#adminUserSupportActions")?.textContent ?? "", /Resume actions/);
    assert.match(browser.document.querySelector("#adminUserSupportActions")?.textContent ?? "", /Grant role/);

    (browser.document.querySelector("[data-admin-user-pairing]") as HTMLButtonElement).click();
    await eventually(() => assert.equal((browser.document.querySelector("#adminUserPairing") as HTMLElement).hidden, false));
    const pairingCode = browser.document.querySelector("#adminUserPairing strong")?.textContent ?? "";
    assert.match(pairingCode, /^[A-Z0-9-]{8,}$/);
    const createdUser = db.get<{ id: string }>("SELECT id FROM users WHERE display_name = ?", "Support Test Shopper");
    assert.ok(createdUser?.id);
    assert.equal(browser.location.hash, `#access/user/${createdUser.id}`);

    const pairResponse = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { Origin: `chrome-extension://${"a".repeat(32)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        pairingCode,
        name: "Support shopper Chrome",
        extensionVersion: "1.18.1",
        capabilities: { observe: true, notify: true, addToCart: true }
      })
    });
    const pairBody = await pairResponse.text();
    assert.equal(pairResponse.status, 201, pairBody);
    assert.equal(db.get<{ userId: string }>(
      "SELECT user_id AS userId FROM extension_devices WHERE name = ?",
      "Support shopper Chrome"
    )?.userId, createdUser.id);

    (browser.document.querySelector("#adminUserDialog [data-close-dialog]") as HTMLButtonElement).click();
    // The drawer was opened by pushState, so closing it goes back to the Users entry.
    await eventually(() => assert.equal(browser.location.hash, "#access"));
    const shopperRow = [...browser.document.querySelectorAll<HTMLButtonElement>("[data-admin-user-open]")]
      .find((row) => /Support Test Shopper/.test(row.textContent ?? ""));
    assert.ok(shopperRow);
    shopperRow.click();
    await eventually(() => assert.equal(browser.document.querySelector("#adminUserDialog")?.hasAttribute("open"), true));
    assert.equal(browser.location.hash, `#access/user/${createdUser.id}`);
    (browser.document.querySelector('[data-admin-user-tab="devices"]') as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#adminUserDetailContent")?.textContent ?? "", /Support shopper Chrome/));
    assert.match(browser.document.querySelector("#adminUserDetailContent")?.textContent ?? "", /Online/);

    const actionToggle = () => browser.document.querySelector("[data-admin-user-pause]") as HTMLButtonElement;
    assert.equal(actionToggle().textContent, "Resume actions");
    actionToggle().click();
    await eventually(() => assert.equal(db.get<{ paused: number }>(
      "SELECT actions_paused AS paused FROM app_settings WHERE user_id = ?",
      createdUser.id
    )?.paused, 0));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /actions resumed/i));
    assert.equal(actionToggle().textContent, "Pause actions");
    actionToggle().click();
    await eventually(() => assert.equal(db.get<{ paused: number }>(
      "SELECT actions_paused AS paused FROM app_settings WHERE user_id = ?",
      createdUser.id
    )?.paused, 1));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /actions paused/i));
    assert.equal(confirmations.length, 1);
    assert.match(String(confirmations[0]?.title || ""), /Pause actions for Support Test Shopper/);

    (browser.document.querySelector("[data-admin-user-role-grant]") as HTMLButtonElement).click();
    await eventually(() => assert.ok(browser.document.querySelector("[data-admin-user-role-revoke]")));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Role membership granted/i));
    const revokeRole = browser.document.querySelector("[data-admin-user-role-revoke]") as HTMLButtonElement;
    const revokedRoleId = revokeRole.dataset.adminUserRoleRevoke;
    assert.ok(revokedRoleId);
    revokeRole.click();
    await eventually(() => assert.equal(db.get<{ status: string }>(
      "SELECT status FROM authorization_memberships WHERE user_id = ? AND role_id = ?",
      createdUser.id,
      revokedRoleId
    )?.status, "revoked"));
    // The DB write precedes the async refresh. Wait for the completed UI operation
    // before disabling the user or closing the DOM.
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Role membership revoked/i));
    assert.match(String(confirmations.at(-1)?.title || ""), /Revoke/);

    const disable = browser.document.querySelector('[data-admin-user-status="disabled"]') as HTMLButtonElement;
    disable.click();
    assert.equal(disable.textContent, "Confirm disable");
    disable.click();
    await eventually(() => assert.equal(db.get<{ status: string }>(
      "SELECT status FROM users WHERE id = ?",
      createdUser.id
    )?.status, "disabled"));
    await eventually(() => {
      assert.equal(browser.document.querySelector("#adminUserDialogStatus")?.textContent, "Disabled user");
      assert.equal(db.get<{ status: string }>(
        "SELECT status FROM extension_devices WHERE user_id = ?",
        createdUser.id
      )?.status, "revoked");
      assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /disabled/i);
    });
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
