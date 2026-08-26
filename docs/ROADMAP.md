# Yoink roadmap

## Shipped through 0.73.0

### Exact tenant ownership for the signal-incident graph (0.73.0)

- Migration 48 removes the final unresolved PostgreSQL table classification by
  rebuilding `signal_incidents` with non-null tenant/user ownership and a
  composite user foreign key before any hosted signal writer is introduced
- Historical ownership is derived only from durable occurrences, signal
  decisions, and action jobs. Missing ownership prevents a complete copy and
  multiple distinct principals violate the migration guard; either condition
  rolls back the entire migration rather than selecting an arbitrary owner
- The one foreign-key-disabled rebuild is isolated inside a transaction. It
  compares the preexisting foreign-key baseline, rejects every newly introduced
  violation, restores enforcement in a `finally` path, and closes the database
  connection on migration failure
- Incident lookup, corroboration, creation, and lifecycle updates now require
  the exact request tenant and user. Equal semantic offer keys in two principal
  scopes create two independent incidents and cannot mutate each other
- User privacy inventory and export now give the owned incident and occurrence
  graph an explicit, tenant-isolated disposition; the execution-recovery
  boundary independently requires exact ownership and verifies all nine of its
  protected relations under forced RLS
- The PostgreSQL manifest now classifies all 95 portable tables with 83 tenant-
  scoped grants and zero unresolved tables. `signal_incidents` receives the same
  forced-RLS read qualification as the rest of the private graph
- This is an ownership prerequisite, not hosted signal authority. Strategy,
  catalog, policy, spend, notification, audit, and action-job writes remain on
  SQLite; handler parity remains 6 of 7 and all PostgreSQL runtime roles stay
  inactive

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL hosted-delivery lease recovery sub-boundary (0.72.0)

- The final `hosted_delivery_recovery` task is now explicitly decomposed into
  lease recovery and signal evaluation. Version 0.72 qualifies the complete
  inbox/outbox expired-lease repository half; complete-handler coverage remains
  6 of 7 until the signal-evaluation mutation graph is also principal-bound
- A dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no objects, has
  zero direct/effective table or column grants, and may execute one exact strict
  security-definer routine only after the complete 0.71 witness boundary
  independently verifies
- Three forced-RLS tables cover inbox messages, outbox events, and append-only
  delivery receipts. The routine resolves the database-authenticated tenant and
  user, uses the statement clock, serializes each principal, and changes only
  expired nonempty leases
- Inbox attempts below 20 become `failed` and immediately retryable; attempt 20
  becomes `dead_letter`. Outbox attempts below 20 return to `pending`; attempt
  20 becomes `dead_letter`. Every winner clears the capability/expiry, records
  `lease_expired`, and appends the same length-delimited SHA-256 receipt contract
- Native PostgreSQL 16 proves all four counts, current-lease preservation,
  deterministic receipt parity, idempotent rerun, simultaneous one-winner
  recovery, cross-tenant isolation, mismatched/unmapped/direct-table denial,
  clean temporary-authority removal, and catalog-tamper detection
- Health and Admin → Operations expose the proven sub-boundary separately from
  the 6-of-7 handler counter. Signal evaluation, request repositories,
  production principals, runtime composition, and the authority switch remain
  closed; no signal, action job, retailer session, checkout, or order authority
  is added

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL observer-witness refresh handler (0.71.0)

- The sixth of seven background-task handler families now has an asynchronous,
  principal-bound PostgreSQL state seam in the production maintenance handler;
  SQLite remains the authoritative default
- A dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no objects, has
  zero direct/effective table or column grants, and may execute one exact
  strict security-definer routine only after the complete 0.70 reconciliation
  boundary independently verifies
- Six forced-RLS tables cover trust manifests, transparency events, witness
  receipts/checks, audit, and outbox. PostgreSQL resolves the exact
  database-authenticated tenant/user and derives the current tenant-scoped
  checkpoint from immutable public trust/transparency rows
- Network publication occurs outside database transactions. The application
  verifies the pinned Ed25519 response and discards endpoint/key configuration;
  a fresh 30-second plan/apply protocol then revalidates checkpoint, chain,
  sequence, lifetime, canonical bytes, SHA-256 hashes, and server-owned actor
  attribution before append-only persistence
- Native PostgreSQL 16 proves signed acceptance, fresh replay suppression,
  renewal, bounded unavailable evidence, invalid-signature rejection with zero
  writes, one winner under concurrency, same/cross-tenant isolation,
  mismatched/unmapped/direct-SQL/unrelated-function denial, plan tamper
  rejection, clean authority removal, and catalog-tamper detection
- Health and Admin → Operations report exactly 6 of 7 complete handlers. The
  function contains no endpoint URL, public SPKI, private key, network client,
  retailer mutation, checkout, or order authority. All qualification roles
  remain inactive; hosted delivery, request repositories, production identity,
  and authority-switch drills remain required

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL operator-alert reconciliation handler (0.70.0)

- The fifth of seven background-task handler families now has a complete
  asynchronous PostgreSQL repository seam in the production maintenance
  handler. `adapter_alert_reconciliation` composes the existing secretless
  connector-dispatch boundary with a separately qualified diagnostic-to-
  incident reconciliation boundary while SQLite remains authoritative
- The reconciliation `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no
  objects, has zero direct/effective table or column grants, and can execute
  one exact strict security-definer routine only after the complete 0.69
  dispatch boundary is independently verified
- Ten forced-RLS tables cover sanitized diagnostics, rules, incidents,
  lifecycle events, dashboard deliveries, connector configuration and queue
  events, audit, and outbox. The function resolves `session_user` through the
  server-owned principal registry and binds the exact expected tenant/user
- A per-principal advisory transaction lock and two-phase `READ COMMITTED`
  plan/apply protocol derive no more than 50 actionable groups from the newest
  2,000 diagnostics. Apply must occur within 30 seconds and PostgreSQL
  independently revalidates current diagnostics, rules, incidents, routes,
  connector bindings, payload semantics, and hashes before mutation
- Open, repeat, update, immediate/delayed escalation, auto-resolution,
  historical replay suppression, recovery/reopen behavior, dashboard routing,
  audit/outbox receipts, and connector queueing preserve the SQLite contract.
  Only sanitized aggregates and endpoint references cross the boundary; raw
  URLs, secrets, page evidence, and product identifiers do not
- Native PostgreSQL 16 proves exact lifecycle and result parity, idempotent
  replay, one winner under concurrency, same-tenant user and cross-tenant
  isolation, mismatched/unmapped denial, stale/empty/altered plan rejection,
  production maintenance-handler routing, direct SQL/unrelated-function
  denial, temporary-authority cleanup, and immutable receipt rejection after
  function-catalog tamper
- Health and Admin → Operations report exactly 5 of 7 complete handlers. No
  login, membership, principal mapping, runtime composition, PostgreSQL
  authority, webhook contact, retailer action, checkout, or order submission
  is activated; the remaining two handlers and every request repository still
  require their own bounded qualification

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL operator-alert dispatch sub-boundary (0.69.0)

- `adapter_alert_reconciliation` is now deliberately split into independent
  reconciliation and connector-dispatch repository boundaries. Version 0.69
  proves connector dispatch only, so the task-handler counter remains 4 of 7
- The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no objects, has zero
  direct/effective table or column grants, no sequence or policy authority, and
  can execute one exact strict security-definer routine after the complete
  observer-candidate boundary is independently verified
- Four forced-RLS tables cover connector configuration, incidents, deliveries,
  and append-only delivery events. The function binds `session_user` to an
  exact tenant/user and further binds every delivery through its incident's
  `subject_user_id`, preventing same-tenant cross-user claims
- Leasing is a two-phase `READ COMMITTED` plan/apply transaction with
  `FOR UPDATE SKIP LOCKED`. PostgreSQL chooses work and time; the application
  generates the 32-byte capability between phases and stores only its one-use
  hash. The function caps the deployment binding registry and each dispatch
  run at 20, attempts at 12, payloads at 4,000 bytes, leases at 15–300 seconds,
  and retries at 1–86,400 seconds
- Only endpoint references and binding fingerprints cross the boundary. Raw
  webhook URLs and signing secrets remain deployment memory owned by the
  existing transport and are structurally absent from the PostgreSQL routine
- Native PostgreSQL 16 proves one winner under simultaneous claims, exact
  delivery/retry/dead-letter transitions, expired twelfth-attempt recovery,
  wrong and replayed capability denial, same-tenant user and cross-tenant
  isolation, unmapped denial, direct SQL and unrelated-function denial,
  production dispatch-service compatibility, clean authority removal, and
  immutable-receipt rejection after catalog tamper
- Diagnostic-to-incident reconciliation remains SQLite-backed and must receive
  its own bounded PostgreSQL role, server revalidation, concurrency/idempotency
  proof, and receipt before `adapter_alert_reconciliation` can count as handler
  five. No login, membership, principal mapping, webhook contact, runtime
  composition, PostgreSQL authority, or retailer mutation is activated

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL observer-candidate handler (0.68.0)

- The fourth of seven background-task handler families now has an asynchronous
  PostgreSQL seam in the production maintenance handler.
  `observer_recipe_candidate_evaluation` keeps SQLite authoritative while
  accepting a separately qualified PostgreSQL adapter
- Its dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no objects,
  has zero direct table/column grants, and can execute one exact
  security-definer routine after the full operational-retention boundary is
  independently verified
- The routine resolves `session_user`, binds the expected tenant/user, takes a
  per-principal transaction lock, and produces a server-derived plan from at
  most 2,000 recent sanitized diagnostic rows and 25 candidate groups
- Apply re-derives the evidence inside the same `READ COMMITTED` transaction,
  accepts only a fresh exact plan payload, and can create or reuse only the
  existing deterministic unsigned, non-executable, 30-day quarantine candidate
  plus its lifecycle, audit, and outbox receipts
- Device and SKU identifiers remain private threshold inputs and are not
  returned or copied into candidates. Signing, promotion, distribution,
  field-fill, retailer mutation, checkout, and order submission remain absent
- Native PostgreSQL 16 proves exact result and receipt parity, tenant
  isolation, mismatch/unmapped and stale-plan denial, direct SQL denial,
  payload revalidation, idempotent replay, concurrent deduplication,
  production-handler routing, cleanup, and immutable-receipt tamper failure
- Health and Admin → Operations now report exactly 4 of 7 handlers. The other
  three, every request repository, production principals, runtime authority,
  and the authority switch remain closed

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL operational-retention handler (0.67.0)

- The third of seven background-task handler families now has an asynchronous
  PostgreSQL repository seam in the production maintenance handler.
  `operational_telemetry_retention` keeps SQLite authoritative while accepting
  a separately qualified PostgreSQL adapter
- Its dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has no direct table,
  column, sequence, schema-create, policy, insert, update, or delete authority.
  It can execute exactly one strict security-definer routine after the prior
  execution-recovery boundary is independently verified
- The routine resolves `session_user`, rejects any expected tenant/user
  mismatch, serializes cleanup per tenant, and derives both cutoffs from the
  PostgreSQL statement clock. Receipt attribution uses that authenticated
  database principal rather than a caller-supplied worker label
- Existing privacy semantics are preserved: operational telemetry and
  succeeded/cancelled task history use the 30-day boundary; quarantined
  observer-recovery evidence uses the 90-day boundary; a recent review keeps
  its older evidence; dead letters are retained; and one call can delete at
  most 500 evidence rows
- Telemetry retention receipts, evidence retention receipts, cascading review
  and task-event counts, audit events, and outbox events remain atomic. Only
  aggregate counts, policy cutoffs, retention days, and receipt IDs are returned
- Native PostgreSQL 16 proves old/current boundaries, recent-review
  preservation, cascade parity, cross-tenant isolation, mismatched/unmapped
  denial, zero direct SQL/delete access, production-handler routing,
  idempotent replay, one total concurrent winner, clean authority removal, and
  immutable receipt failure after routine tamper
- Health and Admin → Operations report exactly 3 of 7 handler families. The
  other four families, every request repository, production principal
  provisioning, runtime authority, dual write, checkout, and retailer mutation
  remain closed

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL execution-recovery handler (0.66.0)

- The second of seven background-task handler families now has an asynchronous
  PostgreSQL repository seam in the production maintenance handler.
  `execution_recovery` keeps SQLite authoritative while accepting a separately
  qualified PostgreSQL adapter
- Its dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has no direct table,
  column, sequence, schema-create, policy, insert, update, or delete authority.
  It can execute exactly one strict security-definer routine after the prior
  notification-recovery boundary is independently verified
- The routine resolves `session_user` from the server-owned principal registry,
  rejects any expected tenant/user mismatch, takes a per-principal transaction
  lock, and uses PostgreSQL's statement clock. Callers cannot choose an expiry
  boundary or race duplicate recovery receipts
- All existing recovery semantics are preserved: pre-mutation leases expire,
  `add_authorized` cancels, post-mutation leases lock for manual review,
  `submitting` becomes submission-uncertain, unleased signal windows expire,
  capabilities are retired, spend reservations release, and action, append-only
  ledger, audit, and outbox receipts are recorded atomically. Only three
  aggregate counts are returned
- A latent shared-state hazard was made fail-closed in SQLite and PostgreSQL.
  Version 0.73 subsequently gave `signal_incidents` direct ownership; recovery
  requires that exact tenant/user and retains the independent action and signal
  occurrence checks as corruption defenses
- Native PostgreSQL 16 proves all transition classes, receipt parity, future
  state preservation, mismatch/unmapped denial, zero direct SQL access,
  cross-tenant shared-incident isolation, idempotent replay, one total winner
  under concurrent recovery, clean temporary authority removal, and immutable
  receipt failure after routine tamper
- Health and Admin → Operations report exactly 2 of 7 handler families. The
  other five families, every request repository, production principal
  provisioning, runtime authority, dual write, checkout, and retailer mutation
  remain closed

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL notification-recovery handler (0.65.0)

- The first of seven background-task handler families now has an asynchronous
  PostgreSQL repository seam in the production maintenance handler.
  `notification_recovery` preserves the existing SQLite implementation as the
  active default while accepting the separately qualified PostgreSQL adapter
- Its dedicated `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role has zero direct
  table/column grants, no RLS policy of its own, and exactly one function grant.
  The strict security-definer routine independently resolves `session_user`
  from the server-owned principal registry and refuses mismatched or unmapped
  callers before touching data
- The routine can perform only three existing transitions for its exact
  tenant/user: expire notifications whose action job ended, fail expired
  leases at the delivery-attempt ceiling, and requeue expired leases below the
  ceiling. It uses the database statement clock so callers cannot advance
  expiry, clears capabilities and device assignments, and returns only aggregate
  counts—never notification or action-job content
- Native PostgreSQL 16 runs the real `BackgroundMaintenanceHandler` through
  this adapter and proves exact result/state parity, future-lease preservation,
  cross-tenant isolation, mismatch/unmapped denial, direct table and unrelated
  function denial, idempotent replay, and one total winner across simultaneous
  recovery calls
- The live verifier seals the exact function source, signature, result type,
  volatility, strict/security-definer attributes, owner, ACL, role attributes,
  protected forced-RLS tables, and empty principal/membership state. Deliberate
  routine tamper invalidates the immutable receipt
- Health and Admin → Operations report the coverage as exactly 1 of 7 handler
  families. No login, mapping, membership, production worker composition,
  request repository, other handler family, runtime authority, dual write, or
  retailer capability is activated; SQLite remains authoritative

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Least-privilege PostgreSQL fleet-control boundary (0.64.0)

- A separate `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` control role now has 19
  exact column privileges across only three tables, grouped into four
  operations: ID-only user reads, bounded deployment-expectation and heartbeat
  reads, and updates to only four stop-related heartbeat columns
- Three explicit permissive policies expose only principal enumeration,
  deployment status, and stopping an existing worker; the update policy
  requires the resulting heartbeat state to be `stopped`. The role cannot update
  users or expectations, insert/delete heartbeats, read tenant queue tasks,
  execute application functions, access sequences, own objects, create schema
  objects, acquire membership, log in, or gain runtime/retailer authority
- A production-driver adapter wraps each operation in a dedicated
  `READ COMMITTED READ WRITE` transaction and assumes only the control role.
  The PostgreSQL worker-store routes principal pagination, fleet status, and
  worker stopping through it while queue work stays on the tenant writer
- Native PostgreSQL 16 proves two-page exact principal enumeration, deployment
  coverage, an exact heartbeat stop, every prohibited operation above, empty
  post-test principal/membership state, and rejection after a control policy is
  weakened. The live-catalog fingerprint and immutable receipt must match
- Health and the admin Operations projection expose the deterministic
  three-table/19-column-grant proof without exposing role names or claiming active
  authority. A bounded plan/apply/verify CLI requires an explicit
  qualification acknowledgement and fresh namespaces
- This is still inert qualification evidence. No production login, principal
  mapping, API/worker repository switch, task handler, dual write, PostgreSQL
  authority, or retailer action is activated; SQLite remains authoritative

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Atomic PostgreSQL deployment-attested queue boundary (0.63.0)

- Tenant queue-write contract v3 adds one exact `SELECT` grant on the singleton
  API-owned `background_worker_deployment_expectations` table. The role now has
  12 operations across five tables, but its mutation surface remains the same
  four tenant queue tables behind four restrictive server-bound policies
- Every new-work schedule, enqueue, and lease call now checks the external
  worker contract, runtime version, and deployment fingerprint inside the same
  `READ COMMITTED` server-bound transaction before executing queue SQL.
  Heartbeat diagnostics and already-leased completion/failure recovery retain
  their deliberate no-attestation paths
- Native PostgreSQL 16 proves the restricted role can read the exact expectation
  but cannot modify it. A deliberately mismatched runtime version rejects
  schedule initialization and leaves the tenant schedule count unchanged
- Exact effective-grant verification now includes the fifth read-only table
  while still denying deployment updates, unrelated tables, delete, escalation,
  ownership, membership, login, and runtime authority. The three-function and
  four-policy catalog fingerprints remain exact and tamper-evident
- Queue-write contracts v1 and v2 are historical evidence only. Contract v3
  requires a fresh cutover schema and fresh namespaces; receipts are never
  upgraded or adopted
- Principal enumeration, fleet status, and worker stopping still use the
  qualification/control connection. No production principal, handler, request
  repository, deployed worker, dual write, PostgreSQL authority, or retailer
  action is activated; SQLite remains authoritative

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Restricted PostgreSQL tenant queue repository parity (0.62.0)

