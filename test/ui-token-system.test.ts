import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readBinary = (path: string) => readFileSync(resolve(root, path));

test("all web pages load shared tokens and component primitives first", () => {
  for (const page of ["user.html", "index.html", "docs.html", "privacy.html"]) {
    const html = read(`apps/web/${page}`);
    const tokens = html.indexOf('href="/tokens.css"');
    const components = html.indexOf('href="/components.css"');
    assert.ok(tokens > 0, `${page} loads tokens.css`);
    assert.ok(components > tokens, `${page} loads components.css after tokens.css`);
  }
  const server = read("apps/api/src/app.ts");
  assert.match(server, /\["\/tokens\.css", "tokens\.css"\]/);
  assert.match(server, /\["\/components\.css", "components\.css"\]/);
  const adminStaticPaths = /const ADMIN_STATIC_PATHS = new Set\(([^;]+)\);/.exec(server)?.[1] || "";
  assert.doesNotMatch(adminStaticPaths, /tokens\.css|components\.css/, "shared styles keep the same user-readable policy as dialogs.css");
});

test("palette literals live only in tokens.css", () => {
  const files = [
    "apps/web/user.css", "apps/web/styles.css", "apps/web/docs.css", "apps/web/dialogs.css",
    "apps/web/status.css", "apps/web/components.css", "apps/extension/popup.css",
    "apps/extension/options.css",
  ];
  for (const file of files) assert.doesNotMatch(read(file), /#[0-9a-f]{3,8}\b/i, file);
  assert.match(read("apps/web/tokens.css"), /--theme-ground-light:\s*#[0-9a-f]{6}/i);
});

test("tokens include the required scales and both theme selectors", () => {
  const css = read("apps/web/tokens.css");
  for (const name of ["ground", "surface", "ink", "muted", "rule", "accent", "good", "warning", "bad"]) {
    assert.match(css, new RegExp(`--color-${name}:`));
  }
  for (const size of ["12px", "13px", "14px", "16px", "20px", "28px", "40px"]) assert.match(css, new RegExp(`:\\s*${size};`));
  for (const radius of ["4px", "8px", "12px"]) assert.match(css, new RegExp(`--radius-[^:]+:\\s*${radius};`));
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /:root:not\(\[data-theme\]\)/);
});

test("shared components cover every required primitive", () => {
  const css = read("apps/web/components.css");
  for (const selector of [".button", ".tag", ".chip", ".card", ".panel", "input", "dialog", ".toast", ".status-dot"]) {
    assert.ok(css.includes(selector), `components.css includes ${selector}`);
  }
});

function customProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)].map((match) => match[1]!));
}

test("every var() in web and extension CSS resolves to a defined custom property", () => {
  // Web surfaces may use tokens.css, components.css, or their own definitions.
  // Extension files are standalone: only the generated token block or their own definitions count.
  const shared = new Set([
    ...customProperties(read("apps/web/tokens.css")),
    ...customProperties(read("apps/web/components.css"))
  ]);
  const files = ["apps/web", "apps/extension"].flatMap((dir) =>
    readdirSync(resolve(root, dir)).filter((name) => name.endsWith(".css")).sort().map((name) => `${dir}/${name}`));
  const failures = new Set<string>();
  for (const file of files) {
    const css = read(file);
    const extension = file.startsWith("apps/extension/");
    const start = css.indexOf("/* GENERATED: YOINK TOKENS");
    const end = css.indexOf("/* END GENERATED: YOINK TOKENS */");
    const generated = extension && start >= 0 && end > start ? css.slice(start, end) : "";
    const defined = new Set([
      ...(extension ? customProperties(generated) : shared),
      ...customProperties(css)
    ]);
    for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = match[1]!;
      if (defined.has(name)) continue;
      const line = css.slice(0, match.index).split("\n").length;
      failures.add(`${file}:${line} ${name}`);
    }
  }
  assert.deepEqual([...failures], [], `unresolved custom properties:\n${[...failures].join("\n")}`);
});

test("generated extension tokens are current", () => {
  execFileSync(process.execPath, [resolve(root, "scripts/generate-extension-tokens.mjs"), "--check"], { stdio: "pipe" });
  for (const file of ["apps/extension/popup.css", "apps/extension/options.css"]) {
    const css = read(file);
    assert.match(css, /GENERATED: YOINK TOKENS/);
    assert.match(css, /--color-accent:\s*rgb\(/);
    assert.match(css, /:where\(\.button\)/);
    assert.match(css, /:where\(\.tag, \.chip\)/);
    assert.match(css, /:where\(dialog\)/);
  }
});

test("the five-surface visual proof contains rendered PNG screenshots", () => {
  for (const surface of ["shopper", "admin", "docs", "extension-popup", "extension-options"]) {
    const screenshot = readBinary(`docs/screenshots/ux-01/${surface}.png`);
    assert.equal(screenshot.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${surface} PNG signature`);
    assert.ok(screenshot.readUInt32BE(16) >= 400, `${surface} width`);
    assert.ok(screenshot.readUInt32BE(20) >= 500, `${surface} height`);
  }
});

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return .2126 * channels[0]! + .7152 * channels[1]! + .0722 * channels[2]!;
}

function contrast(a: string, b: string) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (lighter! + .05) / (darker! + .05);
}

test("body and muted text clear 4.5:1 in both themes", () => {
  const css = read("apps/web/tokens.css");
  const value = (name: string) => {
    const match = css.match(new RegExp(`--theme-${name}:\\s*(#[0-9a-f]{6});`, "i"));
    assert.ok(match, name);
    return match[1]!;
  };
  for (const theme of ["light", "dark"]) {
    const surface = value(`surface-${theme}`);
    assert.ok(contrast(value(`ink-${theme}`), surface) >= 4.5, `${theme} ink contrast`);
    assert.ok(contrast(value(`muted-${theme}`), surface) >= 4.5, `${theme} muted contrast`);
    assert.ok(contrast(value(`accent-${theme}`), surface) >= 4.5, `${theme} accent contrast`);
  }
});
