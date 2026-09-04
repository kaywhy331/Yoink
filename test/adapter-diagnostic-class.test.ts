import assert from "node:assert/strict";
import test from "node:test";
import {
  RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES,
  type RetailerAdapterDiagnosticReasonCode
} from "../packages/contracts/src/index.js";
import {
  ADAPTER_DIAGNOSTIC_CLASSES,
  ADAPTER_DIAGNOSTIC_CLASS_BY_REASON,
  classifyAdapterDiagnostic
} from "../packages/domain/src/adapter-diagnostic-class.js";

test("every adapter diagnostic reason maps to exactly one class", () => {
  assert.deepEqual(
    Object.keys(ADAPTER_DIAGNOSTIC_CLASS_BY_REASON).sort(),
    [...RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES].sort()
  );
  for (const reasonCode of RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES) {
    const diagnosticClass = classifyAdapterDiagnostic({
      operation: "observe",
      outcome: "failed",
      failureStage: "runner",
      reasonCode
    });
    assert.ok(ADAPTER_DIAGNOSTIC_CLASSES.includes(diagnosticClass), reasonCode);
  }
});

test("listing and interstitial states cannot be mistaken for adapter defects", () => {
  const classify = (reasonCode: RetailerAdapterDiagnosticReasonCode) => classifyAdapterDiagnostic({
    operation: "observe", outcome: "rejected", failureStage: "availability_binding", reasonCode
  });
  assert.equal(classify("listing_unavailable_layout"), "listing_state");
  assert.equal(classify("listing_variant_unselected"), "listing_state");
  assert.equal(classify("security_challenge"), "interactive_block");
  assert.equal(classify("price_binding_missing"), "adapter_defect");
});
