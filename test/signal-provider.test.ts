import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import type { DiscordChannelSignalInput } from "../packages/contracts/src/signal-provider.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";
import { SignalProviderRepository } from "../packages/database/src/signal-provider-repository.js";
import {
  DurableSignalIngressProcessor,
  DurableSignalIngressService
} from "../packages/engine/src/signal-ingress.js";
import { discordSignalEnvelope } from "../packages/sources/src/discord.js";

const NOW = new Date("2026-08-30T18:00:00.000Z").getTime();
const WORKER_SCOPE: RequestScope = {
  tenantId: "tenant_local",
  userId: "user_local",
  actorKind: "service",
  actorId: "provider_signal_worker",
  internalServiceCapability: "internal.delivery"
};

function discordInput(channelId: string, messageId = "123456789012345678", observedAt = NOW): DiscordChannelSignalInput {
  return {
    contractVersion: 1,
    channelId,
    messageId,
    observedAt: new Date(observedAt).toISOString(),
    summary: `Target restock Bearer ${"S".repeat(48)}`,
    facts: {
      eventType: "restock",
      retailerId: "target",
      retailerSku: "94972381",
      canonicalUrl: "https://www.target.com/p/example/-/A-94972381?tracking=discarded",
      title: "Pokémon Deluxe Feature Action Figure",
      availability: "in_stock",
      unitPriceCents: 3999,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping",
      orderLimit: 1
    }
  };
}

test("provider-neutral ingress gives every Discord channel isolated trust, replay bounds, and durable dedupe", () => {
  const db = new YoinkDatabase();
  try {
    const providers = new SignalProviderRepository(db);
    const ingress = new DurableSignalIngressService(db);
    const channel = providers.createChannel({
      provider: "discord",
      name: "West Coast drops",
      externalReference: "discord-channel-998877665544332211",
      trustLevel: "informational",
      replayWindowSeconds: 300
    }, NOW);
    assert.equal(channel.created, true);
    assert.equal(channel.trustLevel, "informational");
    assert.equal(channel.autoCreateMissions, false);
    assert.equal(channel.sourceConnectionId.startsWith("source_discord_"), true);
    assert.equal(JSON.stringify(db.all("SELECT * FROM signal_provider_channels")).includes("998877665544332211"), false);

    const envelope = discordSignalEnvelope(discordInput(channel.id), channel, NOW + 1_000);
    assert.equal(envelope.provider, "discord");
    assert.equal(envelope.signal.identity.canonicalUrl, "https://www.target.com/p/-/A-94972381");
    assert.equal(envelope.signal.evidence?.headline?.includes("S".repeat(48)), false);
    const first = ingress.acceptProvider(envelope, NOW + 2_000);
    const duplicate = ingress.acceptProvider(envelope, NOW + 3_000);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(first.inboxReceiptId, duplicate.inboxReceiptId);
    assert.equal(providers.getChannel(channel.id)?.acceptedEventCount, 2);

    const processor = new DurableSignalIngressProcessor(db);
    const processed = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 4_000));
    assert.equal(processed.signalMessagesProcessed, 1);
    assert.deepEqual({ ...db.get<{ source: string; parser: string; url: string }>(
      `SELECT source, parser_version AS parser,
              json_extract(identity_json, '$.canonicalUrl') AS url
       FROM signal_events`
    ) }, {
      source: "discord",
      parser: "discord-channel-v1",
      url: "https://www.target.com/p/-/A-94972381"
    });

    assert.throws(
      () => ingress.acceptProvider(
        discordSignalEnvelope(discordInput(channel.id, "stale-message", NOW - 301_000), channel, NOW),
        NOW
      ),
      /replay window/
    );
    assert.equal(providers.getChannel(channel.id)?.rejectedEventCount, 1);
    providers.updateChannel(channel.id, { status: "paused", trustLevel: "trusted_exact", autoCreateMissions: true }, NOW + 5_000);
    const paused = providers.getChannel(channel.id);
    assert.equal(paused?.trustLevel, "trusted_exact");
    assert.equal(paused?.autoCreateMissions, true);
    assert.throws(
      () => ingress.acceptProvider(discordSignalEnvelope(discordInput(channel.id, "paused-message"), paused!, NOW + 6_000), NOW + 6_000),
      /not active/
    );
    assert.equal(providers.getChannel(channel.id)?.rejectedEventCount, 2);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("the internal delivery API accepts a structured Discord event and exposes channel health to source managers", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "signal-provider-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mutationHeaders = { "Content-Type": "application/json", Origin: baseUrl };
  try {
    const createdResponse = await fetch(`${baseUrl}/api/v1/admin/sources/channels`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        provider: "discord",
        name: "Collector alerts",
        externalReference: "112233445566778899",
        trustLevel: "informational",
        replayWindowSeconds: 900
      })
    });
    assert.equal(createdResponse.status, 201);
    assert.equal(createdResponse.headers.get("x-yoink-api-surface"), "admin");
    const created = await createdResponse.json() as { channel: { id: string; sourceConnectionId: string } };

    const accepted = await fetch(`${baseUrl}/api/v1/internal/delivery/discord/signals`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify(discordInput(created.channel.id, "discord-api-message", Date.now()))
    });
    assert.equal(accepted.status, 202);
    assert.equal(accepted.headers.get("x-yoink-api-surface"), "internal");
    assert.equal((await accepted.json() as { accepted: boolean }).accepted, true);

    const listed = await fetch(`${baseUrl}/api/v1/admin/sources/channels?provider=discord`);
    assert.equal(listed.status, 200);
    const channels = await listed.json() as { items: Array<{ id: string; acceptedEventCount: number }> };
    assert.deepEqual(channels.items.map((item) => ({ id: item.id, accepted: item.acceptedEventCount })), [{
      id: created.channel.id,
      accepted: 1
    }]);
    assert.equal(JSON.stringify(db.all("SELECT * FROM signal_provider_channels")).includes("112233445566778899"), false);
    assert.equal(runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new SignalProviderRepository(db).listChannels()).length, 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