- The complete PostgreSQL tenant queue repository can now route schedule,
  enqueue, event, lease, completion, retry, and heartbeat transactions through
  the server-bound queue writer rather than the qualification/control role
- Native repository execution exposed one previously hidden dependency: the
  task table's translated JSON check calls `yoink_json_valid(text)`. Queue-write
  contract v2 grants only this one required imported helper in addition to the
  binder and scope functions. It remains strict, immutable,
  non-security-definer, and unavailable through `PUBLIC`
- The live-catalog verifier now checks all three exact executable functions,
  including identity arguments, volatility, strictness, security mode,
  configuration, public access, owner/definition fingerprint, and absence of
  every other application routine. Helper volatility tamper and restrictive-
  policy tamper both invalidate the immutable receipt
- Two independent server-bound writer pools execute the actual production queue
  SQL on PostgreSQL 16. The suite proves seven schedule/task/event creations,
  repository heartbeat, capability-bound retry, locked-row skipping,
  exact-one-winner contention, completion, tenant isolation, and forbidden
  insert/update/delete/read paths
- The worker-store projection now distinguishes tenant queue repository parity
  from the remaining control surface. Principal enumeration, deployment
  attestation/status, and worker stopping still use the qualification/control
  connection; attestation and the tenant write are not one atomic boundary
- Queue-write contract v1 is evidence only and is never upgraded or reused.
  No production principal, login, membership, task handler, request repository,
  deployed worker, PostgreSQL runtime authority, dual write, or retailer action
  is activated. SQLite remains authoritative

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL tenant queue-write qualification (0.61.0)

- A deterministic contract derives one fresh `NOLOGIN`, `NOINHERIT`,
  `NOBYPASSRLS` tenant queue-writer role from the exact cutover, read-role, and
  tenant-session manifests. It receives 11 exact `SELECT`/`INSERT`/`UPDATE`
  grants on schedules, tasks, append-only task events, and worker heartbeats
