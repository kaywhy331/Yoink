import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";
import { RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES } from "../packages/contracts/src/index.js";

const PUSH_ENDPOINT = "https://push.example.test/yoink-fixture";
const TOKEN = "T".repeat(43);
const ROTATED_TOKEN = "R".repeat(43);
const PRODUCT_URL = "https://www.target.com/p/fixture/-/A-1011483414";
const WALMART_PRODUCT_URL = "https://www.walmart.com/ip/fixture/17354421975";
const AMAZON_PRODUCT_URL = "https://www.amazon.com/dp/B0GYTRYV7P";
const BESTBUY_PRODUCT_URL = "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149";
const PACKAGED_ADD_VERSIONS = {
  target: "target-add-v12", walmart: "walmart-add-v10", amazon: "amazon-add-v11", bestbuy: "bestbuy-add-v18"
} as const;
const PACKAGED_OBSERVER_VERSIONS = {
  target: "target-observer-v9", walmart: "walmart-observer-v8", amazon: "amazon-observer-v9", bestbuy: "bestbuy-observer-v14"
} as const;
const FUTURE_TARGET_OBSERVER_VERSION = PACKAGED_OBSERVER_VERSIONS.target.replace(/v(\d+)$/,
  (_match: string, version: string) => `v${Number(version) + 1}`);
const DISNEY_PRODUCT_URL = "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html";
const PBANDAI_PRODUCT_URL = "https://p-bandai.com/us/item/N2884150001";
const POKEMONCENTER_PRODUCT_URL = "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder";
const WALMART_DRAW_URL = "https://www.walmart.com/shop/collectibles/draw";
const WARM_READINESS_CONTROL = Object.freeze({
  connected: true,
  paired: true,
  executionMode: "live",
  actionsPaused: false,
  chromeMutationEnabled: true,
  targetAddExecutionEnabled: true,
  walmartAddExecutionEnabled: true,
  amazonAddExecutionEnabled: true,
  bestbuyAddExecutionEnabled: true
});

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

function isRuntimeCapsuleInput(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return typeof input.trigger === "string"
    && Boolean(input.diagnostic)
    && typeof input.diagnostic === "object"
    && !Array.isArray(input.diagnostic);
}

function runtimeCapsuleFixture(
  input: Record<string, unknown>,
  url: string,
  sequence: number
): Record<string, unknown> {
  const snapshotHtml = "<!DOCTYPE html><html data-yoink-vis=\"1\"><head><meta itemprop=\"price\" content=\"59.99\" data-yoink-vis=\"1\" data-yoink-rect=\"0,0,0,0\"></head><body data-yoink-vis=\"1\"><button data-testid=\"add-to-cart\" data-yoink-vis=\"1\" data-yoink-rect=\"12,24,120,40\">Add to cart</button><input name=\"email\" value=\"\" data-yoink-vis=\"0\" data-yoink-rect=\"0,0,0,0\"></body></html>";
  const compressed = gzipSync(snapshotHtml);
  const diagnostic = input.diagnostic as Record<string, unknown>;
  return {
    contractVersion: 1,
    id: `cap_runtimefixture${sequence}`,
    capturedAt: new Date().toISOString(),
    retailerId: input.retailerId,
    retailerSku: input.retailerSku,
    operation: diagnostic.operation,
    trigger: input.trigger,
    outcome: diagnostic.outcome,
    failureStage: diagnostic.failureStage,
    reasonCode: diagnostic.reasonCode,
    observerVersion: input.observerVersion,
    addAdapterVersion: input.addAdapterVersion,
    packVersion: input.packVersion,
    extensionVersion: input.extensionVersion,
    url: url.split(/[?#]/, 1)[0],
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    requiredFulfillment: input.requiredFulfillment,
    diagnostic,
    trace: input.trace,
    snapshot: {
      encoding: "gzip+base64",
      bytes: compressed.length,
      sha256: createHash("sha256").update(compressed).digest("hex"),
      html: compressed.toString("base64")
    },
    redactions: {
      scriptsRemoved: 1,
      jsonBlocksKept: 0,
      keysRedacted: 1,
      inputsCleared: 1,
      iframesReduced: 0,
      mediaStripped: 0,
      textRedactions: 1
    },
    reductionApplied: [],
    truncated: false
  };
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
  adapterVersion: "target-observer-v9",
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
  adapterVersion: "amazon-observer-v9",
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
  adapterVersion: "walmart-observer-v8",
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
  adapterVersion: "bestbuy-observer-v14",
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
  adapterVersion: "disney-observer-v2",
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
  adapterVersion: "pbandai-observer-v3",
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
  adapterVersion: "pokemoncenter-observer-v4",
  retailerId: "pokemoncenter",
  retailerSku: "10-10320-101",
  canonicalUrl: POKEMONCENTER_PRODUCT_URL,
  unitPriceCents: 2999,
  sellerName: "Pokémon Center",
  selectedOffer: selectedOffer("10-10320-101")
};
const WALMART_DRAW_SCAN = {
  adapterVersion: "walmart-draw-observer-v2",
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

function diagnosticFor(observation: typeof OBSERVATION | typeof AMAZON_OBSERVATION | typeof WALMART_OBSERVATION | typeof BESTBUY_OBSERVATION | typeof DISNEY_OBSERVATION | typeof PBANDAI_OBSERVATION | typeof POKEMONCENTER_OBSERVATION) {
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
  /** A plan for several (Kevin, 2026-10-10): the leased job's quantity and what the runner reports. */
  jobQuantity?: number;
  quantityPlan?: { requested: number; storeLimit: number | null; add: number; raiseTo: number };
  raiseResult?: Record<string, unknown>;
  cartLineAfterRaise?: number;
  /** How many of the job's item the cart already holds before the add (a repeat call, Kevin 2026-10-12). */
  skuInCart?: number;
  /** A Test call's Walmart job (Kevin, 2026-10-11): its price is a max. */
  jobTestCall?: boolean;
  jobMaxUnitPriceCents?: number;
  /** What Amazon's own-offer step reports (default: it opened Amazon's row). */
  amazonOwnOffer?: Record<string, unknown>;
  bestBuyResolvedSku?: string;
  permission?: boolean;
  deniedOrigins?: string[];
  permittedRetailers?: Array<"target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory">;
  permissionRequest?: boolean;
  activeUrl?: string;
  healthVersion?: string;
  liveJob?: boolean;
  queuedJobCount?: number;
  walmartJob?: boolean;
  amazonJob?: boolean;
  bestBuyJob?: boolean;
  bestBuyPostAddStates?: Array<"queue" | "product" | "cart" | "user_action" | "unknown">;
  bestBuyPendingCart?: boolean;
  bestBuyConflictingCart?: boolean;
  bestBuyCommitNavigation?: boolean;
  bestBuyNotificationFails?: boolean;
  bestBuyCartQueue?: boolean;
  jobHeartbeatFails?: boolean;
  postClickSettleDelayMs?: number;
  persistedActionTab?: boolean;
  cartReadySound?: boolean;
  cartBaselineHydrationRetry?: boolean;
  cartBaselineFailure?: boolean;
  postClickVerificationFailure?: boolean;
  delayedCartResult?: boolean;
  cartConflictAfterAdd?: boolean;
  notification?: boolean;
  notificationPayload?: Record<string, unknown>;
  notificationPayloads?: Array<Record<string, unknown>>;
  notificationClickDuringCreate?: boolean;
  notificationInteractionDelayMs?: number;
  closedNotificationDeliveryIds?: string[];
  releaseVersion?: string;
  releaseReady?: boolean;
  activeJob?: "pre_boundary" | "post_boundary";
  queuedTrackalackerSignal?: boolean;
  trackalackerPush?: boolean;
  visibleTrackalackerFallback?: boolean;
  trackalackerStatusDelayMs?: number;
  trackalackerSignalDelayMs?: number;
  trackalackerNotificationDelayMs?: number;
  trackalackerBatchReceipts?: Array<Array<{ accepted: boolean; retryable?: boolean; errorCode?: string }>>;
  amazonHydrationRetry?: boolean;
  walmartHydrationRetry?: boolean;
  reverificationPlanFailAfterFetches?: number;
  tabNeverLoads?: boolean;
  storeAddGrace?: boolean;
  hydrationExecuteThrows?: boolean;
  evidenceVersionMismatch?: boolean;
  amazonSemanticRecovery?: boolean;
  observerRepairLandmark?: boolean;
  observerFiveFieldRepairLandmarks?: boolean;
  deviceCredentialRotationDue?: boolean;
  pendingDeviceCredential?: boolean;
  deviceCredentialCommitFailures?: number;
  runtimeProfile?: "local" | "production";
  managedUpdateStatus?: "throttled" | "no_update" | "update_available";
  managedUpdateVersion?: string;
  retailerObserverFailure?:
    | "bundle_injection"
    | "execution"
    | "top_frame_missing"
    | "runtime_unavailable"
    | "collection"
    | "invalid_contract";
  adapterDiagnosticFailures?: number;
  adapterDiagnosticFailureStatus?: number;
  adapterDiagnosticDelayMs?: number;
  confirmedJobEventDelayMs?: number;
  /** Yoink takes this long to answer a job's first progress report; a request Chrome gives up on first never arrives. */
  slowJobEventMs?: number;
  hotPathControlDelayMs?: number;
  tabLoadDelayMs?: number;
  queuedAdapterDiagnostics?: Array<Record<string, unknown>>;
  observerRecipeDistribution?: Record<string, unknown>;
  observerRecipeRoot?: Record<string, unknown>;
  observerRecipeTrustState?: Record<string, unknown>;
  observerRecipeEvaluation?: Record<string, unknown>;
  watchLease?: Record<string, unknown>;
  watchObservationSignal?: boolean;
  reverificationPlan?: Record<string, unknown>;
  reverificationPlanCompletesAfterTrial?: boolean;
  localDeletionResidual?: boolean;
  handoffReconciliationStatus?: "cart_ready" | "needs_you" | "closed";
  handoffReconciliationResponses?: Array<{
    availabilityVersion: number;
    status: "cart_ready" | "needs_you" | "closed";
  }>;
  retailerSessionState?: "ready" | "signed_out" | "challenged" | "unknown";
  retailerSessionStates?: Array<"ready" | "signed_out" | "challenged" | "unknown">;
  bestBuyPreorder?: boolean;
  bestBuyShippingFailure?: boolean;
  targetPriceMissing?: boolean;
  targetPriceHydrationRetry?: boolean;
  targetUnavailable?: boolean;
  targetInterstitial?: boolean;
  /** Every device heartbeat answers with this HTTP status instead of 200. */
  heartbeatStatus?: number;
  /** Every jobs/next lease answers with this HTTP status instead of 200. */
  jobLeaseStatus?: number;
  /** The first jobs/next lease returns a job this companion cannot run. */
  unsupportedLeaseFirst?: boolean;
  /** Signal batch receipts all carry index 0 (a server receipt bug). */
  duplicateReceiptIndexes?: boolean;
  /** The live Target page is sold out for this many tries. */
  liveSoldOutTries?: number;
  /** Retry when sold out: the server sets this many retries for a sold-out result. */
  restockRetries?: number;
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 3_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

// The cart proof a runner's verify step returns for the job it was given (its id and quantity).
function verifiedCartProof(args: unknown[] | undefined, retailerId: string, retailerSku: string, unitPriceCents: number) {
  const job = ((args?.[1] as unknown[] | undefined)?.[0] ?? {}) as { jobId?: string; quantity?: number };
  return {
    contractVersion: 1, jobId: String(job.jobId || `job_${retailerId}_fixture`), retailerId, retailerSku,
    observedAt: new Date().toISOString(), quantity: Number(job.quantity) || 1, unitPriceCents,
    sellerName: retailerId === "amazon" ? "Amazon.com" : retailerId === "bestbuy" ? "Best Buy" : retailerId === "walmart" ? "Walmart" : "Target",
    sellerType: "first_party"
  };
}

// The server's MSRP proof for a fixture job at the call's price (synthetic, like the Target one).
function fixtureOfficialMsrp(retailerId: string, retailerSku: string, unitPriceCents: number) {
  return {
    version: 1, evidenceId: `official_msrp_${"a".repeat(32)}`, evidenceHash: "b".repeat(64),
    listingIdentityHash: "c".repeat(64), retailerId, retailerSku,
    desiredVariant: "Standard single item", variantAttributes: {}, msrpCents: unitPriceCents, unitPriceCents,
    currency: "USD", signalObservedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
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
  if (options.persistedActionTab) {
    storage.yoinkRetailerActionTabsV1 = { schemaVersion: 1, tabs: { target: 17 } };
  }
  if (options.cartReadySound) storage.yoinkCartReadySoundEnabledV1 = true;
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
      cartBaseline: options.activeJob === "post_boundary" ? {
        contractVersion: 1,
        retailerId: "target",
        observedAt: new Date().toISOString(),
        lineCount: 1,
        lines: [{ retailerSku: "EXISTING-FIXTURE", quantity: 1 }]
      } : null,
      runnerJob: {
        adapterVersion: "target-add-v12",
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
      registeredFingerprint: createHash("sha256").update(PUSH_ENDPOINT).digest("hex"),
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
  const alarmCreations: Array<Record<string, unknown>> = [];
  const injections: Array<Record<string, unknown>> = [];
  const jobStates: string[] = [];
  const shownNotifications: Array<{ id: string; options: Record<string, unknown> }> = [];
  const clearedNotifications: string[] = [];
  const notificationInteractions: string[] = [];
  const deliveredTrackalackerSignals: Array<Record<string, unknown>> = [];
  const shownTrackalackerNotifications: Array<{ title: string; options: Record<string, unknown> }> = [];
  const permissionRequests: Array<{ origins: string[] }> = [];
  const contextMenuDefinitions = new Map<string, Record<string, unknown>>();
  const actionTitles: string[] = [];
  const badgeTexts: string[] = [];
  const badgeColors: string[] = [];
  const tabUpdates: Array<{ id: number; url?: string; active?: boolean }> = [];
  const tabCreates: Array<{ id: number; url: string; active: boolean }> = [];
  const hotPathTimeline: string[] = [];
  const hotPathControlDelayMs = Math.max(0, Math.min(1_000, Number(options.hotPathControlDelayMs || 0)));
  const tabLoadDelayMs = Math.max(0, Math.min(1_000, Number(options.tabLoadDelayMs || 0)));
  const traceControlAcknowledgement = async (stage: string) => {
    hotPathTimeline.push(`control:${stage}:request`);
    if (hotPathControlDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, hotPathControlDelayMs));
    }
    hotPathTimeline.push(`control:${stage}:response`);
  };
  const tabRemovals: number[] = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  let offscreenCreates = 0;
  const tabs = new Map<number, { id: number; url: string; status: string }>([
    [17, { id: 17, url: options.activeUrl ?? PRODUCT_URL, status: "complete" }]
  ]);
  let nextTabId = 20;
  let messageListener: ((message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean) | undefined;
  let alarmListener: ((alarm: { name: string }) => void) | undefined;
  let notificationClickedListener: ((notificationId: string) => void) | undefined;
  let notificationClosedListener: ((notificationId: string, byUser: boolean) => void) | undefined;
  let startupListener: (() => void) | undefined;
  let updateAvailableListener: ((details: { version: string }) => void) | undefined;
  let managedUpdateChecks = 0;
  let contextMenuClickedListener: ((info: Record<string, unknown>, tab?: Record<string, unknown>) => void) | undefined;
  let commandListener: ((command: string) => void) | undefined;
  let tabRemovedListener: ((tabId: number) => void) | undefined;
  const tabUpdatedListeners = new Set<(
    tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: { id: number; url: string; status: string }
  ) => void>();
  const serviceWorkerListeners = new Map<string, (event: unknown) => void>();
  const expectedJobCount = liveJob
    ? Math.max(1, Math.min(8, Math.trunc(options.queuedJobCount ?? 1)))
    : 0;
  let jobLeaseRequests = 0;
  let soldOutPrepares = 0;
  const raiseCalls: unknown[][] = [];
  let restockPending = false;
  let restockLeases = 0;
  let lastLeasedJob: Record<string, unknown> | null = null;
  let jobsLeased = 0;
  let jobsConfirmed = 0;
  let trackalackerBatchRequestCount = 0;
  let handoffReconciliationRequestCount = 0;
  let retailerSessionInspectionCount = 0;
  let bestBuyPostAddInspectionCount = 0;
  let completeJob: (() => void) | undefined;
  const jobCompleted = new Promise<void>((resolve) => { completeJob = resolve; });
  let completeNotification: (() => void) | undefined;
  const notificationCompleted = new Promise<void>((resolve) => { completeNotification = resolve; });
  let notificationLeaseIndex = 0;
  const fixtureNotificationPayloads = options.notificationPayloads || [options.notificationPayload || {
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
  }];
  let amazonObservationAttempts = 0;
  let walmartObservationAttempts = 0;
  let targetObservationAttempts = 0;
  let reverificationPlanFetches = 0;
  let cartBaselineAttempts = 0;
  let adapterDiagnosticFailuresRemaining = Math.max(0, options.adapterDiagnosticFailures ?? 0);
  let adapterDiagnosticQueueWasNonEmpty = Array.isArray(storage.yoinkAdapterDiagnosticQueueV1)
    && storage.yoinkAdapterDiagnosticQueueV1.length > 0;
  let completeAdapterDiagnosticQueueDrain: (() => void) | undefined;
  const adapterDiagnosticQueueDrained = new Promise<void>((resolve) => { completeAdapterDiagnosticQueueDrain = resolve; });
  const chrome = {
    runtime: {
      id: "a".repeat(32),
      lastError: undefined,
      getManifest: () => ({ version: "0.3.0" }),
      getURL: (path: string) => `chrome-extension://${"a".repeat(32)}/${path}`,
      openOptionsPage: async () => {
        await chrome.tabs.create({ url: `chrome-extension://${"a".repeat(32)}/options.html` });
      },
      getContexts: async () => offscreenCreates ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [],
      sendMessage: async (message: Record<string, unknown>) => { runtimeMessages.push(message); return {}; },
      reload: () => undefined,
      requestUpdateCheck: async () => {
        managedUpdateChecks += 1;
        return {
          status: options.managedUpdateStatus || "no_update",
          ...(options.managedUpdateVersion ? { version: options.managedUpdateVersion } : {})
        };
      },
      onInstalled: { addListener: () => undefined },
      onStartup: { addListener: (listener: typeof startupListener) => { startupListener = listener; } },
      onUpdateAvailable: { addListener: (listener: typeof updateAvailableListener) => { updateAvailableListener = listener; } },
      onMessage: { addListener: (listener: typeof messageListener) => { messageListener = listener; } }
    },
    storage: {
      local: {
        get: async (key: string | string[] | null) => {
          if (key === null) return options.localDeletionResidual ? { retainedFixture: true } : { ...storage };
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, storage[item]]));
          return { [key]: storage[key] };
        },
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
        clear: async () => { for (const key of Object.keys(storage)) delete storage[key]; },
        setAccessLevel: async () => undefined
      },
      session: {
        get: async (key: string | string[] | null) => {
          if (key === null) return options.localDeletionResidual ? { retainedFixture: true } : { ...storage };
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, storage[item]]));
          return { [key]: storage[key] };
        },
        set: async (value: Record<string, unknown>) => { Object.assign(storage, value); },
        remove: async (key: string) => { delete storage[key]; },
        clear: async () => { for (const key of Object.keys(storage)) delete storage[key]; },
        setAccessLevel: async () => undefined
      }
    },
    offscreen: {
      createDocument: async () => { offscreenCreates += 1; }
    },
    permissions: {
      contains: async (request: { origins?: string[] } = {}) => {
        if (options.permission === false) return false;
        if (request.origins?.some(origin => options.deniedOrigins?.includes(origin))) return false;
        if (!Array.isArray(options.permittedRetailers)) return true;
        const origin = String(request.origins?.[0] || "");
        const retailerId = origin.includes("target.com") ? "target"
          : origin.includes("walmart.com") ? "walmart"
            : origin.includes("amazon.com") ? "amazon"
              : origin.includes("bestbuy.com") ? "bestbuy"
                : origin.includes("pokemoncenter.com") ? "pokemoncenter"
                  : origin.includes("www.audioadvice.com") ? "audioadvice"
                  : origin.includes("bananarepublic.gap.com") ? "bananarepublic"
                  : origin.includes("bananarepublicfactory.gapfactory.com") ? "bananarepublicfactory"
                  : origin.includes("athleta.gap.com") ? "athleta"
                  : origin.includes("eshop.asus.com") ? "asus"
                  : origin.includes("ae.com") ? "americaneagle"
                  : origin.includes("aninebing.com") ? "aninebing"
                : "";
        return Boolean(retailerId && options.permittedRetailers.includes(
          retailerId as "target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory"
        ));
      },
      request: async (request: { origins: string[] }) => {
        permissionRequests.push(request);
        return options.permissionRequest !== false;
      }
    },
    tabs: {
      query: async () => [tabs.get(17)],
      get: async (id: number) => tabs.get(id),
      create: async ({ url, active = true }: { url: string; active?: boolean }) => {
        hotPathTimeline.push(`tab:${new URL(url).pathname}`);
        const tab = options.tabNeverLoads
          ? { id: ++nextTabId, url: "about:blank", status: "loading" }
          : { id: ++nextTabId, url, status: "complete" };
        tabCreates.push({ id: tab.id, url, active });
        if (tabLoadDelayMs) await new Promise((resolve) => setTimeout(resolve, tabLoadDelayMs));
        hotPathTimeline.push(`tab-complete:${new URL(url).pathname}`);
        tabs.set(tab.id, tab);
        return tab;
      },
      update: async (id: number, update: { url?: string; active?: boolean }) => {
        const current = tabs.get(id);
        if (!current) throw new Error("Missing fixture tab.");
        tabUpdates.push({ id, ...update });
        if (update.url && options.restockRetries) {
          for (const listener of [...tabUpdatedListeners]) listener(id, { status: "loading", url: update.url }, { ...current, url: update.url, status: "loading" });
        }
        if (update.url) hotPathTimeline.push(`tab:${new URL(update.url).pathname}`);
        if (update.url && tabLoadDelayMs) await new Promise((resolve) => setTimeout(resolve, tabLoadDelayMs));
        if (update.url) hotPathTimeline.push(`tab-complete:${new URL(update.url).pathname}`);
        const tab = { ...current, url: update.url ?? current.url, status: "complete" };
        tabs.set(id, tab);
        return tab;
      },
      remove: async (id: number) => {
        hotPathTimeline.push(`tab-removed:${id}`);
        tabRemovals.push(id);
        tabs.delete(id);
        tabRemovedListener?.(id);
      },
      onUpdated: {
        addListener: (listener: (
          tabId: number,
          changeInfo: { status?: string; url?: string },
          tab: { id: number; url: string; status: string }
        ) => void) => { tabUpdatedListeners.add(listener); },
        removeListener: (listener: (
          tabId: number,
          changeInfo: { status?: string; url?: string },
          tab: { id: number; url: string; status: string }
        ) => void) => { tabUpdatedListeners.delete(listener); }
      },
      onRemoved: { addListener: (listener: typeof tabRemovedListener) => { tabRemovedListener = listener; } }
    },
    scripting: {
      executeScript: async (injection: Record<string, unknown>) => {
        injections.push(injection);
        if ("files" in injection) {
          if (options.retailerObserverFailure === "bundle_injection"
            && ["retailer-shadow.js", "target-shadow.js"].some((file) => (injection.files as string[]).includes(file))) {
            throw new Error(`RAW_BROWSER_ERROR token=${TOKEN} url=${AMAZON_PRODUCT_URL}?secret=DO_NOT_SEND`);
          }
          return [];
        }
        const args = injection.args as unknown[] | undefined;
        if (args?.[0] === "resolveBestBuyProductIdentity") {
          return [{ frameId: 0, result: options.bestBuyResolvedSku ?? "6588149" }];
        }
        const capsuleInput = args?.[0];
        if (isRuntimeCapsuleInput(capsuleInput)) {
          return [{ frameId: 0, result: {
            ok: true,
            capsule: runtimeCapsuleFixture(
              capsuleInput,
              String(tabs.get(17)?.url || PRODUCT_URL),
              injections.length
            )
          } }];
        }
        if (args?.length === 2 && typeof args[0] === "string" && typeof args[1] === "boolean"
          && ["target", "walmart", "amazon", "bestbuy"].includes(args[0])) {
          const observation = args[0] === "target" ? OBSERVATION
            : args[0] === "walmart" ? WALMART_OBSERVATION
              : args[0] === "amazon" ? AMAZON_OBSERVATION : BESTBUY_OBSERVATION;
          return [{ frameId: 0, result: {
            ok: true,
            observation,
            diagnostic: diagnosticFor(observation),
            trace: [{ atMs: 0, phase: "identity", field: "retailerSku", source: "url", result: "matched" }]
          } }];
        }
        if (typeof args?.[0] === "string") hotPathTimeline.push(`operation:${args[0]}`);
        if (args?.[0] === "inspectBestBuyPostAdd") {
          const tabId = (injection.target as { tabId: number }).tabId;
          const url = tabs.get(tabId)?.url || "";
          if (url === "https://www.bestbuy.com/qp") return [{ frameId: 0, result: { state: "queue", reason: "bestbuy_queue_waiting", addControlActionable: false } }];
          if (url === "https://www.bestbuy.com/cart") return [{ frameId: 0, result: {
            state: options.bestBuyCartQueue ? "queue" : "cart", reason: options.bestBuyCartQueue ? "bestbuy_queue_waiting" : "cart_page", addControlActionable: false
          } }];
          const states = options.bestBuyPostAddStates || [];
          const state = states[bestBuyPostAddInspectionCount++] || states.at(-1) || "product";
          return [{ frameId: 0, result: { state, reason: state === "queue" ? "bestbuy_queue_waiting" : state === "user_action" ? "manual_action_required" : "awaiting_cart", addControlActionable: state === "product" } }];
        }
        if (args?.[0] === "inspectRetailerSessionState") {
          const states = options.retailerSessionStates || [];
          const result = states[retailerSessionInspectionCount]
            || states.at(-1)
            || options.retailerSessionState
            || "unknown";
          retailerSessionInspectionCount += 1;
          return [{ frameId: 0, result }];
        }
        if (args?.[0] === "yoink_post_click_settle_arm") {
          return [{ frameId: 0, result: { armed: true, token: args[2] } }];
        }
        if (args?.[0] === "yoink_post_click_settle_wait") {
          const delay = Math.max(0, Math.min(1_500, Number(options.postClickSettleDelayMs || 0)));
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          return [{ frameId: 0, result: { settled: true, reason: "dom_mutation" } }];
        }
        if (args?.[0] === "yoink_post_click_settle_clear") {
          return [{ frameId: 0, result: true }];
        }
        if (args?.[0] === "collectTargetShadowAttempt") {
          if (options.targetInterstitial === true) {
            targetObservationAttempts += 1;
            const observation = {
              ...OBSERVATION,
              availability: "unknown",
              addControlActionable: false,
              securityChallenge: true,
              interactiveBlock: ""
            };
            const diagnostic = {
              ...diagnosticFor(observation),
              outcome: "rejected",
              failureStage: "interactive_block",
              reasonCode: "security_challenge",
              layout: {
                ...diagnosticFor(observation).layout,
                securityChallenge: true,
                interactiveBlock: ""
              }
            };
            return [{ frameId: 0, result: { ok: true, observation, diagnostic } }];
          }
          if (options.targetUnavailable === true) {
            targetObservationAttempts += 1;
            const observation = {
              ...OBSERVATION,
              availability: "out_of_stock",
              addControlActionable: false,
              observationState: "not_actionable"
            };
            const diagnostic = {
              ...diagnosticFor(observation),
              outcome: "rejected",
              failureStage: "availability_binding",
              reasonCode: "out_of_stock"
            };
            return [{ frameId: 0, result: { ok: true, observation, diagnostic } }];
          }
          const priceMissing = options.targetPriceMissing === true
            || (options.targetPriceHydrationRetry === true && targetObservationAttempts === 0);
          targetObservationAttempts += 1;
          const observation = priceMissing
            ? { ...OBSERVATION, unitPriceCents: null }
            : OBSERVATION;
          const diagnostic = priceMissing
            ? {
              ...diagnosticFor(OBSERVATION),
              outcome: "failed",
              failureStage: "price_binding",
              reasonCode: "price_binding_missing",
              layout: { ...diagnosticFor(OBSERVATION).layout, priceCandidateCount: 0 }
            }
            : diagnosticFor(OBSERVATION);
          return [{ frameId: 0, result: {
            ok: true,
            observation,
            diagnostic,
            trace: [{ atMs: 1, phase: "binding", field: "unitPrice", source: "selector_pack", result: priceMissing ? "missing" : "matched" }]
          } }];
        }
        if (args?.[0] === "waitForTargetShadowHydration") {
          if (options.hydrationExecuteThrows) {
            throw new Error(`RAW_BROWSER_ERROR token=${TOKEN} url=${PRODUCT_URL}?secret=DO_NOT_SEND`);
          }
          targetObservationAttempts += 1;
          const priceMissing = options.targetPriceMissing === true;
          const observation = priceMissing ? { ...OBSERVATION, unitPriceCents: null } : OBSERVATION;
          const diagnostic = priceMissing
            ? {
              ...diagnosticFor(OBSERVATION),
              outcome: "failed",
              failureStage: "price_binding",
              reasonCode: "price_binding_missing",
              layout: { ...diagnosticFor(OBSERVATION).layout, priceCandidateCount: 0 }
            }
            : diagnosticFor(OBSERVATION);
          return [{ frameId: 0, result: {
            ok: true,
            observation,
            diagnostic,
            domChanged: true,
            trace: [{ atMs: 2, phase: "binding", field: "unitPrice", source: "selector_pack", result: priceMissing ? "missing" : "matched" }]
          } }];
        }
        if (args?.[0] === "collectOperationDiagnostic") {
          const observation = args[1] === "target" ? OBSERVATION
            : args[1] === "walmart" ? WALMART_OBSERVATION
              : args[1] === "bestbuy" ? BESTBUY_OBSERVATION
                : AMAZON_OBSERVATION;
          return [{ frameId: 0, result: { ok: true, diagnostic: diagnosticFor(observation) } }];
        }
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
        if (args?.[0] === "selectAmazonOwnOffer") {
          return [{ frameId: 0, result: options.amazonOwnOffer ?? { ok: true, reason: "own_offer_selected", selectionClicked: true } }];
        }
        if (args?.[0] === "selectBestBuyShipping") {
          return [{ frameId: 0, result: options.bestBuyShippingFailure
            ? { ok: false, reason: "fulfillment_selection_failed", selectionClicked: true }
            : { ok: true, reason: "verified", selectionClicked: false } }];
        }
        if (args?.[0] === "rehearseBestBuyAdd") {
          return [{ frameId: 0, result: { ok: true, reason: "verified", wouldClick: true, proof: { retailerSku: "6588149" } } }];
        }
        if (args?.[0] === "inspectTargetCartBaseline") {
          cartBaselineAttempts += 1;
          if (options.cartBaselineFailure) {
            return [{ frameId: 0, result: { ok: false, reason: "cart_unverified" } }];
          }
          if (options.cartBaselineHydrationRetry && cartBaselineAttempts === 1) {
            // The real page-world helper performs its retry after a DOM
            // mutation without another chrome.scripting round trip.
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return [{ frameId: 0, result: { ok: true, reason: "verified", proof: {
            contractVersion: 1, retailerId: "target", observedAt: new Date().toISOString(),
            lineCount: 1, lines: [{ retailerSku: "EXISTING-FIXTURE", quantity: options.cartConflictAfterAdd && cartBaselineAttempts > 1 ? 2 : 1 }]
          } } }];
        }
        if (args?.[0] === "inspectWalmartCartBaseline") {
          const raised = raiseCalls.length > 0 && Number.isInteger(options.cartLineAfterRaise);
          const lines = [{ retailerSku: "EXISTING-FIXTURE", quantity: 1 },
            ...(raised ? [{ retailerSku: "17354421975", quantity: options.cartLineAfterRaise! }]
              : options.skuInCart ? [{ retailerSku: "17354421975", quantity: options.skuInCart }] : [])];
          return [{ frameId: 0, result: { ok: true, reason: "verified", proof: {
            contractVersion: 1, retailerId: "walmart", observedAt: new Date().toISOString(),
            lineCount: lines.length, lines
          } } }];
        }
        if (args?.[0] === "raiseWalmartCartQuantity") {
          raiseCalls.push(args[1] as unknown[]);
          return [{ frameId: 0, result: options.raiseResult ?? { ok: true, reason: "quantity_set", quantity: options.cartLineAfterRaise } }];
        }
        if (args?.[0] === "inspectAmazonCartBaseline") {
          const lines = [{ retailerSku: "EXISTING-FIXTURE", quantity: 1 },
            ...(options.skuInCart ? [{ retailerSku: "B0GYTRYV7P", quantity: options.skuInCart }] : [])];
          return [{ frameId: 0, result: { ok: true, reason: "verified", proof: {
            contractVersion: 1, retailerId: "amazon", observedAt: new Date().toISOString(),
            lineCount: lines.length, lines
          } } }];
        }
        if (args?.[0] === "inspectBestBuyCartBaseline") {
          return [{ frameId: 0, result: { ok: true, reason: "verified", proof: {
            contractVersion: 1, retailerId: "bestbuy", observedAt: new Date().toISOString(),
            lineCount: 1, lines: [{ retailerSku: "EXISTING-FIXTURE", quantity: 1 }]
          } } }];
        }
        if (args?.[0] === "prepareTargetAdd" && soldOutPrepares < (options.liveSoldOutTries ?? 0)) {
          soldOutPrepares += 1;
          return [{ frameId: 0, result: { ok: false, reason: "out_of_stock" } }];
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
            ...(options.quantityPlan ? { quantity: options.quantityPlan } : {}),
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
            ...(options.quantityPlan ? { quantity: options.quantityPlan } : {}),
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
          if (options.bestBuyCommitNavigation) {
            const tabId = (injection.target as { tabId: number }).tabId;
            const tab = tabs.get(tabId)!;
            tabs.set(tabId, { ...tab, url: "https://www.bestbuy.com/qp", status: "complete" });
            throw new Error("Execution context was destroyed by the queue redirect.");
          }
          return [{ frameId: 0, result: { ok: true, reason: "clicked", clicked: true, proof: { retailerId: "bestbuy", retailerSku: "6588149" } } }];
        }
        if (options.delayedCartResult && ["verifyTargetAddedCart", "verifyWalmartAddedCart", "verifyAmazonAddedCart"].includes(String(args?.[0]))
          && injections.filter(i => (i.args as unknown[] | undefined)?.[0] === args?.[0]).length === 1) {
          return [{frameId:0,result:{ok:false,reason:"cart_delta_unverified"}}];
        }
        if (args?.[0] === "verifyTargetAddedCart") {
          if (options.postClickVerificationFailure) {
            return [{ frameId: 0, result: { ok: false, reason: "cart_delta_unverified" } }];
          }
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: verifiedCartProof(args, "target", "1011483414", 5999),
            cartBaseline: {
              contractVersion: 1, retailerId: "target", observedAt: new Date().toISOString(),
              lineCount: 2, lines: [
                { retailerSku: "EXISTING-FIXTURE", quantity: 1 },
                { retailerSku: "1011483414", quantity: 1 }
              ]
            }
          } }];
        }
        if (args?.[0] === "verifyWalmartAddedCart") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: verifiedCartProof(args, "walmart", "17354421975", 4499),
            cartBaseline: {
              contractVersion: 1, retailerId: "walmart", observedAt: new Date().toISOString(),
              lineCount: 2, lines: [
                { retailerSku: "EXISTING-FIXTURE", quantity: 1 },
                { retailerSku: "17354421975", quantity: 1 }
              ]
            }
          } }];
        }
        if (args?.[0] === "verifyAmazonAddedCart") {
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: verifiedCartProof(args, "amazon", "B0GYTRYV7P", 2186),
            cartBaseline: {
              contractVersion: 1, retailerId: "amazon", observedAt: new Date().toISOString(),
              lineCount: 2, lines: [
                { retailerSku: "EXISTING-FIXTURE", quantity: 1 },
                { retailerSku: "B0GYTRYV7P", quantity: 1 }
              ]
            }
          } }];
        }
        if (args?.[0] === "verifyBestBuyAddedCart") {
          if (options.bestBuyPendingCart || options.bestBuyConflictingCart) {
            return [{ frameId: 0, result: { ok: false, reason: "cart_delta_unverified", ...(options.bestBuyPendingCart ? { pending: true } : {}) } }];
          }
          return [{ frameId: 0, result: {
            ok: true,
            reason: "verified",
            proof: verifiedCartProof(args, "bestbuy", "6588149", 699),
            cartBaseline: {
              contractVersion: 1, retailerId: "bestbuy", observedAt: new Date().toISOString(),
              lineCount: 2, lines: [
                { retailerSku: "EXISTING-FIXTURE", quantity: 1 },
                { retailerSku: "6588149", quantity: 1 }
              ]
            }
          } }];
        }
        if (args?.[0] === "waitForRetailerShadowHydration") {
          const retailerId = String(args[1] || "");
          if (retailerId === "amazon" && (options.observerRepairLandmark || options.observerFiveFieldRepairLandmarks)) {
            const fiveField = options.observerFiveFieldRepairLandmarks === true;
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
              failureStage: fiveField ? "availability_binding" : "add_control",
              reasonCode: fiveField ? "availability_selector_miss" : "add_control_selector_miss",
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
                    { field: "availability", elementKind: "div", attribute: "data-testid", value: "product-availability-status" },
                    { field: "unitPrice", elementKind: "span", attribute: "data-testid", value: "product-current-price" },
                    { field: "seller", elementKind: "p", attribute: "data-testid", value: "seller-display-name" },
                    { field: "fulfillment", elementKind: "div", attribute: "data-testid", value: "shipping-fulfillment-option" }
                  ] : []),
                  { field: "addControl", elementKind: "role_button", attribute: "data-testid", value: "pdp-add-to-cart-control" }
                ]
              }
            };
            return [{ frameId: 0, result: { ok: true, observation, diagnostic, domChanged: false } }];
          }
          const observation = retailerId === "walmart" ? WALMART_OBSERVATION
            : retailerId === "bestbuy" ? BESTBUY_OBSERVATION
              : AMAZON_OBSERVATION;
          return [{ frameId: 0, result: {
            ok: true,
            observation,
            diagnostic: diagnosticFor(observation),
            domChanged: true
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
          if (options.amazonSemanticRecovery) {
            return [{ frameId: 0, result: {
              ok: true,
              observation: AMAZON_OBSERVATION,
              diagnostic: {
                ...diagnosticFor(AMAZON_OBSERVATION),
                outcome: "passed",
                failureStage: "complete",
                reasonCode: "semantic_layout_recovered",
                layout: {
                  ...diagnosticFor(AMAZON_OBSERVATION).layout,
                  addControlCount: 0,
                  genericAddIntentCount: 1,
                  scopedControlCount: 1,
                  priceCandidateCount: 0,
                  genericPriceCandidateCount: 1,
                  repairLandmarks: [
                    { field: "unitPrice", elementKind: "div", attribute: "data-testid", value: "commerce-amount" },
                    { field: "addControl", elementKind: "input", attribute: "data-button-state", value: "primary-cart-action" }
                  ]
                }
              }
            } }];
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
        if (args?.[0] === "walmart") {
          walmartObservationAttempts += 1;
          if (options.walmartHydrationRetry && walmartObservationAttempts === 1) {
            const observation = { ...WALMART_OBSERVATION, unitPriceCents: null };
            const diagnostic = {
              ...diagnosticFor(WALMART_OBSERVATION),
              outcome: "failed",
              failureStage: "price_binding",
              reasonCode: "price_binding_missing",
              layout: { ...diagnosticFor(WALMART_OBSERVATION).layout, priceCandidateCount: 0 }
            };
            return [{ frameId: 0, result: { ok: true, observation, diagnostic } }];
          }
          return [{ frameId: 0, result: { ok: true, observation: WALMART_OBSERVATION, diagnostic: diagnosticFor(WALMART_OBSERVATION) } }];
        }
        if (args?.[0] === "bestbuy") {
          const observation = options.bestBuyPreorder
            ? { ...BESTBUY_OBSERVATION, availability: "preorder" }
            : BESTBUY_OBSERVATION;
          return [{ frameId: 0, result: { ok: true, observation, diagnostic: diagnosticFor(observation) } }];
        }
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
            recoveryEvidence: [],
            shape: "availability:value:agreed:agreed:verified|unitPrice:value:agreed:agreed:verified|seller:value:agreed:agreed:verified|fulfillment:value:agreed:agreed:verified|addControl:value:agreed:agreed:verified"
          } }];
        }
        return [{ frameId: 0, result: { ok: true, observation: OBSERVATION } }];
      }
    },
    action: {
      setBadgeBackgroundColor: async ({ color }: { color: string }) => { badgeColors.push(color); },
      setBadgeText: async ({ text }: { text: string }) => { badgeTexts.push(text); },
      setTitle: async ({ title }: { title: string }) => { actionTitles.push(title); }
    },
    contextMenus: {
      create: (definition: Record<string, unknown>, callback?: () => void) => {
        contextMenuDefinitions.set(String(definition.id), { ...definition });
        callback?.();
      },
      removeAll: (callback?: () => void) => {
        contextMenuDefinitions.clear();
        callback?.();
      },
      update: (id: string, properties: Record<string, unknown>, callback?: () => void) => {
        const current = contextMenuDefinitions.get(id) || { id };
        contextMenuDefinitions.set(id, { ...current, ...properties });
        callback?.();
      },
      onClicked: {
        addListener: (listener: typeof contextMenuClickedListener) => { contextMenuClickedListener = listener; }
      }
    },
    commands: {
      onCommand: { addListener: (listener: typeof commandListener) => { commandListener = listener; } }
    },
    alarms: {
      create: async (name: string, info: Record<string, unknown>) => { alarmCreations.push({ name, ...info }); },
      get: async (name: string) => {
        const alarm = alarmCreations.findLast(item => item.name === name);
        return alarm ? { ...alarm, scheduledTime: Date.now() + Number(alarm.delayInMinutes || 0) * 60_000 } : undefined;
      },
      onAlarm: { addListener: (listener: typeof alarmListener) => { alarmListener = listener; } }
    },
    notifications: {
      create: async (id: string, notificationOptions: Record<string, unknown>) => {
        shownNotifications.push({ id, options: notificationOptions });
        if (options.bestBuyNotificationFails && id.startsWith("yoink-bestbuy-wait:")) throw new Error("Notification unavailable");
        if (options.notificationClickDuringCreate && id.startsWith("yoink-opportunity:")) {
          notificationClickedListener?.(id);
        }
        return id;
      },
      clear: async (id: string) => {
        clearedNotifications.push(id);
        return true;
      },
      onClicked: { addListener: (listener: typeof notificationClickedListener) => { notificationClickedListener = listener; } },
      onClosed: { addListener: (listener: typeof notificationClosedListener) => { notificationClosedListener = listener; } }
    }
  };
  const fetchMock = async (input: string | URL | Request, requestOptions: Record<string, unknown> = {}) => {
    const url = String(input);
    fetchCalls.push({ url, options: requestOptions });
    if (options.heartbeatStatus && url.endsWith("/devices/self/heartbeat")) {
      return new Response(JSON.stringify({ message: "refused fixture heartbeat" }), { status: options.heartbeatStatus });
    }
    if (options.jobLeaseStatus && new URL(url).pathname.endsWith("/devices/self/jobs/next")) {
      return new Response(JSON.stringify({ message: "refused fixture lease", error: "origin_rejected" }), { status: options.jobLeaseStatus });
    }
    if (options.unsupportedLeaseFirst && new URL(url).pathname.endsWith("/devices/self/jobs/next")
      && !fetchCalls.slice(0, -1).some((entry) => new URL(entry.url).pathname.endsWith("/devices/self/jobs/next"))) {
      return new Response(JSON.stringify({
        job: {
          contractVersion: 1,
          adapterVersion: "target-add-v0-unsupported",
          id: "job_unsupported_fixture",
          capabilityToken: "U".repeat(43),
          action: "add_to_cart",
          quantity: 1,
          retailerId: "target",
          retailerSku: "1011483414",
          canonicalUrl: PRODUCT_URL,
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      }), { status: 200 });
    }
    if (url.endsWith("/devices/self/jobs/job_unsupported_fixture/events")) {
      jobStates.push(`unsupported:${(JSON.parse(String(requestOptions.body)) as { state: string }).state}`);
      return new Response(JSON.stringify({ job: { id: "job_unsupported_fixture", state: "cancelled" } }), { status: 200 });
    }
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({
        status: "ready",
        version: options.healthVersion ?? "0.5.0",
        executionMode: liveJob ? "live" : "shadow",
        actionsPaused: !liveJob,
        chromeMutationEnabled: liveJob,
        targetAddExecutionEnabled: liveJob,
        walmartAddExecutionEnabled: liveJob,
        amazonAddExecutionEnabled: liveJob,
        bestBuyAddExecutionEnabled: liveJob
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
          retailerMutationEnabled: liveJob,
          targetAddExecutionEnabled: liveJob,
          walmartAddExecutionEnabled: liveJob,
          amazonAddExecutionEnabled: liveJob,
          bestBuyAddExecutionEnabled: liveJob
        }
      }), { status: 200 });
    }
    if (url.endsWith("/devices/self/sources/trackalacker/status")) {
      if (options.trackalackerStatusDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.trackalackerStatusDelayMs));
      }
      return new Response(JSON.stringify({ status: { ready: true } }), { status: 200 });
    }
    if (url.endsWith("/devices/self/watch-queue/next")) {
      return new Response(JSON.stringify(options.watchLease
        ? { reason: "leased", item: options.watchLease }
        : { reason: "no_watch_items", item: null }), { status: 200 });
    }
    if (url.endsWith("/devices/self/readiness/reverification-runs")) {
      const receipt = JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        run: { id: `reverification_run_${fetchCalls.length}`, ...receipt },
        lane: { retailerId: receipt.retailerId }
      }), { status: 201 });
    }
    if (url.endsWith("/devices/self/readiness/reverification-plan")) {
      reverificationPlanFetches += 1;
      if (Number.isInteger(options.reverificationPlanFailAfterFetches)
        && reverificationPlanFetches > Number(options.reverificationPlanFailAfterFetches)) {
        return new Response(JSON.stringify({ message: `RAW_PLAN_ERROR token=${TOKEN} secret=DO_NOT_SEND` }), { status: 503 });
      }
      const plan = structuredClone(options.reverificationPlan ?? { createdAt: new Date().toISOString(), lanes: [] }) as {
        lanes?: Array<{ retailerId?: string; evidence?: Record<string, unknown> }>;
      };
      if (options.reverificationPlanCompletesAfterTrial) {
        for (const lane of plan.lanes || []) {
          const trialLane = lane.retailerId === "target" ? "target-add"
            : lane.retailerId === "walmart" ? "walmart-add"
              : lane.retailerId === "amazon" ? "amazon-add"
                : lane.retailerId === "bestbuy" ? "bestbuy-add" : "";
          if (trialLane && fetchCalls.some((entry) => entry.url.endsWith(`/devices/self/qualification-trials/${trialLane}`))) {
            lane.evidence = {
              ...(lane.evidence || {}),
              liveEvidenceReady: true,
              rehearsalReady: true,
              qualificationEvidenceReady: true,
              distinctSkuCount: 2,
              checks: []
            };
          }
        }
      }
      return new Response(JSON.stringify({ plan }), { status: 200 });
    }
    if (/\/devices\/self\/watch-queue\/watch_item_[a-f0-9]{32}\/observations$/.test(url)) {
      return new Response(JSON.stringify({
        item: { state: "seen_in_stock" },
        signal: options.watchObservationSignal ? { processingState: "queued" } : null
      }), { status: 202 });
    }
    if (/\/devices\/self\/readiness\/(?:target|walmart|amazon|bestbuy)$/.test(url)) {
      return new Response(JSON.stringify({ readiness: JSON.parse(String(requestOptions.body)) }), { status: 200 });
    }
    if (url.endsWith("/devices/self/order-confirmations")) {
      return new Response(JSON.stringify({ observation: { id: "order_confirmation_fixture" } }), { status: 202 });
    }
    if (url.endsWith("/devices/self/action-handoffs/reconcile")) {
      const body = JSON.parse(String(requestOptions.body)) as { jobIds?: string[] };
      const planned = options.handoffReconciliationResponses?.[handoffReconciliationRequestCount];
      handoffReconciliationRequestCount += 1;
      const latestJobState = jobStates.at(-1);
      const inferredStatus = ["manual_review", "submission_uncertain"].includes(String(latestJobState || ""))
        ? "needs_you" : "cart_ready";
      return new Response(JSON.stringify({
        contractVersion: 1,
        availabilityVersion: planned?.availabilityVersion ?? 0,
        items: (body.jobIds || []).map((jobId) => ({
          jobId,
          status: planned?.status || options.handoffReconciliationStatus || inferredStatus
        }))
      }), { status: 200 });
    }
    if (/\/devices\/self\/jobs\/[A-Za-z0-9_-]{3,120}\/outcome$/.test(url)) {
      const body = JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        outcome: {
          disposition: "recorded",
          outcome: body.outcome,
          actualTotalCents: body.actualTotalCents
        }
      }), { status: 200 });
    }
    if (url.endsWith("/devices/self/privacy/local-deletion")) {
      return new Response(JSON.stringify({ compliance: { localDeletionVerified: true } }), { status: 200 });
    }
    if (url.endsWith("/devices/self/sources/trackalacker/signals/batch")) {
      hotPathTimeline.push("signal:request");
      const body = JSON.parse(String(requestOptions.body)) as { signals?: Array<Record<string, unknown>> };
      const signals = Array.isArray(body.signals) ? body.signals : [];
      deliveredTrackalackerSignals.push(...signals);
      const plannedReceipts = options.trackalackerBatchReceipts?.[trackalackerBatchRequestCount];
      trackalackerBatchRequestCount += 1;
      if (options.trackalackerSignalDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.trackalackerSignalDelayMs));
      }
      hotPathTimeline.push("signal:response");
      return new Response(JSON.stringify({
        contractVersion: 1,
        receipts: signals.map((_, index) => ({
          index: options.duplicateReceiptIndexes ? 0 : index,
          accepted: plannedReceipts?.[index]?.accepted ?? true,
          retryable: plannedReceipts?.[index]?.retryable ?? false,
          errorCode: plannedReceipts?.[index]?.errorCode ?? ""
        }))
      }), { status: 202 });
    }
    if (url.endsWith("/devices/self/sources/trackalacker/signals")) {
      deliveredTrackalackerSignals.push(JSON.parse(String(requestOptions.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }
    if (url.endsWith("/devices/self/shadow-observations/target")) {
      if (options.evidenceVersionMismatch) {
        return new Response(JSON.stringify({
          error: "adapter_version_mismatch",
          message: `RAW_VERSION_ERROR token=${TOKEN} secret=DO_NOT_SEND`
        }), { status: 409 });
      }
      return new Response(JSON.stringify({
        observation: {
          ...OBSERVATION,
          id: "shadow_observation_fixture",
          url: undefined,
          cookie: undefined,
          canonicalUrl: "https://www.target.com/p/-/A-1011483414",
          selectedOffer: { ...OBSERVATION.selectedOffer, fingerprint: "a".repeat(64) },
          observationState: "actionable_candidate"
        },
        productIdentity: {
          source: "catalog_exact_retailer_sku",
          retailerId: "target",
          retailerSku: "1011483414",
          title: "Pokémon Trading Card Game Collection"
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
      if (options.adapterDiagnosticDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.adapterDiagnosticDelayMs));
      }
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
    if (url.includes("/devices/self/evidence-capsules/")) {
      const capsule = JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ accepted: true, capsuleId: capsule.id }), { status: 202 });
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
    const requestPath = new URL(url).pathname;
    if (requestPath.endsWith("/devices/self/notifications/next")) {
      const notificationPayload = fixtureNotificationPayloads[notificationLeaseIndex];
      const delivery = (options.notification || options.notificationPayload
        || options.notificationPayloads?.length) && notificationPayload ? {
        reason: "leased",
        notification: notificationPayload
      } : { notification: null, reason: "no_notifications" };
      return new Response(JSON.stringify({
        ...delivery,
        closedDeliveryIds: options.closedNotificationDeliveryIds || []
      }), { status: 200 });
    }
    if (requestPath.endsWith("/devices/self/notifications/closures/ack")) {
      const body = JSON.parse(String(requestOptions.body)) as { deliveryIds?: string[] };
      return new Response(JSON.stringify({
        closures: { acknowledged: Array.isArray(body.deliveryIds) ? body.deliveryIds.length : 0 }
      }), { status: 200 });
    }
    const notificationAckMatch = /\/devices\/self\/notifications\/([A-Za-z0-9_-]{3,160})\/ack$/.exec(requestPath);
    if (notificationAckMatch) {
      const body = JSON.parse(String(requestOptions.body)) as { outcome: string };
      const currentId = String(fixtureNotificationPayloads[notificationLeaseIndex]?.id || "");
      if (body.outcome === "delivered" && notificationAckMatch[1] === currentId) notificationLeaseIndex += 1;
      completeNotification?.();
      return new Response(JSON.stringify({ notification: { id: notificationAckMatch[1], state: body.outcome } }), { status: 200 });
    }
    const notificationInteractionMatch = /\/devices\/self\/notifications\/([A-Za-z0-9_-]{3,160})\/interaction$/.exec(requestPath);
    if (notificationInteractionMatch) {
      if (options.notificationInteractionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.notificationInteractionDelayMs));
      }
      const body = JSON.parse(String(requestOptions.body)) as { interaction: string };
      notificationInteractions.push(body.interaction);
      return new Response(JSON.stringify({ notification: { id: notificationInteractionMatch[1], state: body.interaction } }), { status: 200 });
    }
    if (requestPath.endsWith("/devices/self/jobs/next")) {
      hotPathTimeline.push("lease:request");
      jobLeaseRequests += 1;
      if (restockPending && lastLeasedJob) {
        // Retry when sold out: the same job again, from the same call.
        restockPending = false;
        restockLeases += 1;
        const until = new Date(Date.now() + 10 * 60_000).toISOString();
        return new Response(JSON.stringify({ reason: "leased", job: {
          ...lastLeasedJob, expiresAt: until, restockRetry: { attempt: restockLeases, until }
        } }), { status: 200 });
      }
      if (!liveJob || jobsLeased >= expectedJobCount) {
        return new Response(JSON.stringify({ job: null, reason: liveJob ? "no_jobs" : "shadow_mode" }), { status: 200 });
      }
      jobsLeased += 1;
      const jobSuffix = jobsLeased === 1 ? "" : `_${jobsLeased}`;
      const leasedJob = options.amazonJob ? {
        contractVersion: 1,
        adapterVersion: "amazon-add-v11",
        id: `job_amazon_fixture${jobSuffix}`,
        capabilityToken: "A".repeat(43),
        action: "add_to_cart",
        quantity: options.jobQuantity ?? 1,
        maxUnitPriceCents: 2186,
        maxOrderTotalCents: 2999,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Amazon.com",
        fulfillment: "shipping",
        retailerId: "amazon",
        retailerSku: "B0GYTRYV7P",
        canonicalUrl: AMAZON_PRODUCT_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        officialMsrp: fixtureOfficialMsrp("amazon", "B0GYTRYV7P", 2186)
      } : options.walmartJob ? {
        contractVersion: 1,
        adapterVersion: "walmart-add-v10",
        id: `job_walmart_fixture${jobSuffix}`,
        capabilityToken: "W".repeat(43),
        action: "add_to_cart",
        quantity: options.jobQuantity ?? 1,
        maxUnitPriceCents: options.jobMaxUnitPriceCents ?? 4499,
        maxOrderTotalCents: 5999,
        currency: "USD",
        sellerPolicy: "first_party_only",
        expectedSeller: "Walmart",
        fulfillment: "shipping",
        retailerId: "walmart",
        retailerSku: "17354421975",
        canonicalUrl: WALMART_PRODUCT_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        officialMsrp: fixtureOfficialMsrp("walmart", "17354421975", options.jobMaxUnitPriceCents ?? 4499),
        ...(options.jobTestCall ? { testCall: true } : {})
      } : options.bestBuyJob ? {
        contractVersion: 1,
        adapterVersion: "bestbuy-add-v18",
        id: `job_bestbuy_fixture${jobSuffix}`,
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
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        officialMsrp: fixtureOfficialMsrp("bestbuy", "6588149", 699)
      } : {
        contractVersion: 1,
        adapterVersion: "target-add-v12",
        id: `job_target_fixture${jobSuffix}`,
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
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        // Target is MSRP-checked: a cart add carries the server's MSRP proof (synthetic here).
        officialMsrp: {
          version: 1, evidenceId: `official_msrp_${"a".repeat(32)}`, evidenceHash: "b".repeat(64),
          listingIdentityHash: "c".repeat(64), retailerId: "target", retailerSku: "1011483414",
          desiredVariant: "Standard single item", variantAttributes: {}, msrpCents: 5999, unitPriceCents: 5999,
          currency: "USD", signalObservedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      };
      lastLeasedJob = leasedJob;
      return new Response(JSON.stringify({
        reason: "leased",
        job: leasedJob
      }), { status: 200 });
    }
    if (/\/devices\/self\/jobs\/job_(?:target|walmart|amazon|bestbuy)_fixture(?:_\d+)?\/heartbeat$/.test(url)) {
      await traceControlAcknowledgement("heartbeat");
      if (options.jobHeartbeatFails) return new Response(JSON.stringify({ error: "Lease unavailable" }), { status: 409 });
      return new Response(JSON.stringify({ heartbeat: { accepted: true } }), { status: 200 });
    }
    if (/\/devices\/self\/jobs\/job_(?:target|walmart|amazon|bestbuy)_fixture(?:_\d+)?\/events\/batch$/.test(url)) {
      const body = JSON.parse(String(requestOptions.body)) as { events?: Array<{ state: string }> };
      const events = Array.isArray(body.events) ? body.events : [];
      if (events.some((event) => event.state === "adding")) {
        await traceControlAcknowledgement("adding");
      }
      if (events.some((event) => event.state === "confirmed") && options.confirmedJobEventDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.confirmedJobEventDelayMs));
      }
      for (const event of events) {
        jobStates.push(event.state);
        if (event.state === "confirmed") {
          jobsConfirmed += 1;
          if (jobsConfirmed >= expectedJobCount) completeJob?.();
        }
      }
      return new Response(JSON.stringify({
        job: { id: "job_target_fixture", state: events.at(-1)?.state || "leased" }
      }), { status: 200 });
    }
    if (/\/devices\/self\/jobs\/job_(?:target|walmart|amazon|bestbuy)_fixture(?:_\d+)?\/events$/.test(url)) {
      const body = JSON.parse(String(requestOptions.body)) as { state: string };
      if (body.state === "navigating" && options.slowJobEventMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, options.slowJobEventMs);
          (requestOptions.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
        });
      }
      if (["navigating", "verifying_listing"].includes(body.state)) {
        await traceControlAcknowledgement(body.state);
      }
      if (body.state === "offer_rejected" && restockLeases < (options.restockRetries ?? 0)) {
        restockPending = true;
        jobStates.push("offer_rejected:retry_set");
        return new Response(JSON.stringify({ job: { id: "job_target_fixture", state: "awaiting_executor",
          restockRetryUntil: new Date(Date.now() + 10 * 60_000).toISOString() } }), { status: 200 });
      }
      jobStates.push(body.state);
      if (body.state === "confirmed") {
        jobsConfirmed += 1;
        if (jobsConfirmed >= expectedJobCount) completeJob?.();
      }
      return new Response(JSON.stringify({ job: { id: "job_target_fixture", state: body.state } }), { status: 200 });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  const registrationMock = {
    pushManager: {
      getSubscription: async () => ({ endpoint: PUSH_ENDPOINT, options: { userVisibleOnly: options.visibleTrackalackerFallback === true } })
    },
    showNotification: async (title: string, notificationOptions: Record<string, unknown>) => {
      if (options.trackalackerNotificationDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.trackalackerNotificationDelayMs));
      }
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
  // The fixture store finishes its add at once; the real wait before the Add
  // page moves on (ADD_FINISH_GRACE_MS) is covered by its own test.
  if (!options.storeAddGrace) runInContext("waitForAddToFinish = async () => undefined;", context);
  const diagnosticReasonCodes = JSON.parse(String(runInContext(
    "JSON.stringify([...DIAGNOSTIC_REASON_CODES].sort())",
    context
  ))) as string[];
  if (!messageListener) throw new Error("The extension message listener was not registered.");
  const extensionPageSender = { id: "a".repeat(32), url: `chrome-extension://${"a".repeat(32)}/popup.html` };
  const send = (message: unknown) => new Promise<Record<string, unknown>>((resolve) => {
    assert.equal(messageListener?.(message, extensionPageSender, (response) => resolve(response as Record<string, unknown>)), true);
  });
  // Delivers a message as an arbitrary sender and reports whether the router
  // accepted it (returned true) plus its response.
  const sendAs = (message: unknown, sender: unknown) => new Promise<{ accepted: boolean; response: Record<string, unknown> | undefined }>((resolve) => {
    let response: Record<string, unknown> | undefined;
    let accepted = false;
    accepted = messageListener?.(message, sender, (value) => {
      response = value as Record<string, unknown>;
      if (accepted) resolve({ accepted, response });
    }) === true;
    if (!accepted) resolve({ accepted, response });
  });
  return {
    send,
    sendAs,
    fetchCalls,
    alarmCreations,
    injections,
    storage,
    jobStates,
    jobCompleted,
    notificationCompleted,
    shownNotifications,
    clearedNotifications,
    notificationInteractions,
    deliveredTrackalackerSignals,
    shownTrackalackerNotifications,
    serviceWorkerListeners,
    fireJobAlarm: () => alarmListener?.({ name: "yoink-jobs" }),
    fireHealthAlarm: () => alarmListener?.({ name: "yoink-health" }),
    fireAutoReverificationAlarm: () => alarmListener?.({ name: "yoink-auto-reverification" }),
    clickNotification: (id: string) => notificationClickedListener?.(id),
    closeNotification: (id: string, byUser = true) => notificationClosedListener?.(id, byUser),
    fireStartup: () => startupListener?.(),
    fireUpdateAvailable: (version: string) => updateAvailableListener?.({ version }),
    managedUpdateChecks: () => managedUpdateChecks,
    tabRemovals,
    tabCreates,
    invokeBackground: (source: string) => runInContext(source, context) as Promise<unknown>,
    raiseCalls,
    clickContextMenu: (menuItemId: string, presentedUrl?: string) => contextMenuClickedListener?.(
      { menuItemId, pageUrl: presentedUrl ?? tabs.get(17)?.url },
      { ...(tabs.get(17) || {}), url: presentedUrl ?? tabs.get(17)?.url }
    ),
    fireCommand: (command: string) => commandListener?.(command),
    closeTab: (tabId: number) => {
      tabs.delete(tabId);
      tabRemovedListener?.(tabId);
    },
    setActiveUrl: (url: string) => {
      const current = tabs.get(17);
      if (!current) throw new Error("Missing fixture tab.");
      tabs.set(17, { ...current, url });
    },
    fireTabUpdated: (tabId: number, url?: string) => {
      const current = tabs.get(tabId);
      if (!current) throw new Error("Missing fixture tab.");
      const tab = { ...current, url: url || current.url, status: "complete" };
      tabs.set(tabId, tab);
      for (const listener of [...tabUpdatedListeners]) {
        listener(tabId, { status: "complete", ...(url ? { url } : {}) }, tab);
      }
    },
    contextMenuDefinitions,
    permissionRequests,
    actionTitles,
    badgeTexts,
    badgeColors,
    tabUpdates,
    hotPathTimeline,
    runtimeMessages,
    offscreenCreates: () => offscreenCreates,
    adapterDiagnosticQueueDrained,
    diagnosticReasonCodes,
    jobLeaseRequests: () => jobLeaseRequests,
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
  const diagnosticPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target"));
  assert.ok(diagnosticPost);
  const diagnosticBody = JSON.parse(String(diagnosticPost.options.body)) as Record<string, unknown>;
  assert.equal(diagnosticBody.operation, "observe");
  assert.equal(diagnosticBody.outcome, "passed");
  assert.equal(diagnosticBody.failureStage, "complete");
  assert.equal(JSON.stringify(diagnosticBody).includes(PRODUCT_URL), false);
  assert.equal(JSON.stringify(diagnosticBody).includes("DO_NOT_SEND"), false);
  assert.equal((response.state as Record<string, unknown>).chromeMutationEnabled, false);
});

