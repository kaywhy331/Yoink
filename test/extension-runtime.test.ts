import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES } from "../packages/contracts/src/index.js";

const TOKEN = "T".repeat(43);
const ROTATED_TOKEN = "R".repeat(43);
const PRODUCT_URL = "https://www.target.com/p/fixture/-/A-1011483414";
const WALMART_PRODUCT_URL = "https://www.walmart.com/ip/fixture/17354421975";
const AMAZON_PRODUCT_URL = "https://www.amazon.com/dp/B0GYTRYV7P";
const BESTBUY_PRODUCT_URL = "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149";
const DISNEY_PRODUCT_URL = "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html";
const PBANDAI_PRODUCT_URL = "https://p-bandai.com/us/item/N2884150001";
const POKEMONCENTER_PRODUCT_URL = "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder";
const WALMART_DRAW_URL = "https://www.walmart.com/shop/collectibles/draw";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function stableHash(...parts: Array<string | number>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = String(part);
    hash.update(String(Buffer.byteLength(value)), "utf8");
    hash.update(":", "utf8");
    hash.update(value, "utf8");
    hash.update("|", "utf8");
  }
  return hash.digest("hex");
}

interface ObserverRecipeFixture {
  distribution: Record<string, unknown>;
  root: Record<string, unknown>;
  priorTrustState?: Record<string, unknown>;
}

interface FixtureTrustKey {
  algorithm: string;
  keyId: string;
  publicKeySpki: string;
  usage: string;
  status: string;
  notBefore: string;
  notAfter: string;
}

interface FixtureTrustManifest {
  algorithm: string;
  rootKeyId: string;
  payload: {
    contractVersion: number;
    generation: number;
    rootKeyId: string;
    issuedAt: string;
    expiresAt: string;
    previousManifestHash: string;
    keys: FixtureTrustKey[];
    revokedKeyIds: string[];
  };
  signature: string;
}

function signedObserverRecipe(tampered = false): ObserverRecipeFixture {
  return observerRecipeFixture({ tampered });
}

function rotatedObserverRecipe(signWithRevokedKey = false): ObserverRecipeFixture {
  return observerRecipeFixture({ rotated: true, signWithRevokedKey });
}

function observerRecipeFixture(options: {
  tampered?: boolean;
  rotated?: boolean;
  signWithRevokedKey?: boolean;
}): ObserverRecipeFixture {
  const rootPair = generateKeyPairSync("ed25519");
  const rootSpki = rootPair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rootKeyId = createHash("sha256").update(rootSpki).digest("hex");
  const root = {
    algorithm: "Ed25519",
    keyId: rootKeyId,
    publicKeySpki: rootSpki.toString("base64url"),
    minimumManifestGeneration: 1
  };
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeySpki = spki.toString("base64url");
  const keyId = createHash("sha256").update(spki).digest("hex");
  const trustIssuedAt = new Date(Date.now() - 60_000).toISOString();
  const trustExpiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const manifestPayload: FixtureTrustManifest["payload"] = {
    contractVersion: 1,
    generation: 1,
    rootKeyId,
    issuedAt: trustIssuedAt,
    expiresAt: trustExpiresAt,
    previousManifestHash: "",
    keys: [{
      algorithm: "Ed25519",
      keyId,
      publicKeySpki,
      usage: "observer_recipe_signing",
      status: "active",
      notBefore: trustIssuedAt,
      notAfter: trustExpiresAt
    }],
    revokedKeyIds: []
  };
  const manifest: FixtureTrustManifest = {
    algorithm: "Ed25519",
    rootKeyId,
    payload: manifestPayload,
    signature: sign(null, Buffer.from(canonicalJson(manifestPayload)), rootPair.privateKey).toString("base64url")
  };
  const manifestHash = createHash("sha256")
    .update(`yoink-observer-recipe-trust-manifest-v1|${canonicalJson(manifest)}`)
    .digest("hex");
  let currentPair = pair;
  let currentPublicKeySpki = publicKeySpki;
  let currentKeyId = keyId;
  let currentManifest = manifest;
  let currentManifestHash = manifestHash;
  const manifestChain: FixtureTrustManifest[] = [manifest];
  if (options.rotated) {
    const nextPair = generateKeyPairSync("ed25519");
    const nextSpki = nextPair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const nextPublicKeySpki = nextSpki.toString("base64url");
    const nextKeyId = createHash("sha256").update(nextSpki).digest("hex");
    const rotatedPayload: FixtureTrustManifest["payload"] = {
      contractVersion: 1,
      generation: 2,
      rootKeyId,
      issuedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: trustExpiresAt,
      previousManifestHash: manifestHash,
      keys: [
        { ...manifestPayload.keys[0]!, status: "retired" },
        {
          algorithm: "Ed25519",
          keyId: nextKeyId,
          publicKeySpki: nextPublicKeySpki,
          usage: "observer_recipe_signing",
          status: "active",
          notBefore: trustIssuedAt,
          notAfter: trustExpiresAt
        }
      ],
      revokedKeyIds: [keyId]
    };
    currentManifest = {
      algorithm: "Ed25519",
      rootKeyId,
      payload: rotatedPayload,
      signature: sign(null, Buffer.from(canonicalJson(rotatedPayload)), rootPair.privateKey).toString("base64url")
    };
    currentManifestHash = createHash("sha256")
      .update(`yoink-observer-recipe-trust-manifest-v1|${canonicalJson(currentManifest)}`)
      .digest("hex");
    manifestChain.push(currentManifest);
    if (!options.signWithRevokedKey) {
      currentPair = nextPair;
      currentPublicKeySpki = nextPublicKeySpki;
      currentKeyId = nextKeyId;
    }
  }
  const payload = {
    contractVersion: 1,
    recipeId: "observer_recipe_fixture",
    retailerId: "amazon",
    recipeVersion: "amazon-layout-fixture",
    state: "shadow",
    minimumExtensionVersion: "0.3.0",
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    rollbackRecipeId: "",
    fields: {
      availability: { mode: "text", selectors: ["#availability"] },
      unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] },
      seller: { mode: "text", selectors: ["#merchant-info"] },
      fulfillment: { mode: "text", selectors: ["#deliveryBlockMessage"] },
      addControl: { mode: "disabled_state", selectors: ["#add-to-cart-button"] }
    }
  };
  const signature = sign(null, Buffer.from(JSON.stringify(payload)), currentPair.privateKey).toString("base64url");
  const transparencySequence = options.rotated ? 2 : 1;
  const transparencyPreviousHash = options.rotated ? "e".repeat(64) : "";
  const transparencyCreatedAt = new Date().toISOString();
  const transparencyEventHash = stableHash(
    "observer-recipe-transparency-v1",
    transparencySequence,
    "manifest_installed",
    options.rotated ? 2 : 1,
    currentManifestHash,
    options.rotated
      ? (currentManifest.payload.keys.find((item) => item.status === "active")?.keyId ?? "")
      : keyId,
    currentManifestHash,
    transparencyPreviousHash,
    transparencyCreatedAt
  );
  return {
    root,
    ...(options.rotated ? { priorTrustState: {
      contractVersion: 1,
      rootKeyId,
      generation: 1,
      manifestHash,
      activeKeyId: keyId,
      transparencySequence: 1,
      transparencyEventHash: "e".repeat(64)
    } } : {}),
    distribution: {
      trust: {
        contractVersion: 1,
        rootKeyId,
        manifestHash: currentManifestHash,
        manifest: currentManifest,
        manifestChain,
        transparencyReceipt: {
          sequence: transparencySequence,
          eventType: "manifest_installed",
          manifestGeneration: options.rotated ? 2 : 1,
          manifestHash: currentManifestHash,
          signingKeyId: options.rotated
            ? (currentManifest.payload.keys.find((item) => item.status === "active")?.keyId ?? "")
            : keyId,
          subjectHash: currentManifestHash,
          previousEventHash: transparencyPreviousHash,
          eventHash: transparencyEventHash,
          createdAt: transparencyCreatedAt
        }
      },
      recipe: {
        algorithm: "Ed25519",
        keyId: currentKeyId,
        publicKeySpki: currentPublicKeySpki,
        payload,
        signature: options.tampered ? `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}` : signature
      }
    }
  };
}
const selectedOffer = (childOfferKey: string, selectionState = "exact") => ({
  schemaVersion: 1,
  selectionState,
  childOfferKey,
  attributes: {}
});

const OBSERVATION = {
  adapterVersion: "target-observer-v1",
  contractVersion: 1,
  observedAt: "2026-08-23T01:00:00.000Z",
  pageKind: "product",
  retailerId: "target",
  retailerSku: "1011483414",
  availability: "in_stock",
  unitPriceCents: 5999,
  currency: "USD",
  sellerName: "Target",
  sellerType: "first_party",
  fulfillment: "shipping",
  addControlActionable: true,
  securityChallenge: false,
  interactiveBlock: "",
  selectedOffer: selectedOffer("1011483414"),
  url: `${PRODUCT_URL}?private=DO_NOT_SEND`,
  cookie: "DO_NOT_SEND"
};
const AMAZON_OBSERVATION = {
  adapterVersion: "amazon-observer-v6",
  contractVersion: 1,
  observedAt: "2026-08-23T01:00:00.000Z",
  pageKind: "product",
  retailerId: "amazon",
  retailerSku: "B0GYTRYV7P",
  availability: "in_stock",
  unitPriceCents: 2186,
  currency: "USD",
  sellerName: "Amazon.com",
  sellerType: "first_party",
  fulfillment: "shipping",
  addControlActionable: true,
  securityChallenge: false,
  interactiveBlock: "",
  purchaseRouteKind: "amazon_buy_now",
  purchaseRouteReady: true,
  routeReasonCode: "offer_route_verified",
  selectedOffer: selectedOffer("B0GYTRYV7P")
};
const WALMART_OBSERVATION = {
  adapterVersion: "walmart-observer-v4",
  contractVersion: 1,
  observedAt: "2026-08-23T01:00:00.000Z",
  pageKind: "product",
  retailerId: "walmart",
  retailerSku: "17354421975",
  availability: "in_stock",
  unitPriceCents: 4499,
  currency: "USD",
  sellerName: "Walmart",
  sellerType: "first_party",
  fulfillment: "shipping",
  addControlActionable: true,
  securityChallenge: false,
  interactiveBlock: "",
  selectedOffer: selectedOffer("17354421975")
};
const BESTBUY_OBSERVATION = {
  adapterVersion: "bestbuy-observer-v5",
  contractVersion: 1,
  observedAt: "2026-08-23T01:00:00.000Z",
  pageKind: "product",
  retailerId: "bestbuy",
  retailerSku: "6588149",
  availability: "in_stock",
  unitPriceCents: 699,
  currency: "USD",
  sellerName: "Best Buy",
  sellerType: "first_party",
  fulfillment: "shipping",
  addControlActionable: true,
  securityChallenge: false,
  interactiveBlock: "",
  selectedOffer: selectedOffer("6588149")
};
const DISNEY_OBSERVATION = {
  adapterVersion: "disney-observer-v1",
  contractVersion: 1,
  observedAt: "2026-08-23T01:00:00.000Z",
  pageKind: "product",
  retailerId: "disney",
  retailerSku: "409914998395",
  canonicalUrl: DISNEY_PRODUCT_URL,
  availability: "in_stock",
  unitPriceCents: 12900,
  currency: "USD",
  sellerName: "Disney Store",
  sellerType: "first_party",
  fulfillment: "shipping",
  addControlActionable: true,
  securityChallenge: false,
  interactiveBlock: "",
  purchaseRouteKind: "none",
  purchaseRouteReady: false,
  routeReasonCode: "not_applicable",
  selectedOffer: selectedOffer("409914998395", "listing_only")
};
const PBANDAI_OBSERVATION = {
  ...DISNEY_OBSERVATION,
  adapterVersion: "pbandai-observer-v2",
  retailerId: "pbandai",
  retailerSku: "N2884150001",
  canonicalUrl: PBANDAI_PRODUCT_URL,
  availability: "preorder",
  unitPriceCents: 8900,
  sellerName: "Premium Bandai",
  selectedOffer: selectedOffer("N2884150001")
};
const POKEMONCENTER_OBSERVATION = {
  ...DISNEY_OBSERVATION,
  adapterVersion: "pokemoncenter-observer-v2",
  retailerId: "pokemoncenter",
  retailerSku: "10-10320-101",
  canonicalUrl: POKEMONCENTER_PRODUCT_URL,
  unitPriceCents: 2999,
  sellerName: "Pokémon Center",
  selectedOffer: selectedOffer("10-10320-101")
};
const WALMART_DRAW_SCAN = {
  adapterVersion: "walmart-draw-observer-v1",
  contractVersion: 1,
  observedAt: new Date().toISOString(),
  pageKind: "walmart_draw_hub",
  outcome: "passed",
  reasonCode: "verified",
  expectedCardCount: 4,
  observedCardCount: 4,
  securityChallenge: false,
  interactiveBlock: "",
  items: [
    ["19624258216", "NeeDoh Dream Drop", 597, 99],
    ["19536452232", "NeeDoh Jelly Squish Stress Ball MISCL Color", 597, 99],
    ["5631614124", "2023-24 Panini Mosaic Basketball Trading Cards Mega Box", 5997, 5],
    ["18029663536", "2025-26 Topps Holiday Basketball Trading Cards Countdown Calendar", 4998, 5]
  ].map(([retailerSku, title, unitPriceCents, orderMaxLimit]) => ({
    retailerSku,
    title,
    unitPriceCents,
    currency: "USD",
    sellerName: "Walmart",
    sellerType: "first_party",
    drawState: "active",
    closesAt: "2026-08-24T22:00:00.000Z",
    conditionCode: 1,
    conditionGroupCode: 1,
    orderMinLimit: 1,
    orderMaxLimit,
    drawControlPresent: true,
    addControlSuppressed: true,
    cookie: "DO_NOT_SEND",
    entryToken: TOKEN
  }))
};

