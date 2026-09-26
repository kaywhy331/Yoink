import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiErrorPayload } from "../apps/api/src/api-error.js";
import { AuthorizationError } from "../packages/database/src/authorization-repository.js";
import { CatalogIdentityGovernanceError } from "../packages/database/src/catalog-identity-governance-repository.js";
import { HostedDeliveryError } from "../packages/database/src/hosted-delivery-repository.js";
import { AuthenticationRequiredError } from "../packages/database/src/request-scope.js";
import { DomainNotFoundError } from "../packages/domain/src/domain-request-error.js";

test("API problems preserve safe status taxonomy and correlation IDs", () => {
  const correlationId = "request_taxonomy_001";
  assert.deepEqual(apiErrorPayload(new ApiError("missing", 404, "Missing."), correlationId), {
    status: 404,
    payload: { error: "missing", message: "Missing.", correlationId }
  });
  assert.deepEqual(apiErrorPayload(new AuthorizationError("permission_denied", 403, "Denied."), correlationId), {
    status: 403,
    payload: { error: "permission_denied", message: "Denied.", correlationId }
  });
  assert.deepEqual(apiErrorPayload(
    new CatalogIdentityGovernanceError("catalog_identity_topology_stale", 409, "Submit a fresh operation."),
    correlationId
  ), {
    status: 409,
    payload: {
      error: "catalog_identity_topology_stale",
      message: "Submit a fresh operation.",
      correlationId
    }
  });
  assert.deepEqual(apiErrorPayload(
    new HostedDeliveryError("hosted_inbox_state_conflict", 409, "Retry only a dead letter."),
    correlationId
  ), {
    status: 409,
    payload: {
      error: "hosted_inbox_state_conflict",
      message: "Retry only a dead letter.",
      correlationId
    }
  });
  assert.equal(apiErrorPayload(new Error("The request body is invalid."), correlationId).status, 500);
  // Authentication failures are typed (401), not guessed from message text (API-11).
  assert.deepEqual(apiErrorPayload(new AuthenticationRequiredError("The authenticated step-up context is expired or malformed."), correlationId), {
    status: 401,
    payload: {
      error: "authentication_required",
      message: "The authenticated step-up context is expired or malformed.",
      correlationId
    }
  });
  assert.equal(apiErrorPayload(new Error("The authenticated request scope is invalid."), correlationId).status, 500);
  assert.equal(apiErrorPayload(new DomainNotFoundError("claim_not_found", "Not found."), correlationId).status, 404);
});

test("unexpected implementation and database failures become opaque 500 problems", () => {
  const typeFailure = apiErrorPayload(new TypeError("Cannot read secrets from undefined"), "request_internal_001");
  assert.deepEqual(typeFailure, {
    status: 500,
    payload: {
      error: "internal_error",
      message: "Yoink could not complete the request safely.",
      correlationId: "request_internal_001"
    }
  });
  const databaseFailure = apiErrorPayload(new Error("SQLITE_CONSTRAINT: raw database detail"), "request_internal_002");
  assert.equal(databaseFailure.status, 500);
  assert.equal(databaseFailure.payload.message.includes("raw database detail"), false);
});