test("a Target price-binding block is posted through the repair incident diagnostic path", async () => {
  const runtime = harness({ targetPriceMissing: true });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);
  assert.equal((response.diagnostic as Record<string, unknown>).outcome, "failed");
  const diagnosticPosts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target"));
  assert.equal(diagnosticPosts.length, 1);
  const body = JSON.parse(String(diagnosticPosts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(body.retailerId, "target");
  assert.equal(body.operation, "observe");
  assert.equal(body.outcome, "failed");
  assert.equal(body.failureStage, "price_binding");
  assert.equal(body.reasonCode, "price_binding_missing");
  assert.equal(body.attemptCount, 2);
  assert.equal(JSON.stringify(body).includes(PRODUCT_URL), false);
  assert.equal(JSON.stringify(body).includes("DO_NOT_SEND"), false);
});

test("one local evidence capsule is captured after a failed observe", async () => {
  const runtime = harness({ targetPriceMissing: true });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);

  const capsulePosts = runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/evidence-capsules/target"));
  assert.equal(capsulePosts.length, 1);
  const capsule = JSON.parse(String(capsulePosts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(capsule.trigger, "diagnostic_failed");
  assert.equal(capsule.outcome, "failed");
  assert.equal(capsule.failureStage, "price_binding");
  assert.ok(Array.isArray(capsule.trace) && capsule.trace.length > 0);

  const snapshot = capsule.snapshot as Record<string, unknown>;
  const html = gunzipSync(Buffer.from(String(snapshot.html), "base64")).toString("utf8");
  assert.match(html, /data-yoink-vis="[01]"/);
  assert.match(html, /data-yoink-rect="12,24,120,40"/);
  assert.doesNotMatch(html, /<script|\son[a-z]+=|javascript:|data:|@[A-Za-z0-9.-]+\.|\b\d{3}[-.) ]\d{3}[-. ]\d{4}\b/i);
  assert.match(html, /<input[^>]+value=""/);

  const capture = runtime.injections.find((entry) => {
    const input = (entry.args as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
    return input?.trigger === "diagnostic_failed";
  });
  assert.equal(((capture?.args as unknown[])[0] as Record<string, unknown>).budgetMs, 1_500);
  assert.equal((capture?.target as Record<string, unknown>).tabId, 17);
  assert.equal(capture?.world, "ISOLATED");
});

// No real Target, Walmart or Best Buy cart page had been seen when cart quantities shipped (2026-10-10).
test("a cart Yoink couldn't read keeps one sanitized cart-page snapshot per store", async () => {
  const runtime = harness({ liveJob: true, queuedJobCount: 2, cartBaselineFailure: true });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.filter((state) => state === "cancelled").length === 2,
    `The unreadable carts did not stop (${runtime.jobStates.join(",")}).`, 6_000);
  await waitFor(() => runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/evidence-capsules/target")),
    "No cart snapshot was sent.");
  const posts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/evidence-capsules/target"));
  assert.equal(posts.length, 1, "one per store every 6 hours");
  const capsule = JSON.parse(String(posts[0]?.options.body)) as Record<string, unknown>;
  assert.deepEqual([capsule.trigger, capsule.operation, capsule.outcome, capsule.failureStage, capsule.reasonCode, capsule.retailerSku],
    ["live_add_non_pass", "live_add", "failed", "runner", "cart_unverified", "1011483414"]);
  // The snapshot is taken in the cart tab Yoink opened (the harness serves one page URL to every tab).
  const cartTab = runtime.tabCreates.find((tab) => tab.url === "https://www.target.com/cart");
  const capture = runtime.injections.find((entry) =>
    ((entry.args as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined)?.trigger === "live_add_non_pass");
  assert.ok(cartTab && capture);
  assert.equal((capture.target as { tabId: number }).tabId, cartTab.id);
});

test("interactive store challenges never trigger an automatic evidence capsule", async () => {
  const runtime = harness({ targetInterstitial: true });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);
  assert.equal((response.diagnostic as Record<string, unknown>).failureStage, "interactive_block");
  assert.equal((response.diagnostic as Record<string, unknown>).reasonCode, "security_challenge");
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/evidence-capsules/")), false);
  assert.equal(runtime.injections.some((entry) =>
    Array.isArray(entry.files) && entry.files.includes("evidence-capsule.js")), false);
});

test("manual repair-page capture works for every guarded store", async () => {
  for (const [retailerId, activeUrl] of Object.entries({
    target: PRODUCT_URL,
    walmart: WALMART_PRODUCT_URL,
    amazon: AMAZON_PRODUCT_URL,
    bestbuy: BESTBUY_PRODUCT_URL
  })) {
    const runtime = harness({ activeUrl });
    const response = await runtime.send({ type: "yoink:save-repair-page" });
    assert.equal(response.ok, true, retailerId);
    assert.equal(response.saved, true, retailerId);
    assert.match(String(response.capsuleId), /^cap_/);
    const posts = runtime.fetchCalls.filter((entry) =>
      entry.url.endsWith(`/devices/self/evidence-capsules/${retailerId}`));
    assert.equal(posts.length, 1, retailerId);
    const capsule = JSON.parse(String(posts[0]?.options.body)) as Record<string, unknown>;
    assert.equal(capsule.trigger, "manual", retailerId);
    assert.ok(Array.isArray(capsule.trace) && capsule.trace.length === 1, retailerId);
  }
});

test("the production companion cannot inject or transport repair-page capsules", async () => {
  const runtime = harness({ runtimeProfile: "production", targetPriceMissing: true });
  const observed = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(observed.ok, true);
  const manual = await runtime.send({ type: "yoink:save-repair-page" });
  assert.equal(manual.ok, false);
  assert.match(String(manual.message), /local companion/);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/evidence-capsules/")), false);
  assert.equal(runtime.injections.some((entry) =>
    Array.isArray(entry.files) && entry.files.includes("evidence-capsule.js")), false);
});

test("a Target observer startup error is immediately posted to the incident diagnostic path", async () => {
  const runtime = harness({ retailerObserverFailure: "bundle_injection" });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, false);
  const diagnosticPosts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target"));
  assert.equal(diagnosticPosts.length, 1);
  const body = JSON.parse(String(diagnosticPosts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(body.retailerId, "target");
  assert.equal(body.outcome, "failed");
  assert.equal(body.failureStage, "runner");
  assert.equal(body.reasonCode, "observer_bundle_injection_failed");
  assert.equal(JSON.stringify(body).includes(PRODUCT_URL), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("marked prior-product tabs automatically inspect and run no-click qualification", async () => {
  const markedUrl = `${PRODUCT_URL}#yoink-inspect-and-qualify`;
  const runtime = harness({ activeUrl: markedUrl });
  runtime.fireTabUpdated(17, markedUrl);
  await waitFor(() => runtime.fetchCalls.some((entry) =>
    entry.url.endsWith("/devices/self/qualification-trials/target-add")),
  "the marked Target tab did not automatically run qualification");
  await runtime.invokeBackground("qualificationLaunchQueue");
  assert.equal(runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/shadow-observations/target")).length, 1);
  assert.equal(runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/qualification-trials/target-add")).length, 1);
  assert.equal(runtime.injections.some((entry) =>
    String((entry.args as unknown[] | undefined)?.[0]).startsWith("commit")), false);
  const result = runtime.runtimeMessages.find((message) => message.type === "yoink:auto-qualification-result");
  assert.equal(result?.retailerId, "target");
  assert.equal(result?.retailerSku, "1011483414");
  assert.equal(result?.ok, true);
});

test("a Target price placeholder waits for hydration and reports one recovered diagnostic", async () => {
  const runtime = harness({ targetPriceHydrationRetry: true });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);
  assert.equal((response.observation as Record<string, unknown>).unitPriceCents, 5999);
  const hydrationWaits = runtime.injections.filter((entry) =>
    (entry.args as unknown[] | undefined)?.[0] === "waitForTargetShadowHydration");
  assert.equal(hydrationWaits.length, 1);
  const diagnosticPosts = runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/adapter-diagnostics/target"));
  assert.equal(diagnosticPosts.length, 1);
  const diagnostic = JSON.parse(String(diagnosticPosts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(diagnostic.outcome, "recovered");
  assert.equal(diagnostic.failureStage, "price_binding");
  assert.equal(diagnostic.reasonCode, "dom_hydration_recovered");
  assert.equal(diagnostic.attemptCount, 2);
  assert.equal(diagnostic.domChanged, true);
});

test("a terminal Target availability rejection does not wait for hydration", async () => {
  const runtime = harness({ targetUnavailable: true });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);
  assert.equal((response.diagnostic as Record<string, unknown>).outcome, "rejected");
  assert.equal(runtime.injections.some((entry) =>
    (entry.args as unknown[] | undefined)?.[0] === "waitForTargetShadowHydration"), false);
  const diagnosticPost = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/adapter-diagnostics/target"));
  assert.ok(diagnosticPost);
  const diagnostic = JSON.parse(String(diagnosticPost.options.body)) as Record<string, unknown>;
  assert.equal(diagnostic.reasonCode, "out_of_stock");
  assert.equal(diagnostic.attemptCount, 1);
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
  assert.equal(body.adapterVersion, "walmart-draw-observer-v2");
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
  assert.equal(body.adapterVersion, "amazon-observer-v9");
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
    assert.equal(body.adapterVersion, "amazon-observer-v9");
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

test("the companion reports Brave or Edge instead of calling every browser Chrome", async () => {
  const detect = (navigatorSource: string) => `(async () => {
    globalThis.navigator = ${navigatorSource};
    companionBrowserPromise = null;
    return JSON.stringify(await companionBrowser());
  })()`;
  const runtime = harness();
  const detected = async (source: string) => JSON.parse(String(await runtime.invokeBackground(detect(source))));
  assert.deepEqual(await detected("{ brave: { isBrave: async () => true }, userAgentData: { brands: [{ brand: 'Chromium' }] } }"),
    { platform: "windows-brave", name: "Desktop - Windows - Brave" });
  assert.deepEqual(await detected("{ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Brave' }] } }"),
    { platform: "windows-brave", name: "Desktop - Windows - Brave" }, "Brave's client hints are enough without navigator.brave");
  assert.deepEqual(await detected("{ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] } }"),
    { platform: "windows-edge", name: "Desktop - Windows - Edge" });
  assert.deepEqual(await detected("{ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] } }"),
    { platform: "windows-chrome", name: "Desktop - Windows - Chrome" });
  assert.deepEqual(await detected("undefined"), { platform: "windows-chrome", name: "Desktop - Windows - Chrome" });

  const brave = harness();
  await brave.invokeBackground("globalThis.navigator = { brave: { isBrave: async () => true } }; companionBrowserPromise = null;");
  assert.equal((await brave.send({ type: "yoink:check-health" })).ok, true);
  const heartbeat = brave.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/heartbeat")).at(-1);
  const body = JSON.parse(String(heartbeat?.options.body)) as { name: string; platform: string };
  assert.deepEqual([body.name, body.platform], ["Desktop - Windows - Brave", "windows-brave"]);
});

test("a verified cart hands off on the store's checkout page; a store without one, or Needs you, stays on the cart", async () => {
  // Kevin, 2026-10-08: after the +1 cart proof the shopper should land on
  // checkout and place the order there. Nothing on the page is clicked.
  // Kevin, 2026-10-13: the checkout page is "brought forward on top for the
  // user to click checkout": its window comes to the front too.
  const handoff = (retailerId: string, sku: string, kind: string) => `(async () => {
    const updates = [];
    const focused = [];
    chrome.tabs.update = async (tabId, change) => { updates.push([tabId, change.url, change.active === true]); return { id: tabId, windowId: 5 }; };
    chrome.windows = { update: async (windowId, change) => { focused.push([windowId, change.focused === true]); return { id: windowId }; } };
    const active = { id: "job_checkout_${kind}_${sku}", retailerId: "${retailerId}", tabId: 31,
      runnerJob: { retailerId: "${retailerId}", retailerSku: "${sku}", maxOrderTotalCents: 5000 } };
    const item = await publishActionHandoff(active, "${kind}");
    return JSON.stringify({ kind: item?.kind, updates, ...(focused.length ? { focused } : {}) });
  })()`;
  const runtime = harness();
  const run = async (retailerId: string, sku: string, kind: string) =>
    JSON.parse(String(await runtime.invokeBackground(handoff(retailerId, sku, kind))));
  assert.deepEqual(await run("walmart", "15561620611", "cart_ready"),
    { kind: "cart_ready", updates: [[31, "https://www.walmart.com/checkout", true]], focused: [[5, true]] });
  assert.deepEqual(await run("amazon", "B0DJPC4VQD", "cart_ready"),
    { kind: "cart_ready", updates: [[31, "https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed", true]], focused: [[5, true]] });
  assert.deepEqual(await run("bestbuy", "6528565", "cart_ready"),
    { kind: "cart_ready", updates: [[31, "https://www.bestbuy.com/checkout/r/fast-track", true]], focused: [[5, true]] });
  // Kevin, 2026-10-11: Target ends on checkout too, and checkout is the tab in front.
  assert.deepEqual(await run("target", "95275676", "cart_ready"),
    { kind: "cart_ready", updates: [[31, "https://www.target.com/checkout", true]], focused: [[5, true]] });
  assert.deepEqual(await run("walmart", "15561620612", "needs_you"), { kind: "needs_you", updates: [] }, "an unverified add stays where it is");
  const notice = runtime.shownNotifications.find((entry) => String(entry.id).includes("job_checkout_") && /Walmart/.test(String(entry.options.title)));
  assert.match(String(notice?.options.message), /Checkout is open; you place the order\./);
});

test("a test call's cart add is labelled TEST in its alert", async () => {
  // Kevin, 2026-10-08: Setup › Stores › Test call adds a real item; its alert must say it was a test.
  const runtime = harness();
  const result = JSON.parse(String(await runtime.invokeBackground(`(async () => {
    chrome.tabs.update = async (tabId) => ({ id: tabId });
    const active = { id: "job_test_call_walmart", retailerId: "walmart", tabId: 41, testCall: true,
      runnerJob: { retailerId: "walmart", retailerSku: "15561620611", maxOrderTotalCents: 5000 } };
    await publishActionHandoff(active, "cart_ready");
    return JSON.stringify({});
  })()`)));
  assert.deepEqual(result, {});
  const notice = runtime.shownNotifications.find((entry) => String(entry.id).includes("job_test_call_walmart"));
  assert.equal(String(notice?.options.title), "TEST \u00b7 Cart ready at Walmart");
  assert.match(String(notice?.options.message), /This was a test call: remove it from your cart if you don't want it\./);
  const real = harness();
  await real.invokeBackground(`(async () => {
    chrome.tabs.update = async (tabId) => ({ id: tabId });
    await publishActionHandoff({ id: "job_real_call_walmart", retailerId: "walmart", tabId: 42,
      runnerJob: { retailerId: "walmart", retailerSku: "15561620612", maxOrderTotalCents: 5000 } }, "cart_ready");
  })()`);
  const realNotice = real.shownNotifications.find((entry) => String(entry.id).includes("job_real_call_walmart"));
  assert.equal(String(realNotice?.options.title), "Cart ready at Walmart");
});

test("an unexpected cart-add error is reported with the step and kind, never the error text", async () => {
  // Kevin's Walmart test call (2026-10-08) stopped as a bare extension_error with nothing to go on.
  const runtime = harness();
  const code = async (phase: string, message: string) =>
    String(await runtime.invokeBackground(`extensionErrorCode({ phase: ${JSON.stringify(phase)} }, new Error(${JSON.stringify(message)}))`));
  assert.equal(await code("verifying_listing", "No tab with id: 512."), "extension_error_verifying_listing_tab_closed");
  assert.equal(await code("navigating", "TrackaLacker did not finish loading in time."), "extension_error_navigating_timeout");
  assert.equal(await code("product_page_ready", "Cannot access contents of the page. Extension manifest must request permission."), "extension_error_product_page_ready_access");
  assert.equal(await code("leased", "Error in invocation of scripting.executeScript"), "extension_error_leased_script");
  assert.equal(await code("Bad Phase!", "Something odd at https://www.walmart.com/ip/1?secret=1"), "extension_error_unknown_other",
    "an unexpected step name or message never leaks into the code");
  assert.match(await code("navigating", "x"), /^[a-z0-9_]{1,80}$/);
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
    "packagedMissingFieldCount", "recipeId", "recipeVersion", "recoveryEvidence", "retailerId",
    "retailerSku", "validationProfile"
  ]);
  assert.equal(body.contractVersion, 3);
  assert.deepEqual(body.recoveryEvidence, []);
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
      recoveryEvidence: [],
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

test("the packaged interpreter sends only normalized missing-field recovery evidence", async () => {
  const fixture = signedObserverRecipe();
  const fieldOutcomes = ["availability", "unitPrice", "seller", "fulfillment", "addControl"].map((field) => ({
    field,
    recipeState: "value",
    packagedState: field === "unitPrice" ? "missing" : "agreed",
    oracleState: "agreed",
    disposition: "verified"
  }));
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root,
    observerRecipeEvaluation: {
      validationProfile: "packaged_structured_oracle_v1",
      evaluatedFieldCount: 5,
      agreedFieldCount: 5,
      ambiguousFieldCount: 0,
      oracleEvaluatedFieldCount: 5,
      oracleAgreedFieldCount: 5,
      oracleConflictFieldCount: 0,
      packagedMissingFieldCount: 1,
      packagedConflictFieldCount: 0,
      insufficientFieldCount: 0,
      fieldOutcomes,
      recoveryEvidence: [{ field: "unitPrice", normalizedValue: 798 }],
      shape: "unitPrice:value:missing:agreed:verified"
    }
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  const trial = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/observer-recipe-trials/amazon"));
  assert.ok(trial);
  const body = JSON.parse(String(trial.options.body)) as Record<string, unknown>;
  assert.equal(body.contractVersion, 3);
  assert.deepEqual(body.recoveryEvidence, [{ field: "unitPrice", normalizedValue: 798 }]);
  assert.equal(JSON.stringify(body).includes("Amazon.com"), false);
  assert.equal(JSON.stringify(body).includes("#merchant-info"), false);
  const injectedFiles = runtime.injections.flatMap((entry) => Array.isArray(entry.files) ? entry.files as string[] : []);
  assert.equal(injectedFiles.some((file) => ["amazon-action.js", "walmart-action.js", "target-action.js", "bestbuy-action.js"].includes(file)), false);
});

test("inconsistent recovery values fail closed before the trial leaves Chrome", async () => {
  const fixture = signedObserverRecipe();
  const fieldOutcomes = ["availability", "unitPrice", "seller", "fulfillment", "addControl"].map((field) => ({
    field,
    recipeState: "value",
    packagedState: "agreed",
    oracleState: "agreed",
    disposition: "verified"
  }));
  const runtime = harness({
    activeUrl: AMAZON_PRODUCT_URL,
    observerRecipeDistribution: fixture.distribution,
    observerRecipeRoot: fixture.root,
    observerRecipeEvaluation: {
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
      fieldOutcomes,
      recoveryEvidence: [{ field: "unitPrice", normalizedValue: 798 }],
      shape: "unitPrice:value:agreed:agreed:verified"
    }
  });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal(response.recipeTrial, null);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/observer-recipe-trials/")), false);
  const status = runtime.storage.yoinkObserverRecipeStatusV1 as Record<string, unknown>;
  assert.equal(status.outcome, "failed_closed");
  assert.match(String(status.message), /inconsistent recovery evidence/);
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
  assert.equal(observationBody.adapterVersion, "disney-observer-v2");
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

test("the service worker keeps Premium Bandai and Pokémon Center inspections read-only", async () => {
  const examples = [
    ["pbandai", PBANDAI_PRODUCT_URL, "pbandai-observer-v3", "N2884150001"],
    ["pokemoncenter", POKEMONCENTER_PRODUCT_URL, "pokemoncenter-observer-v4", "10-10320-101"]
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
    assert.equal(body.canonicalUrl, activeUrl, retailerId);
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

test("the service worker waits for a hydrating Walmart price before logging a repair", async () => {
  const runtime = harness({ activeUrl: WALMART_PRODUCT_URL, walmartHydrationRetry: true });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  assert.equal((response.observation as Record<string, unknown>).unitPriceCents, 4499);
  assert.equal(runtime.injections.filter((entry) =>
    (entry.args as unknown[] | undefined)?.[0] === "waitForRetailerShadowHydration").length, 1);
  const diagnosticPost = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/adapter-diagnostics/walmart"));
  assert.ok(diagnosticPost);
  const diagnostic = JSON.parse(String(diagnosticPost.options.body)) as Record<string, unknown>;
  assert.equal(diagnostic.outcome, "recovered");
  assert.equal(diagnostic.failureStage, "price_binding");
  assert.equal(diagnostic.reasonCode, "dom_hydration_recovered");
  assert.equal(diagnostic.attemptCount, 2);
  assert.equal(diagnostic.domChanged, true);
});

test("the service worker accepts and reports constrained semantic layout recovery without retrying", async () => {
  const runtime = harness({ activeUrl: AMAZON_PRODUCT_URL, amazonSemanticRecovery: true });
  const response = await runtime.send({ type: "yoink:inspect-retailer" });
  assert.equal(response.ok, true);
  const diagnosticPosts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/amazon"));
  assert.equal(diagnosticPosts.length, 1);
  const diagnostic = JSON.parse(String(diagnosticPosts[0]?.options.body)) as Record<string, unknown>;
  assert.equal(diagnostic.outcome, "passed");
  assert.equal(diagnostic.failureStage, "complete");
  assert.equal(diagnostic.reasonCode, "semantic_layout_recovered");
  assert.equal(diagnostic.attemptCount, 1);
  const layout = diagnostic.layout as Record<string, unknown>;
  assert.equal(layout.addControlCount, 0);
  assert.equal(layout.scopedControlCount, 1);
  assert.equal((layout.repairLandmarks as unknown[]).length, 2);
});

test("one domain-aware workflow inspects exactly once and routes all four guarded stores to their no-click verifier", async () => {
  const examples = [
    ["target", PRODUCT_URL, "target-add", "rehearseTargetAdd"],
    ["walmart", WALMART_PRODUCT_URL, "walmart-add", "rehearseWalmartAdd"],
    ["amazon", AMAZON_PRODUCT_URL, "amazon-add", "rehearseAmazonAdd"],
    ["bestbuy", BESTBUY_PRODUCT_URL, "bestbuy-add", "rehearseBestBuyAdd"]
  ] as const;
  for (const [retailerId, activeUrl, trialLane, operation] of examples) {
    const runtime = harness({ activeUrl });
    const response = await runtime.send({ type: "yoink:inspect-and-qualify" });
    assert.equal(response.ok, true, retailerId);
    assert.equal(response.workflow, "qualification", retailerId);
    assert.equal(response.retailerId, retailerId, retailerId);
    assert.equal((response.rehearsal as Record<string, unknown>).ok, true, retailerId);
    assert.equal(
      runtime.fetchCalls.filter((entry) => entry.url.endsWith(`/devices/self/shadow-observations/${retailerId}`)).length,
      1,
      `${retailerId} observation count`
    );
    assert.equal(
      runtime.fetchCalls.filter((entry) => entry.url.endsWith(`/devices/self/qualification-trials/${trialLane}`)).length,
      1,
      `${retailerId} trial count`
    );
    assert.equal(
      runtime.injections.filter((entry) => (entry.args as unknown[] | undefined)?.[0] === operation).length,
      1,
      `${retailerId} rehearsal count`
    );
  }

  const readOnly = harness({ activeUrl: DISNEY_PRODUCT_URL });
  const response = await readOnly.send({ type: "yoink:inspect-and-qualify" });
  assert.equal(response.ok, true);
  assert.equal(response.workflow, "inspection");
  assert.equal(response.retailerId, "disney");
  assert.equal(response.qualificationAvailable, false);
  assert.equal(readOnly.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length, 0);
  assert.equal(readOnly.injections.some((entry) => (entry.files as string[] | undefined)?.some((file) => file.includes("action.js"))), false);
});

test("the service worker captures observer-v7 evidence and rehearses Walmart add-v8 without clicking", async () => {
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
  assert.equal(observationBody.adapterVersion, "walmart-observer-v8");
  assert.equal(observationBody.retailerSku, "17354421975");
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/walmart-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "walmart-add-v10");
  assert.equal(trialBody.observerVersion, "walmart-observer-v8");
  assert.equal(trialBody.outcome, "passed");
  assert.equal(JSON.stringify(trialBody).includes("4499"), false);
  assert.equal(JSON.stringify(trialBody).includes(WALMART_PRODUCT_URL), false);
  assert.equal(JSON.stringify(trialBody).includes(TOKEN), false);
});

test("the service worker rehearses Amazon add-v9 without persisting its offer token", async () => {
  const runtime = harness({ activeUrl: AMAZON_PRODUCT_URL });
  const rehearsal = await runtime.send({ type: "yoink:rehearse-amazon" });
  assert.equal(rehearsal.ok, true);
  assert.equal((rehearsal.rehearsal as Record<string, unknown>).ok, true);
  assert.ok(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.includes("amazon-action.js")));
  assert.ok(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "rehearseAmazonAdd"));
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/amazon-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "amazon-add-v11");
  assert.equal(trialBody.observerVersion, "amazon-observer-v9");
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

test("Best Buy product-code inspection resolves exact page identity before recording and rehearsing", async () => {
  for (const code of ["CJ6QGKQ8QQ", "CJ6QGKQ8Q5"]) {
    const runtime = harness({ activeUrl: `https://www.bestbuy.com/product/lorcana-playmat/${code}` });
    const response = await runtime.send({ type: "yoink:inspect-and-qualify" });
    assert.equal(response.ok, true, String(response.message));
    assert.equal((response.rehearsal as Record<string, unknown>).ok, true);
    assert.equal((response.popupResult as Record<string, unknown>).contextKey, `product_link:bestbuy:${code}`);
    assert.ok(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "resolveBestBuyProductIdentity"));
    assert.equal(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "commitBestBuyAdd"), false);
  }
  for (const options of [{ bestBuyResolvedSku: "" }, { bestBuyResolvedSku: "9999999" }, { permission: false }]) {
    const runtime = harness({ activeUrl: "https://www.bestbuy.com/product/lorcana-playmat/CJ6QGKQ8QQ", ...options });
    const response = await runtime.send({ type: "yoink:inspect-and-qualify" });
    assert.equal(response.ok, false);
    assert.equal(runtime.fetchCalls.some((entry) => entry.url.includes("/shadow-observations/")), false);
    assert.equal(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "rehearseBestBuyAdd"), false);
  }
});

test("rehearsal diagnostics preserve unknown stock and the observer's repair reason", async () => {
  const runtime = harness({ activeUrl: BESTBUY_PRODUCT_URL });
  for (const entry of [
    { availability: "unknown", fulfillment: "unknown", outcome: "failed", failureStage: "add_control", reasonCode: "add_control_ambiguous" },
    { availability: "unknown", fulfillment: "pickup", outcome: "rejected", failureStage: "policy", reasonCode: "fulfillment_not_supported" },
    { availability: "out_of_stock", fulfillment: "shipping", outcome: "rejected", failureStage: "policy", reasonCode: "out_of_stock" }
  ]) {
    const result = await runtime.invokeBackground(`addRehearsalBuildFailure(${JSON.stringify({
      observation: { ...BESTBUY_OBSERVATION, availability: entry.availability, fulfillment: entry.fulfillment, addControlActionable: false },
      diagnostic: { outcome: "failed", failureStage: "add_control", reasonCode: "add_control_ambiguous" }
    })})`);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      outcome: entry.outcome, failureStage: entry.failureStage, reasonCode: entry.reasonCode
    });
  }
  assert.equal(runtime.injections.length, 0);
});

test("Best Buy inspection and watch checks select Shipping before reading the offer, without an Add", async () => {
  const runtime = harness({ activeUrl: BESTBUY_PRODUCT_URL });
  const response = await runtime.send({ type: "yoink:inspect-and-qualify" });
  assert.equal(response.ok, true);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  const selectIndex = operations.indexOf("selectBestBuyShipping");
  assert.ok(selectIndex >= 0);
  assert.ok(selectIndex < operations.indexOf("bestbuy"));
  assert.ok(selectIndex < operations.indexOf("rehearseBestBuyAdd"));
  assert.equal(operations.includes("commitBestBuyAdd"), false);
  const watch = harness({ activeUrl: BESTBUY_PRODUCT_URL });
  await watch.invokeBackground('collectWatchObservation(17, {retailerId:"bestbuy",retailerSku:"6588149"})');
  const watchOperations = watch.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.ok(watchOperations.indexOf("selectBestBuyShipping") < watchOperations.indexOf("bestbuy"));
});

test("Best Buy failed Shipping selection stops qualification and live Add preparation", async () => {
  const runtime = harness({ activeUrl: BESTBUY_PRODUCT_URL, bestBuyShippingFailure: true });
  const response = await runtime.send({ type: "yoink:inspect-and-qualify" });
  assert.equal((response.rehearsal as Record<string, unknown>).ok, false);
  assert.match(String(response.message), /could not verify Shipping/);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.includes("rehearseBestBuyAdd"), false);
  assert.equal(operations.includes("commitBestBuyAdd"), false);
  const diagnostics = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/adapter-diagnostics/bestbuy"));
  assert.ok(diagnostics.length >= 1);
  assert.equal(JSON.parse(String(diagnostics[0]!.options.body)).reasonCode, "fulfillment_selection_failed");
  const live = harness({ bestBuyJob: true, bestBuyShippingFailure: true });
  live.fireJobAlarm();
  await waitFor(() => live.jobStates.includes("offer_rejected"), "Shipping failure should stop the live job");
  const liveOperations = live.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(liveOperations.includes("prepareBestBuyAdd"), false);
  assert.equal(liveOperations.includes("commitBestBuyAdd"), false);
});

test("the service worker captures current Best Buy evidence and rehearses without an Add click", async () => {
  const runtime = harness({ activeUrl: BESTBUY_PRODUCT_URL });
  const rehearsal = await runtime.send({ type: "yoink:rehearse-bestbuy" });
  assert.equal(rehearsal.ok, true);
  assert.equal((rehearsal.rehearsal as Record<string, unknown>).ok, true);
  assert.ok(runtime.injections.some((entry) => (entry.files as string[] | undefined)?.includes("bestbuy-action.js")));
  assert.ok(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "rehearseBestBuyAdd"));
  const observationPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/shadow-observations/bestbuy"));
  assert.ok(observationPost);
  const observationBody = JSON.parse(String(observationPost.options.body)) as Record<string, unknown>;
  assert.equal(observationBody.adapterVersion, "bestbuy-observer-v14");
  assert.equal(observationBody.retailerSku, "6588149");
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/bestbuy-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "bestbuy-add-v18");
  assert.equal(trialBody.observerVersion, "bestbuy-observer-v14");
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

test("the service worker qualifies an actionable Best Buy preorder through the normal no-click boundary", async () => {
  const runtime = harness({ activeUrl: BESTBUY_PRODUCT_URL, bestBuyPreorder: true });
  const rehearsal = await runtime.send({ type: "yoink:rehearse-bestbuy" });
  assert.equal(rehearsal.ok, true);
  assert.equal((rehearsal.rehearsal as Record<string, unknown>).ok, true);
  const trialPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/qualification-trials/bestbuy-add"));
  assert.ok(trialPost);
  const trialBody = JSON.parse(String(trialPost.options.body)) as Record<string, unknown>;
  assert.equal(trialBody.adapterVersion, "bestbuy-add-v18");
  assert.equal(trialBody.outcome, "passed");
  const diagnostics = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/bestbuy"));
  assert.equal(diagnostics.length, 2);
  const rehearsalDiagnostic = JSON.parse(String(diagnostics.at(-1)?.options.body)) as Record<string, unknown>;
  assert.equal(rehearsalDiagnostic.outcome, "passed");
  assert.equal(rehearsalDiagnostic.reasonCode, "verified");
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
    "packVersion",
    "reasonCode",
    "shadowObservationId"
  ]);
  assert.equal(body.outcome, "passed");
  assert.equal(body.reasonCode, "verified");
  assert.equal(JSON.stringify(body).includes("5999"), false);
  assert.equal(JSON.stringify(body).includes(PRODUCT_URL), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  const diagnostics = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target"));
  assert.equal(diagnostics.length, 2);
  const rehearsalDiagnostic = JSON.parse(String(diagnostics.at(-1)?.options.body)) as Record<string, unknown>;
  assert.equal(rehearsalDiagnostic.operation, "rehearse_add");
  assert.equal(rehearsalDiagnostic.outcome, "passed");
  assert.equal(rehearsalDiagnostic.failureStage, "complete");
});

test("the read-only cart verifier wakes on DOM mutation in one injection and refuses mutation operations", async (t) => {
  const runtime = harness();
  const injectionCount = runtime.injections.length;
  const disallowed = await runtime.invokeBackground(
    'executeReadOnlyCartAction(17, "target", "commitTargetAdd", [], 500)'
  ) as Record<string, unknown>;
  assert.equal(disallowed.ok, false);
  assert.equal(disallowed.reason, "runner_unavailable");
  assert.equal(runtime.injections.length, injectionCount);

  await runtime.invokeBackground(
    'executeReadOnlyCartAction(17, "target", "inspectTargetCartBaseline", [], 500)'
  );
  const injection = runtime.injections.at(-1);
  assert.equal((injection?.args as unknown[] | undefined)?.[0], "inspectTargetCartBaseline");
  const injectedFunction = injection?.func;
  assert.equal(typeof injectedFunction, "function");
  const pageState = { ready: false, checks: 0, disconnected: false };
  class FixtureMutationObserver {
    readonly callback: () => void;

    constructor(callback: () => void) {
      this.callback = callback;
    }

    observe() {
      setTimeout(() => {
        pageState.ready = true;
        this.callback();
      }, 10);
    }

    disconnect() {
      pageState.disconnected = true;
    }
  }
  const pageContext = createContext({
    YoinkTargetAction: {
      inspectTargetCartBaseline: () => {
        pageState.checks += 1;
        return pageState.ready
          ? { ok: true, reason: "verified", proof: { lineCount: 1 } }
          : { ok: false, reason: "cart_unverified" };
      }
    },
    document: { documentElement: {} },
    location: { href: "https://www.target.com/cart" },
    MutationObserver: FixtureMutationObserver,
    Promise,
    Set,
    String,
    Object,
    Array,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });
  const startedAt = Date.now();
  const result = await runInContext(
    `(${String(injectedFunction)})(...${JSON.stringify(injection?.args || [])})`,
    pageContext
  ) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    reason: "verified",
    proof: { lineCount: 1 }
  });
  assert.equal(pageState.checks, 2);
  assert.equal(pageState.disconnected, true);
  assert.ok(Date.now() - startedAt < 250, "The mutation wake should beat the 250 ms fallback read.");

  // Use a controlled clock for the 50 ms fallback window: CPU contention must
  // not decide how many of its scheduled read attempts run before the deadline.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const timeoutState = { checks: 0, disconnected: false };
  class QuietMutationObserver {
    observe() {}

    disconnect() {
      timeoutState.disconnected = true;
    }
  }
  const timeoutContext = createContext({
    YoinkTargetAction: {
      inspectTargetCartBaseline: () => {
        timeoutState.checks += 1;
        return { ok: false, reason: "cart_unverified" };
      }
    },
    document: { documentElement: {} },
    location: { href: "https://www.target.com/cart" },
    MutationObserver: QuietMutationObserver,
    Promise,
    Set,
    String,
    Object,
    Array,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });
  const timeoutResult = runInContext(
    `(${String(injectedFunction)})(...${JSON.stringify([
      "inspectTargetCartBaseline", [], "YoinkTargetAction", 50, 5, 20
    ])})`,
    timeoutContext
  ) as Promise<Record<string, unknown>>;
  for (let elapsed = 0; elapsed < 60; elapsed += 5) {
    t.mock.timers.tick(5);
    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  }
  const timedOut = await timeoutResult;
  assert.deepEqual(JSON.parse(JSON.stringify(timedOut)), { ok: false, reason: "cart_unverified" });
  assert.ok(timeoutState.checks >= 3, "The in-page fallback should preserve bounded hydration coverage.");
  assert.equal(timeoutState.disconnected, true);
});

test("asynchronous cart inspection retries serially and settles rejected or stalled reads within its deadline", async (t) => {
  const runtime = harness();
  await runtime.invokeBackground('executeReadOnlyCartAction(17, "aninebing", "inspectAnineBingCartBaseline", [], 500)');
  const injectedFunction = runtime.injections.at(-1)?.func;
  assert.equal(typeof injectedFunction, "function");
  for (const mode of ["retry", "reject", "stall", "late"] as const) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let disconnected = false;
    const context = createContext({
      YoinkAnineBingAction: {
        inspectAnineBingCartBaseline: async () => {
          calls++;
          active++;
          maxActive = Math.max(maxActive, active);
          if (mode === "stall") return new Promise(() => {});
          await new Promise(resolve => setTimeout(resolve, mode === "late" ? 100 : 15));
          active--;
          if (mode === "reject") throw new Error("Cart read failed");
          return mode === "late" || calls >= 2 ? { ok: true, reason: "verified" } : { ok: false, reason: "cart_unverified" };
        }
      },
      document: { documentElement: {} }, location: { href: "https://www.aninebing.com/cart" },
      MutationObserver: class { observe() {} disconnect() { disconnected = true; } },
      setTimeout, clearTimeout, setInterval, clearInterval
    });
    let settled = false;
    const pending = runInContext(`(${String(injectedFunction)})(...${JSON.stringify([
      "inspectAnineBingCartBaseline", [], "YoinkAnineBingAction", 60, 2, 5
    ])})`, context) as Promise<Record<string, unknown>>;
    void pending.then(() => { settled = true; });
    // Advance timers and drain async reads separately so CPU load cannot
    // consume the short operation deadline before the second cart read.
    const advance = async (milliseconds: number) => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 5) {
        t.mock.timers.tick(5);
        for (let turn = 0; turn < 4; turn++) await Promise.resolve();
      }
    };
    await advance(60);
    assert.equal(settled, true, `${mode}: inspection must settle within its deadline`);
    const result = await pending;
    assert.equal(result.reason, mode === "retry" ? "verified" : mode === "reject" ? "runner_failed" : "cart_unverified", mode);
    assert.equal(result.ok, mode === "retry", mode);
    assert.equal(maxActive, 1, "fallbacks must not overlap pending reads");
    assert.equal(disconnected, true, "all exit paths disconnect the observer");
    const settledCalls = calls;
    await advance(110);
    assert.equal(calls, settledCalls, "late results do not restart inspection");
    t.mock.timers.reset();
  }
});

// Kevin, 2026-10-09: the TrackaLacker library sync "seems a bit slow" and was manual only.
test("the TrackaLacker library refreshes by itself: hourly quick, nightly full, never over a run or after a refusal", async () => {
  const runtime = harness();
  const now = Date.parse("2026-10-09T18:00:00.000Z");
  const due = (state: Record<string, unknown>, schedule: Record<string, unknown>, hour: number) => runtime.invokeBackground(
    `Promise.resolve(trackalackerSyncDue(${JSON.stringify(state)}, ${JSON.stringify(schedule)}, ${now}, ${hour}))`);
  const minutes = (count: number) => now - count * 60_000;
  assert.equal(await due({ phase: "idle" }, {}, 14), "quick", "never synced");
  assert.equal(await due({ phase: "complete" }, { lastStartedAt: minutes(30) }, 14), "", "refreshed half an hour ago");
  assert.equal(await due({ phase: "complete" }, { lastStartedAt: minutes(61) }, 14), "quick");
  assert.equal(await due({ phase: "complete" }, { lastStartedAt: minutes(61), lastFullAt: minutes(21 * 60) }, 3), "full", "the nightly pass");
  assert.equal(await due({ phase: "complete" }, { lastStartedAt: minutes(61), lastFullAt: minutes(21 * 60) }, 14), "quick", "full passes wait for the night");
  assert.equal(await due({ phase: "complete" }, { lastStartedAt: minutes(10), lastFullAt: minutes(60) }, 3), "", "tonight's pass already ran");
  assert.equal(await due({ phase: "importing", updatedAt: new Date(minutes(1)).toISOString() }, {}, 14), "", "a run is going");
  assert.equal(await due({ phase: "importing", updatedAt: new Date(minutes(5)).toISOString() }, {}, 14), "quick", "a run an update cut off is picked up");
  assert.equal(await due({ phase: "error" }, { retryAfter: now + 60_000 }, 14), "", "TrackaLacker pushed back");
});

test("a TrackaLacker sync that TrackaLacker refuses backs off and closes the tab it opened in the background", async () => {
  const runtime = harness();
  await runtime.invokeBackground(`finishTrackalackerSync({ phase: "error", mode: "quick", stopReason: "blocked", openedTabId: 17 })`);
  assert.ok(runtime.tabRemovals.includes(17), "the background tab is closed");
  const schedule = runtime.storage.yoinkTrackalackerSyncScheduleV1 as { retryAfter: number; lastFullAt?: number };
  assert.ok(schedule.retryAfter > Date.now() + 110 * 60_000, "tries again in about 2 hours");
  assert.equal(schedule.lastFullAt, undefined);
  await runtime.invokeBackground(`finishTrackalackerSync({ phase: "complete", mode: "full", stopReason: "", openedTabId: null })`);
  assert.ok(Number((runtime.storage.yoinkTrackalackerSyncScheduleV1 as { lastFullAt: number }).lastFullAt) >= Date.now() - 5_000, "a finished full pass is noted");
});

// Kevin, 2026-10-09: "if an item does not succeed to auto close the tab", and
// Retry when sold out "would refresh the page and try again vs opening new tabs".
test("a cart add that finds the item sold out closes its tab and stops without an alert", async () => {
  const runtime = harness({ liveJob: true, liveSoldOutTries: 1 });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("offer_rejected"),
    `The sold-out add did not stop (states: ${runtime.jobStates.join(",") || "none"}).`);
  // One tab per try (Kevin, 2026-10-11): it reads the cart, then opens the product page.
  assert.equal(runtime.tabCreates.length, 1, JSON.stringify(runtime.tabCreates));
  const product = runtime.tabCreates[0]!;
  assert.ok(runtime.tabUpdates.some((update) => update.id === product.id && update.url?.includes("/A-1011483414")),
    "the try opened the product page");
  await waitFor(() => runtime.tabRemovals.includes(product.id), "The sold-out product tab was left open.");
  // Kevin, 2026-10-13: a call that doesn't reach the cart raises no Windows alert; the call log says why.
  assert.deepEqual(runtime.shownNotifications.map((entry) => entry.id), []);
  assert.equal(runtime.storage.yoinkRestockTabsV1, undefined, "nothing is kept without a retry");
});

