import type {
  RetailerAdapterDiagnosticOperation,
  RetailerAdapterDiagnosticOutcome,
  RetailerAdapterDiagnosticReasonCode,
  RetailerAdapterDiagnosticStage
} from "../../contracts/src/index.js";

export const ADAPTER_DIAGNOSTIC_CLASSES = [
  "adapter_defect", "listing_state", "interactive_block", "policy", "infrastructure", "none"
] as const;
export type AdapterDiagnosticClass = (typeof ADAPTER_DIAGNOSTIC_CLASSES)[number];

export const ADAPTER_DIAGNOSTIC_CLASS_BY_REASON = {
  verified: "none",
  dom_hydration_recovered: "none",
  semantic_layout_recovered: "none",
  offer_route_verified: "none",
  clicked: "none",
  not_applicable: "none",

  availability_selector_miss: "adapter_defect",
  add_control_selector_miss: "adapter_defect",
  add_control_missing: "adapter_defect",
  add_control_ambiguous: "adapter_defect",
  explicit_sku_binding_missing: "adapter_defect",
  explicit_sku_binding_ambiguous: "adapter_defect",
  offer_binding_missing: "adapter_defect",
  offer_binding_ambiguous: "adapter_defect",
  price_selector_miss: "adapter_defect",
  price_binding_missing: "adapter_defect",
  seller_selector_miss: "adapter_defect",
  seller_binding_missing: "adapter_defect",
  fulfillment_selector_miss: "adapter_defect",
  fulfillment_binding_missing: "adapter_defect",
  offer_id_missing_or_ambiguous: "adapter_defect",
  route_validation_failed: "adapter_defect",
  route_binding_failed: "adapter_defect",
  rehearsal_failed: "adapter_defect",
  add_control_unavailable: "adapter_defect",
  add_control_changed: "adapter_defect",
  fulfillment_selection_failed: "adapter_defect",
  offer_binding_changed: "adapter_defect",
  seller_unverified: "adapter_defect",
  price_unavailable: "adapter_defect",
  fulfillment_unverified: "adapter_defect",
  offer_unverified: "adapter_defect",
  cart_unverified: "adapter_defect",
  verified_empty: "adapter_defect",

  out_of_stock: "listing_state",
  product_page_unavailable: "listing_state",
  product_identity_missing: "listing_state",
  listing_mismatch: "listing_state",
  offer_not_actionable: "listing_state",
  offer_scope_not_actionable: "listing_state",
  add_control_disabled: "listing_state",
  selected_offer_binding_unresolved: "listing_state",
  listing_unavailable_layout: "listing_state",
  listing_variant_unselected: "listing_state",
  preorder_not_supported: "listing_state",
  quantity_unavailable: "listing_state",

  security_challenge: "interactive_block",
  interactive_auth: "interactive_block",
  interactive_mfa: "interactive_block",
  interactive_location: "interactive_block",
  interactive_membership: "interactive_block",
  interactive_queue: "interactive_block",
  interactive_high_demand: "interactive_block",
  interactive_unknown: "interactive_block",
  manual_action_required: "interactive_block",

  third_party_seller: "policy",
  signal_seller_mismatch: "policy",
  over_unit_cap: "policy",
  fulfillment_not_supported: "policy",
  seller_policy_not_supported: "policy",
  quantity_not_supported: "policy",
  unsupported_action: "policy",
  job_expired: "policy",
  offer_stale: "policy",
  currency_mismatch: "policy",
  foreign_cart_line: "policy",

  observer_bundle_injection_failed: "infrastructure",
  observer_execution_failed: "infrastructure",
  observer_top_frame_missing: "infrastructure",
  observer_runtime_unavailable: "infrastructure",
  observer_collection_failed: "infrastructure",
  observer_contract_invalid: "infrastructure",
  runner_unavailable: "infrastructure",
  runner_failed: "infrastructure",
  runner_no_result: "infrastructure",
  adapter_version_mismatch: "infrastructure",
  contract_version_mismatch: "infrastructure",
  job_identity_invalid: "infrastructure",
  canonical_url_invalid: "infrastructure",
  quantity_invalid: "infrastructure",
  unit_cap_invalid: "infrastructure",
  total_cap_invalid: "infrastructure",
  authorization_missing: "infrastructure",
  authorization_expired: "infrastructure",
  click_failed: "infrastructure",
  click_uncertain: "infrastructure",
  cart_evidence_stale: "infrastructure",
  offer_proof_mismatch: "infrastructure",
  product_page_unverified: "infrastructure",
  cart_page_unverified: "infrastructure"
} as const satisfies Record<RetailerAdapterDiagnosticReasonCode, AdapterDiagnosticClass>;

export function classifyAdapterDiagnostic(input: {
  operation: RetailerAdapterDiagnosticOperation | string;
  outcome: RetailerAdapterDiagnosticOutcome | string;
  failureStage: RetailerAdapterDiagnosticStage | string;
  reasonCode: RetailerAdapterDiagnosticReasonCode | string;
}): AdapterDiagnosticClass {
  return (ADAPTER_DIAGNOSTIC_CLASS_BY_REASON as Record<string, AdapterDiagnosticClass>)[input.reasonCode]
    ?? "infrastructure";
}
