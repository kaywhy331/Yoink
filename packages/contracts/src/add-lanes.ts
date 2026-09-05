export const ADD_LANE_IDS = ["target", "walmart", "amazon", "bestbuy"] as const;
export type AddLaneId = (typeof ADD_LANE_IDS)[number];

export interface AddLaneDefinition {
  id: AddLaneId;
  name: string;
  domain: string;
  contractVersion: string;
  packVersion: string;
  observerVersion: string;
  activationConfirmation: string;
  firstPartySeller: string;
  capability: Readonly<{ enabled: string; version: string }>;
  rehearsalEvidenceNamespace: string;
  qualificationEvidenceNamespace: string;
  cartUrl: string;
  runnerFile: string;
  runnerGlobal: string;
  operations: Readonly<{
    rehearse: string;
    baseline: string;
    prepare: string;
    commit: string;
    verifyCart: string;
  }>;
  skuPattern: string;
  supportedFulfillment: readonly ("shipping" | "pickup")[];
  trialRouteSlug: string;
  rehearsalPolicy: "first_party_shipping" | "first_party_exact_route";
  rehearsalGuidance: Readonly<{
    default: string;
    highDemand?: string;
    securityChallenge?: string;
    auth?: string;
    mfa?: string;
    location?: string;
    pickup?: string;
  }>;
}

function lane(definition: AddLaneDefinition): Readonly<AddLaneDefinition> {
  return Object.freeze({
    ...definition,
    capability: Object.freeze({ ...definition.capability }),
    operations: Object.freeze({ ...definition.operations }),
    supportedFulfillment: Object.freeze([...definition.supportedFulfillment]),
    rehearsalGuidance: Object.freeze({ ...definition.rehearsalGuidance })
  });
}

/**
 * The sole registry for guarded-add lane wiring. Selector data remains in the
 * local pack files; this registry contains only packaged identities and policy
 * hooks and is compiled into the Chrome companion.
 */
