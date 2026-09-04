import { sanitizeDiagnosticData } from "../../../packages/domain/src/redaction.js";
import { SignalValidationError } from "../../../packages/domain/src/normalize.js";
import { InputValidationError } from "../../../packages/domain/src/input-validation-error.js";
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
  if (error instanceof InputValidationError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof SignalValidationError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof AdminSignalSimulationError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
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
  if (error instanceof OperatorAlertConnectorError) {
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
  if (error instanceof CatalogLinkError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof BackgroundTaskError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof HostedDeliveryError) {
    return {
      status: error.status,
      payload: { error: error.code, message: error.message, correlationId }
    };
  }
  if (error instanceof ObserverRecipeRecoveryReviewError) {
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
  if (authenticationFailure) return {
    status: 401,
    payload: { error: "authentication_required", message, correlationId }
  };
  return {
    status: 500,
    payload: {
      error: "internal_error",
      message: "Yoink could not complete the request safely.",
      correlationId
    }
  };
}
