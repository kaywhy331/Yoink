import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("dashboard renderers use retailer display-name helpers instead of raw retailer ids", () => {
  const root = process.cwd();
  const shopper = readFileSync(join(root, "apps", "web", "user.js"), "utf8");
  const admin = readFileSync(join(root, "apps", "web", "app.js"), "utf8");

  assert.doesNotMatch(shopper, /escapeHtml\((?:action|proposal)\.retailerId\)/);
  assert.match(shopper, /retailerDisplayName\(action\.retailerId\)/);
  assert.match(shopper, /retailerDisplayName\(proposal\.retailerId\)/);
  assert.doesNotMatch(admin, /escapeHtml\((?:signal|notification|receipt|job)\.retailerId\b/);
  for (const subject of ["signal", "notification", "receipt", "job"]) {
    assert.match(admin, new RegExp(`retailerName\\(${subject}\\.retailerId\\)`));
  }
});

test("admin source and governance cards humanise machine values with label maps", () => {
  const admin = readFileSync(join(process.cwd(), "apps", "web", "app.js"), "utf8");
  assert.doesNotMatch(admin, /· \$\{escapeHtml\(source\.trustLevel\)\}|<small>\$\{escapeHtml\(source\.status\)\}|<p>\$\{escapeHtml\(source\.source\)\}/);
  for (const helper of ["sourceKindLabel(source.source)", "sourceTrustLabel(source.trustLevel)", "sourceStatusLabel(source.status)"]) {
    assert.ok(admin.includes(helper), `${helper} should render source cards`);
  }
  assert.match(admin, /trackalacker: "TrackaLacker"/);
  assert.match(admin, /trusted_exact: "Trusted source"/);
  assert.doesNotMatch(admin, /escapeHtml\(operation\.(?:requestedByActorId|reviewedByActorId)\)/);
  assert.match(admin, /operation\.requestedByDisplayName \|\| "Unknown user"/);
  assert.doesNotMatch(admin, /\$\{user\.id\} · \$\{user\.planCount\}|\$\{escapeHtml\(plan\.id\)\} · /);
});
