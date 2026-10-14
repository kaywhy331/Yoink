import { expect, test } from "@playwright/test";

test("YoinkBot opt-in setup works on a phone-sized screen and clears entered credentials", async ({ page }, testInfo) => {
  page.on("pageerror", error => { throw error; });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, route => route.abort());
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/user/connectors/yoinkbot/**", route => {
    requests.push(route.request().postDataJSON());
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({json: path.endsWith("/telegram")
      ? {pairing: {id: "fixture_pairing", url: "https://t.me/YoinkFixtureBot?start=fixture", expiresAt: new Date(Date.now() + 600000).toISOString()}}
      : {pending: false, connector: {id: "fixture_connector"}}});
  });
  await page.goto("/#setup/alerts");
  const form = page.locator("#yoinkBotForm");
  await expect(page.locator("#yoinkBotSetup")).toContainText("same store account on your phone and computer");
  await form.locator('[name="secret"]').fill("fixture-discord-secret");
  await form.getByRole("button", {name: "Connect Discord"}).click();
  expect(requests).toHaveLength(0);
  await form.locator('[name="optedIn"]').check();
  await form.getByRole("button", {name: "Connect Discord"}).click();
  await expect(page.locator("#yoinkBotStatus")).toContainText("Discord connected");
  await expect(form.locator('[name="secret"]')).toHaveValue("");
  expect(requests[0]).toMatchObject({optedIn: true, webhookUrl: "fixture-discord-secret"});
  await form.locator('[name="provider"]').selectOption("telegram");
  await expect(page.locator("#yoinkBotHelp")).toContainText("BotFather");
  await form.locator('[name="secret"]').fill("fixture-telegram-secret");
  await form.getByRole("button", {name: "Connect Telegram"}).click();
  await expect(page.locator("#yoinkBotStartLink")).toHaveAttribute("href", "https://t.me/YoinkFixtureBot?start=fixture");
  await expect(form.locator('[name="secret"]')).toHaveValue("");
  await page.locator("#yoinkBotVerify").click();
  await expect(page.locator("#yoinkBotStatus")).toContainText("Telegram connected");
  await expect(page.locator("#yoinkBotPairing")).toBeHidden();
  expect(requests[1]).toMatchObject({optedIn: true, token: "fixture-telegram-secret"});
  expect(requests[2]).toEqual({id: "fixture_pairing"});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("yoinkbot-setup-mobile.png"), fullPage: true});
});
