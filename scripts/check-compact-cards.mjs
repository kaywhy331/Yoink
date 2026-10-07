// Loopback-only review. Separate in-memory data, never the installed database.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createYoinkServer } from '../apps/api/src/app.ts';
import { YoinkDatabase } from '../packages/database/src/database.ts';
import { CatalogRepository } from '../packages/database/src/catalog-repository.ts';
import { ControlRepository } from '../packages/database/src/control-repository.ts';
import { PRODUCT_WANT_CONTRACT_VERSION, PRODUCT_WANT_PREVIEW_CONFIRMATION, PRODUCT_WANT_SAVE_CONFIRMATION } from '../packages/contracts/src/index.ts';

const dir = 'data/ui-review';
await mkdir(dir, { recursive: true });
const db = new YoinkDatabase();
const catalog = new CatalogRepository(db), control = new ControlRepository(db);
const fixturePath = process.env.YOINK_CARD_CATALOG_FIXTURE || `${dir}/catalog-snapshot.json`;
const snapshot = existsSync(fixturePath) ? JSON.parse(await readFile(fixturePath, 'utf8')).items.slice(0, 12)
  : Array.from({ length: 12 }, (_, i) => ({ title: `Card review fixture product ${i + 1}`, imageUrl: i === 0 ? 'https://images.example.test/unavailable.png' : '', listings: [{ retailerId: 'bestbuy', retailerSku: String(6626490 + i), canonicalUrl: `https://www.bestbuy.com/site/-/${6626490 + i}.p`, status: 'out_of_stock', currentPriceCents: 1999 + i * 100, availabilityObservedAt: new Date(Date.now() - 2 * 86400_000).toISOString() }] }));
const seeded = [];
for (const [i, group] of snapshot.entries()) {
  const bestbuy = group.listings.find(l => l.retailerId === 'bestbuy' && l.offerRole !== 'alternate') || group.listings[0];
  const listing = catalog.upsertListing({
    sourceConnectionId: 'source_trackalacker_local', source: 'trackalacker', sourceProductId: `ui-review-${i}`,
    sourceListingId: `ui-review-listing-${i}`, title: group.title,
    retailerId: bestbuy.retailerId, retailerSku: bestbuy.retailerSku, canonicalUrl: bestbuy.canonicalUrl,
    listingStatus: bestbuy.status, executionSupported: true, observedPriceCents: bestbuy.currentPriceCents,
    msrpCents: bestbuy.msrpCents, currency: 'USD', observedAt: bestbuy.availabilityObservedAt
  }).listing;
  db.run('UPDATE variants SET image_url = ? WHERE id = ?', group.imageUrl || '', listing.variantId);
  const input = { contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId: listing.id, mode: 'notify', confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION };
  const preview = control.previewProductWant(input);
  const saved = control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION, previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt });
  if (i % 2 === 0) db.run("UPDATE missions SET origin = 'signal:trackalacker' WHERE id = ?", saved.purchaseIntentId);
  seeded.push({ ...listing, missionId: saved.purchaseIntentId });
}
// A separate synthetic item exercises successful decode, fresh timestamps and Howl.
function seedImageFixture() {
const synthetic = catalog.upsertListing({ sourceConnectionId: 'source_trackalacker_local', source: 'trackalacker', sourceProductId: 'ui-review-image-fixture', sourceListingId: 'ui-review-image-fixture', title: 'Fixture image and link verification', retailerId: 'target', retailerSku: '95111111', canonicalUrl: 'https://www.target.com/p/-/A-95111111', executionSupported: true, listingStatus: 'in_stock', observedPriceCents: 2499, currency: 'USD', observedAt: new Date(Date.now() - 43 * 60_000).toISOString() }).listing;
db.run("UPDATE variants SET image_url = 'https://images.example.test/fixture.svg' WHERE id = ?", synthetic.variantId);
const input = { contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId: synthetic.id, mode: 'notify', confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION };
const preview = control.previewProductWant(input);
control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION, previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt });
}

