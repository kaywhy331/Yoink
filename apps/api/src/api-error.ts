import { sanitizeDiagnosticData } from "../../../packages/domain/src/redaction.js";
import { SignalValidationError } from "../../../packages/domain/src/normalize.js";
import { DomainRequestError } from "../../../packages/domain/src/domain-request-error.js";
import { AuthorizationError } from "../../../packages/database/src/authorization-repository.js";
import { PurchaseSafetyError } from "../../../packages/database/src/purchase-policy-repository.js";
import { CatalogIdentityGovernanceError } from "../../../packages/database/src/catalog-identity-governance-repository.js";
import { OperatorAlertError } from "../../../packages/database/src/operator-alert-repository.js";
import { OperatorAlertConnectorError } from "../../../packages/database/src/operator-alert-connector-repository.js";
import { AdminChangeControlError } from "../../../packages/database/src/admin-change-control-repository.js";
import { CatalogLinkError } from "../../../packages/database/src/catalog-link-repository.js";
import { BackgroundTaskError } from "../../../packages/database/src/background-task-repository.js";
import { HostedDeliveryError } from "../../../packages/database/src/hosted-delivery-repository.js";
import { ObserverRecipeRecoveryReviewError } from "../../../packages/database/src/observer-recipe-repository.js";
import { AdminSignalSimulationError } from "../../../packages/engine/src/admin-signal-simulator.js";
import { EvidenceCapsuleStoreError } from "../../../packages/database/src/evidence-capsule-store.js";
import { TestAlertError } from "../../../packages/database/src/delivery-health-repository.js";

export interface ApiErrorPayload {
  error: string;
  message: string;
  correlationId: string;
  /** Machine-readable context for a 4xx (blockers, next action, conflicting ids). Absent on 5xx. */
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * One sanitized line for the service journal. Server errors carry their
 * redacted message so a masked 500 is diagnosable; rejected device posts
 * carry only route, status, and code.
 */
export function apiErrorLogLine(
  problem: { status: number; payload: ApiErrorPayload },
  error: unknown,
  method: string,
  pathname: string
): string {
  const detail = problem.status >= 500 && error instanceof Error
    ? ` ${String(sanitizeDiagnosticData(error.message)).slice(0, 300)}`
    : "";
  return `Yoink request rejected: ${method} ${pathname} -> ${problem.status} ${problem.payload.error} [${problem.payload.correlationId}]${detail}\n`;
}

/**
 * Typed rejections that predate DomainRequestError and still declare their
 * own `code` and `status`. One table instead of one copy-pasted branch per
 * class (API-20); a class that extends DomainRequestError needs no entry.
 */
const TYPED_ERROR_CLASSES: ReadonlyArray<abstract new (...args: never[]) => Error & { code: string; status: number }> = [
  SignalValidationError,
  AdminSignalSimulationError,
  AuthorizationError,
  PurchaseSafetyError,
  CatalogIdentityGovernanceError,
  OperatorAlertError,
  OperatorAlertConnectorError,
  AdminChangeControlError,
  CatalogLinkError,
  BackgroundTaskError,
  HostedDeliveryError,
  ObserverRecipeRecoveryReviewError,
  EvidenceCapsuleStoreError,
  TestAlertError,
  ApiError
];

export function apiErrorPayload(error: unknown, correlationId: string): { status: number; payload: ApiErrorPayload } {
  // One branch covers every typed domain rejection: validation, conflicts,
  // blocked state changes, authentication. Subclasses carry their own code and status.
  if (error instanceof DomainRequestError) {
    return {
      status: error.status,
      payload: {
        error: error.code,
        message: error.message,
        correlationId,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }
  const typed = TYPED_ERROR_CLASSES.find((errorClass) => error instanceof errorClass) ? error as Error & { code: string; status: number } : null;
  if (typed) {
    return {
      status: typed.status,
      payload: { error: typed.code, message: typed.message, correlationId }
    };
  }
  return {
    status: 500,
    payload: {
      error: "internal_error",
      message: "Yoink could not complete the request safely.",
      correlationId
    }
  };
}
