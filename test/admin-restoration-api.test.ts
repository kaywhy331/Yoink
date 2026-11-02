import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { createYoinkServer } from '../apps/api/src/app.js';
import { RESTOCK_RETRY_LIMITS } from '../packages/contracts/src/index.js';
import { initializeTenantUserWorkspace, AuthorizationRepository } from '../packages/database/src/authorization-repository.js';
import { ControlRepository } from '../packages/database/src/control-repository.js';
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from '../packages/database/src/database.js';
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from '../packages/database/src/request-scope.js';

test('admin retry metadata and persistence stay authorized and scoped to the current tenant and user', async () => {
  const db = new YoinkDatabase();
  const sibling = new AuthorizationRepository(db).createTenantUser({ displayName: 'Other user' });
  const now = new Date().toISOString();
  db.run('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)', 'tenant_retry_other', 'Other tenant', now);
  db.run('INSERT INTO users(id,tenant_id,display_name,created_at) VALUES (?,?,?,?)', 'user_retry_other', 'tenant_retry_other', 'Other', now);
  const other: RequestScope = { tenantId: 'tenant_retry_other', userId: 'user_retry_other', actorKind: 'user', actorId: 'user_retry_other' };
  initializeTenantUserWorkspace(db, { ...other, pauseReason: 'Fixture pause' });
  const customer: RequestScope = { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: 'user', actorId: LOCAL_USER_ID };
  const siblingScope: RequestScope = { ...customer, userId: sibling.user.id, actorId: sibling.user.id };
  const scopes = { admin: LOCAL_REQUEST_SCOPE, customer, sibling: siblingScope, other };
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), 'apps/web'), version: 'restoration-api',
    requestScopeResolver: req => scopes[String(req.headers['x-test-principal']) as keyof typeof scopes] ?? customer });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (principal: keyof typeof scopes, path: string, body?: unknown) => fetch(origin + path, {
    method: body ? 'PATCH' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Test-Principal': principal },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const policy = (scope: RequestScope) => runWithRequestScope(scope, () => new ControlRepository(db).settings().restockRetry);
  const siblingBefore = policy(siblingScope); const otherBefore = policy(other);
  try {
    const snapshot = await request('admin', '/api/v1/admin/snapshot?view=settings');
    assert.equal(snapshot.status, 200);
    assert.deepEqual((await snapshot.json() as any).restockRetryLimits, RESTOCK_RETRY_LIMITS);
    const input = { enabled: true, attempts: 4, windowMinutes: 12 };
    for (const principal of ['customer', 'sibling', 'other'] as const) {
      assert.equal((await request(principal, '/api/v1/admin/settings/restock-retry', input)).status, 403);
      assert.equal((await request(principal, '/api/v1/admin/snapshot?view=settings')).status, 403);
    }
    for (const principal of ['admin', 'customer', 'sibling', 'other'] as const) {
      const overview = await request(principal, '/api/v1/user/overview');
      assert.equal(overview.status, 200);
      const body = await overview.json() as any;
      assert.equal(body.restockRetryLimits, undefined); assert.equal(body.settings.restockRetryLimits, undefined);
      assert.equal(body.settings.restockRetry, undefined);
      assert.equal((await request(principal, '/api/v1/user/settings/restock-retry', input)).status, 404);
    }
    const saved = await request('admin', '/api/v1/admin/settings/restock-retry', input);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json() as any).settings.restockRetry, input);
    const reloaded = await request('admin', '/api/v1/admin/snapshot?view=settings');
    assert.deepEqual((await reloaded.json() as any).settings.restockRetry, input);
    assert.deepEqual(policy(siblingScope), siblingBefore); assert.deepEqual(policy(other), otherBefore);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