// Preserve baseline web assets from the reviewed-source snapshot for matched before views.
const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baselineRoot = `${dir}/before-web`;
await mkdir(baselineRoot, { recursive: true });
for (const file of execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'apps/web'], { encoding: 'utf8' }).trim().split('\n')) {
  const local = `${baselineRoot}/${file.replace('apps/web/', '')}`;
  await mkdir(local.slice(0, local.lastIndexOf('/')), { recursive: true });
  await writeFile(local, execFileSync('git', ['show', `${baseline}:${file}`]));
}
const servers = [], errors = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.YOINK_TEST_CHROME || '/home/trix/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' });
  for (const phase of ['before', 'after']) {
    const server = createYoinkServer({ db, version: '1.30.0', webRoot: `${process.cwd()}/${phase === 'before' ? baselineRoot : 'apps/web'}` });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url === 'https://images.example.test/fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#e6f5ed"/><text x="120" y="75" text-anchor="middle" fill="#0b6851" font-family="sans-serif" font-size="20">Fixture image</text></svg>' });
      return url.startsWith(`${origin}/`) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${phase}: ${e.message}`));
    for (const size of phase === 'before' ? [1440, 3440] : [1440, 3440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width: size, height: size === 3440 ? 1440 : 1100 });
      for (const panel of ['find', 'cart']) {
        await page.goto(`${origin}/#${panel}`);
        await page.reload();
        const list = page.locator(panel === 'find' ? '#productList' : '#planList');
        await list.locator('article').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        await page.evaluate(() => window.scrollTo(0, 0));
        if (phase === 'after') {
          const layout = await list.evaluate(el => ({ cols: getComputedStyle(el).gridTemplateColumns.split(' ').length, count: el.querySelectorAll('.compact-product-card').length, width: document.documentElement.scrollWidth, viewport: innerWidth }));
          assert.equal(layout.cols, size >= 1100 ? 4 : size >= 850 ? 3 : size >= 560 ? 2 : 1, `${panel} columns at ${size}`);
          assert.ok(layout.count >= 12);
          assert.ok(layout.width <= layout.viewport, `${panel}: no overflow at ${size}`);
          const order = await list.locator('.compact-product-card').first().evaluate(card => {
            const nodes = ['.card-media', 'h3', '.card-metadata', '.product-price', '.card-actions'].map(selector => card.querySelector(selector).getBoundingClientRect());
            return nodes.every((n, i) => i === 0 || n.top >= nodes[i - 1].bottom - 1);
          });
          assert.ok(order, 'image, title, evidence, price, actions in vertical order');
          checks.push(`${panel}: ${size}px, ${layout.cols} columns, no overflow, ordered card content`);
        }
        if ([1440, 3440, 768, 390].includes(size)) {
          await page.screenshot({ path: `${dir}/${phase}-${panel}-${size}.png`, fullPage: false });
          if (size === 1440) await list.screenshot({ path: `${dir}/${phase}-${panel}-cards.png` });
        }
      }
    }
    if (phase === 'after') {
      seedImageFixture();
      await page.setViewportSize({ width: 1440, height: 1100 });
      const api = await (await fetch(`${origin}/api/v1/user/purchase-intents`)).json();
      assert.ok(api.items.every(p => p.cardListing?.listingId === p.primaryListingId));
      const fixturePlan = api.items.find(p => p.title === 'Fixture image and link verification');
      assert.equal(fixturePlan.cardListing.availabilitySource, 'trackalacker');
      assert.match(fixturePlan.cardListing.availabilityObservedAt, /^\d{4}-/);
      for (const panel of ['find', 'cart']) {
        await page.goto(`${origin}/#${panel}`);
        await page.reload();
        const list = page.locator(panel === 'find' ? '#productList' : '#planList');
        await list.locator('.compact-product-card').first().waitFor();
        const card = list.locator('.compact-product-card').filter({ hasText: 'Fixture image and link verification' });
        await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForFunction(() => [...document.querySelectorAll('[data-product-image]')].some(img => img.src.includes('fixture.svg') && img.complete && img.naturalWidth > 0));
        assert.equal(await card.locator('.media-fallback').isVisible(), false);
        assert.match(await card.locator('.product-observation').innerText(), /Reported 43 min/);
        const hrefs = await card.locator('a').evaluateAll(links => links.map(a => a.href));
        assert.equal(hrefs.length, 2); assert.equal(hrefs[0], hrefs[1]);
        const href = new URL(hrefs[0]);
        assert.equal(href.origin, 'https://howl.link');
        assert.equal(href.searchParams.get('publisher_slug'), 'collectwithdodo');
        assert.equal(href.searchParams.get('url'), 'https://www.target.com/p/-/A-95111111');
        const directLinks = await list.locator('.compact-product-card[data-store="bestbuy"]').first().locator('a').evaluateAll(links => links.map(a => ({ href: a.href, sponsored: a.rel.includes('sponsored') })));
        assert.equal(directLinks.length, 2); assert.equal(directLinks[0].href, directLinks[1].href);
        assert.equal(new URL(directLinks[0].href).hostname, 'www.bestbuy.com');
        assert.equal(directLinks[0].sponsored, false, 'unconfigured Howl store keeps the existing direct route');
        // Repeated keyboard opening/closing of both dialogs must return focus.
        for (let iteration = 0; iteration < 3; iteration++) {
          const want = card.locator('[data-want-listing]');
          await want.focus(); await page.keyboard.press('Enter');
          await page.locator('#wantDialog[open]').waitFor();
          await page.keyboard.press('Escape');
          await page.locator('#wantDialog').waitFor({ state: 'hidden' });
          assert.equal(await want.evaluate(el => el === document.activeElement), true, `${panel} Want it focus return`);
          const details = card.locator('[data-product-detail]');
          await details.focus(); await page.keyboard.press('Enter');
          await page.locator('#productDialog[open]').waitFor();
          await page.keyboard.press('Escape');
          await page.locator('#productDialog').waitFor({ state: 'hidden' });
          assert.equal(await details.evaluate(el => el === document.activeElement), true, `${panel} Details focus return`);
        }
        // Browser history should reopen and close product details without duplicating cards.
        await card.locator('[data-product-detail]').click();
        await page.locator('#productDialog[open]').waitFor();
        await page.goBack(); await page.locator('#productDialog').waitFor({ state: 'hidden' });
        await page.goForward(); await page.locator('#productDialog[open]').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await list.locator('.compact-product-card').count(), 13);
        checks.push(`${panel}: loaded image, correct identical Howl links, 43-minute source report, 3 keyboard Want it/Details cycles, focus return, back/forward`);
      }
      // Missing and failed resources retain an explicit fallback, never a broken icon.
      await page.goto(`${origin}/#find`);
      await page.locator('#productList .compact-product-card').first().waitFor();
      await page.locator('#productList .compact-product-card').last().scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      assert.ok(await page.getByText('Image unavailable', { exact: true }).count() > 0);
      assert.ok(await page.getByText('Image could not load', { exact: true }).count() > 0);
      assert.equal(await page.locator('[data-product-image]').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth === 0).length), 0);
      checks.push('Missing URL and blocked/failed URL fallbacks; no broken image nodes');
    }
    await context.close();
  }
  assert.equal(db.get('SELECT COUNT(*) AS n FROM action_jobs').n, 0);
  assert.equal(db.get('SELECT actions_paused FROM app_settings').actions_paused, 1);
  assert.deepEqual(errors, []);
  checks.push('Zero action jobs, actions paused, external browser traffic blocked, zero page errors');
  await writeFile(`${dir}/browser-checks.json`, JSON.stringify({ baseline, checks, errors }, null, 2));
  console.log(checks.map(c => `PASS: ${c}`).join('\n'));
} finally {
  await browser?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  db.close();
}
