import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

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
  const shopperDots = [...shopper.matchAll(/<(?:i|span)[^>]*class="dot[^>]*>/g)].map((match) => match[0]);
  assert.equal(shopperDots.length, 3);
  for (const dot of shopperDots) {
    assert.match(dot, /role="img"/);
    assert.match(dot, /aria-label=/);
  }
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