test("Retry when sold out reloads the same tab for the next try instead of opening another", async () => {
  const runtime = harness({ liveJob: true, liveSoldOutTries: 1, restockRetries: 1 });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("adding"),
    `The retry did not reach the add (states: ${runtime.jobStates.join(",") || "none"}).`, 6_000);
  assert.deepEqual(runtime.jobStates.slice(0, 6),
    ["navigating", "verifying_listing", "offer_rejected:retry_set", "navigating", "verifying_listing", "offer_verified"],
    "sold out, retry set, then the next try found it in stock");
  const products = runtime.tabCreates;
  assert.equal(products.length, 1, "no second tab");
  assert.ok(runtime.tabUpdates.some((update) => update.id === products[0]!.id && update.url?.includes("/A-1011483414") && update.active === undefined),
    "the kept tab was reloaded in the background");
  assert.ok(runtime.tabUpdates.some((update) => update.id === products[0]!.id && update.url === "https://www.target.com/cart" && update.active === undefined),
    "the retry read the cart in the same, background tab");
  assert.equal(runtime.tabRemovals.includes(products[0]!.id), false, "the tab that added it stays for checkout");
  assert.equal(runtime.shownNotifications.some((entry) => entry.id.startsWith("yoink-action-stopped:")), false,
    "no stopped alert while a retry is set");
});

test("the service worker runs one leased Target add through baseline, click receipt, and exact cart delta proof", async () => {
  const runtime = harness({ liveJob: true, cartBaselineHydrationRetry: true, cartReadySound: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      `Fixture Target job did not complete (states: ${runtime.jobStates.join(",") || "none"}; requests: ${runtime.fetchCalls.slice(-6).map((entry) => entry.url).join(",")}).`
    )), 3_000))
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
  assert.equal(runtime.fetchCalls.some((entry) => {
    const url = new URL(entry.url);
    return url.pathname.endsWith("/devices/self/jobs/next")
      && url.searchParams.get("wait") === "25000"
      && url.searchParams.get("retailers") === "target,walmart,amazon,bestbuy,pokemoncenter,aninebing,americaneagle,asus,athleta,audioadvice,bananarepublic,bananarepublicfactory";
  }), true, "Chrome should hold the bounded job watch across most of the 30-second alarm interval");
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.endsWith("/health")), false,
    "General health must not add a round trip before the authoritative job lease.");
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/heartbeat")), false,
    "The periodic device heartbeat must stay off the signal-to-lease hot path.");
  assert.equal(new URL(runtime.fetchCalls[0]?.url || "https://invalid.example").pathname.endsWith(
    "/devices/self/jobs/next"
  ), true, "The authenticated lease should be the first server request in a job cycle.");
  assert.deepEqual(
    JSON.parse(JSON.stringify(await runtime.invokeBackground(
      `Promise.resolve([
        actionJobLeaseRequest(0, ["target", "walmart", "amazon", "bestbuy"]),
        actionJobLeaseRequest(1, ["target", "walmart", "amazon", "bestbuy"])
      ])`
    ))),
    [
      { path: "/devices/self/jobs/next?wait=25000&retailers=target,walmart,amazon,bestbuy", timeoutMs: 28_000 },
      { path: "/devices/self/jobs/next?wait=0&retailers=target,walmart,amazon,bestbuy", timeoutMs: 3_000 }
    ],
    "The companion request timeout must outlive the server wait while remaining below Chrome's 30-second fetch limit."
  );
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  assert.equal(operations.filter((operation) => operation === "inspectTargetCartBaseline").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareTargetAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitTargetAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "yoink_post_click_settle_arm").length, 1);
  assert.equal(operations.filter((operation) => operation === "yoink_post_click_settle_wait").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyTargetAddedCart").length, 1);
  await waitFor(
    () => runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target")
      && JSON.parse(String(entry.options.body)).operation === "live_add"),
    "The Target live-add diagnostic did not reach the shared activity pipeline."
  );
  const liveDiagnosticPost = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target")
    && JSON.parse(String(entry.options.body)).operation === "live_add");
  const liveDiagnostic = JSON.parse(String(liveDiagnosticPost?.options.body)) as Record<string, unknown>;
  assert.equal(liveDiagnostic.outcome, "passed");
  assert.equal(liveDiagnostic.failureStage, "complete");
  const targetVerifyArgs = runtime.injections.find(
    (entry) => (entry.args as unknown[] | undefined)?.[0] === "verifyTargetAddedCart"
  )?.args as unknown[];
  const targetVerifyOperationArgs = targetVerifyArgs[1] as unknown[];
  assert.deepEqual((targetVerifyOperationArgs[2] as { lines: unknown[] }).lines, [
    { retailerSku: "EXISTING-FIXTURE", quantity: 1 }
  ]);
  await waitFor(
    () => runtime.shownNotifications.some((notification) => notification.id === "yoink-cart-ready:job_target_fixture"),
    "The confirmed cart did not produce a local handoff."
  );
  const notification = runtime.shownNotifications.find(
    (entry) => entry.id === "yoink-cart-ready:job_target_fixture"
  );
  assert.equal(notification?.options.title, "Cart ready at Target");
  assert.equal(notification?.options.requireInteraction, true);
  assert.match(String(notification?.options.message), /Checkout is open; you place the order\./);
  const readyState = runtime.storage.yoinkCartReadyV1 as {
    items: Array<{ jobId: string; tabId: number; latency: Record<string, number> }>;
  };
  assert.equal(readyState.items.length, 1);
  assert.equal(readyState.items[0]?.jobId, "job_target_fixture");
  const localLatency = readyState.items[0]?.latency ?? {};
  for (const hop of [
    "leaseToCartReadyMs", "leaseToBaselineMs", "baselineToOfferMs", "offerToClickMs",
    "clickToSettleMs", "clickToCartReadyMs", "settleToCartReadyMs"
  ]) {
    assert.equal(Number.isSafeInteger(localLatency[hop]), true, `${hop} should be a bounded integer.`);
  }
  assert.equal(Number(localLatency.clickToSettleMs) < 1_000, true);
  assert.equal(
    Number(localLatency.leaseToBaselineMs)
      + Number(localLatency.baselineToOfferMs)
      + Number(localLatency.offerToClickMs)
      + Number(localLatency.clickToSettleMs)
      + Number(localLatency.settleToCartReadyMs),
    Number(localLatency.leaseToCartReadyMs),
    "The privacy-bounded phase breadcrumbs should exactly decompose lease-to-cart latency."
  );
  assert.equal(
    Number(localLatency.clickToSettleMs) + Number(localLatency.settleToCartReadyMs),
    Number(localLatency.clickToCartReadyMs)
  );
  assert.equal(runtime.badgeTexts.at(-1), "1");
  await waitFor(
    () => runtime.runtimeMessages.some((message) => message.type === "yoink:play-cart-ready-sound"),
    "The enabled cart-ready sound was not requested."
  );
  assert.equal(runtime.offscreenCreates(), 1);
  const confirmedEvent = runtime.fetchCalls.flatMap((entry) => {
    if (!entry.url.endsWith("/devices/self/jobs/job_target_fixture/events/batch")) return [];
    const body = JSON.parse(String(entry.options.body)) as {
      events?: Array<{ state: string; evidence: { latency: Record<string, number> } }>;
    };
    return body.events?.filter((event) => event.state === "confirmed") || [];
  })[0];
  assert.ok(confirmedEvent);
  const confirmedBody = confirmedEvent;
  assert.deepEqual(
    JSON.parse(JSON.stringify(confirmedBody.evidence.latency)),
    JSON.parse(JSON.stringify(localLatency)),
    "The server event should receive the same sanitized phase decomposition as the local handoff.");

  runtime.clickNotification("yoink-cart-ready:job_target_fixture");
  await waitFor(
    () => Boolean((runtime.storage.yoinkCartReadyV1 as {
      items?: Array<{ openedAt?: string }>;
    })?.items?.[0]?.openedAt),
    "The cart-ready handoff was not marked opened after focusing its tab."
  );
  assert.deepEqual(runtime.tabUpdates.at(-1), { id: readyState.items[0]?.tabId, active: true });
  assert.equal((runtime.storage.yoinkCartReadyV1 as { items?: unknown[] })?.items?.length, 1);
  assert.equal(runtime.badgeTexts.at(-1), "1");
  assert.equal(runtime.clearedNotifications.includes("yoink-cart-ready:job_target_fixture"), true);

  runtime.closeTab(readyState.items[0]?.tabId as number);
  await waitFor(
    () => Array.isArray(runtime.storage.yoinkOrderHandoffsV1)
      && (runtime.storage.yoinkOrderHandoffsV1 as unknown[]).length === 0,
    "Closing the retailer tab did not detach its order-confirmation observer."
  );
  assert.equal((runtime.storage.yoinkCartReadyV1 as { items?: unknown[] })?.items?.length, 1,
    "The checkout-result prompt must survive a retailer tab closing.");
  assert.equal(runtime.badgeTexts.at(-1), "1");
  const reopened = await runtime.send({
    type: "yoink:open-cart-ready",
    jobId: "job_target_fixture"
  }) as { ok: boolean; reopened?: boolean; cartReady?: { items: Array<{ tabId: number }> } };
  assert.equal(reopened.ok, true);
  assert.equal(reopened.reopened, true);
  // A closed cart-ready tab reopens on checkout (Target too since 2026-10-11).
  assert.equal(runtime.tabCreates.at(-1)?.url, "https://www.target.com/checkout");
  assert.equal(reopened.cartReady?.items[0]?.tabId, runtime.tabCreates.at(-1)?.id);
  assert.equal((runtime.storage.yoinkOrderHandoffsV1 as Array<{ tabId: number }>)[0]?.tabId,
    runtime.tabCreates.at(-1)?.id);
  assert.equal("activeTargetJob" in runtime.storage, false);
});