function diagnosticFor(observation: typeof AMAZON_OBSERVATION | typeof WALMART_OBSERVATION | typeof BESTBUY_OBSERVATION | typeof DISNEY_OBSERVATION | typeof PBANDAI_OBSERVATION | typeof POKEMONCENTER_OBSERVATION) {
  const amazon = observation.retailerId === "amazon";
  return {
    contractVersion: 1,
    observedAt: observation.observedAt,
    retailerId: observation.retailerId,
    retailerSku: observation.retailerSku,
    adapterVersion: observation.adapterVersion,
    operation: "observe",
    outcome: "passed",
    failureStage: "complete",
    reasonCode: "verified",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "form",
      sellerShape: "legacy",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      genericAddIntentCount: 1,
      scopedControlCount: 1,
      explicitSkuInputCount: amazon ? 1 : 0,
      exactSkuInputCount: amazon ? 1 : 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: amazon ? 1 : 0,
      canonicalOfferDistinctCount: amazon ? 1 : 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 1,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

function queuedRuntimeDiagnostic(retailerSku: string, observedAt: string, extras: Record<string, unknown> = {}) {
  return {
    deviceId: "device_fixture",
    diagnostic: {
      ...diagnosticFor(AMAZON_OBSERVATION),
      observedAt,
      retailerSku,
      outcome: "failed",
      failureStage: "runner",
      reasonCode: "observer_execution_failed",
      layout: {
        schemaVersion: 1,
        pageKind: "product",
        scopeKind: "none",
        sellerShape: "none",
        fulfillmentShape: "none",
        addControlCount: 0,
        genericAddIntentCount: 0,
        scopedControlCount: 0,
        explicitSkuInputCount: 0,
        exactSkuInputCount: 0,
        variationSkuCount: 0,
        canonicalOfferInputCount: 0,
        canonicalOfferDistinctCount: 0,
        alternateOfferInputCount: 0,
        alternateOfferDistinctCount: 0,
        priceCandidateCount: 0,
        quantityControlCount: 0,
        securityChallenge: false,
        interactiveBlock: ""
      },
      ...extras
    }
  };
}

interface HarnessOptions {
  permission?: boolean;
  activeUrl?: string;
  liveJob?: boolean;
  walmartJob?: boolean;
  amazonJob?: boolean;
  bestBuyJob?: boolean;
  notification?: boolean;
  releaseVersion?: string;
  releaseReady?: boolean;
  activeJob?: "pre_boundary" | "post_boundary";
  queuedTrackalackerSignal?: boolean;
  trackalackerPush?: boolean;
  visibleTrackalackerFallback?: boolean;
  amazonHydrationRetry?: boolean;
  observerRepairLandmark?: boolean;
  observerFiveFieldRepairLandmarks?: boolean;
  deviceCredentialRotationDue?: boolean;
  pendingDeviceCredential?: boolean;
  deviceCredentialCommitFailures?: number;
  runtimeProfile?: "local" | "production";
  retailerObserverFailure?:
    | "bundle_injection"
    | "execution"
    | "top_frame_missing"
    | "runtime_unavailable"
    | "collection"
    | "invalid_contract";
  adapterDiagnosticFailures?: number;
  adapterDiagnosticFailureStatus?: number;
  queuedAdapterDiagnostics?: Array<Record<string, unknown>>;
  observerRecipeDistribution?: Record<string, unknown>;
  observerRecipeRoot?: Record<string, unknown>;
  observerRecipeTrustState?: Record<string, unknown>;
  observerRecipeEvaluation?: Record<string, unknown>;
}

function harness(options: HarnessOptions = {}) {
  const liveJob = options.liveJob === true || options.walmartJob === true || options.amazonJob === true || options.bestBuyJob === true;
  const storage: Record<string, unknown> = {
    pairedDevice: {
      id: "device_fixture",
      token: TOKEN,
      name: "Desktop - Windows - Chrome",
      credentialGeneration: 1,
      ...(options.pendingDeviceCredential ? {
        pendingCredential: {
          token: ROTATED_TOKEN,
          generation: 2,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
        }
      } : {})
    }
  };
  if (options.observerRecipeTrustState) {
    storage.yoinkObserverRecipeTrustStateV1 = options.observerRecipeTrustState;
  }
  if (options.activeJob) {
    storage.activeTargetJob = {
      id: "job_target_fixture",
      capabilityToken: "C".repeat(43),
      navigationUrl: PRODUCT_URL,
      phase: options.activeJob === "post_boundary" ? "adding" : "verifying_listing",
      tabId: 17,
      proof: options.activeJob === "post_boundary" ? {
        retailerSku: "1011483414",
        unitPriceCents: 5999,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping"
      } : null,
      runnerJob: {
        adapterVersion: "target-add-v1",
        contractVersion: 1,
        jobId: "job_target_fixture",
        retailerId: "target",
        retailerSku: "1011483414",
        canonicalUrl: PRODUCT_URL,
        action: "add_to_cart",
        quantity: 1,
        maxUnitPriceCents: 5999,
        maxOrderTotalCents: 5999,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Target",
        fulfillment: "shipping",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }
    };
  }
  if (options.queuedTrackalackerSignal || options.trackalackerPush) {
    storage.yoinkTrackalackerPushStateV1 = {
      enabled: true,
      state: "ready",
      ready: true,
      subscriptionPresent: true,
      registeredFingerprint: "f".repeat(64),
      pendingSignals: options.queuedTrackalackerSignal ? 1 : 0,
      lastHttpStatus: 200,
      errorCode: "",
      lastRegistrationAt: new Date().toISOString(),
      lastNotificationAt: new Date().toISOString(),
      lastDeliveryAt: "",
      updatedAt: new Date().toISOString()
    };
    storage.yoinkTrackalackerPushQueueV1 = options.queuedTrackalackerSignal ? [{
      schemaVersion: 1,
      signalId: "push:trackalacker:queued-fixture-1234",
      testSignal: false,
      source: {
        provider: "trackalacker",
        transport: "chrome_extension_web_push",
        notificationId: "push:trackalacker:queued-fixture-1234",
        applicationName: "Google Chrome",
        applicationId: "a".repeat(32),
        domain: "trackalacker.com",
        createdAt: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      },
      notification: {
        title: "IN STOCK at Target!",
        body: "Queued Fixture Product\nIn stock at $59.99",
        textElements: [],
        sourceProductId: "138022",
        sourceListingId: "991122",
        sourceProductSlug: "queued-fixture-product",
        sourceRetailer: "target",
        sourceRetailerSku: "1011483414"
      }
    }] : [];
  }
  if (options.queuedAdapterDiagnostics) {
    storage.yoinkAdapterDiagnosticQueueV1 = options.queuedAdapterDiagnostics;
  }
  const fetchCalls: Array<{ url: string; options: Record<string, unknown> }> = [];
  const injections: Array<Record<string, unknown>> = [];
  const jobStates: string[] = [];
  const shownNotifications: Array<{ id: string; options: Record<string, unknown> }> = [];
  const notificationInteractions: string[] = [];
  const deliveredTrackalackerSignals: Array<Record<string, unknown>> = [];
  const shownTrackalackerNotifications: Array<{ title: string; options: Record<string, unknown> }> = [];
  const tabs = new Map<number, { id: number; url: string; status: string }>([
    [17, { id: 17, url: options.activeUrl ?? PRODUCT_URL, status: "complete" }]
  ]);
  let nextTabId = 20;
  let messageListener: ((message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean) | undefined;
  let alarmListener: ((alarm: { name: string }) => void) | undefined;
  let notificationClickedListener: ((notificationId: string) => void) | undefined;
  let notificationClosedListener: ((notificationId: string, byUser: boolean) => void) | undefined;
  let startupListener: (() => void) | undefined;
  const serviceWorkerListeners = new Map<string, (event: unknown) => void>();
  let completeJob: (() => void) | undefined;
  const jobCompleted = new Promise<void>((resolve) => { completeJob = resolve; });
  let completeNotification: (() => void) | undefined;
  const notificationCompleted = new Promise<void>((resolve) => { completeNotification = resolve; });
  let notificationAcknowledged = false;
  let amazonObservationAttempts = 0;
  let adapterDiagnosticFailuresRemaining = Math.max(0, options.adapterDiagnosticFailures ?? 0);
  let adapterDiagnosticQueueWasNonEmpty = Array.isArray(storage.yoinkAdapterDiagnosticQueueV1)
    && storage.yoinkAdapterDiagnosticQueueV1.length > 0;
  let completeAdapterDiagnosticQueueDrain: (() => void) | undefined;
  const adapterDiagnosticQueueDrained = new Promise<void>((resolve) => { completeAdapterDiagnosticQueueDrain = resolve; });
  const chrome = {
    runtime: {
      id: "a".repeat(32),
      getManifest: () => ({ version: "0.3.0" }),
      getURL: (path: string) => `chrome-extension://${"a".repeat(32)}/${path}`,
      reload: () => undefined,
      onInstalled: { addListener: () => undefined },
      onStartup: { addListener: (listener: typeof startupListener) => { startupListener = listener; } },
      onMessage: { addListener: (listener: typeof messageListener) => { messageListener = listener; } }
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (value: Record<string, unknown>) => {
          Object.assign(storage, value);
          if (Object.hasOwn(value, "yoinkAdapterDiagnosticQueueV1")) {
            const queue = value.yoinkAdapterDiagnosticQueueV1;
            if (Array.isArray(queue) && queue.length) adapterDiagnosticQueueWasNonEmpty = true;
            if (adapterDiagnosticQueueWasNonEmpty && Array.isArray(queue) && queue.length === 0) {
              completeAdapterDiagnosticQueueDrain?.();
            }
          }
        },
        remove: async (key: string) => { delete storage[key]; },
        setAccessLevel: async () => undefined
      },
      session: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (value: Record<string, unknown>) => { Object.assign(storage, value); },
        remove: async (key: string) => { delete storage[key]; },
        setAccessLevel: async () => undefined
      }
    },
    permissions: { contains: async () => options.permission !== false },
    tabs: {
      query: async () => [tabs.get(17)],
      get: async (id: number) => tabs.get(id),
      create: async ({ url }: { url: string }) => {
        const tab = { id: ++nextTabId, url, status: "complete" };
        tabs.set(tab.id, tab);
        return tab;
      },
      update: async (id: number, update: { url?: string }) => {
        const current = tabs.get(id);
        if (!current) throw new Error("Missing fixture tab.");
        const tab = { ...current, url: update.url ?? current.url, status: "complete" };
        tabs.set(id, tab);
        return tab;
      },
      onUpdated: { addListener: () => undefined, removeListener: () => undefined }
    },
    scripting: {
      executeScript: async (injection: Record<string, unknown>) => {
        injections.push(injection);
        if ("files" in injection) {
          if (options.retailerObserverFailure === "bundle_injection"
            && (injection.files as string[]).includes("retailer-shadow.js")) {
            throw new Error(`RAW_BROWSER_ERROR token=${TOKEN} url=${AMAZON_PRODUCT_URL}?secret=DO_NOT_SEND`);
          }
          return [];
        }
        const args = injection.args as unknown[] | undefined;
        if (args?.[0] === "rehearseTargetAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "verified", wouldClick: true, proof: { retailerSku: "1011483414" } } }];
        }
        if (args?.[0] === "observeWalmartDrawHub") {
          return [{ frameId: 0, result: { ok: true, scan: WALMART_DRAW_SCAN } }];
        }
        if (args?.[0] === "rehearseWalmartAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "verified", wouldClick: true, proof: { retailerSku: "17354421975" } } }];
        }
        if (args?.[0] === "rehearseAmazonAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "verified", wouldClick: true, proof: { retailerSku: "B0GYTRYV7P" } } }];
        }
        if (args?.[0] === "rehearseBestBuyAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "verified", wouldClick: true, proof: { retailerSku: "6588149" } } }];
        }
        if (args?.[0] === "inspectTargetEmptyCart") {
          return [{ frameId: 0, result: { ok: true, reason: "verified_empty" } }];
        }
        if (args?.[0] === "inspectWalmartEmptyCart") {
          return [{ frameId: 0, result: { ok: true, reason: "verified_empty" } }];
        }
        if (args?.[0] === "inspectAmazonEmptyCart") {
          return [{ frameId: 0, result: { ok: true, reason: "verified_empty" } }];
        }
        if (args?.[0] === "inspectBestBuyEmptyCart") {
          return [{ frameId: 0, result: { ok: true, reason: "verified_empty" } }];
        }
        if (args?.[0] === "prepareTargetAdd") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            authorizationId: "target_add_fixture_authorization",
            proof: {
              contractVersion: 1,
              jobId: "job_target_fixture",
              retailerId: "target",
              retailerSku: "1011483414",
              observedAt: new Date().toISOString(),
              unitPriceCents: 5999,
              currency: "USD",
              sellerName: "Target",
              sellerType: "first_party",
              fulfillment: "shipping"
            }
          } }];
        }
        if (args?.[0] === "prepareWalmartAdd") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            authorizationId: "walmart_add_fixture_authorization",
            proof: {
              contractVersion: 1,
              jobId: "job_walmart_fixture",
              retailerId: "walmart",
              retailerSku: "17354421975",
              observedAt: new Date().toISOString(),
              unitPriceCents: 4499,
              currency: "USD",
              sellerName: "Walmart",
              sellerType: "first_party",
              fulfillment: "shipping"
            }
          } }];
        }
        if (args?.[0] === "prepareAmazonAdd") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            authorizationId: "amazon_add_fixture_authorization",
            proof: {
              contractVersion: 1,
              jobId: "job_amazon_fixture",
              retailerId: "amazon",
              retailerSku: "B0GYTRYV7P",
              observedAt: new Date().toISOString(),
              unitPriceCents: 2186,
              currency: "USD",
              sellerName: "Amazon.com",
              sellerType: "first_party",
              fulfillment: "shipping"
            }
          } }];
        }
        if (args?.[0] === "prepareBestBuyAdd") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            authorizationId: "bestbuy_add_fixture_authorization",
            proof: {
              contractVersion: 1,
              jobId: "job_bestbuy_fixture",
              retailerId: "bestbuy",
              retailerSku: "6588149",
              observedAt: new Date().toISOString(),
              unitPriceCents: 699,
              currency: "USD",
              sellerName: "Best Buy",
              sellerType: "first_party",
              fulfillment: "shipping"
            }
          } }];
        }
        if (args?.[0] === "commitTargetAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "clicked", clicked: true, proof: { retailerSku: "1011483414" } } }];
        }
        if (args?.[0] === "commitWalmartAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "clicked", clicked: true, proof: { retailerId: "walmart", retailerSku: "17354421975" } } }];
        }
        if (args?.[0] === "commitAmazonAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "clicked", clicked: true, proof: { retailerId: "amazon", retailerSku: "B0GYTRYV7P" } } }];
        }
        if (args?.[0] === "commitBestBuyAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "clicked", clicked: true, proof: { retailerId: "bestbuy", retailerSku: "6588149" } } }];
        }
        if (args?.[0] === "verifyTargetAddedCart") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: { retailerSku: "1011483414", quantity: 1, unitPriceCents: 5999, sellerType: "first_party" }
          } }];
        }
        if (args?.[0] === "verifyWalmartAddedCart") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: { retailerSku: "17354421975", quantity: 1, unitPriceCents: 4499, sellerType: "first_party" }
          } }];
        }
        if (args?.[0] === "verifyAmazonAddedCart") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: { retailerSku: "B0GYTRYV7P", quantity: 1, unitPriceCents: 2186, sellerType: "first_party" }
          } }];
        }
        if (args?.[0] === "verifyBestBuyAddedCart") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: { retailerSku: "6588149", quantity: 1, unitPriceCents: 699, sellerType: "first_party" }
          } }];
        }
        if (args?.[0] === "amazon") {
          if (options.retailerObserverFailure === "execution") {
            throw new Error(`RAW_BROWSER_ERROR token=${TOKEN} url=${AMAZON_PRODUCT_URL}?secret=DO_NOT_SEND`);
          }
          if (options.retailerObserverFailure === "top_frame_missing") return [];
          if (options.retailerObserverFailure === "runtime_unavailable") {
            return [{ frameId: 0, result: {
              ok: false,
              reasonCode: "observer_runtime_unavailable",
              message: `RAW_PAGE_ERROR token=${TOKEN} secret=DO_NOT_SEND`
            } }];
          }
          if (options.retailerObserverFailure === "collection") {
            return [{ frameId: 0, result: {
              ok: false,
              reasonCode: "observer_collection_failed",
              message: `RAW_PAGE_ERROR token=${TOKEN} secret=DO_NOT_SEND`
            } }];
          }
          if (options.retailerObserverFailure === "invalid_contract") {
            return [{ frameId: 0, result: { ok: true, observation: AMAZON_OBSERVATION, diagnostic: null } }];
          }
          if (options.observerRepairLandmark || options.observerFiveFieldRepairLandmarks) {
            const observation = {
              ...AMAZON_OBSERVATION,
              availability: "out_of_stock",
              fulfillment: "unknown",
              addControlActionable: false,
              purchaseRouteReady: false,
              routeReasonCode: "offer_not_actionable"
            };
            const fiveField = options.observerFiveFieldRepairLandmarks === true;
            const diagnostic = {
              ...diagnosticFor(AMAZON_OBSERVATION),
              outcome: "failed",
              failureStage: fiveField ? "availability_binding" : "add_control",
              reasonCode: fiveField ? "availability_selector_miss" : "add_control_selector_miss",
              rawDom: "DO_NOT_SEND_DOM",
              layout: {
                ...diagnosticFor(AMAZON_OBSERVATION).layout,
                addControlCount: 0,
                genericAddIntentCount: 1,
                ...(fiveField ? {
                  genericAvailabilityCandidateCount: 1,
                  genericPriceCandidateCount: 1,
                  genericSellerCandidateCount: 1,
                  genericFulfillmentCandidateCount: 1
                } : {}),
                scopedControlCount: 0,
                repairLandmarks: [
                  ...(fiveField ? [
                    { field: "availability", elementKind: "div", attribute: "data-testid", value: "product-availability-status", textContent: "DO_NOT_SEND_STOCK" },
                    { field: "unitPrice", elementKind: "span", attribute: "data-testid", value: "product-current-price", textContent: "$DO_NOT_SEND_PRICE" },
                    { field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name", textContent: "DO_NOT_SEND_SELLER" },
                    { field: "fulfillment", elementKind: "div", attribute: "data-testid", value: "shipping-fulfillment-option", textContent: "DO_NOT_SEND_FULFILLMENT" }
                  ] : []),
                  {
                    field: "addControl",
                    elementKind: "role_button",
                    attribute: "data-testid",
                    value: "pdp-add-to-cart-control",
                    textContent: "DO_NOT_SEND_TEXT"
                  }
                ],
                pageText: "DO_NOT_SEND_PAGE"
              }
            };
            return [{ frameId: 0, result: { ok: true, observation, diagnostic } }];
          }
          amazonObservationAttempts += 1;
          if (options.amazonHydrationRetry && amazonObservationAttempts === 1) {
            const observation = {
              ...AMAZON_OBSERVATION,
              availability: "out_of_stock",
              fulfillment: "unknown",
              addControlActionable: false,
              purchaseRouteReady: false,
              routeReasonCode: "offer_not_actionable"
            };
            const diagnostic = {
              ...diagnosticFor(AMAZON_OBSERVATION),
              outcome: "failed",
              failureStage: "offer_binding",
              reasonCode: "offer_binding_missing",
              layout: {
                ...diagnosticFor(AMAZON_OBSERVATION).layout,
                scopedControlCount: 0,
                canonicalOfferInputCount: 0,
                canonicalOfferDistinctCount: 0
              }
            };
            return [{ frameId: 0, result: { ok: true, observation, diagnostic } }];
          }
          return [{ frameId: 0, result: { ok: true, observation: AMAZON_OBSERVATION, diagnostic: diagnosticFor(AMAZON_OBSERVATION) } }];
        }
        if (args?.[0] === "walmart") return [{ frameId: 0, result: { ok: true, observation: WALMART_OBSERVATION, diagnostic: diagnosticFor(WALMART_OBSERVATION) } }];
        if (args?.[0] === "bestbuy") return [{ frameId: 0, result: { ok: true, observation: BESTBUY_OBSERVATION, diagnostic: diagnosticFor(BESTBUY_OBSERVATION) } }];
        if (args?.[0] === "disney") return [{ frameId: 0, result: { ok: true, observation: DISNEY_OBSERVATION, diagnostic: diagnosticFor(DISNEY_OBSERVATION) } }];
        if (args?.[0] === "pbandai") return [{ frameId: 0, result: { ok: true, observation: PBANDAI_OBSERVATION, diagnostic: diagnosticFor(PBANDAI_OBSERVATION) } }];
        if (args?.[0] === "pokemoncenter") return [{ frameId: 0, result: { ok: true, observation: POKEMONCENTER_OBSERVATION, diagnostic: diagnosticFor(POKEMONCENTER_OBSERVATION) } }];
        if (args?.[0] === "evaluateObserverRecipeEvidence") {
          return [{ frameId: 0, result: options.observerRecipeEvaluation ?? {
            validationProfile: "packaged_structured_oracle_v1",
            evaluatedFieldCount: 5,
            agreedFieldCount: 5,
            ambiguousFieldCount: 0,
            oracleEvaluatedFieldCount: 5,
            oracleAgreedFieldCount: 5,
            oracleConflictFieldCount: 0,
            packagedMissingFieldCount: 0,
            packagedConflictFieldCount: 0,
            insufficientFieldCount: 0,
            fieldOutcomes: ["availability", "unitPrice", "seller", "fulfillment", "addControl"].map((field) => ({
              field,
              recipeState: "value",
              packagedState: "agreed",
              oracleState: "agreed",
              disposition: "verified"
            })),
            shape: "availability:value:agreed:agreed:verified|unitPrice:value:agreed:agreed:verified|seller:value:agreed:agreed:verified|fulfillment:value:agreed:agreed:verified|addControl:value:agreed:agreed:verified"
          } }];
        }
        return [{ frameId: 0, result: { ok: true, observation: OBSERVATION } }];
      }
    },
    action: {
      setBadgeBackgroundColor: async () => undefined,
      setBadgeText: async () => undefined,
      setTitle: async () => undefined
    },
    alarms: {
      create: async () => undefined,
      onAlarm: { addListener: (listener: typeof alarmListener) => { alarmListener = listener; } }
    },
    notifications: {
      create: async (id: string, notificationOptions: Record<string, unknown>) => {
        shownNotifications.push({ id, options: notificationOptions });
        return id;
      },
      clear: async () => true,
      onClicked: { addListener: (listener: typeof notificationClickedListener) => { notificationClickedListener = listener; } },
      onClosed: { addListener: (listener: typeof notificationClosedListener) => { notificationClosedListener = listener; } }
    }
  };
  const fetchMock = async (input: string | URL | Request, requestOptions: Record<string, unknown> = {}) => {
    const url = String(input);
    fetchCalls.push({ url, options: requestOptions });
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({
        status: "ready",
        version: "0.5.0",
        executionMode: liveJob ? "live" : "shadow",
        actionsPaused: !liveJob,
        chromeMutationEnabled: liveJob
      }), { status: 200 });
    }
    if (url.endsWith("/extension/release")) {
      const releaseVersion = options.releaseVersion ?? "0.3.0";
      const packageReady = options.releaseReady !== false;
      return new Response(JSON.stringify({
        channel: "local-unpacked",
        version: releaseVersion,
        packageReady,
        filename: packageReady ? `Yoink-Companion-${releaseVersion}.zip` : "",
        downloadUrl: packageReady ? "/api/v1/extension/release/download" : "",
        sha256: packageReady ? "a".repeat(64) : "",
        sizeBytes: packageReady ? 12345 : 0,
        installMode: "overwrite-and-reload"
      }), { status: 200 });
    }
    if (url.endsWith("/devices/self/credential-rotation/begin")) {
      return new Response(JSON.stringify({
        rotation: {
          token: ROTATED_TOKEN,
          generation: 2,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/credential-rotation/commit")) {
      const failures = Number(options.deviceCredentialCommitFailures || 0);
      const priorFailures = fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/credential-rotation/commit")).length - 1;
      if (priorFailures < failures) {
        return new Response(JSON.stringify({ message: "temporary credential commit outage" }), { status: 503 });
      }
      return new Response(JSON.stringify({
        rotation: {
          deviceId: "device_fixture",
          credential: {
            generation: 2,
            issuedAt: new Date().toISOString(),
            rotateAfter: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
            rotationDue: false,
            pending: false,
            pendingExpiresAt: ""
          }
        }
      }), { status: 200 });
    }
    if (url.endsWith("/devices/self/heartbeat")) {
      const rotated = (requestOptions.headers as Record<string, string> | undefined)?.Authorization === `Bearer ${ROTATED_TOKEN}`;
      return new Response(JSON.stringify({
        device: { id: "device_fixture", name: "Desktop - Windows - Chrome" },
        credential: {
          generation: rotated ? 2 : 1,
          issuedAt: new Date(Date.now() - (options.deviceCredentialRotationDue ? 31 : 1) * 24 * 60 * 60_000).toISOString(),
          rotateAfter: new Date(Date.now() + (rotated ? 30 : options.deviceCredentialRotationDue ? -1 : 29) * 24 * 60 * 60_000).toISOString(),
          rotationDue: !rotated && options.deviceCredentialRotationDue === true,
          pending: options.pendingDeviceCredential === true && !rotated,
          pendingExpiresAt: options.pendingDeviceCredential === true && !rotated
            ? new Date(Date.now() + 10 * 60_000).toISOString() : ""
        },
        controlPlane: {
          executionMode: liveJob ? "live" : "shadow",
          actionsPaused: !liveJob,
          retailerMutationEnabled: liveJob
        }
      }), { status: 200 });
    }
    if (url.endsWith("/devices/self/sources/trackalacker/status")) {
      return new Response(JSON.stringify({ status: { ready: true } }), { status: 200 });
    }
    if (url.endsWith("/devices/self/sources/trackalacker/signals")) {
      deliveredTrackalackerSignals.push(JSON.parse(String(requestOptions.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }
    if (url.endsWith("/devices/self/shadow-observations/target")) {
      return new Response(JSON.stringify({
        observation: {
          ...OBSERVATION,
          id: "shadow_observation_fixture",
          url: undefined,
          cookie: undefined,
          canonicalUrl: "https://www.target.com/p/-/A-1011483414",
          selectedOffer: { ...OBSERVATION.selectedOffer, fingerprint: "a".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/walmart-draw/scans")) {
      const scan = JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        scan: {
          ...scan,
          id: "walmart_draw_scan_fixture",
          items: (scan.items as Array<Record<string, unknown>>).map((item) => ({ ...item, tracked: item.retailerSku === "5631614124" }))
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/shadow-observations/amazon")) {
      return new Response(JSON.stringify({
        observation: {
          ...AMAZON_OBSERVATION,
          id: "shadow_observation_amazon_fixture",
          canonicalUrl: "https://www.amazon.com/dp/B0GYTRYV7P",
          selectedOffer: { ...AMAZON_OBSERVATION.selectedOffer, fingerprint: "b".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/shadow-observations/walmart")) {
      return new Response(JSON.stringify({
        observation: {
          ...WALMART_OBSERVATION,
          id: "shadow_observation_walmart_fixture",
          canonicalUrl: "https://www.walmart.com/ip/17354421975",
          selectedOffer: { ...WALMART_OBSERVATION.selectedOffer, fingerprint: "c".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/shadow-observations/bestbuy")) {
      return new Response(JSON.stringify({
        observation: {
          ...BESTBUY_OBSERVATION,
          id: "shadow_observation_bestbuy_fixture",
          canonicalUrl: "https://www.bestbuy.com/site/-/6588149.p",
          selectedOffer: { ...BESTBUY_OBSERVATION.selectedOffer, fingerprint: "d".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/shadow-observations/disney")) {
      return new Response(JSON.stringify({
        observation: {
          ...DISNEY_OBSERVATION,
          id: "shadow_observation_disney_fixture",
          selectedOffer: { ...DISNEY_OBSERVATION.selectedOffer, fingerprint: "e".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/shadow-observations/pbandai")) {
      return new Response(JSON.stringify({
        observation: {
          ...PBANDAI_OBSERVATION,
          id: "shadow_observation_pbandai_fixture",
          selectedOffer: { ...PBANDAI_OBSERVATION.selectedOffer, fingerprint: "f".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/shadow-observations/pokemoncenter")) {
      return new Response(JSON.stringify({
        observation: {
          ...POKEMONCENTER_OBSERVATION,
          id: "shadow_observation_pokemoncenter_fixture",
          selectedOffer: { ...POKEMONCENTER_OBSERVATION.selectedOffer, fingerprint: "9".repeat(64) },
          observationState: "actionable_candidate"
        }
      }), { status: 201 });
    }
    if (url.includes("/devices/self/adapter-diagnostics/")) {
      if (adapterDiagnosticFailuresRemaining > 0) {
        adapterDiagnosticFailuresRemaining -= 1;
        throw new Error(`RAW_NETWORK_ERROR token=${TOKEN} secret=DO_NOT_SEND`);
      }
      if (options.adapterDiagnosticFailureStatus) {
        return new Response(JSON.stringify({ message: `RAW_HTTP_ERROR token=${TOKEN} secret=DO_NOT_SEND` }), {
          status: options.adapterDiagnosticFailureStatus
        });
      }
      const diagnostic = JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        diagnostic: { ...diagnostic, id: "adapter_diagnostic_fixture", layoutFingerprint: "f".repeat(64) }
      }), { status: 201 });
    }
    if (url.includes("/devices/self/community/nonces/")) {
      return new Response(JSON.stringify({ nonce: "N".repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }), { status: 201 });
    }
    if (url.includes("/devices/self/community/contributions/")) {
      const contribution = JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        receipt: {
          id: "community_receipt_fixture",
          assertionId: "community_assertion_fixture",
          disposition: "accepted",
          receiptHash: "r".repeat(64),
          createdAt: new Date().toISOString()
        },
        assertion: {
          id: "community_assertion_fixture",
          retailerId: url.split("/").at(-1),
          retailerSku: contribution.shadowObservationId === "shadow_observation_amazon_fixture" ? "B0GYTRYV7P" : "1011483414",
          assertionState: "accepted"
        }
      }), { status: 201 });
    }
    if (url.includes("/devices/self/observer-recipes/")) {
      return new Response(JSON.stringify(options.observerRecipeDistribution || {
        trust: null,
        recipe: null
      }), { status: 200 });
    }
    if (url.includes("/devices/self/observer-recipe-trials/")) {
      return new Response(JSON.stringify({ trial: { id: "observer_recipe_trial_fixture" } }), { status: 201 });
    }
    if (url.endsWith("/devices/self/qualification-trials/target-add")) {
      return new Response(JSON.stringify({ trial: { id: "adapter_trial_fixture" } }), { status: 201 });
    }
    if (url.endsWith("/devices/self/qualification-trials/walmart-add")) {
      return new Response(JSON.stringify({ trial: { id: "adapter_trial_walmart_fixture" } }), { status: 201 });
    }
    if (url.endsWith("/devices/self/qualification-trials/amazon-add")) {
      return new Response(JSON.stringify({ trial: { id: "adapter_trial_amazon_fixture" } }), { status: 201 });
    }
    if (url.endsWith("/devices/self/qualification-trials/bestbuy-add")) {
      return new Response(JSON.stringify({ trial: { id: "adapter_trial_bestbuy_fixture" } }), { status: 201 });
    }
    if (url.endsWith("/devices/self/notifications/next")) {
      return new Response(JSON.stringify(options.notification && !notificationAcknowledged ? {
        reason: "leased",
        notification: {
          id: "notification_delivery_fixture",
          capabilityToken: "N".repeat(43),
          title: "Pokemon fixture opportunity",
          message: "Target at $59.99 matched your strategy.",
          retailerId: "target",
          retailerSku: "1011483414",
          canonicalUrl: PRODUCT_URL,
          attributionUrl: PRODUCT_URL,
          action: "notify",
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      } : { notification: null, reason: "no_notifications" }), { status: 200 });
    }
    if (url.endsWith("/devices/self/notifications/notification_delivery_fixture/ack")) {
      const body = JSON.parse(String(requestOptions.body)) as { outcome: string };
      notificationAcknowledged = body.outcome === "delivered";
      completeNotification?.();
      return new Response(JSON.stringify({ notification: { id: "notification_delivery_fixture", state: body.outcome } }), { status: 200 });
    }
    if (url.endsWith("/devices/self/notifications/notification_delivery_fixture/interaction")) {
      const body = JSON.parse(String(requestOptions.body)) as { interaction: string };
      notificationInteractions.push(body.interaction);
      return new Response(JSON.stringify({ notification: { id: "notification_delivery_fixture", state: body.interaction } }), { status: 200 });
    }
    if (url.endsWith("/devices/self/jobs/next")) {
      const leasedJob = options.amazonJob ? {
        contractVersion: 1,
        adapterVersion: "amazon-add-v5",
        id: "job_amazon_fixture",
        capabilityToken: "A".repeat(43),
        action: "add_to_cart",
        quantity: 1,
        maxUnitPriceCents: 2186,
        maxOrderTotalCents: 2999,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Amazon.com",
        fulfillment: "shipping",
        retailerId: "amazon",
        retailerSku: "B0GYTRYV7P",
        canonicalUrl: AMAZON_PRODUCT_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      } : options.walmartJob ? {
        contractVersion: 1,
        adapterVersion: "walmart-add-v3",
        id: "job_walmart_fixture",
        capabilityToken: "W".repeat(43),
        action: "add_to_cart",
        quantity: 1,
        maxUnitPriceCents: 4499,
        maxOrderTotalCents: 5999,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Walmart",
        fulfillment: "shipping",
        retailerId: "walmart",
        retailerSku: "17354421975",
        canonicalUrl: WALMART_PRODUCT_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      } : options.bestBuyJob ? {
        contractVersion: 1,
        adapterVersion: "bestbuy-add-v3",
        id: "job_bestbuy_fixture",
        capabilityToken: "B".repeat(43),
        action: "add_to_cart",
        quantity: 1,
        maxUnitPriceCents: 699,
        maxOrderTotalCents: 999,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Best Buy",
        fulfillment: "shipping",
        retailerId: "bestbuy",
        retailerSku: "6588149",
        canonicalUrl: BESTBUY_PRODUCT_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      } : {
        contractVersion: 1,
        adapterVersion: "target-add-v1",
        id: "job_target_fixture",
        capabilityToken: "C".repeat(43),
        action: "add_to_cart",
        quantity: 1,
        maxUnitPriceCents: 5999,
        maxOrderTotalCents: 7499,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Target",
        fulfillment: "shipping",
        retailerId: "target",
        retailerSku: "1011483414",
        canonicalUrl: PRODUCT_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
      return new Response(JSON.stringify(liveJob ? {
        reason: "leased",
        job: leasedJob
      } : { job: null, reason: "shadow_mode" }), { status: 200 });
    }
    if (url.includes("/devices/self/jobs/job_target_fixture/events")
      || url.includes("/devices/self/jobs/job_walmart_fixture/events")
      || url.includes("/devices/self/jobs/job_amazon_fixture/events")
      || url.includes("/devices/self/jobs/job_bestbuy_fixture/events")) {
      const body = JSON.parse(String(requestOptions.body)) as { state: string };
      jobStates.push(body.state);
      if (body.state === "confirmed") completeJob?.();
      return new Response(JSON.stringify({ job: { id: "job_target_fixture", state: body.state } }), { status: 200 });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  const registrationMock = {
    pushManager: {
      getSubscription: async () => ({ options: { userVisibleOnly: options.visibleTrackalackerFallback === true } })
    },
    showNotification: async (title: string, notificationOptions: Record<string, unknown>) => {
      shownTrackalackerNotifications.push({ title, options: notificationOptions });
    }
  };
  const serviceWorkerScope = {
    addEventListener: (type: string, listener: (event: unknown) => void) => { serviceWorkerListeners.set(type, listener); }
  };
  let context: ReturnType<typeof createContext>;
  context = createContext({
    chrome,
    fetch: fetchMock,
    self: serviceWorkerScope,
    registration: registrationMock,
    importScripts: (...files: string[]) => {
      for (const file of files) {
        if (file === "runtime-config.js" && options.runtimeProfile === "production") {
          runInContext(`globalThis.YoinkRuntimeConfig = Object.freeze({
            profile: "production",
            apiOrigin: "https://api.yoink.example",
            appOrigin: "https://app.yoink.example",
            localPackageUpdates: false
          });`, context);
        } else if (file === "observer-recipe-root.js" && options.observerRecipeRoot) {
          runInContext(`globalThis.YoinkObserverRecipeRoot = Object.freeze(${JSON.stringify(options.observerRecipeRoot)});`, context);
        } else {
          runInContext(readFileSync(join(process.cwd(), "apps", "extension", file), "utf8"), context);
        }
      }
    },
    crypto: globalThis.crypto,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    atob,
    btoa,
    AbortController,
    URL,
    Date,
    Error,
    JSON,
    Number,
    String,
    RegExp,
    Array,
    Object,
    Boolean,
    Promise,
    setTimeout,
    clearTimeout
  });
  runInContext(readFileSync(join(process.cwd(), "apps", "extension", "background.js"), "utf8"), context);
  const diagnosticReasonCodes = JSON.parse(String(runInContext(
    "JSON.stringify([...DIAGNOSTIC_REASON_CODES].sort())",
    context
  ))) as string[];
  if (!messageListener) throw new Error("The extension message listener was not registered.");
  const send = (message: unknown) => new Promise<Record<string, unknown>>((resolve) => {
    assert.equal(messageListener?.(message, {}, (response) => resolve(response as Record<string, unknown>)), true);
  });
  return {
    send,
    fetchCalls,
    injections,
    storage,
    jobStates,
    jobCompleted,
    notificationCompleted,
    shownNotifications,
    notificationInteractions,
    deliveredTrackalackerSignals,
    shownTrackalackerNotifications,
    serviceWorkerListeners,
    fireJobAlarm: () => alarmListener?.({ name: "yoink-jobs" }),
    fireHealthAlarm: () => alarmListener?.({ name: "yoink-health" }),
    clickNotification: (id: string) => notificationClickedListener?.(id),
    closeNotification: (id: string, byUser = true) => notificationClosedListener?.(id, byUser),
    fireStartup: () => startupListener?.(),
    adapterDiagnosticQueueDrained,
    diagnosticReasonCodes,
    firePush: (payload: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
      const listener = serviceWorkerListeners.get("push");
      if (!listener) return reject(new Error("The push listener was not registered."));
      listener({
        data: { json: () => payload },
        waitUntil: (work: Promise<unknown>) => { void work.then(() => resolve(), reject); }
      });
    }),
    tabUrls: () => [...tabs.values()].map((tab) => tab.url)
  };
}

test("the packaged extension diagnostic reason allowlist matches the server contract exactly", () => {
  const runtime = harness();
  assert.deepEqual(
    runtime.diagnosticReasonCodes,
    [...RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES].sort()
  );
});

test("the service worker performs one authenticated, sanitized, isolated Target inspection", async () => {
  const runtime = harness();
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);
  assert.equal((response.observation as Record<string, unknown>).observationState, "actionable_candidate");
  assert.equal(runtime.injections.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.injections[0])), {
    target: { tabId: 17 },
    world: "ISOLATED",
    files: ["target-shadow.js"]
  });
  assert.equal(runtime.injections[1]?.world, "ISOLATED");
  const post = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/shadow-observations/target"));
  assert.ok(post);
  const body = JSON.parse(String(post.options.body)) as Record<string, unknown>;
  assert.equal(body.retailerSku, "1011483414");
  assert.equal("url" in body, false);
  assert.equal("cookie" in body, false);
  assert.equal(JSON.stringify(body).includes("DO_NOT_SEND"), false);
  assert.equal((post.options.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.equal((response.state as Record<string, unknown>).chromeMutationEnabled, false);
});

test("the service worker fails before tab access or injection when Target permission is absent", async () => {
  const runtime = harness({ permission: false });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, false);
  assert.match(String(response.message), /Allow Target page access/);
  assert.equal(runtime.injections.length, 0);
  assert.equal(runtime.fetchCalls.length, 0);
});

test("the service worker records four sanitized Walmart drawings without entering or reading account state", async () => {
  const runtime = harness({ activeUrl: `${WALMART_DRAW_URL}?source=DO_NOT_SEND` });
  const response = await runtime.send({ type: "yoink:inspect-walmart-draw" });
  assert.equal(response.ok, true);
  assert.equal((response.scan as Record<string, unknown>).outcome, "passed");
  assert.equal(((response.scan as Record<string, unknown>).items as unknown[]).length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.injections[0])), {
    target: { tabId: 17 },
    world: "ISOLATED",
    files: ["retailer-shadow.js"]
  });
  assert.equal((runtime.injections[1]?.args as unknown[])?.[0], "observeWalmartDrawHub");
  const post = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/walmart-draw/scans"));
  assert.ok(post);
  const body = JSON.parse(String(post.options.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "adapterVersion", "contractVersion", "expectedCardCount", "interactiveBlock", "items",
    "observedAt", "observedCardCount", "outcome", "pageKind", "reasonCode", "securityChallenge"
  ]);
  assert.equal(body.adapterVersion, "walmart-draw-observer-v1");
  assert.equal(body.observedCardCount, 4);
  assert.equal(JSON.stringify(body).includes("DO_NOT_SEND"), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(JSON.stringify(body).includes("entryToken"), false);
  assert.equal(JSON.stringify(body).includes("cookie"), false);
});

test("Walmart Draw inspection is exact-route and permission gated before page injection", async () => {
  const wrongPage = harness({ activeUrl: WALMART_PRODUCT_URL });
  const wrongResponse = await wrongPage.send({ type: "yoink:inspect-walmart-draw" });
  assert.equal(wrongResponse.ok, false);
  assert.match(String(wrongResponse.message), /exact Walmart Collectibles Draw page/);
  assert.equal(wrongPage.injections.length, 0);

  const denied = harness({ activeUrl: WALMART_DRAW_URL, permission: false });
  const deniedResponse = await denied.send({ type: "yoink:inspect-walmart-draw" });
  assert.equal(deniedResponse.ok, false);
  assert.match(String(deniedResponse.message), /Allow Walmart page access/);
  assert.equal(denied.injections.length, 0);
});

test("a Walmart Draw observer startup failure is immediately reported through the sanitized draw ledger", async () => {
  const runtime = harness({ activeUrl: `${WALMART_DRAW_URL}?source=DO_NOT_SEND`, retailerObserverFailure: "bundle_injection" });
  const response = await runtime.send({ type: "yoink:inspect-walmart-draw" });
  assert.equal(response.ok, false);
  assert.equal(String(response.message).includes("DO_NOT_SEND"), false);
  assert.equal(String(response.message).includes(TOKEN), false);
  const posts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/walmart-draw/scans"));
  assert.equal(posts.length, 1);
  const body = JSON.parse(String(posts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(body.outcome, "failed");
  assert.equal(body.reasonCode, "observer_bundle_injection_failed");
  assert.equal(body.observedCardCount, 0);
  assert.deepEqual(body.items, []);
  assert.equal(JSON.stringify(body).includes("DO_NOT_SEND"), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("the service worker records one sanitized Amazon exact-offer observation", async () => {
  const runtime = harness({ activeUrl: "https://www.amazon.com/dp/B0GYTRYV7P" });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.observation as Record<string, unknown>).retailerId, "amazon");
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.injections[0])), {
    target: { tabId: 17 },
    world: "ISOLATED",
    files: ["retailer-shadow.js"]
  });
  const post = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/shadow-observations/amazon"));
  assert.ok(post);
  const body = JSON.parse(String(post.options.body)) as Record<string, unknown>;
  assert.equal(body.retailerSku, "B0GYTRYV7P");
  assert.equal(body.adapterVersion, "amazon-observer-v6");
  assert.equal(body.purchaseRouteReady, true);
  assert.equal("url" in body, false);
  assert.equal("cookie" in body, false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  const diagnosticPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.ok(diagnosticPost);
  const diagnosticBody = JSON.parse(String(diagnosticPost.options.body)) as Record<string, unknown>;
  assert.equal(diagnosticBody.outcome, "passed");
  assert.equal(diagnosticBody.failureStage, "complete");
  assert.equal("rawDom" in diagnosticBody, false);
  assert.equal(JSON.stringify(diagnosticBody).includes("offerListingID"), false);
});

test("the service worker transports only the allowlisted structural landmark from a selector miss", async () => {
  const runtime = harness({ activeUrl: AMAZON_PRODUCT_URL, observerRepairLandmark: true });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  const post = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.ok(post);
  const body = JSON.parse(String(post.options.body)) as { layout: Record<string, unknown>; reasonCode: string };
  assert.equal(body.reasonCode, "add_control_selector_miss");
  assert.deepEqual(body.layout.repairLandmarks, [{
    field: "addControl",
    elementKind: "role_button",
    attribute: "data-testid",
    value: "pdp-add-to-cart-control"
  }]);
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("DO_NOT_SEND"), false);
  assert.equal(serialized.includes("textContent"), false);
  assert.equal(serialized.includes("pageText"), false);
  assert.equal(serialized.includes("rawDom"), false);
  assert.equal((body.layout.repairLandmarks as Array<Record<string, unknown>>)
    .some((landmark) => "selector" in landmark), false);
});

test("the service worker transports five fixed repair fields without page or offer values", async () => {
  const runtime = harness({ activeUrl: AMAZON_PRODUCT_URL, observerFiveFieldRepairLandmarks: true });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  const post = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.ok(post);
  const body = JSON.parse(String(post.options.body)) as { layout: Record<string, unknown>; reasonCode: string };
  assert.equal(body.reasonCode, "availability_selector_miss");
  assert.deepEqual(body.layout.repairLandmarks, [
    { field: "availability", elementKind: "div", attribute: "data-testid", value: "product-availability-status" },
    { field: "unitPrice", elementKind: "span", attribute: "data-testid", value: "product-current-price" },
    { field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name" },
    { field: "fulfillment", elementKind: "div", attribute: "data-testid", value: "shipping-fulfillment-option" },
    { field: "addControl", elementKind: "role_button", attribute: "data-testid", value: "pdp-add-to-cart-control" }
  ]);
  assert.equal(body.layout.genericAvailabilityCandidateCount, 1);
  assert.equal(body.layout.genericPriceCandidateCount, 1);
  assert.equal(body.layout.genericSellerCandidateCount, 1);
  assert.equal(body.layout.genericFulfillmentCandidateCount, 1);
  const serialized = JSON.stringify(body);
  for (const forbidden of ["DO_NOT_SEND", "textContent", "pageText", "rawDom"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

for (const [failure, reasonCode] of [
  ["bundle_injection", "observer_bundle_injection_failed"],
  ["execution", "observer_execution_failed"],
  ["top_frame_missing", "observer_top_frame_missing"],
  ["runtime_unavailable", "observer_runtime_unavailable"],
  ["collection", "observer_collection_failed"],
  ["invalid_contract", "observer_contract_invalid"]
] as const) {
  test(`the service worker reports a sanitized ${failure} observer failure after exact identity and permission`, async () => {
    const runtime = harness({ activeUrl: `${AMAZON_PRODUCT_URL}?tracking=DO_NOT_SEND`, retailerObserverFailure: failure });
    const response = await runtime.send({ type: "yoink:inspect-retailer" });
    assert.equal(response.ok, false);
    assert.equal(String(response.message).includes(TOKEN), false);
    assert.equal(String(response.message).includes("DO_NOT_SEND"), false);
    assert.equal(runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/shadow-observations/amazon")), false);
    const diagnosticPosts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
    assert.equal(diagnosticPosts.length, 1);
    const body = JSON.parse(String(diagnosticPosts[0]?.options.body)) as Record<string, unknown>;
    assert.equal(body.retailerId, "amazon");
    assert.equal(body.retailerSku, "B0GYTRYV7P");
    assert.equal(body.adapterVersion, "amazon-observer-v6");
    assert.equal(body.operation, "observe");
    assert.equal(body.outcome, "failed");
    assert.equal(body.failureStage, "runner");
    assert.equal(body.reasonCode, reasonCode);
    assert.equal(body.attemptCount, 1);
    assert.equal(body.domChanged, false);
    assert.equal("canonicalUrl" in body, false);
    const layout = body.layout as Record<string, unknown>;
    assert.deepEqual(JSON.parse(JSON.stringify(layout)), {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "none",
      sellerShape: "none",
      fulfillmentShape: "none",
      addControlCount: 0,
      genericAddIntentCount: 0,
      scopedControlCount: 0,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 0,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    });
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes("DO_NOT_SEND"), false);
    assert.equal(serialized.includes("RAW_BROWSER_ERROR"), false);
    assert.equal(serialized.includes("RAW_PAGE_ERROR"), false);
  });
}

test("retailer observer failures remain private before optional host permission is granted", async () => {
  const runtime = harness({
    activeUrl: `${AMAZON_PRODUCT_URL}?tracking=DO_NOT_SEND`,
    permission: false,
    retailerObserverFailure: "bundle_injection"
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, false);
  assert.match(String(response.message), /Allow amazon page access/);
  assert.equal(runtime.injections.length, 0);
  assert.equal(runtime.fetchCalls.length, 0);
});

test("a retryable diagnostic outage stores one sanitized event and drains it on the next health cycle", async () => {
  const runtime = harness({
    activeUrl: `${AMAZON_PRODUCT_URL}?tracking=DO_NOT_SEND`,
    retailerObserverFailure: "bundle_injection",
    adapterDiagnosticFailures: 1
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, false);
  const queued = runtime.storage.yoinkAdapterDiagnosticQueueV1 as Array<Record<string, unknown>>;
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.deviceId, "device_fixture");
  const queuedBody = JSON.stringify(queued);
  assert.equal(queuedBody.includes("observer_bundle_injection_failed"), true);
  assert.equal(queuedBody.includes(TOKEN), false);
  assert.equal(queuedBody.includes("DO_NOT_SEND"), false);
  assert.equal(queuedBody.includes("RAW_NETWORK_ERROR"), false);
  assert.equal(queuedBody.includes("canonicalUrl"), false);

  runtime.fireHealthAlarm();
  await runtime.adapterDiagnosticQueueDrained;
  const posts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.equal(posts.length, 2);
  assert.equal(posts[0]?.options.body, posts[1]?.options.body);
  assert.equal((runtime.storage.yoinkAdapterDiagnosticQueueV1 as unknown[]).length, 0);
});

test("non-retryable diagnostic rejection is not retained in the durable outbox", async () => {
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    retailerObserverFailure: "collection",
    adapterDiagnosticFailureStatus: 400
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, false);
  assert.equal(String(response.message).includes("RAW_HTTP_ERROR"), false);
  assert.equal(runtime.storage.yoinkAdapterDiagnosticQueueV1, undefined);
});

test("startup drops stale diagnostics and advertises durable delivery without posting them", async () => {
  const stale = queuedRuntimeDiagnostic("B000000001", new Date(Date.now() - 10 * 60_000).toISOString(), {
    rawDom: "DO_NOT_SEND",
    canonicalUrl: `${AMAZON_PRODUCT_URL}?secret=DO_NOT_SEND`
  });
  const runtime = harness({ queuedAdapterDiagnostics: [stale] });
  runtime.fireStartup();
  await runtime.adapterDiagnosticQueueDrained;
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/adapter-diagnostics/")), false);
  assert.equal((runtime.storage.yoinkAdapterDiagnosticQueueV1 as unknown[]).length, 0);
  const heartbeat = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/heartbeat"));
  assert.ok(heartbeat);
  const heartbeatBody = JSON.parse(String(heartbeat.options.body)) as { capabilities: Record<string, unknown> };
  assert.equal(heartbeatBody.capabilities.durableAdapterDiagnostics, true);
  assert.equal(heartbeatBody.capabilities.privacyBoundedRepairLandmarks, true);
  assert.equal(heartbeatBody.capabilities.rotatableDeviceCredentials, true);
});

test("the service worker rotates an aged device credential in two persisted phases", async () => {
  const runtime = harness({ deviceCredentialRotationDue: true });
  const response = await runtime.send({ type: "yoink:check-health" });
  assert.equal(response.ok, true);
  assert.equal((response.state as Record<string, unknown>).paired, true);
  const stored = runtime.storage.pairedDevice as Record<string, unknown>;
  assert.equal(stored.token, ROTATED_TOKEN);
  assert.equal(stored.credentialGeneration, 2);
  assert.equal("pendingCredential" in stored, false);

  const heartbeat = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/heartbeat"));
  const begin = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/credential-rotation/begin"));
  const commit = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/credential-rotation/commit"));
  assert.equal((heartbeat?.options.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.equal((begin?.options.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.equal((commit?.options.headers as Record<string, string>).Authorization, `Bearer ${ROTATED_TOKEN}`);
  assert.deepEqual(JSON.parse(String(commit?.options.body)), { generation: 2 });
});

test("a lost credential commit response resumes from the persisted pending token before heartbeat", async () => {
  const runtime = harness({ deviceCredentialRotationDue: true, deviceCredentialCommitFailures: 1 });
  const first = await runtime.send({ type: "yoink:check-health" });
  assert.equal(first.ok, true);
  const pending = runtime.storage.pairedDevice as Record<string, unknown>;
  assert.equal(pending.token, TOKEN);
  assert.equal((pending.pendingCredential as Record<string, unknown>).token, ROTATED_TOKEN);

  const second = await runtime.send({ type: "yoink:check-health" });
  assert.equal(second.ok, true);
  const recovered = runtime.storage.pairedDevice as Record<string, unknown>;
  assert.equal(recovered.token, ROTATED_TOKEN);
  assert.equal("pendingCredential" in recovered, false);
  const commits = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/credential-rotation/commit"));
  assert.equal(commits.length, 2);
  const begins = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/credential-rotation/begin"));
  assert.equal(begins.length, 1);
  const lastHeartbeat = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/heartbeat")).at(-1);
  assert.equal((lastHeartbeat?.options.headers as Record<string, string>).Authorization, `Bearer ${ROTATED_TOKEN}`);
});

test("startup deduplicates diagnostics and discards entries bound to another device", async () => {
  const diagnostic = queuedRuntimeDiagnostic("B000000002", new Date().toISOString());
  const runtime = harness({
    queuedAdapterDiagnostics: [
      diagnostic,
      diagnostic,
      { ...diagnostic, deviceId: "device_other" }
    ]
  });
  runtime.fireStartup();
  await runtime.adapterDiagnosticQueueDrained;
  const posts = runtime.fetchCalls.filter((entry) => entry.url.includes("/devices/self/adapter-diagnostics/amazon"));
  assert.equal(posts.length, 1);
  assert.equal(String(posts[0]?.options.body).includes("B000000002"), true);
  assert.equal((runtime.storage.yoinkAdapterDiagnosticQueueV1 as unknown[]).length, 0);
});

test("startup drains only the newest fifty canonical diagnostics and strips unknown fields", async () => {
  const queued = Array.from({ length: 55 }, (_, index) => queuedRuntimeDiagnostic(
    `B${String(index).padStart(9, "0")}`,
    new Date(Date.now() - (55 - index) * 10).toISOString(),
    { rawDom: `DO_NOT_SEND_${index}`, cookie: TOKEN }
  ));
  const runtime = harness({ queuedAdapterDiagnostics: queued });
  runtime.fireStartup();
  await runtime.adapterDiagnosticQueueDrained;
  const posts = runtime.fetchCalls.filter((entry) => entry.url.includes("/devices/self/adapter-diagnostics/amazon"));
  assert.equal(posts.length, 50);
  assert.equal(String(posts[0]?.options.body).includes("B000000000"), false);
  assert.equal(String(posts.at(-1)?.options.body).includes("B000000054"), true);
  const serialized = JSON.stringify(posts.map((entry) => entry.options.body));
  assert.equal(serialized.includes("DO_NOT_SEND"), false);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes("rawDom"), false);
  assert.equal(serialized.includes("cookie"), false);
  assert.equal((runtime.storage.yoinkAdapterDiagnosticQueueV1 as unknown[]).length, 0);
});

test("community sharing is an explicit one-shot action that sends only server evidence references", async () => {
  const runtime = harness({ activeUrl: "https://www.amazon.com/dp/B0GYTRYV7P" });
  const response = await runtime.send({ type: "yoink:contribute-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.receipt as Record<string, unknown>).disposition, "accepted");
  const nonce = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/community/nonces/amazon"));
  const contribution = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/community/contributions/amazon"));
  assert.ok(nonce);
  assert.ok(contribution);
  const body = JSON.parse(String(contribution.options.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["adapterDiagnosticId", "contractVersion", "nonce", "shadowObservationId"]);
  assert.equal(body.shadowObservationId, "shadow_observation_amazon_fixture");
  assert.equal(body.adapterDiagnosticId, "adapter_diagnostic_fixture");
  assert.equal(JSON.stringify(body).includes("B0GYTRYV7P"), false);
  assert.equal(JSON.stringify(body).includes("Amazon.com"), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);

  const second = await runtime.send({ type: "yoink:contribute-retailer" });
  assert.equal(second.ok, false);
  assert.match(String(second.message), /already shared within the last minute/);
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.includes("/community/nonces/")).length, 1);
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.includes("/community/contributions/")).length, 1);
});

test("the packaged interpreter verifies and pins a signed observer-only recipe before reporting bounded agreement", async () => {
  const fixture = signedObserverRecipe();
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.recipeTrial as Record<string, unknown>).id, "observer_recipe_trial_fixture");
  const trial = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/observer-recipe-trials/amazon"));
  assert.ok(trial);
  const body = JSON.parse(String(trial.options.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "agreedFieldCount", "ambiguousFieldCount", "contractVersion", "evaluatedFieldCount",
    "fieldOutcomes", "insufficientFieldCount", "layoutFingerprint", "observedAt",
    "observerVersion", "oracleAgreedFieldCount", "oracleConflictFieldCount",
    "oracleEvaluatedFieldCount", "outcome", "packagedConflictFieldCount",
    "packagedMissingFieldCount", "recipeId", "recipeVersion", "retailerId",
    "retailerSku", "validationProfile"
  ]);
  assert.equal(body.contractVersion, 2);
  assert.equal(body.outcome, "passed");
  assert.equal(body.validationProfile, "packaged_structured_oracle_v1");
  assert.equal(body.oracleAgreedFieldCount, 5);
  assert.equal(body.retailerSku, "B0GYTRYV7P");
  assert.match(String(body.layoutFingerprint), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(body).includes("Amazon.com"), false);
  assert.equal(JSON.stringify(body).includes("#availability"), false);
  const trust = runtime.storage.yoinkObserverRecipeTrustStateV1 as Record<string, unknown>;
  assert.equal(trust.generation, 1);
  assert.match(String(trust.manifestHash), /^[a-f0-9]{64}$/);
  assert.match(String(trust.activeKeyId), /^[a-f0-9]{64}$/);
  assert.equal(runtime.storage.yoinkObserverRecipeKeyPinV1, undefined);
});

test("a packaged observer conflict is reported immediately without invoking a mutation runner", async () => {
  const fixture = signedObserverRecipe();
  const fieldOutcomes = ["availability", "unitPrice", "seller", "fulfillment", "addControl"].map((field) => ({
    field,
    recipeState: "value",
    packagedState: field === "unitPrice" ? "conflict" : "agreed",
    oracleState: field === "unitPrice" ? "not_evaluated" : "agreed",
    disposition: field === "unitPrice" ? "conflict" : "verified"
  }));
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root,
    observerRecipeEvaluation: {
      validationProfile: "packaged_structured_oracle_v1",
      evaluatedFieldCount: 5,
      agreedFieldCount: 4,
      ambiguousFieldCount: 0,
      oracleEvaluatedFieldCount: 4,
      oracleAgreedFieldCount: 4,
      oracleConflictFieldCount: 0,
      packagedMissingFieldCount: 0,
      packagedConflictFieldCount: 1,
      insufficientFieldCount: 0,
      fieldOutcomes,
      shape: "unitPrice:value:conflict:not_evaluated:conflict"
    }
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  const trial = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/observer-recipe-trials/amazon"));
  assert.ok(trial);
  const body = JSON.parse(String(trial.options.body)) as Record<string, unknown>;
  assert.equal(body.outcome, "failed");
  assert.equal(body.packagedConflictFieldCount, 1);
  assert.equal(JSON.stringify(body).includes("2186"), false);
  assert.equal(JSON.stringify(body).includes("Amazon.com"), false);
  const injectedFiles = runtime.injections.flatMap((entry) => Array.isArray(entry.files) ? entry.files as string[] : []);
  assert.equal(injectedFiles.includes("observer-recipe-oracle.js"), true);
  assert.equal(injectedFiles.some((file) => ["amazon-action.js", "walmart-action.js", "target-action.js", "bestbuy-action.js"].includes(file)), false);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.equal(status.outcome, "failed");
  assert.equal(status.packagedConflictFieldCount, 1);
});

test("a bad observer recipe signature fails closed without affecting bundled evidence", async () => {
  const fixture = signedObserverRecipe(true);
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal(response.recipeTrial, null);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/observer-recipe-trials/")), false);
  assert.equal(runtime.storage.yoinkObserverRecipeKeyPinV1, undefined);
  assert.equal(runtime.storage.yoinkObserverRecipeTrustStateV1, undefined);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.equal(status.state, "rejected");
  assert.match(String(status.message), /signature is invalid/);
});

test("a root-signed intermediate rotation extends pinned trust and accepts only the new key", async () => {
  const fixture = rotatedObserverRecipe();
  assert.ok(fixture.priorTrustState);
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root,
    observerRecipeTrustState: fixture.priorTrustState
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.recipeTrial as Record<string, unknown>).id, "observer_recipe_trial_fixture");
  const trust = runtime.storage.yoinkObserverRecipeTrustStateV1 as Record<string, unknown>;
  assert.equal(trust.generation, 2);
  assert.equal(trust.transparencySequence, 2);
  assert.deepEqual(trust.revokedKeyIds, [fixture.priorTrustState?.activeKeyId].filter(Boolean));
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/observer-recipe-trials/")), true);
});

test("a recipe signed by a root-revoked intermediate fails closed", async () => {
  const fixture = rotatedObserverRecipe(true);
  assert.ok(fixture.priorTrustState);
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root,
    observerRecipeTrustState: fixture.priorTrustState
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal(response.recipeTrial, null);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/observer-recipe-trials/")), false);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.match(String(status.message), /signing key is revoked/);
  assert.equal((runtime.storage.yoinkObserverRecipeTrustStateV1 as Record<string, unknown>).generation, 1);
});

test("a valid older root manifest cannot roll back a companion's pinned generation", async () => {
  const fixture = signedObserverRecipe();
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root,
    observerRecipeTrustState: {
      contractVersion: 1,
      rootKeyId: fixture.root.keyId,
      generation: 2,
      manifestHash: "9".repeat(64),
      transparencySequence: 2,
      transparencyEventHash: "8".repeat(64)
    }
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal(response.recipeTrial, null);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.match(String(status.message), /manifest was rolled back/);
});

test("a manifest with a corrupted offline-root signature is rejected before recipe evaluation", async () => {
  const fixture = signedObserverRecipe();
  const trust = fixture.distribution.trust as Record<string, unknown>;
  const manifest = trust.manifest as Record<string, unknown>;
  const signature = String(manifest.signature);
  manifest.signature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal(response.recipeTrial, null);
  assert.equal(runtime.storage.yoinkObserverRecipeTrustStateV1, undefined);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.match(String(status.message), /root signature is invalid/);
});

test("a tampered transparency receipt is rejected before recipe evaluation", async () => {
  const fixture = signedObserverRecipe();
  const trust = fixture.distribution.trust as Record<string, unknown>;
  const receipt = trust.transparencyReceipt as Record<string, unknown>;
  receipt.eventHash = "0".repeat(64);
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal(response.recipeTrial, null);
  assert.equal(runtime.storage.yoinkObserverRecipeTrustStateV1, undefined);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.match(String(status.message), /transparency receipt is invalid/);
});

test("the service worker records Disney Store evidence through the generic read-only lane", async () => {
  const runtime = harness({ activeUrl: `${DISNEY_PRODUCT_URL}?CMP=DO_NOT_SEND` });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.observation as Record<string, unknown>).retailerId, "disney");
  const observationPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/shadow-observations/disney"));
  assert.ok(observationPost);
  const observationBody = JSON.parse(String(observationPost.options.body)) as Record<string, unknown>;
  assert.equal(observationBody.adapterVersion, "disney-observer-v1");
  assert.equal(observationBody.retailerSku, "409914998395");
  assert.equal(observationBody.canonicalUrl, DISNEY_PRODUCT_URL);
  assert.equal(JSON.stringify(observationBody).includes("DO_NOT_SEND"), false);
  const diagnosticPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/disney"));
  assert.ok(diagnosticPost);
  const diagnosticBody = JSON.parse(String(diagnosticPost.options.body)) as Record<string, unknown>;
  assert.equal(diagnosticBody.operation, "observe");
  assert.equal(diagnosticBody.outcome, "passed");
  assert.equal(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.includes("disney-action.js")), false);
});

test("the service worker records Premium Bandai and Pokémon Center through read-only lanes only", async () => {
  const examples = [
    ["pbandai", PBANDAI_PRODUCT_URL, "pbandai-observer-v2", "N2884150001"],
    ["pokemoncenter", POKEMONCENTER_PRODUCT_URL, "pokemoncenter-observer-v2", "10-10320-101"]
  ] as const;
  for (const [retailerId, activeUrl, adapterVersion, retailerSku] of examples) {
    const runtime = harness({ activeUrl: `${activeUrl}?tracking=DO_NOT_SEND` });
    const response = await runtime.send({ type: "yoink:inspect-retailer" });
    assert.equal(response.ok, true, retailerId);
    const post = runtime.fetchCalls.find((entry) => entry.url.endsWith(`/devices/self/shadow-observations/${retailerId}`));
    assert.ok(post, retailerId);
    const body = JSON.parse(String(post.options.body)) as Record<string, unknown>;
    assert.equal(body.adapterVersion, adapterVersion, retailerId);
    assert.equal(body.retailerSku, retailerSku, retailerId);
    assert.equal(JSON.stringify(body).includes("DO_NOT_SEND"), false, retailerId);
    assert.equal(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.some((file) => file.includes(`${retailerId}-action`))), false, retailerId);
  }
});

test("the service worker retries one hydrating Amazon layout and reports a recovered structural diagnostic", async () => {
  const runtime = harness({ activeUrl: AMAZON_PRODUCT_URL, amazonHydrationRetry: true });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.observation as Record<string, unknown>).addControlActionable, true);
  const diagnosticPosts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.equal(diagnosticPosts.length, 1);
  const diagnostic = JSON.parse(String(diagnosticPosts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(diagnostic.outcome, "recovered");
  assert.equal(diagnostic.failureStage, "offer_binding");
  assert.equal(diagnostic.reasonCode, "dom_hydration_recovered");
  assert.equal(diagnostic.attemptCount, 2);
  assert.equal(JSON.stringify(diagnostic).includes("offerListingID"), false);
});

test("the service worker captures observer-v4 evidence and rehearses Walmart add-v3 without clicking", async () => {
  const runtime = harness({ activeUrl: WALMART_PRODUCT_URL });
  const inspection = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(inspection.ok, true);
  assert.equal((inspection.observation as Record<string, unknown>).retailerId, "walmart");
  const rehearsal = await runtime.send({ type: "yoink:rehearse-walmart" });
  assert.equal(rehearsal.ok, true);
  assert.equal((rehearsal.rehearsal as Record<string, unknown>).ok, true);
  assert.ok(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.includes("walmart-action.js")));
  assert.ok(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "rehearseWalmartAdd"));
  const observationPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/shadow-observations/walmart"));
  assert.ok(observationPost);
  const observationBody = JSON.parse(String(observationPost.options.body)) as Record<string, unknown>;
  assert.equal(observationBody.adapterVersion, "walmart-observer-v4");
  assert.equal(observationBody.retailerSku, "17354421975");
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/walmart-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "walmart-add-v3");
  assert.equal(trialBody.observerVersion, "walmart-observer-v4");
  assert.equal(trialBody.outcome, "passed");
  assert.equal(JSON.stringify(trialBody).includes("4499"), false);
  assert.equal(JSON.stringify(trialBody).includes(WALMART_PRODUCT_URL), false);
  assert.equal(JSON.stringify(trialBody).includes(TOKEN), false);
});

test("the service worker rehearses Amazon add-v5 without persisting its offer token", async () => {
  const runtime = harness({ activeUrl: AMAZON_PRODUCT_URL });
  const rehearsal = await runtime.send({ type: "yoink:rehearse-amazon" });
  assert.equal(rehearsal.ok, true);
  assert.equal((rehearsal.rehearsal as Record<string, unknown>).ok, true);
  assert.ok(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.includes("amazon-action.js")));
  assert.ok(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "rehearseAmazonAdd"));
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/amazon-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "amazon-add-v5");
  assert.equal(trialBody.observerVersion, "amazon-observer-v6");
  assert.equal(trialBody.outcome, "passed");
  assert.equal(JSON.stringify(trialBody).includes("offerListing"), false);
  assert.equal(JSON.stringify(trialBody).includes(TOKEN), false);
  const diagnostics = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.equal(diagnostics.length, 2);
  const rehearsalDiagnostic = JSON.parse(String(diagnostics.at(-1)?.options.body)) as Record<string, unknown>;
  assert.equal(rehearsalDiagnostic.operation, "rehearse_add");
  assert.equal(rehearsalDiagnostic.outcome, "passed");
  assert.equal(rehearsalDiagnostic.failureStage, "complete");
  assert.equal(JSON.stringify(rehearsalDiagnostic).includes("offerListing"), false);
});

test("the service worker captures observer-v5 evidence and rehearses Best Buy add-v3 without clicking", async () => {
  const runtime = harness({ activeUrl: BESTBUY_PRODUCT_URL });
  const rehearsal = await runtime.send({ type: "yoink:rehearse-bestbuy" });
  assert.equal(rehearsal.ok, true);
  assert.equal((rehearsal.rehearsal as Record<string, unknown>).ok, true);
  assert.ok(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.includes("bestbuy-action.js")));
  assert.ok(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "rehearseBestBuyAdd"));
  const observationPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/shadow-observations/bestbuy"));
  assert.ok(observationPost);
  const observationBody = JSON.parse(String(observationPost.options.body)) as Record<string, unknown>;
  assert.equal(observationBody.adapterVersion, "bestbuy-observer-v5");
  assert.equal(observationBody.retailerSku, "6588149");
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/bestbuy-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "bestbuy-add-v3");
  assert.equal(trialBody.observerVersion, "bestbuy-observer-v5");
  assert.equal(trialBody.outcome, "passed");
  assert.equal(JSON.stringify(trialBody).includes("699"), false);
  assert.equal(JSON.stringify(trialBody).includes(BESTBUY_PRODUCT_URL), false);
  assert.equal(JSON.stringify(trialBody).includes(TOKEN), false);
  const diagnostics = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/bestbuy"));
  assert.equal(diagnostics.length, 2);
  const diagnostic = JSON.parse(String(diagnostics.at(-1)?.options.body)) as Record<string, unknown>;
  assert.equal(diagnostic.operation, "rehearse_add");
  assert.equal(diagnostic.outcome, "passed");
  assert.equal(diagnostic.failureStage, "complete");
});

test("the service worker rejects a non-Target active tab before injection", async () => {
  const runtime = harness({ activeUrl: "https://attacker.example/p/-/A-1011483414" });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, false);
  assert.match(String(response.message), /exact Target product page/);
  assert.equal(runtime.injections.length, 0);
  assert.equal(runtime.fetchCalls.length, 0);
});

test("the service worker records one sanitized Target add rehearsal without clicking", async () => {
  const runtime = harness();
  const response = await runtime.send({ type: "yoink:rehearse-target" });
  assert.equal(response.ok, true);
  assert.equal((response.rehearsal as Record<string, unknown>).ok, true);
  assert.equal(runtime.injections.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.injections[2])), {
    target: { tabId: 17 },
    world: "ISOLATED",
    files: ["target-action.js"]
  });
  const operation = runtime.injections[3]?.args as unknown[];
  assert.equal(operation[0], "rehearseTargetAdd");
  const post = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/target-add"));
  assert.ok(post);
  const body = JSON.parse(String(post.options.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "adapterVersion",
    "contractVersion",
    "observedAt",
    "observerVersion",
    "outcome",
    "reasonCode",
    "shadowObservationId"
  ]);
  assert.equal(body.outcome, "passed");
  assert.equal(body.reasonCode, "verified");
  assert.equal(JSON.stringify(body).includes("5999"), false);
  assert.equal(JSON.stringify(body).includes(PRODUCT_URL), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("the service worker runs one leased Target add through preflight, click receipt, and exact cart proof", async () => {
  const runtime = harness({ liveJob: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture Target job did not complete.")), 3_000))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(runtime.jobStates, [
    "navigating",
    "verifying_listing",
    "offer_verified",
    "add_authorized",
    "adding",
    "cart_verified",
    "confirmed"
  ]);
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  assert.equal(operations.filter((operation) => operation === "inspectTargetEmptyCart").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareTargetAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitTargetAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyTargetAddedCart").length, 1);
  assert.equal("activeTargetJob" in runtime.storage, false);
});

test("the service worker runs one leased Walmart add through its own cart and runner", async () => {
  const runtime = harness({ walmartJob: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture Walmart job did not complete.")), 3_000))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(runtime.jobStates, [
    "navigating",
    "verifying_listing",
    "offer_verified",
    "add_authorized",
    "adding",
    "cart_verified",
    "confirmed"
  ]);
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  assert.equal(operations.filter((operation) => operation === "inspectWalmartEmptyCart").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareWalmartAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitWalmartAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyWalmartAddedCart").length, 1);
  assert.ok(runtime.tabUrls().includes("https://www.walmart.com/cart"));
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
  assert.equal("activeTargetJob" in runtime.storage, false);
});

test("the service worker runs one leased Amazon add through its own cart and isolated runner", async () => {
  const runtime = harness({ amazonJob: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture Amazon job did not complete.")), 3_000))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(runtime.jobStates, [
    "navigating",
    "verifying_listing",
    "offer_verified",
    "add_authorized",
    "adding",
    "cart_verified",
    "confirmed"
  ]);
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  assert.equal(operations.filter((operation) => operation === "inspectAmazonEmptyCart").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareAmazonAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitAmazonAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyAmazonAddedCart").length, 1);
  assert.ok(runtime.tabUrls().includes("https://www.amazon.com/gp/cart/view.html"));
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
});

test("the service worker runs one leased Best Buy add through its own empty-cart and exact-cart proof", async () => {
  const runtime = harness({ bestBuyJob: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture Best Buy job did not complete.")), 3_000))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(runtime.jobStates, [
    "navigating",
    "verifying_listing",
    "offer_verified",
    "add_authorized",
    "adding",
    "cart_verified",
    "confirmed"
  ]);
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  assert.equal(operations.filter((operation) => operation === "inspectBestBuyEmptyCart").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareBestBuyAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitBestBuyAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyBestBuyAddedCart").length, 1);
  assert.ok(runtime.tabUrls().includes("https://www.bestbuy.com/cart"));
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
});

test("a cold worker cancels pre-boundary work without clicking", async () => {
  const runtime = harness({ liveJob: true, activeJob: "pre_boundary" });
  runtime.fireStartup();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(runtime.jobStates, ["cancelled"]);
  assert.equal(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "commitTargetAdd"), false);
  assert.equal("activeTargetJob" in runtime.storage, false);
});

test("a cold worker after the add boundary verifies cart without a second click", async () => {
  const runtime = harness({ liveJob: true, activeJob: "post_boundary" });
  runtime.fireStartup();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture recovery did not confirm the cart.")), 3_000))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(runtime.jobStates, ["cart_verified", "confirmed"]);
  assert.equal(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "commitTargetAdd"), false);
  assert.equal("activeTargetJob" in runtime.storage, false);
});

test("a cold worker drains one durable TrackaLacker signal exactly once", async () => {
  const runtime = harness({ queuedTrackalackerSignal: true });
  runtime.fireStartup();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(runtime.deliveredTrackalackerSignals.length, 1);
  assert.equal(runtime.deliveredTrackalackerSignals[0]?.signalId, "push:trackalacker:queued-fixture-1234");
  assert.equal(Array.isArray(runtime.storage.yoinkTrackalackerPushQueueV1), true);
  assert.equal((runtime.storage.yoinkTrackalackerPushQueueV1 as unknown[]).length, 0);
  assert.equal(JSON.stringify(runtime.storage.yoinkTrackalackerPushQueueV1).includes(TOKEN), false);
  assert.equal(JSON.stringify(runtime.deliveredTrackalackerSignals).includes(TOKEN), false);

  runtime.fireStartup();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(runtime.deliveredTrackalackerSignals.length, 1);
});

test("TrackaLacker push stays silent when supported and exposes no signed click token", async () => {
  const runtime = harness({ trackalackerPush: true });
  await runtime.firePush({
    title: "IN STOCK at Amazon!",
    body: "Runtime Fixture Product\nAvailable for $21.86",
    url: "https://www.trackalacker.com/products/showcase/runtime-fixture?notification_id=DO_NOT_FORWARD&utm_term=138022"
  });
  assert.equal(runtime.deliveredTrackalackerSignals.length, 1);
  assert.equal(runtime.shownTrackalackerNotifications.length, 0);
  assert.equal(JSON.stringify(runtime.deliveredTrackalackerSignals).includes("DO_NOT_FORWARD"), false);
  assert.equal(JSON.stringify(runtime.storage).includes("DO_NOT_FORWARD"), false);
});

test("legacy visible-push fallback shows one TrackaLacker notification while delivering one signal", async () => {
  const runtime = harness({ trackalackerPush: true, visibleTrackalackerFallback: true });
  await runtime.firePush({
    title: "IN STOCK at Target!",
    body: "Runtime Fixture Product\nAvailable for $59.99",
    url: "https://www.trackalacker.com/products/showcase/runtime-fixture?utm_term=138022"
  });
  assert.equal(runtime.deliveredTrackalackerSignals.length, 1);
  assert.equal(runtime.shownTrackalackerNotifications.length, 1);
  assert.equal(runtime.shownTrackalackerNotifications[0]?.title, "IN STOCK at Target!");
});

test("the service worker durably shows one Chrome notification and routes a recorded click", async () => {
  const runtime = harness({ notification: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.notificationCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture notification was not acknowledged.")), 3_000))
  ]);
  assert.equal(runtime.shownNotifications.length, 1);
  assert.equal(runtime.shownNotifications[0]?.id, "yoink-opportunity:notification_delivery_fixture");
  assert.equal(runtime.shownNotifications[0]?.options.iconUrl, `chrome-extension://${"a".repeat(32)}/yoink-icon.svg`);
  assert.equal(JSON.stringify(runtime.storage).includes("N".repeat(43)), false);

  runtime.fireJobAlarm();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runtime.shownNotifications.length, 1);

  runtime.clickNotification("yoink-opportunity:notification_delivery_fixture");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(runtime.notificationInteractions, ["clicked"]);
  assert.ok(runtime.tabUrls().includes(PRODUCT_URL));
});

test("the service worker checks the exact local release and starts one update download", async () => {
  const runtime = harness({ releaseVersion: "0.7.0", releaseReady: true });
  const response = await runtime.send({ type: "yoink:check-update", download: true });
  assert.equal(response.ok, true);
  const update = response.update as Record<string, unknown>;
  assert.equal(update.installedVersion, "0.3.0");
  assert.equal(update.releaseVersion, "0.7.0");
  assert.equal(update.updateAvailable, true);
  assert.equal(update.downloadStarted, true);
  assert.ok(runtime.tabUrls().includes("http://127.0.0.1:32991/api/v1/extension/release/download"));
});

test("the production service worker uses only its pinned HTTPS API and never opens the local ZIP channel", async () => {
  const runtime = harness({ runtimeProfile: "production" });
  const updateResponse = await runtime.send({ type: "yoink:check-update", download: true });
  assert.equal(updateResponse.ok, true);
  assert.deepEqual({ ...(updateResponse.update as Record<string, unknown>) }, {
    installedVersion: "0.3.0",
    releaseVersion: "0.3.0",
    updateAvailable: false,
    packageReady: false,
    sha256: "",
    sizeBytes: 0,
    downloadUrl: "",
    downloadStarted: false,
    channel: "managed",
    managedByBrowser: true
  });
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/extension/release")), false);
  assert.equal(runtime.tabUrls().some((url) => url.includes("/extension/release/download")), false);

  const health = await runtime.send({ type: "yoink:check-health" });
  assert.equal(health.ok, true);
  assert.equal(runtime.fetchCalls.every((entry) => entry.url.startsWith("https://api.yoink.example/api/v1/")), true);
  const heartbeat = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/heartbeat"));
  const body = JSON.parse(String(heartbeat?.options.body)) as { capabilities: Record<string, unknown> };
  assert.equal(body.capabilities.productionTransportProfile, true);
  assert.equal(body.capabilities.managedExtensionUpdates, true);
});
