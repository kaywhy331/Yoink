import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const browserArgument = process.argv.find((value) => value.startsWith("--browser="))?.slice(10)
  || process.env.YOINK_SCREENSHOT_BROWSER
  || "";
const outputArgument = process.argv.find((value) => value.startsWith("--output="))?.slice(9)
  || "docs/screenshots/ux-01";
const outputRoot = resolve(root, outputArgument);
const temporaryRoot = mkdtempSync(join(tmpdir(), "yoink-token-surfaces-"));
if (!browserArgument) {
  throw new Error("Pass --browser=/absolute/path/to/chrome-headless-shell or set YOINK_SCREENSHOT_BROWSER.");
}
mkdirSync(outputRoot, { recursive: true });

const surfaces = [
  { id: "shopper", attributes: 'data-theme="light"', css: ["apps/web/tokens.css", "apps/web/components.css", "apps/web/user.css"], width: 800, height: 620 },
  { id: "admin", attributes: 'data-theme="dark" data-product-surface="admin"', css: ["apps/web/tokens.css", "apps/web/components.css", "apps/web/styles.css"], width: 800, height: 620 },
  { id: "docs", attributes: 'data-theme="light"', css: ["apps/web/tokens.css", "apps/web/components.css", "apps/web/docs.css"], width: 800, height: 620 },
  { id: "extension-popup", attributes: "", css: ["apps/extension/popup.css"], width: 460, height: 540 },
  { id: "extension-options", attributes: "", css: ["apps/extension/options.css"], width: 800, height: 620 },
];

const proofCss = `
  html, body { width: auto !important; min-width: 0 !important; min-height: 100% !important; max-height: none !important; overflow: visible !important; }
  body { margin: 0 !important; padding: 32px !important; }
  .token-proof { display: grid !important; width: min(560px, 100%) !important; min-height: 0 !important; margin: 0 auto !important; padding: 28px !important; gap: 18px !important; border: 1px solid var(--color-rule) !important; border-radius: var(--radius-lg) !important; color: var(--color-ink) !important; background: var(--color-surface) !important; box-shadow: 0 18px 50px rgb(var(--rgb-overlay) / 18%) !important; }
  .token-proof h1 { margin: 0 !important; color: var(--color-ink) !important; font: 800 var(--text-2xl)/1.1 var(--font-sans) !important; letter-spacing: -.03em !important; }
  .token-proof p { margin: 0 !important; color: var(--color-muted) !important; font: var(--text-md)/1.5 var(--font-sans) !important; }
  .token-proof-row { display: flex !important; align-items: center !important; gap: 12px !important; }
  .token-proof .button { width: fit-content !important; margin: 0 !important; }
  .token-proof dialog[open] { position: relative !important; inset: auto !important; display: grid !important; width: min(420px, 100%) !important; max-height: none !important; margin: 2px 0 0 !important; padding: 20px !important; gap: 10px !important; overflow: visible !important; }
  .token-proof dialog h2 { margin: 0 !important; color: var(--color-ink) !important; font: 800 var(--text-xl)/1.2 var(--font-sans) !important; }
`;

function documentFor(surface) {
  const css = surface.css.map((path) => readFileSync(resolve(root, path), "utf8")).join("\n");
  return `<!doctype html><html lang="en" ${surface.attributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${surface.id}</title><style>${css}\n${proofCss}</style></head><body><main class="token-proof"><p>YOINK · ${surface.id.replaceAll("-", " ").toUpperCase()}</p><h1>Shared visual system</h1><div class="token-proof-row"><button class="button primary" type="button">Primary action</button><span class="tag good">Ready</span></div><dialog open><h2>Review action</h2><p>Buttons, tags, and dialogs use the same semantic tokens.</p><div class="token-proof-row"><button class="button primary" type="button">Confirm</button><button class="button secondary" type="button">Cancel</button></div></dialog></main></body></html>`;
}

function captureWithBrowser(surface, htmlPath, screenshotPath, profilePath) {
  const fileUrl = new URL(`file://${htmlPath}`).href;
  const browserName = basename(browserArgument).toLowerCase();
  const args = browserName.includes("firefox")
    ? ["--headless", "--no-remote", "--profile", profilePath, "--screenshot", screenshotPath, "--window-size", `${surface.width},${surface.height}`, fileUrl]
    : ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", `--user-data-dir=${profilePath}`, `--window-size=${surface.width},${surface.height}`, `--screenshot=${screenshotPath}`, fileUrl];
  execFileSync(browserArgument, args, { stdio: "pipe" });
}

try {
  for (const surface of surfaces) {
    const htmlPath = join(temporaryRoot, `${surface.id}.html`);
    const profilePath = join(temporaryRoot, `profile-${surface.id}`);
    const screenshotPath = join(outputRoot, `${surface.id}.png`);
    mkdirSync(profilePath);
    writeFileSync(htmlPath, documentFor(surface));
    captureWithBrowser(surface, htmlPath, screenshotPath, profilePath);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${surfaces.length} token-system screenshots written to ${basename(outputRoot)}.\n`);
