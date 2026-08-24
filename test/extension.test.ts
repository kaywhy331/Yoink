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
    version?: string;
  };
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.permissions, ["activeTab", "alarms", "notifications", "storage", "scripting"]);
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
    "https://*.pokemoncenter.com/*"
  ]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background?.service_worker, "background.js");
  assert.equal(manifest.host_permissions.includes("https://*.amazon.com/*"), false);
  assert.equal(manifest.host_permissions.includes("https://www.target.com/*"), false);
  assert.equal(manifest.host_permissions.includes("https://*.walmart.com/*"), false);

  for (const file of ["background.js", "popup.js", "trackalacker-push.js", "trackalacker-sync.js", "observer-recipe-root.js"]) {
    const result = spawnSync(process.execPath, ["--check", join(extensionRoot, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const background = readFileSync(join(extensionRoot, "background.js"), "utf8");
  const popup = readFileSync(join(extensionRoot, "popup.js"), "utf8");
  const targetBundle = readFileSync(join(extensionRoot, "target-shadow.js"), "utf8");
  const targetActionBundle = readFileSync(join(extensionRoot, "target-action.js"), "utf8");
  const walmartActionBundle = readFileSync(join(extensionRoot, "walmart-action.js"), "utf8");
  const amazonActionBundle = readFileSync(join(extensionRoot, "amazon-action.js"), "utf8");
  const bestBuyActionBundle = readFileSync(join(extensionRoot, "bestbuy-action.js"), "utf8");
  const retailerBundle = readFileSync(join(extensionRoot, "retailer-shadow.js"), "utf8");
  const trackalackerPush = readFileSync(join(extensionRoot, "trackalacker-push.js"), "utf8");
  const observerRecipeRoot = readFileSync(join(extensionRoot, "observer-recipe-root.js"), "utf8");
  assert.match(background, /setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
  assert.match(background, /jobs\/next/);
  assert.match(background, /targetAddAdapterVersion/);
  assert.match(background, /walmartAddAdapterVersion/);
  assert.match(background, /amazonAddAdapterVersion/);
  assert.match(background, /bestBuyAddAdapterVersion/);
  assert.match(background, /communityReadOnlyEvidence: true/);
  assert.match(background, /observerRecipeShadow: true/);
  assert.match(background, /durableAdapterDiagnostics: true/);
  assert.match(background, /walmartDrawReadOnly: true/);
  assert.match(background, /yoink:inspect-walmart-draw/);
  assert.match(background, /devices\/self\/walmart-draw\/scans/);
  assert.doesNotMatch(background, /draw\.www\.walmart\.com|\/draw\/enter/);
  assert.match(background, /Ed25519/);
  assert.match(background, /observer-recipe-trials/);
  assert.match(background, /observer-recipe-root\.js/);
  assert.match(background, /yoinkObserverRecipeTrustStateV1/);
  assert.doesNotMatch(background, /const OBSERVER_RECIPE_KEY_PIN/);
  assert.match(background, /yoink:contribute-retailer/);
  assert.doesNotMatch(background, /console\./);
  assert.match(background, /world: "ISOLATED"/);
  assert.match(background, /world: "MAIN"/);
  assert.match(background, /shadow-observations\/target/);
  assert.match(background, /sources\/trackalacker\/signals/);
  assert.match(background, /Idempotency-Key/);
  assert.match(background, /trackalacker-sync\.js/);
  assert.match(background, /retailerMutation: false/);
  assert.doesNotMatch(background, /\.click\s*\(|dispatchEvent\s*\(/);
  assert.match(popup, /chrome\.permissions\.request/);
  assert.match(popup, /chrome\.permissions\.remove/);
  assert.match(popup, /Share current page evidence once|yoink:contribute-retailer/);
  assert.match(popup, /yoink:inspect-walmart-draw/);
  assert.doesNotMatch(targetBundle, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(/);
  assert.doesNotMatch(retailerBundle, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(/);
  assert.match(targetActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(targetActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.match(walmartActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(walmartActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.match(amazonActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(amazonActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.doesNotMatch(amazonActionBundle, /checkout\/entry\/buynow/);
  assert.match(bestBuyActionBundle, /\.click\s*\(/);
  assert.doesNotMatch(bestBuyActionBundle, /dispatchEvent\s*\(|\bfetch\s*\(|location\.assign\s*\(/);
  assert.doesNotMatch(trackalackerPush, /console\./);
  assert.doesNotMatch(trackalackerPush, /endpoint\s*:\s*["']https:\/\/fcm\.googleapis\.com/);
  assert.match(observerRecipeRoot, /minimumManifestGeneration: 1/);
  assert.doesNotMatch(observerRecipeRoot, /PRIVATE KEY|privateKey|BEGIN PRIVATE/);
});