test("the service worker advertises only currently granted store access when leasing", async () => {
  const runtime = harness({ permittedRetailers: ["walmart"] });
  runtime.fireJobAlarm();
  await waitFor(
    () => runtime.fetchCalls.some((entry) => new URL(entry.url).pathname.endsWith("/devices/self/jobs/next")),
    "The access-scoped job lease was not dispatched."
  );
  const requestUrl = new URL(runtime.fetchCalls.find(
    (entry) => new URL(entry.url).pathname.endsWith("/devices/self/jobs/next")
  )?.url || "https://invalid.example");
  assert.equal(requestUrl.searchParams.get("retailers"), "walmart");
  assert.deepEqual(
    JSON.parse(JSON.stringify(await runtime.invokeBackground(
      "Promise.resolve(actionJobLeaseRequest(0, ['walmart', 'walmart', 'unsupported']))"
    ))),
    { path: "/devices/self/jobs/next?wait=25000&retailers=walmart", timeoutMs: 28_000 }
  );
});

test("guarded stores overlap pre-Add work while Best Buy inspects its post-Add page before opening cart", async () => {
  const lanes = [
    { options: {}, prepare: "prepareTargetAdd", commit: "commitTargetAdd", verify: "verifyTargetAddedCart" },
    { options: { walmartJob: true }, prepare: "prepareWalmartAdd", commit: "commitWalmartAdd", verify: "verifyWalmartAddedCart" },
    { options: { amazonJob: true }, prepare: "prepareAmazonAdd", commit: "commitAmazonAdd", verify: "verifyAmazonAddedCart" },
    { options: { bestBuyJob: true }, prepare: "prepareBestBuyAdd", commit: "commitBestBuyAdd", verify: "verifyBestBuyAddedCart" }
  ] as const;

  for (const lane of lanes) {
    const runtime = harness({
      liveJob: true,
      hotPathControlDelayMs: 120,
      ...lane.options
    });
    runtime.fireJobAlarm();
    await Promise.race([
      runtime.jobCompleted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        `${lane.prepare} did not complete its delayed control-path fixture.`
      )), 3_000))
    ]);
    const timeline = runtime.hotPathTimeline;
    const position = (entry: string) => timeline.indexOf(entry);
    const tabBefore = (limit: number, after = -1) => timeline.some(
      (entry, index) => entry.startsWith("tab:") && index > after && index < limit
    );
    const navigatingResponse = position("control:navigating:response");
    const verifyingResponse = position("control:verifying_listing:response");
    const addingResponse = position("control:adding:response");
    const heartbeatResponse = position("control:heartbeat:response");
    const commit = position(`operation:${lane.commit}`);

    assert.equal(tabBefore(navigatingResponse), true,
      `${lane.prepare} should open the read-only cart while navigation progress is acknowledged.`);
    assert.equal(position(`operation:${lane.prepare}`) < verifyingResponse, true,
      `${lane.prepare} should inspect the exact offer while verification progress is acknowledged.`);
    assert.equal(position("operation:yoink_post_click_settle_arm") < addingResponse, true,
      `${lane.prepare} should arm only the passive DOM observer while the durable Add receipt is acknowledged.`);
    assert.equal(addingResponse < commit, true,
      `${lane.commit} must remain after the durable adding acknowledgement.`);
    if ("bestBuyJob" in lane.options) {
      const postAddProbe = position("operation:inspectBestBuyPostAdd");
      assert.equal(heartbeatResponse < postAddProbe, true, "Best Buy must renew its lease before observing the post-Add page.");
      assert.equal(tabBefore(postAddProbe, commit), false, "Best Buy must inspect for a queue before any post-Add cart navigation.");
      assert.equal(tabBefore(position(`operation:${lane.verify}`), postAddProbe), true,
        "Best Buy opens the separate verification cart only after its post-Add page probe.");
    } else {
      assert.equal(tabBefore(heartbeatResponse, commit), true,
        `${lane.verify} should begin the non-mutating return to cart while the lease heartbeat is acknowledged.`);
    }
    assert.equal(heartbeatResponse < position(`operation:${lane.verify}`), true,
      `${lane.verify} must remain after the required heartbeat acknowledgement.`);
  }
});

// Kevin, 2026-10-11: one tab from start to checkout. It reads the cart, opens
// the exact product in the same tab, adds, and ends on checkout there.
test("cold guarded adds run in one tab on all four stores: cart, exact product, then checkout", async () => {
  const lanes = [
    {
      name: "Target",
      sku: "1011483414",
      baseline: "inspectTargetCartBaseline",
      options: {},
      productUrl: PRODUCT_URL,
      cartUrl: "https://www.target.com/cart",
      checkoutUrl: "https://www.target.com/checkout"
    },
    {
      name: "Walmart",
      sku: "17354421975",
      baseline: "inspectWalmartCartBaseline",
      options: { walmartJob: true },
      productUrl: WALMART_PRODUCT_URL,
      cartUrl: "https://www.walmart.com/cart",
      checkoutUrl: "https://www.walmart.com/checkout"
    },
    {
      name: "Amazon",
      sku: "B0GYTRYV7P",
      baseline: "inspectAmazonCartBaseline",
      options: { amazonJob: true },
      productUrl: AMAZON_PRODUCT_URL,
      cartUrl: "https://www.amazon.com/gp/cart/view.html",
      checkoutUrl: "https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed"
    },
    {
      name: "Best Buy",
      sku: "6588149",
      baseline: "inspectBestBuyCartBaseline",
      options: { bestBuyJob: true },
      productUrl: BESTBUY_PRODUCT_URL,
      cartUrl: "https://www.bestbuy.com/cart",
      checkoutUrl: "https://www.bestbuy.com/checkout/r/fast-track"
    }
  ] as const;

  for (const lane of lanes) {
    const runtime = harness({
      liveJob: true,
      tabLoadDelayMs: 80,
      ...lane.options
    });
    runtime.fireJobAlarm();
    await Promise.race([
      runtime.jobCompleted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        `${lane.name} did not complete its one-tab fixture.`
      )), 3_000))
    ]);
    const jobTab = runtime.tabCreates[0];
    assert.ok(jobTab && jobTab.url === lane.cartUrl && jobTab.active === true,
      `${lane.name} should open one visible tab on its cart: ${JSON.stringify(runtime.tabCreates)}`);
    // The tab's first move is to the exact product, after the cart was read.
    const productMove = runtime.tabUpdates.find((update) => update.id === jobTab!.id && update.url);
    assert.ok(productMove?.url?.includes(lane.sku), `${lane.name} should open the product page in the same tab: ${productMove?.url}`);
    assert.ok(runtime.hotPathTimeline.indexOf(`operation:${lane.baseline}`) >= 0
      && runtime.hotPathTimeline.indexOf(`operation:${lane.baseline}`) < runtime.hotPathTimeline.indexOf(`tab:${new URL(String(productMove?.url)).pathname}`),
      `${lane.name} should read its cart before opening the product page: ${runtime.hotPathTimeline.join(",")}`);
    await waitFor(() => runtime.tabUpdates.some((update) => update.id === jobTab!.id
      && update.url === lane.checkoutUrl && update.active === true), `${lane.name} should end on checkout in the same tab.`);
    // Only Best Buy reads its added cart in a second tab (its product page may
    // hold a queue), and that tab is closed once checkout opens.
    const others = runtime.tabCreates.slice(1);
    if (lane.name === "Best Buy") {
      assert.ok(others.every((tab) => runtime.tabRemovals.includes(tab.id)), `${lane.name} left a second tab open.`);
    } else {
      assert.equal(others.length, 0, `${lane.name} opened a second tab: ${JSON.stringify(others)}`);
    }
    assert.equal(runtime.tabRemovals.includes(jobTab!.id), false);
    assert.equal(runtime.jobStates.filter((state) => state === "confirmed").length, 1);
  }
});

test("Target, Walmart and Amazon read the added cart in the job's own tab only after the click", async () => {
  for (const lane of [
    {options:{},commit:"commitTargetAdd",verify:"verifyTargetAddedCart",cartPath:"/cart"},
    {options:{walmartJob:true},commit:"commitWalmartAdd",verify:"verifyWalmartAddedCart",cartPath:"/cart"},
    {options:{amazonJob:true},commit:"commitAmazonAdd",verify:"verifyAmazonAddedCart",cartPath:"/gp/cart/view.html"}
  ]) {
    const runtime=harness({liveJob:true,...lane.options});
    runtime.fireJobAlarm();
    await runtime.jobCompleted;
    const committed=runtime.injections.find(entry=>(entry.args as unknown[] | undefined)?.[0]===lane.commit);
    const verified=runtime.injections.find(entry=>(entry.args as unknown[] | undefined)?.[0]===lane.verify);
    assert.ok(committed && verified);
    const productId=(committed.target as {tabId:number}).tabId;
    const cartId=(verified.target as {tabId:number}).tabId;
    assert.equal(cartId,productId,"the added cart is read in the job's own tab");
    const clicked=runtime.hotPathTimeline.indexOf(`operation:${lane.commit}`);
    assert.ok(clicked>=0 && runtime.hotPathTimeline.indexOf(`tab:${lane.cartPath}`,clicked)>clicked,
      `the tab moved to the cart only after the click: ${runtime.hotPathTimeline.join(",")}`);
    const ready=runtime.storage.yoinkCartReadyV1 as {items:Array<{tabId:number}>};
    assert.equal(ready.items[0]?.tabId,productId);
    assert.equal(runtime.injections.filter(entry=>(entry.args as unknown[] | undefined)?.[0]===lane.commit).length,1);
  }
});

test("hot-path synchronization settles every required branch before surfacing a failure", async () => {
  const runtime = harness();
  const result = await runtime.invokeBackground(`(async () => {
    const order = [];
    const delayed = new Promise((resolve) => setTimeout(() => {
      order.push("delayed_work_settled");
      resolve("done");
    }, 40));
    try {
      await settleRequiredWork(Promise.reject(new Error("fixture_failure")), delayed);
    } catch {
      order.push("failure_surfaced");
    }
    return order;
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    "delayed_work_settled",
    "failure_surfaced"
  ]);
});

test("the cart-ready handoff does not wait for confirmed job-event reporting", async () => {
  const runtime = harness({ liveJob: true, confirmedJobEventDelayMs: 750 });
  runtime.fireJobAlarm();
  await waitFor(
    () => runtime.shownNotifications.some((notification) => notification.id === "yoink-cart-ready:job_target_fixture"),
    "The local cart-ready handoff waited for the control plane.",
    500
  );
  assert.equal(runtime.jobStates.includes("confirmed"), false);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/action-handoffs/reconcile")), false,
    "Reconciliation must not mistake the pre-confirmed server job for a closed handoff.");
  assert.equal(runtime.badgeTexts.at(-1), "1");
  await waitFor(
    () => runtime.jobStates.includes("confirmed"),
    "The delayed confirmed event was not eventually reported.",
    2_000
  );
  await waitFor(
    () => runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/action-handoffs/reconcile")),
    "The authoritative confirmed transition did not start the bounded handoff watch."
  );
  const watch = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/action-handoffs/reconcile"));
  assert.equal(Number(JSON.parse(String(watch?.options.body)).waitMs) > 0, true);
});

// Kevin's Walmart test call (2026-10-12) stopped as extension_error_leased_timeout:
// the PC's Yoink took over 3 s to answer the add's first progress report.
test("an add keeps going while a busy Yoink takes several seconds to note its steps", async () => {
  const runtime = harness({ liveJob: true, slowJobEventMs: 3_500 });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      `The add stopped while Yoink was slow to answer (states: ${runtime.jobStates.join(",") || "none"}).`
    )), 10_000))
  ]);
  assert.deepEqual(runtime.jobStates, [
    "navigating",
    "verifying_listing",
    "offer_verified",
    "add_authorized",
    "adding",
    "cart_verified",
    "confirmed"
  ]);
});

test("an uncertain post-click result raises an immediate local Needs-you handoff", async () => {
  const runtime = harness({ liveJob: true, postClickVerificationFailure: true, cartReadySound: true });
  runtime.fireJobAlarm();
  await waitFor(
    () => runtime.shownNotifications.some((notification) => notification.id === "yoink-needs-you:job_target_fixture"),
    "The uncertain Add result did not produce a local Needs-you handoff."
  );
  const notification = runtime.shownNotifications.find(
    (entry) => entry.id === "yoink-needs-you:job_target_fixture"
  );
  assert.equal(notification?.options.title, "Review Target add");
  assert.equal(notification?.options.requireInteraction, true);
  assert.match(String(notification?.options.message), /could not be verified after Add/);
  const handoffState = runtime.storage.yoinkCartReadyV1 as {
    items: Array<{ jobId: string; kind: string; reasonCode?: string }>;
  };
  assert.equal(handoffState.items.length, 1);
  assert.equal(handoffState.items[0]?.jobId, "job_target_fixture");
  assert.equal(handoffState.items[0]?.kind, "needs_you");
  assert.equal(handoffState.items[0]?.reasonCode, "cart_delta_unverified");
  assert.equal(runtime.badgeTexts.at(-1), "1");
  assert.equal(runtime.badgeColors.at(-1), "#ffca6b");
  assert.equal(runtime.jobStates.includes("manual_review"), true);
  const verifies = runtime.injections.filter(i => (i.args as unknown[] | undefined)?.[0] === "verifyTargetAddedCart");
  assert.equal(verifies.length,3,"An unchanged cart gets at most two read-only refreshes");
  assert.equal(runtime.injections.filter(i => (i.args as unknown[] | undefined)?.[0] === "commitTargetAdd").length,1);
});

// Kevin's repeat NeeDoh call (2026-10-12) stopped this way, and its cart page never reached diagnostics.
test("a cart that changed other than by the add keeps a cart-page snapshot", async () => {
  const runtime = harness({ liveJob: true, postClickVerificationFailure: true });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/evidence-capsules/target")),
    `No cart snapshot was sent (${runtime.jobStates.join(",")}).`, 6_000);
  const posts = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/evidence-capsules/target"));
  const capsule = JSON.parse(String(posts[0]?.options.body)) as Record<string, unknown>;
  assert.deepEqual([capsule.trigger, capsule.operation, capsule.outcome, capsule.failureStage, capsule.reasonCode],
    ["live_add_non_pass", "live_add", "failed", "runner", "cart_delta_unverified"]);
});

test("a conflicting cart stops without refresh or a repeated Add", async () => {
  const runtime=harness({liveJob:true,postClickVerificationFailure:true,cartConflictAfterAdd:true});
  runtime.fireJobAlarm();
  await waitFor(()=>runtime.jobStates.includes("manual_review"),"The cart conflict did not stop.");
  const verifies=runtime.injections.filter(i=>(i.args as unknown[] | undefined)?.[0]==="verifyTargetAddedCart");
  assert.equal(verifies.length,1);
  const cartId=(verifies[0]?.target as {tabId:number}).tabId;
  // The job's one tab went to the cart once after the add, and was never refreshed.
  assert.equal(runtime.tabUpdates.filter(t=>t.id===cartId&&t.url==="https://www.target.com/cart").length,1);
  assert.equal(runtime.injections.filter(i=>(i.args as unknown[] | undefined)?.[0]==="commitTargetAdd").length,1);
});

test("an unchanged cart is refreshed after a delayed Add without touching the product or clicking again", async () => {
  for (const lane of [
    {options:{},verify:"verifyTargetAddedCart",commit:"commitTargetAdd"},
    {options:{walmartJob:true},verify:"verifyWalmartAddedCart",commit:"commitWalmartAdd"},
    {options:{amazonJob:true},verify:"verifyAmazonAddedCart",commit:"commitAmazonAdd"}
  ]) {
    const runtime=harness({liveJob:true,delayedCartResult:true,...lane.options});
    runtime.fireJobAlarm();
    await waitFor(()=>runtime.jobStates.includes("confirmed")||runtime.jobStates.includes("manual_review"),"The delayed cart did not settle.");
    assert.equal(runtime.jobStates.includes("confirmed"),true,"An unchanged first read must not become a permanent false failure");
    assert.equal(runtime.injections.filter(i=>(i.args as unknown[] | undefined)?.[0]===lane.commit).length,1);
    const verifies=runtime.injections.filter(i=>(i.args as unknown[] | undefined)?.[0]===lane.verify);
    assert.equal(verifies.length,2);
    const cartId=(verifies[0]?.target as {tabId:number}).tabId;
    assert.equal(runtime.tabUpdates.filter(t=>t.url?.includes("/cart")).every(t=>t.id===cartId),true);
  }
});

test("one alarm drains confirmed Target jobs, each ending on its own checkout tab", async () => {
  const runtime = harness({ liveJob: true, queuedJobCount: 2 });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture Target queue did not drain.")), 7_000))
  ]);
  await waitFor(() => runtime.jobLeaseRequests() === 3, "The drained queue was not checked for completion.");
  const expectedStates = [
    "navigating",
    "verifying_listing",
    "offer_verified",
    "add_authorized",
    "adding",
    "cart_verified",
    "confirmed"
  ];
  assert.deepEqual(runtime.jobStates, [...expectedStates, ...expectedStates]);
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  // A cart handed off on checkout is the shopper's, so the second add reads its own baseline.
  assert.equal(operations.filter((operation) => operation === "inspectTargetCartBaseline").length, 2);
  assert.equal(operations.filter((operation) => operation === "commitTargetAdd").length, 2);
  assert.equal(operations.filter((operation) => operation === "verifyTargetAddedCart").length, 2);
  assert.equal(runtime.tabUrls().length, 3, runtime.tabUrls().join(","));
  assert.equal(runtime.tabUrls().filter((url) => url === "https://www.target.com/checkout").length, 2);
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
});

test("a later job cycle runs its whole add in the persisted retailer action tab", async () => {
  const runtime = harness({ liveJob: true, persistedActionTab: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture persisted-tab job did not complete.")), 3_000))
  ]);
  // Kevin, 2026-10-11: the kept tab reads the cart, adds, and ends on checkout; nothing else opens.
  assert.equal(runtime.tabCreates.length, 0, JSON.stringify(runtime.tabCreates));
  const commit = runtime.injections.find(i => (i.args as unknown[] | undefined)?.[0] === "commitTargetAdd");
  assert.equal((commit?.target as {tabId:number}).tabId,17,"The existing tab is reused before Add");
  const verified = runtime.injections.find(i => (i.args as unknown[] | undefined)?.[0] === "verifyTargetAddedCart");
  assert.equal((verified?.target as {tabId:number}).tabId,17);
  await waitFor(() => runtime.tabUrls().join(",") === "https://www.target.com/checkout", `The add did not end on checkout: ${runtime.tabUrls().join(",")}`);
  // A cart handed off on checkout is the shopper's now: it isn't kept for the next add.
  await waitFor(
    () => !(runtime.storage.yoinkRetailerActionTabsV1 as { tabs?: { target?: unknown } })?.tabs?.target,
    "The checkout tab was kept for the next job cycle."
  );
});

test("a kept retailer action tab is forgotten when the shopper closes it", async () => {
  const runtime = harness({ liveJob: true, cartBaselineFailure: true });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("cancelled"), "The unreadable cart did not stop the add.");
  await waitFor(
    () => Number.isInteger((runtime.storage.yoinkRetailerActionTabsV1 as { tabs?: { target?: { tabId?: number } } })?.tabs?.target?.tabId),
    "The stopped add's cart tab was not kept for the next try."
  );
  const kept = (runtime.storage.yoinkRetailerActionTabsV1 as { tabs: { target: { tabId: number } } }).tabs.target.tabId;
  runtime.closeTab(kept);
  await waitFor(
    () => !(runtime.storage.yoinkRetailerActionTabsV1 as { tabs?: { target?: unknown } })?.tabs?.target,
    "The closed reusable action tab was not forgotten."
  );
});

test("store drains end each add on its own checkout tab", async () => {
  const fixtures = [
    {
      options: { walmartJob: true, queuedJobCount: 2 },
      baseline: "inspectWalmartCartBaseline",
      commit: "commitWalmartAdd",
      verify: "verifyWalmartAddedCart",
      cartUrl: "https://www.walmart.com/cart",
      handoffUrl: "https://www.walmart.com/checkout"
    },
    {
      options: { amazonJob: true, queuedJobCount: 2 },
      baseline: "inspectAmazonCartBaseline",
      commit: "commitAmazonAdd",
      verify: "verifyAmazonAddedCart",
      cartUrl: "https://www.amazon.com/gp/cart/view.html",
      handoffUrl: "https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed"
    },
    {
      options: { bestBuyJob: true, queuedJobCount: 2 },
      baseline: "inspectBestBuyCartBaseline",
      commit: "commitBestBuyAdd",
      verify: "verifyBestBuyAddedCart",
      cartUrl: "https://www.bestbuy.com/cart",
      handoffUrl: "https://www.bestbuy.com/checkout/r/fast-track"
    }
  ] as const;
  for (const fixture of fixtures) {
    const runtime = harness(fixture.options);
    runtime.fireJobAlarm();
    await Promise.race([
      runtime.jobCompleted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${fixture.cartUrl} queue did not drain.`)), 7_000))
    ]);
    await waitFor(() => runtime.jobLeaseRequests() === 3, `${fixture.cartUrl} did not reach an empty queue.`);
    const operations = runtime.injections
      .map((entry) => (entry.args as unknown[] | undefined)?.[0])
      .filter(Boolean);
    // The first add's tab hands off on checkout (Kevin, 2026-10-08) and is
    // kept for the shopper, so the second add reads its own fresh baseline.
    assert.equal(operations.filter((operation) => operation === fixture.baseline).length, 2, operations.join(","));
    assert.equal(operations.filter((operation) => operation === fixture.commit).length, 2);
    assert.equal(operations.filter((operation) => operation === fixture.verify).length, 2);
    assert.equal(runtime.jobStates.filter((state) => state === "confirmed").length, 2);
    // Each add ends on its own checkout tab (Kevin, 2026-10-11: one tab per add);
    // the second never takes over the first's. Best Buy's cart tab closes.
    assert.equal(runtime.tabUrls().length, 3, runtime.tabUrls().join(","));
    assert.equal(runtime.tabUrls().filter((url) => url === fixture.handoffUrl).length, 2, runtime.tabUrls().join(","));
    if ("bestBuyJob" in fixture.options) {
      const productTabs = runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd")
        .map(i => (i.target as { tabId: number }).tabId);
      assert.equal(new Set(productTabs).size, 2);
      assert.equal(runtime.tabUpdates.some(t => productTabs.includes(t.id) && t.url === fixture.cartUrl), false,
        JSON.stringify({ productTabs, updates: runtime.tabUpdates }));
    }
  }
});

test("one alarm stops at the four-job drain ceiling", async () => {
  const runtime = harness({ liveJob: true, queuedJobCount: 5 });
  runtime.fireJobAlarm();
  await waitFor(
    () => runtime.jobStates.filter((state) => state === "confirmed").length === 4,
    "The bounded Target drain did not confirm four jobs.",
    8_000
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(runtime.jobLeaseRequests(), 4);
  assert.equal(runtime.jobStates.filter((state) => state === "confirmed").length, 4);
  // Each add ends on its own checkout tab, beside the shopper's own tab.
  assert.equal(runtime.tabUrls().length, 5, runtime.tabUrls().join(","));
});

test("ambiguous cart baselines fail closed while the remaining clean queue continues", async () => {
  const runtime = harness({ liveJob: true, queuedJobCount: 2, cartBaselineFailure: true });
  runtime.fireJobAlarm();
  await waitFor(
    () => runtime.jobStates.filter((state) => state === "cancelled").length === 2,
    "The cleanly rejected Target jobs did not finish draining.",
    5_000
  );
  await waitFor(() => runtime.jobLeaseRequests() === 3, "The clean rejection drain did not reach an empty queue.");
  assert.deepEqual(runtime.jobStates, ["navigating", "cancelled", "navigating", "cancelled"]);
  const operations = runtime.injections
    .map((entry) => (entry.args as unknown[] | undefined)?.[0])
    .filter(Boolean);
  // Each job reads its cart once in its own shown tab; the second reuses the first's tab.
  assert.equal(operations.filter((operation) => operation === "inspectTargetCartBaseline").length, 2);
  assert.equal(operations.some((operation) => operation === "prepareTargetAdd"), false);
  assert.equal(operations.some((operation) => operation === "commitTargetAdd"), false);
  assert.equal(runtime.jobLeaseRequests(), 3);
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
  assert.equal(operations.filter((operation) => operation === "inspectWalmartCartBaseline").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareWalmartAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitWalmartAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyWalmartAddedCart").length, 1);
  // The verified cart hands off on checkout, where the shopper places the order (Kevin, 2026-10-08).
  assert.ok(runtime.tabUrls().includes("https://www.walmart.com/checkout"), runtime.tabUrls().join(","));
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
  assert.equal("activeTargetJob" in runtime.storage, false);
});

// Kevin, 2026-10-10: a quantity per wanted item, capped by the store's own limit.
function confirmedEvidence(runtime: ReturnType<typeof harness>): Record<string, unknown> | undefined {
  for (const call of runtime.fetchCalls) {
    if (!/\/events(?:\/batch)?$/.test(call.url) || typeof call.options?.body !== "string") continue;
    const body = JSON.parse(call.options.body) as { state?: string; evidence?: Record<string, unknown>; events?: Array<{ state: string; evidence?: Record<string, unknown> }> };
    const events = Array.isArray(body.events) ? body.events : [body];
    const confirmed = events.find((event) => event.state === "confirmed");
    if (confirmed) return confirmed.evidence;
  }
  return undefined;
}

function verifyQuantities(runtime: ReturnType<typeof harness>, operation: string): number[] {
  return runtime.injections
    .filter((entry) => (entry.args as unknown[] | undefined)?.[0] === operation)
    .map((entry) => Number((((entry.args as unknown[])[1] as unknown[])[0] as { quantity?: number }).quantity));
}

test("a Walmart plan for 3 adds one, raises the cart line to the store's limit of 2, and proves +2", async () => {
  const runtime = harness({ walmartJob: true, jobQuantity: 3, quantityPlan: { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 },
    raiseResult: { ok: true, reason: "quantity_set", quantity: 2, storeLimit: 2 }, cartLineAfterRaise: 2 });
  runtime.fireJobAlarm();
  await Promise.race([runtime.jobCompleted, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `The Walmart quantity job did not complete (${runtime.jobStates.join(",")}).`)), 4_000))]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.jobStates.at(-1), "confirmed", runtime.jobStates.join(","));
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.raiseCalls.map((args) => args[1]))), [{ baselineQuantity: 0, currentQuantity: 1, targetQuantity: 2 }],
    "the line goes from the one the Add put there to the store's limit, never to all three");
  assert.deepEqual(verifyQuantities(runtime, "verifyWalmartAddedCart"), [1, 2], "the add is proven, then the raised total");
  const evidence = confirmedEvidence(runtime);
  assert.equal(evidence?.quantity, 2);
  assert.equal(evidence?.requestedQuantity, 3);
  assert.equal(evidence?.storeLimit, 2);
  assert.equal(evidence?.quantityRaiseReason, undefined);
});

test("an Amazon plan for 2 sets the quantity on the page and proves +2 from one Add", async () => {
  const runtime = harness({ amazonJob: true, jobQuantity: 2, quantityPlan: { requested: 2, storeLimit: 30, add: 2, raiseTo: 2 } });
  runtime.fireJobAlarm();
  await Promise.race([runtime.jobCompleted, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `The Amazon quantity job did not complete (${runtime.jobStates.join(",")}).`)), 4_000))]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.jobStates.at(-1), "confirmed", runtime.jobStates.join(","));
  assert.deepEqual(verifyQuantities(runtime, "verifyAmazonAddedCart"), [2]);
  assert.equal(runtime.raiseCalls.length, 0, "nothing to raise");
  assert.deepEqual([confirmedEvidence(runtime)?.quantity, confirmedEvidence(runtime)?.requestedQuantity], [2, 2]);
});

test("a cart line that can't be raised keeps the proven add and says why", async () => {
  const runtime = harness({ walmartJob: true, jobQuantity: 3, quantityPlan: { requested: 3, storeLimit: null, add: 1, raiseTo: 3 },
    raiseResult: { ok: false, reason: "quantity_control_unavailable" } });
  runtime.fireJobAlarm();
  await Promise.race([runtime.jobCompleted, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `The unraisable job did not complete (${runtime.jobStates.join(",")}).`)), 4_000))]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.jobStates.at(-1), "confirmed", runtime.jobStates.join(","));
  assert.deepEqual(verifyQuantities(runtime, "verifyWalmartAddedCart"), [1], "nothing on the cart page changed, so the first proof stands");
  const evidence = confirmedEvidence(runtime);
  assert.deepEqual([evidence?.quantity, evidence?.requestedQuantity, evidence?.quantityRaiseReason], [1, 3, "quantity_control_unavailable"]);
});

test("a raise the store didn't keep is counted from the reloaded cart, not from the field Yoink set", async () => {
  const runtime = harness({ walmartJob: true, jobQuantity: 3, quantityPlan: { requested: 3, storeLimit: null, add: 1, raiseTo: 3 },
    raiseResult: { ok: true, reason: "quantity_set", quantity: 3 }, cartLineAfterRaise: 1 });
  runtime.fireJobAlarm();
  await Promise.race([runtime.jobCompleted, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `The unkept raise did not complete (${runtime.jobStates.join(",")}).`)), 6_000))]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.jobStates.at(-1), "confirmed", runtime.jobStates.join(","));
  assert.ok(runtime.tabUpdates.some((update) => update.url === "https://www.walmart.com/cart"), "the cart is loaded again before counting");
  const evidence = confirmedEvidence(runtime);
  assert.deepEqual([evidence?.quantity, evidence?.requestedQuantity, evidence?.quantityRaiseReason], [1, 3, "quantity_unconfirmed"]);
});

test("a raised line that ends above the plan is never reported as added", async () => {
  const runtime = harness({ walmartJob: true, jobQuantity: 3, quantityPlan: { requested: 3, storeLimit: 2, add: 1, raiseTo: 2 },
    raiseResult: { ok: true, reason: "quantity_set", quantity: 2 }, cartLineAfterRaise: 4 });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("manual_review"),
    `The over-raised cart was not stopped (${runtime.jobStates.join(",")}).`, 4_000);
  assert.equal(runtime.jobStates.includes("confirmed"), false);
});

/** The job event a stop was reported with (state, reason and evidence). */
function reportedEvent(runtime: ReturnType<typeof harness>, state: string): { reasonCode?: string; evidence?: Record<string, unknown> } | undefined {
  for (const call of runtime.fetchCalls) {
    if (!/\/events(?:\/batch)?$/.test(call.url) || typeof call.options?.body !== "string") continue;
    const body = JSON.parse(call.options.body) as { state?: string; events?: Array<{ state: string }> };
    const events = (Array.isArray(body.events) ? body.events : [body]) as Array<{ state?: string; reasonCode?: string; evidence?: Record<string, unknown> }>;
    const found = events.find((event) => event.state === state);
    if (found) return found;
  }
  return undefined;
}

// Kevin's NeeDoh (2026-10-12): called again 90 min after Yoink added it, and
// the second add stacked on the first. A plan's quantity is what the cart holds.
test("a call for an item the cart already holds adds nothing and opens checkout in the job's tab", async () => {
  const runtime = harness({ amazonJob: true, jobQuantity: 1, skuInCart: 1 });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("cancelled"), `The full cart was not handed off (${runtime.jobStates.join(",")}).`, 4_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const operations = runtime.injections.map((entry) => String((entry.args as unknown[] | undefined)?.[0] ?? ""));
  assert.equal(operations.some((operation) => /^(?:prepare|commit)AmazonAdd$|^selectAmazonOwnOffer$/.test(operation)), false, "no product page step, no Add");
  assert.equal(runtime.tabUrls().some((url) => url.includes("/dp/")), false, "the product page never opened");
  const checkout = runtime.tabUpdates.find((update) => update.url === "https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed");
  assert.ok(checkout, "the job's tab moved on to checkout");
  assert.equal(checkout.active, true);
  assert.equal(runtime.tabCreates.length, 1, "one tab: the cart it read, now checkout");
  const event = reportedEvent(runtime, "cancelled");
  assert.equal(event?.reasonCode, "already_in_cart");
  assert.deepEqual([event?.evidence?.cartQuantityBefore, event?.evidence?.requestedQuantity], [1, 1]);
  assert.deepEqual(runtime.shownNotifications.map((entry) => entry.id), [], "nothing was added, so nothing alerts");
});

// TrackaLacker re-calls an item every hour or so while it stays in stock; a
// checkout an earlier add opened, and the shopper hasn't left, is the one tab.
for (const [name, url, reused] of [
  ["a repeat call for an item already in the cart brings back the checkout an earlier add opened",
    "https://www.amazon.com/checkout/p/p-106-0000000-0000000/spc?pipelineType=Chewbacca", true],
  ["a repeat call opens checkout in its own tab once the earlier checkout tab has moved on",
    "https://www.amazon.com/dp/B0GRSZ5TDC", false]
] as const) {
  test(name, async () => {
    const runtime = harness({ amazonJob: true, jobQuantity: 1, skuInCart: 1, activeUrl: url });
    runtime.storage.yoinkCartReadyV1 = { schemaVersion: 1, items: [{
      schemaVersion: 1, kind: "cart_ready", jobId: "job_amazon_earlier", retailerId: "amazon", retailerSku: "B0GYTRYV7P",
      tabId: 17, recordedAt: new Date(Date.now() - 90 * 60_000).toISOString()
    }] };
    runtime.fireJobAlarm();
    await waitFor(() => runtime.jobStates.includes("cancelled"), `The full cart was not handed off (${runtime.jobStates.join(",")}).`, 4_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(reportedEvent(runtime, "cancelled")?.reasonCode, "already_in_cart");
    assert.equal(runtime.tabCreates.length, 1, "one tab for the job: the cart it read");
    const jobTab = runtime.tabCreates[0]!.id;
    const toCheckout = runtime.tabUpdates.filter((update) => update.url?.startsWith("https://www.amazon.com/checkout/entry/cart"));
    assert.equal(runtime.tabRemovals.includes(17), false, "the shopper's tab is never closed");
    assert.equal(runtime.tabUpdates.some((update) => update.id === 17 && update.url), false, "nor moved");
    if (reused) {
      assert.deepEqual(toCheckout, [], "no second checkout");
      assert.ok(runtime.tabRemovals.includes(jobTab), "the job's tab closes");
      assert.ok(runtime.tabUpdates.some((update) => update.id === 17 && update.active === true), "the open checkout comes forward");
    } else {
      assert.deepEqual(toCheckout.map((update) => [update.id, update.active]), [[jobTab, true]]);
      assert.equal(runtime.tabRemovals.includes(jobTab), false);
    }
  });
}

test("a call for an item partly in the cart adds only what the plan is missing", async () => {
  const runtime = harness({ walmartJob: true, jobQuantity: 3, skuInCart: 1, quantityPlan: { requested: 2, storeLimit: null, add: 1, raiseTo: 2 },
    raiseResult: { ok: true, reason: "quantity_set", quantity: 3 }, cartLineAfterRaise: 3 });
  runtime.fireJobAlarm();
  await Promise.race([runtime.jobCompleted, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `The top-up job did not complete (${runtime.jobStates.join(",")}).`)), 4_000))]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.jobStates.at(-1), "confirmed", runtime.jobStates.join(","));
  assert.deepEqual(verifyQuantities(runtime, "prepareWalmartAdd"), [2], "the page is asked for 2 of the 3, one being in the cart");
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.raiseCalls.map((args) => args[1]))), [{ baselineQuantity: 1, currentQuantity: 2, targetQuantity: 3 }]);
  const evidence = confirmedEvidence(runtime);
  assert.deepEqual([evidence?.quantity, evidence?.requestedQuantity, evidence?.cartQuantityBefore], [2, 3, 1]);
});

