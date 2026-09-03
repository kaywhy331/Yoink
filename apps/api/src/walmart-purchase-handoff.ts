import type {
  CurrentWalmartPurchaseHandoff
} from "../../../packages/database/src/walmart-purchase-handoff-interaction-repository.js";
import type { UserActionHandoffSummary } from "../../../packages/database/src/signal-repository.js";

export {
  deriveWalmartPurchaseHandoff,
  type WalmartPurchaseHandoff
} from "../../../packages/domain/src/walmart-purchase-handoff.js";

export type UserActionHandoffWithWalmart = Omit<UserActionHandoffSummary, "primary"> & {
  primary: UserActionHandoffSummary["primary"] | {
    id: string;
    stage: "purchase_ready";
    statusLabel: "Buy at Walmart";
    statusSummary: string;
    title: string;
    retailerId: "walmart";
    retailerSku: string;
    canonicalUrl: string;
    createdAt: string;
    purchaseHandoff: CurrentWalmartPurchaseHandoff["purchaseHandoff"];
  };
};

export function withWalmartPurchaseHandoff(
  summary: UserActionHandoffSummary,
  walmart: CurrentWalmartPurchaseHandoff | null
): UserActionHandoffWithWalmart {
  // A cart that is ready or needs review remains more urgent than a manual
  // reviewOrder opportunity. Only fill an otherwise idle Home action slot.
  if (summary.primary || !walmart) return summary;
  return {
    ...summary,
    primary: {
      id: walmart.jobId,
      stage: "purchase_ready",
      statusLabel: "Buy at Walmart",
      statusSummary: "Validated in stock and within your saved price, seller, and shipping rules.",
      title: walmart.title,
      retailerId: walmart.retailerId,
      retailerSku: walmart.retailerSku,
      canonicalUrl: walmart.canonicalUrl,
      createdAt: walmart.createdAt,
      purchaseHandoff: walmart.purchaseHandoff
    }
  };
}