export const ADD_LANES: Readonly<Record<AddLaneId, Readonly<AddLaneDefinition>>> = Object.freeze({
  target: lane({
    id: "target",
    name: "Target",
    domain: "target.com",
    contractVersion: "target-add-v9",
    packVersion: "target-pack-v1",
    observerVersion: "target-observer-v7",
    activationConfirmation: "ENABLE_TARGET_ADD_V9",
    firstPartySeller: "Target",
    capability: { enabled: "targetAddOnly", version: "targetAddAdapterVersion" },
    rehearsalEvidenceNamespace: "target-add-rehearsal-v1",
    qualificationEvidenceNamespace: "target-add-qualification-evidence-v1",
    cartUrl: "https://www.target.com/cart",
    runnerFile: "target-action.js",
    runnerGlobal: "YoinkTargetAction",
    operations: {
      rehearse: "rehearseTargetAdd",
      baseline: "inspectTargetCartBaseline",
      prepare: "prepareTargetAdd",
      commit: "commitTargetAdd",
      verifyCart: "verifyTargetAddedCart"
    },
    skuPattern: "^\\d{6,20}$",
    supportedFulfillment: ["shipping", "pickup"],
    trialRouteSlug: "target-add",
    rehearsalPolicy: "first_party_shipping",
    rehearsalGuidance: {
      default: "Open an available Target-sold product with Shipping or same-day Delivery available before running the no-click rehearsal."
    }
  }),
  walmart: lane({
    id: "walmart",
    name: "Walmart",
    domain: "walmart.com",
    contractVersion: "walmart-add-v9",
    packVersion: "walmart-pack-v1",
    observerVersion: "walmart-observer-v8",
    activationConfirmation: "ENABLE_WALMART_ADD_V9",
    firstPartySeller: "Walmart",
    capability: { enabled: "walmartAddOnly", version: "walmartAddAdapterVersion" },
    rehearsalEvidenceNamespace: "walmart-add-rehearsal-v1",
    qualificationEvidenceNamespace: "walmart-add-qualification-evidence-v1",
    cartUrl: "https://www.walmart.com/cart",
    runnerFile: "walmart-action.js",
    runnerGlobal: "YoinkWalmartAction",
    operations: {
      rehearse: "rehearseWalmartAdd",
      baseline: "inspectWalmartCartBaseline",
      prepare: "prepareWalmartAdd",
      commit: "commitWalmartAdd",
      verifyCart: "verifyWalmartAddedCart"
    },
    skuPattern: "^\\d{5,20}$",
    supportedFulfillment: ["shipping", "pickup"],
    trialRouteSlug: "walmart-add",
    rehearsalPolicy: "first_party_shipping",
    rehearsalGuidance: {
      default: "Open an available Walmart-sold product with shipping explicitly available before running the no-click rehearsal."
    }
  }),
  amazon: lane({
    id: "amazon",
    name: "Amazon",
    domain: "amazon.com",
    contractVersion: "amazon-add-v10",
    packVersion: "amazon-pack-v2",
    observerVersion: "amazon-observer-v9",
    activationConfirmation: "ENABLE_AMAZON_ADD_V10",
    firstPartySeller: "Amazon.com",
    capability: { enabled: "amazonAddOnly", version: "amazonAddAdapterVersion" },
    rehearsalEvidenceNamespace: "amazon-add-rehearsal-v4",
    qualificationEvidenceNamespace: "amazon-add-qualification-evidence-v1",
    cartUrl: "https://www.amazon.com/gp/cart/view.html",
    runnerFile: "amazon-action.js",
    runnerGlobal: "YoinkAmazonAction",
    operations: {
      rehearse: "rehearseAmazonAdd",
      baseline: "inspectAmazonCartBaseline",
      prepare: "prepareAmazonAdd",
      commit: "commitAmazonAdd",
      verifyCart: "verifyAmazonAddedCart"
    },
    skuPattern: "^[A-Z0-9]{10}$",
    supportedFulfillment: ["shipping"],
    trialRouteSlug: "amazon-add",
    rehearsalPolicy: "first_party_exact_route",
    rehearsalGuidance: {
      default: "Open an available Amazon.com-sold product with a unique shipping offer before running the no-click rehearsal."
    }
  }),
  bestbuy: lane({
    id: "bestbuy",
    name: "Best Buy",
    domain: "bestbuy.com",
    contractVersion: "bestbuy-add-v15",
    packVersion: "bestbuy-pack-v1",
    observerVersion: "bestbuy-observer-v13",
    activationConfirmation: "ENABLE_BESTBUY_ADD_V15",
    firstPartySeller: "Best Buy",
    capability: { enabled: "bestBuyAddOnly", version: "bestBuyAddAdapterVersion" },
    rehearsalEvidenceNamespace: "bestbuy-add-rehearsal-v1",
    qualificationEvidenceNamespace: "bestbuy-add-qualification-evidence-v1",
    cartUrl: "https://www.bestbuy.com/cart",
    runnerFile: "bestbuy-action.js",
    runnerGlobal: "YoinkBestBuyAction",
    operations: {
      rehearse: "rehearseBestBuyAdd",
      baseline: "inspectBestBuyCartBaseline",
      prepare: "prepareBestBuyAdd",
      commit: "commitBestBuyAdd",
      verifyCart: "verifyBestBuyAddedCart"
    },
    skuPattern: "^\\d{5,20}$",
    supportedFulfillment: ["shipping", "pickup"],
    trialRouteSlug: "bestbuy-add",
    rehearsalPolicy: "first_party_shipping",
    rehearsalGuidance: {
      default: "Open an available offer explicitly sold by Best Buy, select Shipping, and verify a usable Add to cart or Pre-order control before rehearsing.",
      highDemand: "Best Buy high-demand or queue evidence was recorded, but automated demand-gate handling remains closed.",
      securityChallenge: "Complete the visible Best Buy security check in this tab, then retry qualification.",
      auth: "Sign in to Best Buy in this tab, confirm your location, then retry qualification.",
      mfa: "Complete Best Buy account verification in this tab, then retry qualification.",
      location: "Confirm your Best Buy location and select Shipping, then retry qualification.",
      pickup: "Best Buy pickup evidence was recorded. Select Shipping on an available Best Buy-sold offer before rehearsing."
    }
  })
});

export function addLane(value: string): Readonly<AddLaneDefinition> | null {
  return ADD_LANES[value as AddLaneId] ?? null;
}
