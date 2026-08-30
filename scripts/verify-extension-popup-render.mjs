import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const extensionRoot = join(root, "apps", "extension");
const browserArgument = process.argv.find((value) => value.startsWith("--browser="))?.slice(10)
  || process.env.YOINK_HEADLESS_BROWSER || "";
const screenshotArgument = process.argv.find((value) => value.startsWith("--screenshots="))?.slice(14) || "";
if (!browserArgument) {
  throw new Error("Pass --browser=/absolute/path/to/chrome-headless-shell or set YOINK_HEADLESS_BROWSER.");
}
const browser = resolve(browserArgument);
const screenshotRoot = screenshotArgument ? resolve(screenshotArgument) : "";
if (screenshotRoot) mkdirSync(screenshotRoot, { recursive: true });

const popupHtml = readFileSync(join(extensionRoot, "popup.html"), "utf8")
  .replace(/\s*<link rel="stylesheet" href="popup\.css">/, "")
  .replace(/\s*<script[^>]*>[\s\S]*?<\/script>/g, "");
const popupCss = readFileSync(join(extensionRoot, "popup.css"), "utf8");
const popupState = readFileSync(join(extensionRoot, "popup-state.js"), "utf8");
const popup = readFileSync(join(extensionRoot, "popup.js"), "utf8");
const iconDataUrl = `data:image/svg+xml;base64,${readFileSync(join(extensionRoot, "yoink-icon.svg")).toString("base64")}`;
const extensionVersion = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8")).version;
const [extensionMajor, extensionMinor, extensionPatch] = extensionVersion.split(".").map(Number);
const nextExtensionVersion = `${extensionMajor}.${extensionMinor}.${extensionPatch + 1}`;

const ready = {
  connected: true,
  paired: true,
  version: extensionVersion,
  executionMode: "live",
  actionsPaused: false,
  chromeMutationEnabled: true,
  checkedAt: "2026-08-29T18:00:00.000Z",
  trackalackerPush: { ready: true, state: "ready" }
};
const states = [
  { id: "healthy-idle", url: "https://example.com/", health: ready },
  {
    id: "target-product",
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    health: ready
  },
  {
    id: "trackalacker-attention",
    url: "https://www.bestbuy.com/product/card/J3ZPGXX9RP/sku/6685081",
    health: { ...ready, trackalackerPush: { ready: false, state: "error" } }
  },
  {
    id: "walmart-draw",
    url: "https://www.walmart.com/shop/collectibles/draw",
    health: ready
  },
  {
    id: "paused-product",
    url: "https://www.amazon.com/dp/B00E4AMFKK",
    health: { ...ready, actionsPaused: true }
  },
  {
    id: "hard-blocker",
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    health: { ...ready, connected: false }
  },
  {
    id: "update-downloaded",
    url: "https://example.com/",
    health: { ...ready, version: nextExtensionVersion },
    updateHandoff: {
      schemaVersion: 1,
      channel: "local",
      releaseVersion: nextExtensionVersion,
      recordedAt: new Date().toISOString()
    }
  }
];
const zooms = [1, 1.25, 2];
const temporaryRoot = mkdtempSync(join(tmpdir(), "yoink-popup-render-"));

function fixtureScript(state, zoom) {
  return `
    document.documentElement.style.zoom = ${JSON.stringify(zoom)};
    globalThis.YoinkRuntimeConfig = Object.freeze({
      profile: "local",
      appOrigin: "http://127.0.0.1:32991",
      localPackageUpdates: true
    });
    const fixtureHealth = ${JSON.stringify(state.health)};
    const fixtureSession = ${JSON.stringify({ yoinkUpdateHandoffV1: state.updateHandoff || null })};
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: ${JSON.stringify(extensionVersion)} }),
        sendMessage: async (message) => message?.type === "yoink:check-health"
          ? ({ ok: true, state: fixtureHealth }) : ({ ok: true, state: fixtureHealth }),
        reload: () => undefined,
        onMessage: { addListener: () => undefined }
      },
      tabs: {
        query: async () => [{ id: 17, url: ${JSON.stringify(state.url)} }],
        create: async ({ url }) => ({ id: 18, url })
      },
      permissions: {
        contains: async () => false,
        request: async () => true
      },
      storage: {
        local: { get: async () => ({ readiness: fixtureHealth }) },
        session: {
          get: async (key) => ({ [key]: fixtureSession[key] }),
          set: async () => undefined,
          remove: async () => undefined
        },
        onChanged: { addListener: () => undefined }
      }
    };
  `;
}

function metricScript(state, zoom) {
  return `
    setTimeout(() => {
      const body = document.body;
      const root = document.documentElement;
      const shell = document.querySelector(".popup-shell");
      const metrics = {
        state: ${JSON.stringify(state.id)},
        zoom: ${JSON.stringify(zoom)},
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        documentClientWidth: root.clientWidth,
        documentScrollWidth: root.scrollWidth,
        shellHeight: Math.round(shell.getBoundingClientRect().height),
        verticalScroll: body.scrollHeight > body.clientHeight + 1,
        horizontalScroll: root.scrollWidth > root.clientWidth + 1,
        primaryCount: [...document.querySelectorAll("#primaryAction")].filter((item) => !item.hidden).length,
        activityCount: ["#activityAction", "#activityStatus"]
          .filter((selector) => !document.querySelector(selector).hidden).length
      };
      document.title = "YOINK_METRICS_" + btoa(JSON.stringify(metrics));
    }, 120);
  `;
}

function documentFor(state, zoom) {
  return popupHtml
    .replace('src="yoink-icon.svg"', `src="${iconDataUrl}"`)
    .replace("</head>", `<style>${popupCss}</style></head>`)
    .replace("</body>", `<script>${fixtureScript(state, zoom)}</script>
      <script>${popupState}</script>
      <script>${popup}</script>
      <script>${metricScript(state, zoom)}</script></body>`);
}

function chromeArguments(fileUrl, width, height) {
  return [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--virtual-time-budget=700",
    `--window-size=${width},${height}`,
    fileUrl
  ];
}

const results = [];
try {
  for (const state of states) {
    for (const zoom of zooms) {
      const path = join(temporaryRoot, `${state.id}-${String(zoom).replace(".", "_")}.html`);
      writeFileSync(path, documentFor(state, zoom));
      const width = Math.ceil(360 * zoom);
      const height = Math.ceil(430 * zoom);
      const fileUrl = new URL(`file://${path}`).href;
      const dumped = execFileSync(browser, ["--dump-dom", ...chromeArguments(fileUrl, width, height)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const encoded = /<title>YOINK_METRICS_([^<]+)<\/title>/.exec(dumped)?.[1];
      if (!encoded) throw new Error(`No render metrics were emitted for ${state.id} at ${zoom * 100}%.`);
      const metrics = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      if (metrics.verticalScroll || metrics.horizontalScroll || metrics.primaryCount > 1 || metrics.activityCount > 1) {
        throw new Error(`Popup render constraint failed: ${JSON.stringify(metrics)}`);
      }
      results.push(metrics);
      if (screenshotRoot && zoom === 1) {
        execFileSync(browser, [
          `--screenshot=${join(screenshotRoot, `${state.id}.png`)}`,
          ...chromeArguments(fileUrl, width, Math.ceil(metrics.shellHeight))
        ], { stdio: "ignore" });
      }
    }
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ states: states.length, zooms, renders: results }, null, 2)}\n`);
