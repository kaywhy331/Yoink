import assert from "node:assert/strict";
import test from "node:test";
import { adminBrowser, eventually } from "./helpers/admin-restoration.js";

test("Admin retry when sold out shows the actual policy and saves tries and minutes", async () => {
  // Kevin, 2026-10-09: "add a config to auto retry the sku X amount of times over Y amount of timeframe".
  const { browser, requests } = await adminBrowser();
  try {
    await eventually(() => assert.equal(browser.document.querySelector("#adminRestockRetrySummary")?.textContent, "Off: a sold-out item waits for the next call."));
    (browser.document.querySelector('[data-admin-settings-view="automation"]') as HTMLButtonElement).click();
    (browser.document.querySelector("#adminRestockRetryForm")!.closest("details") as HTMLDetailsElement).open = true;
    const form = browser.document.querySelector("#adminRestockRetryForm") as HTMLFormElement;
    await eventually(() => assert.match(browser.document.querySelector("#adminRestockRetrySummary")?.textContent ?? "", /^Off: a sold-out item waits for the next call\.$/));
    const elements = form.elements as unknown as Record<string, HTMLInputElement>;
    assert.equal(elements.enabled!.checked, false);
    assert.equal((form.querySelector(".restock-retry-fields") as HTMLElement).hidden, true);
    elements.enabled!.checked = true;
    elements.attempts!.value = "4";
    elements.windowMinutes!.value = "12";
    form.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((form.querySelector(".restock-retry-fields") as HTMLElement).hidden, false);
    assert.equal(browser.document.querySelector("#adminRestockRetrySummary")?.textContent,
      "Up to 4 more tries, about every 3 min, within 12 minutes of the first. Each try checks the price, seller and stock again before adding, and never adds a second one.");
    elements.attempts!.value = "11";
    form.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(browser.document.querySelector("#adminRestockRetrySummary")?.textContent, "Tries are 1 to 10, over 1 to 60 minutes.");
    elements.attempts!.value = "4";
    form.dispatchEvent(new browser.Event("input", { bubbles: true }));
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.ok(requests.some((request) => request.path === "/api/v1/admin/settings/restock-retry")));
    const save = requests.find((request) => request.path === "/api/v1/admin/settings/restock-retry")!;
    assert.equal(save.method, "PATCH");
    assert.deepEqual(save.body, { enabled: true, attempts: 4, windowMinutes: 12 });
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Retry when sold out is on\./));
    assert.equal(browser.document.querySelector("#adminRetryStatus")?.textContent, "Retry policy saved.");
  } finally {
    browser.close();
  }
});

function fields(browser: Window & typeof globalThis) {
  const form = browser.document.querySelector('#adminRestockRetryForm') as HTMLFormElement;
  const inputs = form.elements as unknown as Record<string, HTMLInputElement>;
  return { form, inputs, input: () => form.dispatchEvent(new browser.Event('input', { bubbles: true })),
    submit: () => form.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true })) };
}