test("a cart already at the store's limit adds nothing more and opens checkout", async () => {
  const runtime = harness({ walmartJob: true, jobQuantity: 3, skuInCart: 2, quantityPlan: { requested: 1, storeLimit: 2, add: 1, raiseTo: 1 } });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("cancelled"), `The limited cart was not handed off (${runtime.jobStates.join(",")}).`, 4_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const operations = runtime.injections.map((entry) => String((entry.args as unknown[] | undefined)?.[0] ?? ""));
  assert.equal(operations.includes("commitWalmartAdd"), false, "no Add past the store's limit");
  assert.ok(runtime.tabUpdates.some((update) => update.url === "https://www.walmart.com/checkout" && update.active === true));
  const event = reportedEvent(runtime, "cancelled");
  assert.equal(event?.reasonCode, "already_in_cart");
  assert.deepEqual([event?.evidence?.cartQuantityBefore, event?.evidence?.requestedQuantity, event?.evidence?.storeLimit], [2, 3, 2]);
});

test("a store limit that leaves less room than the plan is missing reads the page again for just that many", async () => {
  const runtime = harness({ amazonJob: true, jobQuantity: 3, skuInCart: 1, quantityPlan: { requested: 2, storeLimit: 2, add: 2, raiseTo: 2 } });
  runtime.fireJobAlarm();
  await Promise.race([runtime.jobCompleted, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `The limited top-up did not complete (${runtime.jobStates.join(",")}).`)), 4_000))]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.jobStates.at(-1), "confirmed", runtime.jobStates.join(","));
  assert.deepEqual(verifyQuantities(runtime, "prepareAmazonAdd"), [2, 1], "2 missing, but the limit of 2 leaves room for 1");
  assert.deepEqual(verifyQuantities(runtime, "commitAmazonAdd"), [1]);
  const evidence = confirmedEvidence(runtime);
  assert.deepEqual([evidence?.quantity, evidence?.requestedQuantity, evidence?.cartQuantityBefore, evidence?.storeLimit], [1, 3, 1, 2]);
});

test("the companion accepts a quantity only up to 10 and only at the four quantity stores", async () => {
  const runtime = harness();
  const lease = (retailerId: string, quantity: number) => runtime.invokeBackground(`Promise.resolve().then(() => normalizedLeaseJob(${JSON.stringify({ job: {
    id: "job_quantity_fixture", contractVersion: 1, adapterVersion: retailerId === "walmart" ? "walmart-add-v10" : "pokemoncenter-add-v1",
    action: "add_to_cart", quantity, retailerId,
    retailerSku: retailerId === "walmart" ? "17354421975" : "290-80180",
    canonicalUrl: retailerId === "walmart" ? "https://www.walmart.com/ip/17354421975" : "https://www.pokemoncenter.com/product/290-80180/fixture",
    capabilityToken: "Q".repeat(43), maxUnitPriceCents: 4499, maxOrderTotalCents: 20000, currency: "USD",
    sellerPolicy: "first_party_only", expectedSeller: "", fulfillment: "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    officialMsrp: { version: 1, retailerId, retailerSku: "17354421975", unitPriceCents: 4499, msrpCents: 4499 }
  } })})).then((job) => job.runnerJob.quantity, (error) => "refused: " + error.message)`);
  assert.equal(await lease("walmart", 3), 3);
  assert.match(String(await lease("walmart", 11)), /^refused/);
  assert.match(String(await lease("pokemoncenter", 2)), /^refused/);
});

test("successful adapter diagnostics do not delay the guarded add hot path", async () => {
  const runtime = harness({ walmartJob: true, adapterDiagnosticDelayMs: 750 });
  const startedAt = Date.now();
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.jobCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("The guarded add waited for diagnostic delivery.")), 650))
  ]);
  assert.ok(Date.now() - startedAt < 650);
  assert.equal(runtime.jobStates.at(-1), "confirmed");
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
  assert.equal(operations.filter((operation) => operation === "inspectAmazonCartBaseline").length, 1);
  // Amazon's own offer is opened first when another seller is featured (Kevin's Test call, 2026-10-11).
  assert.equal(operations.filter((operation) => operation === "selectAmazonOwnOffer").length, 1);
  assert.ok(operations.indexOf("selectAmazonOwnOffer") < operations.indexOf("prepareAmazonAdd"));
  assert.equal(operations.filter((operation) => operation === "prepareAmazonAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "commitAmazonAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyAmazonAddedCart").length, 1);
  // The verified cart hands off on checkout, where the shopper places the order (Kevin, 2026-10-08).
  assert.ok(runtime.tabUrls().includes("https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed"), runtime.tabUrls().join(","));
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
});

test("Amazon's own offer over the max stops the add before the offer check", async () => {
  const runtime = harness({ amazonJob: true, amazonOwnOffer: { ok: false, reason: "over_unit_cap", selectionClicked: false } });
  runtime.fireJobAlarm();
  await waitFor(() => runtime.jobStates.includes("offer_rejected"), `Amazon's over-max offer was not refused (${runtime.jobStates.join(",")}).`);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.includes("prepareAmazonAdd"), false);
  assert.equal(operations.includes("commitAmazonAdd"), false);
  assert.ok(jobEvents(runtime).some((event) => event.state === "offer_rejected" && event.reasonCode === "over_unit_cap"));
});

test("a call's job adds at the store's price at or under the max; a cart over the max is never reported as added", async () => {
  // Kevin, 2026-10-11: "it should just be max". The fixture cart shows $44.99.
  for (const options of [{ jobTestCall: true }, {}]) {
    const underMax = harness({ walmartJob: true, jobMaxUnitPriceCents: 4600, ...options });
    underMax.fireJobAlarm();
    await waitFor(() => underMax.jobStates.includes("confirmed"), `$44.99 under a $46.00 max did not finish (${underMax.jobStates.join(",")}).`, 4_000);
  }
  const overMax = harness({ walmartJob: true, jobMaxUnitPriceCents: 4400 });
  overMax.fireJobAlarm();
  await waitFor(() => overMax.jobStates.includes("manual_review"), `A cart over the max was not stopped (${overMax.jobStates.join(",")}).`, 4_000);
  assert.equal(overMax.jobStates.includes("confirmed"), false);
  assert.ok(jobEvents(overMax).some((event) => event.state === "manual_review" && event.reasonCode === "cart_unverified"));
});

function jobEvents(runtime: ReturnType<typeof harness>): Array<{ state?: string; reasonCode?: string }> {
  return runtime.fetchCalls.filter((entry) => /\/devices\/self\/jobs\/[^/]+\/events$/.test(entry.url))
    .map((entry) => JSON.parse(String(entry.options.body)) as { state?: string; reasonCode?: string });
}

test("a Best Buy page that names only its product code counts as loaded; the runner proves the SKU on the page", async () => {
  // Kevin, 2026-10-11: Best Buy's product pages live at /product/<name>/<code>, with no SKU in the URL.
  const runtime = harness({ permission: true });
  const wait = (fn: string, retailerId: string, sku: string, url: string) => runtime.invokeBackground(`(async () => {
    chrome.tabs.get = async (id) => ({ id, url: ${JSON.stringify(url)}, status: "complete" });
    try { return (await ${fn}(41, ${JSON.stringify(retailerId)}, ${JSON.stringify(sku)}, 40)).url; } catch { return "timeout"; }
  })()`);
  const codeOnly = "https://www.bestbuy.com/product/lorcana-playmat/CJ6QGKQ8QQ";
  for (const fn of ["waitForTab", "waitForExactProductTab"]) {
    assert.equal(await wait(fn, "bestbuy", "6588149", codeOnly), codeOnly, fn);
    assert.equal(await wait(fn, "bestbuy", "6588149", `${codeOnly}/sku/6588150`), "timeout", `${fn}: a page naming another SKU`);
    assert.equal(await wait(fn, "bestbuy", "6588149", "https://www.bestbuy.com/site/searchpage.jsp?st=lorcana"), "timeout", `${fn}: a search page`);
    assert.equal(await wait(fn, "walmart", "17354421975", "https://www.walmart.com/ip/other-thing/99999"), "timeout", `${fn}: Walmart still needs its item number`);
  }
});

test("the service worker runs one leased Best Buy add through its own baseline and exact-cart delta proof", async () => {
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
  assert.equal(operations.filter((operation) => operation === "inspectBestBuyCartBaseline").length, 1);
  assert.equal(operations.filter((operation) => operation === "prepareBestBuyAdd").length, 1);
  assert.ok(operations.indexOf("selectBestBuyShipping") < operations.indexOf("prepareBestBuyAdd"));
  assert.equal(operations.filter((operation) => operation === "commitBestBuyAdd").length, 1);
  assert.equal(operations.filter((operation) => operation === "verifyBestBuyAddedCart").length, 1);
  // The verified cart hands off on checkout, where the shopper places the order (Kevin, 2026-10-08).
  assert.ok(runtime.tabUrls().includes("https://www.bestbuy.com/checkout/r/fast-track"), runtime.tabUrls().join(","));
  assert.equal("activeRetailerJobV1" in runtime.storage, false);
});

