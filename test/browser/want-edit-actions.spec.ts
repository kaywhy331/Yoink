import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { YoinkDatabase } from "../../packages/database/src/database.js";
import { CatalogRepository } from "../../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../../packages/database/src/control-repository.js";
import { PurchasePolicyRepository } from "../../packages/database/src/purchase-policy-repository.js";
import {
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  type Fulfillment,
  type MissionUpdateInput,
  type ProductWantInput,
  type ProductWantMode,
  type SellerPolicy
} from "../../packages/contracts/src/index.js";

// goal_8872722afc83: Want it's Save keeps what the shopper didn't edit, and the
// customer actions 1.30.45 left without a handler work again. Each test runs
// its own in-memory server; a request off that origin is aborted, recorded
// and fails the test.

const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }] as const;
const ACTIVATIONS = ["click", "Enter", "Space"] as const;
const DAY = 86_400_000;
type Store = "target" | "walmart" | "amazon" | "pokemoncenter" | "kohls";

let db: YoinkDatabase;
let server: Server;
let origin: string;
let control: ControlRepository;
let external: string[];
let serial = 100;

test.beforeEach(async ({ page }) => {
  db = new YoinkDatabase();
  control = new ControlRepository(db);
  server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "want-edit-actions-browser-test" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  origin = `http://127.0.0.1:${address.port}`;
  external = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(`${origin}/`)) external.push(request.url());
  });
  await page.route("**/*", (route) => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  page.on("pageerror", (error) => { throw error; });
});

test.afterEach(async () => {
  const leaked = [...external];
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  expect(leaked, "no request leaves the loopback server").toEqual([]);
});

/** A store's listing of one product; listings with the same product name are one item. */
function listing(product: string, retailerId: Store, { cart = false, marketplace = false } = {}): string {
  serial += 1;
  const sku = { target: `95${400_000 + serial}`, walmart: `66${10_000 + serial}`, amazon: `B0WE${100_000 + serial}`,
    pokemoncenter: `10-10${100 + serial}-101`, kohls: `${3_000_000 + serial}` }[retailerId];
  const canonicalUrl = { target: `https://www.target.com/p/-/A-${sku}`, walmart: `https://www.walmart.com/ip/${sku}`,
    amazon: `https://www.amazon.com/dp/${sku}`, pokemoncenter: `https://www.pokemoncenter.com/product/${sku}/fixture`,
    kohls: `https://www.kohls.com/product/prd-${sku}/fixture.jsp` }[retailerId];
  const id = new CatalogRepository(db).upsertListing({
    source: "trackalacker", sourceConnectionId: "source_trackalacker_local", sourceProductId: product,
    sourceListingId: `${product}-${retailerId}-${serial}`, title: product, retailerId, retailerSku: sku, canonicalUrl,
    sellerType: "first_party", listingStatus: "in_stock", observedPriceCents: 4999, msrpCents: 5999, currency: "USD",
    observedAt: new Date(Date.now() - DAY).toISOString()
  }, Date.now() - DAY).listing.id;
  db.run("UPDATE listings SET execution_supported=? WHERE id=?", cart ? 1 : 0, id);
  if (marketplace) db.run("UPDATE listings SET offer_role='alternate', seller_type='third_party' WHERE id=?", id);
  return id;
}

/** A new want, saved as the dashboard's Want it saves one. */
function want(listingId: string, mode: ProductWantMode, maxUnitPriceCents: number): string {
  const input: ProductWantInput = { contractVersion: 1, listingId, mode, maxUnitPriceCents, targetQuantity: 1, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION };
  const preview = control.previewProductWant(input);
  return control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
    previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }).purchaseIntentId;
}

interface MoreOptions {
  status?: "active" | "paused";
  quantity?: number;
  pickupAt?: Store[];
  /** Only these stores on; a marketplace offer is on when `marketplaceOn`. */
  storesOn?: Store[];
  marketplaceOn?: boolean;
  expiresAt?: string;
  cooldownSeconds?: number;
  maxSignalAgeSeconds?: number;
  maxAllInCents?: number;
}

