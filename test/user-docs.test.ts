import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { CURRENT_USER_RELEASE_ANNOUNCEMENT } from "../packages/domain/src/release-announcement.js";

// package.json is the single source of truth for the running version; the docs,
// llms.txt, and the release announcement must all agree with it.
const PACKAGE_VERSION = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DASHBOARD_PANELS: Record<string, string> = {
  home: "home",
  products: "products",
  calls: "calls",
  "calls/drawings": "calls",
  plans: "plans",
  activity: "activity",
  "activity/insights": "insights",
  settings: "preferences",
  "settings/chrome": "preferences",
  "settings/notifications": "preferences",
  "settings/privacy": "preferences"
};

const SETTINGS_PANELS: Record<string, string> = {
  "settings/chrome": "chrome",
  "settings/notifications": "notifications",
  "settings/privacy": "privacy"
};

function anchorHrefs(body: string): string[] {
  return [...body.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)].map((match) => match[1] ?? "");
}

async function assertReaderLinksResolve(baseUrl: string, pageUrl: string, body: string): Promise<void> {
  for (const href of anchorHrefs(body)) {
    const target = new URL(href, pageUrl);
    assert.equal(target.origin, baseUrl, `public docs must not link to an external destination: ${href}`);
    assert.notEqual(target.pathname, "/admin", `public docs must not send shoppers to admin: ${href}`);
    const response = await fetch(`${baseUrl}${target.pathname}${target.search}`);
    assert.equal(response.status, 200, `public docs link must resolve: ${href}`);
    if (target.hash) {
      const targetBody = await response.text();
      const fragment = decodeURIComponent(target.hash.slice(1));
      const dashboardPanel = target.pathname === "/" ? DASHBOARD_PANELS[fragment] : "";
      if (dashboardPanel) {
        assert.match(targetBody, new RegExp(`\\bdata-panel=["']${dashboardPanel}["']`), `dashboard route must have a workspace: ${href}`);
        const settingsPanel = SETTINGS_PANELS[fragment];
        if (settingsPanel) {
          assert.match(targetBody, new RegExp(`\\bdata-settings-panel=["']${settingsPanel}["']`), `settings route must have its panel: ${href}`);
        }
        if (fragment === "calls/drawings") {
          assert.match(targetBody, /\bdata-call-filter=["']drawings["']/, `drawings route must have its Calls filter: ${href}`);
        }
        continue;
      }
      assert.match(
        targetBody,
        new RegExp(`\\bid=["']${escapeRegExp(fragment)}["']`),
        `public docs link must target a visible section: ${href}`
      );
    }
  }
}

test("the release announcement pins the version that package.json declares", () => {
  assert.match(PACKAGE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(
    CURRENT_USER_RELEASE_ANNOUNCEMENT.version,
    PACKAGE_VERSION,
    "bump packages/domain/src/release-announcement.ts together with package.json"
  );
  assert.ok(
    CURRENT_USER_RELEASE_ANNOUNCEMENT.id.includes(PACKAGE_VERSION.replaceAll(".", "-")),
    `announcement id ${CURRENT_USER_RELEASE_ANNOUNCEMENT.id} must name version ${PACKAGE_VERSION}`
  );
});

test("the user docs, machine guide, and release announcement share the current bounded action language", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: PACKAGE_VERSION
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const versionPattern = escapeRegExp(PACKAGE_VERSION);
  try {
    const docs = await fetch(`${baseUrl}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get("content-type") || "", /^text\/html/);
    const docsBody = await docs.text();
    assert.match(docsBody, /Ready to check out/);
    assert.match(docsBody, /Drop watch/);
    assert.match(docsBody, /watches each item near the window/);
    assert.match(docsBody, /Checkout stays manual/);
    assert.match(docsBody, new RegExp(`Yoink ${versionPattern}`));
    assert.match(docsBody, /id="glossary"/);
    assert.match(docsBody, /id="statuses"/);
    assert.match(docsBody, /<h3>Handoff stages<\/h3>/);
    for (const stage of ["Queued", "Checking", "Ready to check out", "Needs you", "Closed"]) {
      assert.match(docsBody, new RegExp(`<dt>${stage}</dt>`), `docs glossary must define the ${stage} stage`);
    }
    assert.doesNotMatch(docsBody, /<dt>(?:Got it|Missed it)<\/dt>/, "Got it and Missed it are close-out choices, not stages");
    assert.match(docsBody, /<dt>Closed<\/dt><dd>[^<]*<strong>Got it<\/strong>[^<]*<strong>Missed it<\/strong>/);
    assert.match(docsBody, /Chrome companion/);
    assert.match(docsBody, /href="\/#settings\/chrome"/);
    assert.match(docsBody, /href="\/#settings\/privacy"/);
    assert.match(docsBody, /href="\/#calls\/drawings"/);
    assert.match(docsBody, /href="\/#activity\/insights"/);
    assert.doesNotMatch(docsBody, /\{\{YOINK_VERSION\}\}|Yoink 1\.16|\/admin/);
    assert.doesNotMatch(docsBody, /automatic checkout/i);
    assert.doesNotMatch(docsBody, /Needs-you|[A-Za-z] → [A-Za-z]/, "UI paths use › between segments");
    await assertReaderLinksResolve(baseUrl, docs.url, docsBody);

    const privacy = await fetch(`${baseUrl}/privacy`);
    assert.equal(privacy.status, 200);
    const privacyBody = await privacy.text();
    assert.match(privacyBody, /Change notice · 2026-09-05/);
    assert.match(privacyBody, /href="\/#settings\/chrome"/);
    assert.doesNotMatch(privacyBody, /\{\{(?:YOINK_VERSION|PRIVACY_CHANGE_VERSION)\}\}|\/admin/);
    await assertReaderLinksResolve(baseUrl, privacy.url, privacyBody);

    const llms = await fetch(`${baseUrl}/llms.txt`);
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get("content-type") || "", /^text\/plain/);
    const llmsBody = await llms.text();
    assert.match(llmsBody, /Exact cart \+1 proof/);
    assert.match(llmsBody, new RegExp(`Running version: ${versionPattern}`));
    assert.match(llmsBody, /Chrome companion settings: \/#settings\/chrome/);
    assert.match(llmsBody, /\/#settings\/notifications/);
    assert.match(llmsBody, /\/#settings\/privacy/);
    assert.match(llmsBody, /Chrome companion routes/);
    assert.doesNotMatch(llmsBody, /\{\{YOINK_VERSION\}\}|\/admin/);
    assert.doesNotMatch(llmsBody, /\bretailers?\b|\bDevice routes\b/i);

    const overview = await fetch(`${baseUrl}/api/v1/user/overview`).then((response) => response.json()) as {
      announcement: { id: string; version: string; docsUrl: string; highlights: string[] };
      qualificationCandidates: unknown[];
    };
    assert.equal(overview.announcement.id, CURRENT_USER_RELEASE_ANNOUNCEMENT.id);
    assert.equal(overview.announcement.version, PACKAGE_VERSION);
    assert.equal(overview.announcement.docsUrl, "/docs");
    assert.equal(overview.announcement.highlights.length, 3);
    assert.deepEqual(overview.qualificationCandidates, []);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