test("Best Buy waits in its original queue tab and verifies a separate cart after the queue clears", async () => {
  const options: HarnessOptions = { bestBuyJob: true, bestBuyPostAddStates: ["queue"], queuedJobCount: 2 };
  const runtime = harness(options);
  try {
    await runtime.invokeBackground("runJobCycle()");
    const active = runtime.storage.activeRetailerJobV1 as any;
    const originalTabId = active.tabId;
    assert.equal(active.phase, "adding");
    assert.equal(active.postAddWaitReason, "bestbuy_queue_waiting");
    assert.equal(runtime.badgeTexts.at(-1), "WAIT");
    assert.equal((runtime.storage.yoinkBestBuyWaitV1 as any).clicked, true);
    // A wait Yoink can finish by itself stays in the badge and popup, without a Windows alert.
    assert.equal(runtime.shownNotifications.some(n => n.id.startsWith("yoink-bestbuy-wait:")), false);
    assert.ok(runtime.storage.yoinkBestBuyPostAddV1);
    assert.equal(runtime.injections.some(i => (i.args as any[])?.[0] === "verifyBestBuyAddedCart"), false);
    assert.equal(runtime.jobStates.includes("confirmed"), false);
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.shownNotifications.filter(n => n.id.startsWith("yoink-bestbuy-wait:")).length, 0);
    await runtime.invokeBackground("showBadge({ connected: true, paired: true })");
    assert.equal(runtime.badgeTexts.at(-1), "WAIT", "A health refresh must not erase a live wait alert.");
    assert.equal(runtime.jobLeaseRequests(), 1);
    await runtime.invokeBackground('focusBestBuyWait("job_bestbuy_fixture")');
    await waitFor(() => runtime.tabUpdates.some(t => t.id === originalTabId && t.active === true), "The popup's wait did not focus its original tab.");
    assert.equal(runtime.tabUpdates.some(t => t.id === originalTabId && t.url === "https://www.bestbuy.com/cart"), false);
    options.bestBuyPostAddStates = ["product"];
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.jobStates.includes("confirmed"), true);
    const cartReady = (runtime.storage.yoinkCartReadyV1 as any).items[0];
    // Kevin, 2026-10-11: checkout opens in the original tab; the separate cart tab closes.
    assert.equal(cartReady.tabId, originalTabId);
    const cartTab = runtime.tabCreates.find(t => t.id !== originalTabId && t.url === "https://www.bestbuy.com/cart");
    assert.ok(cartTab && runtime.tabRemovals.includes(cartTab.id), JSON.stringify(runtime.tabCreates));
    assert.ok(runtime.tabUpdates.some(t => t.id === originalTabId && t.url === "https://www.bestbuy.com/checkout/r/fast-track" && t.active === true));
    assert.equal(runtime.tabUpdates.some(t => t.id === originalTabId && t.url === "https://www.bestbuy.com/cart"), false);
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
    assert.equal(runtime.storage.yoinkBestBuyPostAddV1, undefined);
    assert.equal(runtime.storage.yoinkBestBuyWaitV1, undefined);
    assert.equal(runtime.badgeTexts.at(-1), "1");
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("Best Buy manual verification alerts persist without another Add and transition to a verified cart", async () => {
  const options: HarnessOptions = { bestBuyJob: true, bestBuyPostAddStates: ["queue"] };
  const runtime = harness(options);
  try {
    await runtime.invokeBackground("runJobCycle()");
    await runtime.invokeBackground("(async () => { const a = await activeJob(); (await chrome.tabs.get(a.tabId)).status = 'loading'; })()");
    options.bestBuyPostAddStates = ["user_action"];
    await runtime.invokeBackground("runJobCycle()");
    const wait = runtime.storage.yoinkBestBuyWaitV1 as any;
    assert.equal(wait.needsAction, true);
    assert.equal(runtime.badgeTexts.at(-1), "!");
    assert.equal(runtime.jobStates.includes("confirmed"), false);
    const alert = runtime.shownNotifications.find(n => n.options.title === "Best Buy needs you")!;
    assert.match(String(alert.options.message), /SMS code/);
    assert.equal(alert.options.requireInteraction, true);
    assert.equal(runtime.storage.yoinkCartReadyV1, undefined);
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.shownNotifications.filter(n => n.options.title === "Best Buy needs you").length, 1);
    const tabId = (runtime.storage.activeRetailerJobV1 as any).tabId;
    const opened = await runtime.invokeBackground('focusBestBuyWait("job_bestbuy_fixture")') as any;
    assert.equal(opened.opened, true);
    assert.ok(runtime.tabUpdates.some(t => t.id === tabId && t.active === true));
    // Its only navigation was to the product page before the Add: never to the cart or checkout while waiting.
    assert.equal(runtime.tabUpdates.some(t => t.id === tabId && /\/(?:cart|checkout)/.test(String(t.url || ""))), false);
    await runtime.invokeBackground("(async () => { const a = await activeJob(); (await chrome.tabs.get(a.tabId)).status = 'complete'; })()");
    options.bestBuyPostAddStates = ["product"];
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.jobStates.includes("confirmed"), true);
    assert.equal(runtime.storage.yoinkBestBuyWaitV1, undefined);
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("Best Buy keeps a popup and badge alert when desktop notifications fail and rejects a changed waiting tab", async () => {
  const runtime = harness({ bestBuyJob: true, bestBuyPostAddStates: ["user_action"], bestBuyNotificationFails: true });
  try {
    await runtime.invokeBackground("runJobCycle()");
    assert.equal((runtime.storage.yoinkBestBuyWaitV1 as any).needsAction, true);
    assert.equal(runtime.badgeTexts.at(-1), "!");
    assert.equal(runtime.jobStates.includes("manual_review"), false);
    assert.equal(runtime.jobStates.includes("confirmed"), false);
    const active = runtime.storage.activeRetailerJobV1 as any;
    runtime.fireTabUpdated(active.tabId, "https://example.com/");
    const updates = runtime.tabUpdates.length;
    await assert.rejects(runtime.invokeBackground('focusBestBuyWait("job_bestbuy_fixture")'), /closed or changed/);
    assert.equal(runtime.tabUpdates.length, updates);
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("a late Best Buy queue after cart inspection cannot report success or navigate the product tab", async () => {
  const options: HarnessOptions = { bestBuyJob: true, bestBuyPostAddStates: ["product", "queue"] };
  const runtime = harness(options);
  try {
    await runtime.invokeBackground("runJobCycle()");
    const active = runtime.storage.activeRetailerJobV1 as any;
    assert.equal(active.postAddWaitReason, "bestbuy_queue_waiting");
    assert.equal(runtime.jobStates.includes("confirmed"), false);
    assert.equal(runtime.tabUpdates.some(t => t.id === active.tabId && t.url === "https://www.bestbuy.com/cart"), false);
    options.bestBuyPostAddStates = ["product"];
    await runtime.invokeBackground("(async () => { const a = await activeJob(); a.lastCartCheckAt = 0; await saveActiveJob(a); })()");
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.jobStates.includes("confirmed"), true);
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("Best Buy keeps admission steps manual and an unchanged cart pending until an exact delta arrives", async () => {
  const options: HarnessOptions = { bestBuyJob: true, bestBuyPostAddStates: ["queue"], bestBuyPendingCart: true };
  const runtime = harness(options);
  try {
    await runtime.invokeBackground("runJobCycle()");
    options.bestBuyPostAddStates = ["product"];
    await runtime.invokeBackground("runJobCycle()");
    assert.equal((runtime.storage.activeRetailerJobV1 as any).postAddWaitReason, "bestbuy_queue_next_step");
    assert.equal(runtime.jobStates.includes("manual_review"), false);
    assert.equal(runtime.jobStates.includes("confirmed"), false);
    assert.ok(runtime.shownNotifications.some(n => n.options.title === "Best Buy needs you"));
    options.bestBuyPendingCart = false;
    await runtime.invokeBackground("(async () => { const a = await activeJob(); a.lastCartCheckAt = 0; await saveActiveJob(a); })()");
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.jobStates.includes("confirmed"), true);
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("Best Buy queue deadlines, changed access, lost leases and cart conflicts hand off without a second Add", async () => {
  for (const failure of ["deadline", "tab_closed", "conflicting_cart", "evidence_expired", "permission_lost", "page_changed", "heartbeat_failed"] as const) {
    const options: HarnessOptions = { bestBuyJob: true, bestBuyPostAddStates: ["queue"] };
    const runtime = harness(options);
    try {
      await runtime.invokeBackground("runJobCycle()");
      const originalTabId = (runtime.storage.activeRetailerJobV1 as any).tabId;
      if (failure === "deadline") await runtime.invokeBackground("(async () => { const a = await activeJob(); a.runnerJob.expiresAt = new Date(0).toISOString(); await saveActiveJob(a); })()");
      if (failure === "evidence_expired") await runtime.invokeBackground("(async () => { const a = await activeJob(); a.cartBaseline.observedAt = new Date(0).toISOString(); await saveActiveJob(a); })()");
      if (failure === "tab_closed") runtime.closeTab(originalTabId);
      if (failure === "permission_lost") options.permission = false;
      if (failure === "page_changed") runtime.fireTabUpdated(originalTabId, "https://example.com/");
      if (failure === "heartbeat_failed") {
        options.jobHeartbeatFails = true;
        await runtime.invokeBackground("(async () => { const a = await activeJob(); a.postAddHeartbeatAt = 0; await saveActiveJob(a); })()");
      }
      if (failure === "conflicting_cart") { options.bestBuyPostAddStates = ["product"]; options.bestBuyConflictingCart = true; }
      await runtime.invokeBackground("runJobCycle()");
      assert.equal(runtime.jobStates.includes("manual_review"), true, failure);
      assert.equal(runtime.jobStates.includes("confirmed"), false, failure);
      assert.equal(runtime.storage.yoinkBestBuyPostAddV1, undefined, failure);
      assert.equal(runtime.storage.yoinkBestBuyWaitV1, undefined, failure);
      assert.equal(runtime.tabUpdates.some(t => t.id === originalTabId && t.url === "https://www.bestbuy.com/cart"), false, failure);
      assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1, failure);
    } finally { await runtime.invokeBackground("clearActiveJob()"); }
  }
});

test("Best Buy preserves a queue in the verification tab, including a queue redirect, until it returns to cart", async () => {
  const options: HarnessOptions = { bestBuyJob: true, bestBuyCartQueue: true };
  const runtime = harness(options);
  try {
    await runtime.invokeBackground("runJobCycle()");
    const active = runtime.storage.activeRetailerJobV1 as any;
    const cartTabId = active.verificationTabId;
    assert.equal(active.waitingTabId, cartTabId);
    assert.equal(active.postAddWaitReason, "bestbuy_queue_waiting");
    assert.equal(runtime.jobStates.includes("confirmed"), false);
    assert.equal(runtime.injections.some(i => (i.args as any[])?.[0] === "verifyBestBuyAddedCart"), false);
    runtime.fireTabUpdated(cartTabId, "https://www.bestbuy.com/qp");
    const updates = runtime.tabUpdates.length;
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.tabUpdates.length, updates);
    runtime.clickNotification("yoink-bestbuy-wait:job_bestbuy_fixture");
    await waitFor(() => runtime.tabUpdates.some(t => t.id === cartTabId && t.active === true), "Queue handoff did not focus the waiting cart tab.");
    options.bestBuyCartQueue = false;
    runtime.fireTabUpdated(cartTabId, "https://www.bestbuy.com/cart");
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.jobStates.includes("confirmed"), true);
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("Best Buy recovers a durable post-Add queue receipt after a worker restart without reusing authorization", async () => {
  const options: HarnessOptions = { bestBuyJob: true, bestBuyPostAddStates: ["queue"], bestBuyCommitNavigation: true };
  const runtime = harness(options);
  try {
    await runtime.invokeBackground("runJobCycle()");
    const saved = runtime.storage.yoinkBestBuyPostAddV1 as any;
    assert.equal(saved.phase, "adding");
    assert.equal(saved.authorizationId, "");
    assert.equal((runtime.storage.yoinkBestBuyWaitV1 as any).clicked, false);
    assert.equal(runtime.shownNotifications.some(n => n.options.title === "Best Buy Add triggered"), false);
    assert.equal((runtime.storage.activeRetailerJobV1 as any).postAddWaitReason, "bestbuy_queue_waiting");
    await runtime.invokeBackground("(async () => { clearTimeout(bestBuyPostAddTimer); await chrome.storage.session.remove(ACTIVE_JOB_KEY); })()");
    await runtime.invokeBackground("runJobCycle()");
    assert.equal((runtime.storage.activeRetailerJobV1 as any).phase, "adding");
    assert.equal(runtime.injections.filter(i => (i.args as any[])?.[0] === "commitBestBuyAdd").length, 1);
    assert.equal(runtime.jobStates.includes("manual_review"), false);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("a full browser restart preserves Best Buy's no-repeat receipt without trusting old tab IDs", async () => {
  const runtime = harness({ bestBuyJob: true, bestBuyPostAddStates: ["queue"] });
  try {
    await runtime.invokeBackground("runJobCycle()");
    const beforeInjections = runtime.injections.length;
    const beforeUpdates = runtime.tabUpdates.length;
    await runtime.invokeBackground("(async () => { clearTimeout(bestBuyPostAddTimer); await chrome.storage.session.remove(ACTIVE_JOB_KEY); await chrome.storage.session.remove(BESTBUY_BROWSER_SESSION_KEY); })()");
    await runtime.invokeBackground("runJobCycle()");
    assert.equal(runtime.injections.length, beforeInjections);
    assert.equal(runtime.tabUpdates.length, beforeUpdates);
    assert.equal(runtime.jobStates.includes("manual_review"), true);
    assert.equal(runtime.jobLeaseRequests(), 1);
    const notice = runtime.shownNotifications.find(n => n.options.title === "Review Best Buy add");
    assert.match(String(notice?.options.message), /Chrome restarted after Add/);
    assert.equal(runtime.storage.yoinkBestBuyPostAddV1, undefined);
  } finally { await runtime.invokeBackground("clearActiveJob()"); }
});

test("a cold worker cancels pre-boundary work without clicking", async () => {
  const runtime = harness({ liveJob: true, activeJob: "pre_boundary" });
  runtime.fireStartup();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(runtime.jobStates, ["cancelled"]);
  assert.equal(runtime.injections.some((entry) => (entry.args as unknown[] | undefined)?.[0] === "commitTargetAdd"), false);
  assert.equal(reportedEvent(runtime, "cancelled")?.reasonCode, "worker_restarted_before_add");
  assert.deepEqual(runtime.shownNotifications.map((entry) => entry.id), [], "nothing was added, so nothing alerts");
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

test("worker recovery reuses the saved verification cart without repeating Add", async () => {
  const runtime = harness({liveJob:true,activeJob:"post_boundary"});
  const cartId = await runtime.invokeBackground(`(async () => {
    const active = await activeJob();
    const cart = await chrome.tabs.create({url: ADD_LANES.target.cartUrl, active: false});
    active.verificationTabId = cart.id;
    await saveActiveJob(active);
    return cart.id;
  })()`);
  const before = runtime.tabCreates.length;
  runtime.fireStartup();
  await runtime.jobCompleted;
  assert.equal(runtime.tabCreates.length,before);
  const verification = runtime.injections.find(i=>(i.args as unknown[] | undefined)?.[0]==="verifyTargetAddedCart");
  assert.equal((verification?.target as {tabId:number}).tabId,cartId);
  assert.equal(runtime.injections.some(i=>(i.args as unknown[] | undefined)?.[0]==="commitTargetAdd"),false);
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

test("a retryable signal receipt is retained without blocking later batch items", async () => {
  const runtime = harness({
    queuedTrackalackerSignal: true,
    trackalackerBatchReceipts: [[
      { accepted: false, retryable: true, errorCode: "storage_temporarily_unavailable" },
      { accepted: false, retryable: false, errorCode: "invalid_signal" },
      { accepted: true }
    ]]
  });
  const initial = (runtime.storage.yoinkTrackalackerPushQueueV1 as Array<Record<string, unknown>>)[0]!;
  const notification = initial.notification as Record<string, unknown>;
  runtime.storage.yoinkTrackalackerPushQueueV1 = [
    { ...initial, signalId: "push:trackalacker:retryable-fixture" },
    { ...initial, signalId: "push:trackalacker:rejected-fixture", notification: { ...notification, sourceListingId: "991123" } },
    { ...initial, signalId: "push:trackalacker:accepted-fixture", notification: { ...notification, sourceListingId: "991124" } }
  ];
  runtime.fireStartup();
  await waitFor(
    () => (runtime.storage.yoinkTrackalackerPushQueueV1 as unknown[]).length === 1,
    "The mixed signal batch did not settle."
  );
  assert.equal(runtime.deliveredTrackalackerSignals.length, 3);
  assert.equal(
    (runtime.storage.yoinkTrackalackerPushQueueV1 as Array<{ signalId: string }>)[0]?.signalId,
    "push:trackalacker:retryable-fixture"
  );
  assert.equal(
    (runtime.storage.yoinkTrackalackerPushStateV1 as { errorCode: string }).errorCode,
    "signal_delivery_retryable"
  );

  runtime.fireHealthAlarm();
  await waitFor(
    () => (runtime.storage.yoinkTrackalackerPushQueueV1 as unknown[]).length === 0,
    "The next delivery cycle did not retry the retained signal."
  );
  assert.equal(runtime.deliveredTrackalackerSignals.length, 4);
  assert.equal(runtime.deliveredTrackalackerSignals.filter(
    (entry) => entry.signalId === "push:trackalacker:retryable-fixture"
  ).length, 2);
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

test("TrackaLacker signal dispatch is not blocked by notification or status reporting", async () => {
  const runtime = harness({
    trackalackerPush: true,
    visibleTrackalackerFallback: true,
    trackalackerNotificationDelayMs: 250,
    trackalackerStatusDelayMs: 250
  });
  const push = runtime.firePush({
    title: "IN STOCK at Target!",
    body: "Runtime Fixture Product\nAvailable for $59.99",
    url: "https://www.trackalacker.com/products/showcase/runtime-fixture?utm_term=138022"
  });
  await waitFor(
    () => runtime.deliveredTrackalackerSignals.length === 1,
    "The signal waited for auxiliary push work.",
    150
  );
  assert.equal(runtime.shownTrackalackerNotifications.length, 0);
  const signalIndex = runtime.fetchCalls.findIndex((entry) => entry.url.endsWith("/sources/trackalacker/signals/batch"));
  const statusIndex = runtime.fetchCalls.findIndex((entry) => entry.url.endsWith("/sources/trackalacker/status"));
  assert.ok(signalIndex >= 0);
  assert.ok(statusIndex > signalIndex);
  await push;
  assert.equal(runtime.shownTrackalackerNotifications.length, 1);
});

test("a notify-only TrackaLacker signal opens an event-driven notification watch without an alarm", async () => {
  const runtime = harness({ trackalackerPush: true, notification: true });
  await runtime.firePush({
    title: "IN STOCK at Target!",
    body: "Runtime Fixture Product\nAvailable for $59.99",
    url: "https://www.trackalacker.com/products/showcase/runtime-fixture?utm_term=138022"
  });
  await waitFor(
    () => runtime.shownNotifications.length === 1,
    "The accepted TrackaLacker signal did not wake durable notification delivery."
  );
  const signalIndex = runtime.fetchCalls.findIndex((entry) =>
    entry.url.endsWith("/devices/self/sources/trackalacker/signals/batch"));
  const notificationIndex = runtime.fetchCalls.findIndex((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next"));
  assert.ok(signalIndex >= 0 && notificationIndex > signalIndex);
  assert.equal(new URL(runtime.fetchCalls[notificationIndex]!.url).searchParams.get("wait"), "25000");
  assert.equal(runtime.shownNotifications[0]?.id, "yoink-opportunity:notification_delivery_fixture");
});

test("an early lease watch never treats a retryable signal receipt as retailer authorization", async () => {
  const runtime = harness({
    trackalackerPush: true,
    trackalackerSignalDelayMs: 100,
    trackalackerBatchReceipts: [[{
      accepted: false,
      retryable: true,
      errorCode: "storage_temporarily_unavailable"
    }]]
  });
  await runtime.firePush({
    title: "IN STOCK at Target!",
    body: "Runtime Fixture Product\nAvailable for $59.99",
    url: "https://www.trackalacker.com/products/showcase/runtime-fixture?utm_term=138022"
  });
  assert.equal(runtime.jobLeaseRequests(), 1);
  assert.equal(runtime.jobStates.length, 0);
  assert.equal(runtime.injections.some(
    (entry) => String((entry.args as unknown[] | undefined)?.[0] || "").startsWith("commit")
  ), false);
  assert.equal((runtime.storage.yoinkTrackalackerPushQueueV1 as unknown[]).length, 1);
  assert.ok(runtime.hotPathTimeline.indexOf("lease:request") < runtime.hotPathTimeline.indexOf("signal:response"));
  assert.equal(runtime.fetchCalls.some((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next")), false);
});

test("a delivered TrackaLacker signal reaches one guarded cart add on every supported store without waiting for the alarm", async () => {
  const fixtures = [
    {
      name: "Target",
      options: { liveJob: true },
      cartUrl: "https://www.target.com/cart",
      handoffUrl: "https://www.target.com/checkout",
      commitOperation: "commitTargetAdd"
    },
    {
      name: "Walmart",
      options: { walmartJob: true },
      cartUrl: "https://www.walmart.com/cart",
      handoffUrl: "https://www.walmart.com/checkout",
      commitOperation: "commitWalmartAdd"
    },
    {
      name: "Amazon",
      options: { amazonJob: true },
      cartUrl: "https://www.amazon.com/gp/cart/view.html",
      handoffUrl: "https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed",
      commitOperation: "commitAmazonAdd"
    },
    {
      name: "Best Buy",
      options: { bestBuyJob: true },
      cartUrl: "https://www.bestbuy.com/cart",
      handoffUrl: "https://www.bestbuy.com/checkout/r/fast-track",
      commitOperation: "commitBestBuyAdd"
    }
  ] as const;
  for (const fixture of fixtures) {
    const runtime = harness({
      ...fixture.options,
      trackalackerPush: true,
      trackalackerSignalDelayMs: 200
    });
    await Promise.race([
      runtime.firePush({
        title: `IN STOCK at ${fixture.name}!`,
        body: "Runtime Fixture Product\nAvailable for $59.99",
        url: "https://www.trackalacker.com/products/showcase/runtime-fixture?utm_term=138022"
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        `${fixture.name} signal action handoff did not complete.`
      )), 7_000))
    ]);
    await waitFor(
      () => runtime.jobStates.includes("confirmed"),
      `${fixture.name} signal-triggered job was not confirmed.`
    );
    assert.equal(runtime.deliveredTrackalackerSignals.length, 1);
    assert.equal(runtime.jobLeaseRequests(), 2);
    const signalDeliveryIndex = runtime.fetchCalls.findIndex((entry) =>
      entry.url.endsWith("/devices/self/sources/trackalacker/signals/batch"));
    const leaseIndex = runtime.fetchCalls.findIndex((entry) =>
      new URL(entry.url).pathname.endsWith("/devices/self/jobs/next"));
    assert.ok(signalDeliveryIndex >= 0 && leaseIndex >= 0);
    assert.ok(runtime.hotPathTimeline.indexOf("lease:request") < runtime.hotPathTimeline.indexOf("signal:response"),
      `${fixture.name} should open its authoritative lease watch before durable signal delivery is acknowledged.`);
    assert.equal(runtime.fetchCalls.slice(0, leaseIndex).some((entry) =>
      entry.url.endsWith("/health") || entry.url.endsWith("/devices/self/heartbeat")), false,
    `${fixture.name} should lease without intervening health or heartbeat requests.`);
    assert.equal(runtime.jobStates.filter((state) => state === "confirmed").length, 1);
    // The verified cart hands off on checkout where a store has one (Kevin, 2026-10-08).
    assert.equal(runtime.tabUrls().filter((url) => url === fixture.handoffUrl).length, 1, runtime.tabUrls().join(","));
    assert.equal(runtime.injections.filter(
      (entry) => (entry.args as unknown[] | undefined)?.[0] === fixture.commitOperation
    ).length, 1);
  }
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

test("the recurring action alarm holds a notification watch for server-originated signals and routes a recorded click", async () => {
  const runtime = harness({ notification: true });
  runtime.fireJobAlarm();
  await Promise.race([
    runtime.notificationCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture notification was not acknowledged.")), 3_000))
  ]);
  const notificationWatch = runtime.fetchCalls.find((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next"));
  assert.ok(notificationWatch);
  assert.equal(new URL(notificationWatch.url).searchParams.get("wait"), "25000");
  assert.equal(runtime.deliveredTrackalackerSignals.length, 0,
    "A provider-originated notification must not require a local TrackaLacker delivery.");
  assert.equal(runtime.shownNotifications.length, 1);
  assert.equal(runtime.shownNotifications[0]?.id, "yoink-opportunity:notification_delivery_fixture");
  assert.equal(runtime.shownNotifications[0]?.options.iconUrl, `chrome-extension://${"a".repeat(32)}/yoink-icon-128.png`);
  assert.equal(JSON.stringify(runtime.storage).includes("N".repeat(43)), false);

  runtime.fireJobAlarm();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runtime.shownNotifications.length, 1);

  runtime.clickNotification("yoink-opportunity:notification_delivery_fixture");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(runtime.notificationInteractions, ["clicked"]);
  assert.ok(runtime.tabUrls().includes(PRODUCT_URL));
});

test("a cold worker opens parallel bounded job and notification watches without a local signal", async () => {
  const runtime = harness({ notification: true });
  runtime.fireStartup();
  await Promise.race([
    runtime.notificationCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      "Cold startup did not establish the notification watch."
    )), 3_000))
  ]);
  const jobWatch = runtime.fetchCalls.find((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/jobs/next"));
  const notificationWatch = runtime.fetchCalls.find((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next"));
  assert.ok(jobWatch);
  assert.ok(notificationWatch);
  assert.equal(new URL(jobWatch.url).searchParams.get("wait"), "25000");
  assert.equal(new URL(notificationWatch.url).searchParams.get("wait"), "25000");
  assert.equal(runtime.deliveredTrackalackerSignals.length, 0);
});

test("a notification click route is durable before Chrome exposes the notification", async () => {
  const runtime = harness({ notification: true, notificationClickDuringCreate: true });
  await runtime.invokeBackground("runNotificationCycle()");
  await waitFor(
    () => runtime.tabUrls().includes(PRODUCT_URL),
    "An immediate notification click raced ahead of its durable route."
  );
  assert.deepEqual(runtime.notificationInteractions, ["clicked"]);
});

function targetNotificationPayload(id: string, title: string): Record<string, unknown> {
  return {
    id,
    capabilityToken: `${id.slice(-1).toUpperCase() || "N"}`.repeat(43),
    title,
    message: "Target at $59.99 matched your strategy.",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: PRODUCT_URL,
    attributionUrl: PRODUCT_URL,
    action: "notify",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

test("one notification cycle drains every ready delivery without waiting for another alarm", async () => {
  const payloads = [1, 2, 3].map((index) => targetNotificationPayload(
    `notification_delivery_fixture_${index}`,
    `Opportunity ${index}`
  ));
  const runtime = harness({ notificationPayloads: payloads });
  const result = await runtime.invokeBackground("runNotificationCycle()") as { delivered: number };
  assert.equal(result.delivered, 3);
  assert.deepEqual(runtime.shownNotifications.map((entry) => entry.id), [
    "yoink-opportunity:notification_delivery_fixture_1",
    "yoink-opportunity:notification_delivery_fixture_2",
    "yoink-opportunity:notification_delivery_fixture_3"
  ]);
  assert.equal(runtime.fetchCalls.filter((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next")).length, 4);
  assert.equal(Object.keys(runtime.storage.yoinkNotificationRoutesV1 as Record<string, unknown>).length, 3);
  await runtime.invokeBackground("runNotificationCycle()");
  assert.equal(runtime.shownNotifications.length, 3);
});

test("a call Yoink marks quiet is taken in without a Windows alert; a test alert still shows", async () => {
  // Kevin, 2026-10-13: "I don't need an alert/notification if a signal does not
  // meet criteria. It should still log it and display the information on the
  // dashboard, however windows notification is not needed."
  const call = { ...targetNotificationPayload("notification_delivery_call", "Pokemon Elite Trainer Box"), alert: false };
  const testAlert = { ...targetNotificationPayload("notification_delivery_test", "Test alert \u00b7 Pokemon Elite Trainer Box"), alert: true };
  const runtime = harness({ notificationPayloads: [call, testAlert] });
  const result = await runtime.invokeBackground("runNotificationCycle()") as { delivered: number };
  assert.equal(result.delivered, 2);
  assert.deepEqual(runtime.shownNotifications.map((entry) => entry.id), ["yoink-opportunity:notification_delivery_test"]);
  const acks = runtime.fetchCalls.filter((entry) => /\/devices\/self\/notifications\/[^/]+\/ack$/.test(new URL(entry.url).pathname))
    .map((entry) => [new URL(entry.url).pathname.split("/").at(-2), JSON.parse(String(entry.options.body)).outcome]);
  assert.deepEqual(acks, [["notification_delivery_call", "delivered"], ["notification_delivery_test", "delivered"]]);
  // The quiet call keeps its route for the popup.
  assert.deepEqual(Object.keys(runtime.storage.yoinkNotificationRoutesV1 as Record<string, unknown>).sort(),
    ["notification_delivery_call", "notification_delivery_test"]);
});

test("an event-driven notification request coalesces behind an active cycle and preserves its wait", async () => {
  const runtime = harness({ notification: true });
  const result = await runtime.invokeBackground(
    "Promise.all([runNotificationCycle(0), runNotificationCycle(25000)])"
  ) as Array<{ delivered: number }>;
  assert.equal(result[0]?.delivered, 1);
  assert.equal(result[1]?.delivered, 1);
  assert.equal(runtime.shownNotifications.length, 1);
  const waits = runtime.fetchCalls.filter((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next"))
    .map((entry) => new URL(entry.url).searchParams.get("wait"));
  assert.ok(waits.includes("25000"));
});

function walmartNotificationPayload(destinationUrl: string, expiresAt: string): Record<string, unknown> {
  const walmartItemId = "17354421975";
  const directFallbackUrl = `https://www.walmart.com/affil/cart/reviewOrder?items=${walmartItemId}&cn=nc&veh=aff`;
  return {
    id: "notification_delivery_fixture",
    capabilityToken: "N".repeat(43),
    title: "Walmart fixture opportunity",
    message: "Walmart · $84.97 · notify",
    retailerId: "walmart",
    retailerSku: walmartItemId,
    canonicalUrl: WALMART_PRODUCT_URL,
    attributionUrl: WALMART_PRODUCT_URL,
    action: "notify",
    expiresAt,
    purchaseHandoff: {
      kind: "walmart_review_order",
      walmartItemId,
      destinationUrl,
      directFallbackUrl,
      pdpFallbackUrl: `https://www.walmart.com/ip/${walmartItemId}`,
      trackingId: `walmart_${walmartItemId}`,
      expiresAt
    }
  };
}

test("a qualified Walmart notification click opens the exact Howl-wrapped review-order route", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const howlRoute = new URL("https://howl.link/link");
  howlRoute.searchParams.set("url", directRoute);
  howlRoute.searchParams.set("publisher_slug", "collectwithdodo");
  howlRoute.searchParams.set("article_name", "Walmart fixture opportunity");
  howlRoute.searchParams.set("article_url", "https://yoink.example/alerts/walmart-fixture");
  howlRoute.searchParams.set("u1", "walmart_17354421975");
  const runtime = harness({
    notificationPayload: walmartNotificationPayload(howlRoute.href, expiresAt)
  });
  runtime.fireJobAlarm();
  await runtime.notificationCompleted;
  assert.equal(runtime.shownNotifications[0]?.options.contextMessage, "Buy at Walmart · opens cart");
  runtime.clickNotification("yoink-opportunity:notification_delivery_fixture");
  await waitFor(
    () => runtime.tabUrls().includes(howlRoute.href),
    "The Walmart notification did not open its Howl review-order route."
  );
  assert.deepEqual(runtime.notificationInteractions, ["clicked"]);
});

test("the popup can consume one fresh Walmart notification opportunity exactly once", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const runtime = harness({
    notificationPayload: walmartNotificationPayload(directRoute, expiresAt)
  });
  runtime.fireJobAlarm();
  await runtime.notificationCompleted;

  const pending = await runtime.send({ type: "yoink:get-purchase-opportunity" });
  assert.equal(pending.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(pending.opportunity)), {
    schemaVersion: 1,
    deliveryId: "notification_delivery_fixture",
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerName: "Walmart",
    identityLabel: "Item",
    retailerSku: "17354421975",
    title: "Walmart fixture opportunity",
    expiresAt
  });

  const [first, duplicate] = await Promise.all([
    runtime.send({
      type: "yoink:open-purchase-opportunity",
      deliveryId: "notification_delivery_fixture"
    }),
    runtime.send({
      type: "yoink:open-purchase-opportunity",
      deliveryId: "notification_delivery_fixture"
    })
  ]);
  assert.equal(first.ok, true);
  assert.equal(first.opened, true);
  assert.equal(first.opportunity, null);
  assert.equal(duplicate.ok, false);
  assert.equal(runtime.tabUrls().filter((url) => url === directRoute).length, 1,
    "Concurrent popup and notification actions must not open reviewOrder twice.");
  assert.equal(Object.keys(runtime.storage.yoinkNotificationRoutesV1 as Record<string, unknown>).length, 0);
  await waitFor(
    () => runtime.notificationInteractions.length === 1,
    "The consumed popup opportunity did not record its notification interaction."
  );
});

test("dismissing a Walmart notification removes its popup recovery action", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const runtime = harness({
    notificationPayload: walmartNotificationPayload(directRoute, expiresAt)
  });
  runtime.fireJobAlarm();
  await runtime.notificationCompleted;
  assert.ok((await runtime.send({ type: "yoink:get-purchase-opportunity" })).opportunity);

  runtime.closeNotification("yoink-opportunity:notification_delivery_fixture");
  await waitFor(
    () => Object.keys(runtime.storage.yoinkNotificationRoutesV1 as Record<string, unknown>).length === 0,
    "A dismissed notification retained its popup purchase route."
  );
  assert.equal((await runtime.send({ type: "yoink:get-purchase-opportunity" })).opportunity, null);
  assert.equal(runtime.tabUrls().includes(directRoute), false);
});

test("a dashboard-consumed Walmart handoff clears the matching Chrome notification route", async () => {
  const deliveryId = "notification_delivery_dashboard_consumed";
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const runtime = harness({ closedNotificationDeliveryIds: [deliveryId] });
  runtime.storage.yoinkNotificationRoutesV1 = {
    [deliveryId]: {
      kind: "walmart_review_order",
      retailerId: "walmart",
      retailerSku: "17354421975",
      title: "Dashboard-consumed fixture",
      route: directRoute,
      directFallbackRoute: directRoute,
      pdpFallbackRoute: "https://www.walmart.com/ip/17354421975",
      expiresAt
    }
  };

  const result = await runtime.invokeBackground("runNotificationCycle()");
  assert.equal((result as { delivered: number }).delivered, 0);
  assert.deepEqual(runtime.storage.yoinkNotificationRoutesV1, {});
  assert.equal(runtime.clearedNotifications.includes(`yoink-opportunity:${deliveryId}`), true);
  const acknowledgement = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/notifications/closures/ack"));
  assert.ok(acknowledgement);
  assert.deepEqual(JSON.parse(String(acknowledgement.options.body)), {
    contractVersion: 1,
    deliveryIds: [deliveryId]
  });
  assert.equal((await runtime.send({ type: "yoink:get-purchase-opportunity" })).opportunity, null);
  assert.equal(runtime.tabUrls().includes(directRoute), false);
});

test("a slow interaction receipt never delays the Walmart review-order tab", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const runtime = harness({
    notificationPayload: walmartNotificationPayload(directRoute, expiresAt),
    notificationInteractionDelayMs: 250
  });
  runtime.fireJobAlarm();
  await runtime.notificationCompleted;

  runtime.clickNotification("yoink-opportunity:notification_delivery_fixture");
  await waitFor(
    () => runtime.tabUrls().includes(directRoute),
    "The Walmart review-order tab waited for its interaction receipt.",
    100
  );
  assert.deepEqual(runtime.notificationInteractions, [],
    "The tab should open while the delayed receipt is still pending.");
  await waitFor(
    () => runtime.notificationInteractions.length === 1,
    "The delayed notification interaction was not eventually recorded."
  );
});

test("an invalid Walmart affiliate route falls back to the raw review-order route", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const runtime = harness({
    notificationPayload: walmartNotificationPayload("https://attacker.example/cart", expiresAt)
  });
  runtime.fireJobAlarm();
  await runtime.notificationCompleted;
  runtime.clickNotification("yoink-opportunity:notification_delivery_fixture");
  await waitFor(
    () => runtime.tabUrls().includes(directRoute),
    "The invalid affiliate route did not fall back to Walmart reviewOrder."
  );
});

test("an expired stored Walmart handoff falls back to the exact PDP instead of mutating the cart", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const directRoute = "https://www.walmart.com/affil/cart/reviewOrder?items=17354421975&cn=nc&veh=aff";
  const runtime = harness({
    notificationPayload: walmartNotificationPayload(directRoute, expiresAt)
  });
  runtime.fireJobAlarm();
  await runtime.notificationCompleted;
  const routes = runtime.storage.yoinkNotificationRoutesV1 as Record<string, Record<string, unknown>>;
  routes.notification_delivery_fixture!.expiresAt = new Date(Date.now() - 1).toISOString();
  runtime.clickNotification("yoink-opportunity:notification_delivery_fixture");
  const pdp = "https://www.walmart.com/ip/17354421975";
  await waitFor(
    () => runtime.tabUrls().includes(pdp),
    "The stale Walmart handoff did not fall back to the exact PDP."
  );
  assert.equal(runtime.tabUrls().includes(directRoute), false);
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
  assert.equal(runtime.managedUpdateChecks(), 0);

  const health = await runtime.send({ type: "yoink:check-health" });
  assert.equal(health.ok, true);
  assert.equal(runtime.fetchCalls.every((entry) => entry.url.startsWith("https://api.yoink.example/api/v1/")), true);
  const heartbeat = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/heartbeat"));
  const body = JSON.parse(String(heartbeat?.options.body)) as { capabilities: Record<string, unknown> };
  assert.equal(body.capabilities.productionTransportProfile, true);
  assert.equal(body.capabilities.managedExtensionUpdates, true);
});

test("a user-requested managed update check records an exact reload handoff", async () => {
  const runtime = harness({
    runtimeProfile: "production",
    managedUpdateStatus: "update_available",
    managedUpdateVersion: "0.4.0"
  });
  const response = await runtime.send({ type: "yoink:check-update", requestManaged: true });
  assert.equal(response.ok, true);
  const update = response.update as Record<string, unknown>;
  assert.equal(update.managedStatus, "update_available");
  assert.equal(update.releaseVersion, "0.4.0");
  assert.equal(update.updateAvailable, true);
  assert.equal(runtime.managedUpdateChecks(), 1);
  assert.deepEqual(runtime.storage.yoinkUpdateHandoffV1, update.handoff);

  const automatic = harness({ runtimeProfile: "production" });
  automatic.fireUpdateAvailable("0.5.0");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((automatic.storage.yoinkUpdateHandoffV1 as Record<string, unknown>)?.releaseVersion, "0.5.0");
});

test("the extension action menu stays small and derives visibility from the shared health model", async () => {
  const runtime = harness({ healthVersion: "0.3.0", trackalackerPush: true });
  assert.equal(runtime.permissionRequests.length, 0);
  runtime.fireStartup();
  await waitFor(() => runtime.contextMenuDefinitions.size === 7, "Context menu commands were not registered.");
  await waitFor(
    () => runtime.contextMenuDefinitions.get("yoink-inspect-product")?.visible === true,
    "Context menu health was not applied."
  );
  assert.deepEqual([...runtime.contextMenuDefinitions.keys()], [
    "yoink-open",
    "yoink-inspect-product",
    "yoink-save-repair-page",
    "yoink-inspect-drawings",
    "yoink-reconnect-trackalacker",
    "yoink-sync-products",
    "yoink-settings"
  ]);
  assert.equal(runtime.contextMenuDefinitions.get("yoink-settings")?.title, "Extension settings");
  assert.equal(
    Array.from(runtime.contextMenuDefinitions.get("yoink-inspect-product")?.contexts as string[]).join(","),
    "action"
  );
  assert.equal(runtime.contextMenuDefinitions.get("yoink-reconnect-trackalacker")?.visible, false);
  assert.equal(runtime.contextMenuDefinitions.get("yoink-sync-products")?.visible, true);
  assert.equal(runtime.permissionRequests.length, 0);

  const disconnected = harness({ healthVersion: "0.3.0" });
  disconnected.fireStartup();
  await waitFor(
    () => disconnected.contextMenuDefinitions.get("yoink-reconnect-trackalacker")?.visible === true,
    "Disconnected menu state was not applied."
  );
  assert.equal(disconnected.contextMenuDefinitions.get("yoink-sync-products")?.visible, false);
  assert.equal(disconnected.permissionRequests.length, 0);
});

test("the extension action menu opens the dashboard and Settings workspace distinctly", async () => {
  const runtime = harness({ healthVersion: "0.3.0", trackalackerPush: true });
  runtime.fireStartup();
  await waitFor(() => runtime.contextMenuDefinitions.size === 7, "Context menu commands were not registered.");
  runtime.clickContextMenu("yoink-open");
  await waitFor(
    () => runtime.tabUrls().includes("http://127.0.0.1:32991/#cart"),
    "The user dashboard was not opened."
  );
  runtime.clickContextMenu("yoink-settings");
  await waitFor(
    () => runtime.tabUrls().includes(`chrome-extension://${"a".repeat(32)}/options.html`),
    "The Settings workspace was not opened."
  );
});

test("the context-menu product sync requests only TrackaLacker access", async () => {
  const runtime = harness({
    healthVersion: "0.3.0",
    trackalackerPush: true,
    permission: false,
    permissionRequest: true
  });
  runtime.fireStartup();
  await waitFor(() => runtime.contextMenuDefinitions.size === 7, "Context menu commands were not registered.");
  runtime.clickContextMenu("yoink-sync-products");
  await waitFor(() => runtime.permissionRequests.length === 1, "TrackaLacker access was not requested.");
  assert.equal(
    Array.from(runtime.permissionRequests[0]?.origins || []).join(","),
    "https://trackalacker.com/*,https://www.trackalacker.com/*"
  );
});

test("a context-menu inspection revalidates state and page, requests exact access, and persists a no-click result", async () => {
  const runtime = harness({
    activeUrl: PRODUCT_URL,
    healthVersion: "0.3.0",
    trackalackerPush: true,
    permission: true,
    permissionRequest: true
  });
  runtime.fireStartup();
  await waitFor(() => runtime.contextMenuDefinitions.size === 7, "Context menu commands were not registered.");
  runtime.clickContextMenu("yoink-inspect-product", PRODUCT_URL);
  await waitFor(() => Boolean(runtime.storage.yoinkPopupResultV1), "The context-menu result was not persisted.");
  assert.equal(runtime.permissionRequests.length, 1);
  assert.equal(Array.from(runtime.permissionRequests[0]?.origins || []).join(","), "https://www.target.com/*");
  const result = runtime.storage.yoinkPopupResultV1 as Record<string, unknown>;
  assert.equal(result.contextKey, "product:target:1011483414");
  assert.equal(result.productTitle, "Pokémon Trading Card Game Collection");
  assert.ok(["qualified", "blocked", "inspected"].includes(String(result.outcome)));
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.ok(runtime.injections.length > 0);
  assert.ok(runtime.actionTitles.some((title) => title.startsWith("Yoink ·")));
});

test("the inspect hotkey uses the same current-page classifier and revalidation path", async () => {
  const runtime = harness({
    activeUrl: PRODUCT_URL,
    healthVersion: "0.3.0",
    trackalackerPush: true,
    permission: true,
    permissionRequest: true
  });
  runtime.fireCommand("inspect-current-page");
  await waitFor(() => Boolean(runtime.storage.yoinkPopupResultV1), "The hotkey result was not persisted.");
  assert.equal(runtime.permissionRequests.length, 1);
  assert.equal(Array.from(runtime.permissionRequests[0]?.origins || []).join(","), "https://www.target.com/*");
  assert.equal((runtime.storage.yoinkPopupResultV1 as Record<string, unknown>).contextKey, "product:target:1011483414");
});

test("the Yoink hotkey rotates through unseen high-priority handoffs before inspecting a page", async () => {
  const runtime = harness({
    activeUrl: PRODUCT_URL,
    healthVersion: "0.3.0",
    trackalackerPush: true,
    permission: true,
    permissionRequest: true
  });
  runtime.storage.yoinkCartReadyV1 = {
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "needs_you",
      jobId: "job_target_older",
      retailerId: "target",
      retailerSku: "1011483414",
      tabId: 17,
      recordedAt: new Date(Date.now() - 1_000).toISOString(),
      reasonCode: "cart_unverified",
      latency: {}
    }, {
      schemaVersion: 1,
      kind: "needs_you",
      jobId: "job_target_newer",
      retailerId: "target",
      retailerSku: "1011483414",
      tabId: 17,
      recordedAt: new Date().toISOString(),
      reasonCode: "cart_unverified",
      latency: {}
    }]
  };

  runtime.fireCommand("inspect-current-page");
  await waitFor(
    () => Boolean((runtime.storage.yoinkCartReadyV1 as {
      items?: Array<{ jobId: string; openedAt?: string }>;
    })?.items?.find((item) => item.jobId === "job_target_newer")?.openedAt),
    "The hotkey did not open the newest unseen handoff first."
  );
  assert.equal((runtime.storage.yoinkCartReadyV1 as { items?: unknown[] }).items?.length, 2);
  assert.equal(runtime.badgeTexts.at(-1), "2");

  runtime.fireCommand("inspect-current-page");
  await waitFor(
    () => Boolean((runtime.storage.yoinkCartReadyV1 as {
      items?: Array<{ jobId: string; openedAt?: string }>;
    })?.items?.find((item) => item.jobId === "job_target_older")?.openedAt),
    "The hotkey did not rotate to the remaining unseen handoff."
  );
  assert.equal(runtime.permissionRequests.length, 0);
  assert.equal(runtime.injections.length, 0);
  assert.equal(runtime.tabUpdates.filter((update) => update.id === 17 && update.active === true).length, 2);
});

test("a stale context-menu label never authorizes inspection after the active page changes", async () => {
  const runtime = harness({
    activeUrl: PRODUCT_URL,
    healthVersion: "0.3.0",
    trackalackerPush: true,
    permission: true,
    permissionRequest: true
  });
  runtime.fireStartup();
  await waitFor(() => runtime.contextMenuDefinitions.size === 7, "Context menu commands were not registered.");
  const injectionCount = runtime.injections.length;
  runtime.setActiveUrl("https://example.com/not-a-product");
  runtime.clickContextMenu("yoink-inspect-product", PRODUCT_URL);
  await waitFor(
    () => runtime.actionTitles.some((title) => title.includes("This action is no longer available")),
    "The stale context-menu action was not rejected."
  );
  assert.equal(runtime.injections.length, injectionCount);
  assert.equal(runtime.storage.yoinkPopupResultV1, undefined);
});

test("warm readiness checks two stores in background tabs it closes again, without crossing an action boundary", async () => {
  const runtime = harness({ permission: true });
  const result = await runtime.invokeBackground(`runWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)})`);
  assert.equal((result as { warmed?: boolean }).warmed, true);
  assert.equal((result as { warmedCount?: number }).warmedCount, 2);
  assert.equal((result as { attemptedCount?: number }).attemptedCount, 2);
  const readinessRequest = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/readiness/target"));
  assert.ok(readinessRequest);
  const body = JSON.parse(String(readinessRequest.options.body)) as Record<string, unknown>;
  assert.equal(body.retailerId, "target");
  assert.equal(body.cartBaselineState, "ready");
  assert.equal(body.signedInState, "unknown");
  // The check leaves no cart tab open and keeps no tab for reuse.
  const stored = runtime.storage.yoinkRetailerActionTabsV1 as { tabs?: Record<string, unknown> } | undefined;
  assert.deepEqual(Object.keys(stored?.tabs ?? {}), []);
  assert.equal(runtime.tabUrls().some((url) => /\/cart|cart\/view/.test(url)), false);
  assert.equal(runtime.tabCreates.length, 2);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.includes("inspectTargetCartBaseline"), true);
  assert.equal(operations.some((operation) => String(operation).startsWith("commit")), false);

  // A store checked moments ago is not reopened on the next health tick.
  const again = await runtime.invokeBackground(`(async () => {
    await chrome.storage.session.set({ yoinkWarmReadinessCursorV1: 0 });
    return runWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)});
  })()`);
  assert.deepEqual(
    JSON.parse(JSON.stringify((again as { results: Array<{ retailerId: string }> }).results.map((item) => item.retailerId))),
    ["amazon", "bestbuy"],
    "the stores checked a moment ago are skipped"
  );
  assert.equal(runtime.tabUrls().some((url) => /\/cart|cart\/view/.test(url)), false);
});

test("paused readiness never opens or recreates retailer cart tabs", async () => {
  const runtime = harness({ permission: true });
  const health = await runtime.send({ type: "yoink:check-health" });
  assert.equal((health.state as Record<string, unknown>).actionsPaused, true);
  const before = runtime.tabCreates.length;
  const result = await runtime.invokeBackground("runWarmReadinessCycle()");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    warmed: false,
    warmedCount: 0,
    attemptedCount: 0,
    reason: "actions_paused",
    results: []
  });
  assert.equal(runtime.tabCreates.length, before);
  assert.equal(runtime.fetchCalls.some((entry) =>
    /\/devices\/self\/readiness\/(target|walmart|amazon|bestbuy)$/.test(entry.url)), false);
});

test("warm readiness rotates across every guarded retailer with bounded baselines", async () => {
  const runtime = harness({ permission: true });
  const cycles = [];
  for (let index = 0; index < 2; index += 1) {
    cycles.push(await runtime.invokeBackground(`runWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)})`));
  }
  assert.equal(cycles.every((cycle) =>
    (cycle as { attemptedCount: number }).attemptedCount <= 2), true);
  const warmed = cycles.flatMap((cycle) => (cycle as {
    results: Array<{ retailerId: string; warmed: boolean }>;
  }).results);
  assert.deepEqual(JSON.parse(JSON.stringify(warmed.map((item) => ({
    retailerId: item.retailerId,
    warmed: item.warmed
  })))), [
    { retailerId: "target", warmed: true },
    { retailerId: "walmart", warmed: true },
    { retailerId: "amazon", warmed: true },
    { retailerId: "bestbuy", warmed: true }
  ]);
  const readinessPosts = runtime.fetchCalls.filter((entry) =>
    /\/devices\/self\/readiness\/(target|walmart|amazon|bestbuy)$/.test(entry.url));
  assert.equal(readinessPosts.length, 4);
  for (const post of readinessPosts) {
    const body = JSON.parse(String(post.options.body)) as Record<string, unknown>;
    assert.equal(body.cartBaselineState, "ready");
    const observedAt = new Date(String(body.baselineObservedAt)).getTime();
    const expiresAt = new Date(String(body.expiresAt)).getTime();
    assert.ok(Number.isFinite(observedAt));
    assert.ok(expiresAt > observedAt);
    assert.ok(expiresAt <= observedAt + 5 * 60_000);
  }
  const stored = runtime.storage.yoinkRetailerActionTabsV1 as { tabs?: Record<string, unknown> } | undefined;
  assert.deepEqual(Object.keys(stored?.tabs ?? {}), [], "checks never keep their own tabs");
  assert.equal(runtime.tabUrls().some((url) => /\/cart|cart\/view/.test(url)), false);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.some((operation) => String(operation).startsWith("commit")), false);
  const idle = await runtime.invokeBackground(`runWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(idle)), {
    warmed: false,
    warmedCount: 0,
    attemptedCount: 0,
    reason: "recently_checked",
    results: []
  });
});

test("scheduled warm readiness waits behind an active job watch and coalesces overlapping requests", async () => {
  const runtime = harness({ permission: true });
  const result = await runtime.invokeBackground(`(async () => {
    let releaseJobCycle;
    jobCyclePromise = new Promise((resolve) => { releaseJobCycle = resolve; });
    const first = requestWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)});
    const second = requestWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)});
    const coalesced = first === second;
    await Promise.resolve();
    jobCyclePromise = null;
    releaseJobCycle();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    return { coalesced, firstResult, secondResult };
  })()`);
  const model = result as {
    coalesced: boolean;
    firstResult: { warmed: boolean; warmedCount: number; attemptedCount: number; reason: string };
    secondResult: { warmed: boolean; warmedCount: number; attemptedCount: number; reason: string };
  };
  assert.equal(model.coalesced, true);
  assert.deepEqual(JSON.parse(JSON.stringify(model.firstResult)), JSON.parse(JSON.stringify(model.secondResult)));
  assert.equal(model.firstResult.warmed, true);
  assert.equal(model.firstResult.warmedCount, 2);
  assert.equal(model.firstResult.attemptedCount, 2);
  assert.equal(model.firstResult.reason, "baselines_ready");
  assert.equal(runtime.fetchCalls.filter((entry) =>
    /\/devices\/self\/readiness\/(target|walmart|amazon|bestbuy)$/.test(entry.url)).length, 2);
});

test("the health alarm preserves its warm-readiness rotation when a job watch overlaps", async () => {
  const runtime = harness({ permission: true, liveJob: true });
  await runtime.invokeBackground(`Promise.resolve().then(() => {
    jobCyclePromise = new Promise((resolve) => { globalThis.__releaseWarmJobCycle = resolve; });
  })`);
  runtime.fireHealthAlarm();
  let scheduled = false;
  for (let attempt = 0; attempt < 100 && !scheduled; attempt += 1) {
    scheduled = Boolean(await runtime.invokeBackground("Boolean(warmReadinessRequestPromise)"));
    if (!scheduled) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(scheduled, true);
  assert.equal(runtime.fetchCalls.some((entry) =>
    /\/devices\/self\/readiness\/(target|walmart|amazon|bestbuy)$/.test(entry.url)), false);
  await runtime.invokeBackground(`Promise.resolve().then(() => {
    const release = globalThis.__releaseWarmJobCycle;
    jobCyclePromise = null;
    delete globalThis.__releaseWarmJobCycle;
    release();
  })`);
  await waitFor(() => runtime.fetchCalls.filter((entry) =>
    /\/devices\/self\/readiness\/(target|walmart|amazon|bestbuy)$/.test(entry.url)).length === 2,
  "The deferred health-alarm readiness rotation did not run.");
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.some((operation) => String(operation).startsWith("commit")), false);
});

test("warm readiness does not repeatedly replace a challenged retailer tab redirected away from cart", async () => {
  const checkoutUrl = "https://www.bestbuy.com/checkout/r/fast-track";
  const runtime = harness({ permission: true, activeUrl: checkoutUrl });
  runtime.storage.yoinkRetailerActionTabsV1 = {
    schemaVersion: 2,
    tabs: {
      bestbuy: {
        tabId: 17,
        cartBaseline: null,
        signedInState: "challenged"
      }
    }
  };
  runtime.storage.yoinkWarmReadinessCursorV1 = 3;

  const result = await runtime.invokeBackground(`runWarmReadinessCycle(${JSON.stringify(WARM_READINESS_CONTROL)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    warmed: true,
    warmedCount: 1,
    attemptedCount: 2,
    reason: "partial",
    results: [{
      warmed: false,
      retailerId: "bestbuy",
      signedInState: "challenged",
      reason: "manual_action_required"
    }, {
      warmed: true,
      retailerId: "target",
      signedInState: "unknown",
      reason: "baseline_ready"
    }]
  });
  assert.deepEqual(runtime.tabUrls(), [checkoutUrl], "the Target check's own tab closed again");
  assert.equal(runtime.injections.some((entry) =>
    (entry.args as unknown[] | undefined)?.[0] === "inspectBestBuyCartBaseline"), false);
  assert.equal(runtime.storage.yoinkWarmReadinessCursorV1, 1);
});

test("a completed retailer page clears a recovered session blocker and resumes the preserved job watch", async () => {
  const runtime = harness({
    permission: true,
    activeUrl: BESTBUY_PRODUCT_URL,
    retailerSessionState: "ready"
  });
  runtime.storage.yoinkRetailerActionTabsV1 = {
    schemaVersion: 2,
    tabs: {
      bestbuy: {
        tabId: 17,
        cartBaseline: null,
        signedInState: "challenged"
      }
    }
  };

  runtime.fireTabUpdated(17, BESTBUY_PRODUCT_URL);
  await waitFor(() => runtime.fetchCalls.some((entry) =>
    entry.url.endsWith("/devices/self/readiness/bestbuy")),
  "The recovered Best Buy session was not reported.");
  await waitFor(() => runtime.jobLeaseRequests() === 1,
    "The recovered session did not immediately resume the preserved job watch.");

  const readiness = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/readiness/bestbuy"));
  const body = JSON.parse(String(readiness?.options.body)) as Record<string, unknown>;
  assert.equal(body.signedInState, "ready");
  assert.equal(body.cartBaselineState, "unavailable");
  assert.equal(body.errorCode, undefined);
  const stored = runtime.storage.yoinkRetailerActionTabsV1 as {
    tabs: { bestbuy: { signedInState: string } };
  };
  assert.equal(stored.tabs.bestbuy.signedInState, "ready");
});

test("a retailer page that still shows a security challenge remains blocked without leasing", async () => {
  const runtime = harness({
    permission: true,
    activeUrl: BESTBUY_PRODUCT_URL,
    retailerSessionState: "challenged"
  });
  runtime.storage.yoinkRetailerActionTabsV1 = {
    schemaVersion: 2,
    tabs: {
      bestbuy: {
        tabId: 17,
        cartBaseline: null,
        signedInState: "challenged"
      }
    }
  };

  runtime.fireTabUpdated(17, BESTBUY_PRODUCT_URL);
  await waitFor(() => runtime.fetchCalls.some((entry) =>
    entry.url.endsWith("/devices/self/readiness/bestbuy")),
  "The continuing Best Buy challenge was not reported.");
  const readiness = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/readiness/bestbuy"));
  const body = JSON.parse(String(readiness?.options.body)) as Record<string, unknown>;
  assert.equal(body.signedInState, "challenged");
  assert.equal(body.errorCode, "security_challenge");
  assert.equal(runtime.jobLeaseRequests(), 0);
});

test("a rapid challenge redirect coalesces the latest completed page and does not lose recovery", async () => {
  const challengeUrl = "https://www.bestbuy.com/identity/global/signin";
  const runtime = harness({
    permission: true,
    activeUrl: challengeUrl,
    retailerSessionStates: ["challenged", "ready"]
  });
  runtime.storage.yoinkRetailerActionTabsV1 = {
    schemaVersion: 2,
    tabs: {
      bestbuy: {
        tabId: 17,
        cartBaseline: null,
        signedInState: "challenged"
      }
    }
  };

  runtime.fireTabUpdated(17, challengeUrl);
  runtime.fireTabUpdated(17, BESTBUY_PRODUCT_URL);
  await waitFor(() => runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/readiness/bestbuy")).length === 2,
  "The latest page in the Best Buy recovery redirect was not rechecked.");
  await waitFor(() => runtime.jobLeaseRequests() === 1,
    "The coalesced recovery page did not resume the preserved job watch.");
  const states = runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/readiness/bestbuy"))
    .map((entry) => JSON.parse(String(entry.options.body)).signedInState);
  assert.deepEqual(states, ["challenged", "ready"]);
});

test("drop-window observation is exact, read-only, bounded, and closes its inactive tab", async () => {
  const watchId = `watch_item_${"a".repeat(32)}`;
  const runtime = harness({
    permission: true,
    watchObservationSignal: true,
    watchLease: {
      contractVersion: 1,
      id: watchId,
      capabilityToken: "W".repeat(43),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      retailerId: "target",
      retailerSku: "1011483414",
      canonicalUrl: PRODUCT_URL,
      readOnly: true,
      quantity: 1
    }
  });
  const result = await runtime.invokeBackground("runWatchQueueCycle()");
  assert.equal((result as { observed?: boolean }).observed, true);
  const observationRequest = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith(`/devices/self/watch-queue/${watchId}/observations`));
  assert.ok(observationRequest);
  const body = JSON.parse(String(observationRequest.options.body)) as Record<string, unknown>;
  assert.equal(body.retailerId, "target");
  assert.equal(body.retailerSku, "1011483414");
  assert.equal(body.availability, "in_stock");
  assert.equal(JSON.stringify(body).includes(PRODUCT_URL), false);
  assert.equal(runtime.tabRemovals.length, 1);
  assert.equal(runtime.storage.yoinkWatchQueueLeaseV1, undefined);
  const publicWatchState = runtime.storage.yoinkWatchQueueStateV1 as Record<string, unknown>;
  assert.equal(publicWatchState.state, "reported");
  assert.equal(publicWatchState.watchItemId, watchId);
  assert.equal(JSON.stringify(publicWatchState).includes("W".repeat(43)), false);
  assert.equal(JSON.stringify(publicWatchState).includes(PRODUCT_URL), false);
  // An in-stock sighting is reported to Yoink, which logs it; Chrome raises no alert (Kevin, 2026-10-13).
  assert.deepEqual(runtime.shownNotifications.map((entry) => entry.id), []);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.some((operation) => String(operation).startsWith("commit")), false);
  assert.equal(runtime.jobLeaseRequests(), 1);
  const notificationWatch = runtime.fetchCalls.find((entry) =>
    new URL(entry.url).pathname.endsWith("/devices/self/notifications/next"));
  assert.ok(notificationWatch);
  assert.equal(new URL(notificationWatch.url).searchParams.get("wait"), "25000");
});

test("one explicit request replays prior products across all four lanes without clicking", async () => {
  const runtime = harness({
    permission: true,
    reverificationPlanCompletesAfterTrial: true,
    reverificationPlan: {
      createdAt: new Date().toISOString(),
      lanes: [
        ["target", "1011483414", PRODUCT_URL],
        ["walmart", "17354421975", WALMART_PRODUCT_URL],
        ["amazon", "B0GYTRYV7P", AMAZON_PRODUCT_URL],
        ["bestbuy", "6588149", BESTBUY_PRODUCT_URL]
      ].map(([retailerId, retailerSku, canonicalUrl]) => ({
        retailerId,
        expectedAdapterVersion: PACKAGED_ADD_VERSIONS[retailerId as keyof typeof PACKAGED_ADD_VERSIONS],
        expectedObserverVersion: PACKAGED_OBSERVER_VERSIONS[retailerId as keyof typeof PACKAGED_OBSERVER_VERSIONS],
        qualification: { status: "retired", warning: "version_changed", expiresAt: "" },
        candidate: { retailerSku, canonicalUrl, title: `${retailerId} fixture`, trialObservedAt: new Date().toISOString() }
      }))
    }
  });
  const response = await runtime.send({
    type: "yoink:reverify-retailer-lanes",
    retailerIds: ["target", "walmart", "amazon", "bestbuy"]
  });
  assert.equal(response.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      (response.results as Array<Record<string, unknown>>).map((result) => [result.retailerId, result.outcome])
    )),
    [["target", "passed"], ["walmart", "passed"], ["amazon", "passed"], ["bestbuy", "passed"]]
  );
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length, 4);
  assert.equal(runtime.tabRemovals.length, 4);
  const operations = runtime.injections.map((entry) => (entry.args as unknown[] | undefined)?.[0]);
  assert.equal(operations.some((operation) => String(operation).startsWith("commit")), false);
  const state = runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>;
  assert.equal(state.state, "complete");
  assert.equal(JSON.stringify(state).includes(TOKEN), false);
  assert.equal(JSON.stringify(state).includes("https://"), false);
});

test("opt-in automatic requalification checks only needed saved products and respects its daily cooldown", async () => {
  const reverificationPlan = {
    createdAt: new Date().toISOString(),
    lanes: [{
      retailerId: "target",
      expectedAdapterVersion: "target-add-v12",
      expectedObserverVersion: "target-observer-v9",
      qualification: { status: "retired", warning: "version_changed", expiresAt: "" },
      evidence: {
        liveEvidenceReady: false,
        rehearsalReady: false,
        qualificationEvidenceReady: false,
        distinctSkuCount: 1,
        checks: []
      },
      automaticCheckNeeded: true,
      candidates: [{
        retailerSku: "1011483414",
        canonicalUrl: PRODUCT_URL,
        title: "Target qualification fixture",
        trialObservedAt: new Date().toISOString(),
        qualificationTypes: ["first_party_actionable", "shipping_actionable"],
        currentObserverEvidence: false,
        currentRehearsalPassed: false,
        priorRehearsalPassed: true,
        repairableObserverFailure: false
      }]
    }]
  };
  const runtime = harness({
    permission: true,
    reverificationPlanCompletesAfterTrial: true,
    reverificationPlan
  });
  const setting = await runtime.send({ type: "yoink:set-auto-reverification", enabled: true });
  assert.equal((setting.settings as Record<string, unknown>).enabled, true);
  await waitFor(() => runtime.fetchCalls.some((entry) =>
    entry.url.endsWith("/devices/self/qualification-trials/target-add")),
  "The enabled automatic check did not replay the saved Target product.");
  await waitFor(() => (runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>)?.state === "complete",
    "The automatic check did not persist its completed result.");
  const state = runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>;
  assert.equal(state.automatic, true);
  assert.equal(runtime.tabRemovals.length, 1);
  assert.equal(runtime.injections.some((entry) =>
    String((entry.args as unknown[] | undefined)?.[0]).startsWith("commit")), false);
  const trialCount = runtime.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length;
  runtime.fireAutoReverificationAlarm();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length, trialCount);

  const receiptCount = () => runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/readiness/reverification-runs")).length;
  // The passing run posts one receipt; the alarm tick that lands inside the
  // pass backoff posts a second, skipped receipt for the held lane.
  const firstReceipts = receiptCount();
  assert.equal(firstReceipts, 2);
  const heldTick = receiptBodies(runtime).at(-1);
  assert.equal(heldTick?.outcome, "skipped");
  assert.equal(heldTick?.reasonCode, "automatic_check_cooldown");
  const firstReceipt = JSON.parse(String(runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/readiness/reverification-runs"))?.options.body)) as Record<string, unknown>;
  assert.equal(firstReceipt.outcome, "passed");
  assert.equal(firstReceipt.trigger, "settings_enabled");
  assert.equal(firstReceipt.automatic, true);
  assert.equal(JSON.stringify(firstReceipt).includes(PRODUCT_URL), false);
  assert.equal(JSON.stringify(firstReceipt).includes(TOKEN), false);

  // A packaged observer version the companion does not ship bypasses the
  // cooldown, but instead of opening tabs the lane is skipped with an update
  // reason so the app and companion can be brought back in step.
  reverificationPlan.lanes[0]!.expectedObserverVersion = FUTURE_TARGET_OBSERVER_VERSION;
  runtime.fireAutoReverificationAlarm();
  await waitFor(() => receiptCount() > firstReceipts,
    "A packaged observer version change should bypass the daily cooldown.");
  await runtime.invokeBackground("automaticReverificationPromise");
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length, trialCount);
  const skewReceipt = JSON.parse(String(runtime.fetchCalls.filter((entry) =>
    entry.url.endsWith("/devices/self/readiness/reverification-runs")).at(-1)?.options.body)) as Record<string, unknown>;
  assert.equal(skewReceipt.outcome, "skipped");
  assert.equal(skewReceipt.reasonCode, "companion_update_required");
  assert.equal(skewReceipt.trigger, "plan_changed");
  assert.equal(runtime.tabRemovals.length, 1);
  const skewReceipts = receiptCount();

  reverificationPlan.lanes[0]!.expectedObserverVersion = "target-observer-v9";
  reverificationPlan.lanes[0]!.candidates[0]!.repairableObserverFailure = true;
  runtime.fireAutoReverificationAlarm();
  await waitFor(() => runtime.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length > trialCount,
    "A newly queued repair should bypass the daily cooldown.");
  await runtime.invokeBackground("automaticReverificationPromise");
  assert.ok(receiptCount() > skewReceipts);
  const finalState = runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>;
  assert.equal(finalState.schemaVersion, 2);
  assert.equal(typeof finalState.runId, "string");
  assert.equal((finalState.automaticRunsToday as { count: number }).count, 3);
  assert.equal(JSON.stringify(finalState).includes(PRODUCT_URL), false);
});

function targetReverificationPlan(overrides: Record<string, unknown> = {}, candidates: Array<Record<string, unknown>> = [{
  retailerSku: "1011483414",
  canonicalUrl: PRODUCT_URL,
  title: "Target qualification fixture",
  trialObservedAt: new Date().toISOString(),
  qualificationTypes: ["first_party_actionable", "shipping_actionable"],
  currentObserverEvidence: false,
  currentRehearsalPassed: false,
  priorRehearsalPassed: true,
  repairableObserverFailure: false
}]) {
  return {
    createdAt: new Date().toISOString(),
    lanes: [{
      retailerId: "target",
      expectedAdapterVersion: PACKAGED_ADD_VERSIONS.target,
      expectedObserverVersion: PACKAGED_OBSERVER_VERSIONS.target,
      qualification: { status: "retired", warning: "version_changed", expiresAt: "" },
      evidence: {
        liveEvidenceReady: false,
        rehearsalReady: false,
        qualificationEvidenceReady: false,
        distinctSkuCount: 1,
        checks: []
      },
      automaticCheckNeeded: true,
      candidates,
      ...overrides
    }]
  };
}

function receiptBodies(runtime: ReturnType<typeof harness>) {
  return runtime.fetchCalls
    .filter((entry) => entry.url.endsWith("/devices/self/readiness/reverification-runs"))
    .map((entry) => JSON.parse(String(entry.options.body)) as Record<string, unknown>);
}

test("a blocked automatic check backs off on the next tick and only a trigger change restarts it", async () => {
  const reverificationPlan = targetReverificationPlan();
  const runtime = harness({ permission: true, tabNeverLoads: true, reverificationPlan });
  await runtime.invokeBackground("REVERIFICATION_TAB_WAIT_MS = 40");
  await runtime.send({ type: "yoink:set-auto-reverification", enabled: true });
  await waitFor(() => ["partial", "complete"].includes(String(
    (runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown> | undefined)?.state)),
  "The automatic check did not finish.");
  const state = JSON.parse(JSON.stringify(runtime.storage.yoinkRetailerReverificationStateV1)) as Record<string, unknown>;
  assert.equal(state.state, "partial");
  const results = state.results as Array<Record<string, unknown>>;
  assert.equal(results[0]?.outcome, "blocked");
  assert.equal(results[0]?.reasonCode, "product_page_unavailable");
  assert.deepEqual(state.consecutiveNonPassingRuns, { target: 1 });
  assert.equal(typeof state.lastAutomaticRunAt, "string");
  const receipts = receiptBodies(runtime);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.outcome, "blocked");
  assert.equal(receipts[0]?.reasonCode, "product_page_unavailable");
  assert.equal(receipts[0]?.attemptedProductCount, 1);

  // Fresh evidence bits must not re-arm the loop: the same lane holds for an
  // hour after one failure even though the plan's evidence flags moved.
  reverificationPlan.lanes[0]!.candidates[0]!.currentObserverEvidence = true;
  reverificationPlan.lanes[0]!.candidates[0]!.layoutFingerprint = "b".repeat(64);
  const held = await runtime.invokeBackground("runAutomaticReverification(false)") as Record<string, unknown>;
  assert.equal(held.started, false);
  assert.equal(held.reason, "automatic_check_cooldown");
  // A held decision is recorded too, so an empty run history means the loop
  // is not firing rather than that nothing needed checking.
  const heldReceipts = receiptBodies(runtime);
  assert.equal(heldReceipts.length, 2);
  assert.equal(heldReceipts[1]?.outcome, "skipped");
  assert.equal(heldReceipts[1]?.reasonCode, "automatic_check_cooldown");
  assert.equal(heldReceipts[1]?.attemptedProductCount, 0);
  assert.equal(heldReceipts[1]?.automatic, true);

  // A lane status change is trigger material and restarts the check at once.
  (reverificationPlan.lanes[0]!.qualification as Record<string, unknown>).warning = "expired";
  const restarted = await runtime.invokeBackground("runAutomaticReverification(false)") as Record<string, unknown>;
  assert.equal(restarted.started, true);
  assert.equal(receiptBodies(runtime).length, 3);
  assert.equal(receiptBodies(runtime)[2]?.trigger, "plan_changed");
  assert.deepEqual(
    JSON.parse(JSON.stringify((runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>).consecutiveNonPassingRuns)),
    { target: 2 }
  );
});

test("a plan fetch failure between candidates ends the run in an error state with a receipt", async () => {
  const runtime = harness({
    permission: true,
    reverificationPlanFailAfterFetches: 1,
    reverificationPlan: targetReverificationPlan({}, [
      { retailerSku: "1011483414", canonicalUrl: PRODUCT_URL, title: "first", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true },
      { retailerSku: "1011483415", canonicalUrl: "https://www.target.com/p/fixture/-/A-1011483415", title: "second", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true }
    ])
  });
  const response = await runtime.send({ type: "yoink:run-auto-reverification" });
  assert.equal(response.ok, false);
  const state = runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>;
  assert.equal(state.state, "error");
  assert.match(String(state.reasonCode), /^[a-z][a-z0-9_]{1,79}$/);
  assert.equal(state.laneIndex, 0);
  assert.equal(state.candidateIndex, 0);
  assert.equal(JSON.stringify(state).includes("DO_NOT_SEND"), false);
  assert.equal(JSON.stringify(state).includes(TOKEN), false);
  const receipts = receiptBodies(runtime);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.outcome, "error");
  assert.equal(receipts[0]?.retailerId, "target");
  assert.equal(receipts[0]?.attemptedProductCount, 1);
  assert.equal(JSON.stringify(receipts[0]).includes("DO_NOT_SEND"), false);
  assert.equal(runtime.tabRemovals.length, 1, "the candidate tab is closed even when the run fails");
});

test("a saved product whose page never resolves records a terminal unavailable diagnostic and moves on", async () => {
  const runtime = harness({
    permission: true,
    tabNeverLoads: true,
    reverificationPlan: targetReverificationPlan({}, [
      { retailerSku: "1011483414", canonicalUrl: PRODUCT_URL, title: "first", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true },
      { retailerSku: "1011483415", canonicalUrl: "https://www.target.com/p/fixture/-/A-1011483415", title: "second", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true }
    ])
  });
  await runtime.invokeBackground("REVERIFICATION_TAB_WAIT_MS = 40");
  const response = await runtime.send({ type: "yoink:reverify-retailer-lanes", retailerIds: ["target"] });
  assert.equal(response.ok, true);
  const result = (response.results as Array<Record<string, unknown>>)[0]!;
  assert.equal(result.outcome, "blocked");
  assert.equal(result.reasonCode, "product_page_unavailable");
  assert.equal(result.attemptedProductCount, 2);
  const diagnostics = runtime.fetchCalls
    .filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target"))
    .map((entry) => JSON.parse(String(entry.options.body)) as Record<string, unknown>);
  assert.equal(diagnostics.length, 2);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.operation, "observe");
    assert.equal(diagnostic.outcome, "rejected");
    assert.equal(diagnostic.failureStage, "page_identity");
    assert.equal(diagnostic.reasonCode, "product_page_unavailable");
    assert.equal(diagnostic.attemptCount, 1);
    assert.equal((diagnostic.layout as Record<string, unknown>).pageKind, "other");
    assert.equal(JSON.stringify(diagnostic).includes("target.com"), false);
  }
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.retailerSku), ["1011483414", "1011483415"]);
  assert.equal(runtime.tabRemovals.length, 2);
  assert.equal(runtime.storage.yoinkReverificationTabV1, undefined);
});

test("a multi-candidate lane stops as soon as its evidence is ready", async () => {
  const runtime = harness({
    permission: true,
    reverificationPlanCompletesAfterTrial: true,
    reverificationPlan: targetReverificationPlan({}, [
      { retailerSku: "1011483414", canonicalUrl: PRODUCT_URL, title: "first", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true },
      { retailerSku: "1011483415", canonicalUrl: "https://www.target.com/p/fixture/-/A-1011483415", title: "second", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true },
      { retailerSku: "1011483416", canonicalUrl: "https://www.target.com/p/fixture/-/A-1011483416", title: "third", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true }
    ])
  });
  const response = await runtime.send({ type: "yoink:reverify-retailer-lanes", retailerIds: ["target"] });
  assert.equal(response.ok, true);
  const result = (response.results as Array<Record<string, unknown>>)[0]!;
  assert.equal(result.outcome, "passed");
  assert.equal(result.attemptedProductCount, 1);
  assert.equal(result.passedProductCount, 1);
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.includes("/qualification-trials/")).length, 1);
  assert.equal(runtime.tabRemovals.length, 1);
  assert.equal(receiptBodies(runtime)[0]?.trigger, "manual");
  assert.equal(receiptBodies(runtime)[0]?.automatic, false);
});