/** What a shopper sets in More options, through the same update it saves. */
function moreOptions(planId: string, choices: MoreOptions): void {
  const targets = db.all<{ id: string; retailerId: Store; enabled: number; max: number | null; seller: SellerPolicy | "inherit";
    fulfillment: Fulfillment | "inherit"; role: string }>(
    `SELECT mt.id, l.retailer_id AS retailerId, mt.enabled, mt.max_unit_price_cents AS max, mt.seller_policy AS seller,
            mt.fulfillment, l.offer_role AS role
     FROM mission_targets mt JOIN listings l ON l.id = mt.listing_id WHERE mt.mission_id = ? ORDER BY mt.id`, planId);
  const planMax = Math.max(...targets.filter((target) => target.enabled === 1).map((target) => Number(target.max)));
  const update: MissionUpdateInput = {
    status: choices.status ?? "active",
    targetQuantity: choices.quantity ?? 1,
    targets: targets.map((target) => {
      const marketplace = target.role !== "primary";
      const enabled = marketplace ? choices.marketplaceOn === true
        : choices.storesOn ? choices.storesOn.includes(target.retailerId) : target.enabled === 1;
      return { id: target.id, enabled, maxUnitPriceCents: enabled ? target.max ?? planMax : target.max,
        sellerPolicy: marketplace && enabled ? "allow_third_party" : target.seller,
        fulfillment: !marketplace && choices.pickupAt?.includes(target.retailerId) ? "pickup" : target.fulfillment };
    }),
    policy: {
      expectedRevision: new PurchasePolicyRepository(db).current(planId)!.revision,
      changeReason: "Set in More options (fixture).",
      ...(choices.expiresAt ? { expiresAt: choices.expiresAt } : {}),
      ...(choices.cooldownSeconds !== undefined ? { cooldownSeconds: choices.cooldownSeconds } : {}),
      ...(choices.maxSignalAgeSeconds !== undefined ? { maxSignalAgeSeconds: choices.maxSignalAgeSeconds } : {}),
      ...(choices.maxAllInCents !== undefined ? { maxAllInCents: choices.maxAllInCents } : {})
    }
  };
  control.updateMission(planId, update);
}

/** Everything an unedited Save must leave alone, timestamps aside. */
function snapshot(planId: string) {
  return {
    plan: db.get("SELECT status, target_quantity AS quantity, origin FROM missions WHERE id=?", planId),
    stores: db.all(`SELECT l.retailer_id AS store, l.offer_role AS role, mt.enabled, mt.max_unit_price_cents AS max,
                           mt.seller_policy AS seller, mt.fulfillment
                    FROM mission_targets mt JOIN listings l ON l.id = mt.listing_id WHERE mt.mission_id=? ORDER BY mt.id`, planId),
    policy: db.get(`SELECT revision, action_ceiling AS mode, decision_mode AS decisionMode, max_all_in_cents AS maxAllIn,
                           expires_at AS expiresAt, cooldown_seconds AS cooldown, max_signal_age_seconds AS signalAge,
                           substitution_policy AS substitution
                    FROM mission_intent_revisions WHERE mission_id=? ORDER BY revision DESC LIMIT 1`, planId)
  };
}

interface WantPreview { requestedMode: string; maxUnitPriceCents: number; priceRule: string; targetQuantity: number;
  previewFingerprint: string; previewedAt: string; summary: string; canSave: boolean }

/** The shopper API as the Want it editor calls it: check, then save what the check showed. A new max is checked first. */
async function saveThroughApi(page: Page, listingId: string, mode: ProductWantMode, maxUnitPriceCents?: number): Promise<WantPreview> {
  return page.evaluate(async ({ listingId, mode, maxUnitPriceCents, previewConfirmation, saveConfirmation }) => {
    const call = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Yoink-Request": "1" }, body: JSON.stringify(body) });
      const result = await response.json() as { preview: WantPreview };
      if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
      return result.preview;
    };
    let preview = await call("/api/v1/user/purchase-intents/want/preview", { contractVersion: 1, listingId, mode, confirmation: previewConfirmation });
    const rule = (checked: WantPreview) => mode === "add_to_cart" && checked.priceRule ? { priceRule: checked.priceRule } : {};
    if (maxUnitPriceCents !== undefined) {
      preview = await call("/api/v1/user/purchase-intents/want/preview", { contractVersion: 1, listingId, mode, maxUnitPriceCents,
        ...rule(preview), targetQuantity: preview.targetQuantity, confirmation: previewConfirmation });
    }
    await call("/api/v1/user/purchase-intents/want", { contractVersion: 1, listingId, mode: preview.requestedMode,
      maxUnitPriceCents: preview.maxUnitPriceCents, ...rule(preview), targetQuantity: preview.targetQuantity,
      confirmation: saveConfirmation, previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt });
    return preview;
  }, { listingId, mode, maxUnitPriceCents, previewConfirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION, saveConfirmation: PRODUCT_WANT_SAVE_CONFIRMATION });
}

