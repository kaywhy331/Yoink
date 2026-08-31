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

    const feedback = providers.reportSignalFalsePositive(channel.id, envelope.signal.signalId, NOW + 4_500);
    assert.equal(feedback.recorded, true);
    assert.equal(feedback.channel.falsePositiveCount, 1);
    assert.equal(feedback.channel.signalCount, 1);
    assert.equal(feedback.channel.accuracyBps, 0);
    assert.equal(
      providers.reportSignalFalsePositive(channel.id, envelope.signal.signalId, NOW + 4_600).recorded,
      false
    );
    assert.equal(providers.getChannel(channel.id)?.falsePositiveCount, 1);
    assert.throws(
      () => providers.reportSignalFalsePositive(channel.id, "not-this-channel-signal", NOW + 4_700),
      /does not belong/
    );

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
    assert.equal(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE event_type = 'provider_signal_false_positive_reported'
         AND json_extract(data_json, '$.channelId') = ?`,
      channel.id
    )?.count, 1);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("provider batches classify retryability per item and continue after rejection", () => {
  const db = new YoinkDatabase();
  try {
    const ingress = new DurableSignalIngressService(db);
    const valid = {
      contractVersion: 1 as const,
      provider: "trackalacker" as const,
      signal: {
        schemaVersion: 1 as const,
        signalId: "provider-batch-valid",
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker" as const,
        externalEventId: "provider-batch-valid",
        eventType: "restock" as const,
        observedAt: new Date(NOW).toISOString(),
        receivedAt: new Date(NOW).toISOString(),
        test: false,
        identity: {
          retailerId: "target" as const,
          retailerSku: "94972381",
          canonicalUrl: "https://www.target.com/p/-/A-94972381"
        },
        offer: {
          availability: "in_stock" as const,
          unitPriceCents: 3999,
          currency: "USD",
          sellerName: "Target",
          sellerType: "first_party" as const,
          orderLimit: 1,
          fulfillment: "shipping" as const,
          offerFingerprint: ""
        },
        evidence: {},
        parserVersion: "trackalacker-push-v1"
      }
    };
    const invalid = {
      ...valid,
      signal: { ...valid.signal, signalId: "provider-batch-invalid", parserVersion: "wrong-parser" }
    };
    const receipt = ingress.acceptProviderBatch([invalid, valid], NOW);
    assert.equal(receipt.accepted, 1);
    assert.equal(receipt.rejected, 1);
    assert.deepEqual(receipt.receipts.map(({ index, accepted, retryable, processingState, errorCode }) => ({
      index, accepted, retryable, processingState, errorCode
    })), [
      {
        index: 0,
        accepted: false,
        retryable: false,
        processingState: "rejected",
        errorCode: "provider_parser_mismatch"
      },
      {
        index: 1,
        accepted: true,
        retryable: false,
        processingState: "queued",
        errorCode: ""
      }
    ]);
  } finally {
    db.close();
  }
});

test("accepted provider ingress wakes the in-process worker without delaying its durable receipt", async () => {
  const db = new YoinkDatabase();
  try {
    let wakes = 0;
    const providers = new SignalProviderRepository(db);
    const channel = providers.createChannel({
      provider: "discord",
      name: "Wake fixture",
      externalReference: "discord-channel-wake-fixture",
      trustLevel: "informational",
      replayWindowSeconds: 300
    }, NOW);
    const ingress = new DurableSignalIngressService(db, () => { wakes += 1; });
    const receipt = ingress.acceptProvider(
      discordSignalEnvelope(discordInput(channel.id, "wake-message"), channel, NOW),
      NOW
    );
    assert.equal(receipt.processingState, "queued");
    assert.equal(receipt.backgroundTaskCreated, true);
    assert.equal(wakes, 0, "worker wake stays off the synchronous receipt path");
    await Promise.resolve();
    assert.equal(wakes, 1);
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
    const acceptedReceipt = await accepted.json() as { accepted: boolean; signalId: string; inboxReceiptId: string };
    assert.equal(acceptedReceipt.accepted, true);
    assert.ok(acceptedReceipt.signalId);
    runWithRequestScope(WORKER_SCOPE, () => new DurableSignalIngressProcessor(db).processBatch(Date.now() + 1_000));

    const falsePositive = await fetch(`${baseUrl}/api/v1/user/source-feedback/false-positive`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        channelId: created.channel.id,
        signalId: acceptedReceipt.signalId,
        confirmation: "REPORT_FALSE_POSITIVE"
      })
    });
    assert.equal(falsePositive.status, 200);
    assert.equal(falsePositive.headers.get("x-yoink-api-surface"), "user");
    assert.equal((await falsePositive.json() as { recorded: boolean }).recorded, true);
    const duplicateFeedback = await fetch(`${baseUrl}/api/v1/user/source-feedback/false-positive`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        channelId: created.channel.id,
        signalId: acceptedReceipt.signalId,
        confirmation: "REPORT_FALSE_POSITIVE"
      })
    });
    assert.equal((await duplicateFeedback.json() as { recorded: boolean }).recorded, false);

    const calls = await fetch(`${baseUrl}/api/v1/user/calls`).then((response) => response.json()) as {
      items: Array<{ id: string; sourceChannelId: string; falsePositiveReported: boolean }>;
    };
    const reported = calls.items.find((item) => item.id === `signal:${acceptedReceipt.signalId}`);
    assert.equal(reported?.sourceChannelId, created.channel.id);
    assert.equal(reported?.falsePositiveReported, true);

    const listed = await fetch(`${baseUrl}/api/v1/admin/sources/channels?provider=discord`);
    assert.equal(listed.status, 200);
    const channels = await listed.json() as { items: Array<{ id: string; acceptedEventCount: number; falsePositiveCount: number; accuracyBps: number }> };
    assert.deepEqual(channels.items.map((item) => ({
      id: item.id,
      accepted: item.acceptedEventCount,
      falsePositives: item.falsePositiveCount,
      accuracyBps: item.accuracyBps
    })), [{
      id: created.channel.id,
      accepted: 1,
      falsePositives: 1,
      accuracyBps: 0
    }]);

    const updatedResponse = await fetch(`${baseUrl}/api/v1/admin/sources/channels/${encodeURIComponent(created.channel.id)}`, {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({ status: "paused", trustLevel: "trusted_exact", autoCreateMissions: false })
    });
    assert.equal(updatedResponse.status, 200);
    assert.equal(updatedResponse.headers.get("x-yoink-api-surface"), "admin");
    const updated = await updatedResponse.json() as {
      channel: { id: string; status: string; trustLevel: string; autoCreateMissions: boolean };
    };
    assert.equal(updated.channel.id, created.channel.id);
    assert.equal(updated.channel.status, "paused");
    assert.equal(updated.channel.trustLevel, "trusted_exact");
    assert.equal(updated.channel.autoCreateMissions, false);

    db.run(
      `UPDATE inbox_messages SET state = 'dead_letter', delivery_attempts = 20,
         last_error_code = 'fixture_delivery_exhausted' WHERE id = ?`,
      acceptedReceipt.inboxReceiptId
    );
    const replayResponse = await fetch(`${baseUrl}/api/v1/admin/sources/channels/${encodeURIComponent(created.channel.id)}/replay`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ maximum: 7 })
    });
    assert.equal(replayResponse.status, 202);
    assert.equal(replayResponse.headers.get("x-yoink-api-surface"), "admin");
    const replayed = await replayResponse.json() as {
      channelId: string;
      replayed: number;
      receipts: Array<{ inboxReceiptId: string; processingState: string }>;
    };
    assert.equal(replayed.channelId, created.channel.id);
    assert.equal(replayed.replayed, 1);
    assert.deepEqual(replayed.receipts.map((receipt) => ({
      inboxReceiptId: receipt.inboxReceiptId,
      processingState: receipt.processingState
    })), [{ inboxReceiptId: acceptedReceipt.inboxReceiptId, processingState: "queued" }]);

    const adminScript = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
    assert.match(adminScript, /false positive/);
    assert.match(adminScript, /Replay dead letters/);
    assert.equal(JSON.stringify(db.all("SELECT * FROM signal_provider_channels")).includes("112233445566778899"), false);
    assert.equal(runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new SignalProviderRepository(db).listChannels()).length, 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
