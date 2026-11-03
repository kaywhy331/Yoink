import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const root = process.cwd();

test("Wanted reasons respect saved mode, the off switch, and server readiness blockers", () => {
  const source = readFileSync(join(root, "apps/web/user.js"), "utf8");
  const statusSource = source.slice(source.indexOf("const WANTED_STATUS ="), source.indexOf("function wantedRowMarkup"));
  const state = { overview: { settings: { actionsPaused: false } } };
  const status = runInNewContext(`${statusSource}; wantedStatus`, {
    state, planStatusLabel: (value: string) => value,
    listingStockEvidence: () => ({ freshness: "unknown", status: "unknown" })
  }) as (plan: Record<string, unknown>) => { label: string };
  const plan = { status: "active", actionCeiling: "add_to_cart" };
  const groups: Array<[string, string[]]> = [
    ["Connect Chrome", ["needs_current_companion", "companion_offline", "guarded_add_device_incapable", "guarded_add_session_blocked"]],
    ["Auto-cart off", ["guarded_add_paused", "guarded_add_shadow"]],
    ["Store being prepared", ["needs_target", "needs_signal", "guarded_add_policy_incomplete", "spend_limit_exceeded", "guarded_add_lane_closed", "advanced_strategy", "expired"]]
  ];
  for (const [label, readinessStates] of groups) {
    for (const readinessState of readinessStates) {
      assert.equal(status({ ...plan, automationReadiness: { state: readinessState } }).label, label, readinessState);
    }
  }
  assert.equal(status(plan).label, "Store being prepared", "missing readiness never promises a cart add");
  state.overview.settings.actionsPaused = true;
  const armed = { ...plan, automationReadiness: { readyForGuardedAdd: true } };
  assert.equal(status(armed).label, "Auto-cart off");
  assert.equal(status({ ...armed, actionCeiling: "notify" }).label, "Alerts only");
  assert.equal(status({ ...armed, status: "paused" }).label, "Paused");
  assert.equal(status({ ...armed, status: "satisfied" }).label, "Done");
});

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) || [];
  const channels = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (channels[0] || 0) + 0.7152 * (channels[1] || 0) + 0.0722 * (channels[2] || 0);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("status dots expose a text alternative on both dashboards", () => {
  const admin = readFileSync(join(root, "apps/web/app.js"), "utf8");
  const shopper = readFileSync(join(root, "apps/web/user.js"), "utf8");
  assert.match(admin, /function statusDot[\s\S]*?role="img" aria-label="\$\{escapeHtml\(stateLabel\)\}"/);
  const calls = admin.split("\n").filter((line) => line.includes("statusDot(") && !line.includes("function statusDot"));
  assert.ok(calls.length > 10);
  for (const call of calls) assert.match(call, /statusDot\([^,]+,/, call.trim());
  // The shopper dashboard states status in words (pills); any dot it still
  // draws, including the Setup tab's attention dot, needs a text alternative.
  const shopperHtml = readFileSync(join(root, "apps/web/user.html"), "utf8");
  const shopperDots = [...shopper.matchAll(/<(?:i|span)[^>]*class="dot[^>]*>/g), ...shopperHtml.matchAll(/<span[^>]*class="tab-dot"[^>]*>/g)]
    .map((match) => match[0]);
  assert.ok(shopperDots.length >= 1);
  for (const dot of shopperDots) assert.match(dot, /role="img"/);
  assert.match(shopper, /dot\.setAttribute\("aria-label", attention \? "Needs attention" : ""\)/);
});

test("dark-theme tags use solid pairs with WCAG AA text contrast", () => {
  const tokens = readFileSync(join(root, "apps/web/tokens.css"), "utf8");
  const components = readFileSync(join(root, "apps/web/components.css"), "utf8");
  const pairs = [
    ["--theme-violet-dark", "#c3b2ff", "--theme-violet-soft-dark", "#35275d"],
    ["--theme-muted-dark", "#b0b8ca", "--theme-surface-raised-dark", "#171b27"],
    ["--theme-good-dark", "#55e6b1", "--theme-good-soft-dark", "#174638"],
    ["--theme-warning-dark", "#ffca6b", "--theme-warning-soft-dark", "#4a3516"],
    ["--theme-bad-dark", "#ff8a9a", "--theme-bad-soft-dark", "#4a2028"]
  ] as const;
  for (const [foregroundToken, foreground, backgroundToken, background] of pairs) {
    assert.match(tokens, new RegExp(`${foregroundToken}: ${foreground}`));
    assert.match(tokens, new RegExp(`${backgroundToken}: ${background}`));
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} is below 4.5:1`);
  }
  assert.match(components, /:where\(\.tag, \.chip\)[^}]+color: var\(--color-muted\);\s+background: var\(--color-surface-raised\)/s);
  assert.match(components, /:where\(\.tag\.good, \.chip\.good\)[^}]+color: var\(--color-good\); background: var\(--color-good-soft\)/s);
  assert.match(components, /:where\(\.tag\.warning, \.tag\.warn, \.chip\.warning\)[^}]+color: var\(--color-warning\); background: var\(--color-warning-soft\)/s);
  assert.match(components, /:where\(\.tag\.bad, \.chip\.bad\)[^}]+color: var\(--color-bad\); background: var\(--color-bad-soft\)/s);
  assert.doesNotMatch(components.match(/:where\(\.tag, \.chip\)[\s\S]*?:where\(\.card, \.panel\)/)?.[0] || "", /rgba?\(/);
});