test('admin retry policy preserves focused and dirty edits across refresh and save', async () => {
  let release: (() => void) | undefined;
  const fixture = await adminBrowser({ respond: async request => {
    if (request.method !== 'PATCH') return;
    await new Promise<void>(resolve => { release = resolve; });
    return undefined;
  } });
  try {
    const { browser } = fixture;
    const { form, inputs, input, submit } = fields(browser);
    inputs.enabled!.checked = true; inputs.attempts!.value = '4'; inputs.windowMinutes!.value = '12'; input();
    inputs.attempts!.focus();
    fixture.snapshot.settings.restockRetry = { enabled: false, attempts: 2, windowMinutes: 8 };
    await fixture.refresh();
    assert.equal(browser.document.activeElement, inputs.attempts);
    assert.equal(inputs.attempts!.value, '4'); assert.equal(inputs.windowMinutes!.value, '12');
    assert.equal((form.querySelector('.restock-retry-fields') as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector('#adminRestockRetrySummary')!.textContent!, /Up to 4 more tries/);
    submit(); submit();
    await eventually(() => assert.ok(release));
    assert.equal(fixture.requests.filter(r => r.method === 'PATCH').length, 1);
    inputs.attempts!.value = '5'; input();
    release!();
    await eventually(() => assert.equal(browser.document.querySelector('#adminRetryStatus')!.textContent, 'Retry policy saved.'));
    assert.equal(inputs.attempts!.value, '5'); assert.equal(form.dataset.dirty, 'true');
    assert.equal(browser.document.activeElement, inputs.attempts);
    assert.deepEqual(fixture.snapshot.settings.restockRetry, { enabled: true, attempts: 4, windowMinutes: 12 });
    await fixture.refresh(); assert.equal(inputs.attempts!.value, '5');
    assert.match(browser.document.querySelector('#adminRestockRetrySummary')!.textContent!, /Up to 5 more tries/);
  } finally { release?.(); fixture.close(); }
});

test('admin retry rejects invalid input without sending and keeps unknown outcomes distinct', async () => {
  let outcome: 'error' | 'unknown' | 'timeout' = 'error';
  const fixture = await adminBrowser({ respond: async request => {
    if (request.method !== 'PATCH') return;
    if (outcome === 'timeout') throw Object.assign(new Error('The request timed out. Check the current state before trying again; your change may have been saved.'), { code: 'request_timeout' });
    return outcome === 'error' ? { status: 409, body: { error: 'conflict', message: 'Policy refused', correlationId: 'retry-reference' } }
      : { status: 200, body: {} };
  } });
  try {
    const { browser } = fixture;
    const { inputs, input, submit } = fields(browser);
    inputs.enabled!.checked = true;
    for (const [attempts, minutes] of [['11','12'], ['0','12'], ['1.5','12'], ['', '12'], ['4','61'], ['4','0'], ['4','1.5'], ['4','']]) {
      inputs.attempts!.value = attempts!; inputs.windowMinutes!.value = minutes!; input(); submit();
      assert.equal(browser.document.querySelector('#adminRestockRetrySummary')!.textContent, 'Tries are 1 to 10, over 1 to 60 minutes.');
    }
    assert.equal(fixture.requests.filter(r => r.method === 'PATCH').length, 0);
    inputs.attempts!.value = '4'; inputs.windowMinutes!.value = '12'; input();
    for (const next of ['error', 'unknown', 'timeout'] as const) {
      outcome = next;
      browser.document.querySelector('#adminRetryStatus')!.textContent = '';
      submit();
      await eventually(() => assert.ok(browser.document.querySelector('#adminRetryStatus')!.textContent));
      const status = browser.document.querySelector('#adminRetryStatus')!.textContent!;
      assert.match(status, next === 'error' ? /Policy refused.*retry-reference/ : next === 'unknown' ? /outcome is unknown/ : /timed out.*may have been saved/);
      assert.doesNotMatch(browser.document.querySelector('#toast')!.textContent!, /Retry when sold out is (on|off)/);
      assert.doesNotMatch(status, /Retry policy saved/);
    }
    assert.equal(fixture.requests.filter(r => r.method === 'PATCH').length, 3);
  } finally { fixture.close(); }
});

test('admin retry reloads persisted on and off policies', async () => {
  const fixture = await adminBrowser({ respond: async request => request.path === '/api/v1/admin/discord'
    ? { status: 503, body: { message: 'Reader unavailable' } } : undefined });
  try {
    const { browser } = fixture;
    const { form, inputs, input, submit } = fields(browser);
    for (const [enabled, attempts, windowMinutes] of [[true,4,12], [false,3,5]] as const) {
      inputs.enabled!.checked = enabled; inputs.attempts!.value = String(attempts); inputs.windowMinutes!.value = String(windowMinutes); input();
      browser.document.querySelector('#adminRetryStatus')!.textContent = '';
      const reads = fixture.requests.filter(r => r.path.startsWith('/api/v1/admin/snapshot?')).length;
      submit();
      await eventually(() => assert.equal(browser.document.querySelector('#adminRetryStatus')!.textContent, 'Retry policy saved.'));
      assert.ok(fixture.requests.filter(r => r.path.startsWith('/api/v1/admin/snapshot?')).length > reads);
      assert.deepEqual(fixture.snapshot.settings.restockRetry, { enabled, attempts, windowMinutes });
      assert.match(browser.document.querySelector('#toast')!.textContent!, enabled ? /Retry when sold out is on\./ : /Retry when sold out is off\./);
      await fixture.refresh();
      assert.equal(inputs.enabled!.checked, enabled); assert.equal(inputs.attempts!.value, String(attempts));
      assert.equal(inputs.windowMinutes!.value, String(windowMinutes));
      assert.equal((form.querySelector('.restock-retry-fields') as HTMLElement).hidden, !enabled);
    }
    fixture.snapshot.settings.restockRetry = undefined;
    await fixture.refresh();
    assert.equal(browser.document.querySelector('#adminRestockRetrySummary')!.textContent, 'Retry policy is unavailable. Reload before editing.');
    for (const element of form.querySelectorAll('input, button')) assert.equal((element as HTMLInputElement).disabled, true);
  } finally { fixture.close(); }
});

test('admin retry range feedback and spacing follow the admin snapshot limits', async () => {
  const fixture = await adminBrowser({ policy: { enabled: true, attempts: 4, windowMinutes: 1 } });
  try {
    fixture.snapshot.restockRetryLimits = { attempts: { min: 2, max: 6 }, windowMinutes: { min: 1, max: 20 }, minSpacingSeconds: 45 };
    await fixture.refresh();
    const { browser } = fixture;
    const { inputs, input, submit } = fields(browser);
    assert.match(browser.document.querySelector('#adminRestockRetrySummary')!.textContent!, /about every 45 s/);
    inputs.attempts!.value = '7'; input(); submit();
    assert.equal(browser.document.querySelector('#adminRestockRetrySummary')!.textContent, 'Tries are 2 to 6, over 1 to 20 minutes.');
    assert.equal(fixture.requests.filter(r => r.method === 'PATCH').length, 0);
    assert.equal(inputs.attempts!.min, '2'); assert.equal(inputs.attempts!.max, '6');
    assert.equal(inputs.windowMinutes!.max, '20');
    fixture.snapshot.restockRetryLimits.attempts.max = 12;
    fixture.snapshot.restockRetryLimits.windowMinutes.max = 90;
    await fixture.refresh();
    inputs.attempts!.value = '11'; inputs.windowMinutes!.value = '75'; input();
    assert.equal(inputs.attempts!.checkValidity(), true);
    assert.equal(inputs.windowMinutes!.checkValidity(), true);
    assert.equal(inputs.attempts!.max, '12'); assert.equal(inputs.windowMinutes!.max, '90');
    assert.match(browser.document.querySelector('#adminRestockRetrySummary')!.textContent!, /Up to 11 more tries/);
  } finally { fixture.close(); }
});
