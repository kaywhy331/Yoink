import type { YoinkDatabase } from "./database.js";
import { QualificationRepository } from "./qualification-repository.js";

const RETAILERS = [
  ["target", "Target"],
  ["walmart", "Walmart"],
  ["amazon", "Amazon"],
  ["bestbuy", "Best Buy"]
] as const;

interface Requirement {
  id: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface FutureMutationLaneReadiness {
  id: string;
  retailerId: string;
  retailerName: string;
  lane: "prepare_checkout" | "submit_order";
  status: "closed";
  packagedAdapterVersion: "";
  mutationAuthorized: false;
  requirements: Requirement[];
}

export class MutationLaneRepository {
  constructor(private readonly db: YoinkDatabase) {}

  readiness(_now = Date.now()): {
    policyVersion: "advanced-mutation-gates-v1";
    mutationAuthorized: false;
    lanes: FutureMutationLaneReadiness[];
  } {
    const qualifications = new QualificationRepository(this.db);
    const addQualified: Record<string, boolean> = {
      target: qualifications.targetAddQualified(),
      walmart: qualifications.walmartAddQualified(),
      amazon: qualifications.amazonAddQualified(),
      bestbuy: qualifications.bestBuyAddQualified()
    };
    const lanes: FutureMutationLaneReadiness[] = [];
    for (const [retailerId, retailerName] of RETAILERS) {
      lanes.push({
        id: `${retailerId}_prepare_checkout`,
        retailerId,
        retailerName,
        lane: "prepare_checkout",
        status: "closed",
        packagedAdapterVersion: "",
        mutationAuthorized: false,
        requirements: [
          {
            id: "add_lane",
            label: "Independent add-only lane",
            met: addQualified[retailerId] === true,
            detail: addQualified[retailerId] ? "The exact-fulfillment add-only lane is qualified for this user." : "First qualify the narrower add-only lane."
          },
          {
            id: "packaged_adapter",
            label: "Packaged review-boundary adapter",
            met: false,
            detail: "No runner is permitted to navigate beyond the exact cart proof into checkout."
          },
          {
            id: "review_rehearsal",
            label: "No-submit checkout rehearsal",
            met: false,
            detail: "A future runner must stop at a user-visible review boundary with no destination, payment, or submit interaction."
          },
          {
            id: "explicit_activation",
            label: "Explicit prepare-checkout activation",
            met: false,
            detail: "This remains a separate per-retailer gate; add-only qualification cannot authorize it."
          }
        ]
      });
      lanes.push({
        id: `${retailerId}_submit_order`,
        retailerId,
        retailerName,
        lane: "submit_order",
        status: "closed",
        packagedAdapterVersion: "",
        mutationAuthorized: false,
        requirements: [
          { id: "destination_fingerprint", label: "Approved destination fingerprint", met: false, detail: "No raw address may be persisted or remotely supplied." },
          { id: "payment_fingerprint", label: "Approved payment fingerprint", met: false, detail: "No payment credential or payment-frame recorder is implemented." },
          { id: "total_verification", label: "Exact final-total verification", met: false, detail: "Item, quantity, seller, fulfillment, tax, shipping, discounts, and total must agree at the final boundary." },
          { id: "confirmation_evidence", label: "Order confirmation evidence", met: false, detail: "A successful submit must prove an exact retailer confirmation without storing account or payment data." },
          { id: "uncertain_recovery", label: "Uncertain-submit recovery", met: false, detail: "Timeouts and ambiguous responses must lock to manual review and never retry submission automatically." },
          { id: "packaged_adapter", label: "Packaged submit adapter and activation", met: false, detail: "No submit runner or activation endpoint exists. Remote observer recipes can never add one." }
        ]
      });
    }
    return { policyVersion: "advanced-mutation-gates-v1", mutationAuthorized: false, lanes };
  }
}