test("an open repair product from a failed live add is replayed and reported even when repair stays unresolved", async () => {
  const runtime = harness({
    permission: true,
    reverificationPlan: targetReverificationPlan({}, [{
      retailerSku: "1011483414",
      canonicalUrl: PRODUCT_URL,
      title: "live add repair fixture",
      trialObservedAt: new Date().toISOString(),
      source: "repair_queue",
      qualificationTypes: [],
      repairableObserverFailure: true,
      layoutFingerprint: "c".repeat(64)
    }])
  });
  const response = await runtime.send({ type: "yoink:run-auto-reverification" });
  assert.equal(response.ok, true);
  assert.equal(response.started, true);
  assert.equal(runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/qualification-trials/target-add")).length, 1);
  const result = (response.results as Array<Record<string, unknown>>)[0]!;
  assert.equal(result.outcome, "partial", "a passing rehearsal with an unresolved repair entry is partial, not complete");
  assert.equal(result.passedProductCount, 1);
  const receipts = receiptBodies(runtime);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.outcome, "partial");
  assert.equal(receipts[0]?.retailerId, "target");
});

test("a lane whose expected contracts differ from the packaged ones is skipped with an update reason", async () => {
  const newer = harness({
    permission: true,
    reverificationPlan: targetReverificationPlan({ expectedObserverVersion: FUTURE_TARGET_OBSERVER_VERSION })
  });
  const skipped = await newer.send({ type: "yoink:run-auto-reverification" });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.started, true);
  const result = (skipped.results as Array<Record<string, unknown>>)[0]!;
  assert.equal(result.outcome, "skipped");
  assert.equal(result.reasonCode, "companion_update_required");
  assert.equal(newer.tabCreates.length, 0);
  assert.equal(receiptBodies(newer)[0]?.reasonCode, "companion_update_required");

  const older = harness({
    permission: true,
    reverificationPlan: targetReverificationPlan({ expectedAdapterVersion: "target-add-v7" })
  });
  const stale = await older.send({ type: "yoink:run-auto-reverification" });
  assert.equal((stale.results as Array<Record<string, unknown>>)[0]?.reasonCode, "app_update_required");
  assert.equal(older.tabCreates.length, 0);

  const mismatch = harness({ permission: true, evidenceVersionMismatch: true, reverificationPlan: targetReverificationPlan() });
  const rejected = await mismatch.send({ type: "yoink:run-auto-reverification" });
  const rejectedResult = (rejected.results as Array<Record<string, unknown>>)[0]!;
  assert.equal(rejectedResult.outcome, "skipped");
  assert.equal(rejectedResult.reasonCode, "adapter_version_mismatch");
  assert.equal(mismatch.tabRemovals.length, 1);
  assert.equal(JSON.stringify(rejected).includes("DO_NOT_SEND"), false);
});

test("an interrupted hydration wait keeps the first attempt instead of reporting a runtime failure", async () => {
  const runtime = harness({ targetPriceHydrationRetry: true, hydrationExecuteThrows: true });
  const response = await runtime.send({ type: "yoink:inspect-target" });
  assert.equal(response.ok, true);
  const diagnosticPosts = runtime.fetchCalls
    .filter((entry) => entry.url.endsWith("/devices/self/adapter-diagnostics/target"))
    .map((entry) => JSON.parse(String(entry.options.body)) as Record<string, unknown>);
  assert.equal(diagnosticPosts.length, 1);
  assert.equal(diagnosticPosts[0]?.outcome, "failed");
  assert.equal(diagnosticPosts[0]?.failureStage, "price_binding");
  assert.equal(diagnosticPosts[0]?.reasonCode, "price_binding_missing");
  assert.equal(diagnosticPosts[0]?.attemptCount, 1);
  assert.equal(diagnosticPosts.some((post) => post.reasonCode === "observer_execution_failed"), false);
  assert.equal(JSON.stringify(response).includes("DO_NOT_SEND"), false);
});

test("a restarted service worker closes its leftover check tab and retires a stale running record", async () => {
  const runtime = harness({ permission: true });
  runtime.storage.yoinkReverificationTabV1 = {
    schemaVersion: 1, tabId: 41, retailerId: "target", retailerSku: "1011483414", openedAt: new Date().toISOString()
  };
  runtime.storage.yoinkRetailerReverificationStateV1 = {
    schemaVersion: 2, state: "running", results: [], automatic: true, trigger: "scheduled",
    runId: "run_fixture_1", planSignature: "reverification-plan-v3:1:00000000", reasonCode: "",
    laneIndex: 0, candidateIndex: 2, consecutiveNonPassingRuns: {}, laneOutcomes: {},
    lastRunAt: new Date().toISOString(), lastAutomaticRunAt: new Date().toISOString(),
    automaticRunsToday: { day: new Date().toISOString().slice(0, 10), count: 1 },
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  await runtime.invokeBackground("reconcileReverificationRestart()");
  assert.ok(runtime.tabRemovals.includes(41));
  assert.equal(runtime.storage.yoinkReverificationTabV1, undefined);
  const state = runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown>;
  assert.equal(state.state, "error");
  assert.equal(state.reasonCode, "worker_restarted");
  assert.equal(state.candidateIndex, 2);
});

test("each lane result posts its own receipt, including parked and access-missing lanes", async () => {
  const runtime = harness({
    permission: true,
    permittedRetailers: ["target"],
    reverificationPlan: {
      createdAt: new Date().toISOString(),
      lanes: [
        { ...targetReverificationPlan({ session: { signedInState: "signed_out" } }).lanes[0] },
        {
          retailerId: "bestbuy",
          expectedAdapterVersion: PACKAGED_ADD_VERSIONS.bestbuy,
          expectedObserverVersion: PACKAGED_OBSERVER_VERSIONS.bestbuy,
          qualification: { status: "missing", warning: "none", expiresAt: "" },
          evidence: { liveEvidenceReady: false, rehearsalReady: false, qualificationEvidenceReady: false, distinctSkuCount: 1, checks: [] },
          automaticCheckNeeded: true,
          candidates: [{ retailerSku: "6588149", canonicalUrl: BESTBUY_PRODUCT_URL, title: "Best Buy fixture", trialObservedAt: new Date().toISOString(), priorRehearsalPassed: true }]
        }
      ]
    }
  });
  const response = await runtime.send({ type: "yoink:run-auto-reverification" });
  assert.equal(response.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify((response.results as Array<Record<string, unknown>>)
      .map((result) => [result.retailerId, result.outcome, result.reasonCode]))),
    [["target", "parked", "retailer_session_signed_out"], ["bestbuy", "access_missing", "retailer_access_missing"]]
  );
  assert.equal(runtime.tabCreates.length, 0);
  assert.equal(runtime.permissionRequests.length, 0);
  const receipts = receiptBodies(runtime);
  assert.deepEqual(receipts.map((receipt) => [receipt.retailerId, receipt.outcome]), [["target", "parked"], ["bestbuy", "access_missing"]]);
  assert.equal(receipts[0]?.runId, receipts[1]?.runId);
  const state = JSON.parse(JSON.stringify(runtime.storage.yoinkRetailerReverificationStateV1)) as Record<string, unknown>;
  assert.deepEqual(state.consecutiveNonPassingRuns, {}, "parked and access-missing lanes do not count as failures");
});

test("automatic checks stop at the daily cap until the next day", async () => {
  const runtime = harness({ permission: true, reverificationPlan: targetReverificationPlan() });
  runtime.storage.yoinkRetailerReverificationStateV1 = {
    schemaVersion: 2, state: "partial", results: [], automatic: true, trigger: "scheduled",
    runId: "run_fixture_2", planSignature: "reverification-plan-v3:1:00000000", reasonCode: "",
    laneIndex: 0, candidateIndex: 0, consecutiveNonPassingRuns: {}, laneOutcomes: {},
    lastRunAt: new Date().toISOString(), lastAutomaticRunAt: new Date().toISOString(),
    automaticRunsToday: { day: new Date().toISOString().slice(0, 10), count: 6 },
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const capped = await runtime.invokeBackground("runAutomaticReverification(false)") as Record<string, unknown>;
  assert.equal(capped.started, false);
  assert.equal(capped.reason, "automatic_check_daily_cap");
  assert.equal(runtime.tabCreates.length, 0);
  const forced = await runtime.send({ type: "yoink:run-auto-reverification" });
  assert.equal(forced.started, true, "a manual request is never capped");
});

test("a later run at another store cannot postpone an eligible store's automatic check", async () => {
  const runtime = harness({ permission: true, tabNeverLoads: true, reverificationPlan: targetReverificationPlan() });
  await runtime.invokeBackground("REVERIFICATION_TAB_WAIT_MS = 40");
  const now = Date.now();
  const ownLastAt = new Date(now - 2 * 60 * 60_000).toISOString();
  const signature = await runtime.invokeBackground("(async () => reverificationPlanSignature(await getReverificationPlan()))()");
  runtime.storage.yoinkRetailerReverificationStateV1 = {
    schemaVersion: 2, state: "partial", results: [], planSignature: signature,
    lastRunAt: new Date(now).toISOString(),
    laneOutcomes: {
      target: { outcome: "blocked", reasonCode: "product_page_unavailable", at: ownLastAt },
      walmart: { outcome: "passed", reasonCode: "verified", at: new Date(now).toISOString() }
    },
    consecutiveNonPassingRuns: { target: 1 },
    automaticRunsToday: { day: new Date(now).toISOString().slice(0, 10), count: 1 }
  };
  const status = await runtime.send({ type: "yoink:get-auto-reverification" });
  const schedule = status.schedule as any;
  assert.equal((status.policy as any).dailyRunLimit, 6);
  assert.equal(schedule.reason, "ready");
  assert.equal(schedule.lanes[0].lastCheckedAt, ownLastAt);
  assert.equal(schedule.lanes[0].state, "eligible");
  assert.equal(runtime.tabCreates.length, 0, "reading the schedule never opens a store");
  const result = await runtime.invokeBackground("runAutomaticReverification(false)") as Record<string, unknown>;
  assert.equal(result.started, true);
  assert.equal(runtime.tabCreates.length, 1);
  assert.equal(receiptBodies(runtime)[0]?.retailerId, "target");
  assert.equal(runtime.permissionRequests.length, 0);
});

test("schedule projections combine UTC caps with each store's wait and retain manual override semantics", async () => {
  const runtime = harness();
  const plan = targetReverificationPlan();
  const now = Date.parse("2026-09-05T23:55:00.000Z");
  const signature = await runtime.invokeBackground(`reverificationPlanSignature(${JSON.stringify(plan)})`);
  const stored = { planSignature: signature, lastRunAt: "2026-09-05T23:50:00.000Z",
    laneOutcomes: { target: { outcome: "blocked", reasonCode: "offer_binding_failed", at: "2026-09-05T23:00:00.000Z" } },
    consecutiveNonPassingRuns: { target: 2 }, automaticRunsToday: { day: "2026-09-05", count: 6 } };
  const decision = async (settings = { enabled: true }, state = stored, inputPlan: unknown = plan, force = false, clock = now) => runtime.invokeBackground(
    `automaticCheckDecision(${JSON.stringify(settings)}, ${JSON.stringify(state)}, ${JSON.stringify(inputPlan)}, ${clock}, ${force})`
  ) as Promise<any>;
  const waiting = await decision();
  assert.equal(waiting.resetAt, "2026-09-06T00:00:00.000Z");
  assert.equal(waiting.nextEligibleAt, "2026-09-06T03:00:00.000Z", "the later store backoff still applies after the daily reset");
  const nextDay = await decision({ enabled: true }, stored, plan, false, Date.parse("2026-09-06T04:00:00.000Z"));
  assert.equal(nextDay.runsToday, 0);
  assert.equal(nextDay.reason, "ready");
  const disabled = await decision({ enabled: false });
  assert.equal(disabled.reason, "automatic_checks_disabled");
  assert.equal(disabled.nextEligibleAt, null);
  const manual = await decision({ enabled: false }, stored, plan, true);
  assert.equal(manual.reason, "ready");
  assert.deepEqual(JSON.parse(JSON.stringify(manual.eligibleRetailerIds)), ["target"]);
  const unavailable = await decision({ enabled: true }, stored, null);
  assert.equal(unavailable.reason, "plan_unavailable");
  const blocked = await decision({ enabled: true }, stored, targetReverificationPlan({ blockedReason: "qualification_candidate_missing" }, []));
  assert.equal(blocked.reason, "store_checks_blocked");
  assert.equal(blocked.nextEligibleAt, null);
  assert.equal(blocked.lanes[0].state, "blocked");
  assert.equal(runtime.tabCreates.length, 0);
});

test("automatic requalification never prompts for new retailer access or opens an inaccessible store", async () => {
  const runtime = harness({
    permission: false,
    reverificationPlan: {
      createdAt: new Date().toISOString(),
      lanes: [{
        retailerId: "bestbuy",
        expectedAdapterVersion: "bestbuy-add-v18",
        qualification: { status: "missing", warning: "none", expiresAt: "" },
        evidence: {
          liveEvidenceReady: false,
          rehearsalReady: false,
          qualificationEvidenceReady: false,
          distinctSkuCount: 1,
          checks: []
        },
        automaticCheckNeeded: true,
        candidates: [{
          retailerSku: "6588149",
          canonicalUrl: BESTBUY_PRODUCT_URL,
          title: "Best Buy qualification fixture",
          trialObservedAt: new Date().toISOString(),
          qualificationTypes: ["first_party_actionable", "shipping_actionable"],
          currentObserverEvidence: false,
          currentRehearsalPassed: false,
          priorRehearsalPassed: true
        }]
      }]
    }
  });
  const response = await runtime.send({ type: "yoink:run-auto-reverification" });
  assert.equal(response.ok, true);
  assert.equal(response.started, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.results)), [{
    retailerId: "bestbuy",
    retailerSku: "6588149",
    outcome: "access_missing",
    reasonCode: "retailer_access_missing",
    attemptedProductCount: 0,
    passedProductCount: 0
  }]);
  assert.equal(runtime.permissionRequests.length, 0,
    "background checks cannot turn a scheduled task into a permission prompt");
  assert.equal(runtime.tabCreates.length, 0);
});

test("a service-worker restart resumes its persisted read-only watch lease", async () => {
  const watchId = `watch_item_${"b".repeat(32)}`;
  const runtime = harness({ permission: true });
  runtime.storage.yoinkWatchQueueLeaseV1 = {
    contractVersion: 1,
    id: watchId,
    capabilityToken: "L".repeat(43),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: PRODUCT_URL,
    readOnly: true,
    quantity: 1
  };
  const result = await runtime.invokeBackground("runWatchQueueCycle()");
  assert.equal((result as { observed?: boolean }).observed, true);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/watch-queue/next")), false);
  assert.equal(runtime.fetchCalls.some((entry) =>
    entry.url.endsWith(`/devices/self/watch-queue/${watchId}/observations`)), true);
  assert.equal(runtime.storage.yoinkWatchQueueLeaseV1, undefined);
});

test("confirmation observation is exact-store bound across every guarded retailer and never reports order-page details", async () => {
  const cases = [
    ["target", "https://www.target.com/co-order-confirmation?orderId=DO_NOT_SEND"],
    ["walmart", "https://www.walmart.com/checkout/thank-you?orderId=DO_NOT_SEND"],
    ["amazon", "https://www.amazon.com/gp/buy/thankyou?orderId=DO_NOT_SEND"],
    ["bestbuy", "https://www.bestbuy.com/checkout/order-confirmation?orderId=DO_NOT_SEND"]
  ] as const;

  for (const [retailerId, url] of cases) {
    const runtime = harness();
    runtime.storage.yoinkOrderHandoffsV1 = [{
      jobId: `job_${retailerId}_fixture`,
      retailerId,
      tabId: 17,
      recordedAt: new Date().toISOString()
    }];
    runtime.storage.yoinkCartReadyV1 = {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        kind: "cart_ready",
        jobId: `job_${retailerId}_fixture`,
        retailerId,
        retailerSku: retailerId === "target" ? "1011483414"
          : retailerId === "walmart" ? "17354421975"
            : retailerId === "amazon" ? "B0GYTRYV7P" : "6588149",
        tabId: 17,
        recordedAt: new Date().toISOString(),
        latency: {}
      }]
    };
    const observed = await runtime.invokeBackground(
      `observeOrderConfirmation(17, ${JSON.stringify(url)})`
    );
    assert.equal(observed, true, `${retailerId} confirmation page should close its exact handoff`);
    const request = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/order-confirmations"));
    assert.ok(request);
    const body = JSON.parse(String(request.options.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      "actionJobId", "contractVersion", "observedAt", "pageClass", "retailerId"
    ]);
    assert.equal(body.actionJobId, `job_${retailerId}_fixture`);
    assert.equal(body.retailerId, retailerId);
    assert.equal(body.pageClass, "confirmation");
    assert.equal(JSON.stringify(body).includes("DO_NOT_SEND"), false);
    assert.deepEqual(runtime.storage.yoinkOrderHandoffsV1, []);
    assert.equal((runtime.storage.yoinkCartReadyV1 as { items: unknown[] }).items.length, 0);
  }

  const mismatch = harness();
  mismatch.storage.yoinkOrderHandoffsV1 = [{
    jobId: "job_target_mismatch",
    retailerId: "target",
    tabId: 17,
    recordedAt: new Date().toISOString()
  }];
  const ignored = await mismatch.invokeBackground(
    'observeOrderConfirmation(17, "https://www.walmart.com/checkout/thank-you?orderId=DO_NOT_SEND")'
  );
  assert.equal(ignored, false);
  assert.equal(mismatch.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/order-confirmations")), false);
  assert.equal((mismatch.storage.yoinkOrderHandoffsV1 as unknown[]).length, 1);
});

test("dashboard close-out reconciliation clears only the exact local handoff", async () => {
  const runtime = harness({ handoffReconciliationStatus: "closed" });
  runtime.storage.yoinkCartReadyV1 = {
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "needs_you",
      jobId: "job_target_fixture",
      retailerId: "target",
      retailerSku: "1011483414",
      tabId: 17,
      recordedAt: new Date().toISOString(),
      reasonCode: "cart_unverified",
      latency: {}
    }]
  };
  runtime.storage.yoinkOrderHandoffsV1 = [{
    jobId: "job_target_fixture",
    retailerId: "target",
    tabId: 17,
    recordedAt: new Date().toISOString()
  }];
  const result = await runtime.invokeBackground("reconcileActionHandoffs()");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { checked: 1, closed: 1 });
  assert.equal((runtime.storage.yoinkCartReadyV1 as { items: unknown[] }).items.length, 0);
  assert.deepEqual(runtime.storage.yoinkOrderHandoffsV1, []);
  const request = runtime.fetchCalls.find((entry) => entry.url.endsWith("/devices/self/action-handoffs/reconcile"));
  assert.ok(request);
  assert.deepEqual(JSON.parse(String(request.options.body)), {
    contractVersion: 1,
    jobIds: ["job_target_fixture"],
    availabilityVersion: -1,
    waitMs: 0
  });
});

test("a stale device handoff version bootstraps once, then watches and applies the exact close-out", async () => {
  const runtime = harness({
    handoffReconciliationResponses: [
      { availabilityVersion: 7, status: "cart_ready" },
      { availabilityVersion: 8, status: "closed" }
    ]
  });
  runtime.storage.yoinkCartReadyV1 = {
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_target_fixture",
      retailerId: "target",
      retailerSku: "1011483414",
      tabId: 17,
      recordedAt: new Date().toISOString(),
      latency: {}
    }]
  };
  runtime.storage.yoinkOrderHandoffsV1 = [{
    jobId: "job_target_fixture",
    retailerId: "target",
    tabId: 17,
    recordedAt: new Date().toISOString()
  }];

  const result = await runtime.invokeBackground("reconcileActionHandoffs(ACTION_HANDOFF_WAIT_MS)");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { checked: 1, closed: 1 });
  const requests = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/action-handoffs/reconcile"));
  assert.equal(requests.length, 2);
  const first = JSON.parse(String(requests[0]?.options.body)) as Record<string, unknown>;
  const second = JSON.parse(String(requests[1]?.options.body)) as Record<string, unknown>;
  assert.equal(first.availabilityVersion, -1);
  assert.equal(Number(first.waitMs) > 0 && Number(first.waitMs) <= 25_000, true);
  assert.equal(second.availabilityVersion, 7);
  assert.equal(Number(second.waitMs) > 0 && Number(second.waitMs) <= Number(first.waitMs), true);
  assert.equal(runtime.storage.yoinkActionHandoffAvailabilityVersionV1, 8);
  assert.equal((runtime.storage.yoinkCartReadyV1 as { items: unknown[] }).items.length, 0);
  assert.deepEqual(runtime.storage.yoinkOrderHandoffsV1, []);
  assert.equal(runtime.clearedNotifications.includes("yoink-cart-ready:job_target_fixture"), true);
});

test("the popup closes only a locally bound cart handoff through the paired-device outcome route", async () => {
  const runtime = harness();
  runtime.storage.yoinkCartReadyV1 = {
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_target_fixture",
      retailerId: "target",
      retailerSku: "1011483414",
      tabId: 17,
      recordedAt: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      reviewedMaximumCents: 5_999,
      latency: {}
    }]
  };
  runtime.storage.yoinkOrderHandoffsV1 = [{
    jobId: "job_target_fixture",
    retailerId: "target",
    tabId: 17,
    recordedAt: new Date().toISOString()
  }];

  const response = await runtime.send({
    type: "yoink:report-cart-outcome",
    jobId: "job_target_fixture",
    outcome: "got_it",
    actualTotalCents: 6_127,
    confirmation: "I_REVIEWED_CHECKOUT_RESULT"
  });
  assert.equal(response.ok, true);
  assert.equal((runtime.storage.yoinkCartReadyV1 as { items: unknown[] }).items.length, 0);
  assert.deepEqual(runtime.storage.yoinkOrderHandoffsV1, []);
  assert.equal(runtime.clearedNotifications.includes("yoink-cart-ready:job_target_fixture"), true);
  const request = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/jobs/job_target_fixture/outcome"));
  assert.ok(request);
  assert.equal((request.options.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(String(request.options.body)), {
    outcome: "got_it",
    actualTotalCents: 6_127,
    confirmation: "I_REVIEWED_CHECKOUT_RESULT"
  });

  const rejected = await runtime.send({
    type: "yoink:report-cart-outcome",
    jobId: "job_not_locally_ready",
    outcome: "missed_it",
    actualTotalCents: null,
    confirmation: "I_REVIEWED_CHECKOUT_RESULT"
  });
  assert.equal(rejected.ok, false);
  assert.match(String(rejected.message), /no longer available/i);
  assert.equal(runtime.fetchCalls.filter((entry) => /\/outcome$/.test(entry.url)).length, 1);
});

test("verified local deletion clears both extension storage areas before posting its receipt", async () => {
  const runtime = harness({ cartReadySound: true, queuedTrackalackerSignal: true });
  const result = await runtime.send({
    type: "yoink:delete-local-data",
    confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
  });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.equal(result.verified, true);
  assert.deepEqual(Object.keys(runtime.storage), []);
  const receipt = runtime.fetchCalls.find((entry) =>
    entry.url.endsWith("/devices/self/privacy/local-deletion"));
  assert.ok(receipt);
  assert.deepEqual(JSON.parse(String(receipt.options.body)), {
    contractVersion: 1,
    localCleared: true,
    sessionCleared: true,
    retainedKeys: []
  });
});

test("local deletion never emits a verified receipt when Chrome reports retained keys", async () => {
  const runtime = harness({ cartReadySound: true, localDeletionResidual: true });
  const result = await runtime.send({
    type: "yoink:delete-local-data",
    confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
  });
  assert.equal(result.ok, false);
  assert.match(String(result.message), /retained local Yoink data/);
  assert.equal(runtime.fetchCalls.some((entry) =>
    entry.url.endsWith("/devices/self/privacy/local-deletion")), false);
});

test("local deletion succeeds without pairing and does not invent a remote receipt", async () => {
  const runtime = harness({ cartReadySound: true, queuedTrackalackerSignal: true });
  delete runtime.storage.pairedDevice;
  const result = await runtime.send({
    type: "yoink:delete-local-data",
    confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
  });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.equal(result.verified, false);
  assert.deepEqual(Object.keys(runtime.storage), []);
  assert.equal(runtime.fetchCalls.some((entry) =>
    entry.url.endsWith("/devices/self/privacy/local-deletion")), false);
});

test("the store-check alarm wakes hourly while a lane needs evidence and six-hourly once lanes are current", async () => {
  const reverificationPlan = targetReverificationPlan();
  const runtime = harness({ permission: true, tabNeverLoads: true, reverificationPlan });
  await runtime.invokeBackground("REVERIFICATION_TAB_WAIT_MS = 40");
  const alarms = () => runtime.alarmCreations.filter((alarm) => alarm.name === "yoink-auto-reverification");
  await runtime.invokeBackground("initialize()");
  assert.deepEqual(alarms().at(-1), { name: "yoink-auto-reverification", delayInMinutes: 2, periodInMinutes: 60 },
    "the first run waits two minutes instead of a full period");
  await runtime.send({ type: "yoink:set-auto-reverification", enabled: true });
  await waitFor(() => ["partial", "complete"].includes(String(
    (runtime.storage.yoinkRetailerReverificationStateV1 as Record<string, unknown> | undefined)?.state)),
  "The automatic check did not finish.");
  assert.deepEqual(alarms().at(-1), { name: "yoink-auto-reverification", delayInMinutes: 60, periodInMinutes: 60 },
    "a lane that still needs evidence keeps the hourly cadence");
  reverificationPlan.lanes[0]!.automaticCheckNeeded = false;
  const idle = await runtime.invokeBackground("runAutomaticReverification(false)") as Record<string, unknown>;
  assert.equal(idle.started, false);
  assert.equal(idle.reason, "no_store_checks_needed");
  assert.deepEqual(alarms().at(-1), { name: "yoink-auto-reverification", delayInMinutes: 360, periodInMinutes: 360 },
    "current lanes fall back to the six-hour period");
});

test("a local development companion reloads itself once when the app reports newer packaged versions", async () => {
  const runtime = harness({ permission: true });
  const reloads: number[] = [];
  await runtime.invokeBackground(`chrome.runtime.reload = () => { globalThis.__yoinkReloads = (globalThis.__yoinkReloads || 0) + 1; };
    chrome.management = { getSelf: async () => ({ installType: "development" }) };`);
  const current = await runtime.invokeBackground("installedVersionSignature()") as string;
  assert.match(current, /^\d+\.\d+\.\d+\|observer:/);
  const sameVersions = await runtime.invokeBackground(
    "maybeReloadForLocalUpdate({ packagedVersions: { extension: EXTENSION_VERSION, observer: ADAPTER_VERSIONS.observer, add: ADAPTER_VERSIONS.add, pack: ADAPTER_VERSIONS.pack } })"
  );
  assert.equal(sameVersions, false, "matching versions never reload");
  const newer = "maybeReloadForLocalUpdate({ packagedVersions: { extension: EXTENSION_VERSION, observer: ADAPTER_VERSIONS.observer, add: ADAPTER_VERSIONS.add, pack: { ...ADAPTER_VERSIONS.pack, target: 'target-pack-v99' } } })";
  // The health alarm starts the store-check decision and the capsule drain in
  // the same tick as this check; the reload waits for them instead of giving up.
  const newerWhileBusy = `(() => {
    automaticReverificationPromise = new Promise((resolve) => setTimeout(resolve, 50)).finally(() => { automaticReverificationPromise = null; });
    evidenceCapsuleDrainPromise = Promise.resolve().finally(() => { evidenceCapsuleDrainPromise = null; });
    return ${newer};
  })()`;
  assert.equal(await runtime.invokeBackground(newerWhileBusy), true, "a newer pack reloads the unpacked companion once brief work has finished");
  assert.equal(await runtime.invokeBackground("automaticReverificationPromise === null && evidenceCapsuleDrainPromise === null"), true);
  assert.equal(await runtime.invokeBackground(newer), false, "the same signature does not reload again right away");
  reloads.push(Number(await runtime.invokeBackground("globalThis.__yoinkReloads || 0")));
  assert.deepEqual(reloads, [1]);
  // A reload that landed before the new files finished syncing retries after
  // the spacing window, and stops after the attempt cap.
  const ageGuard = "chrome.storage.local.get('yoinkLocalReloadSignatureV1').then((v) => chrome.storage.local.set({ yoinkLocalReloadSignatureV1: { ...v.yoinkLocalReloadSignatureV1, at: Date.now() - LOCAL_RELOAD_RETRY_MS - 1 } }))";
  await runtime.invokeBackground(ageGuard);
  assert.equal(await runtime.invokeBackground(newer), true, "a stale attempt retries after the spacing window");
  await runtime.invokeBackground(ageGuard);
  assert.equal(await runtime.invokeBackground(newer), true, "the third attempt is still allowed");
  await runtime.invokeBackground(ageGuard);
  assert.equal(await runtime.invokeBackground(newer), false, "reloads stop after the attempt cap");
  await runtime.invokeBackground("globalThis.__yoinkReloads = 1");
  // Without the management API, an unpacked install is recognised by the
  // absence of update_url in its manifest; a managed manifest never reloads.
  await runtime.invokeBackground("delete chrome.management; chrome.storage.local.remove('yoinkLocalReloadSignatureV1')");
  await runtime.invokeBackground("chrome.runtime.getManifest = () => ({ version: EXTENSION_VERSION, update_url: 'https://clients2.google.com/service/update2/crx' })");
  assert.equal(await runtime.invokeBackground(newer), false, "a managed manifest never self-reloads");
  await runtime.invokeBackground("chrome.runtime.getManifest = () => ({ version: EXTENSION_VERSION })");
  assert.equal(await runtime.invokeBackground(newer), true, "an unpacked manifest reloads without the management API");
  assert.equal(Number(await runtime.invokeBackground("globalThis.__yoinkReloads || 0")), 2);
  assert.equal(runtime.storage.yoinkLocalReloadSignatureV1 !== undefined, true);
});