test("an unedited Save through the API changes nothing the Want it form doesn't show", async ({ page }) => {
  const ends = new Date(Date.now() + 7 * DAY).toISOString();
  const cases: Array<{ name: string; mode: ProductWantMode; stores: Store[]; cart?: boolean; marketplace?: boolean; max: number; choices: MoreOptions }> = [
    { name: "Paused alerts for 12 with pickup", mode: "notify", stores: ["target", "walmart"], max: 4999,
      choices: { status: "paused", quantity: 12, pickupAt: ["target"], expiresAt: ends, cooldownSeconds: 600, maxSignalAgeSeconds: 300, maxAllInCents: 70_000 } },
    { name: "Alerts for 1", mode: "notify", stores: ["target"], max: 2999, choices: { quantity: 1 } },
    { name: "Alerts for 10", mode: "notify", stores: ["walmart"], max: 2999, choices: { quantity: 10 } },
    { name: "Paused cart for 99 with pickup", mode: "add_to_cart", stores: ["pokemoncenter"], cart: true, max: 500,
      choices: { status: "paused", quantity: 99, pickupAt: ["pokemoncenter"], expiresAt: ends, maxAllInCents: 80_000 } },
    { name: "Cart for 12 at two stores", mode: "add_to_cart", stores: ["pokemoncenter", "kohls"], cart: true, max: 500,
      choices: { quantity: 12, pickupAt: ["kohls"], cooldownSeconds: 1800, maxAllInCents: 20_000 } },
    { name: "Alerts at one of three stores plus a marketplace offer", mode: "notify", stores: ["target", "walmart", "amazon"], marketplace: true, max: 3999,
      choices: { storesOn: ["walmart"], marketplaceOn: true, maxSignalAgeSeconds: 900 } }
  ];
  await page.goto(`${origin}/#find`);
  for (const item of cases) {
    const ids = item.stores.map((retailerId) => listing(item.name, retailerId, { cart: item.cart === true }));
    if (item.marketplace) listing(item.name, "walmart", { marketplace: true });
    const planId = want(ids[0]!, item.mode, item.max);
    moreOptions(planId, item.choices);
    const before = snapshot(planId);
    const preview = await saveThroughApi(page, ids[0]!, item.mode);
    expect(preview.targetQuantity, item.name).toBe(item.choices.quantity ?? 1);
    expect(snapshot(planId), `${item.name}: an unedited Save is a no-op, revision included`).toEqual(before);
  }
});

test("changing only the max moves only the stores' max and the derived reserve", async ({ page }) => {
  const ends = new Date(Date.now() + 7 * DAY).toISOString();
  await page.goto(`${origin}/#find`);
  const alerts = [listing("Price only alerts", "target"), listing("Price only alerts", "walmart"), listing("Price only alerts", "amazon")];
  const alertPlan = want(alerts[0]!, "notify", 4999);
  moreOptions(alertPlan, { status: "paused", quantity: 12, pickupAt: ["target"], storesOn: ["target", "walmart"], expiresAt: ends,
    cooldownSeconds: 600, maxSignalAgeSeconds: 300, maxAllInCents: 70_000 });
  const before = snapshot(alertPlan);
  await saveThroughApi(page, alerts[0]!, "notify", 3999);
  const after = snapshot(alertPlan);
  expect(after).toEqual({
    plan: before.plan,
    stores: (before.stores as Array<{ enabled: number; max: number | null }>).map((store) => store.enabled ? { ...store, max: 3999 } : store),
    policy: { ...before.policy as object, revision: (before.policy as { revision: number }).revision + 1, maxAllIn: 3999 * 12 }
  });

  const cart = [listing("Price only cart", "pokemoncenter", { cart: true }), listing("Price only cart", "kohls", { cart: true })];
  const cartPlan = want(cart[0]!, "add_to_cart", 500);
  moreOptions(cartPlan, { quantity: 12, pickupAt: ["kohls"], cooldownSeconds: 1800, maxAllInCents: 20_000 });
  const cartBefore = snapshot(cartPlan);
  await saveThroughApi(page, cart[0]!, "add_to_cart", 450);
  const settings = control.settings();
  const reserve = Math.max(...["pokemoncenter", "kohls"].map((retailerId) =>
    Math.ceil(450 * 12 * (10_000 + settings.taxBps) / 10_000) + Number(settings.storeAllowancesCents[retailerId] ?? 0)));
  expect(snapshot(cartPlan)).toEqual({
    plan: cartBefore.plan,
    stores: (cartBefore.stores as Array<{ enabled: number; max: number | null }>).map((store) => store.enabled ? { ...store, max: 450 } : store),
    policy: { ...cartBefore.policy as object, revision: (cartBefore.policy as { revision: number }).revision + 1, maxAllIn: reserve }
  });
});

