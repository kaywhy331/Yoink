import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis & { close(): void } };
};

const root = join(process.cwd(), "apps", "web");

test("admin chips are reserved for live state", () => {
  const dom = new JSDOM(readFileSync(join(root, "index.html"), "utf8"));
  try {
    const chips = [...dom.window.document.querySelectorAll<HTMLElement>(".mode-chip")];
    const ids = chips.map((chip) => chip.id).sort();
    assert.ok(chips.length <= 9, `expected no more than 9 static chips, found ${chips.length}`);
    assert.deepEqual(ids, [
      "adapterRepairGate",
      "adminChangeGate",
      "backgroundWorkerGate",
      "catalogGovernanceGate",
      "modeChip",
      "operatorAlertGate",
      "readinessGate",
      "sourceChannelGate",
      "trackalackerGate"
    ]);
    assert.doesNotMatch(dom.window.document.body.textContent || "", /DRY RUN|NEVER EXECUTES|FAIL CLOSED|NOT APPLIED|SANITIZED|ALL CLOSED/);
  } finally {
    dom.window.close();
  }
});

test("each retained chip is data-bound and uses calm state words", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const app = readFileSync(join(root, "app.js"), "utf8");
  const dom = new JSDOM(html);
  try {
    for (const chip of dom.window.document.querySelectorAll<HTMLElement>(".mode-chip[id]")) {
      assert.match(app, new RegExp(`#${chip.id}\\b|\\$\\{[^}]*${chip.id}`, "m"), `${chip.id} is not data-bound`);
    }
    assert.match(app, /trackalackerReady \? "OK"[\s\S]*?"Attention"[\s\S]*?"Off"/);
    assert.match(app, /actionableAttention \? "Attention" : "OK"/);
    assert.match(app, /deploymentMismatch \|\| activeProblems \? "Attention" : deployment\.healthy \? "OK" : "Off"/);
    assert.match(app, /open \? "Attention" : "OK"/);
    assert.match(app, /activeCount \? "Attention" : "OK"/);
    const total = (html.match(/class="mode-chip/g) || []).length + (app.match(/class="mode-chip/g) || []).length;
    assert.ok(total <= 10, `expected no more than 10 rendered chip sources, found ${total}`);
  } finally {
    dom.window.close();
  }
});