test("Reconnect wakes a sleeping TrackaLacker tab instead of waiting for it to load", async () => {
  // Brave put the shopper's open TrackaLacker tab to sleep; Reconnect waited
  // 25 s for a load that never came and showed "did not finish loading in time".
  const tabsFor = (scenario: string) => `(async () => {
    const calls = [];
    const listeners = new Set();
    const url = "https://www.trackalacker.com/products";
    let status = "${scenario}" === "loaded" ? "complete" : "unloaded";
    chrome.tabs.query = async () => [{ id: 41, url, status, discarded: status !== "complete" }];
    chrome.tabs.get = async (id) => id === 99
      ? { id, url, status: "complete", discarded: false }
      : { id, url, status, discarded: status !== "complete" };
    chrome.tabs.reload = async (id) => {
      calls.push("reload:" + id);
      if ("${scenario}" === "gone") throw new Error("No tab with id: " + id);
      setTimeout(() => {
        status = "complete";
        for (const listener of listeners) listener(id, { status: "complete" }, { id, url, status, discarded: false });
      }, 10);
    };
    chrome.tabs.create = async ({ active }) => { calls.push("create:" + active); return { id: 99 }; };
    chrome.tabs.onUpdated = { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) };
    return JSON.stringify({ tabId: await trackalackerTab(), calls });
  })()`;
  const run = async (scenario: string) => JSON.parse(String(await harness({ permission: true }).invokeBackground(tabsFor(scenario))));
  assert.deepEqual(await run("loaded"), { tabId: 41, calls: [] }, "a loaded tab is used as it is");
  assert.deepEqual(await run("sleeping"), { tabId: 41, calls: ["reload:41"] }, "a sleeping tab is reloaded and used");
  assert.deepEqual(await run("gone"), { tabId: 99, calls: ["reload:41", "create:true"] }, "a tab that cannot be woken falls back to a new tab");
});

test("an automatic TrackaLacker reconnect opens its tab in the background and closes only a tab it opened", async () => {
  const enroll = (automatic: boolean, openTab: boolean) => `(async () => {
    const calls = [];
    const url = "https://www.trackalacker.com/products";
    chrome.tabs.query = async () => ${openTab ? "[{ id: 41, url, status: 'complete', discarded: false }]" : "[]"};
    chrome.tabs.get = async (id) => ({ id, url, status: "complete", discarded: false });
    chrome.tabs.create = async ({ active }) => { calls.push("create:" + active); return { id: 99 }; };
    chrome.tabs.remove = async (id) => { calls.push("remove:" + id); };
    storedDevice = async () => ({ token: "memory-only" });
    enrollThroughTrackalackerTab = async (tabId) => { calls.push("enroll:" + tabId); return { state: {} }; };
    await performTrackalackerEnrollment(false, { automatic: ${automatic} });
    return JSON.stringify(calls);
  })()`;
  const run = async (automatic: boolean, openTab: boolean) => JSON.parse(String(await harness({ permission: true }).invokeBackground(enroll(automatic, openTab))));
  assert.deepEqual(await run(true, false), ["create:false", "enroll:99", "remove:99"]);
  assert.deepEqual(await run(true, true), ["enroll:41"], "the shopper's own TrackaLacker tab stays open");
  assert.deepEqual(await run(false, false), ["create:true", "enroll:99"], "Reconnect from the popup shows its tab and leaves it open");
});


test("new cart lanes are retained in permission-filtered leasing and requalification", async () => {
  const runtime = harness({ permittedRetailers: ["pokemoncenter"] });
  await runtime.invokeBackground("runJobCycle()");
  assert.ok(runtime.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "pokemoncenter"));
  const result = JSON.parse(JSON.stringify(await runtime.invokeBackground(`({
    lease: actionJobLeaseRequest(0, Object.keys(ADD_LANES)),
    plan: normalizedReverificationPlan({ lanes: Object.keys(ADD_LANES).map(retailerId => ({ retailerId })) }),
    capabilities: targetCapabilities()
  })`)));
  assert.match(result.lease.path, /retailers=target,walmart,amazon,bestbuy,pokemoncenter,aninebing,americaneagle,asus,athleta,audioadvice,bananarepublic,bananarepublicfactory$/);
  assert.deepEqual(result.plan.lanes.map((lane: { retailerId: string }) => lane.retailerId), ["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"]);
  assert.equal(result.capabilities.pokemonCenterAddOnly, true);
  assert.equal(result.capabilities.pokemonCenterAddAdapterVersion, "pokemoncenter-add-v1");
  assert.equal(result.capabilities.anineBingAddOnly, true);
  assert.equal(result.capabilities.anineBingAddAdapterVersion, "aninebing-add-v1");
  assert.equal(result.capabilities.americanEagleAddOnly, true);
  assert.equal(result.capabilities.americanEagleAddAdapterVersion, "americaneagle-add-v1");
  assert.equal(result.capabilities.asusAddOnly, true);
  assert.equal(result.capabilities.asusAddAdapterVersion, "asus-add-v1");
  const asus = harness({ permittedRetailers: ["asus"] });
  await asus.invokeBackground("runJobCycle()");
  assert.ok(asus.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "asus"));
  const canonical = "https://eshop.asus.com/us/90mp04d0-bmaa02-rog-harpe-mini-core.html";
  const identity = JSON.parse(JSON.stringify(await asus.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(canonical + "?utm_source=ignored")})`)));
  assert.equal(identity.retailerId, "asus");
  assert.equal(identity.retailerSku, "90MP04D0-BMAA02");
  assert.equal(identity.canonicalUrl, canonical);
  for (const url of [canonical + "?config=123", canonical.replace("/us/", "/ca/"), canonical.replace("eshop.asus.com", "asus.com")]) {
    assert.equal(await asus.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(url)})`), null);
  }
  const eagle = harness({ permittedRetailers: ["americaneagle"] });
  await eagle.invokeBackground("runJobCycle()");
  assert.ok(eagle.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "americaneagle"));
  const anine = harness({ permittedRetailers: ["aninebing"] });
  await anine.invokeBackground("runJobCycle()");
  assert.ok(anine.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "aninebing"));
});

test("BananaRepublic requires both exact hosts for leasing and preserves product/cart handoffs", async () => {
  const runtime = harness({ permittedRetailers: ["bananarepublic"] });
  await runtime.invokeBackground("runJobCycle()");
  assert.ok(runtime.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "bananarepublic"));
  const canonical = "https://bananarepublic.gap.com/browse/product.do?pid=9067620520000";
  const cart = "https://secure-bananarepublic.gap.com/shopping-bag";
  const identity = JSON.parse(JSON.stringify(await runtime.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(canonical + "&vid=1&utm_source=ignored#details")})`)));
  assert.deepEqual(identity, { retailerId: "bananarepublic", retailerSku: "9067620520000", canonicalUrl: canonical });
  for (const url of [canonical + "&vid=2", canonical + "&pid=9067580020000", canonical.replace("9067620520000", "906762052"), canonical.replace("bananarepublic.gap.com", "secure-bananarepublic.gap.com")]) {
    assert.equal(await runtime.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(url)})`), null, url);
  }
  for (const url of [canonical, cart]) {
    assert.equal(await runtime.invokeBackground(`retailerLanePageUrl("bananarepublic", ${JSON.stringify(url)})`), true);
    assert.equal(await runtime.invokeBackground(`retailerHandoffTab({id: 5, url: ${JSON.stringify(url)}}, {retailerId: "bananarepublic", kind: "needs_you"})`), true);
  }
  assert.equal(await runtime.invokeBackground(`retailerCartTab({id: 5, url: ${JSON.stringify(canonical)}}, "bananarepublic")`), false);
  assert.equal(await runtime.invokeBackground(`retailerCartTab({id: 5, url: ${JSON.stringify(cart)}}, "bananarepublic")`), true);
  for (const url of ["https://gap.com/shopping-bag", cart.replace("secure-bananarepublic", "secure-gap"), cart.replace(".com/", ".com.evil.test/"), cart.replace("https:", "http:"), cart.replace(".com/", ".com:8443/"), cart.replace("https://", "https://name@")]) {
    assert.equal(await runtime.invokeBackground(`retailerLanePageUrl("bananarepublic", ${JSON.stringify(url)})`), false, url);
    assert.equal(await runtime.invokeBackground(`retailerHandoffTab({id: 5, url: ${JSON.stringify(url)}}, {retailerId: "bananarepublic", kind: "needs_you"})`), false, url);
  }
  for (const origin of ["https://bananarepublic.gap.com/*", "https://secure-bananarepublic.gap.com/*"]) {
    const missing = harness({ permittedRetailers: ["bananarepublic"], deniedOrigins: [origin] });
    assert.equal(await missing.invokeBackground('addLaneAccess("bananarepublic")'), false, origin);
    await missing.invokeBackground("runJobCycle()");
    assert.equal(missing.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers")?.split(",").includes("bananarepublic")), false);
  }
});

test("BananaRepublicFactory requires both exact hosts for leasing and preserves product/cart handoffs", async () => {
  const runtime = harness({ permittedRetailers: ["bananarepublicfactory"] });
  await runtime.invokeBackground("runJobCycle()");
  assert.ok(runtime.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "bananarepublicfactory"));
  const canonical = "https://bananarepublicfactory.gapfactory.com/browse/product.do?pid=11765980010000";
  const cart = "https://secure-bananarepublicfactory.gapfactory.com/shopping-bag";
  const identity = JSON.parse(JSON.stringify(await runtime.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(canonical + "&vid=1&utm_source=ignored#details")})`)));
  assert.deepEqual(identity, { retailerId: "bananarepublicfactory", retailerSku: "11765980010000", canonicalUrl: canonical });
  for (const url of [canonical + "&vid=2", canonical + "&pid=11765830010000", canonical.replace("11765980010000", "1176598001"), canonical.replace("bananarepublicfactory.gapfactory.com", "secure-bananarepublicfactory.gapfactory.com")]) {
    assert.equal(await runtime.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(url)})`), null, url);
  }
  for (const url of [canonical, cart]) {
    assert.equal(await runtime.invokeBackground(`retailerLanePageUrl("bananarepublicfactory", ${JSON.stringify(url)})`), true);
    assert.equal(await runtime.invokeBackground(`retailerHandoffTab({id: 5, url: ${JSON.stringify(url)}}, {retailerId: "bananarepublicfactory", kind: "needs_you"})`), true);
  }
  assert.equal(await runtime.invokeBackground(`retailerCartTab({id: 5, url: ${JSON.stringify(canonical)}}, "bananarepublicfactory")`), false);
  assert.equal(await runtime.invokeBackground(`retailerCartTab({id: 5, url: ${JSON.stringify(cart)}}, "bananarepublicfactory")`), true);
  for (const url of ["https://gap.com/shopping-bag", cart.replace("secure-bananarepublicfactory", "secure-gap"), cart.replace(".com/", ".com.evil.test/"), cart.replace("https:", "http:"), cart.replace(".com/", ".com:8443/"), cart.replace("https://", "https://name@")]) {
    assert.equal(await runtime.invokeBackground(`retailerLanePageUrl("bananarepublicfactory", ${JSON.stringify(url)})`), false, url);
    assert.equal(await runtime.invokeBackground(`retailerHandoffTab({id: 5, url: ${JSON.stringify(url)}}, {retailerId: "bananarepublicfactory", kind: "needs_you"})`), false, url);
  }
  for (const origin of ["https://bananarepublicfactory.gapfactory.com/*", "https://secure-bananarepublicfactory.gapfactory.com/*"]) {
    const missing = harness({ permittedRetailers: ["bananarepublicfactory"], deniedOrigins: [origin] });
    assert.equal(await missing.invokeBackground('addLaneAccess("bananarepublicfactory")'), false, origin);
    await missing.invokeBackground("runJobCycle()");
    assert.equal(missing.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers")?.split(",").includes("bananarepublicfactory")), false);
  }
});

test("Athleta requires both exact hosts for leasing and preserves product/cart handoffs", async () => {
  const runtime = harness({ permittedRetailers: ["athleta"] });
  await runtime.invokeBackground("runJobCycle()");
  assert.ok(runtime.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers") === "athleta"));
  const canonical = "https://athleta.gap.com/browse/product.do?pid=7844640220000";
  const cart = "https://secure-athleta.gap.com/shopping-bag";
  const identity = JSON.parse(JSON.stringify(await runtime.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(canonical + "&vid=1&utm_source=ignored#details")})`)));
  assert.deepEqual(identity, { retailerId: "athleta", retailerSku: "7844640220000", canonicalUrl: canonical });
  for (const url of [canonical + "&vid=2", canonical + "&pid=7678720420000", canonical.replace("7844640220000", "784464022"), canonical.replace("athleta.gap.com", "secure-athleta.gap.com")]) {
    assert.equal(await runtime.invokeBackground(`canonicalRetailerIdentity(${JSON.stringify(url)})`), null, url);
  }
  for (const url of [canonical, cart]) {
    assert.equal(await runtime.invokeBackground(`retailerLanePageUrl("athleta", ${JSON.stringify(url)})`), true);
    assert.equal(await runtime.invokeBackground(`retailerHandoffTab({id: 5, url: ${JSON.stringify(url)}}, {retailerId: "athleta", kind: "needs_you"})`), true);
  }
  assert.equal(await runtime.invokeBackground(`retailerCartTab({id: 5, url: ${JSON.stringify(canonical)}}, "athleta")`), false);
  assert.equal(await runtime.invokeBackground(`retailerCartTab({id: 5, url: ${JSON.stringify(cart)}}, "athleta")`), true);
  for (const url of ["https://gap.com/shopping-bag", cart.replace("secure-athleta", "secure-gap"), cart.replace(".com/", ".com.evil.test/"), cart.replace("https:", "http:"), cart.replace(".com/", ".com:8443/"), cart.replace("https://", "https://name@")]) {
    assert.equal(await runtime.invokeBackground(`retailerLanePageUrl("athleta", ${JSON.stringify(url)})`), false, url);
    assert.equal(await runtime.invokeBackground(`retailerHandoffTab({id: 5, url: ${JSON.stringify(url)}}, {retailerId: "athleta", kind: "needs_you"})`), false, url);
  }
  for (const origin of ["https://athleta.gap.com/*", "https://secure-athleta.gap.com/*"]) {
    const missing = harness({ permittedRetailers: ["athleta"], deniedOrigins: [origin] });
    assert.equal(await missing.invokeBackground('addLaneAccess("athleta")'), false, origin);
    await missing.invokeBackground("runJobCycle()");
    assert.equal(missing.fetchCalls.some(entry => new URL(entry.url).searchParams.get("retailers")?.split(",").includes("athleta")), false);
  }
});

test("privileged companion commands are refused from content scripts and accepted from extension pages", async () => {
  const runtime = harness();
  const extensionId = "a".repeat(32);
  const trackalackerTab = { id: 42, url: "https://www.trackalacker.com/products" };
  const contentSender = { id: extensionId, tab: trackalackerTab, frameId: 0, url: trackalackerTab.url };
  for (const message of [
    { type: "yoink:set-actions-paused", paused: false },
    { type: "yoink:forget-device" },
    { type: "yoink:pair-device", code: "ABCD-EFGH" },
    { type: "yoink:delete-local-data", confirmation: "DELETE_ALL_LOCAL_YOINK_DATA" },
    { type: "yoink:check-update", download: true },
    { type: "yoink:reverify-retailer-lanes", retailerIds: ["target"] },
    { type: "yoink:open-purchase-opportunity", deliveryId: "delivery_fixture" }
  ]) {
    const outcome = await runtime.sendAs(message, contentSender);
    assert.equal(outcome.accepted, false, `${message.type} must not run for a content script`);
    assert.equal(outcome.response?.ok, false);
  }
  // A retailer page sender (injected runner) is refused too.
  const retailerSender = { id: extensionId, tab: { id: 17, url: PRODUCT_URL }, frameId: 0, url: PRODUCT_URL };
  assert.equal((await runtime.sendAs({ type: "yoink:set-actions-paused", paused: true }, retailerSender)).accepted, false);
  // Another extension is refused.
  assert.equal((await runtime.sendAs({ type: "yoink:check-health" },
    { id: "b".repeat(32), url: `chrome-extension://${"b".repeat(32)}/popup.html` })).accepted, false);
  assert.ok(runtime.storage.pairedDevice, "No refused command may change the pairing.");
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.endsWith("/devices/self/settings/actions")), false);

  // TrackaLacker content operations require the top frame of an https TrackaLacker tab.
  const subframe = await runtime.sendAs({ type: "yoink:trackalacker-sync-progress", syncId: "x" },
    { ...contentSender, frameId: 3 });
  assert.equal(subframe.accepted, false);
  const insecure = await runtime.sendAs({ type: "yoink:resolve-trackalacker-listing", url: "http://trackalacker.com/x" },
    { ...contentSender, tab: { id: 42, url: "http://trackalacker.com/products" }, url: "http://trackalacker.com/products" });
  assert.equal(insecure.accepted, false);

  // The options page opens in a tab; its extension URL is what makes it trusted.
  const optionsSender = {
    id: extensionId,
    tab: { id: 50, url: `chrome-extension://${extensionId}/options.html` },
    frameId: 0,
    url: `chrome-extension://${extensionId}/options.html`
  };
  const accepted = await runtime.sendAs({ type: "yoink:check-health" }, optionsSender);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.response?.ok, true);
});

test("a TrackaLacker listing is only resolved over https with credentials", async () => {
  const runtime = harness();
  const sender = {
    id: "a".repeat(32),
    tab: { id: 42, url: "https://www.trackalacker.com/products" },
    frameId: 0,
    url: "https://www.trackalacker.com/products"
  };
  const outcome = await runtime.sendAs({
    type: "yoink:resolve-trackalacker-listing",
    url: "http://www.trackalacker.com/listings/redirect/1"
  }, sender);
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.response?.identity, null);
  assert.equal(runtime.fetchCalls.some((entry) => entry.url.startsWith("http://www.trackalacker.com")), false);
});

test("one heartbeat 401 keeps the pairing; a confirmed second refusal unpairs and tells the shopper", async () => {
  const runtime = harness({ heartbeatStatus: 401 });
  const first = await runtime.send({ type: "yoink:check-health" });
  assert.equal(first.ok, true);
  assert.ok(runtime.storage.pairedDevice, "A single 401 must not delete the pairing.");
  const state = first.state as { connected: boolean; failure: { kind: string; status: number; request: string } };
  assert.equal(state.connected, false);
  assert.deepEqual([state.failure.kind, state.failure.status, state.failure.request], ["refused", 401, "heartbeat"]);
  const failures = runtime.storage.yoinkAuthFailuresV1 as { token: string; firstAt: string };
  assert.ok(failures?.firstAt);
  assert.equal(JSON.stringify(failures).includes("T".repeat(43)), false, "The bearer token must not be copied.");

  // A second refusal inside the confirmation window changes nothing.
  await runtime.send({ type: "yoink:check-health" });
  assert.ok(runtime.storage.pairedDevice);

  // A 401 for a token that is no longer stored never unpairs the current one.
  const stale = await runtime.invokeBackground(`handleHeartbeatUnauthorized("${"S".repeat(43)}", Date.now() + 120000)`) as { removed: boolean };
  assert.equal(stale.removed, false);
  assert.ok(runtime.storage.pairedDevice);

  runtime.storage.yoinkAuthFailuresV1 = { ...failures, firstAt: new Date(Date.now() - 120_000).toISOString() };
  const second = await runtime.send({ type: "yoink:check-health" });
  assert.equal(second.ok, true);
  assert.equal(runtime.storage.pairedDevice, undefined);
  assert.equal((second.state as { paired: boolean }).paired, false);
  assert.ok(runtime.shownNotifications.some((entry) => entry.id === "yoink-unpaired"));
});

test("a heartbeat never writes back a token that was replaced while it was in flight", async () => {
  const runtime = harness();
  const replaced = { id: "device_fixture", token: "R".repeat(43), name: "Desktop - Windows - Chrome", credentialGeneration: 2 };
  const kept = await runtime.invokeBackground(`commitHeartbeatDevice("${"T".repeat(43)}", { id: "device_fixture", name: "Renamed" })
    .then(() => chrome.storage.local.set({ pairedDevice: ${JSON.stringify(replaced)} }))
    .then(() => commitHeartbeatDevice("${"T".repeat(43)}", { id: "device_fixture", name: "Stale" }))`) as { token: string; name: string };
  assert.equal(kept.token, "R".repeat(43));
  assert.equal((runtime.storage.pairedDevice as { token: string; name: string }).token, "R".repeat(43));
  assert.equal((runtime.storage.pairedDevice as { name: string }).name, "Desktop - Windows - Chrome");
});

test("concurrent health checks share one heartbeat; a fresh check runs after it", async () => {
  const runtime = harness();
  const heartbeats = () => runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/heartbeat")).length;
  const before = heartbeats();
  await runtime.invokeBackground("Promise.all([checkHealth(), checkHealth(), checkHealth()])");
  assert.equal(heartbeats() - before, 1);
  await runtime.invokeBackground("Promise.all([checkHealth(), checkHealth({ fresh: true })])");
  assert.equal(heartbeats() - before, 3);
});

test("a refused job lease is recorded, reported in the heartbeat and surfaced to the popup", async () => {
  const runtime = harness({ jobLeaseStatus: 403 });
  await runtime.invokeBackground("runJobCycle()");
  await runtime.invokeBackground("runJobCycle()");
  await runtime.invokeBackground("loopHealthQueue");
  const loops = runtime.storage.yoinkLoopHealthV1 as Record<string, { ok: boolean; status: number; reason: string; consecutiveFailures: number }>;
  assert.equal(loops.jobs?.ok, false);
  assert.equal(loops.jobs?.status, 403);
  assert.equal(loops.jobs?.reason, "cycle_failed");
  assert.equal(loops.jobs?.consecutiveFailures, 2);
  const health = await runtime.send({ type: "yoink:check-health" });
  const heartbeat = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/devices/self/heartbeat")).at(-1);
  const body = JSON.parse(String(heartbeat?.options.body)) as {
    loopHealth: Record<string, { status: number; consecutiveFailures: number }>;
    accessibleRetailers: string[];
  };
  assert.equal(body.loopHealth.jobs?.status, 403);
  assert.equal(body.loopHealth.jobs?.consecutiveFailures, 2);
  assert.ok(Array.isArray(body.accessibleRetailers) && body.accessibleRetailers.includes("target"));
  assert.equal((health.state as { loopHealth: Record<string, { status: number }> }).loopHealth.jobs?.status, 403);
});

test("an unsupported lease is handed back as cancelled instead of blocking the device", async () => {
  const runtime = harness({ unsupportedLeaseFirst: true });
  const result = await runtime.invokeBackground("runJobCycle()") as { reason: string };
  assert.ok(runtime.jobStates.includes("unsupported:cancelled"));
  const event = runtime.fetchCalls.find((entry) => entry.url.endsWith("/jobs/job_unsupported_fixture/events"));
  const body = JSON.parse(String(event?.options.body)) as { reasonCode: string; capabilityToken: string };
  assert.equal(body.reasonCode, "lease_contract_rejected");
  assert.equal(body.capabilityToken, "U".repeat(43));
  assert.equal(result.reason, "lease_contract_rejected");
  // The cycle continued to the next lease after handing the job back.
  assert.ok(runtime.jobLeaseRequests() >= 1);
});

test("malformed signal batch receipts cannot loop the TrackaLacker drain", async () => {
  const runtime = harness({ queuedTrackalackerSignal: true, duplicateReceiptIndexes: true });
  const initial = (runtime.storage.yoinkTrackalackerPushQueueV1 as Array<Record<string, unknown>>)[0]!;
  const notification = initial.notification as Record<string, unknown>;
  runtime.storage.yoinkTrackalackerPushQueueV1 = [
    { ...initial, signalId: "push:trackalacker:first-fixture" },
    { ...initial, signalId: "push:trackalacker:second-fixture", notification: { ...notification, sourceListingId: "991123" } }
  ];
  await runtime.invokeBackground("drainTrackalackerQueue()");
  const batches = runtime.fetchCalls.filter((entry) => entry.url.endsWith("/signals/batch")).length;
  assert.equal(batches, 1, "A malformed receipt must end the drain, not resend the batch.");
  assert.equal((runtime.storage.yoinkTrackalackerPushQueueV1 as unknown[]).length, 2, "Both signals stay queued for a later retry.");
});

test("every worker start ensures the companion alarms exist", async () => {
  const runtime = harness();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const names = new Set(runtime.alarmCreations.map((alarm) => alarm.name));
  for (const name of ["yoink-health", "yoink-jobs", "yoink-auto-reverification"]) {
    assert.ok(names.has(name), `${name} was not created on worker start`);
  }
});

test("completed navigations outside supported stores never touch storage", async () => {
  const runtime = harness();
  const needsWork = await runtime.invokeBackground(`[
    tabUpdateNeedsWork("https://example.com/"),
    tabUpdateNeedsWork("https://www.target.com/p/x/-/A-1"),
    tabUpdateNeedsWork("https://secure-athleta.gap.com/checkout"),
    tabUpdateNeedsWork("https://example.com/#yoink-inspect-and-qualify"),
    tabUpdateNeedsWork("chrome://extensions")
  ]`) as boolean[];
  assert.deepEqual([...needsWork], [false, true, true, true, false]);
});

test("every lane verifies the cart in a separate tab and leaves the Add page loading", async () => {
  for (const retailerId of ["pokemoncenter", "athleta", "asus"]) {
    const runtime = harness();
    const result = await runtime.invokeBackground(`(async () => {
      heartbeatJob = async () => ({ heartbeat: { accepted: true } });
      waitForTab = async () => undefined;
      injectAddAction = async () => undefined;
      publishNeedsYou = async () => undefined;
      reportJob = async () => ({ state: "manual_review" });
      clearActiveJob = async () => undefined;
      executeReadOnlyCartAction = async () => ({ ok: false, reason: "cart_unverified" });
      const active = {
        id: "job_lane_fixture",
        retailerId: "${retailerId}",
        tabId: 17,
        proof: { retailerId: "${retailerId}" },
        cartBaseline: { retailerId: "${retailerId}", lineCount: 0, lines: [] },
        runnerJob: { retailerId: "${retailerId}", retailerSku: "SKU1", expiresAt: new Date(Date.now() + 60000).toISOString() }
      };
      const outcome = await verifyAddedCart(active);
      return { outcome, verificationTabId: active.verificationTabId };
    })()`) as { outcome: { confirmed: boolean }; verificationTabId: number };
    assert.equal(result.outcome.confirmed, false);
    assert.ok(Number.isInteger(result.verificationTabId), `${retailerId} did not open a verification tab`);
    assert.equal(runtime.tabUpdates.some((update) => update.id === 17 && update.url), false,
      `${retailerId} navigated the Add tab away before the store request could finish`);
    assert.ok(runtime.tabCreates.some((tab) => tab.id === result.verificationTabId && tab.active === false));
  }
});

// Kevin, 2026-10-11: one tab from the cart check to checkout. The Add page
// moves on to the cart only once the store has had time to finish the add.
test("Amazon, Target and Walmart confirm the cart in the job's own tab", async () => {
  const lanes = [
    ["walmart", "https://www.walmart.com/cart", "dom_mutation"],
    ["target", "https://www.target.com/cart", "timeout"],
    ["amazon", "https://www.amazon.com/gp/cart/view.html", "tab_complete"]
  ] as const;
  for (const [retailerId, cartUrl, settle] of lanes) {
    const runtime = harness({ storeAddGrace: true });
    const result = await runtime.invokeBackground(`(async () => {
      heartbeatJob = async () => ({ heartbeat: { accepted: true } });
      waitForTab = async () => undefined;
      injectAddAction = async () => undefined;
      publishNeedsYou = async () => undefined;
      captureCartEvidence = async () => null;
      reportJob = async () => ({ state: "manual_review" });
      clearActiveJob = async () => undefined;
      executeReadOnlyCartAction = async () => ({ ok: false, reason: "cart_unverified" });
      const clickedAt = Date.now();
      const active = {
        id: "job_one_tab_fixture",
        retailerId: "${retailerId}",
        tabId: 17,
        proof: { retailerId: "${retailerId}" },
        cartBaseline: { retailerId: "${retailerId}", lineCount: 0, lines: [] },
        timing: { clickedAt },
        postClickSettle: { reason: "${settle}" },
        runnerJob: { retailerId: "${retailerId}", retailerSku: "SKU1", expiresAt: new Date(Date.now() + 60000).toISOString() }
      };
      const outcome = await verifyAddedCart(active);
      return { outcome, waitedMs: Date.now() - clickedAt, verificationTabId: active.verificationTabId ?? null };
    })()`) as { outcome: { confirmed: boolean }; waitedMs: number; verificationTabId: number | null };
    assert.equal(result.outcome.confirmed, false);
    assert.equal(result.verificationTabId, null, `${retailerId} opened a second tab`);
    assert.equal(runtime.tabCreates.length, 0, `${retailerId} opened a second tab`);
    assert.deepEqual(runtime.tabUpdates.filter((update) => update.id === 17 && update.url).map((update) => [update.url, update.active]),
      [[cartUrl, true]], `${retailerId} did not move its own tab to the cart`);
    if (settle === "tab_complete") {
      assert.ok(result.waitedMs < 1_000, `${retailerId} waited ${result.waitedMs} ms after the store moved on by itself`);
    } else {
      assert.ok(result.waitedMs >= 1_900, `${retailerId} left the Add page ${result.waitedMs} ms after the click`);
    }
  }
});

// 2026-10-12: Amazon answered an Add on its cart address with its "Sorry,
// there was a problem" page, and reading that page as the cart failed the job.
test("a job tab the store already moved to its cart address loads the cart again before reading it", async () => {
  const lanes = [
    ["amazon", "https://www.amazon.com/gp/cart/view.html", "https://www.amazon.com/gp/cart/view.html?ref_=sw_refresh"],
    ["walmart", "https://www.walmart.com/cart", "https://www.walmart.com/cart?source=pac"]
  ] as const;
  for (const [retailerId, cartUrl, landedUrl] of lanes) {
    const runtime = harness({ storeAddGrace: true });
    const result = await runtime.invokeBackground(`(async () => {
      heartbeatJob = async () => ({ heartbeat: { accepted: true } });
      injectAddAction = async () => undefined;
      publishNeedsYou = async () => undefined;
      captureCartEvidence = async () => null;
      reportJob = async () => ({ state: "manual_review" });
      clearActiveJob = async () => undefined;
      const moves = [];
      const reads = [];
      navigateRetailerTab = async (tabId, retailer, url) => { moves.push(["navigate", tabId, url]); };
      reloadRetailerTab = async (tabId, retailer, url) => { moves.push(["reload", tabId, url]); };
      executeReadOnlyCartAction = async () => { reads.push(moves.length); return { ok: false, reason: "cart_unverified" }; };
      await chrome.tabs.update(17, { url: "${landedUrl}" });
      const active = {
        id: "job_cart_address_fixture",
        retailerId: "${retailerId}",
        tabId: 17,
        proof: { retailerId: "${retailerId}" },
        cartBaseline: { retailerId: "${retailerId}", lineCount: 0, lines: [] },
        timing: { clickedAt: Date.now() },
        postClickSettle: { reason: "tab_complete" },
        runnerJob: { retailerId: "${retailerId}", retailerSku: "SKU1", expiresAt: new Date(Date.now() + 60000).toISOString() }
      };
      const outcome = await verifyAddedCart(active);
      return { confirmed: outcome.confirmed, moves, reads };
    })()`) as { confirmed: boolean; moves: Array<[string, number, string]>; reads: number[] };
    assert.equal(result.confirmed, false);
    assert.deepEqual(JSON.parse(JSON.stringify(result.moves)), [["reload", 17, cartUrl]],
      `${retailerId} read the page the Add left on its cart address`);
    assert.ok(result.reads.length > 0 && result.reads.every((movesBefore) => movesBefore === 1),
      `${retailerId} read the cart before loading it again: ${JSON.stringify(result.reads)}`);
  }
});

test("a cart read in a second tab still ends on checkout in the job's own tab", async () => {
  const runtime = harness();
  const result = await runtime.invokeBackground(`(async () => {
    reportJobBatch = async () => ({ state: "confirmed" });
    reportRetailerReadiness = async () => null;
    clearActiveJob = async () => undefined;
    const cart = await chrome.tabs.create({ url: "https://www.bestbuy.com/cart", active: false });
    const product = await chrome.tabs.create({ url: "https://www.bestbuy.com/site/-/6528565.p", active: true });
    const active = {
      id: "job_bestbuy_one_tab", retailerId: "bestbuy", tabId: product.id,
      quantityPlan: { requested: 1 },
      cartBaseline: { retailerId: "bestbuy", lineCount: 0, lines: [] },
      runnerJob: { retailerId: "bestbuy", retailerSku: "6528565", maxUnitPriceCents: 5000, maxOrderTotalCents: 6000 }
    };
    const outcome = await completeVerifiedCart(active, { ok: true, proof: {
      contractVersion: 1, jobId: "job_bestbuy_one_tab", retailerId: "bestbuy", retailerSku: "6528565", quantity: 1,
      sellerType: "first_party", unitPriceCents: 4999, observedAt: new Date().toISOString()
    } }, cart.id);
    return { confirmed: outcome.confirmed, product: product.id, cart: cart.id };
  })()`) as { confirmed: boolean; product: number; cart: number };
  assert.equal(result.confirmed, true);
  assert.deepEqual(runtime.tabRemovals, [result.cart], "the second cart tab stays open");
  assert.ok(runtime.tabUpdates.some((update) => update.id === result.product
    && update.url === "https://www.bestbuy.com/checkout/r/fast-track" && update.active === true),
    JSON.stringify(runtime.tabUpdates));
});

// A store's own stop before any Add is named, not reported as a Chrome error.
test("a store tab stuck on a robot check or another item says so", async () => {
  const runtime = harness();
  const reasons = await runtime.invokeBackground(`[
    storeStopReason({ url: "https://www.walmart.com/blocked?url=L2NhcnQ=&uuid=x", title: "Robot or human?" }, "walmart", "cart"),
    storeStopReason({ url: "https://www.walmart.com/ip/12345678", title: "Walmart" }, "walmart", "20670296"),
    storeStopReason({ url: "https://www.amazon.com/errors/validateCaptcha", title: "Amazon.com" }, "amazon", "B00E4AMFKK"),
    storeStopReason({ url: "https://www.bestbuy.com/cart", title: "Access Denied" }, "bestbuy", "cart"),
    storeStopReason({ url: "https://www.walmart.com/ip/20670296", title: "Walmart" }, "walmart", "20670296"),
    storeStopReason({ url: "https://www.walmart.com/cart", title: "Cart" }, "walmart", "cart"),
    storeStopReason({ url: "https://example.com/blocked", title: "Robot or human?" }, "walmart", "cart"),
    storeStopReason({ url: "about:blank", title: "" }, "walmart", "cart")
  ]`) as string[];
  assert.deepEqual([...reasons], ["security_challenge", "listing_mismatch", "security_challenge", "security_challenge", "", "", "", ""]);
  const outcome = await runtime.invokeBackground(`(async () => {
    const events = [];
    reportJob = async (active, state, reasonCode) => { events.push([state, reasonCode]); return { state }; };
    publishActionStopped = async () => undefined;
    clearActiveJob = async () => undefined;
    reportRetailerReadiness = async () => null;
    const blocked = await chrome.tabs.create({ url: "https://www.walmart.com/blocked?url=L2NhcnQ=", active: false });
    const moved = await chrome.tabs.create({ url: "https://www.walmart.com/ip/12345678", active: true });
    await stopOnStorePage({ id: "job_blocked", retailerId: "walmart", tabId: blocked.id, runnerJob: { retailerSku: "20670296" } }, "security_challenge");
    await stopOnStorePage({ id: "job_moved", retailerId: "walmart", tabId: moved.id, runnerJob: { retailerSku: "20670296" } }, "listing_mismatch");
    return JSON.stringify({ events, blocked: blocked.id, moved: moved.id });
  })()`).then((value) => JSON.parse(String(value))) as { events: string[][]; blocked: number; moved: number };
  assert.deepEqual(outcome.events, [["cancelled", "security_challenge"], ["cancelled", "listing_mismatch"]]);
  assert.ok(runtime.tabUpdates.some((update) => update.id === outcome.blocked && update.active === true), "the robot check isn't shown to the shopper");
  assert.deepEqual(runtime.tabRemovals, [outcome.moved], "only the other item's tab closes");
});

test("a ready health check clears stale Background checks failures left by a server restart", async () => {
  const runtime = harness();
  const stale = new Date(Date.now() - 60_000).toISOString();
  runtime.storage.yoinkLoopHealthV1 = {
    health: { at: stale, reason: "health_failed", ok: false, status: 0, code: "", consecutiveFailures: 2, lastOkAt: "" }
  };
  const result = await runtime.send({ type: "yoink:check-health" });
  assert.equal(result.ok, true);
  await runtime.invokeBackground("loopHealthQueue");
  const loops = runtime.storage.yoinkLoopHealthV1 as Record<string, { ok: boolean; consecutiveFailures: number; reason: string }>;
  assert.equal(loops.health?.ok, true);
  assert.equal(loops.health?.consecutiveFailures, 0);
  assert.equal(loops.health?.reason, "ready");
});
