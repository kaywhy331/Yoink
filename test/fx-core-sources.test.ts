import assert from "node:assert/strict";
import test from "node:test";
import type { TrackalackerPushEnvelope } from "../packages/contracts/src/index.js";
import type { DiscordChannelSignalInput } from "../packages/contracts/src/signal-provider.js";
import type { SignalProviderChannel } from "../packages/database/src/signal-provider-repository.js";
import { SignalValidationError } from "../packages/domain/src/normalize.js";
import { discordSignalEnvelope } from "../packages/sources/src/discord.js";
import { parseTrackalackerNotification } from "../packages/sources/src/trackalacker.js";
import { signalFailureIsPermanent } from "../packages/engine/src/signal-ingress.js";
import { InputValidationError } from "../packages/domain/src/input-validation-error.js";

function envelope(body: string, title = "IN STOCK at Target!"): TrackalackerPushEnvelope {
  return {
    schemaVersion: 1,
    signalId: "push:trackalacker:fixture-price",
    source: {
      provider: "trackalacker",
      transport: "chrome_extension_web_push",
      notificationId: "push:trackalacker:fixture-price",
      applicationName: "Google Chrome",
      applicationId: "a".repeat(32),
      domain: "trackalacker.com",
      createdAt: "2026-09-20T12:00:00.000Z",
      receivedAt: "2026-09-20T12:00:01.000Z"
    },
    notification: {
      title,
      body,
      textElements: [],
      sourceProductId: "138022",
      sourceListingId: "991122",
      sourceProductSlug: "pokemon-elite-trainer-box",
      sourceRetailer: "target",
      sourceRetailerSku: "1011483414"
    }
  };
}

test("the TrackaLacker fallback price parser ignores reference prices and refuses to guess", () => {
  const price = (body: string) => parseTrackalackerNotification(envelope(body)).unitPriceCents;
  // The structured "in stock at $x" line still wins.
  assert.equal(price("Pokemon Elite Trainer Box\nIn stock at $49.99 (below MSRP)"), 4_999);
  // A bare amount is still read when it is the only one.
  assert.equal(price("Pokemon Elite Trainer Box\nNow $49.99"), 4_999);
  // MSRP / was / save / off amounts are never the offer price.
  assert.equal(price("Pokemon Elite Trainer Box\nMSRP $69.99\nNow $49.99"), 4_999);
  assert.equal(price("Pokemon Elite Trainer Box\nMSRP $69.99 / Now available"), null);
  assert.equal(price("Pokemon Elite Trainer Box\nSave $10 today"), null);
  assert.equal(price("Pokemon Elite Trainer Box\n$10 off, was $59.99"), null);
  assert.equal(price("Pokemon Elite Trainer Box\nList price: $69.99 — now $49.99"), 4_999);
  // Two distinct candidate amounts are ambiguous: needs_price, not a guess.
  assert.equal(price("Pokemon Elite Trainer Box\n$49.99 or 2 for $89.99"), null);
  // The same amount repeated is not ambiguous.
  assert.equal(price("$49.99\nPokemon Elite Trainer Box $49.99"), 4_999);
});

const CHANNEL = {
  id: "channel_discord_1",
  provider: "discord",
  name: "Collector alerts",
  sourceConnectionId: "source_discord_channel_1",
  trustLevel: "informational"
} as unknown as SignalProviderChannel;

function discordInput(facts: Partial<DiscordChannelSignalInput["facts"]> = {}): DiscordChannelSignalInput {
  return {
    contractVersion: 1,
    channelId: CHANNEL.id,
    messageId: "123456789012345678",
    observedAt: "2026-09-20T12:00:00.000Z",
    summary: "Target restock",
    facts: {
      eventType: "restock",
      retailerId: "target",
      retailerSku: "94972381",
      canonicalUrl: "https://www.target.com/p/example/-/A-94972381",
      title: "Pokémon Deluxe Feature Action Figure",
      availability: "in_stock",
      unitPriceCents: 3999,
      currency: "USD",
      ...facts
    }
  } as DiscordChannelSignalInput;
}

test("Discord payload validation failures are 400 signal validation errors, not masked 500s", () => {
  assert.equal(discordSignalEnvelope(discordInput(), CHANNEL).provider, "discord");
  const rejects = (input: DiscordChannelSignalInput, pattern: RegExp) => assert.throws(
    () => discordSignalEnvelope(input, CHANNEL),
    (error: unknown) => error instanceof SignalValidationError && error.status === 400 && pattern.test(error.message)
  );
  rejects(discordInput({ retailerSku: "11111111" }), /exact retailer URL and SKU/);
  rejects(discordInput({ retailerId: "not-a-store" as never }), /not a supported store/);
  rejects(discordInput({ retailerId: "__proto__" as never }), /not a supported store/);
  rejects(discordInput({ currency: "US" }), /three-letter code/);
  rejects({ ...discordInput(), channelId: "other" }, /do not match/);
  rejects({ ...discordInput(), observedAt: "not a date" }, /valid observed timestamp/);
});

test("ingress treats validation and domain request failures as permanent", () => {
  assert.equal(signalFailureIsPermanent(new SignalValidationError("bad")), true);
  assert.equal(signalFailureIsPermanent(new InputValidationError("bad")), true);
  assert.equal(signalFailureIsPermanent(new Error("SQLITE_BUSY")), false);
});
