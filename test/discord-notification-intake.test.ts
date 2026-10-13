import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { WindowsNotificationWatcher, windowsNotificationDatabasePath } from "../apps/api/src/windows-notification-watcher.js";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import {
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  type ProductWantInput
} from "../packages/contracts/src/index.js";
import { describeCallRow } from "../packages/domain/src/call-result.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DiscordNotificationRepository } from "../packages/database/src/discord-notification-repository.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { SignalProviderRepository } from "../packages/database/src/signal-provider-repository.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import {
  DISCORD_NOTIFICATION_SCOPE,
  DiscordNotificationIntake,
  type CapturedDiscordNotification
} from "../packages/engine/src/discord-notification-intake.js";
import { DurableSignalIngressProcessor, DurableSignalIngressService } from "../packages/engine/src/signal-ingress.js";
import type { DiscordIntakeResult } from "../packages/engine/src/discord-notification-intake.js";
import {
  BRAVE_APP_ID,
  DISCORD_APP_ID,
  OUTLOOK_APP_ID,
  browserToastXml,
  createNotificationCentre,
  discordDesktopToastXml
} from "./helpers/discord-toasts.js";

// Kevin, 2026-10-12: "make it discord signal will be able to be captured by
// various notifications that populates to my windows notification tab and be
// able to trace the listing to the yoink product."
const NOW = Date.parse("2026-10-13T05:00:00.000Z");
const process_cwd = () => globalThis.process.cwd();
const WORKER_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "provider_signal_worker",
  internalServiceCapability: "internal.delivery"
};

