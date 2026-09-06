import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis & { close(): void } };
};

const FORBIDDEN_COPY = [
  { pattern: /\bmissions?\b/i, use: "plan" },
  { pattern: /\bpurchase intents?\b/i, use: "plan" },
  { pattern: /\bpurchase preferences?\b/i, use: "plan" },
  { pattern: /\bretailers?\b/i, use: "store (or lane in admin qualification)" },
  { pattern: /\bsignals?\b/i, use: "call" },
  { pattern: /\bopportunit(?:y|ies)\b/i, use: "call" },
  { pattern: /\bintegrations?\b/i, use: "sources" },
  { pattern: /\bconnections?\b/i, use: "sources" },
  { pattern: /\bstrateg(?:y|ies)\b/i, use: "rule" },
  { pattern: /\bpreferences?\b/i, use: "settings" },
  { pattern: /\bdevices?\b/i, use: "Chrome companion" },
  { pattern: /\bexecutors?\b/i, use: "Chrome companion" }
] as const;

const SHOPPER_ENGINEERING_COPY = [
  { pattern: /\bguarded\b/i, use: "cart" },
  { pattern: /\brunners?\b/i, use: "supported store action" },
  { pattern: /\blanes?\b/i, use: "store" },
  { pattern: /\bqualif(?:y|ied|ication|ications)\b/i, use: "store check" },
  { pattern: /\brehearsals?\b/i, use: "check" },
  { pattern: /\bread-only\b/i, use: "watch without adding to cart" },
  { pattern: /\barmed\b/i, use: "active" }
] as const;

const MACHINE_ONLY = /^(?:[a-z0-9_./:#?&=*\[\]-]+|[A-Z][A-Z0-9_]+)$/;
const GENERIC_CONNECTION_COPY = /\b(?:internet|network|your) connection\b/i;
const CALL_TYPE_TAGS = new Set(["Signal", "Drop", "Queue"]);

function violations(label: string, copy: string): string[] {
  const normalized = copy.replace(/\s+/g, " ").trim();
  if (!normalized || MACHINE_ONLY.test(normalized.replaceAll("⟦value⟧", "")) || GENERIC_CONNECTION_COPY.test(normalized)) return [];
  return FORBIDDEN_COPY.flatMap(({ pattern, use }) => pattern.test(normalized)
    ? [`${label}: use “${use}” instead of “${normalized.match(pattern)?.[0]}” in “${normalized}”`]
    : []);
}

function shopperEngineeringViolations(label: string, copy: string): string[] {
  const normalized = copy.replace(/\s+/g, " ").trim();
  if (!normalized || MACHINE_ONLY.test(normalized.replaceAll("⟦value⟧", ""))) return [];
  return SHOPPER_ENGINEERING_COPY.flatMap(({ pattern, use }) => pattern.test(normalized)
    ? [`${label}: use “${use}” instead of “${normalized.match(pattern)?.[0]}” in “${normalized}”`]
    : []);
}

function visibleHtmlCopy(pathname: string): string[] {
  const dom = new JSDOM(readFileSync(pathname, "utf8"));
  try {
    const document = dom.window.document;
    const values: string[] = [];
    const walker = document.createTreeWalker(document.body, dom.window.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "TEMPLATE"].includes(parent.tagName)) continue;
      const value = node.textContent?.trim();
      if (value) values.push(value);
    }
    for (const element of document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
      for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
        const value = element.getAttribute(attribute)?.trim();
        if (value) values.push(value);
      }
    }
    return values;
  } finally {
    dom.window.close();
  }
}

function templateSource(node: ts.TemplateExpression): string {
  return node.templateSpans.reduce(
    (value, span) => `${value}⟦value⟧${span.literal.text}`,
    node.head.text
  );
}

function renderedCopy(raw: string): string {
  if (!raw.includes("<")) return raw;
  const attributes = [...raw.matchAll(/\b(?:aria-label|title|placeholder|alt)=["']([^"']+)["']/gi)]
    .map((match) => match[1] ?? "");
  const text = raw.replace(/<[^>]*>/g, " ");
  return [...attributes, text].join(" ").replaceAll("⟦value⟧", " ");
}

function enclosingFunctionName(node: ts.Node): string | null {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    }
  }
  return null;
}

