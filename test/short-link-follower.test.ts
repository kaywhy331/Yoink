import assert from "node:assert/strict";
import test from "node:test";
import { shortLinkFollower, type ShortLinkFetch } from "../packages/engine/src/short-link-follower.js";

// Kevin, 2026-10-13: Discord restock messages link stores through short links
// (amzn.to, bit.ly, Mavely, Impact); Yoink follows them to the store item.

function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const asked: string[] = [];
  const fetch: ShortLinkFetch = async (url, init) => {
    asked.push(url);
    assert.equal(init.redirect, "manual", "each hop is checked before it is followed");
    const route = routes[url];
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route();
  };
  return { fetch, asked };
}

const redirect = (location: string, status = 301) => () => new Response(null, { status, headers: { location } });

test("a short link is followed hop by hop to the store item, and the store's page is never opened", async () => {
  const { fetch, asked } = fakeFetch({
    "https://amzn.to/4abc": redirect("https://www.amazon.com/dp/B0GRSZ5TDC?tag=someone-20&th=1"),
    "https://bit.ly/3walmart": redirect("https://goto.walmart.com/c/1/2/3?u=https%3A%2F%2Fwww.walmart.com%2Fip%2F17000001", 302),
    "https://howl.me/relative": redirect("/link?url=https%3A%2F%2Fwww.target.com%2Fp%2F-%2FA-94972381"),
    "https://howl.me/link?url=https%3A%2F%2Fwww.target.com%2Fp%2F-%2FA-94972381": redirect("https://www.target.com/p/-/A-94972381")
  });
  const follow = shortLinkFollower({ fetch });
  const followed = await follow(["https://amzn.to/4abc", "https://bit.ly/3walmart", "https://howl.me/relative"]);
  assert.deepEqual(followed["https://amzn.to/4abc"]?.item, { retailerId: "amazon", retailerSku: "B0GRSZ5TDC", canonicalUrl: "https://www.amazon.com/dp/B0GRSZ5TDC" });
  assert.equal(followed["https://amzn.to/4abc"]?.landing, "https://www.amazon.com/dp/B0GRSZ5TDC?tag=someone-20&th=1", "where it landed, as written");
  assert.equal(followed["https://bit.ly/3walmart"]?.item?.canonicalUrl, "https://www.walmart.com/ip/17000001");
  assert.equal(followed["https://howl.me/relative"]?.item?.canonicalUrl, "https://www.target.com/p/-/A-94972381");
  // The Impact link named the item itself, so it was never asked; no store page was ever asked.
  assert.deepEqual(asked.sort(), ["https://amzn.to/4abc", "https://bit.ly/3walmart", "https://howl.me/relative"].sort());
});

test("a redirect page (Mavely, Branch) is read for the one store item it sends the browser to", async () => {
  const page = `<html><script>window.top.location = validate("https:\\/\\/www.walmart.com\\/ip\\/Pokemon\\/17000001?athcpid=1");</script>
    <a href="https://apps.apple.com/app/id1">App</a></html>`;
  const { fetch } = fakeFetch({
    "https://mavely.app.link/abc": () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }),
    "https://mavely.app.link/two": () => new Response("https://www.target.com/p/-/A-94972381 https://www.walmart.com/ip/17000001", { status: 200 })
  });
  const followed = await shortLinkFollower({ fetch })(["https://mavely.app.link/abc", "https://mavely.app.link/two"]);
  assert.equal(followed["https://mavely.app.link/abc"]?.item?.retailerSku, "17000001");
  assert.equal(followed["https://mavely.app.link/two"]?.item, null, "two different items is no item");
});

test("a link to anywhere else, an error, a loop or a slow service leads to no item", async () => {
  const { fetch, asked } = fakeFetch({
    "https://bit.ly/away": redirect("https://evil.example/collect?id=1"),
    "https://bit.ly/broken": () => { throw new Error("network down"); },
    "https://bit.ly/missing": () => new Response("gone", { status: 404 }),
    "https://bit.ly/loop": redirect("https://tinyurl.com/loop"),
    "https://tinyurl.com/loop": redirect("https://bit.ly/loop"),
    "https://bit.ly/slow": () => new Promise<Response>(() => undefined)
  });
  const follow = shortLinkFollower({ fetch, timeoutMs: 300, maxHops: 4 });
  const started = Date.now();
  const followed = await Promise.race([
    follow(["https://bit.ly/away", "https://bit.ly/broken", "https://bit.ly/missing", "https://bit.ly/loop"]),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("follower hung")), 5_000))
  ]);
  assert.deepEqual(Object.values(followed).map((link) => link.item), [null, null, null, null]);
  // Where a link stopped is kept, so the call can say where it lands.
  assert.equal(followed["https://bit.ly/away"]?.landing, "https://evil.example/collect?id=1");
  assert.ok(!asked.includes("https://evil.example/collect?id=1"), "a site that isn't a short-link service is never asked");
  assert.equal(asked.filter((url) => url.endsWith("/loop")).length, 4, "a loop stops at the hop limit");
  // A service that never answers gives up at the time limit.
  const slow = await shortLinkFollower({
    fetch: (url, init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    timeoutMs: 300
  })(["https://bit.ly/slow"]);
  assert.deepEqual(slow["https://bit.ly/slow"], { item: null, landing: "" });
  assert.ok(Date.now() - started < 4_000);
});
