import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("the user docs, machine guide, and release announcement share the current bounded action language", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "1.18.0"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const docs = await fetch(`${baseUrl}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get("content-type") || "", /^text\/html/);
    const docsBody = await docs.text();
    assert.match(docsBody, /Ready to check out/);
    assert.match(docsBody, /Drop watch/);
    assert.match(docsBody, /read-only observation/);
    assert.match(docsBody, /Checkout remains manual/);
    assert.doesNotMatch(docsBody, /automatic checkout/i);

    const llms = await fetch(`${baseUrl}/llms.txt`);
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get("content-type") || "", /^text\/plain/);
    assert.match(await llms.text(), /Exact cart \+1 proof/);

    const overview = await fetch(`${baseUrl}/api/v1/user/overview`).then((response) => response.json()) as {
      announcement: { id: string; version: string; docsUrl: string; highlights: string[] };
      qualificationCandidates: unknown[];
    };
    assert.equal(overview.announcement.id, "yoink-1-18-0-trusted-signal-cart-trigger");
    assert.equal(overview.announcement.version, "1.18.0");
    assert.equal(overview.announcement.docsUrl, "/docs");
    assert.equal(overview.announcement.highlights.length, 3);
    assert.deepEqual(overview.qualificationCandidates, []);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