function visibleScriptCopy(pathname: string): Array<{ line: number; copy: string }> {
  const source = readFileSync(pathname, "utf8");
  const sourceFile = ts.createSourceFile(pathname, source, ts.ScriptTarget.Latest, true,
    pathname.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const values: Array<{ line: number; copy: string }> = [];

  const add = (node: ts.Node, raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed || MACHINE_ONLY.test(trimmed) || trimmed.startsWith("/api/")
      || trimmed.startsWith("http://") || trimmed.startsWith("https://")) return;
    // This function is the existing maintainer-only PostgreSQL proof surface;
    // its protocol evidence deliberately retains stable machine vocabulary.
    const functionName = enclosingFunctionName(node);
    if (pathname.endsWith("app.js") && ["renderPostgresCutover", "currentAdminHashRoute", "writeAdminRoute", "applyAdminHashRoute"].includes(functionName || "")) return;
    if (pathname.endsWith("user.js") && ["currentUserHashRoute", "writeUserRoute", "applyHashRoute"].includes(functionName || "")) return;
    const copy = renderedCopy(raw).replace(/\s+/g, " ").trim();
    if (!copy) return;
    if (pathname.endsWith("user.js") && functionName === "renderCalls" && CALL_TYPE_TAGS.has(copy)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    values.push({ line: line + 1, copy });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) add(node, templateSource(node));
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

test("product copy follows the shared glossary on every UI surface", () => {
  const root = process.cwd();
  const htmlFiles = [
    "apps/web/user.html",
    "apps/web/index.html",
    "apps/web/docs.html",
    "apps/web/privacy.html",
    "apps/extension/popup.html",
    "apps/extension/options.html"
  ];
  const scriptFiles = [
    "apps/web/user.js",
    "apps/web/app.js",
    "apps/extension/popup.js",
    "apps/extension/options.js",
    "packages/extension-ui/src/popup-state.ts",
    "packages/domain/src/action-status.ts",
    "packages/domain/src/purchase-automation-readiness.ts",
    "packages/domain/src/store-setup.ts",
    "packages/domain/src/release-announcement.ts"
  ];
  const failures = [
    ...htmlFiles.flatMap((file) => visibleHtmlCopy(join(root, file))
      .flatMap((copy) => violations(file, copy))),
    ...scriptFiles.flatMap((file) => visibleScriptCopy(join(root, file))
      .flatMap(({ line, copy }) => violations(`${file}:${line}`, copy)))
  ];
  assert.deepEqual(failures, []);
});

test("shopper surfaces translate internal store-check terminology", () => {
  const root = process.cwd();
  const htmlFiles = [
    "apps/web/user.html",
    "apps/web/docs.html",
    "apps/extension/popup.html",
    "apps/extension/options.html"
  ];
  const scriptFiles = [
    "apps/web/user.js",
    "apps/extension/popup.js",
    "apps/extension/options.js",
    "packages/extension-ui/src/popup-state.ts",
    "packages/domain/src/purchase-automation-readiness.ts",
    "packages/domain/src/store-setup.ts",
    "packages/domain/src/release-announcement.ts",
    "packages/database/src/retailer-readiness-repository.ts"
  ];
  const failures = [
    ...htmlFiles.flatMap((file) => visibleHtmlCopy(join(root, file))
      .flatMap((copy) => shopperEngineeringViolations(file, copy))),
    ...scriptFiles.flatMap((file) => visibleScriptCopy(join(root, file))
      .flatMap(({ line, copy }) => shopperEngineeringViolations(`${file}:${line}`, copy)))
  ];
  assert.deepEqual(failures, []);
});

test("the glossary defines the canonical objects and handoff stages", () => {
  const glossary = readFileSync(join(process.cwd(), "docs", "GLOSSARY.md"), "utf8");
  for (const label of ["Plan", "Store", "Lane", "Call", "Sources", "Rule", "Settings", "Chrome companion", "Quick add setup", "Notify-only setup"]) {
    assert.match(glossary, new RegExp(`\\*\\*${label.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\*\\*`));
  }
  for (const stage of ["Queued", "Checking", "Ready to check out", "Needs you", "Closed"]) {
    assert.match(glossary, new RegExp(`\\*\\*${stage}\\*\\*`));
  }
  assert.match(glossary, /\*\*Signal\*\*, \*\*Drop\*\*, and \*\*Queue\*\* are controlled type-tag labels/);
});

test("public help has one glossary, current control names, and one checkout boundary", () => {
  const root = process.cwd();
  const docs = readFileSync(join(root, "apps/web/docs.html"), "utf8");
  const guides = [
    docs,
    readFileSync(join(root, "apps/web/llms.txt"), "utf8"),
    readFileSync(join(root, "README.md"), "utf8"),
    readFileSync(join(root, "apps/extension/README.md"), "utf8")
  ].join("\n");
  assert.equal((docs.match(/\bid="glossary"/g) || []).length, 1);
  assert.doesNotMatch(docs, /<h2>Status glossary<\/h2>/i);
  assert.doesNotMatch(guides, /Connect TrackaLacker push|Open Recent actions|\bRe-verify\b|Verify TrackaLacker|Sync followed/i);
  assert.equal((docs.match(/Checkout stays manual\./g) || []).length, 1);
});

test("shopper copy uses one name for reusable Quick add settings", () => {
  const root = process.cwd();
  const copy = [
    ...visibleHtmlCopy(join(root, "apps/web/user.html")),
    ...visibleScriptCopy(join(root, "apps/web/user.js")).map((item) => item.copy)
  ].join("\n");
  assert.match(copy, /Quick add setup/);
  assert.match(copy, /Notify-only setup/);
  assert.doesNotMatch(copy, /Quick-add profile|Saved setup|Saved profile|System default|Built-in default|Notify-only default/i);
});

test("the shopper settings route keeps a stable settings hash alias", () => {
  const shopper = readFileSync(join(process.cwd(), "apps", "web", "user.js"), "utf8");
  assert.match(shopper, /USER_ROUTE_ALIASES[\s\S]*?preferences: "settings"[\s\S]*?connections: "settings\/chrome"[\s\S]*?health: "activity\/insights"[\s\S]*?diagnostics: "settings\/chrome"/);
  assert.match(shopper, /history\[`\$\{mode\}State`\]/);
  assert.match(shopper, /addEventListener\("popstate"/);
});
