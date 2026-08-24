import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiErrorPayload } from "../apps/api/src/api-error.js";
import { AuthorizationError } from "../packages/database/src/authorization-repository.js";
import { CatalogIdentityGovernanceError } from "../packages/database/src/catalog-identity-governance-repository.js";

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
  assert.equal(apiErrorPayload(new Error("The request body is invalid."), correlationId).status, 400);
  assert.equal(apiErrorPayload(new Error("The authenticated request scope is invalid."), correlationId).status, 401);
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
