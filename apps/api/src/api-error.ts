import { sanitizeDiagnosticData } from "../../../packages/domain/src/redaction.js";
import { AuthorizationError } from "../../../packages/database/src/authorization-repository.js";
import { PurchaseSafetyError } from "../../../packages/database/src/purchase-policy-repository.js";
import { CatalogIdentityGovernanceError } from "../../../packages/database/src/catalog-identity-governance-repository.js";
import { OperatorAlertError } from "../../../packages/database/src/operator-alert-repository.js";
import { AdminChangeControlError } from "../../../packages/database/src/admin-change-control-repository.js";

export interface ApiErrorPayload {
  error: string;
  message: string;
  correlationId: string;
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

export function apiErrorPayload(error: unknown, correlationId: string): { status: number; payload: ApiErrorPayload } {
  if (error instanceof AuthorizationError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof PurchaseSafetyError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof CatalogIdentityGovernanceError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof OperatorAlertError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof AdminChangeControlError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof ApiError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  const rawMessage = error instanceof Error ? error.message : "The request failed.";
  const message = String(sanitizeDiagnosticData(rawMessage));
  const authenticationFailure = /authenticated request scope|authenticated tenant\/user principal/i.test(message);
  const internalFailure = error instanceof TypeError
    || /(?:SQLITE|database is (?:locked|malformed)|no such (?:table|column)|FOREIGN KEY constraint failed)/i.test(message);
  if (internalFailure) {
    return {
      status: 500,
      payload: {
        error: "internal_error",
        message: "Yoink could not complete the request safely.",
        correlationId
      }
    };
  }
  return {
    status: authenticationFailure ? 401 : 400,
    payload: {
      error: authenticationFailure ? "authentication_required" : "request_rejected",
      message,
      correlationId
    }
  };
}
