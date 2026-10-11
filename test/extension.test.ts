import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the Chrome companion gates optional retailer access and isolates each add-only runner", () => {
  const extensionRoot = join(process.cwd(), "apps", "extension");
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
  const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8")) as {
    manifest_version: number;
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    content_scripts?: unknown;
    background?: { service_worker?: string };
    options_ui?: { page?: string; open_in_tab?: boolean };
    version?: string;
  };
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.permissions, ["activeTab", "alarms", "contextMenus", "notifications", "offscreen", "storage", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1/*"]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://www.target.com/*",
    "https://trackalacker.com/*",
    "https://www.trackalacker.com/*",
    "https://*.amazon.com/*",
    "https://*.walmart.com/*",
    "https://*.bestbuy.com/*",
    "https://www.disneystore.com/*",
    "https://*.ravensburger.us/*",
    "https://merch.riotgames.com/*",
    "https://*.booksamillion.com/*",
    "https://*.fanatics.com/*",
    "https://*.kohls.com/*",
    "https://*.macys.com/*",
    "https://*.p-bandai.com/*",
    "https://*.pokemoncenter.com/*",
    "https://eshop.asus.com/*",
    "https://athleta.gap.com/*",
    "https://secure-athleta.gap.com/*",
    "https://*.ae.com/*",
    "https://*.aninebing.com/*",
    "https://www.audioadvice.com/*",
    "https://bananarepublic.gap.com/*",
    "https://secure-bananarepublic.gap.com/*",
    "https://bananarepublicfactory.gapfactory.com/*",
    "https://secure-bananarepublicfactory.gapfactory.com/*"
  ]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background?.service_worker, "background.js");
  assert.deepEqual(manifest.options_ui, { page: "options.html", open_in_tab: true });
  assert.equal(manifest.host_permissions.includes("https://*.amazon.com/*"), false);
  assert.equal(manifest.host_permissions.includes("https://www.target.com/*"), false);
  assert.equal(manifest.host_permissions.includes("https://*.walmart.com/*"), false);

  for (const file of ["background.js", "popup-state.js", "popup.js", "options.js", "runtime-config.js", "trackalacker-push.js", "trackalacker-sync.js", "observer-recipe-root.js", "observer-recipe-oracle.js", "offscreen.js"]) {
    const result = spawnSync(process.execPath, ["--check", join(extensionRoot, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const background = readFileSync(join(extensionRoot, "background.js"), "utf8");
  const popup = readFileSync(join(extensionRoot, "popup.js"), "utf8");
  const popupState = readFileSync(join(extensionRoot, "popup-state.js"), "utf8");
  const popupHtml = readFileSync(join(extensionRoot, "popup.html"), "utf8");
  const runtimeConfig = readFileSync(join(extensionRoot, "runtime-config.js"), "utf8");
  const targetBundle = readFileSync(join(extensionRoot, "target-shadow.js"), "utf8");
  const targetActionBundle = readFileSync(join(extensionRoot, "target-action.js"), "utf8");
  const walmartActionBundle = readFileSync(join(extensionRoot, "walmart-action.js"), "utf8");
  const amazonActionBundle = readFileSync(join(extensionRoot, "amazon-action.js"), "utf8");
  const bestBuyActionBundle = readFileSync(join(extensionRoot, "bestbuy-action.js"), "utf8");
  const retailerBundle = readFileSync(join(extensionRoot, "retailer-shadow.js"), "utf8");
  const observerRecipeOracle = readFileSync(join(extensionRoot, "observer-recipe-oracle.js"), "utf8");
  const trackalackerPush = readFileSync(join(extensionRoot, "trackalacker-push.js"), "utf8");
  const observerRecipeRoot = readFileSync(join(extensionRoot, "observer-recipe-root.js"), "utf8");
  assert.match(background, /setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
  assert.match(background, /jobs\/next/);
  assert.match(background, /targetAddAdapterVersion/);
  assert.match(background, /walmartAddAdapterVersion/);
  assert.match(background, /amazonAddAdapterVersion/);
  assert.match(background, /bestBuyAddAdapterVersion/);
  assert.match(background, /communityReadOnlyEvidence: true/);
  assert.match(background, /exactSelectedOfferEvidence: true/);
  assert.match(background, /observerRecipeShadow: true/);
  assert.match(background, /observerRecipePackagedOracle: true/);
  assert.match(background, /observerRecipeRecoveryEvidence: true/);
  assert.match(background, /durableAdapterDiagnostics: true/);
  assert.match(background, /privacyBoundedRepairLandmarks: true/);
  assert.match(background, /rotatableDeviceCredentials: true/);
  assert.match(background, /productionTransportProfile:/);
  assert.match(background, /managedExtensionUpdates:/);
  assert.match(background, /importScripts\("runtime-config\.js"/);
  assert.match(background, /credential-rotation\/begin/);
  assert.match(background, /credential-rotation\/commit/);
  assert.match(background, /pendingCredential/);
  assert.match(background, /walmartDrawReadOnly: true/);
  assert.match(background, /yoink:inspect-walmart-draw/);
  assert.match(background, /yoink:inspect-and-qualify/);
  assert.match(background, /chrome\.contextMenus\.onClicked/);
  assert.match(background, /classifyPageContext/);
  assert.match(background, /devices\/self\/walmart-draw\/scans/);
  assert.doesNotMatch(background, /draw\.www\.walmart\.com|\/draw\/enter/);
  assert.match(background, /Ed25519/);
  assert.match(background, /observer-recipe-trials/);
  assert.match(background, /observer-recipe-root\.js/);
  assert.match(background, /observer-recipe-oracle\.js/);
  assert.match(background, /packaged_structured_oracle_v1/);
  assert.match(background, /contractVersion: 3/);
  assert.match(background, /recoveryEvidence/);
  assert.match(background, /yoinkObserverRecipeTrustStateV1/);
  assert.doesNotMatch(background, /const OBSERVER_RECIPE_KEY_PIN/);
  assert.match(background, /yoink:contribute-retailer/);
  assert.doesNotMatch(background, /console\./);
  assert.match(background, /world: "ISOLATED"/);
  assert.match(background, /world: "MAIN"/);
  assert.match(background, /shadow-observations\/target/);
  assert.match(background, /sources\/trackalacker\/signals/);
  assert.match(background, /signals\/batch/);
  assert.match(background, /idempotencyKey: envelope\.signalId/);
  assert.match(background, /trackalacker-sync\.js/);
  assert.match(background, /retailerMutation: false/);
  assert.match(background, /high_demand/);
  assert.match(background, /Sign in to Best Buy in this tab, confirm your location/);
  assert.match(background, /Complete the visible Best Buy security check/);
  assert.doesNotMatch(background, /\.click\s*\(|dispatchEvent\s*\(/);
  assert.match(popup, /chrome\.permissions\.request/);
  assert.doesNotMatch(popup, /chrome\.permissions\.remove/);
  assert.match(popup, /yoink:contribute-retailer/);
  assert.match(popup, /yoink:inspect-walmart-draw/);
  assert.match(popup, /yoink:inspect-and-qualify/);
  assert.match(popup, /derivePopupView/);
  assert.match(popup, /classifyPageContext/);
  assert.match(popupState, /derivePopupView/);
  assert.match(popupState, /deriveContextMenuCommands/);
  assert.match(popup, /POPUP_RUNTIME_CONFIG\.appOrigin/);
  assert.doesNotMatch(popup, /http:\/\/127\.0\.0\.1:32991/);
  assert.doesNotMatch(popupHtml, /Checking local app/);
  assert.match(popupHtml, /id="primaryAction"/);
  assert.match(popupHtml, /id="statusPanel"/);
  assert.match(popupHtml, /id="overflowPanel"/);
  assert.doesNotMatch(popupHtml, /PUSH|ADAPTIVE|READ ONLY|PRIVATE PILOT|LOCAL/);
  assert.doesNotMatch(popupHtml, /id="(?:inspectTarget|rehearseTarget|inspectRetailer|rehearseWalmart|rehearseAmazon|rehearseBestBuy)"/);
  assert.ok(popupHtml.indexOf('src="runtime-config.js"') < popupHtml.indexOf('src="popup.js"'));
  assert.match(runtimeConfig, /profile: "local"/);
  assert.match(runtimeConfig, /localPackageUpdates: true/);
  assert.doesNotMatch(targetBundle, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(/);
  assert.doesNotMatch(retailerBundle, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(/);
  assert.doesNotMatch(observerRecipeOracle, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.match(observerRecipeOracle, /application\/ld\+json|packaged_structured_oracle_v1/);
  assert.match(retailerBundle, /pdp-add|repairLandmarks/);
  assert.match(targetActionBundle, /\.click\s*\(/);
  // Raising a Target cart line (Kevin, 2026-10-10) may set that line's own
  // native quantity select/input: one audited helper then dispatches input
  // and change on it, and nothing else is ever dispatched.
  assert.deepEqual(targetActionBundle.match(/[^\n]*dispatchEvent\s*\([^\n]*/g)?.map((line) => line.trim()),
    ["if (view) control.dispatchEvent(new view.Event(type, { bubbles: true }));"]);
  assert.deepEqual(targetActionBundle.match(/notifyQuantityControl\([^)]*\)/g),
    ["notifyQuantityControl(control, type)", "notifyQuantityControl(field, \"input\")", "notifyQuantityControl(field, \"change\")"]);
  assert.doesNotMatch(targetActionBundle, /\bfetch\s*\(|location\.assign\s*\(/);
  assert.match(walmartActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(walmartActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.match(amazonActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(amazonActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.doesNotMatch(amazonActionBundle, /checkout\/entry\/buynow/);
  assert.match(bestBuyActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(bestBuyActionBundle, /preorder_not_supported/);
  assert.match(bestBuyActionBundle, /high_demand/);
  assert.doesNotMatch(bestBuyActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.doesNotMatch(trackalackerPush, /console\./);
  assert.doesNotMatch(trackalackerPush, /endpoint\s*:\s*["']https:\/\/fcm\.googleapis\.com/);
  assert.match(observerRecipeRoot, /minimumManifestGeneration: 1/);
  assert.doesNotMatch(observerRecipeRoot, /PRIVATE KEY|privateKey|BEGIN PRIVATE/);
});