- `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, sequence, ownership,
  schema-creation, receipt, unrelated-table, login, membership, and runtime
  authority remain absent. Task events deliberately have no update grant
- Four `AS RESTRICTIVE FOR ALL` policies intersect reads and writes with the
  zero-argument, server-owned tenant/user binding from 0.60. The registry must
  contain zero active principals when the boundary is applied or verified
- A production-driver adapter opens `READ COMMITTED READ WRITE` transactions,
  assumes only the bounded role, calls the server binder, and compares its
  result with the authenticated principal expected by the caller before
  exposing the query session
- Native PostgreSQL 16 tests use two simultaneous mapped writers and one
  unmapped writer to prove tenant-isolated insert/read behavior and explicit
  denial of cross-tenant insertion, deletion, task-event update, unrelated-
  table read, mismatched identity, and unmapped identity. Transaction scope is
  reset, fixture memberships are removed, and the disposable cluster is erased
- Exact effective privileges, role attributes, functions, restrictive policy
  expressions, and all 83 forced-RLS tables are inspected. An immutable receipt
  seals the catalog fingerprint, and deliberate policy weakening fails
  verification
- This qualifies only the queue-store write surface. No production principal,
  task handler, API repository, login, membership, deployed worker, dual write,
  PostgreSQL authority, or retailer action is activated. SQLite remains the
  sole runtime source of truth

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Server-bound PostgreSQL tenant-session qualification (0.60.0)

- A deterministic contract derives one fresh `NOLOGIN`, `NOINHERIT`,
  `NOBYPASSRLS` tenant-session reader from the qualified read-role and schema
  manifests. It receives exact `SELECT` grants on all 83 tenant-RLS tables and
  no write, ownership, routine, sequence, login, membership, or runtime
  authority
- An empty server-owned principal registry maps PostgreSQL `session_user` to
  exactly one tenant/user pair. A zero-argument `SECURITY DEFINER` binder sets
  transaction-local context from that mapping and returns the bound identity so
  the adapter can compare it with the authenticated principal it expected
- Each tenant table gains a separately named `AS RESTRICTIVE` policy tied to a
  security-definer server-principal scope function. PostgreSQL custom settings
  remain syntactically mutable; changing them can narrow visible rows but
  cannot expand access outside the registered principal
- A read-only production-driver adapter validates the binding before exposing
  a query session. Native PostgreSQL 16 tests use two mapped login fixtures and
  one unmapped fixture to prove simultaneous isolation, mismatch/unmapped
  denial, hostile-setting containment, write denial, transaction-local cleanup,
  and rejection after a restrictive policy expression is tampered. The
  immutable receipt seals exact policy and security-definer definitions.
  Fixture identities are removed with the disposable cluster
- Worker qualification pools now explicitly use `READ COMMITTED`, which is the
  intended isolation level for competing `FOR UPDATE SKIP LOCKED` consumers;
  the offline cutover importer remains strictly `SERIALIZABLE`
- Plan/apply/verify CLI commands, an immutable qualification receipt, and exact
  health/admin projections expose the boundary honestly. The shipped registry
  contains zero mappings; no production login, provisioning path, write role,
  repository port, runtime identity, or authority switch is activated. SQLite
  remains authoritative and retailer action state is unchanged

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Native PostgreSQL worker-lease contention qualification (0.59.0)

- A hermetic PostgreSQL 16 server now runs as part of the release test suite;
  its native binary dependency is exact-lockfile pinned and the isolated
  cluster is removed after every pass or failure
- The production `pg` cutover driver imports the complete verified portability
  archive, applies and verifies the five restricted read-role templates, then
  opens two independently bounded worker pools plus a third lock-holder session.
  Exact server backend PIDs and the qualification application name prove these
  are distinct native sessions rather than one emulated connection
- One session locks the highest-priority task while another must skip it and
  lease the next task. Releasing the lock exposes the original task; a separate
  simultaneous two-worker race yields exactly one winner. Invalid completion
  capability, attempt count, capability erasure, and one leased/one succeeded
  event per task are all asserted
- Cutover contract v3 records the release-level native proof and reports three
  PostgreSQL 16 backend sessions. The relational schema manifest deliberately
  remains contract v2 with the same fingerprint because no table, policy, or
  translated invariant changed
- This closes the native queue-contention qualification gap only. The API and
  worker remain SQLite-backed; PostgreSQL request/task-handler repositories,
  authenticated login/session binding and write roles, production fleet/load/
  outage and idempotent-handler drills, backup/PITR, and authority switch remain
  required. Retailer evidence and action authorization are unchanged

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### PostgreSQL least-privilege read-role qualification (0.58.0)

- The original deterministic contract mapped 94 of 95 portable tables onto
  five fresh `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` group roles. Version 0.73's
  ownership migration now maps all 95: 83 tenant-RLS, six shared-catalog, three
  authorization-catalog, two deployment-control, and one tenant-registry table,
  with no unresolved grant class
- Each role receives private-schema `USAGE` and exact table `SELECT` only.
  Application-schema writes, `CREATE`, routines, sequences, ownership, role
  membership, source-less mixed offers, login, and privilege inheritance stay
  closed
- The acknowledged qualifier refuses a reused role namespace or receipt,
  applies the role set atomically after the exact inert contract-v2 cutover
  receipt, inspects live PostgreSQL catalogs, and seals an immutable receipt.
  Verification detects role-attribute, membership, table/column grant,
  ownership, routine, sequence, and schema-privilege drift
- Real PostgreSQL-semantics tests prove default denial, tenant/inherited/mixed
  filtering, strict cross-role isolation, write denial, tamper detection, and
  receipt immutability. A plan/apply/verify CLI and exact health/admin projection
  expose the bounded evidence
- These are inactive qualification group roles. No login or membership is
  created, the API and worker remain SQLite-backed, and tenant session binding,
  write-role/repository parity, independent fleet contention, backup/PITR, and
  authority-switch evidence remain closed. Retailer evidence and action
  authorization are unchanged

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### PostgreSQL tenant ownership and worker-store qualification (0.57.0)

- Every one of the 95 portable tables now has exactly one deterministic tenant-
  scope classification. The manifest rejects new, removed, conflicting, or
  unrepresented ownership edges instead of silently guessing policy
- Forced default-deny RLS now covers 68 direct-owner tables and 13 inherited-
  owner tables. Exact parent ownership is enforced for required links, while
  nullable mission/strategy consistency links may be absent but cannot cross a
  tenant when present
- `offer_observations` is explicitly mixed-scope: rows tied to a tenant source
  receive inherited isolation, while source-less shared rows fail closed for
  ordinary tenant roles. Six shared-catalog, three authorization-catalog, two
  deployment-control, one tenant-registry, and one unresolved table remain
  named runtime-role gates
- A qualification-only PostgreSQL store implements the complete asynchronous
  worker port over the inert imported schema: bounded keyset principal pages,
  packaged schedules, due-run dedupe, tenant predicates, `FOR UPDATE SKIP
  LOCKED` leases, ephemeral capability hashes, completion/retry/dead-letter
  transitions, heartbeats, stopping, and deployment attestation
- Real PostgreSQL-semantics tests exercise cross-tenant RLS and the worker-store
  state machine. The cutover contract advances to v2, so v1 qualification
  schemas are evidence only and must never be upgraded or reused
- The API and standalone worker remain on SQLite. PostgreSQL handler
  repositories, restricted runtime/shared roles, independent multi-connection
  lease contention, backup/PITR, and authority-switch evidence remain closed;
  retailer evidence and action authorization are unchanged

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### PostgreSQL cutover qualification plane (0.56.0)

- A production `pg` driver adapter now enforces explicit verified TLS by
  default, loopback-only insecure development, bounded pooling, and one checked-
  out connection per serializable transaction
- The offline one-shot importer accepts only a fully verified archive matching
  the exact current migration/table contract. It creates a new private schema,
  streams bounded row batches, re-verifies the file after streaming, and rolls
  the whole schema back on any failure
- All 95 portable application tables, 243 foreign keys, 177 unique/query
  indexes, 282 safe literal defaults, 327 checks, and 50 immutable/state-guard
  triggers are manifested deterministically and accepted by a real PostgreSQL
  engine in the qualification suite
- Exact per-table and aggregate canonical hashes must reconcile before the
  receipt becomes verified. Corruption, target reuse, and post-import mutation
  fail closed or report the exact mismatched table family
- Forced default-deny RLS is installed and exercised through a non-superuser
  role on 68 tables with direct tenant ownership. Fourteen inherited tenant
  paths and 13 tables without a tenant FK path are projected explicitly and
  remain a production gate rather than receiving an unsafe guessed policy
- Health and the admin Operations workspace expose one honest data-plane
  projection: SQLite is active; dual write, runtime PostgreSQL authority, fleet
  contention, backup/restore, and production readiness remain false
- No SQLite migration or retailer evidence/qualification/action state changes.
  The qualification role and schema are never used by the API or worker

See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).

### Workload-scoped internal service identities (0.55.0)

- Every hosted service actor is now denied by default and may receive exactly
  one deployment-owned capability: delivery, contributor eligibility, or
  principal provisioning. The prior blanket three-capability service bundle is
  removed
- Hosted mode requires an exact actor-to-capability JSON registry, with `{}` as
  the explicit deny-all configuration. Unknown capabilities, malformed actor
  IDs, arrays, and multi-capability values fail startup
- Capability assignment happens only after signed scope, principal, expiry,
  and nonce verification. Capability headers are rejected and the signing
  helper cannot embed one in a client-provided scope
- Route policy and the delivery, eligibility, and principal repositories each
  enforce the same exact capability. The background worker carries delivery
  authority only for its delivery-recovery task
- Public health and the admin Access workspace project count, coverage,
  fingerprint, and opaque actor references only. Raw actor IDs and secrets are
  not serialized
- This is least-privilege authorization, not cryptographic workload identity.
  Production mTLS/OIDC workload proof, managed secrets, signed artifacts, and
  independent deployment monitoring remain Phase 2 work
- No migration is required, and retailer qualification/evidence/action state is
  unchanged

See [internal service capability isolation](INTERNAL_SERVICE_CAPABILITIES.md).

### External contributor eligibility and regional conflict SLO (0.54.0)

- Migration 47 adds one bounded current eligibility state per exact
  tenant/user/device. Only a service with `internal.eligibility` may submit the
  fixed v1 contract: pre-pseudonymized account and proof hashes, a canonical
  coarse subdivision, separate account/device/region decisions, and an expiry
  no more than 24 hours away
- Raw IdP subjects, names, email, network/postal location, risk features,
  tokens, and proof payloads are outside the contract. Same-time conflicts and
  stale replacement fail closed; exact replay is idempotent and effective
  updates emit redacted audit evidence
- Trial ingestion snapshots current eligibility server-side. A trial is
  externally attested only when account, device, and region decisions all pass
  before expiry; a later attestation cannot upgrade historical evidence
- The fixed seven-day SLO counts one latest trial per account pseudonym, exact
  SKU, layout, and lifecycle stage. Measurement requires 10 eligible trials,
  three accounts, and two regions. Breach requires more than 10% conflict plus
  at least two conflicts spanning two accounts and two regions
- A breach may disable and undistribute that read-only recipe only. The
  immediate packaged-conflict kill remains authoritative. Neither path can
  sign/promote a recipe, apply recovery evidence, fill an observation, alter
  identity or purchase state, qualify a retailer, create a job, invoke Chrome,
  or reach any mutation runner
- Admin and user projections explain eligibility and SLO state without raw
  hashes. The repository ships no production identity/risk provider, so local
  evidence remains explicitly unverified and cannot manufacture public quorum

See [observer-recipe regional conflict SLO](OBSERVER_RECIPE_REGIONAL_CONFLICT_SLO.md).

### Bounded recovery-evidence retention (0.53.0)

- Migration 46 fixes recovery retention policy v1 at 90 days after the later
  of evidence receipt or latest contributor review. New review activity resets
  expiry; the policy cannot be remotely widened or connected to application
- The existing six-hour privacy/telemetry worker now processes at most 500
  eligible evidence rows for one exact tenant/user per run through a separate
  signing-free repository. Review events cascade with their expired evidence
  in the same transaction
- Fresh evidence, recent reviews, direct review deletion, and receipt mutation
  remain database-blocked. Owning-user deletion intentionally cascades
  evidence, reviews, and receipts
- Each effective cleanup appends one owner-scoped aggregate receipt containing
  only fixed policy, cutoff, counts, actor, and negative application facts—no
  value, SKU, recipe, layout, or answer
- The user Preferences card explains automatic expiry and each projected
  removal time. The admin registry shows policy, eligible/deleted totals, and
  opaque receipt history; self-service export includes owner receipts
- Retention cannot fill an observation, influence promotion or qualification,
  change a purchase plan, create a job, reserve spend, invoke Chrome, or widen
  any retailer lane. Version 0.54 adds an external eligibility seam and measured
  regional conflict SLO; a deployed production provider, public reputation and
  Sybil controls, external monitoring, and governed reversible read-only
  application remain open

See [observer-recipe recovery retention](OBSERVER_RECIPE_RECOVERY_RETENTION.md).

### Contributor-owned recovery-evidence review (0.52.0)

- The minimal user Preferences workspace now presents each contributor only
  their own quarantined normalized store details in plain language, with
  explicit correct, incorrect, and withdraw-confirmation controls plus a
  persistent `Quarantined · never applied` boundary
- A closed contract accepts only version, decision, and the matching exact
  confirmation phrase. Free text, DOM, URLs, account context, checkout fields,
  and payment data cannot enter this path
- Migration 45 appends monotonically sequenced review events bound by a
  composite tenant/user/evidence foreign key and deterministic evidence hash.
  Evidence never changes; current review state is a projection, retries are
  idempotent, and revocation requires a current confirmation
- Direct event updates and premature deletes are blocked. Version 0.53 adds
  bounded time-qualified evidence/review expiry; deletion of the owning user
  remains the complete privacy cascade. Self-service export includes current
  history and aggregate retention receipts; audit receipts omit values
- The admin registry shows current user-review state and event count. Health
  and snapshot contracts separately report user review/revocation implemented
  and review application/field fill disabled
- Reviews do not count toward recipe trial/promotion quorum and cannot affect
  observations, catalog identity, qualifications, plans, jobs, spend, Chrome,
  or mutation. Version 0.54 adds an expiring service-attested eligibility seam
  and regional conflict SLO without turning reviews into truth; production
  provider/reputation/Sybil operations, external monitoring, and a governed
  reversible read-only application projection remain open

See
[observer-recipe recovery user review](OBSERVER_RECIPE_RECOVERY_USER_REVIEW.md).

### Quarantined observer-recipe recovery evidence (0.51.0)

- Trial contract v3 retains the value-free v2 receipt and adds normalized
  recovery values only for a signed-recipe field that the bundled observer
  marked missing and the separate packaged structured-page oracle read as the
  exact same value
- Chrome and the server independently allowlist three availability states,
  bounded positive USD cents, restricted lowercase public seller names,
  shipping/pickup, and an Add-control boolean. The recovery set must exactly
  match eligible field outcomes; extra, mismatched, sensitive, or malformed
  values fail closed before storage
- Migration 44 writes append-only evidence bound to authenticated
  contributor/device, exact trial/recipe/SKU/layout, server-known recipe stage,
  and fixed provenance. Schema constraints permanently set every row to
  `quarantined` and `not_applied`
- The admin registry presents normalized previews with opaque contributor and
  provenance metadata; self-service user export includes the ledger. Audit
  receipts retain only field names/counts and never duplicate recovered values
- No approve/apply endpoint or canonical observation write path exists.
  Recovery evidence cannot affect catalog identity, community assertions,
  qualifications, plans, jobs, Chrome behavior, or mutation. Public account
  reputation, region quorum, automatic promotion, and actual read-only field
  fill remain open. Contributor review arrives in 0.52 and bounded retention in
  0.53 without widening this boundary

See [observer-recipe recovery evidence](OBSERVER_RECIPE_RECOVERY_EVIDENCE.md).

### Contributor-deduplicated canary governance (0.50.0)

- Migration 43 stamps each accepted observer-recipe trial with the recipe's
  server-known lifecycle stage. Existing rows remain `legacy_unknown`; Chrome
  cannot claim canary or trusted state in its payload
- Promotion quorum counts only the latest row for one tenant user, exact SKU,
  layout fingerprint, and stage. Extra paired devices and retries cannot
  multiply an account's evidence for the same tuple; raw append-only failures
  remain visible and continue to block promotion
- A worker-generated shadow requires two packaged-oracle-complete passes from
  two distinct tenant users and devices before canary. Trusted read-only now
  requires a 24-hour canary burn-in, five clean deduplicated lifecycle passes,
  three canary passes across three SKUs/two layouts, and—for generated
  candidates—three distinct canary users and devices with oracle-complete
  evidence
- Canary delivery hashes the authenticated tenant user plus exact recipe into
  a stable 25% cohort. Multiple devices for one account receive one decision;
  an excluded account falls back to an older valid recipe or the packaged
  observer
- Four current canary cohort trials with two failed trials from two
  contributors auto-kill when failing contributors are at least half of the
  cohort. The conditional transition clears distribution and records one
  `canary_regression_slo_breach` lifecycle/audit/outbox receipt
- Admin/API projections expose deduplicated progress, burn-in, cohort size,
  regression state, and the remaining public anti-Sybil boundary. This is a
  tenant-scoped safety quorum, not production account reputation. Region
  cohorts, automatic promotion, recipe field-fill, and mutation remain closed

See [observer-recipe canary governance](OBSERVER_RECIPE_CANARY_GOVERNANCE.md).

### Packaged observer-recipe oracle and conflict kill switch (0.49.0)

- A second fixed Chrome reader validates signed recipe output against
  exact-product JSON-LD, semantic microdata/meta, and a unique accessible Add
  control. It does not use downloaded selectors for its oracle evidence and
  cannot navigate, fetch, click, or invoke a mutation runner
- Trial contract v2 contains only the five fixed field names, recipe/packaged/
  oracle state enums, disposition enums, counts, exact SKU, observer version,
  and layout fingerprint. The server independently checks the signed recipe's
  exact field set, every allowed state combination, all derived counts, and the
  overall outcome. Raw values, selectors, DOM, URLs, and account/session data
  remain outside the receipt
- Migration 42 adds bounded oracle columns and a canonical field-outcome JSON
  array. Existing v1 trials are preserved as `legacy_packaged_comparison` and
  remain operationally visible, but never satisfy a generated-repair oracle
  gate
- Known packaged evidence is authoritative. One recipe conflict immediately
  records the bounded trial, disables and kill-switches the recipe, clears its
  signature from distribution, and appends lifecycle plus audit/outbox
  evidence with `packaged_evidence_conflict`
- Worker-generated candidates still require explicit review to enter shadow.
  Canary requires every field oracle-complete across two exact SKUs. Trusted
  read-only requires five oracle-complete passes, three exact SKUs, two layouts,
  and no failures or conflicts in addition to every existing rooted-trust,
  sequential-promotion, expiry, witness, rollback, and kill-switch gate
- This is a packaged second reader, not an independent-account oracle or public
  community quorum. Recipe-derived observation field-fill, automatic signing/
  promotion, contributor-deduplicated cohorts, regional canaries, and measured
  regression SLOs remain closed. Mutation runners remain isolated

See [packaged observer-recipe oracle](OBSERVER_RECIPE_ORACLE.md).

### Five-field privacy-bounded repair mining (0.48.0)

- The packaged exact-product observer now mines stable structural landmarks
  for availability, unit price, seller, fulfillment, and add control. It first
  proves local field semantics, then requires one globally unique allowlisted
  element/attribute/value selector; ambiguity or sensitive/dynamic vocabulary
  fails closed
- Add control remains restricted to button/input/role-button structures. Input
  is rejected for every value field; those fields use a small fixed set of
  visible semantic elements.
  Page DOM/text, observed field values, arbitrary selectors, IDs/classes, URLs,
  form values, offer/session material, and account/checkout data never enter a
  repair landmark
- Companion and server independently validate field, element, attribute,
  field-specific vocabulary, reason/stage, product/block state, and matching
  structural counts. Exact product identity stays in the private diagnostic
  ledger only for evidence isolation and is never copied into a candidate
- The signing-free durable compiler groups every mature compatible field for
  one layout into one deterministic candidate. Modes are fixed to `text` for
  the four value fields and `disabled_state` for add control. Adversarial tests
  reject wrong-field intent, wrong modes, editable Add targets, sensitive
  values, arbitrary selector grammar, and replay collisions
- Generated recipes remain unsigned, 30-day, quarantined, non-executable, and
  absent from all mutation runners. Automatic processing cannot sign, promote,
  trial, distribute, renew, or execute them. The required independent oracle is
  explicitly reported as unimplemented
- Admin repair cards name each field; generated registry cards enumerate their
  fields and mark the independent-oracle gate. Health reports five supported
  repair fields while retaining false execution and auto-promotion flags
- No schema migration or retailer authority changes. Migration 41 remains
  current; observations, qualifications, spend, checkout, drawing entry, and
  order submission are unchanged

### Durable observer-repair candidate evaluation (0.47.0)

- Migration 41 adds a seventh closed background task family. Every 60 seconds
  it evaluates the existing privacy-bounded repair queue outside request
  handling, with a 2,000-group read bound and at most 25 candidate decisions
  per run
- Only an open packaged-observer Add-control selector miss whose exact derived
  selector has at least three distinct paired devices and two exact SKUs may
  advance. This is a local noise threshold, not independent-account community
  quorum or a correctness oracle
- The signing-free worker repository can create only one through five fixed
  allowlisted selectors for the read-only `addControl` field in
  `disabled_state` mode. Code, XPath, text, HTML, IDs/classes, URLs, form or
  product values, sensitive vocabulary, navigation, events, and mutation are
  structurally rejected
- Generated candidates are unsigned, 30-day, `quarantined`, and carry no trust
  generation or rollback target. Exact device/SKU identities are not copied
  into the candidate or audit receipt. Deterministic tenant/user/layout/
  selector/package fingerprints and a partial unique index make replay
  idempotent
- The generated provenance and version namespace are reserved from ordinary
  proposals. Automatic processing cannot promote, sign, trial, distribute,
  renew, or execute a candidate. Existing protected maintainer change control,
  rooted signing, measured shadow/canary gates, kill switch, rollback, and
  hosted witness enforcement remain mandatory
- Admin repair cards show collection versus bounded candidate-evaluation readiness;
  registry cards label worker-generated unsigned candidates; Operations shows
  the schedule/results/retry path. Health reports durable evaluation while
  explicitly reporting generated execution and auto-promotion as false
- Repository, durable-handler, API, admin, migration, idempotency, privacy,
  reserved-namespace, and signing-key-isolation tests prove the boundary. No
  observation, qualification, action, spend, checkout, drawing, or retailer
  execution authority changes

### Server-authoritative guided plan preflight (0.46.0)

- The nontechnical purchase setup now obtains a server-authoritative preview
  before any mission, target, intent revision, reservation, or action job is
  created. One shared validation path covers exact listing, USD currency,
  quantity, item/all-in caps, seller, fulfillment, substitution, cooldown,
  expiry, packaged mapping, and current tax/store reserve
- The response shows the maximum item subtotal, tax reserve, retailer reserve,
  minimum all-in boundary, remaining headroom, and the same readiness result a
  saved plan would receive. It is explicitly not stock evidence or purchase
  authority
- Contract version 2 binds create to a five-minute tenant/user/draft/listing/
  cost/readiness/issuance fingerprint. The server recomputes it immediately
  before writing; changed fields or server state and expired receipts require a
  new preview. Version 1 stays compatible for existing clients
- The setup dialog invalidates its acknowledgement on every material edit,
  debounces the server check, and keeps review and creation disabled until the
  current result passes. A server or policy error remains in the dialog with a
  bounded recovery instruction
- Repository, API, authorization, and real JSDOM workflow tests prove no
  purchase-domain write during preview, fresh receipt enforcement, state-change
  invalidation, no receipt persistence in audit/outbox, and exact version-2
  creation. No schema migration or retailer authority change is included

### Explainable purchase automation readiness (0.45.0)

- Every user purchase plan now receives one authoritative, versioned readiness
  projection derived on the server from its current direct-policy revision,
  active/expiry state, enabled exact targets, reviewed seller/fulfillment/price
  bounds, packaged mappings, per-user qualification records, current companion
  version and adapter capabilities, connected signal sources, execution mode,
  and global pause
- The projection uses closed states for inactive, expired, legacy-strategy,
  targetless, signal-less, outdated/offline/incapable companion,
  notification-ready, unsafe-policy, unqualified-lane, shadow, paused, and armed
  outcomes. It includes bounded per-target reasons and a plain-language
  checklist without offer, session, credential, DOM, or capability material
- `/` now distinguishes **packaged mapping**, **qualification pending**, and
  **qualified guarded add** before setup; each plan card shows what can happen,
  why, and the next safe step. The five-step setup guide consumes the same
  projection, so an Amazon or Best Buy mapping can no longer make the overall
  setup appear armed while that independent lane is closed
- “Armed” is deliberately prospective: a live action still requires fresh
  Chrome proof of the exact listing, price, first-party seller, explicit
  shipping offer, quantity one, empty-cart preflight, and usable Add control.
  Checkout, payment, drawing entry, and order submission remain manual/closed
- Mission quantity remains the user's overall desired amount. Direct plans
  already produce quantity-one guarded attempts; live multi-unit add matches
  from legacy advanced strategies now become notifications before spend
  reservation. Shadow simulations retain their requested quantity for safe
  diagnosis
- A live add match cannot reserve spend for an unqualified retailer lane. It
  becomes an ordinary notification before reservation, aligning engine state
  with the readiness projection and preserving qualification as a hard gate
- Pure state-matrix tests, API projections, setup-guide tests, the real JSDOM
  user workflow, and a live-engine reservation regression prove the contract.
  No migration, retailer qualification change, community authority, or action
  widening is included

### Current-vote community projections (0.44.0)

- The tenant-local inventory projection now selects only the latest eligible
  assertion per contributor. Repeated rows and multiple devices owned by one
  account cannot multiply that account's vote, while a distinct healthy paired
  device remains required for each contributor counted toward quorum
- A contributor's current assertion supersedes their own older availability or
  price instead of self-quarantining. Ingestion compares a new assertion only
  with the latest eligible assertion from each other contributor; historical
  dynamic conflicts remain receipts but stop poisoning the projection after
  current independent votes converge
- Price requires three current price votes and is their median, with bounded
  minimum, maximum, and spread metadata. Availability disagreement or a
  material price range among current independent votes still fails closed;
  listing-only, unresolved, and unknown hard-quarantine states remain
  non-publishable
- The API and Community workspace expose the current-vote policy, current and
  superseded counts, median/range method, and an explicit
  `mutationAuthority: false`. Three current contributors and three distinct
  healthy devices remain the minimum for a tenant-local advisory projection
- Multi-user/multi-device tests prove stale-price resistance, healthy-device
  fallback, current stock supersession, independent conflict quarantine, later
  convergence, exact selected-offer isolation, and the advisory-only boundary
- This is a robust projection over the existing tenant-local ledger, not the
  Phase 4 shared service. Cross-account pseudonyms, production identity and
  device risk, contributor reputation, Sybil/abuse controls, deletion
  propagation, global curation, and meaningful live community quorum remain
  open. No database migration or retailer action widening is required

### Governed connector recovery and health (0.43.0)

- Migration 40 replaces the connector-delivery update guard with an exact
  transition contract. Tenant/connector/incident/event identity, stable payload
  and hash, idempotency key, endpoint reference/binding, privacy class, and
  creation evidence cannot change during retry, completion, cancellation, or
  replay
- `alert.manage` operators can schedule only a current dead letter for manual
  replay using an explicit confirmation and one of three allowlisted recovery
  reasons. A replay reuses the exact delivery identity and payload, cannot
  retarget a destination, and stops after three operator-initiated cycles
- Disabled connectors, stale saved configuration, missing/drifted deployment
  bindings, cross-tenant IDs, non-dead-letter states, concurrent transitions,
  extra request fields, and exhausted replay bounds fail closed. Each accepted
  replay appends both delivery and audit/outbox evidence
- An expired twelfth-attempt lease now deterministically dead-letters on the
  next matching worker cycle, closing the stranded-work edge while preserving
  the original one-use capability boundary
- A rolling 24-hour health projection derives idle, healthy, degraded,
  critical, disabled, and unbound status from sanitized append-only receipts.
  It publishes a five-minute delivery SLO, current backlog/dead-letter counts,
  terminal outcomes, retry history, age, and success percentage without
  payloads, endpoints, fingerprints, secrets, response bodies, or identities
- `/admin` Alerts shows connector health and offers **Replay once** only when
  the server marks an exact receipt eligible. The browser supplies no URL,
  destination, payload, note, attempt count, or identity override
- Migration replay, database transition tampering, lease exhaustion,
  configuration drift, three-cycle bounds, API authorization, receipt privacy,
  health state/rate, and the real admin interaction are automated tests
- This is governed operational recovery and an in-application SLO projection,
  not arbitrary webhook resend/retargeting, independent monitoring, email/pager
  delivery, managed secrets, PostgreSQL fleet execution, or purchase authority

### Durable operator-alert webhook connectors (0.42.0)

- Migration 39 adds tenant-scoped connector configuration, mutable delivery
  projections, and append-only per-attempt receipts without changing any
  retailer execution or qualification state. Admins store only an opaque
  deployment reference, minimum severity, enabled state, and public binding
  fingerprint; URLs and signing secrets are rejected by the API and database
- The fixed alert-maintenance worker now dispatches at most 20 bounded
  operational-aggregate events per run. Random one-use capabilities protect
  each lease; retryable network/408/425/429/5xx failures use bounded backoff,
  redirects and permanent failures dead-letter, and claims stop after 12
- Deployment-owned public HTTPS registry entries resolve references to exact
  endpoints and dedicated signing-secret environment variables. Stable JSON
  requests use HMAC-SHA256; response bodies and exception text are discarded,
  while exact SKU, URL, DOM/text, account, actor, token, and purchase data never
  enter the connector payload
- Each connector and queued delivery pins a one-way binding of reference,
  endpoint, and secret-variable name. Reusing a reference for a changed
  destination makes existing work non-leasable until an explicit admin re-save
  cancels outstanding rows, preventing silent historical retargeting
- Worker deployment attestation advances to contract 2 and includes the public
  connector-registry fingerprint. Migration preserves contract-1 transition
  history but clears the obsolete current projection so API startup must write
  the new exact expectation before a standalone worker can resume
- `/admin` Alerts now manages connectors and shows binding health, bounded
  delivery state, HTTP status class evidence, and retry/dead-letter history.
  Health exposes durable connector dispatch and registry configuration without
  endpoints, binding fingerprints, secrets, or lease capabilities
- Repository, API, HMAC/redirect/error, binding-drift, retry/cancellation,
  migration, worker-process, and real admin-UI paths are covered by automated
  tests and an [operator runbook](OPERATOR_ALERT_CONNECTORS.md)
- This ships signed webhooks, not email/pager provider adapters, managed secret
  storage, DNS/IP egress enforcement, PostgreSQL fleet execution, or independent
  delivery monitoring. Version 0.43 adds separately governed manual replay

### Attested standalone worker deployment contract (0.41.0)

- Migration 38 adds one API-owned mode/version/fingerprint expectation, a
  hash-chained append-only transition ledger, and a fingerprint field on
  operational worker heartbeats. Existing heartbeat history is preserved with
  an explicit legacy-empty fingerprint
- API and worker independently derive a domain-separated SHA-256 fingerprint
  from the exact Yoink version, every closed task kind with interval/attempt
  bounds, witness requirement, and complete public witness endpoint/log/key/
  freshness configuration. SQLite receives only the final fingerprint
- Identical API restarts are idempotent. Any real mode or contract change adds
  one immutable event before updating the current projection; no private key,
  credential, proxy secret, tenant/user ID, retailer fact, or task capability
  is included
- Standalone schedule initialization, due enqueue, and task leasing require an
  existing `external` expectation plus exact version and fingerprint equality.
  A mismatch may write only a bounded diagnostic heartbeat and cannot obtain
  new work; already-leased success/failure recovery remains available
- External health requires exact attested coverage of every persisted
  principal and rejects any concurrently online mismatched worker. Operations
  shows the contract gate and whether each heartbeat presented an attestation,
  without exposing fingerprint inputs
- Migration replay, idempotent/hash-chained configuration history, matching and
  mismatched store behavior, real matching/mismatched child processes, health,
  API, and admin UI are covered by focused tests and an operator runbook
- This prevents accidental packaged-code and public trust-configuration drift.
  It is not hardware remote attestation, artifact signature/provenance,
  workload identity, a secrets manager, PostgreSQL/fleet infrastructure, or a
  retailer action expansion

### Durable observer-recipe witness refresh (0.40.0)

- Migration 37 adds the sixth closed background task kind,
  `observer_recipe_witness_refresh`, with a 60-second schedule and the existing
  capability-bound, append-only, bounded retry/dead-letter lifecycle. It
  accepts no remote payload and has no retailer or recipe-mutation capability
- A refresh run binds the installed root-signed manifest to the latest local
  transparency event. No checkpoint is a safe no-op; a matching comfortably
  fresh receipt avoids network traffic; a due receipt publishes only the exact
  checkpoint and previous receipt hash to the pinned independent witness
- Receipt verification, key pinning, log/tenant scope, checkpoint equality,
  monotonic sequence/predecessor chaining, signed validity, configured maximum
  age, and fail-closed hosted delivery remain enforced before acceptance.
  Failures retain only fixed bounded reason codes and use normal worker retry
- The standalone worker reloads a verification-only, package-rooted public
  manifest on each run so reviewed rotation is visible without restart. It
  cannot load or use the observer intermediate private signer; the independent
  witness private key remains outside Yoink
- API and worker share one validated public witness configuration. Hosted
  worker startup rejects missing or partial configuration; local no-witness
  mode remains a transparent safe no-op. Health and admin projections expose
  configuration and bounded state without private keys or raw responses
- Migration preservation, fresh/no-checkpoint/due/failure paths, configuration
  parity, standalone process key isolation, health, and all six task families
  are covered by automated tests and an operator runbook
- This ships the in-repository scheduling and key-isolation seam, not the
  independently operated witness service, public consistency monitor, alert
  connector, PostgreSQL fleet, autonomous recipe generation/promotion, or any
  retailer action expansion

### Hosted Chrome transport and production package profile (0.39.0)

- Hosted startup requires an exact `YOINK_HOSTED_EXTENSION_ORIGINS` allowlist.
  The API checks it before reading a pairing body or resolving a bearer, so a
  foreign extension cannot probe or consume a code or credential slot
- The exact bounded pairing body may establish scope only on the pairing route.
  Its hashed, globally unique, unconsumed code resolves one tenant/user and is
  then consumed atomically by the existing repository flow; it never enters a
  URL, header, audit payload, or telemetry record
- Hosted bearer resolution mirrors rotation: current and unexpired previous
  credentials establish ordinary device scope, an unexpired pending credential
  establishes scope only for exact commit, and an invalid bearer cannot fall
  back to trusted-proxy identity
- A package-owned runtime configuration separates local and production
  companions. Production packaging requires exact non-loopback HTTPS API/app
  origins, emits only the selected API host permission, disables local ZIP
  behavior, and creates a distinct deterministic archive
- The production popup opens only its packaged app origin and declares
  browser-managed updates. Heartbeat advertises production transport/update
  capabilities, while admin distinguishes local from production companions
- Hosted mode returns a closed response for both local release endpoints,
  reports `localExtensionUpdates=false`, and supplies no local download link to
  onboarding; the dashboard does not synthesize a fallback ZIP URL
- Tests cover origin enumeration resistance, one-time tenant scope, wrong-route
  pairing denial, all credential slots, invalid-bearer fallback denial,
  deterministic HTTPS packaging, loopback rejection, hosted release closure,
  managed updates, and production-only request origins
- No migration is required; schema 36 remains current. This is not a published
  browser release, TLS/IdP/PostgreSQL deployment, worker fleet, device-risk
  service, or action expansion

### Recoverable Chrome device credential rotation (0.38.0)

- Migration 36 adds credential generation/issued time, a 10-minute pending
  hash slot, and a two-minute previous-hash grace slot to paired Chrome
  devices. Existing devices are backfilled at generation one using their
  original creation time; migration never rotates or reveals an existing token
- Rotation is a recoverable two-phase protocol. Begin requires the exact
  current bearer but leaves it valid. Chrome validates and persists the random
  pending token before commit; commit authenticates with that pending token and
  atomically promotes only the exact next generation
- Commit is idempotent for the promoted token/generation. A lost begin response
  leaves the old token untouched, while a lost commit response resumes from the
  pending token before the next heartbeat. Pending credentials cannot call any
  ordinary device API, and previous-grace credentials cannot start rotation
- The extension normalizes stored current/pending state, rotates after 30 days,
  retains pending state through transient outages, and adopts the new token
  only after a bound commit receipt. Revocation clears pending and previous
  hashes atomically
- Cross-field database triggers reject partial recovery slots; partial unique
  indexes prevent slot-local hash reuse. Server persistence, audit, telemetry,
  snapshots, and UI never expose a raw current, pending, or previous token
- Rotation routes remain Chrome-origin restricted, tenant/user scoped,
  `no-store`, and represented by the closed
  `device.credential_rotation` telemetry key. Admin sees only generation,
  readiness, and pending recovery status
- Repository, HTTP, migration, and production service-worker tests cover
  current/pending separation, lost begin, expired pending, lost commit response,
  idempotent commit, grace expiry, stale-token denial, revocation, migration
  backfill, origin rejection, and secret non-disclosure
- This advances the Phase 2 hosted-device security seam, but it is not a
  production IdP, TLS ingress, fixed production extension origin, device-risk
  service, or revocation fleet. No retailer action or qualification is widened

### Privacy-bounded adapter repair intelligence (0.37.0)

- Packaged read-only observers can now attach up to five stable structural
  landmarks when an unblocked exact product page contains one recognizable Add
  control that no packaged selector matches. Only button/input/role-button plus
  `data-testid`, `data-test-id`, `data-automation-id`, `data-button-state`, or
  `name` is eligible
- Landmark values must be short commerce-shaped tokens, select the exact
  element locally, and contain no long numeric/hash component or checkout,
  order-submission, payment, account, credential, contact, address, cookie,
  CSRF, or token vocabulary. DOM/element text, IDs/classes, paths, URLs, SKUs,
  values, and arbitrary selectors remain absent
- The extension service worker reconstructs the allowlist before transport and
  the server independently validates structural consistency before retention.
  Manipulated or blocked layouts fail closed; unknown injected fields are
  discarded
- Open read-only selector-miss groups derive a non-executable maintainer
  suggestion and aggregate occurrences, distinct paired devices, and distinct
  exact retailer SKUs. Three devices and two SKUs mark local evidence
  `maintainer_ready`; every suggestion remains `executable: false`
- Admin shows the selector and evidence progress without page content. A
  suggestion cannot auto-create or promote a recipe, alter a packaged observer,
  qualify a retailer, or authorize mutation. Existing quarantine, shadow,
  canary, signing, rollback, kill-switch, and hosted witness gates remain intact
- Focused tests cover unique capture, dynamic/sensitive/ambiguous rejection,
  generated production bundles, extension transport sanitization, server
  revalidation, exact-layout grouping, device/SKU aggregation, API projection,
  and non-executable UI language
- This resolves the count-only blind spot enough for safe maintainer triage. It
  is still tenant-scoped evidence, not the future cross-account community
  plane; reputation, Sybil defense, retention/deletion, global curation,
  independent validation, candidate synthesis, and autonomous promotion remain
  open. The feature itself required no migration; 0.38 later advances the
  schema to migration 36. No retailer lane is widened

### Durable TrackaLacker signal evaluation boundary (0.36.0)

- Authenticated Chrome delivery no longer evaluates a TrackaLacker signal in
  the device HTTP request. The packaged parser output is normalized, stripped
  of ephemeral offer material, accepted into the existing tenant/user inbox,
  and paired with an immediate priority-80 worker wake in one transaction
  before the endpoint returns `202`
- The durable `signal_event_v1` contract is the only inbox event leased by the
  packaged signal processor. One task evaluates at most 25 messages; unrelated
  hosted inbox contracts remain untouched. The generic local/manual signal
  endpoint remains synchronous and is explicitly outside the device path
- Signal-engine transactions remain transport idempotent. A failure before
  evaluation acknowledgement retries with one fixed redacted code and stops at
  the existing 20-attempt inbox dead-letter bound. If evaluation commits but
  acknowledgement is uncertain, lease recovery replays into the engine's
  duplicate path rather than applying the signal twice
- Migration 35 updates only an untouched 0.35 hosted-delivery default into the
  15-second **Signal inbox and delivery recovery** fallback. Immediate wakes
  respect operator pause: intake remains durable while evaluation is deferred,
  and resume drains the queue
- Operations exposes scoped aggregate inbox states and payload-free dead-letter
  metadata. `worker.manage` can reset one corrected signal message; its state
  reset, audit/outbox receipt, and new wake are atomic. The UI never receives
  the sanitized signal payload, raw offer ID, or lease capability
- Focused tests cover atomic queue rollback, active deduplication, schedule
  pause/resume, exact event-type leasing, poison dead letter, bounded batches,
  post-commit acknowledgement uncertainty, operator retry, API status taxonomy,
  and the paired-device-to-worker integration
- This completes the TrackaLacker device-signal portion of Phase 2 request-path
  extraction. It does not provide PostgreSQL, a fleet scheduler, external
  outbox dispatch, recipe evaluation workers, notification dispatch workers,
  or production identity, and it widens no retailer capability

### Async worker port and standalone SQLite process (0.35.0)

- Background execution now depends on asynchronous persistence and handler
  contracts in shared packages rather than the API application. The existing
  five closed maintenance families use the same contract in embedded and
  standalone layouts; no remotely supplied task kind or executable payload is
  accepted
- The SQLite adapter supports fixed-local or bounded all-principal keyset
  pagination. Every schedule, lease, transition, handler scope, and heartbeat
  remains bound to an exact tenant/user principal, while cycle and per-principal
  task limits prevent an unbounded sweep or one busy principal monopolizing a
  cycle
- `YOINK_BACKGROUND_WORKER_MODE` makes `embedded`, `external`, and `disabled`
  explicit. Local setup remains embedded by default; hosted boundary mode
  defaults external. API health reports the selected mode, actual runtime kind,
  liveness, error state, and complete standalone-principal coverage rather than
  treating process configuration as readiness
- `apps/worker` is an independently runnable and gracefully stoppable process.
  It refuses to create, seed, or migrate SQLite and requires the API-owned
  migration ledger to match the package exactly. Startup failures are fixed and
  redacted; no exception or filesystem detail is printed
- An uncertain completion persistence result never triggers a contradictory
  failure transition. The lease remains recoverable after expiry with a new
  one-use capability. Focused tests cover asynchronous failure, ambiguous
  completion, cursor tampering, multi-principal fairness, exact-schema refusal,
  startup redaction, real child-process execution, health, and shutdown
- This completes a local/staging process-extraction milestone, not the Phase 2
  production exit gate. The shared store still uses synchronous SQLite; no
  PostgreSQL implementation, production fleet scheduler, backup/PITR service,
  production IdP, or fleet cutover is claimed, and no retailer capability is
  widened

### Durable local background-work boundary (0.34.0)

- Migration 34 adds five closed, tenant/user-scoped maintenance schedules,
  durable tasks, append-only task events, worker heartbeats, and the dedicated
  `worker.manage` permission. Security and tenant administrators receive that
  permission; ordinary users and read-only support cannot mutate worker state
- The local runtime executes outside HTTP request handling. Its packaged task
  registry is limited to action/spend safety recovery, Chrome notification
  lease recovery, hosted inbox/outbox lease recovery, sanitized adapter-alert
  reconciliation, and operational telemetry retention. No arbitrary payload,
  remotely supplied handler, or executable recipe enters the queue
- Task claims carry one-use random capabilities; SQLite stores only a bound
  hash. Expired leases can be reclaimed with a different capability, retries
  use bounded backoff, maximum attempts stop in dead letter, and operator retry
  resets the bounded attempt budget with an audit/outbox receipt. Successful
  and cancelled history is retained for 30 days; unresolved dead letters are
  not pruned
- Two SQLite connections contend safely for one task. Tenant/user isolation,
  crash recovery, old-capability rejection, retry/dead-letter behavior,
  append-only transition events, sanitized results, and exception-text
  non-disclosure have focused tests
- The permission-gated **Operations** workspace shows schedules, queue counts,
  recent bounded results, dead letters, and 30-second worker heartbeats. An
  authorized operator can pause/resume a schedule, run it once, or retry a dead
  letter; none of those controls has retailer mutation authority
- At 0.34 this is a production-shaped local modular-monolith seam with an
  in-process SQLite runtime. Version 0.35 extracts the async worker port and a
  standalone bounded-principal SQLite adapter, and 0.36 adds the first packaged
  signal-evaluation consumer. Version 0.42 adds bounded signed-webhook dispatch
  to the packaged alert task. PostgreSQL, a production fleet, managed connector
  infrastructure, recipe workers, and deletion orchestration remain open Phase
  2/3 work
- Target and Walmart retain their existing independently qualified add-only
  state. Amazon, Best Buy, marketplace, pickup, checkout, drawing entry,
  payment, and order submission are not widened

### Self-service user data inventory and export (0.33.0)

- Migration 33 adds the dedicated `user.privacy.export` permission to the
  baseline user role without changing any retailer or mutation state
- Preferences now shows a plain-language **My data** inventory across eight
  categories and downloads one versioned `yoink-user-data-json-v1` archive
  scoped to the authenticated tenant and user
- The archive is produced from one read transaction with explicit projections.
  Device and pairing token hashes, request nonces, job and notification
  capabilities, and inbox lease capabilities are structurally absent; tenant-
  wide administrator configuration, telemetry, outbox data, and other users'
  records are excluded
- Exact public catalog and offer data appears only when referenced by the
  user's own plan or action. The download is `no-store` and carries exact byte
  length, format, content-disposition, and SHA-256 headers
- Cross-tenant repository/API tests cover denial, exact archive counts, JSON
  field decoding, hash verification, and credential non-disclosure. A schema
  ownership guard fails when a new user-related table lacks an explicit export
  disposition
- Full account deletion remains infrastructure-gated rather than simulated:
  production IdP revocation plus a deletion-specific cleanup/reconciliation
  workflow on a deployed worker fleet are still required. Existing per-feature
  consent revocation and physical community/identity-claim deletion remain
  unchanged
- No retailer action, seller, fulfillment, checkout, payment, drawing-entry,
  or order-submission capability is widened

### Nontechnical setup and exact product-link intake (0.32.0)

- The user dashboard now projects one five-step setup path over the existing
  device, source, shared catalog, private plan, and global action state. Current
  versus outdated and online versus offline Chrome, pending review, notification
  readiness, guarded-cart readiness, shadow mode, and paused/pending approval
  are separate states rather than one optimistic ready flag
- A two-stage **Add product link** flow supports all thirteen registered
  retailers. The server extracts the exact retailer and SKU, reconstructs a
  tracking-free canonical URL, and rejects search, category, Walmart Draw hub,
  insecure, credential-bearing, unsupported, and URL/SKU-mismatched input
- Product-link submissions use a private, manual, informational `user_link`
  provenance record and the existing catalog review queue. They always enter as
  unknown availability with no price and cannot create an offer observation,
  mission, plan, signal, job, or retailer permission. A forged user-link stock
  or price claim is rejected even if it targets the lower-level proposal API
- Catalog normalization now binds every source's canonical URL to the supplied
  exact retailer SKU. This closes the prior gap where a correct retailer domain
  alone could accompany a different SKU and preserves query-bound identities
  such as Macy's during canonicalization
- Hosted two-person action-resume responses remain visibly pending and paused in
  the user UI. Local emergency pause stays immediate; approval itself remains
  inert until the unchanged protected operation is retried
- Domain, repository, tenant-isolation, API, readiness, and simulated-browser
  tests cover all retailer formats and prove that preview/submission performs no
  purchase-plan or stock mutation. No migration or retailer capability changes
  in this release

### High-risk administrative change control (0.31.0)

- Migration 32 adds tenant-scoped protected-change requests, immutable review
  decisions, and append-only lifecycle events. Requests bind a closed operation
  type, target, canonical payload hash, bounded safe summary, correlation, and
  expiry; arbitrary bodies, secrets, credentials, and tokens are never stored
- Hosted request signatures now bind authentication assurance, authentication
  time, and session identity. Fresh step-up expires after five minutes. The
  loopback bootstrap uses an internal-only boundary marker that hosted headers
  cannot impersonate
- Role grants, observer trust installation, recipe promotion/rollback,
  retailer-lane activation, and action resume require a different authenticated
  user and actor. Safety-narrowing or configuration operations use fresh
  step-up; emergency pause remains immediate
- Approval is deliberately inert. An unchanged retry within 15 minutes consumes
  the approval atomically with the protected mutation; self-approval, payload
  drift, cross-tenant lookup, stale assurance, expiry, failed mutation, and
  replay are covered by repository and API tests
- The permission-gated **Approvals** workspace shows safe summaries, assurance,
  queue state, expiry, and immutable event counts without exposing payload
  fingerprints or hidden request data
- Local/offline operation remains compatible through audited local-trusted
  receipts. This is the application enforcement seam, not the production IdP,
  MFA, hosted session lifecycle, or break-glass implementation
- No retailer action, seller, fulfillment, checkout, payment, drawing-entry, or
  order-submission capability is widened

### Privacy-bounded operational telemetry (0.30.0)

- Migration 31 adds tenant-scoped minute request rollups, bounded error events,
  and immutable retention receipts. Successful traffic is aggregated; only
  4xx/5xx failures receive an individual row
- Route dimensions come from a closed package allowlist and never include
  dynamic path segments or query strings. Error rows retain only a one-way
  correlation key, method, actor kind, status, duration, and safe server-owned
  error code; bodies, messages, product IDs, user values, DOM, credentials, and
  offer tokens are structurally absent
- API instrumentation runs after response completion and fails open for request
  delivery. Tenant isolation, fixed latency bands, 30-day automatic pruning,
  and append-only aggregate deletion receipts are covered by repository and API
  tests
- The permission-gated **Operations** workspace exposes closed 1-hour, 24-hour,
  7-day, and 30-day windows, route health, bounded latency, safe failure
  families, and recent one-way correlations. `admin.read` is required
- This completes the local structured metrics/log-retention slice of Phase 0;
  it does not supply PostgreSQL, a production metrics backend, durable workers,
  an IdP, independent witness operation, or on-call delivery. Version 0.31 adds
  the step-up enforcement contract but still does not operate an IdP/MFA service
- No signal, decision, qualification, job, lease, or retailer capability is
  changed

### Mission-owned purchase decisions (0.29.0)

- Migration 30 adds append-only `strategy` versus `purchase_intent` decision
  mode and a bounded signal-freshness window to intent revisions. Existing
  0.28 reviewed user plans receive a new direct-mode revision while their prior
  immutable revision remains intact; source/internal missions stay strategy
  driven
- A reviewed plan now evaluates the enabled exact listing, trusted-exact source,
  explicit seller and fulfillment, numeric price and unit cap, expiry, and
  120-second freshness directly. It works with an empty strategy set, a
  notification-only plan cannot be widened by an add strategy, and an
  informational source cannot authorize retailer mutation
- Direct mission decisions and jobs are explicitly attributed to
  `purchase_intent`; no synthetic strategy row or fake foreign key is created.
  Qualified direct cart jobs enter the same intent/snapshot, spend reservation,
  adapter qualification, authenticated device lease, and Chrome revalidation
  pipeline as strategy-driven jobs
- The plan editor explains which decision layer owns the plan and preflights
  every enabled cart store. Repository validation independently requires a
  packaged mapping, reviewed unit cap, first-party seller, shipping, and an
  all-in cap covering requested quantity plus current tax/store allowance; an
  invalid update rolls back the staged mission and targets
- Migration, repository, signal-engine, API, dashboard, and execution tests
  cover historical backfill, strategy-free notification/cart jobs, stale and
  seller-unverified rejection, no strategy widening, unsafe update rollback,
  and a real qualified lease boundary
- Retailer capabilities do not change. Direct plans remain limited to notify or
  guarded add-to-cart; marketplace sellers, pickup mutation, checkout, payment,
  drawing entry, and order submission remain closed

### Guided exact purchase-plan creation (0.28.0)

- The user dashboard no longer creates an active default plan and asks for
  limits afterward. Selecting a product opens a plain-language review of the
  exact SKU/variant, retailer-as-seller, fulfillment, quantity, unit/all-in
  caps, timing, and allowed notification or cart action; no server write occurs
  before the final reviewed submission
- A versioned creation contract validates strict numeric bounds, first-party
  seller, exact-only substitution, supported fulfillment/action combinations,
  current listing execution support, expiry/cooldown, and an explicit review
  confirmation. Guarded cart selection additionally requires an all-in cap at
  least as large as the action engine's current tax and store-fee safety bound
- Mission, complete variant target set, custom intent revision 1, audit, and
  outbox commit atomically. Only the selected listing starts enabled; invalid
  policy data rolls everything back, and a concurrent/duplicate create returns
  a conflict without overwriting the existing plan
- Legacy user creation is now a notification-only draft. Signal/internal
  mission creation retains its strategy behavior. Listings discovered after a
  mission exists attach disabled and cannot silently expand retailer consent or
  the frozen current target policy
- Product and plan cards now distinguish last numeric observed price from MSRP,
  expose normalized exact-variant dimensions and observation age, and summarize
  the primary store, current/maximum prices, quantity, fulfillment, action, and
  all-in cap. A dashboard interaction test proves opening setup performs no
  POST and the confirmed payload contains every visible bound
- No migration or mutation-capability change is included. Marketplace sellers,
  verified-equivalent execution, pickup mutation, checkout, payment, drawing
  entry, and order submission remain closed

### External observer-recipe witness seam (0.27.0)

- Migration 29 adds tenant-scoped append-only external-witness receipts and
  sanitized check outcomes with immutable update/delete guards; it changes no
  retailer execution or qualification state
- A separately operated HTTPS witness receives only the public root/manifest
  hashes and current transparency sequence/event hash. The server pins its
  Ed25519 public key and verifies the exact response schema, signature,
  checkpoint hash, witness sequence, predecessor receipt, and bounded lifetime
- Hosted configuration now requires an explicit witness URL, log namespace, key pin,
  and maximum receipt age. An active recipe is not delivered to Chrome unless
  the current transparency tip has a fresh valid receipt; a new manifest or
  recipe signature makes the prior checkpoint insufficient
- `/admin`, the snapshot, and health API expose disabled, pending, healthy,
  degraded, stale, inconsistent, or configuration-missing states plus fixed
  availability/consistency alarm codes. Publication is explicit and audited;
  failures retain no response bodies or transport details
- Local/offline mode remains backward-compatible and advisory. This repository
  deliberately does not contain the independent witness service or its private
  key; external deployment, scheduling, public monitoring, and consistency
  canaries remain production infrastructure work
- Each tenant receives a stable pseudonymous derived witness log so independent
  chains cannot compete for one sequence. Checkpoints contain no selectors,
  DOM/page text, products, browsing history, URLs, raw tenant/user/device IDs,
  account data, tokens, or mutation authority

### Best Buy lifecycle layout coverage (0.26.0)

- Migration 28 retires inherited Best Buy qualification, retailer execution,
  and listing execution flags without changing any other retailer lane
- `bestbuy-observer-v5` recognizes standalone Pre-order controls and preserves
  exact bounded price, seller, selected fulfillment, and SKU evidence
- High-demand product gates and active queues are distinct manual states. A
  high-demand page can contribute safe read-only evidence, but its Add control
  is never actionable and no queue interaction is attempted
- Pickup-selected limited-stock and ordinary pickup-selected layouts remain
  valid observation evidence; neither can satisfy selected-shipping checks
- Best Buy qualification counts only in-stock actionable candidates. Preorders
  are read-only, and `bestbuy-add-v3` rejects them again inside the isolated
  page runner before any authorization or click
- The companion explains preorder, high-demand, queue, and pickup boundaries,
  while sanitized `interactive_high_demand` results reach the diagnostic ledger
  immediately. No DOM, page text, URL, account data, or token is transmitted

The future Best Buy preorder and high-demand mutation lanes remain separate
roadmap work requiring explicit policies for release dates, delayed charges,
quantity limits, queue lifecycle, cancellation, and order reconciliation.

### Exact selected-offer community identity (0.25.0)

- Migration 27 persists a versioned selected-offer state, server-bound public
  child key, normalized variant attributes, and server-derived fingerprint on
  sanitized shadow observations and community assertions
- Packaged observers extract only eight allowlisted dimensions: size, color,
  edition, language, pack, condition, finish, and style. The contribution path
  still accepts evidence references only; DOM, page text, screenshots, form
  payloads, cookies, account/location data, and opaque offer tokens remain
  excluded
- The server independently validates that the current public child key matches
  its exact retailer SKU, canonicalizes variant values, and refuses unknown
  dimensions. Retailers whose product ID may represent a style rather than a
  purchasable child remain `listing_only` unless a unique selected dimension is
  observed
- Community observation keys now bind selected-offer fingerprint, seller,
  fulfillment, and explicit location scope. Conflicting variants cannot poison
  one another; `listing_only` and `unresolved` assertions are quarantined with
  zero identity confidence and cannot become advisory stock
- The popup and user control plane disclose the selection state. The companion
  advertises a separate capability, and local throttling distinguishes exact
  selected offer, seller, and fulfillment. A recognized but ambiguous variant
  control emits the sanitized `selected_offer_binding_unresolved` repair reason
  immediately. No mutation adapter, qualification, checkout, drawing entry, or
  order authority changed

### Package-rooted observer recipe trust (0.24.0)

- Migration 26 retires every active or signed trust-on-first-use recipe without
  changing retailer execution or qualification state. It adds immutable,
  tenant-scoped trust-manifest generations and append-only chained
  transparency events
- The server and companion pin the same Ed25519 public offline root. The root
  authorizes bounded online intermediate keys through exact-schema manifests;
  one active unrevoked key is required, generations and predecessor hashes are
  monotonic, prior keys cannot silently disappear, and revocation is permanent
- The paired companion validates the complete root-signed chain, current
  manifest/hash, active-key fingerprint and lifetime, transparency checkpoint,
  recipe signature, and selector schema. It persists the latest generation and
  event checkpoint so replay, conflicting generations, broken rotation chains,
  corrupted root signatures, expired manifests, and revoked signers fail closed
- `npm run recipe-trust` initializes, renews, or rotates the online
  intermediate while loading the offline root only inside the explicit CLI.
  Named intermediate key files support restart after rotation; private material
  is never printed, served, packaged, archived, or stored in SQLite
- `/admin` exposes public root/manifest/revocation/transparency health and an
  explicit signed-manifest install control. Rotation may temporarily close
  distribution; after the process loads the new intermediate, maintainers must
  explicitly and auditably re-sign already reviewed recipes without changing
  their selectors or lifecycle state
- Rooted recipes remain declarative data for five packaged read-only fields.
  They cannot determine product equivalence, navigate, click, fill a form,
  qualify an adapter, enter a drawing, check out, submit an order, or grant any
  retailer mutation capability. See the [operator
  runbook](OBSERVER_RECIPE_TRUST.md)

### Privacy-classified operator alerts (0.23.0)

- Migration 25 adds tenant-scoped operator alert rules, deduplicated incidents,
  append-only lifecycle events, and append-only delivery receipts. Existing
  and newly provisioned tenants receive one conservative adapter-repair rule
- Authenticated diagnostic ingestion and alert reconciliation share one
  transaction, so an accepted structural failure cannot be committed without
  its matching threshold/dedupe/routing decision. A recovered repair group
  automatically resolves its alert; a manually resolved historical group stays
  closed until a strictly later qualifying failure occurs
- Rules narrow the fixed `adapter_repair` family by retailer and operation and
  configure severity, occurrence threshold, dedupe window, escalation window,
  enabled state, and dashboard/audit-outbox routes. Every route, acknowledge,
  resolve, reopen, recovery, and escalation transition produces immutable
  operational evidence
- `/admin` now has an Alerts workspace for redacted incident triage, rule
  management, and delivery history. `admin.read` gates projections and the
  separate `alert.manage` permission plus explicit confirmation gates every
  mutation; tenant-forcing tests reject cross-tenant access
- Admin alert projections omit exact SKU, page URL/content, tokens, actor
  identity, account data, and free-form notes. The restricted append-only
  audit history retains actor identity for accountability. Alert records use
  stable allowlisted reason/stage enums, structural hashes, bounded counts, and
  tenant-scoped pseudonymous source cohorts. Companion/server allowlist parity
  is regression-tested
- This began as a local adapter-repair vertical slice. Version 0.42 adds the
  first durable signed-webhook route and worker dispatch; version 0.43 adds
  governed exact dead-letter replay and a sanitized local health/SLO
  projection. Email/pager providers, managed secrets, production retention,
  independent monitoring, and broader alert families remain open. Alert
  configuration has no purchase or retailer-lane mutation authority

### Walmart Collectibles Draw read-only lifecycle (0.22.0)

- Migration 24 adds a tenant/user/device-scoped, idempotent Walmart Draw scan
  and exact-item ledger with bounded retention. It stores normalized public
  drawing facts only and reconstructs canonical Walmart item URLs server-side
- `walmart-draw-observer-v1` accepts only the exact Collectibles Draw hub. It
  parses bounded server-rendered draw modules with a visible-card fallback,
  detects security/manual blocks, normalizes PDT/PST close labels, deduplicates
  exact Walmart item IDs, and fails partial when price, seller, close time,
  draw control, or suppressed Add evidence is incomplete
- The companion runs this observer only from an explicit user click and posts
  authenticated sanitized scans. Bundle, execution, top-frame, runtime,
  collection, and contract failures are immediately recorded with allowlisted
  codes; raw browser errors and page/account data never leave the tab
- User and admin read models show current drawings, price, close time, quantity
  limit, exact plan matches, scan health, and failures. Expired active drawings
  leave the current projection, while historical evidence remains bounded
- The four validated live records on 2026-08-24 were Walmart item IDs
  `19624258216`, `19536452232`, `5631614124`, and `18029663536`; fixture and
  production-bundle tests preserve their exact prices and limits
- Drawing entry is intentionally not implemented. Entry is one per customer,
  cannot be canceled or changed, and authorizes Walmart to place and charge an
  order if selected. The observer collects no address, payment, account,
  membership, session, cookie, offer token, or entry status and is structurally
  unable to call the entry endpoint. Draw evidence never qualifies
  `walmart-add-v3`

### Reversible local catalog identity governance (0.21.0)

- Migration 23 adds separately authorized `catalog.identity.propose` and
  `catalog.identity.approve` capabilities plus tenant-scoped merge, split, and
  compensating-operation records
- Every proposal freezes a deterministic catalog topology hash. Approval
  rechecks the current topology and rejects stale state, active purchase jobs,
  active spend reservations, ambiguous mission targets, and shared-catalog
  mutation when more than one tenant exists
- Merge is deliberately narrow: it requires a reviewed, conflict-free strong
  identifier claim bound to the exact listing/variant pair, equal allowlisted
  variant dimensions, and approval by a different authorized user and actor.
  Titles, images, prices, and similar URLs remain insufficient evidence
- Split moves only explicitly selected listings, matching source-listing
  candidates, preferred routes, and wholly selected missions into a new exact
  variant. It requires a changed allowlisted dimension and leaves broad source
  product references on the original identity rather than guessing
- Immutable before/after snapshots and append-only per-operation sequence
  events make every applied change auditable. A compensating operation restores
  exact recorded row IDs only when the applied topology has not drifted;
  re-expanding a prior split requires independent approval
- The admin catalog screen exposes proposals, review, rejection, history, and
  compensating rollback. HTTP authorization, error taxonomy, upgrade,
  portability, immutable-ledger, stale-state, active-work, and exact-restore
  tests cover the boundary
- This is a local single-tenant governance slice, not global catalog authority.
  Production IdP/step-up, privacy-classified operations, package-rooted recipe
  trust, and cross-tenant global curation remain Phase 0 exit requirements

### Exact intent and spending safety (0.20.0)

- Migration 22 adds tenant-owned immutable exact-offer keys and offer snapshots.
  The key combines the exact listing/SKU, allowlisted variant dimensions,
  condition, seller, fulfillment, and reserved region/store slots. Ephemeral
  Amazon offer tokens remain page-memory-only and never enter these tables
- Mission preferences now produce append-only intent revisions with optimistic
  concurrency. Each revision freezes quantity, exact target policies, unit and
  all-in caps, action ceiling, substitution policy, expiry, and cooldown
- User spend policy supports optional per-order, daily, and monthly caps.
  Transactional reservations claim quantity and bounded spend before a live job
  can be leased; an append-only ledger records reserve, release, and future
  verified commit events
- A live mutation lease requires the current intent revision, immutable offer
  snapshot, and active unexpired reservation. Revising a plan cancels safe
  unleased stale jobs and releases their reservations in the same transaction
- The user dashboard and canonical user API expose these controls and ledger
  state. The admin snapshot exposes aggregate reservation and ledger counts
  without enabling checkout, payment, or order submission
- Add-to-cart confirmation is no longer treated as fulfillment. It releases
  reserved capacity without recording spend; only a future verified
  `submit_order` result can commit spend and increase fulfilled quantity

### Trust, API, and product-surface foundation (0.19.0)

- Migration 20 adds persisted permissions, built-in roles, and tenant/user role
  memberships. The exact local bootstrap identity remains an explicit
  development exception; a hosted `maintainer` actor label has no implicit
  privilege. Device and service actors receive only fixed narrow capabilities
- Explicit `/api/v1/user`, `/api/v1/admin`, `/api/v1/devices/self`, and
  `/api/v1/internal` surfaces enforce server-side permissions. Classified
  compatibility routes remain temporarily available with deprecation headers;
  unclassified API routes fail closed
- Every HTTP error now carries an `X-Request-ID` and matching correlation ID,
  with distinct authentication, authorization, not-found, validation, and
  opaque internal-error status behavior
- Migration 21 adds a tenant-scoped catalog proposal/review queue. User
  suggestions are normalized to an allowlisted listing payload, deduplicated,
  audited, and held pending; only a curator can approve/reject and apply a
  change. Direct manual user writes to shared listings are disabled
- `/` is a minimal exact-product and purchase-plan dashboard. It exposes
  products, store/seller/fulfillment/quantity/price preferences, recent actions,
  pause/resume, catalog-review status, sources, and Chrome pairing without
  recipes, adapter versions, or parser internals
- `/admin` is a separate permission-gated bundle. It retains operations,
  diagnostics, retailer qualification, community/recipe, source, attribution,
  and audit controls and adds catalog review plus audited role membership
  management. Ordinary users cannot load its HTML, JavaScript, or stylesheet

### Local commerce control plane

- Normalized SQLite commerce graph with tenant/user ownership, exact variants,
  many retailer listings, source aliases/candidates, missions, mission targets,
  offers, incidents, decisions, jobs, notifications, and attribution receipts
- Transactional numbered migrations, integrity checks, and pre-migration backups
- Tenant-scoped audit plus transactional outbox for a future hosted control plane
- No mission-count cap; paginated/searchable Library, Missions, Opportunities,
  Actions, and Activity views
- One-mission-per-variant sibling-store claim so concurrent sources cannot create
  competing purchases
- Explicit manual resolution for post-mutation and submission uncertainty

### Signal and mission engine

- Source-neutral normalized signal contract
- Exact source-listing, retailer-SKU, preferred route, and source-slug resolution
- Trusted exact signals create missing catalog identity and user missions
- Ordered revisioned strategies: source, retailer, price maximum, seller type,
  allowed seller names, fulfillment, quantity, signal age, keywords, exclusions,
  and action
- MSRP is a cap and includes lower prices; missing trusted price/cap fails safe
- Transport dedupe, semantic incident corroboration, legitimate re-signals, and
  mission-wide execution dedupe
- Source reliability projections for exact matches, unresolved events,
  qualified events, and corroborations

### TrackaLacker production adapter

- Existing signed-in page-context device enrollment using the confirmed nested
  `device` payload
- Extension-owned Web Push with silent subscription on Chrome 121+, explicit
  visible-fallback diagnostic, durable sanitized queue, and restart draining
- Stock, restock, preorder, test, unsupported, duplicate, and redacted parser
  coverage
- Full user-requested followed-library synchronization with no application item
  cap; unavailable, unsupported-store, and alternate records are retained
- Durable sync-run progress and per-product import receipts
- No recurring TrackaLacker stock polling and no credential/push-secret storage

### Browser and retailer safety

- Authenticated Chrome pairing, heartbeat, scoped device capabilities, and
  capability-token job leasing
- Read-only visible-DOM observers for Target, Walmart, Amazon, Best Buy,
  Disney Store, Ravensburger, Riot Games Merch, Books-A-Million, Fanatics,
  Kohl's, Macy's, Premium Bandai, and Pokémon Center
- Exact product identities and sanitized canonical URLs for the nine added
  stores; their catalog, signal, notification, attribution, TrackaLacker sync,
  and diagnostic paths are enabled while mutation remains closed
- Premium Bandai observer v2 distinguishes preorder, in-stock, and closed item
  pages with exact letter-plus-ten-digit item IDs; Pokémon Center observer v2
  preserves the complete hyphenated product/variant ID so parent and child
  products cannot collapse
- Live production-bundle probes cover Premium Bandai's multilingual unavailable
  shell and Pokémon Center's Imperva `_Incapsula_Resource` frame. Both fail as
  manual/security blocks with unknown inventory and cleared offer fields, so
  access-control responses cannot poison community stock projections
- Amazon exact-ASIN offer binding and no-click route rehearsal; raw offer IDs
  never leave page memory
- Qualified `target-add-v1`: Target-sold shipping, quantity one, add-to-cart only
- Qualified `walmart-add-v3`: Walmart-sold explicit shipping, quantity one,
  add-to-cart only, activated from its completed live dossier and rehearsal
- Empty-cart preflight, immediate exact offer revalidation, durable pre-click
  receipt, at-most-once click, exact cart proof, lease recovery, and manual locks
- Walmart virtual-queue and interactive-block restraint, independent capability,
  v4 evidence dossier, exact-SKU offer scoping, split-price normalization,
  no-click rehearsal receipt, and explicit activation flow
- Separate Walmart Draw v1 discovery ledger, exact-item mission matching,
  closing-time projection, and immediate sanitized runtime-failure reporting;
  drawing entry and contingent-order authorization remain closed
- Qualification-ready `amazon-add-v5`: Amazon.com-sold explicit shipping,
  quantity one, add-to-cart only; live activation remains evidence-gated
- Amazon exact-offer scope requires price, seller, fulfillment, ASIN, unique
  offer token, and Add control to agree; the token is rechecked immediately
  before one click and is never persisted or returned. Observer v6 checks the
  exact nearest product form first, supports both combined `Shipper / Seller`
  and separate `Ships from` / `Sold by` fields, and retains Amazon-fulfilled
  third-party sellers as non-executable marketplace evidence. Non-rendered CSS
  and script text cannot supply fulfillment, and unrelated same-ASIN forms
  cannot make the selected Add form's offer token ambiguous
- Canonical Amazon offer fields take precedence over alternate payment tokens,
  while explicit checkout ASIN inputs take precedence over variation swatches
- Bounded Amazon hydration retries plus authenticated adapter diagnostics for
  observations, no-click rehearsals, and guarded live verification
- Qualification-ready `bestbuy-add-v3`: explicit Best Buy-sold, selected
  shipping, exact-SKU, quantity-one add-to-cart only; live activation remains
  evidence-gated
- Best Buy observer v5 supports current `/product/.../sku/<SKU>`, compact
  `/product/.../<SKU>`, legacy `/site/.../<SKU>.p`, and consistent `skuId`
  identities while rejecting opaque product tokens and conflicting SKU
  evidence. Current `data-testid`, `data-test-id`, automation, native-button,
  standalone Pre-order, and accessible Add-control layouts are covered. Seller names carried by
  bounded accessibility metadata inside the exact seller element are accepted;
  explicit in-store-only pages are manual/local unknown evidence rather than
  false global out-of-stock assertions. High-demand gates preserve bounded
  read-only offer evidence while queues and mutation remain closed
- Best Buy current/legacy scoped-offer coverage, marketplace and pickup
  rejection, high-demand/interactive-block restraint, empty-cart preflight,
  no-click rehearsal, at-most-once click, exact cart proof, independent
  capability, bounded hydration retries, and sanitized adapter diagnostics
- Migration 19 retires every prior Best Buy qualification and closes inherited
  execution support for the v4/v3 boundary; new evidence, rehearsal, hash
  review, and explicit activation are required
- An older exact-SKU repair incident closes only when a strictly newer packaged
  adapter later returns a deliberate pass, recovery, or manual rejection for
  that same SKU; a same-version failure cannot dismiss itself
- Server-derived layout fingerprints, bounded diagnostic retention, and an
  open/recovered adapter repair queue; raw DOM, page text, tokens, cookies,
  CSRF values, addresses, and account data are never accepted
- Post-permission runtime diagnostics cover packaged observer injection,
  execution, top-frame delivery, runtime availability, collection, and
  contract validation. They send only an exact retailer/SKU, stable reason,
  adapter version, timestamp, and zero-content structural counts; raw Chrome
  errors and query-bearing URLs never leave the extension, while pre-permission
  failures remain completely local
- Zero-content runtime repair groups close automatically only after a later
  successful observation for every affected exact SKU, preventing both stale
  resolved incidents and cross-product false recovery
- Durable adapter-diagnostic delivery across local-server outages: a
  device-bound, canonical-only outbox retries transient failures on startup and
  health cycles, deduplicates exact events, retains at most 50 entries for less
  than the server acceptance window, and drops stale, foreign-device, or
  permanently rejected payloads. Server ingestion is exactly idempotent for an
  ambiguous-response retry
- Best Buy diagnostics separately count sanitized native Add-intent controls,
  so an unknown selector is logged immediately as selector drift instead of
  being indistinguishable from an unavailable offer
- Generic retailer-mutation capabilities are rejected; every mutation lane must
  name its exact adapter version
- Cold Manifest V3 worker coverage before and after the mutation boundary
- Durable Chrome notification delivery, click/dismiss receipts, and duplicate
  suppression

### Attribution and updates

- Per-retailer canonical, Howl, and Amazon Associates policies, including
  migration 18 defaults for Premium Bandai and Pokémon Center
- Dynamic exact-listing routes, safe canonical fallback/required-route modes,
  immutable job snapshots, and attribution receipts
- Exact-version local extension release feed with filename, size, and SHA-256
- Popup update check/download and explicit unpacked-extension reload workflow
- Release archive regression coverage proving every packaged observer and all
  four exact mutation runners are present (including Best Buy)

### Community evidence and observer maintenance

Status: these are **local pilot primitives**, not a production community
network or autonomous repair system. The current local deployment cannot form
an independent-user quorum, and its validation/rate limits are not Sybil
resistance or contributor reputation.

- Explicit per-retailer opt-in and one-click contribution; automatic sharing is
  off, deletion is physical, and a visible privacy version/consent receipt is
  retained
- Server-reconstructed, nonce-bound assertions from already-sanitized browser
  evidence; the contribution API never accepts product fields, DOM, page text,
  screenshots, cookies, tokens, account fields, addresses, or payment data
- Observation keys include a server-derived selected-offer fingerprint,
  seller, fulfillment, and location. Exact public retailer item IDs and
  allowlisted selected dimensions remain separate; listing-only or ambiguous
  selections are quarantined instead of being collapsed. Store-local pickup
  scopes, 60-second local/server dedupe, TTLs, current-vote conflict quarantine,
  one latest eligible vote per contributor, median/range prices, and a three-
  contributor/device projection are implemented
- Provenance-bearing exact identity claims using validated GTIN/UPC/EAN/ISBN or
  brand+MPN plus bounded variant attributes; claims never remap the catalog or
  transfer missions. The current manual UI path does not attach a paired device,
  so it cannot satisfy the projected healthy-device quorum
- Manually proposed, signed, expiring observer-only recipes with strict
  five-field CSS extraction, lifecycle labels, extension-side Ed25519
  verification/first-use pinning, kill switch, rollback, and bundled fallback.
  This is a shadow-validation scaffold, not autonomous selector discovery,
  independent truth verification, production key rotation, or self-repair
- Remote observer data is permanently unable to navigate, click, submit,
  identify products, or authorize mutation

### Hosted portability foundation

Status: this is an authenticated request/delivery/portability seam around the
local synchronous SQLite application with persisted application RBAC and split
user/admin bundles. It is not a production identity system, step-up/two-person
admin plane, hosted extension transport, worker fleet, or PostgreSQL deployment.

- Async request-local tenant/user/actor scope across every repository with the
  existing local principal retained as an explicit default
- HMAC-authenticated reverse-proxy scopes bound to method/path/principal,
  durable one-use replay nonces, explicit Host/HTTPS-Origin allowlists, and
  paired-device token-to-scope resolution
- Idempotent service-only principal provisioning with private settings,
  sources, strategies, and attribution policies
- Per-user retailer mutation qualification so one account's activation cannot
  authorize another account
- Sanitized 64 KiB inbox envelopes, content-hash idempotency conflicts,
  tenant/user isolation, one-use capability leases, bounded retries,
  dead-letter state, tenant outbox leasing, and append-only delivery receipts
- Future pickup, prepare-checkout, and submit-order prerequisite matrix; all
  twelve per-retailer lanes remain closed and prepare/submit jobs are never
  leasable even when add-only execution is live

### Operational portability and recovery

- Read-only SQLite source opening that performs no migration, seed, or
  permission mutation
- Streaming, item-count-unbounded `yoink-portability-ndjson-v1` archive with an
  exact migration/schema manifest, tagged integers/blobs, stable primary-key
  ordering, per-table counts/hashes, aggregate logical-data hash, and complete
  file SHA-256
- Private `0600` archive creation, overwrite refusal, corruption/truncation
  rejection, and no archive download API
- Fresh-database-only restore with schema parity, foreign-key and integrity
  checks, exact table/data reconciliation, and cleanup limited to output files
  created by the failed restore
- Export, verify, compare, restore, and complete recovery-drill CLI commands;
  changed source tables are named and a non-quiescent drill fails closed

## Architecture assessment after 0.73.0

Yoink 0.73.0 is a strong local commerce safety kernel with a production-shaped
trust/API/UI spine. It is not yet the full
community-driven, self-correcting purchasing application. The existing exact
identity graph, immutable action capabilities, Chrome-side final verification,
diagnostic ledger, outbox, service-attested eligibility boundary, and regional
conflict circuit breaker are valuable foundations. The next work should finish
production catalog authority, deploy the independently operated witness and
public consistency monitor behind the now-qualified refresh boundary, add a real
identity/device-risk provider with public reputation and abuse operations, and
stable child-offer/location identity before adding governed read-only field
application, checkout, or more autonomous behavior.

| Product goal | Current repository truth | Critical gap |
| --- | --- | --- |
| Primary backend database | Transactional migration-48 SQLite source of truth plus deterministic operator portability; a PostgreSQL 15+ preflight, production-driver-backed one-shot importer, exact schema/data reconciliation, translated relational invariants, complete zero-unresolved table-scope classification, direct/inherited forced-RLS qualification over all 83 private tables, a complete asynchronous tenant queue repository proven through an inactive server-bound writer with 12 table-operation grants, one immutable constraint helper, four restrictive write policies, and atomic deployment attestation before new-work queue SQL; a separate inactive three-table/19-column-grant fleet-control role for principal pagination, deployment status, and worker stopping; six of seven worker handler families (`notification_recovery`, `execution_recovery`, `operational_telemetry_retention`, `observer_recipe_candidate_evaluation`, `adapter_alert_reconciliation`, and `observer_recipe_witness_refresh`) proven through inactive principal-bound function-only roles with zero direct table grants, plus the final hosted-delivery handler's complete three-table lease-recovery sub-boundary with exact SHA-256 retry/dead-letter receipts; database-owned clocks, directly tenant/user-owned signal incidents, fail-closed shared-incident mutation, authenticated bounded retention, a two-phase evidence-revalidated quarantine-only candidate compiler, full diagnostic-to-incident lifecycle reconciliation, secretless connector dispatch, and external-transaction-free Ed25519 witness publication with database-revalidated public receipt evidence; five inactive least-privilege read-role templates; an empty server-owned tenant-principal registry with a zero-argument binder and 83 restrictive scope policies; native PostgreSQL 16 tenant read/write/control/handler isolation, receipt parity, idempotent/concurrent execution, and three-session lease-contention proofs; and permanently inert cutover authority; recoverable generation-bound Chrome credentials; deny-by-default singular internal-service capabilities; and asynchronous embedded/standalone SQLite worker ports | Hosted signal evaluation (the remaining half of `hosted_delivery_recovery`) and every request-repository family remain incomplete; there is no production login/principal provisioning, activation of the qualified fleet composition, remaining writer families, deployed multi-process fleet/load/outage proof, production identity/risk provider, backup/PITR service, cryptographic workload identity, signed artifacts, managed secrets, or hosted authority cutover |
| Admin control plane | Separate permission-gated `/admin`, persisted roles, listing review, reversible local merge/split/compensation, diagnostics and alerts, deployment-reference webhook configuration, connector binding health, rolling delivery SLOs, regional observer-conflict operations, governed dead-letter replay, and retry/dead-letter receipts, bounded service-health telemetry, attested durable-worker schedules/dead letters/heartbeats, payload-free signal dead-letter recovery, retailer/source/affiliate controls, signed step-up enforcement, exact expiring requests, and independent approval for safety expansion | No production IdP/MFA/risk-provider hookup, managed secret provider, email/pager adapters, independent connector monitoring, support break-glass workflow, cross-tenant global curator, or general retailer-configuration rollback |
| Minimal user application | Separate `/` dashboard with a state-derived five-step setup guide, safe exact-link intake for all supported retailers, contributor-owned plain-language recovery review with reversible answers and visible automatic expiry/hosted-eligibility state, a scoped My data inventory/export, explicit pending-review boundaries, server-authoritative no-purchase-write guided-plan preflight with fresh receipt binding, atomic exact intent revision 1, mission-owned direct decisions without hidden strategies, preflighted cart edits, current-vs-MSRP pricing, exact variant/store cards, revisioned store/seller/fulfillment/unit/all-in limits, action/freshness/expiry/cooldown, spend caps, activity, pause, pairing, source/review status, an explicit managed-install boundary when hosted ZIP delivery is closed, and an authoritative per-plan/per-target readiness explanation that distinguishes packaged, qualified, capable, paused, and runtime-proof states | Production onboarding still depends on Phase 2 IdP and a deployed managed browser release; full account deletion awaits IdP revocation and deletion-specific orchestration on a deployed worker fleet; some style-level retailers report `listing_only`; region/store scope is not verified from every live offer; verified-equivalent substitution is policy-only and non-executable |
| Community inventory | Consent, nonce-bound exact selected-offer assertions, location-aware keys, fail-closed variant quarantine, short TTLs, one latest eligible vote per contributor, current-vote conflict recovery, median/range price projection, deletion, and user-scoped export exist inside one tenant | No production shared evidence plane, cross-account pseudonyms, contributor reputation/Sybil defense, account/device-risk eligibility, complete retention/deletion propagation, abuse operations, or meaningful live quorum |
| Autonomous correction | Sanitized failure groups feed deduplicated redacted operator alerts and durable reconciliation that can run embedded or in the standalone SQLite worker; field-specific stable-attribute landmarks cover all five fixed read-only observer fields; a signing-free seventh worker family compiles mature compatible fields per layout into idempotent unsigned quarantine candidates only; a fixed packaged structured-page oracle supplies value-free per-field trial-v2 receipts and may place exact oracle-agreed missing-field values into a `not_applied` provenance quarantine under trial v3; contributors can explicitly confirm/reject/revoke those values in a separate owner-scoped review ledger; evidence/reviews expire after 90 inactive days through bounded signing-free cleanup with aggregate receipts; generated promotion uses latest-per-contributor/SKU/layout/stage oracle evidence, distinct tenant users/devices, a deterministic 25% canary, a 24-hour burn-in, and a multi-contributor regression auto-kill; known packaged conflicts immediately kill distribution; externally eligible trial snapshots now feed a seven-day, account/SKU/layout/stage-deduplicated regional conflict SLO that can disable read-only distribution only; observer recipes use offline-root manifests, rotation/revocation, rollback pins, local transparency receipts, a fail-closed signed external-witness integration, and durable receipt refresh without standalone signing keys | The production identity/risk provider is not deployed, so local users cannot claim reputable public eligibility; generated candidates are not auto-promoted and reviewed recovery evidence cannot fill stored observations; public reputation/Sybil operations, governed field-application projections, longer external monitoring, and the independently operated witness/public consistency monitor remain incomplete |
| Automatic verification | Four packaged add runners revalidate exact browser state and two are qualified; community evidence cannot publish unresolved selections | Community truth is advisory, recipe truth is not independent, style-level child identity and offer-verified locality remain incomplete, and no checkout/final-total verifier is packaged |
| Automatic purchasing | Reviewed plans can directly request guarded quantity-one attempts without a strategy and now expose an authoritative armed/blocked explanation; live legacy multi-unit strategy adds and all unqualified-lane matches fail over to notification before reservation; Target and Walmart can perform first-party shipping add-to-cart behind current intent/snapshot/reservation checks, while Amazon and Best Buy remain separately gated | No checkout-review runner, submit-order runner, destination/payment fingerprinting, committed-order recovery, or live spend-commit path |
| Contingent-order drawings | Exact Walmart Draw cards, deadlines, limits, scan failures, and private plan matches are observed without mutation | No independently authorized drawing-entry capability, frozen terms/fee snapshot, payment/address fingerprint proof, entry/selection reconciliation, or legal/security approval |

### Target trust-domain layout

```text
signal providers ----------> authenticated ingress / durable inbox
user web app --------------> user API
admin web app -------------> admin API
Chrome companions ---------> package-allowlisted HTTPS device API
                                  |
                                  v
                    modular application services
        +----------------+----------------+----------------+
        | private intent | shared catalog | community trust|
        | and preferences| and identity   | and evidence   |
        +----------------+----------------+----------------+
        | execution ledger / spend reservations / audit    |
        | operator config / releases / diagnostics / alerts|
        +---------------------------------------------------+
                                  |
                     PostgreSQL + durable workers
                                  |
             short-lived exact job capability to Chrome
