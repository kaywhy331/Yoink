import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

// The Yoink mark (Kevin, 2026-10-09): a script check mark with a stem drawn
// down from its point, forming a Y. One drawing everywhere it appears.
const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const userJs = read("apps", "web", "user.js");
const check = /const YOINK_MARK_CHECK = "([^"]+)";/.exec(userJs)?.[1] ?? "";
const stem = /const YOINK_MARK_STEM = "([^"]+)";/.exec(userJs)?.[1] ?? "";

/** Absolute cubic Béziers [x0, y0, x1, y1, x2, y2, x3, y3] of an "M x y c …" path. */
function beziers(path: string): number[][] {
  const numbers = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  let [x, y] = numbers;
  const curves: number[][] = [];
  for (let index = 2; index + 6 <= numbers.length; index += 6) {
    const [a, b, c, d, e, f] = numbers.slice(index, index + 6);
    curves.push([x!, y!, x! + a!, y! + b!, x! + c!, y! + d!, x! + e!, y! + f!]);
    x! += e!;
    y! += f!;
  }
  return curves;
}

test("the Yoink mark is the same two strokes in the app, favicon, companion and tray", () => {
  assert.ok(check.startsWith("M") && stem.startsWith("M"));
  const checkCurves = beziers(check);
  const stemCurves = beziers(stem);
  assert.equal(checkCurves.length, 2, "the check is two curves");
  assert.equal(stemCurves.length, 1, "the stem is one curve");
  const vertex = checkCurves[0]!.slice(6);
  assert.deepEqual(stemCurves[0]!.slice(0, 2), vertex, "the stem starts at the check's point");
  assert.ok(stemCurves[0]![7]! > vertex[1]!, "the stem goes down");

  for (const page of ["user.html", "index.html", "docs.html", "privacy.html", "remove.html"]) {
    const html = read("apps", "web", page);
    assert.match(html, /<svg class="yoink-mark" viewBox="0 0 64 64" aria-hidden="true"/, `${page} draws the mark`);
    assert.ok(html.includes(`d="${check}"`) && html.includes(`d="${stem}"`), `${page} uses the same strokes`);
    assert.doesNotMatch(html, /<span(?: class="brand-mark"[^>]*)?>Y<\/span>/, `${page} no longer shows a plain letter Y`);
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/, `${page} links the favicon`);
  }
  for (const icon of [["apps", "web", "favicon.svg"], ["apps", "extension", "yoink-icon.svg"]]) {
    const svg = read(...icon);
    assert.ok(svg.includes(`d="${check}"`) && svg.includes(`d="${stem}"`), `${icon.join("/")} uses the same strokes`);
  }
  // The tray draws it with GraphicsPath.AddBezier in the same 64-unit box.
  const tray = read("apps", "windows-tray", "src", "Tray", "TrayIcons.cs");
  const drawn = [...tray.matchAll(/AddBezier\(([^)]+)\)/g)].map((match) => match[1]!.split(",").map((value) => Number.parseFloat(value)));
  assert.deepEqual(drawn, [...checkCurves, ...stemCurves], "the tray icon draws the same curves");
  assert.doesNotMatch(tray, /DrawString\("Y"/);
});

test("the companion's PNG icon is the 128 px mark the notifications use", () => {
  const png = readFileSync(join(root, "apps", "extension", "yoink-icon-128.png"));
  assert.deepEqual([...png.subarray(12, 16)].map((byte) => String.fromCharCode(byte)).join(""), "IHDR");
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
});

test("the favicon is served as SVG", async () => {
  const server = createYoinkServer({ db: new YoinkDatabase(), webRoot: join(root, "apps", "web"), version: "0.0.0-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/favicon.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.ok(response.headers.get("etag"));
    assert.ok((await response.text()).includes(`d="${check}"`));
  } finally {
    server.close();
    await once(server, "close");
  }
});