function fixture() {
  const db = new YoinkDatabase();
  for (const retailer of ["target", "walmart", "amazon", "bestbuy"]) {
    db.run("UPDATE retailers SET execution_supported=1 WHERE id=?", retailer);
  }
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  const catalog = new CatalogRepository(db);
  const add = (product: string, title: string, retailerId: string, retailerSku: string, canonicalUrl: string) => {
    const listing = catalog.upsertListing({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
      sourceProductId: product, sourceListingId: `${product}-${retailerId}`, title, retailerId, retailerSku, canonicalUrl,
      executionSupported: true, listingStatus: "in_stock", observedPriceCents: 4999, currency: "USD",
      observedAt: new Date(NOW - 3_600_000).toISOString() }, NOW - 3_600_000).listing;
    db.run("UPDATE listings SET execution_supported=1 WHERE id=?", listing.id);
    return listing;
  };
  const ascendedTarget = add("ascended-etb", "Pokemon Ascended Heroes Elite Trainer Box", "target", "94972381",
    "https://www.target.com/p/-/A-94972381");
  const ascendedWalmart = add("ascended-etb", "Pokemon Ascended Heroes Elite Trainer Box", "walmart", "17000001",
    "https://www.walmart.com/ip/17000001");
  add("celebration-etb", "Pokemon 30th Celebration Elite Trainer Box", "target", "95120000", "https://www.target.com/p/-/A-95120000");
  const gummy = add("gummy-bear", "NeeDoh Gummy Bear", "walmart", "1234567", "https://www.walmart.com/ip/1234567");
  add("ascended-tin", "Pokemon Mega Evolution Ascended Heroes Tin", "bestbuy", "6680138", "https://www.bestbuy.com/site/-/6680138.p");
  add("lorcana-pack", "Disney Lorcana Attack of the Vine Booster Pack", "amazon", "B0LORCANA1", "https://www.amazon.com/dp/B0LORCANA1");
  // The shopper wants the Ascended Heroes ETB at Target, added to the cart.
  const lane = ADD_LANES.target;
  db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,
    evidence_hash,qualified_at,updated_at,expires_at) VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`,
  LOCAL_TENANT_ID, LOCAL_USER_ID, "target", lane.contractVersion, new Date(NOW).toISOString(), new Date(NOW).toISOString(),
  new Date(NOW + 60 * 60_000).toISOString());
  db.run("UPDATE app_settings SET execution_mode='live', actions_paused=0");
  const control = new ControlRepository(db);
  const input = { contractVersion: 1 as const, listingId: ascendedTarget.id, mode: "add_to_cart" as const,
    maxUnitPriceCents: 4999, confirmedMsrpCents: 4999, targetQuantity: 1,
    confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION } satisfies ProductWantInput;
  const preview = control.previewProductWant(input, NOW - 30_000);
  assert.equal(preview.canSave, true, preview.summary);
  control.saveProductWant({ ...input, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
    previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt }, NOW - 30_000);
  const ingress = new DurableSignalIngressService(db);
  const intake = new DiscordNotificationIntake(db, ingress);
  let sequence = 0;
  const notify = (title: string, body: string, at = NOW - 3_000, app: "desktop" | "browser" = "desktop"): DiscordIntakeResult => {
    sequence += 1;
    const notification: CapturedDiscordNotification = {
      reference: `wpn:${sequence}:${at}`,
      arrivedAt: at,
      toast: { app, title, body }
    };
    return intake.accept(notification, NOW + sequence);
  };
  const process = (at = NOW + 1_000) => runWithRequestScope(WORKER_SCOPE, () => new DurableSignalIngressProcessor(db).processBatch(at));
  const calls = () => new SignalRepository(db).listSignals(50, 0, "");
  return { db, intake, notify, process, calls, ascendedTarget, ascendedWalmart, gummy };
}

test("a Discord notification with a store link becomes a call traced to that Yoink listing, and the plan adds it to the cart", () => {
  const { db, notify, process, calls, ascendedTarget, ascendedWalmart } = fixture();
  try {
    assert.equal(ascendedTarget.variantId, ascendedWalmart.variantId, "one product at two stores");
    const result = notify("Restock Bot (#target-restocks, Cook Group)",
      "Pokemon Ascended Heroes ETB is LIVE $49.99\nhttps://www.target.com/p/pokemon-ascended-heroes/-/A-94972381");
    assert.equal(result.outcome, "call", result.reason);
    assert.equal(result.traceMethod, "link");
    assert.equal(result.channelName, "#target-restocks · Cook Group");
    assert.match(result.reason, /matched the Target link in the message to Pokemon Ascended Heroes Elite Trainer Box at Target/);
    const processed = process();
    assert.equal(processed.signalMessagesProcessed, 1);
    assert.equal(processed.signalActionJobsCreated, 1);
    const [call] = calls();
    assert.equal(call?.source, "discord");
    assert.equal(call?.title, "Pokemon Ascended Heroes Elite Trainer Box");
    assert.equal(call?.listingId, ascendedTarget.id);
    assert.equal(call?.resolutionStatus, "matched");
    assert.equal(call?.actionJobState, "awaiting_executor");
    assert.equal(call?.actionJobAction, "add_to_cart");
    assert.equal(call?.unitPriceCents, 4999, "the message's price is the call's");
    const observed = db.get<{ price: number | null; availability: string }>(
      "SELECT unit_price_cents AS price, availability FROM offer_observations WHERE listing_id = ? ORDER BY created_at DESC LIMIT 1",
      ascendedTarget.id);
    assert.deepEqual({ ...observed }, { price: null, availability: "in_stock" }, "chat text never enters price history");
    const channels = runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => new SignalProviderRepository(db).listChannels("discord"));
    assert.equal(channels.length, 1);
    assert.equal(channels[0]?.id, call?.sourceChannelId);
    assert.equal(channels[0]?.trustLevel, "trusted_exact");
    assert.equal(channels[0]?.autoCreateMissions, false);
    assert.equal(channels[0]?.acceptedEventCount, 1);
    const event = db.get<{ evidence: string; identity: string }>(
      "SELECT evidence_json AS evidence, identity_json AS identity FROM signal_events WHERE source = 'discord'");
    const evidence = JSON.parse(String(event?.evidence));
    assert.match(evidence.headline, /^Restock Bot \(#target-restocks, Cook Group\): Pokemon Ascended Heroes ETB is LIVE \$49\.99/);
    assert.match(evidence.body, /Target link in the message/);
    assert.equal(evidence.clickUrl, "https://www.target.com/p/-/A-94972381");
  } finally {
    db.close();
  }
});

test("a product name traces the call to the Yoink product at the store the message names", () => {
  const { db, notify, process, calls, ascendedWalmart, gummy } = fixture();
  try {
    const walmart = notify("Bot (#restocks, Cook Group)", "Ascended Heroes ETB restock at Walmart!");
    assert.equal(walmart.outcome, "call", walmart.reason);
    assert.equal(walmart.traceMethod, "name");
    assert.match(walmart.reason, /matched the product name \(\d+% match\) to Pokemon Ascended Heroes Elite Trainer Box at Walmart/);
    // No store named: the product's only store is the one checked.
    const gummyCall = notify("Bot (#restocks, Cook Group)", "NeeDoh Gummy Bear restock");
    assert.match(gummyCall.reason, /names no store; Walmart is the only store Yoink has it at/);
    // No store named and two stores: traced to the product, but no store item to act on.
    const unknownStore = notify("Bot (#restocks, Cook Group)", "Pokemon Ascended Heroes Elite Trainer Box restock");
    assert.match(unknownStore.reason, /names no store and Yoink has it at more than one/);
    const gamestop = notify("Bot (#restocks, Cook Group)", "GameStop restock: Ascended Heroes ETB");
    assert.match(gamestop.reason, /about GameStop, which isn't a Yoink store/);
    process();
    const rows = calls();
    assert.equal(rows.length, 4);
    assert.equal(rows.find((call) => call.listingId === ascendedWalmart.id)?.resolutionStatus, "matched");
    assert.equal(rows.find((call) => call.listingId === gummy.id)?.resolutionStatus, "matched");
    assert.equal(rows.filter((call) => call.resolutionStatus === "unresolved").length, 2);
  } finally {
    db.close();
  }
});

test("an unmatched notification is recorded as a call; once the shopper links it, the same product words trace", () => {
  const { db, notify, process, calls, gummy } = fixture();
  try {
    const first = notify("Bot (#walmart-restocks, Group)", "Squishy Gummy Bear Stress Toy restock $9.99");
    assert.equal(first.outcome, "call");
    assert.equal(first.traceMethod, "none");
    assert.match(first.reason, /couldn't match the product name/);
    process();
    const unmatched = calls()[0];
    assert.equal(unmatched?.resolutionStatus, "unresolved");
    const result = describeCallRow(unmatched ?? {});
    assert.equal(result.reason, "Not matched to a product");
    assert.equal(result.fix, "link_product");
    assert.match(result.detail, /^Yoink couldn't match the product name: .+ Link it to a product and Yoink matches it next time\.$/);
    assert.equal(unmatched?.sourceChannelName, "#walmart-restocks · Group");
    assert.match(String(unmatched?.evidenceHeadline), /^Bot \(#walmart-restocks, Group\): Squishy Gummy Bear/);
    assert.equal(unmatched?.retailerId, "walmart");
    assert.equal(unmatched?.title, "Squishy Gummy Bear Stress Toy restock");
    const repository = new DiscordNotificationRepository(db);
    const suggestions = repository.suggestions("Squishy Gummy Bear Stress Toy restock");
    assert.equal(suggestions[0]?.title, "NeeDoh Gummy Bear");
    assert.deepEqual(suggestions[0]?.stores, ["Walmart"]);
    const linked = repository.rememberLink(unmatched?.signalId, gummy.variantId, NOW + 2_000);
    assert.equal(linked.title, "NeeDoh Gummy Bear");
    assert.throws(() => repository.rememberLink("discord:missing", gummy.variantId), /isn't in your call log/);
    assert.throws(() => repository.rememberLink(unmatched?.signalId, "variant_missing"), /isn't in Yoink/);
    // Same words, another channel, another order: traced as the shopper said.
    const again = notify("Other Bot (#drops, Other Group)", "restock: squishy gummy bear stress toy at Walmart", NOW - 1_000);
    assert.equal(again.traceMethod, "remembered");
    assert.match(again.reason, /You linked this product name to NeeDoh Gummy Bear at Walmart/);
    process(NOW + 3_000);
    assert.equal(calls()[0]?.listingId, gummy.id);
  } finally {
    db.close();
  }
});

test("chat, DMs and old notifications aren't calls; a channel set to log only never adds; Discord can be turned off", () => {
  const { db, intake, notify, process, calls } = fixture();
  try {
    assert.equal(notify("A Friend", "dinner at 7?").outcome, "ignored");
    assert.equal(notify("Pal (#general, Cook Group)", "lol same").outcome, "ignored");
    assert.equal(notify("Bot (#target-restocks, Cook Group)", "").outcome, "ignored");
    const providers = () => runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => new SignalProviderRepository(db));
    assert.equal(providers().listChannels("discord").length, 0, "nothing ignored is kept");
    assert.equal(notify("Bot (#target-restocks, Cook Group)", "Ascended Heroes ETB live at Target", NOW - 20 * 60_000).outcome, "too_old");

    assert.equal(notify("Bot (#target-restocks, Cook Group)", "Ascended Heroes ETB live at Target $49.99").outcome, "call");
    assert.equal(notify("Bot (#target-restocks, Cook Group)", "Ascended Heroes ETB live at Target again $49.99", NOW - 1_000).outcome, "call");
    process();
    const [latest, earlier] = calls();
    assert.equal(earlier?.actionJobAction, "add_to_cart");
    assert.equal(latest?.missionDecision, "corroborated", "a repeat call joins the open cart add");
    const channel = providers().listChannels("discord")[0];
    assert.ok(channel);

    runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => new SignalProviderRepository(db).updateChannel(channel.id, { status: "paused" }, NOW));
    assert.equal(notify("Bot (#target-restocks, Cook Group)", "Ascended Heroes ETB live").outcome, "channel_off");

    runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => new DiscordNotificationRepository(db).updateSettings({ enabled: false }, NOW));
    assert.equal(intake.enabled(), false);
    assert.equal(notify("Bot (#walmart, Cook Group)", "Ascended Heroes ETB live at Walmart").outcome, "disabled");
    assert.throws(() => new DiscordNotificationRepository(db).updateSettings({ enabled: "yes" }), /Choose whether/);
  } finally {
    db.close();
  }
});

test("a channel set to log only records the call without adding to the cart", () => {
  const { db, notify, process, calls } = fixture();
  try {
    assert.equal(notify("Bot (#target-restocks, Cook Group)", "NeeDoh Gummy Bear live at Walmart").outcome, "call");
    const providers = runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => new SignalProviderRepository(db));
    const channel = runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => providers.listChannels("discord")[0]);
    assert.ok(channel);
    runWithRequestScope(DISCORD_NOTIFICATION_SCOPE, () => providers.updateChannel(channel.id, { trustLevel: "informational" }, NOW));
    assert.equal(notify("Bot (#target-restocks, Cook Group)", "Ascended Heroes ETB live at Target $49.99", NOW - 1_000).outcome, "call");
    process();
    const target = calls().find((call) => call.retailerId === "target");
    assert.equal(target?.sourceTrustLevel, "informational");
    assert.notEqual(target?.actionJobAction, "add_to_cart");
    assert.notEqual(target?.missionDecision, "qualified");
    const result = describeCallRow(target ?? {});
    assert.equal(result.reason, "Log only channel");
    assert.equal(result.detail, "You set this Discord channel to Log only, so Yoink didn't add it. The message said $49.99.");
  } finally {
    db.close();
  }
});

function watcherFixture(journal: "wal" | "delete" = "wal") {
  const directory = mkdtempSync(join(tmpdir(), "yoink-wpn-"));
  const path = join(directory, "wpndatabase.db");
  const centre = createNotificationCentre(path, journal);
  const accepted: CapturedDiscordNotification[] = [];
  let enabled = true;
  let now = NOW;
  const watcher = new WindowsNotificationWatcher({ databasePath: path, snapshotDirectory: join(directory, "copy"), now: () => now });
  watcher.attach({
    enabled: () => enabled,
    accept: (notification) => {
      accepted.push(notification);
      return { outcome: "call", reason: "traced", signalId: `discord:${accepted.length}`, channelName: "#drops · Group", traceMethod: "name" };
    }
  });
  return {
    directory, path, centre, accepted, watcher,
    setEnabled: (value: boolean) => { enabled = value; },
    advance: (ms: number) => { now += ms; },
    cleanup: () => {
      void watcher.stop();
      try { centre.close(); } catch { /* already closed */ }
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

test("the watcher reads Discord's notifications from Windows' notification database, never other apps', each once", () => {
  const { centre, accepted, watcher, advance, cleanup } = watcherFixture();
  try {
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "Old restock"), NOW - 60 * 60_000);
    centre.add(OUTLOOK_APP_ID, "<toast><visual><binding><text>Discord (#drops, Group)</text><text>Walmart restock</text></binding></visual></toast>", NOW - 5_000);
    centre.add(BRAVE_APP_ID, browserToastXml("TrackaLacker", "Ascended Heroes ETB in stock", "trackalacker.com"), NOW - 4_000);
    centre.add(BRAVE_APP_ID, browserToastXml("Bot (#drops, Group)", "Ascended Heroes ETB live at Target", "discord.com"), NOW - 3_000);
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#walmart, Group)", "NeeDoh Gummy Bear restock"), NOW - 2_000);
    centre.add(DISCORD_APP_ID, "<badge value=\"3\"/>", NOW - 1_000, "badge");
    // Windows Search's ID contains "arc"; only exact browser and Discord IDs are read.
    centre.add("Microsoft.Windows.Search_cw5n1h2txyewy!CortanaUI", browserToastXml("Bot (#drops, Group)", "Ascended Heroes ETB live", "discord.com"), NOW - 900);
    watcher.pollOnce();
    assert.deepEqual(accepted.map((item) => [item.toast.app, item.toast.title, item.toast.body]), [
      ["browser", "Bot (#drops, Group)", "Ascended Heroes ETB live at Target"],
      ["desktop", "Bot (#walmart, Group)", "NeeDoh Gummy Bear restock"]
    ]);
    assert.equal(accepted[1]?.arrivedAt, NOW - 2_000);
    assert.match(String(accepted[1]?.reference), /^wpn:\d+:\d+$/);
    let status = watcher.status();
    assert.equal(status.state, "watching");
    assert.equal(status.readMode, "direct");
    assert.equal(status.notificationsInCentre, 6);
    assert.deepEqual(status.appsInCentre, [
      { appId: BRAVE_APP_ID, toasts: 2 },
      { appId: DISCORD_APP_ID, toasts: 2 },
      { appId: OUTLOOK_APP_ID, toasts: 1 },
      { appId: "Microsoft.Windows.Search_cw5n1h2txyewy!CortanaUI", toasts: 1 }
    ], "app IDs and counts only, so an unrecognised Discord app shows in diagnostics");
    assert.equal(status.discordAppInCentre, 2);
    assert.equal(status.discordSeen, 3);
    assert.equal(status.olderSkipped, 1);
    assert.equal(status.calls, 2);
    assert.equal(status.recent[0]?.channelName, "#drops · Group");
    assert.equal(JSON.stringify(status).includes("Gummy"), false, "status never carries message text");
    watcher.pollOnce();
    assert.equal(accepted.length, 2, "each notification once");
    advance(1_000);
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "OP-17 booster box restock"), NOW + 500);
    watcher.pollOnce();
    assert.equal(accepted.length, 3);
    assert.equal(accepted[2]?.toast.body, "OP-17 booster box restock");
    status = watcher.status();
    assert.equal(status.calls, 3);
    assert.equal(status.lastCallAt, new Date(NOW + 1_000).toISOString());
  } finally {
    cleanup();
  }
});

test("turned off, the watcher reads nothing, and what arrived meanwhile stays unread", () => {
  const { centre, accepted, watcher, setEnabled, cleanup } = watcherFixture();
  try {
    setEnabled(false);
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "Restock while off"), NOW - 2_000);
    watcher.pollOnce();
    assert.equal(watcher.status().state, "off");
    setEnabled(true);
    watcher.pollOnce();
    assert.equal(accepted.length, 0);
    assert.equal(watcher.status().state, "watching");
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "Restock after"), NOW - 1_000);
    watcher.pollOnce();
    assert.deepEqual(accepted.map((item) => item.toast.body), ["Restock after"]);
  } finally {
    cleanup();
  }
});

test("a missing notification database is an error; a rebuilt one is read from its first row", () => {
  const { path, centre, accepted, watcher, cleanup } = watcherFixture();
  try {
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "First restock"), NOW - 3_000);
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "Second restock"), NOW - 2_500);
    watcher.pollOnce();
    assert.equal(accepted.length, 2);
    centre.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
    watcher.pollOnce();
    assert.equal(watcher.status().state, "error");
    assert.equal(watcher.status().lastError, "database_missing");
    const rebuilt = createNotificationCentre(path);
    try {
      rebuilt.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "After the rebuild"), NOW - 1_000);
      watcher.pollOnce();
      assert.equal(watcher.status().state, "watching");
      assert.deepEqual(accepted.map((item) => item.toast.body), ["First restock", "Second restock", "After the rebuild"]);
    } finally {
      rebuilt.close();
    }
  } finally {
    cleanup();
  }
});

test("while another program holds the notification database locked, the watcher reads a copy", () => {
  const { directory, path, centre, accepted, watcher, cleanup } = watcherFixture("delete");
  const writer = new DatabaseSync(path);
  try {
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#drops, Group)", "Locked restock"), NOW - 2_000);
    writer.exec("BEGIN EXCLUSIVE");
    watcher.pollOnce();
    assert.equal(watcher.status().readMode, "copy");
    assert.equal(watcher.status().state, "watching");
    assert.deepEqual(accepted.map((item) => item.toast.body), ["Locked restock"]);
    assert.deepEqual(readdirSync(join(directory, "copy")), [], "the copy holds every app's notifications, so it is gone once read");
    // The copy is read again only when Windows changed the file.
    watcher.pollOnce();
    assert.equal(accepted.length, 1);
  } finally {
    try { writer.exec("ROLLBACK"); } catch { /* not in a transaction */ }
    writer.close();
    cleanup();
  }
});

test("Windows' own notification database is found under the signed-in user's local app data", () => {
  assert.equal(windowsNotificationDatabasePath({ LOCALAPPDATA: "C:\\Users\\kevin\\AppData\\Local" }, "win32"),
    "C:\\Users\\kevin\\AppData\\Local\\Microsoft\\Windows\\Notifications\\wpndatabase.db");
  assert.equal(windowsNotificationDatabasePath({}, "linux"), null);
  assert.equal(windowsNotificationDatabasePath({ YOINK_WINDOWS_NOTIFICATION_DB: "/tmp/wpn.db" }, "linux"), "/tmp/wpn.db");
  const unsupported = new WindowsNotificationWatcher({ databasePath: null });
  unsupported.start();
  assert.equal(unsupported.status().state, "unsupported");
  assert.equal(unsupported.status().supported, false);
});

test("the dashboard API lists traced Discord calls in the call log, every Discord call under Discord, and saves channel modes and links", async () => {
  const { db, process, gummy } = fixture();
  const directory = mkdtempSync(join(tmpdir(), "yoink-wpn-api-"));
  const centre = createNotificationCentre(join(directory, "wpndatabase.db"));
  const watcher = new WindowsNotificationWatcher({ databasePath: join(directory, "wpndatabase.db"), now: () => NOW });
  const server = createYoinkServer({ db, webRoot: join(process_cwd(), "apps", "web"), version: "discord-test", windowsNotifications: watcher });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "Content-Type": "application/json", Origin: baseUrl };
  const get = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    return response.json() as Promise<Record<string, any>>;
  };
  try {
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Restock Bot (#target-restocks, Cook Group)",
      "Pokemon Ascended Heroes ETB is LIVE $49.99\nhttps://www.target.com/p/x/-/A-94972381"), NOW - 2_000);
    centre.add(DISCORD_APP_ID, discordDesktopToastXml("Bot (#walmart-restocks, Group)", "Squishy Gummy Bear Stress Toy restock $9.99"), NOW - 1_000);
    watcher.pollOnce();
    process();

    const log = await get("/api/v1/user/calls?limit=50");
    const logged = log.items.filter((item: Record<string, any>) => item.source === "discord");
    assert.equal(logged.length, 1, "the untraced message stays out of the call log");
    assert.equal(logged[0].title, "Pokemon Ascended Heroes Elite Trainer Box");
    assert.equal(logged[0].discord.channel, "#target-restocks · Cook Group");
    assert.match(logged[0].discord.message, /^Restock Bot \(#target-restocks, Cook Group\): Pokemon Ascended Heroes ETB is LIVE/);
    assert.match(logged[0].discord.trace, /Target link in the message/);
    assert.equal(logged[0].discord.matched, true);

    const discordCalls = await get("/api/v1/user/calls?source=discord&limit=50");
    assert.equal(discordCalls.items.length, 2);
    assert.equal(discordCalls.signalTotal, 2);
    const untraced = discordCalls.items.find((item: Record<string, any>) => !item.discord.matched);
    assert.equal(untraced.result.fix, "link_product");
    assert.equal(untraced.discord.linkable, true);
    assert.equal(untraced.result.reason, "Not matched to a product");

    const overview = await get("/api/v1/user/discord");
    assert.equal(overview.settings.enabled, true);
    assert.equal(overview.reader.state, "watching");
    assert.equal(overview.reader.calls, 2);
    assert.deepEqual(overview.channels.map((channel: Record<string, any>) => [channel.name, channel.mode, channel.calls]).sort(), [
      ["#target-restocks · Cook Group", "add", 1],
      ["#walmart-restocks · Group", "add", 1]
    ]);
    assert.equal(overview.recent.length, 2);
    assert.equal(overview.recent.find((call: Record<string, any>) => call.matched).result.label, "Adding to cart");

    const channel = overview.channels.find((item: Record<string, any>) => item.name.startsWith("#walmart"));
    const logOnly = await fetch(`${baseUrl}/api/v1/user/discord/channels/${channel.id}`, { method: "PATCH", headers, body: JSON.stringify({ mode: "log" }) });
    assert.equal(logOnly.status, 200);
    assert.equal((await logOnly.json()).channel.mode, "log");
    const invalid = await fetch(`${baseUrl}/api/v1/user/discord/channels/${channel.id}`, { method: "PATCH", headers, body: JSON.stringify({ mode: "sometimes" }) });
    assert.equal(invalid.status, 400);
    const missing = await fetch(`${baseUrl}/api/v1/user/discord/channels/signal_channel_${"0".repeat(32)}`, { method: "PATCH", headers, body: JSON.stringify({ mode: "add" }) });
    assert.equal(missing.status, 404);

    const suggestions = await get(`/api/v1/user/discord/suggestions?signalId=${encodeURIComponent(untraced.id.replace(/^signal:/, ""))}`);
    assert.equal(suggestions.items[0].title, "NeeDoh Gummy Bear");
    assert.equal((await get("/api/v1/user/discord/suggestions?q=ascended%20heroes")).items[0].title.includes("Ascended Heroes"), true);
    const linked = await fetch(`${baseUrl}/api/v1/user/discord/links`, { method: "POST", headers,
      body: JSON.stringify({ signalId: untraced.id.replace(/^signal:/, ""), variantId: gummy.variantId }) });
    assert.equal(linked.status, 200);
    assert.equal((await linked.json()).linked.title, "NeeDoh Gummy Bear");

    const off = await fetch(`${baseUrl}/api/v1/user/discord/settings`, { method: "PATCH", headers, body: JSON.stringify({ enabled: false }) });
    assert.equal(off.status, 200);
    watcher.pollOnce();
    assert.equal((await get("/api/v1/user/discord")).reader.state, "off");
  } finally {
    server.close();
    await watcher.stop();
    centre.close();
    rmSync(directory, { recursive: true, force: true });
    db.close();
  }
});