for (const viewport of VIEWPORTS) {
  test(`the audit case (paused, 12, pickup, an end date) survives an unedited Save in the editor at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const ids = [listing("Audit Want Fixture", "target"), listing("Audit Want Fixture", "walmart")];
    const planId = want(ids[0]!, "notify", 4999);
    moreOptions(planId, { status: "paused", quantity: 12, pickupAt: ["target"], expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
      cooldownSeconds: 600, maxSignalAgeSeconds: 300, maxAllInCents: 70_000 });
    const before = snapshot(planId);
    await page.goto(`${origin}/#find`);
    await page.getByRole("button", { name: "Yoink: Audit Want Fixture — edit saved choices" }).click();
    const dialog = page.locator("#wantDialog");
    await expect(dialog.locator("#wantSave")).toBeEnabled();
    await expect(dialog.locator('[name="wantQuantity"]')).toHaveValue("12");
    const choices = dialog.locator("#wantChoices");
    await expect(choices).toContainText("Store pickup at Target, Shipping at Walmart");
    await expect(choices).toContainText("Ends ");
    await expect(choices).toContainText("Paused. Save keeps these. Change them in More options.");
    await expect(choices).not.toContainText("Sold by the store itself · Shipping ·");
    await expect(dialog.locator("#wantSummary")).toContainText("It's paused, and saving keeps it paused.");
    await page.screenshot({ path: testInfo.outputPath(`audit-editor-${viewport.width}x${viewport.height}.png`), fullPage: true });
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/v1/user/purchase-intents/want") && response.request().method() === "POST");
    await dialog.locator("#wantSave").click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).not.toBeVisible();
    expect(snapshot(planId)).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`audit-saved-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });

  test(`each named customer action acts once by click, Enter and Space at ${viewport.width}x${viewport.height}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    const phone = viewport.width < 700;
    const ids = [listing("Action Fixture One", "target"), listing("Action Fixture Two", "walmart")];
    const pairingCodes = () => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM device_pairing_codes")!.n;
    const posted: string[] = [];
    page.on("request", (request) => { if (request.method() === "POST") posted.push(new URL(request.url()).pathname); });
    const posts = (path: string) => posted.filter((item) => item === path).length;
    const press = async (target: Locator, how: typeof ACTIVATIONS[number]) => {
      if (how === "click") await target.click();
      else { await target.focus(); await page.keyboard.press(how === "Enter" ? "Enter" : "Space"); }
    };
    const closeDialog = (id: string) => page.evaluate((dialogId) => (document.getElementById(dialogId) as HTMLDialogElement).close(), id);
    // Lets a duplicate request land before counting.
    const settle = () => page.waitForTimeout(250);

    // First use: Home offers Choose a product and the Notify only / Add to cart choice.
    for (const how of ACTIVATIONS) {
      await page.goto(`${origin}/#cart`);
      await press(page.locator('[data-setup-action="choose_product"]'), how);
      await expect(page).toHaveURL(/#find/);
      await expect(page.locator("#productList [data-want-listing]").first()).toBeFocused();
    }
    await page.goto(`${origin}/#cart`);
    for (const [how, intent] of [["click", "notify"], ["Enter", "add_to_cart"], ["Space", "notify"]] as const) {
      await press(page.locator(`[data-first-plan-intent="${intent}"]`), how);
      await expect(page.locator(`[data-first-plan-intent="${intent}"]`)).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("yoinkFirstPlanIntent:"))
        .map((key) => (JSON.parse(sessionStorage.getItem(key) || "{}") as { intent?: string }).intent))).toEqual([intent]);
    }
    await page.screenshot({ path: testInfo.outputPath(`home-first-use-${size}.png`), fullPage: true });

    // Setup › Browser › Create pairing code: one code per press, in this disposable account only.
    await page.goto(`${origin}/#setup/chrome`);
    for (const how of ACTIVATIONS) {
      const codes = pairingCodes();
      const requests = posts("/api/v1/user/devices/pairing-code");
      await press(page.locator("#pairButton"), how);
      await expect(page.locator("#pairing")).toContainText("One-time code");
      await expect.poll(pairingCodes).toBe(codes + 1);
      await settle();
      expect(pairingCodes(), `Setup › Browser › Create pairing code by ${how}`).toBe(codes + 1);
      expect(posts("/api/v1/user/devices/pairing-code")).toBe(requests + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`setup-pairing-${size}.png`), fullPage: true });

    // Find: Add product link and its Check link, then Details.
    await page.goto(`${origin}/#find`);
    for (const how of ACTIVATIONS) {
      await press(page.locator("#addProductButton"), how);
      const linkDialog = page.locator("#productLinkDialog");
      await expect(linkDialog).toBeVisible();
      await linkDialog.locator('[name="url"]').fill("https://www.target.com/p/-/A-95999999");
      const checks = posts("/api/v1/user/catalog/link-preview");
      await press(page.locator("#checkProductLinkButton"), how);
      await expect(page.locator("#productLinkPreview")).toContainText("Product link recognized");
      await settle();
      expect(posts("/api/v1/user/catalog/link-preview"), `Check link by ${how}`).toBe(checks + 1);
      if (how === "click") await page.screenshot({ path: testInfo.outputPath(`add-product-link-${size}.png`), fullPage: true });
      await closeDialog("productLinkDialog");

      await press(page.locator("#productList .card-actions [data-product-detail]").first(), how);
      await expect(page.locator("#productDialog")).toBeVisible();
      await expect(page.locator("#productDialog")).toContainText("Action Fixture");
      if (how === "click") await page.screenshot({ path: testInfo.outputPath(`details-${size}.png`), fullPage: true });
      await closeDialog("productDialog");
    }

    // Clear search and filters, from a Find link with a search and In stock only.
    for (const how of ACTIVATIONS) {
      await page.goto(`${origin}/#find?q=zzz&availability=in_stock`);
      const clear = page.locator("[data-clear-browse]");
      await expect(clear).toBeVisible();
      if (how === "click") await page.screenshot({ path: testInfo.outputPath(`find-empty-${size}.png`), fullPage: true });
      await press(clear, how);
      await expect(page.locator("#productList .card-actions [data-product-detail]")).toHaveCount(2);
      await expect(page.locator("#productSearch")).toHaveValue("");
      await expect(page.locator("#inStockOnly")).not.toBeChecked();
      await expect(page).not.toHaveURL(/q=|availability=/);
    }

    // With a plan saved: Home › Create pairing code, and on a phone the desktop setup link.
    want(ids[0]!, "notify", 2999);
    for (const how of ACTIVATIONS) {
      await page.goto(`${origin}/#cart`);
      await page.reload();
      const codes = pairingCodes();
      await press(page.locator('[data-setup-action="pair_companion"]'), how);
      await expect(page).toHaveURL(/#setup\/chrome/);
      await expect(page.locator("#pairing")).toContainText("One-time code");
      await expect.poll(pairingCodes).toBe(codes + 1);
      await settle();
      expect(pairingCodes(), `Home › Create pairing code by ${how}`).toBe(codes + 1);
    }
    await page.goto(`${origin}/#cart`);
    await page.reload();
    if (phone) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      for (const how of ACTIVATIONS) {
        await page.evaluate(() => navigator.clipboard.writeText(""));
        await press(page.locator('[data-setup-action="desktop_handoff"]'), how);
        await expect(page.locator("[data-desktop-link] input")).toHaveValue(`${origin}/#cart`);
        await expect(page.locator("#toast")).toContainText("Desktop setup link copied. Sign in to the same account.");
        expect(await page.evaluate(() => navigator.clipboard.readText()), `Copy desktop setup link by ${how}`).toBe(`${origin}/#cart`);
      }
      await page.screenshot({ path: testInfo.outputPath(`home-desktop-link-${size}.png`), fullPage: true });
    } else {
      // A desktop browser needs no desktop handoff.
      await expect(page.locator('[data-setup-action="pair_companion"]')).toBeVisible();
      await expect(page.locator('[data-setup-action="desktop_handoff"]')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`home-pairing-${size}.png`), fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