```

`tenant` means one private account, household, or organization. Community
quorum must not be manufactured by putting unrelated consumers into one tenant.
Shared catalog and community evidence need a separately governed plane and
database role, with pseudonymous contributor identity/reputation held behind a
restricted trust service. Private follows, intents, budgets, retailer-account
state, and purchase history never enter that shared plane.

Keep this as a modular monolith until load or ownership demands otherwise. The
important split is contracts, authorization, data ownership, and worker
boundaries—not premature microservices. Use separate `/api/v1/user`,
`/api/v1/admin`, `/api/v1/devices/self`, and `/api/v1/internal` surfaces with
server-side permission checks; a signed `actorKind` header is identity context,
not RBAC.

Production companions should call one package-allowlisted HTTPS device origin
directly. Loopback remains a local/offline development mode, not a cloud sync
peer, and local/cloud dual writes are prohibited. Production extension updates
belong to the Chrome Web Store release channel; the local ZIP feed remains a
development channel.

### Revised delivery order and exit gates

#### Phase 0 — correct trust boundaries and roadmap claims

0.19.0 completed persisted RBAC, explicit API surfaces, correlated errors,
split bundles, and initial catalog candidate review. 0.21.0 adds authorized,
reversible, topology-bound local merge/split/compensation. 0.23.0 adds the first
privacy-classified adapter-repair alert path with allowlisted inputs, redacted
projections, immutable receipts, and separate management permission. 0.24.0
completes the local package-rooted observer-recipe trust slice with monotonic
rotation/revocation, extension rollback protection, and transparency receipts.
0.27.0 adds the deployment-pinned external-witness protocol, immutable signed
receipts/checks, health alarms, and a hosted fail-closed delivery gate.
0.40.0 adds its durable receipt-refresh schedule and standalone public-key-only
execution path.
0.30.0 adds tenant-isolated structured request metrics, bounded error records,
closed route dimensions, and automatic retention with immutable receipts.
0.31.0 adds signed fresh-auth assurance, exact expiring protected-change
requests, independent approval, atomic consumption, and a redacted Approvals
workspace while preserving local-trusted compatibility.
The phase exit gate remains **open**: the current shared catalog has no
cross-tenant global curator; an independently operated witness deployment and
public consistency monitor, and production IdP/MFA integration are not
implemented.

- Persist operator memberships and granular permissions; deny every route by
  default and explicitly authorize user, device, support, catalog-curator,
  affiliate-manager, retailer-maintainer, security, and service capabilities
- Split user/admin/device/internal API contracts before splitting processes;
  retain `/api/v1` only as a compatibility facade during migration
- Move direct writes to the shared catalog behind candidate, review,
  accept/reject, merge/split, provenance, and rollback workflows. A user import
  may update private source evidence but not silently rewrite an accepted global
  SKU's URL, status, variant, or execution flag
- Add structured server error classes, correct 4xx/5xx behavior, correlation
  IDs, privacy-classified logs, metrics, and sanitized aggregate diagnostics
- Deploy the shipped signed-checkpoint integration and receipt-refresh task
  against an independently operated witness log, and monitor public consistency.
  The local append-only chain, companion rollback pin, external receipt
  verifier, scheduler, health alarms, and hosted delivery gate are shipped
- Pause implementation or activation of any new mutation retailer beyond the
  four already packaged until this exit gate passes. Existing Amazon/Best Buy
  qualification work and additional read-only observer coverage may continue

Exit gate: hosted user/device scopes receive a tested `403` for every admin or
cross-user operation; identifier-forcing and enumeration tests prove tenant
isolation; catalog mutation requires an authorized, reversible review event;
all material operations have a correlation ID and audit receipt; production
recipe delivery requires rooted rotation/revocation plus an external witness;
local mode remains backward-compatible.

#### Phase 1 — exact offer identity and a product-centric user model

0.20.0 ships the local Phase 1 safety spine: immutable selected-offer keys and
snapshots, revisioned mission-owned policy, all-in/action/substitution/expiry/
cooldown controls, transactional quantity/spend reservations, and an
append-only ledger. Concurrent quantity and daily-budget tests pass, stale
policy leases fail closed, and cart-only confirmation cannot record a purchase.
0.25.0 adds the community-side selected-offer scope and refuses to publish
listing-only or ambiguous variants. 0.28.0 completes the local non-technical
creation path: one reviewed request atomically creates the exact plan and
configured revision, legacy user creation defaults to notifications, later
catalog targets stay disabled, and the UI test proves no pre-review write.
0.29.0 makes that reviewed revision the direct decision source for fresh exact
signals, removes any hidden strategy dependency, preserves strategies as the
advanced/default mode for source-created missions, and proves a direct plan can
reach the existing qualified lease boundary without weakening it. 0.32.0 adds
the first-run readiness projection and a safe path from an unknown product URL
to exact normalized identity and independent catalog review without treating
the link as stock, price, intent, or purchase evidence. The local nontechnical
setup and intent workflow now satisfy the Phase 1 usability gate. Version 0.46
adds server-authoritative cost/readiness preview before creation and binds the
first-party UI write to that fresh review. The broader phase exit remains **open**
until style-level observers supply stable child offers, applicable region/store
scope is live-offer verified, verified-equivalent selection has independently
governed identity evidence, and a future checkout/order path can prove and
commit a final total without weakening the closed mutation lanes.

- Extend listing identity to an exact selected-offer key: retailer SKU/child
  offer, normalized size/color/edition/language/pack/condition, seller,
  fulfillment, and applicable region/store scope. Never infer equivalence from
  title, image, URL similarity, or price
- Add a revisioned mission-owned `intent_policy` for per-product retailer and
  seller choices, unit and all-in caps, quantity, fulfillment, action ceiling,
  expiry, cooldown, and substitution policy. Keep ordered strategies as an
  optional advanced/default layer instead of generating hidden strategies
- Add spend reservations and an append-only purchase/spend ledger so concurrent
  jobs cannot exceed desired quantity, per-intent caps, or daily/monthly user
  budgets
- Build a user API/read model over missions, targets, current verified offers,
  and receipts; do not create a competing product-intent source of truth
- Replace the current end-user navigation with a minimal `/app`: **Interested
  products**, **Purchases/activity**, and **Preferences/connections**. A product
  card should answer what item, which store/seller, current and maximum price,
  quantity, and what Yoink may do

Exit gate: a non-technical user can create and change an exact purchase intent
without seeing recipes, adapter versions, source parsers, incident dedupe, or
affiliate internals; selected variants cannot collapse; concurrent-job tests
prove quantity and budget reservations.

#### Phase 2 — production backend and device transport

0.34.0 establishes the durable-work state machine, 0.35.0 extracts its
runtime behind asynchronous store/handler contracts with bounded tenant/user
pagination and a separately supervised SQLite process. This proves process
lifecycle, schema ownership, health, outage, and recovery locally without
placing work in HTTP request handling. It does not satisfy the Phase 2 exit gate
because the persistence adapter remains synchronous SQLite and the standalone
process is not a multi-tenant PostgreSQL fleet. Version 0.36 moves authenticated
TrackaLacker signal evaluation behind that boundary with atomic inbox/wake
acceptance, bounded processing, and operable dead letters; other asynchronous
families and the production persistence/deployment gate remain open. Version
0.38 adds recoverable two-phase Chrome credential rotation with generation
binding, hash-only server state, idempotent commit, and extension-side
crash/outage recovery. It improves the device-authentication seam but does not
replace a production IdP, fixed hosted origin, TLS, or device-risk operations.
Version 0.39 adds the fixed hosted extension-origin policy, pairing and all-slot
rotation scope resolution, invalid-bearer fallback denial, separate deterministic
local/production package profiles, and hosted local-ZIP closure. The production
profile is buildable and tested but is not published or deployed. Version 0.40
adds the sixth durable task for external observer-witness receipt refresh and
keeps the standalone worker verification-only with respect to observer trust
keys. Version 0.41 binds new standalone work to the exact API-owned package,
task-registry, and public-witness fingerprint with append-only expectation
history and fail-closed health. Version 0.47 adds the seventh closed task for
signing-free observer-repair candidate quarantine; signing, promotion, trials,
and distribution deliberately stay outside that worker. Version 0.48 expands
only its bounded input compiler to all five fixed read-only fields; it adds no
worker authority. Version 0.55 removes the blanket internal-service permission
bundle, assigns at most one deployment-owned capability after authentication,
denies unconfigured workloads, and repeats enforcement inside the sensitive
repositories. It materially narrows compromise blast radius but does not prove
the workload cryptographically: the shared HMAC proxy remains a deployment
trust root until mTLS/OIDC workload identity and managed keys are deployed.
Version 0.56 adds the PostgreSQL qualification plane: strict driver/TLS
configuration, deterministic schema manifest, bounded one-shot import, exact
reconciliation, packaged invariant translation, and direct-tenant RLS tests.
Version 0.57 classifies every remaining table, enforces exact inherited-owner
RLS, fails mixed shared rows closed, and qualifies a complete PostgreSQL
worker-store port with single-connection `SKIP LOCKED` semantics. It does not
port the task handlers or prove independent fleet contention, and deliberately
cannot become runtime authority. Version 0.58 derives five isolated read-only
group-role templates from those classifications and proves their exact grants,
cross-role denial, and drift detection. It creates no login or membership and
does not solve authenticated tenant-session binding, write-role parity, mixed
shared-offer access, or the then-unresolved incident table. Version 0.59 runs the
production driver against a hermetic native PostgreSQL 16 server and proves the
worker lease algorithm across three distinct backend sessions, including
locked-row skipping and an exact-one-winner race. It is test qualification, not
a deployed production fleet or handler/repository port. Version 0.60 adds an
empty server-owned principal registry, a zero-argument session binder, a
read-only tenant adapter, and restrictive policies on the then-current 82 tenant tables.
Native simultaneous principals prove that mutable PostgreSQL custom settings
cannot widen the server-bound tenant. It deliberately creates no production
login or mapping and does not qualify writes. None of these releases turns the
SQLite process into a production fleet or proves signed artifact/workload
identity.

Version 0.73 subsequently adds the 83rd tenant table by assigning exact
tenant/user ownership to signal incidents, leaving no unresolved read-role
class.

Version 0.61 adds the first deliberately narrow write-role contract: a
server-bound queue writer with 11 exact operations on four queue tables, no
delete access, an empty principal registry, and a `READ COMMITTED` transaction
adapter. Native simultaneous writers prove isolation and prohibited operations,
while receipt verification catches policy tamper. It does not port or activate
the worker handlers, API repositories, production principals, or runtime
authority.

Version 0.62 routes the actual tenant queue repository through that writer.
Native execution identified and then narrowly granted the single immutable JSON
constraint helper required by task inserts; contract v2 verifies the exact
three-function surface and rejects helper-definition drift. Repository-level
scheduling, enqueue, events, retry, heartbeat, leasing, completion, and
contention now pass through separate server-bound pools. Principal enumeration,
deployment control, atomic attestation/write composition, task handlers, and
request repositories remain unported and inactive.

Version 0.63 makes deployment attestation and each new-work schedule, enqueue,
or lease mutation one server-bound transaction. Contract v3 adds only `SELECT` on the singleton
API-owned expectation, for 12 exact operations across five tables, and retains
the original four-table write surface. Native proof denies expectation mutation
and shows an exact mismatch produces no schedule write. Principal enumeration,
fleet status/stopping, task handlers, and request repositories remained
unported and inactive at that boundary.

Version 0.64 replaces the remaining all-powerful qualification-connection use
inside the PostgreSQL worker store with a distinct three-table/19-column-grant
fleet-control role and transaction adapter. Native tests route principal
pagination, deployment status, and heartbeat stopping through it and prove
queue access, inserts, deletes, unrelated updates, functions, login,
membership, ownership, and runtime authority stay closed. The role remains an
inactive template: production identity-to-login provisioning, task handlers,
request repositories, and a deployed fleet are still open.

Version 0.65 ports the first complete handler family. The production
maintenance handler can route `notification_recovery` through one strict,
security-definer PostgreSQL routine whose dedicated role has zero direct table
grants. Native proof covers exact transition parity, tenant isolation,
principal binding, idempotent replay, simultaneous execution, direct-access
denial, and catalog tamper. The adapter and role remain inactive, and six of
seven handler families plus every request repository remain SQLite-only.

Version 0.66 ports `execution_recovery` as the second complete handler family.
Its zero-direct-grant routine uses the server principal and statement clock to
recover every stale action state, release spend, and append action/ledger/audit/
outbox receipts atomically. Both SQLite and PostgreSQL now refuse to close or
lock an incident shared through another tenant's action or occurrence. Native
proof covers the full state matrix, cross-tenant shared-incident isolation,
principal denial, direct-access denial, idempotency, concurrent one-winner
execution, and catalog tamper. Five of seven handler families remain
SQLite-only.

Version 0.67 ports `operational_telemetry_retention` as the third complete
handler family. Its zero-direct-grant routine authenticates the database
principal, applies the existing 30-day telemetry/task and 90-day quarantined-
evidence windows from the server clock, preserves recently reviewed evidence,
caps evidence deletion at 500 rows, and appends exact retention/audit/outbox
receipts. Native proof covers cutoff boundaries, cascades, cross-tenant
isolation, principal denial, direct-delete denial, idempotency, concurrent
one-winner execution, and catalog tamper. Four of seven handler families remain
SQLite-only.

Version 0.68 ports `observer_recipe_candidate_evaluation` as the fourth
complete handler family. Its zero-direct-grant routine derives a bounded
aggregate evidence plan, revalidates it before apply, and can only create or
reuse unsigned, non-executable quarantine candidates. Native proof covers
field/selector parity, cross-tenant isolation, stale and tampered input denial,
idempotent replay, concurrent deduplication, and catalog tamper. Three of seven
handler families remain SQLite-only.

Version 0.69 ports the connector-dispatch repository half of
`adapter_alert_reconciliation`. Its zero-direct-grant function binds an exact
database tenant/user, leases only deployment-bound endpoint references with
`SKIP LOCKED`, uses the server clock, and stores application-generated
capabilities only as hashes. Raw URLs and secrets never cross the boundary.
Native proof covers same-tenant user isolation, one-winner claims, delivery,
retry, dead-letter exhaustion, capability denial, engine compatibility, and
catalog tamper. Diagnostic reconciliation remains unported, so the handler
counter deliberately remains four of seven.

Version 0.70 completes `adapter_alert_reconciliation` with a separate
zero-direct-grant, principal-bound diagnostic-to-incident function. It derives
bounded sanitized repair groups, revalidates a fresh two-phase plan, and
preserves open/update/repeat/escalate/auto-resolve, audit, outbox, dashboard,
and connector-queue parity in one transaction. Native proof covers exact
lifecycle results, recovery and replay behavior, same-tenant user and
cross-tenant isolation, concurrency, production-handler routing, direct SQL
denial, and catalog tamper. Five of seven handlers now have repository parity.

Version 0.71 ports `observer_recipe_witness_refresh` through a sixth inactive,
zero-direct-grant function-only role. The application performs external HTTPS
publication and pinned Ed25519 verification with no database transaction open;
PostgreSQL derives and revalidates the tenant-scoped checkpoint, receipt chain,
canonical bytes, hashes, freshness, and authenticated actor before appending
public-only receipt/check/audit/outbox evidence. Native proof covers acceptance,
fresh no-op, renewal, outage evidence, invalid-signature zero-write rejection,
concurrent single-winner apply, isolation, and catalog tamper. Six of seven
handlers now have PostgreSQL repository parity.

Version 0.72 decomposes the final `hosted_delivery_recovery` handler and ports
its complete expired-lease repository half through a seventh independent,
zero-direct-grant function-only role. PostgreSQL binds the exact principal and
statement clock, applies the existing inbox/outbox retry versus attempt-20
dead-letter matrix, and appends byte-exact SHA-256 delivery receipts. Native
proof covers current/stale boundaries, four aggregate counts, isolation,
idempotency, simultaneous one-winner execution, direct denial, and catalog
tamper. The handler counter remains six of seven until durable signal
evaluation is ported and composed with this boundary.

- Complete the PostgreSQL hosted signal-evaluation repository, compose it with
  the qualified lease-recovery sub-boundary to finish the seventh handler, and
  port every request-repository family over the qualified schema; activate the already
  qualified least-privilege control and queue roles through production
  identity-to-login provisioning, add the remaining restricted writer roles,
  resolve the remaining mixed/shared offer access semantics, and pass
  transactional/isolation parity, deployed multi-process lease/load/outage
  drills, idempotent handler replay, and no-dual-write tests
- Add production IdP sessions, lifecycle/provisioning, TLS ingress, CSRF/session
  protection, secrets management, encryption, production retention/deletion,
  backups/PITR, restore drills, load tests, SLOs, and on-call alerting
- Keep authenticated TrackaLacker device-signal evaluation outside request
  latency using the shipped `signal_event_v1` inbox contract. Move remaining
  external inbox/outbox dispatch, projection cleanup, recipe evaluation,
  notification dispatch, and generic hosted signal sources onto explicit
  idempotent worker contracts
- Deploy the shipped production extension profile through a signed managed
  browser/Chrome Web Store channel with provenance, staged rollout, rollback,
  and the exact server-side ID pin. Keep authenticated pull, Web Push only as a
  wake hint, and alarms as fallback. Chrome retains an independent local pause
  and action ceiling even when the hosted control plane is healthy

Exit gate: a staged PostgreSQL deployment passes restore, isolation, replay,
contention, device revocation, outage, and cutover drills; no production request
depends on the local SQLite process or an unpacked-extension ZIP update.

#### Phase 3 — dedicated admin control plane

0.19.0 establishes the separate permission-gated bundle and implements the
existing local operations views, catalog review queue, and role membership UI.
0.23.0 adds the local adapter-repair Alerts workspace with rules, severity,
thresholds, dedupe, escalation state, dashboard/audit-outbox routing, delivery
history, acknowledgement, and resolution. 0.31.0 adds the signed step-up
enforcement seam, independent exact-change approval, immutable receipts, and
the Approvals workspace. 0.33.0 adds self-service user inventory/export with a
closed credential boundary. 0.34.0 adds the local Background work operations
view, permission-gated schedules, dead-letter retry, and runtime heartbeats;
0.35.0 makes embedded versus standalone runtime state explicit without
claiming production deployment. Version 0.36 adds payload-free signal-inbox
counts and a permission-gated, audited retry for one corrected signal dead
letter without exposing its retained signal payload. Version 0.42 adds
deployment-reference webhook configuration, binding health, HMAC delivery, and
durable retry/dead-letter receipts to the existing alert worker. Version 0.43
adds exact permission-gated dead-letter replay, a three-cycle bound, stranded
lease recovery, and a sanitized rolling delivery SLO.
Production IdP/MFA integration, account deletion, support break-glass, managed
secrets, email/pager providers, production connector fleets, and broader alert
families remain open.

Build `/admin` as a separate permission-gated application, with aggregate and
redacted views by default:

- signal provider definitions, user connections, parser versions, trust,
  credentials-by-secret-reference, rate limits, sync health, and replay/dead
  letters
- retailer/domain identity configuration, adapter/release compatibility,
  qualification evidence, lane status, location semantics, and emergency kill
  switches. Remotely editable metadata may narrow behavior but cannot widen a
  packaged mutation runner
- operator-owned affiliate program configuration and validation, separated from
  user disclosure/preferences and immutable per-job attribution receipts
- Extend the shipped adapter-repair alert family beyond its durable signed
  webhook and governed replay with email/on-call providers, managed secrets,
  independent connector health/SLO monitoring, and privacy-classified alert
  families for the remaining material operations; keep all of them distinct
  from users' product notifications
- catalog candidates, exact-identifier conflicts, merge/split history, item and
  offer state, community quarantine, contributor abuse, and repair/recipe queues
- user/device lifecycle, consent/export/deletion support, and audited
  support-consent/break-glass access; routine admins never see raw browsing,
  account, address, payment, or private intent data

The packaged API now enforces fresh authentication for recipe, catalog, role,
affiliate, and related protected changes; safety-expanding role grants, trust
installation, recipe promotion/rollback, mutation-lane activation, and action
resume require independent approval. Production deployments must connect this
contract to an actual IdP/MFA service and add governed break-glass recovery.

Exit gate: every requested admin area has an explicit permission, immutable
audit event, alert path, and redacted support view; ordinary users cannot load
the admin bundle or call its APIs.

#### Phase 4 — production community evidence and catalog governance

Version 0.44 implements the latest-eligible-per-contributor and median/range
projection semantics against the existing tenant-local ledger. It deliberately
does not represent that ledger as the shared plane or treat local accounts as
Sybil-resistant identities. The production work below remains the gate.

- Publish accepted assertions through the separate shared evidence plane using
  pseudonymous contributor IDs. One contributor receives at most one current
  vote regardless of device count; a distinct healthy paired device remains an
  additional eligibility signal. Use the latest eligible assertion per
  contributor, robust median/range price projections, short TTLs, location/
  variation isolation, account/device age, historical accuracy, source
  diversity, rate limits, abuse review, and quarantine
- Make identity claims contributor-backed and independently reviewed; only the
  catalog governance workflow may accept a mapping. Validated equivalence may
  expose sibling-store availability but never transfer a private mission
- Keep one-click sharing as the initial mode. A later continuous PDP-observation
  mode may run only after granular per-domain affirmative consent, a persistent
  visible state/pause control, minimum optional permissions, local/server
  throttling, retention/deletion controls, external privacy/security review,
  and a published user-facing community feature. It observes pages the user
  ordinarily visits; it never crawls, records interactions, or inspects forms

Exit gate: independent-account canaries demonstrate useful freshness and
measured false-positive/poisoning rates without exposing tenant identity;
deletion and consent revocation propagate; community evidence remains advisory
and cannot directly authorize mutation.

#### Phase 5 — bounded autonomous observer correction

0.37.0 ships the first deliberately narrow miner: on an unblocked unique
Add-control selector miss it can retain one of five allowlisted stable
attributes and derive a non-executable, tenant-scoped maintainer suggestion.
Version 0.47 moves that exact local threshold into a durable signing-free
compiler that may create only an unsigned Add-control quarantine candidate.
Version 0.48 extends the same local semantic and stable-attribute boundary to
availability, unit price, seller, fulfillment, and add control, and compiles
every mature compatible field for a layout into one fixed-mode unsigned
candidate. Version 0.49 adds the first correctness gate: a fixed packaged
structured-page reader, value-free trial-v2 receipts, generated-repair oracle
promotion thresholds, and immediate kill/undistribution on conflict with known
packaged evidence. Version 0.50 adds the first tenant-account quorum: latest
per-contributor/SKU/layout/stage evidence, distinct-user/device promotion gates,
a deterministic 25% canary, a 24-hour burn-in, and multi-contributor regression
auto-kill. Version 0.51 adds an append-only quarantine for normalized values
that a signed recipe and the fixed packaged oracle agree on while the bundled
observer is missing that field. It deliberately cannot apply those values.
Version 0.52 adds contributor-owned, append-only, idempotent confirmation,
rejection, and revocation without connecting review to application or
promotion. Version 0.53 adds 90-day latest-activity expiry, bounded owner-scoped
durable cleanup, and value-free aggregate deletion receipts without connecting
retention to application or signing. Version 0.54 adds a service-only,
24-hour-bounded account/device/coarse-region eligibility state, immutable trial
snapshots, and a seven-day regional conflict SLO that can only disable read-only
distribution. Because no production provider is configured, the system still
does not prove public account reputation, fill stored observations, or
promote/sign anything automatically. The broader phase remains open:

- Extend the shipped packaged/structured reader with maintainer-redacted live
  fixtures, then reputable contributor-deduplicated multi-device/account
  agreement. Contributor review is implemented but is not independent truth
- Connect the shipped eligibility contract to an independently operated
  production IdP/device-risk provider, public reputation/Sybil controls, abuse
  response, consent, and deletion propagation. The repository's local service
  seam and hashes do not prove those properties by themselves
- Extend the shipped provenance-aware recovery quarantine, review/retention
  ledger, and measured regional conflict circuit breaker with longer external
  monitoring, then a separately governed reversible read-only application
  projection. Known packaged evidence remains authoritative; no recipe may
  fill a missing stored field until every gate is visible and tested
- Extend the shipped tenant contributor/device dedupe, SKU/layout coverage,
  minimum canary time, deterministic cohort, and regression auto-kill with
  production IdP/device-risk eligibility, regions, reputation/Sybil defense,
  longer measured SLO history, and external consistency monitoring
- Keep mutation runners isolated from remote recipes by type and execution
  boundary, not convention; continue source-scanning and packaged adversarial
  tests for every release
- LLMs may rank sanitized candidate recipes or explain clusters, but never
  receive checkout/form data and never produce directly executable logic

Exit gate: staged read-only repairs recover known fixture and live canary
failures without increasing false positives; forced bad recipes auto-kill; a
contract test proves no recipe can affect navigation, identity, clicks, jobs,
qualifications, or mutation. Initial promotion remains maintainer-reviewed and
requires Chrome Web Store/security approval; mutation changes always require a
packaged release and fresh qualification.

#### Phase 6 — autonomous verification and purchasing ladder

- Community/source evidence may wake evaluation, but every action still requires
  an active exact user intent and a fresh Chrome proof of identity, selected
  variant, seller, fulfillment, location, price, quantity, and cart state

##### Phase 6A — packaged add-only expansion

Standardize fixtures, diagnostics, recovery, live evidence, and no-click
qualification per retailer. Each retailer/action/version must independently
prove exact identity, allowed seller, fulfillment, price, empty-cart preflight,
at most one Add click, exact cart result, uncertain recovery, and explicit
activation. Marketplace and pickup remain separate lanes.

##### Phase 6B — prepare-checkout review

Add packaged review-only runners using user-approved destination and payment
fingerprints held locally. Verify item, selected variant, seller, quantity,
fulfillment, tax, shipping, discounts, and exact all-in total without reading or
transmitting payment-form values. A production-runner rehearsal must prove that
no order submission occurs.

##### Phase 6C — submit order

Add explicit per-user opt-in, local high-risk authorization, spend commitment,
cooldowns, confirmation reconciliation, and ambiguity locks. Require step-up
approval for the first submit intent, material policy changes, and operator-
defined high-value thresholds. Exclude unsupported, restricted, subscription,
marketplace, queue, and unverifiable payment flows by default.

Exit gate: retailer-specific recovery/chaos suites prove at most one automatic
submit click per capability—not exactly-once merchant ordering, which cannot be
guaranteed after a lost response. An ambiguous post-click result never retries
automatically and retains its spend reservation until order-history or manual
reconciliation. Merchant confirmation evidence/order ID, budget and quantity
limits, revocation, recovery, and legal/privacy/security/Chrome Web Store review
must pass. Fully autonomous submit may remain unsupported for retailers whose
flows cannot meet these proofs.

##### Phase 6D — contingent-order drawings

Treat entering a drawing as a dedicated high-risk contingent-order capability,
not add-to-cart and not an ordinary availability signal. The shipped Walmart
Draw observer remains read-only. Any future entry runner must require explicit
per-drawing user authorization after presenting the exact item, quantity,
price, estimated shipping fee, terms/rules version, closing time, saved-address
fingerprint, payment-method fingerprint, and worst-case all-in cap. It must
enforce Walmart's one-entry rule, freeze the user's choices, handle duplicate
and high-traffic responses without retry ambiguity, and reconcile entry,
selection, automatic order, charge, and non-returnable outcomes. A generic
submit-order or Walmart-add capability must never authorize drawing entry.

Exit gate: legal/privacy/Chrome Web Store review, step-up consent, a no-entry
production rehearsal, durable pre-entry receipt, at-most-one submit proof,
selection/order reconciliation, fee and spend commitment, revocation semantics
before the entry boundary, and explicit acknowledgement that a submitted entry
cannot be canceled or changed. Until all gates exist, entry stays manual.

## Retailer qualification workstream

These are deliberately closed until each adapter has current live evidence,
no-click rehearsal receipts, recovery tests, and explicit activation:

1. Bring a current Amazon-v5-capable companion online and explicitly activate
   the already complete live v5 evidence dossier. Activation still requires the
   user's review and cannot be forged by a migration or server process.
2. Complete Best Buy's live v3 add-lane/v5 observer evidence dossier and
   explicitly activate the
   implemented first-party shipping lane.
3. Pickup as a separately qualified fulfillment lane.
4. Prepare-checkout review per retailer.
5. Submit-order only after user-approved destination/payment fingerprints,
   total verification, confirmation evidence, and uncertain-submit recovery.
6. Keep Walmart Draw entry manual until the separate Phase 6D contingent-order
   consent, fee, terms, idempotency, and reconciliation gates are complete.

No generic mutation flag will authorize these lanes.

## Community evidence and observer maintenance

This direction is feasible and fits Yoink only as a staged, opt-in,
**read-only evidence network**. The current retailer-listing graph, paired
devices, sanitized shadow observations, adapter diagnostics, server-derived
layout fingerprints, and repair queue are the local foundation. The selected-
variation key described below is implemented locally for exact public item IDs
and allowlisted selected dimensions; style-level or ambiguous selections fail
closed. It is not yet a production shared-evidence plane or proof of global
identity. A meaningful community quorum must wait for that hosted plane;
multiple events from one local user, device, or private tenant are not
independent evidence.

### Accepted scope

1. Add an explicit **Share read-only stock evidence** control with per-domain
   optional permission, a visible contribution state, deletion controls, and a
   clear privacy disclosure. Browsing data may be collected only for that
   user-facing feature. Automatic contribution remains off by default. A later
   continuous contribution mode must be a separate affirmative per-domain
   choice with a persistent visible indicator, immediate pause/revocation, and
   no background crawling beyond product pages the user ordinarily visits.
2. Submit a signed, nonce-bound observation envelope containing only normalized
   fields already accepted by the evidence ledger: exact retailer/listing
   identity, selected variant fingerprint, availability, bounded price, seller
   class/name when visible, fulfillment, coarse location scope when necessary,
   observer/recipe version, timestamp, and sanitized layout evidence. Never
   accept DOM, page text, screenshots, form values, account data, cookies,
   tokens, addresses, or payment data.
3. Rate-limit locally by the complete observation key and again on the server.
   The key is not merely a base URL or title; it is at least
   `retailer + retailer SKU + selected variant + seller + fulfillment +
   location scope`. Pickup observations are store-local, and shipping evidence
   that varies by postal region cannot be promoted to a global state.
4. Store observations as append-only assertions with short availability TTLs.
   A contribution never overwrites MSRP, catalog identity, or another user's
   private mission. Material conflicts become `unknown`/quarantined rather
   than choosing the newest or majority value blindly.
5. Build per-field confidence projections for identity, availability, price,
   seller, and fulfillment. Quorum must use independent established accounts
   and paired devices, device/version health, historical accuracy, temporal
   proximity, variant agreement, and source diversity. "Three user IDs" alone
   is not Sybil resistance and is insufficient for publication or mutation.

### Exact product and variant governance

- Keep retailer listing identity (`retailer_id + retailer_sku`) separate from
  cross-retailer product equivalence (`variant_id`). A title, image, price, or
  similar URL is never enough to merge products.
- Accept equivalence claims only from exact identifiers such as GTIN/UPC/EAN,
  ISBN, or a validated brand plus MPN, supplemented by normalized variant
  attributes such as size, color, edition, language, pack count, and condition.
  Parent IDs and selected child IDs (for example, a parent product with a
  size-specific child offer) must remain distinct.
- Record every proposed mapping as a provenance-bearing identity claim. A
  conflict with an existing exact mapping is quarantined for review; it does
  not remap the listing or transfer an active mission automatically.
- Inventory consensus attaches to the exact listing/variant observation key.
  Only after identity claims are independently validated may the UI present
  sibling-store availability for the same item.

### Declarative observer registry

The extension may eventually download signed, expiring **observer-only data**:
bounded CSS selector candidates plus fixed extraction modes implemented in the
packaged extension. Candidate recipes move through `quarantined -> shadow ->
canary -> trusted-read-only`, retain rollback/kill-switch metadata, require a
minimum compatible extension version, and fall back to the bundled observer.

The packaged interpreter must enforce a small allowlisted schema and reject
XPath, scripts, expressions, loops, navigation, events, arbitrary regular
expressions, unbounded selectors, credential fields, and every mutation
operation. Exact URL/SKU identity remains a packaged or separately reviewed
contract; a downloaded selector cannot decide that two products are the same.
Community proposals are untrusted until structurally validated, replayed
against redacted fixtures, corroborated across independent layouts/items, and
canaried without clicks. Promotion should initially require maintainer review;
automatic read-only promotion is a later experiment only after abuse testing
and Chrome Web Store review.

An LLM may cluster sanitized failure fingerprints or suggest selector changes
to maintainers. It must not receive raw checkout DOM or user-entered values,
and its output is never executed directly or allowed to authorize an action.

### Explicitly excluded

- No background recorder of clicks, keystrokes, text entry, addresses,
  credentials, checkout forms, or payment fields.
- No injection into Stripe, PayPal, wallet, bank, or other payment-origin
  frames for learning or contribution.
- No remotely supplied checkout scripts, click sequences, arbitrary command
  interpreter, or remotely generated code. Mutation remains implemented in a
  reviewed, packaged, exact-version retailer adapter and must pass Yoink's
  independent qualification and activation gates.
- No attempt to evade retailer protections, virtual queues, rate limits,
  anti-bot systems, or site access controls. Community evidence comes only
  from ordinary user-visible pages with informed permission.

These boundaries are also distribution constraints. Manifest V3 requires
extension logic to remain reviewable and specifically identifies complex
remote-command interpreters as a policy violation; remote configuration is
acceptable only when the extension's functionality remains in its packaged
code. Chrome also treats form data, page contents, URLs, and browsing activity
as user data, and host access should remain optional and user-granted. Chrome's
July 2026 policy update requires every collection practice to be prominently
disclosed and every collected datum to be strictly necessary for the disclosed
single purpose; enforcement began August 1, 2026. A published privacy policy,
in-product disclosure, affirmative consent, change notice, data inventory, and
verified deletion flow are release gates rather than documentation follow-ups.
See the
[Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements),
[Chrome Web Store user-data guidance](https://developer.chrome.com/docs/webstore/user_data),
[July 2026 policy update](https://developer.chrome.com/blog/cws-policy-updates-2026),
and [optional permission guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions).

### Delivery sequence

1. **Local scaffold implemented:** request-scoped user/device identity,
   per-retailer consent, physical contribution deletion, nonce validation, and
   basic device rate limiting. Production IdP, privacy policy/operations,
   reputation, and Sybil/abuse controls remain open.
2. **Local scaffold implemented:** identity-claim, inventory-assertion,
   contribution-receipt, and advisory-projection schemas without changing
   catalog truth. The manual identity path cannot currently satisfy its own
   healthy-device quorum.
3. **Local pilot implemented:** explicit one-click contribution with dedupe,
   TTL, current-vote conflict quarantine, retailer-SKU/selected-offer/seller/
   fulfillment/location isolation. Listing-only and unresolved selections fail
   closed.
4. **Local projection hardened:** tenant-scoped availability selects one latest
   eligible vote per contributor and uses median/range price evidence. Repeated
   rows and multiple devices cannot inflate one contributor. It is not a
   production cross-account community result.
5. **Shadow-validation and witness seam implemented:** manually proposed signed
   declarative selectors, trial counts, lifecycle labels, kill switch,
   rollback, bundled fallback, package-rooted signing, and a deployment-pinned
   external witness gate are present. A durable worker can generate an unsigned
   quarantined fixed-mode candidate spanning any mature subset of all five
   read-only fields from the narrow local threshold. Packaged conflict
   adjudication, tenant-contributor dedupe, deterministic cohort canaries,
   burn-in, regression auto-kill, append-only `not_applied` recovery evidence,
   contributor-owned confirm/reject/revoke review, bounded 90-day
   latest-activity retention with aggregate receipts, and an expiring
   service-attested account/device/coarse-region seam feeding a seven-day
   regional conflict SLO are implemented. The SLO can only disable read-only
   distribution. A deployed public reputation/risk provider, Sybil/abuse
   operations, external witness operation, governed field-fill application,
   automatic validation/promotion, and automatic correction remain open.
6. **Production blocked:** trusted-read-only delivery still requires a deployed
   independent witness/monitor, production IdP and key management, real staged
   canaries, privacy/security review, and Chrome Web Store approval. Mutation
   and checkout remain outside this registry
   permanently.

## Hosted multi-user evolution

Shipped local/hosted seams:

- Authenticated tenant/user resolver seam plus a deployable signed-proxy mode;
  all local repositories now consume request scope instead of hard-coded local
  ownership. Internal services are denied unless the deployment maps their
  authenticated actor ID to one singular delivery, eligibility, or principal
  capability; safe admin/health projections expose no raw actor ID
- Per-user private follows/sources, strategies, missions, settings/order-total
  guardrails, notifications, attribution policy, and mutation qualification.
  Periodic spending policy, transactional reservations, and an append-only
  ledger are implemented. Normalized catalog proposal/review and reversible
  single-tenant merge/split/compensation are implemented; independent
  production global curation remains open
- Inbox/outbox delivery, idempotent device/job queues, signed short-lived
  capabilities, durable wake/reconcile, and bounded source reliability scoring
- Streaming logical export, exact fresh-SQLite restore, table-level parity, and
  an operator cutover/recovery drill; plus a separate authenticated user data
  inventory/export whose credential-bearing columns are structurally excluded;
  signing keys remain separately backed up

Deployment-dependent work that cannot be truthfully completed in this local
repository alone:

- PostgreSQL source of truth and production migration/cutover. The logical
  archive, production-driver qualification importer, relational-invariant
  manifest, full scope classification, direct/inherited tenant RLS proof,
  asynchronous tenant queue repository, server-bound tenant reader, narrow
  queue-writer contract, atomic deployment-attested queue transaction,
  separately bounded principal/fleet control, six complete function-only
  handler families with fail-closed shared-incident mutation, bounded privacy
  retention, quarantined observer-candidate evaluation, alert reconciliation,
  and independent witness refresh, plus a distinct
  function-only connector-dispatch sub-boundary with exact user isolation,
  one-use hashed capabilities, and no endpoint secrets, plus exact
  reconcile receipts and the final handler's complete hosted-delivery
  lease-recovery half are implemented, but all PostgreSQL roles remain
  inactive, hosted signal evaluation remains on SQLite, complete-handler parity
  remains six of seven, and every request repository remains on SQLite. The
  PostgreSQL runtime must add production principals, remaining restricted
  roles, and pass multi-connection contention, backup/PITR/restore, outage, and
  authority-switch drills.
  Dual-write emulation is explicitly rejected.
  See [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md).
- Production identity provider, TLS reverse proxy, secrets manager, monitoring,
  abuse operations, and independent security/privacy review
- Windows/Electron packaged lifecycle only after install, upgrade, backup,
  rollback, recovery, code signing, and background-service behavior are proven
  on the target distribution infrastructure

Chrome remains the only component allowed to mutate a retailer session in the
hosted architecture.
