# PostgreSQL cutover qualification

Yoink 0.69 extends the offline, one-shot PostgreSQL qualification path. It proves
that one verified `yoink-portability-ndjson-v1` archive can be loaded into a
new private PostgreSQL schema and reconciled exactly. It does **not** switch the
API or worker away from SQLite, and it cannot authorize retailer actions.

The command is intentionally a qualification tool, not a dual-write bridge.
SQLite remains the only runtime source of truth until every Phase 2 exit gate
is independently satisfied.

## Implemented boundary

For the schema packaged with the current build, the importer:

- verifies the complete archive and exact current migration/schema contract
  before opening a PostgreSQL transaction;
- requires PostgreSQL 15 or later and an import role that is a superuser or has
  `BYPASSRLS` for whole-dataset reconciliation;
- creates one new private schema inside a serializable transaction and refuses
  to reuse an existing schema;
- streams rows in bounded batches rather than loading the archive into memory;
- preserves primary keys, `NOT NULL`, foreign keys, unique/query indexes, safe
  literal column defaults, translated `CHECK` constraints, and the packaged
  immutable/state-guard triggers;
- performs exact per-table counts and canonical content hashes before issuing
  a verified receipt;
- enables and forces default-deny row-level security on 68 tables with a direct
  `tenant_id` and 13 tables with exact inherited ownership;
- classifies all remaining tables explicitly, and fails the mixed-scope
  `offer_observations` table closed for source-less rows rather than exposing a
  guessed shared policy; and
- records `runtime_authority = false` and `cutover_ready = false` in a receipt
  whose constraints prevent either value from becoming true.

The importer re-verifies the file after streaming, so a file changed between
the initial check and the final row does not produce a committed schema. A
failed import rolls back the new schema and receipt atomically.

Cutover contract v3 adds release-level native multi-session worker-lease
qualification to the receipt and capability projection. The relational schema
manifest remains contract v2 with the same fingerprint because the tables,
policies, and translated invariants did not change. A schema created by cutover
contract v1 or v2 remains historical qualification evidence only. Never
upgrade, alter, or reuse it; export again and import into a new schema with the
current build.

## Worker-store qualification seam

Version 0.57 also packages a `PostgresBackgroundWorkerQualificationStore`. It
implements the complete asynchronous worker-store interface against a verified,
inert cutover schema and requires the qualification/control role before use.
Automated real-engine tests cover:

- bounded keyset pagination across tenant/user principals;
- packaged schedule creation, due-run deduplication, and exact tenant/user
  predicates;
- `FOR UPDATE SKIP LOCKED` selection, random one-use lease capabilities stored
  only as hashes, expired-lease recovery, completion, retry, and dead letter;
- deployment-expectation enforcement, heartbeats, coverage status, mismatch
  reporting, and stopping; and
- refusal to operate before the exact current receipt, manifest fingerprint,
  and forced-policy count are qualified.

This class is not imported by the API or standalone worker entry points. It
cannot flip receipt authority, cannot enable dual writes, and does not give the
PostgreSQL process any retailer-session capability. Three task-handler families
were still incomplete at the original worker-store milestone. The current
qualification chain has separate inactive seams for six complete handler
families plus connector dispatch and the final handler's expired-lease and
fixed signal-inbox lifecycle, catalog-create, and event-resolution commit sub-
boundaries plus known-product source-reference refresh and terminal-decision
apply. Only the remaining actionable hosted signal graph and final
composition prevent complete seventh-handler parity. The emulated real-semantics suite
continues to prove the complete store state machine; the separate native suite
proves each contention-critical path across independent server sessions.

## Native lease-contention qualification

Version 0.59 pins an isolated PostgreSQL 16 test server and runs it inside the
ordinary release suite. The production `NodePostgresCutoverDatabase` driver
imports the complete fixture archive, applies and verifies the read roles, and
then uses two independent one-connection worker pools plus a third lock-holder
connection. The test requires three distinct `pg_backend_pid()` values and the
exact qualification `application_name` before exercising work.

The lock holder takes the highest-priority task row. A second worker must skip
that row with `FOR UPDATE SKIP LOCKED`, lease and complete the next task, then
observe no additional work until the lock is released. The released task is
leased exactly once; an invalid capability is denied and its correct ephemeral
capability succeeds once. A simultaneous two-worker race for a third task must
have exactly one winner. Final rows must all be succeeded on attempt one with
capability hashes erased and exactly one `leased` plus one `succeeded` event per
task.

Run the focused proof with:

```bash
npm run test:postgres:native
```

The server is loopback-only, mutation-isolated, configured for test durability,
and deleted after success or failure. Worker qualification pools use
`READ COMMITTED`, the PostgreSQL isolation level intended for competing
`FOR UPDATE SKIP LOCKED` consumers; the offline cutover importer remains
strictly `SERIALIZABLE`. This proves the queue algorithm and production driver
against native PostgreSQL; it does not deploy independent worker processes,
execute a production worker fleet, measure production load/outage behavior, or
establish runtime authority. Version 0.65 separately executes the
notification-recovery handler through its own native qualification path;
version 0.66 does the same for action/spend execution recovery, version 0.67
does the same for bounded privacy retention, and version 0.68 proves bounded,
quarantine-only observer-candidate evaluation. Version 0.69 separately proves
secretless operator-alert connector dispatch, and version 0.70 adds the
separate server-derived diagnostic reconciliation boundary that completes the
fifth handler. All remain qualification-only.

## Restricted read-role qualification seam

Version 0.58 derives five fresh group roles from the exact contract-v2 schema
manifest. They are qualification artifacts, not production principals:

| Role class | Exact portable tables | Boundary |
| --- | ---: | --- |
| Tenant reader | 83 | 69 direct, 13 inherited, and one mixed table under forced RLS; source-less mixed offers remain hidden |
| Shared-catalog reader | 6 | Shared catalog only; no tenant or mixed-offer access |
| Authorization-catalog reader | 3 | Packaged authorization definitions only |
| Deployment-control reader | 2 | Worker deployment control only |
| Tenant-registry reader | 1 | Tenant registry only; no private user rows |

All five roles are `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEROLE`,
`NOCREATEDB`, `NOREPLICATION`, and `NOBYPASSRLS`. They receive schema `USAGE`
and exact table `SELECT` only. The qualifier revokes public access in the
private schema and verifies exact table grants, rejects extra column grants,
routine/sequence access, object ownership, memberships, schema `CREATE`, or an
unsafe role attribute. Migration 48 gives `signal_incidents` exact tenant/user
ownership, so all 95 portable tables are now classified and the unresolved role
set is empty. The two cutover-control receipt tables still receive no runtime
grant.

The test suite proves default denial, exact tenant selection, inherited and
mixed tenant filtering, cross-role denial, write denial, tamper detection, and
an immutable role receipt against real PostgreSQL semantics. It deliberately
does not create a login, grant membership, bind a tenant setting to an
authenticated workload, or connect these roles to the API or worker. Version
0.60's separate tenant-session contract binds the tenant role to a server-owned
principal mapping. Version 0.61's separate queue-writer contract qualifies only
four queue tables. Version 0.62 runs the tenant queue repository through its
contract-v2 role; production identity, principal/deployment control, task
handlers, request repositories, and runtime activation remain separate gates.
Version 0.63 adds only read access to the singleton deployment expectation and
makes that attestation atomic with new-work queue SQL; principal enumeration,
fleet status, and stopping remain separate control gates. Version 0.64
qualifies those gates through their own three-table/19-column-grant role while
leaving it inactive.

Plan the exact role namespace without a database connection:

```bash
npm run postgres:roles -- plan yoink_cutover_qualification yoink_q_059
```

After the exact current cutover receipt is verified, apply once with the
qualification/control role and an explicit acknowledgement:

```bash
YOINK_POSTGRES_ROLE_QUALIFICATION_ACK=read-only-qualification \
  npm run postgres:roles -- apply yoink_cutover_qualification yoink_q_059
```

Then re-inspect the live catalogs and immutable receipt:

```bash
npm run postgres:roles -- verify yoink_cutover_qualification yoink_q_059
```

Role names are cluster-global. The command rejects an existing role or receipt
instead of adopting it, and it never drops roles. Use a new namespace for each
qualification. Retention or cleanup of an old schema and its five roles is a
separate reviewed database-operator change.

## Server-bound tenant-session qualification seam

Version 0.60 derives one additional tenant-session reader from the exact schema
and read-role manifests. The role is `NOLOGIN`, `NOINHERIT`,
`NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, `NOREPLICATION`, and
`NOBYPASSRLS`. It receives schema `USAGE` and `SELECT` on the 83 tenant-RLS
tables only. It owns no object and receives no table write, sequence, routine,
membership, or runtime privilege.

The qualifier creates an empty, server-owned principal registry keyed by the
PostgreSQL login role. A zero-argument `SECURITY DEFINER` binder reads
`session_user`, requires exactly one active tenant/user mapping, installs those
two values transaction-locally, and returns them to the read adapter for an
exact comparison with its expected authenticated principal. Neither tenant nor
user identity is accepted as a binder argument.

PostgreSQL permits any session to create or change arbitrary custom settings;
there is no safe `REVOKE SET` mechanism for placeholder parameters such as
`yoink.tenant_id`. Yoink therefore does not claim direct setting prevention.
Instead, every tenant table receives a separately named `AS RESTRICTIVE` RLS
policy that resolves the server-owned mapping from `session_user` through a
locked-down security-definer scope function. The existing tenant-setting policy
and the restrictive server policy must both pass. A client setting the wrong
tenant can hide its own rows, but it cannot reveal another tenant's rows.

The `NodePostgresTenantReadDatabase` opens a `READ COMMITTED READ ONLY`
transaction, assumes only the qualified session role, invokes the binder, and
refuses a mismatched principal before handing a query session to the caller.
The immutable receipt seals a SHA-256 fingerprint over the exact function
definitions, owners, configuration, policy commands, role arrays, and both RLS
expressions; verification rejects later catalog drift rather than trusting
names and counts alone.
The native PostgreSQL 16 suite uses two disposable mapped logins and one
unmapped login concurrently to prove exact isolation, mismatch and unmapped
denial, setting-mutation containment, write denial, and transaction-local
cleanup. Those logins and mappings are test fixtures only and disappear with
the isolated cluster.

Plan the contract without connecting to PostgreSQL:

```bash
npm run postgres:sessions -- plan \
  yoink_cutover_qualification yoink_q_060 yoink_session_q_060
```

After the current cutover and read-role receipts are verified, apply the empty
qualification boundary once with the qualification/control role:

```bash
YOINK_POSTGRES_TENANT_SESSION_QUALIFICATION_ACK=server-bound-read-qualification \
  npm run postgres:sessions -- apply \
  yoink_cutover_qualification yoink_q_060 yoink_session_q_060
```

Then inspect the live catalogs and immutable receipt independently:

```bash
npm run postgres:sessions -- verify \
  yoink_cutover_qualification yoink_q_060 yoink_session_q_060
```

Apply is intentionally incapable of creating a login or mapping a principal.
The verifier requires zero memberships and zero active principals. There is no
production provisioning CLI in this release. A future deployment must bind
cryptographically authenticated application identities to narrowly scoped
database logins through a separately reviewed lifecycle before this adapter can
become a runtime repository boundary.

## Server-bound tenant queue-write qualification seam

Version 0.61 derived one additional queue-writer role from the exact cutover,
read-role, and tenant-session manifests. It is `NOLOGIN`, `NOINHERIT`,
`NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, `NOREPLICATION`, and
`NOBYPASSRLS`. Its complete table surface is:

| Table | Exact operations |
| --- | --- |
| `background_task_schedules` | `SELECT`, `INSERT`, `UPDATE` |
| `background_tasks` | `SELECT`, `INSERT`, `UPDATE` |
| `background_task_events` | `SELECT`, `INSERT` |
| `background_worker_heartbeats` | `SELECT`, `INSERT`, `UPDATE` |
| `background_worker_deployment_expectations` | `SELECT` |

The current role has 12 operation grants in total. It has no `DELETE`, `TRUNCATE`,
`REFERENCES`, `TRIGGER`, sequence, schema-creation, object-ownership,
receipt-table, deployment-expectation mutation, or other application-table
access. The packaged checks and
transition triggers remain responsible for valid queue states; task events are
append-only at this boundary.

Version 0.62 advances the queue-write contract to v2 after executing the actual
queue repository through the role. The first task insert failed closed because
the translated `result_json` check invokes the imported
`yoink_json_valid(text)` helper. Contract v2 grants only that required helper,
in addition to the already required zero-argument binder and scope functions.
The helper must be `plpgsql`, strict, immutable, non-security-definer, accept
exactly `value text`, have no custom configuration, and remain unavailable to
`PUBLIC`. No other application routine is executable.

Version 0.63 advances the queue-write contract to v3. It adds only `SELECT` on
the singleton API-owned `background_worker_deployment_expectations` row. Before
schedule initialization, due enqueue, or a new lease, the writer validates
contract version, external mode, runtime version, and deployment fingerprint
inside the same server-bound `READ COMMITTED` transaction. Already-leased
completion/failure recovery remains available. The
role cannot update the expectation. A mismatch
rolls the transaction back without writing a schedule or task.

Each of the four tenant queue tables receives an `AS RESTRICTIVE FOR ALL` policy using the
same zero-argument server-owned tenant scope as the read boundary. The
`NodePostgresTenantQueueWriteDatabase` opens a `READ COMMITTED READ WRITE`
transaction, assumes only this role, invokes the binder, and refuses an exact
tenant/user mismatch before exposing a query session. The verifier requires the
principal registry and role memberships to remain empty, checks effective
privileges across every application relation, and seals exact grants, identity
arguments, volatility, strictness, security mode, configuration, function
definitions, and policy expressions in an immutable receipt.

The native PostgreSQL 16 suite temporarily maps two logins and routes the actual
queue repository through two independent writer pools. It proves schedule,
task, and append-only event creation; repository heartbeat; capability-bound
retry and completion; locked-row skipping; exact-one-winner contention; and
concurrent tenant isolation. It also proves denial of cross-tenant insert/
update, delete, task-event update, unrelated-table select, mismatched expected
identity, an unmapped login, and deployment-expectation mutation. It proves the
expectation is readable and a deliberate mismatch leaves queue state unchanged.
Those fixtures and memberships are removed
before final receipt verification. Changing the JSON helper from immutable to
volatile or weakening a restrictive policy invalidates the receipt.

At the 0.63 boundary, principal enumeration, deployment status, and worker
stopping still used the qualification connection. Version 0.64 moves those
operations to the separately qualified worker-control boundary below.

Plan the exact boundary without a database connection:

```bash
npm run postgres:writes -- plan \
  yoink_cutover_qualification_063 yoink_q_063 yoink_session_q_063 yoink_queue_q_063
```

After the current cutover, read-role, and tenant-session receipts are verified,
apply once with the qualification/control role and explicit acknowledgement:

```bash
YOINK_POSTGRES_TENANT_QUEUE_WRITE_QUALIFICATION_ACK=server-bound-queue-write-qualification \
  npm run postgres:writes -- apply \
  yoink_cutover_qualification_063 yoink_q_063 yoink_session_q_063 yoink_queue_q_063
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:writes -- verify \
  yoink_cutover_qualification_063 yoink_q_063 yoink_session_q_063 yoink_queue_q_063
```

Queue-write contracts v1 and v2 are historical evidence only; v2 separates
attestation from each new-work queue mutation. Never alter or reuse an immutable
receipt: import a fresh cutover schema and use fresh role namespaces for v3.
Apply cannot create a login, role
membership, or principal mapping. It does not port a task handler, principal/
deployment-control repository, or API repository and does not configure the API
or worker to use PostgreSQL. The five-table grant boundary is qualification
evidence only; SQLite remains authoritative.

## Least-privilege worker-control qualification seam

Version 0.64 derives one additional fleet-control role from the exact current
cutover, read-role, tenant-session, and queue-write manifests. It is `NOLOGIN`,
`NOINHERIT`, `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, `NOREPLICATION`, and
`NOBYPASSRLS`. Its complete table surface is:

| Table | Exact operations | Purpose |
| --- | --- | --- |
| `users` | `SELECT (tenant_id, id)` | Bounded keyset enumeration without display-name or timestamp access |
| `background_worker_deployment_expectations` | `SELECT` on its singleton ID and four contract fields | Compare required contract, mode, runtime version, and fingerprint without metadata access |
| `background_worker_heartbeats` | `SELECT` on eight status fields; `UPDATE` on state, heartbeat/stopped timestamps, and error code | Report coverage and stop an existing worker without changing identity, runtime, or deployment attribution |

The 19 exact catalog column grants are grouped into those four operations.
Three role-specific permissive RLS policies expose them, and the update policy
requires the resulting heartbeat state to be `stopped`. The role
has no queue-task access, insert, delete, truncate, references, trigger,
sequence, application-function, schema-create, ownership, login, membership,
principal-mapping, runtime, or retailer authority. It cannot update a user or
deployment expectation, and the heartbeat update cannot create a worker.

`NodePostgresWorkerControlDatabase` opens a `READ COMMITTED READ WRITE`
transaction and assumes only this role before exposing the query session. When
supplied to `PostgresBackgroundWorkerQualificationStore`, principal pagination,
deployment status, and worker stopping must use that adapter; tenant queue work
continues through the separately bound tenant writer.

The native PostgreSQL 16 suite temporarily grants one disposable login the
control role. It proves exact two-page enumeration, raw visibility of exactly
the fixture users, deployment-coverage reporting, and stopping exactly one
heartbeat. Direct attempts to update users or expectations, insert a heartbeat,
or read tasks fail. The membership and mapped principals are removed before
the receipt is reverified. Weakening the users policy invalidates the sealed
catalog fingerprint.

Plan without a database connection:

```bash
npm run postgres:worker-control -- plan \
  yoink_cutover_qualification_064 yoink_q_064 yoink_session_q_064 \
  yoink_queue_q_064 yoink_control_q_064
```

After the exact queue-write v3 receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_WORKER_CONTROL_QUALIFICATION_ACK=bounded-worker-control-qualification \
  npm run postgres:worker-control -- apply \
  yoink_cutover_qualification_064 yoink_q_064 yoink_session_q_064 \
  yoink_queue_q_064 yoink_control_q_064
```

Then re-inspect the live catalogs and immutable receipt independently:

```bash
npm run postgres:worker-control -- verify \
  yoink_cutover_qualification_064 yoink_q_064 yoink_session_q_064 \
  yoink_queue_q_064 yoink_control_q_064
```

Apply refuses a reused role, policy, guard, or receipt and cannot create a
login, membership, or principal mapping. This is qualification evidence only;
the API and standalone worker do not construct this adapter at runtime, and
SQLite remains authoritative.

## Function-only notification-recovery handler qualification seam

Version 0.65 derives one additional role from the exact verified worker-control
chain. It is the first PostgreSQL task-handler repository, covering only
`notification_recovery`. The role is `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS`, owns no object, and has no table, column, sequence, schema-create,
insert, update, or delete privilege. Its complete application authority is:

| Routine | Exact authority | Data returned |
| --- | --- | --- |
| `yoink_recover_notification_deliveries(text, text)` | Expire pending/leased notifications whose bound action job has ended; fail an expired lease at the three-attempt ceiling; requeue an expired lease below that ceiling | Three aggregate counts only |

The routine is strict, volatile, security-definer, and pinned to
`search_path=pg_catalog`. It independently resolves PostgreSQL `session_user`
against the server-owned principal registry and compares that result with the
tenant/user expected by the authenticated worker context. A missing, duplicate,
inactive, or mismatched mapping raises an authorization error before mutation.
The function always filters both tenant and user, clears any device/capability
lease when transitioning, uses PostgreSQL's own statement clock so the caller
cannot advance expiry, and reproduces the current SQLite ordering: window expiry
first, exhausted leases second, requeue last.

The verifier requires zero active mappings and memberships, zero effective
table/column privileges, exactly one executable application routine, no public
execute, the exact owner/ACL/source/signature/result/volatility/strictness/
security configuration, and forced RLS on the two protected tables. Its
immutable receipt seals the complete catalog fingerprint. Native PostgreSQL 16
then uses temporary mapped logins to run the real maintenance handler and prove
result parity, future-lease preservation, cross-tenant isolation,
mismatch/unmapped denial, direct-access denial, repeat idempotency, exactly one
transition under concurrent recovery, clean fixture removal, and tamper
rejection.

Plan without a database connection:

```bash
npm run postgres:notification-recovery -- plan \
  yoink_cutover_qualification_065 yoink_q_065 yoink_session_q_065 \
  yoink_queue_q_065 yoink_control_q_065 yoink_notify_q_065
```

After the exact worker-control v1 receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_NOTIFICATION_RECOVERY_QUALIFICATION_ACK=bounded-notification-recovery-qualification \
  npm run postgres:notification-recovery -- apply \
  yoink_cutover_qualification_065 yoink_q_065 yoink_session_q_065 \
  yoink_queue_q_065 yoink_control_q_065 yoink_notify_q_065
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:notification-recovery -- verify \
  yoink_cutover_qualification_065 yoink_q_065 yoink_session_q_065 \
  yoink_queue_q_065 yoink_control_q_065 yoink_notify_q_065
```

Apply refuses any reused role, routine, guard, or receipt and cannot create a
login, membership, or principal mapping. The API and standalone worker do not
construct this adapter in their shipped runtime composition. Exactly one of
seven task families has repository parity; the role remains inactive and
SQLite remains authoritative.

## Function-only execution-recovery handler qualification seam

Version 0.66 derives a second handler role from the exact verified
notification-recovery chain. It covers only `execution_recovery`; its
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no object, has no table, column,
sequence, schema-create, policy, insert, update, or delete privilege, and may
execute exactly one strict security-definer routine:

| Routine | Exact authority | Data returned |
| --- | --- | --- |
| `yoink_recover_action_execution(text, text)` | Retire expired Chrome action leases according to the existing pre/post-mutation state machine; expire unleased action windows; release expired spend reservations; append the corresponding action, spend-ledger, audit, and outbox receipts | Recovered-lease, expired-job, and released-reservation counts only |

The routine independently resolves PostgreSQL `session_user`, compares it with
the expected authenticated tenant/user, takes a transaction-scoped advisory
lock for that exact principal, and uses PostgreSQL's statement clock. Callers
cannot advance expiration, select a different tenant, or race duplicate
receipts. `add_authorized` closes as cancelled, states before the mutation
boundary expire, states after it lock for manual review, and `submitting`
becomes submission-uncertain. No function path leases new work, clicks a
retailer, enters checkout, submits an order, commits spend, deletes history, or
returns row content.

Nine relations are sealed into the function-source/catalog receipt and all nine
are tenant-owned forced-RLS tables. Migration 48 gives `signal_incidents` an
exact tenant/user owner; the routine must match that owner before closing or
locking it. Two independent checks also retain the earlier corruption defense:
if any bound action job or signal occurrence belongs to another principal, the
private action and spend state recover but incident mutation is skipped. The
same exact-owner and corruption guards apply to SQLite transitions.

The native PostgreSQL 16 suite executes the production maintenance handler and
proves every transition class, future-state preservation, capability
retirement, spend-ledger/audit/outbox parity, mismatch and unmapped denial,
zero direct table access, denial of the notification function, cross-tenant
shared-incident preservation after both tenants recover, idempotent replay,
exactly one concurrent winner, clean removal of temporary mappings/memberships,
and receipt rejection after routine tamper.

Plan without a database connection:

```bash
npm run postgres:execution-recovery -- plan \
  yoink_cutover_qualification_066 yoink_q_066 yoink_session_q_066 \
  yoink_queue_q_066 yoink_control_q_066 yoink_notify_q_066 yoink_execute_q_066
```

After the exact notification-recovery v1 receipt is verified, apply once with
the qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_EXECUTION_RECOVERY_QUALIFICATION_ACK=bounded-execution-recovery-qualification \
  npm run postgres:execution-recovery -- apply \
  yoink_cutover_qualification_066 yoink_q_066 yoink_session_q_066 \
  yoink_queue_q_066 yoink_control_q_066 yoink_notify_q_066 yoink_execute_q_066
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:execution-recovery -- verify \
  yoink_cutover_qualification_066 yoink_q_066 yoink_session_q_066 \
  yoink_queue_q_066 yoink_control_q_066 yoink_notify_q_066 yoink_execute_q_066
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, or runtime composition. Exactly two of seven task families now have
repository parity; both roles remain inactive and SQLite stays authoritative.

## Function-only operational-retention handler qualification seam

Version 0.67 derives a third handler role from the exact verified
execution-recovery chain. It covers only `operational_telemetry_retention`; its
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no object, has no table, column,
sequence, schema-create, policy, insert, update, or delete privilege, and may
execute exactly one strict security-definer routine:

| Routine | Exact authority | Data returned |
| --- | --- | --- |
| `yoink_apply_operational_retention(text, text)` | Apply the existing 30-day operational telemetry and completed-task-history windows plus the 90-day quarantined observer-recovery window; delete at most 500 eligible evidence rows; append the existing telemetry/evidence retention, audit, and outbox receipts | Counts, policy cutoffs, retention days, and receipt IDs only |

The routine resolves PostgreSQL `session_user`, compares it with the expected
authenticated tenant/user, takes a transaction-scoped advisory lock for that
tenant, and derives both cutoffs from PostgreSQL's statement clock. Callers
cannot advance a cutoff, select another tenant, attribute a receipt to an
arbitrary process label, expand the evidence batch, or race duplicate receipts.
Recent observer-evidence reviews preserve their evidence even when the evidence
itself is older than 90 days. Current telemetry, current task history,
dead-letter tasks, and fresh evidence are not deleted.

Ten directly tenant-owned relations are sealed into the function-source and
catalog receipt, and all ten retain forced RLS. The function's role has zero
direct access to them. Evidence deletion remains capped at 500 and is locked
before cascading review deletion; a changed set aborts the transaction. The
authenticated PostgreSQL login principal—not a caller-supplied actor string—is
recorded on the evidence retention receipt. No function path schedules or
leases work, processes a signal, changes a recipe, invokes Chrome, mutates a
retailer, enters checkout, submits an order, or returns deleted row content.

The native PostgreSQL 16 suite executes the production maintenance handler and
proves 30/90-day old/current boundaries, recent-review preservation, review and
task-event cascade counts, exact retention/audit/outbox receipts, cross-tenant
isolation, mismatch and unmapped denial, zero direct table/delete access,
denial of the execution-recovery function, idempotent replay, exactly one
concurrent winner, clean removal of temporary mappings/memberships, and receipt
rejection after routine tamper.

Plan without a database connection:

```bash
npm run postgres:operational-retention -- plan \
  yoink_cutover_qualification_067 yoink_q_067 yoink_session_q_067 \
  yoink_queue_q_067 yoink_control_q_067 yoink_notify_q_067 \
  yoink_execute_q_067 yoink_retain_q_067
```

After the exact execution-recovery v1 receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_OPERATIONAL_RETENTION_QUALIFICATION_ACK=bounded-operational-retention-qualification \
  npm run postgres:operational-retention -- apply \
  yoink_cutover_qualification_067 yoink_q_067 yoink_session_q_067 \
  yoink_queue_q_067 yoink_control_q_067 yoink_notify_q_067 \
  yoink_execute_q_067 yoink_retain_q_067
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:operational-retention -- verify \
  yoink_cutover_qualification_067 yoink_q_067 yoink_session_q_067 \
  yoink_queue_q_067 yoink_control_q_067 yoink_notify_q_067 \
  yoink_execute_q_067 yoink_retain_q_067
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, or runtime composition. Exactly three of seven task families now have
repository parity; all three roles remain inactive and SQLite stays
authoritative.

## Function-only observer-candidate handler qualification seam

Version 0.68 derives a fourth handler role from the exact verified
operational-retention chain. It covers only
`observer_recipe_candidate_evaluation`. The role is `NOLOGIN`, `NOINHERIT`,
and `NOBYPASSRLS`, owns no object, receives schema `USAGE` only, has zero
direct/effective table or column grants, and can execute exactly one strict
security-definer routine.

The routine is deliberately two-phase. `plan` reads only the newest 2,000
sanitized repair diagnostics for the database-authenticated tenant/user,
closes recovered or superseded groups, and returns at most 25 aggregate mature
candidate descriptions. It never returns device IDs or exact SKU IDs. `apply`
accepts only a fresh exact plan, re-derives the evidence under the same
per-principal advisory lock and `READ COMMITTED` transaction, and creates or
reuses only deterministic unsigned, non-executable, 30-day quarantine rows.
The five protected tables retain forced RLS. Lifecycle, audit, and outbox
receipts remain atomic.

The routine has no signing, promotion, distribution, field-fill, recipe
execution, signal-processing, Chrome, retailer, checkout, or order authority.
Native PostgreSQL proves result parity, tenant isolation, mismatch/unmapped
denial, stale-plan and altered-payload rejection, direct SQL/function denial,
idempotent replay, concurrent deduplication, production-handler routing,
temporary-authority cleanup, and receipt rejection after catalog tamper.

Plan without a database connection:

```bash
npm run postgres:observer-candidates -- plan \
  yoink_cutover_qualification_068 yoink_q_068 yoink_session_q_068 \
  yoink_queue_q_068 yoink_control_q_068 yoink_notify_q_068 \
  yoink_execute_q_068 yoink_retain_q_068 yoink_candidate_q_068
```

After the exact operational-retention receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_OBSERVER_CANDIDATE_QUALIFICATION_ACK=bounded-quarantined-observer-candidate-qualification \
  npm run postgres:observer-candidates -- apply \
  yoink_cutover_qualification_068 yoink_q_068 yoink_session_q_068 \
  yoink_queue_q_068 yoink_control_q_068 yoink_notify_q_068 \
  yoink_execute_q_068 yoink_retain_q_068 yoink_candidate_q_068
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:observer-candidates -- verify \
  yoink_cutover_qualification_068 yoink_q_068 yoink_session_q_068 \
  yoink_queue_q_068 yoink_control_q_068 yoink_notify_q_068 \
  yoink_execute_q_068 yoink_retain_q_068 yoink_candidate_q_068
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, signing key, or runtime composition. Exactly four of seven task
families now have repository parity; all four roles remain inactive and SQLite
stays authoritative.

## Function-only operator-alert connector-dispatch qualification seam

Version 0.69 derives one additional sub-boundary role from the exact verified
observer-candidate chain. It covers only the connector queue, lease, retry,
delivery, and dead-letter operations used by `adapter_alert_reconciliation`.
Diagnostic-to-incident reconciliation is explicitly outside this boundary, so
the complete-handler count remains four of seven.

The role is `NOLOGIN`, `NOINHERIT`, and `NOBYPASSRLS`, owns no objects, has
schema `USAGE`, zero direct/effective table or column grants, no sequence or
policy authority, and one exact strict security-definer function grant. Four
tables remain forced-RLS: connector configuration, incidents, deliveries, and
append-only delivery events. The function resolves `session_user` through the
server-owned principal registry and requires every selected incident to match
the exact mapped `subject_user_id`, not merely its tenant.

Lease selection and application share one `READ COMMITTED` transaction and use
`FOR UPDATE SKIP LOCKED`. PostgreSQL selects the row and supplies statement
time; the application generates a random 32-byte capability between the plan
and apply calls and stores only its one-use hash. The boundary accepts at most
20 valid deployment-owned endpoint reference/fingerprint bindings, never raw
webhook URLs or signing secrets, and caps attempts at 12, payloads at 4,000
bytes, leases at 15–300 seconds, and retries at 1–86,400 seconds.

Native PostgreSQL 16 proves one winner under concurrent claims, exact
delivery/retry/dead-letter state transitions, expired twelfth-attempt recovery,
wrong-capability rollback, same-tenant cross-user and cross-tenant isolation,
unmapped denial, production dispatch-service compatibility, direct SQL and
unrelated-function denial, clean temporary authority removal, and receipt
failure after function-catalog tamper. No qualification command contacts a
webhook.

Plan without a database connection:

```bash
npm run postgres:alert-dispatch -- plan \
  yoink_cutover_qualification_069 yoink_q_069 yoink_session_q_069 \
  yoink_queue_q_069 yoink_control_q_069 yoink_notify_q_069 \
  yoink_execute_q_069 yoink_retain_q_069 yoink_candidate_q_069 \
  yoink_dispatch_q_069
```

After the exact observer-candidate receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_ALERT_DISPATCH_QUALIFICATION_ACK=bounded-operator-alert-dispatch-qualification \
  npm run postgres:alert-dispatch -- apply \
  yoink_cutover_qualification_069 yoink_q_069 yoink_session_q_069 \
  yoink_queue_q_069 yoink_control_q_069 yoink_notify_q_069 \
  yoink_execute_q_069 yoink_retain_q_069 yoink_candidate_q_069 \
  yoink_dispatch_q_069
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:alert-dispatch -- verify \
  yoink_cutover_qualification_069 yoink_q_069 yoink_session_q_069 \
  yoink_queue_q_069 yoink_control_q_069 yoink_notify_q_069 \
  yoink_execute_q_069 yoink_retain_q_069 yoink_candidate_q_069 \
  yoink_dispatch_q_069
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, connector, endpoint, secret, webhook request, or runtime composition.
Alert diagnostic reconciliation and its independent proof remain required
before this task family can count as the fifth complete handler.

## Function-only operator-alert reconciliation qualification seam

Version 0.70 completes the fifth handler with an independent boundary layered
on the exact verified 0.69 connector-dispatch contract. Its dedicated role is
`NOLOGIN`, `NOINHERIT`, and `NOBYPASSRLS`, owns no objects, has schema `USAGE`,
zero direct/effective table or column grants, and can execute one exact strict
security-definer routine. Ten diagnostic, rule, incident, lifecycle,
dashboard-delivery, connector-queue, audit, and outbox tables retain forced
RLS. The routine resolves `session_user` and requires the requested tenant/user
to match the server-owned principal registry.

One `READ COMMITTED` transaction takes a per-principal advisory lock, derives a
server-timestamped plan from at most the newest 2,000 sanitized diagnostics,
and selects at most 50 repair groups/actions against at most 50 current rules
and 20 connectors. Apply must present that exact plan within 30 seconds.
PostgreSQL re-derives the evidence and revalidates every incident, rule, route,
connector binding, payload, and application-generated opaque identifier before
performing any mutation.

The boundary preserves open, repeat, content-update, immediate and delayed
escalation, auto-resolution, historical replay suppression, and recovery/reopen
behavior. Incident lifecycle, dashboard delivery, audit, outbox, and connector
queue receipts are atomic. Only sanitized aggregate fields and opaque endpoint
references cross the boundary; raw URLs, signing secrets, page evidence,
product identifiers, arbitrary payloads, webhook contact, and retailer actions
remain inaccessible.

Native PostgreSQL 16 proves exact lifecycle/result parity, idempotent replay,
reopen after recovery, one winner under simultaneous reconciliation,
same-tenant cross-user and cross-tenant isolation, mismatched/unmapped denial,
stale, empty, and altered plan rejection, production maintenance-handler
routing, direct SQL/unrelated-function denial, clean temporary-authority
removal, and receipt failure after function-catalog tamper.

Plan without a database connection:

```bash
npm run postgres:alert-reconciliation -- plan \
  yoink_cutover_qualification_070 yoink_q_070 yoink_session_q_070 \
  yoink_queue_q_070 yoink_control_q_070 yoink_notify_q_070 \
  yoink_execute_q_070 yoink_retain_q_070 yoink_candidate_q_070 \
  yoink_dispatch_q_070 yoink_reconcile_q_070
```

After the exact connector-dispatch receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_ALERT_RECONCILIATION_QUALIFICATION_ACK=bounded-operator-alert-reconciliation-qualification \
  npm run postgres:alert-reconciliation -- apply \
  yoink_cutover_qualification_070 yoink_q_070 yoink_session_q_070 \
  yoink_queue_q_070 yoink_control_q_070 yoink_notify_q_070 \
  yoink_execute_q_070 yoink_retain_q_070 yoink_candidate_q_070 \
  yoink_dispatch_q_070 yoink_reconcile_q_070
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:alert-reconciliation -- verify \
  yoink_cutover_qualification_070 yoink_q_070 yoink_session_q_070 \
  yoink_queue_q_070 yoink_control_q_070 yoink_notify_q_070 \
  yoink_execute_q_070 yoink_retain_q_070 yoink_candidate_q_070 \
  yoink_dispatch_q_070 yoink_reconcile_q_070
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, rule, connector, endpoint, secret, webhook request, or runtime
composition. Exactly five of seven task-handler families now have repository
parity. All qualification roles remain inactive, SQLite stays authoritative,
and the remaining two handler families require independent boundaries.

## Function-only independent observer-witness refresh qualification seam

Version 0.71 completes the sixth handler with an independent boundary layered
on the exact verified 0.70 alert-reconciliation contract. Its role is
`NOLOGIN`, `NOINHERIT`, and `NOBYPASSRLS`, owns no objects, has schema `USAGE`,
zero direct/effective table or column grants, and can execute one exact strict
security-definer routine. Trust manifests, transparency events, witness
receipts/checks, audit, and outbox remain forced-RLS.

The boundary is deliberately two phase. A short `READ COMMITTED` plan
transaction resolves `session_user`, verifies the expected tenant/user, takes a
tenant/log advisory lock, and derives the exact public checkpoint and current
receipt chain. The application then publishes that checkpoint over the
separately configured HTTPS client and verifies the pinned Ed25519 signature
with no database transaction open. Apply must present the exact plan within 30
seconds; PostgreSQL re-derives it and checks checkpoint, sequence, chain,
lifetime, canonical envelope/payload bytes, SHA-256 hashes, and opaque IDs
before appending anything.

Only public cryptographic metadata and bounded audit/outbox receipts persist.
The routine receives no endpoint URL or public SPKI, stores neither, and has no
private key or network capability. Native PostgreSQL 16 proves initial
acceptance, fresh no-op, renewal, fail-closed unavailability, invalid-signature
rejection with zero writes, one concurrent winner, tenant isolation,
mismatched/unmapped/direct-SQL/unrelated-function denial, altered-plan
rejection, exact user attribution, temporary-authority cleanup, and immutable
receipt rejection after function-catalog tamper.

Plan without a database connection:

```bash
npm run postgres:witness-refresh -- plan \
  yoink_cutover_qualification_071 yoink_q_071 yoink_session_q_071 \
  yoink_queue_q_071 yoink_control_q_071 yoink_notify_q_071 \
  yoink_execute_q_071 yoink_retain_q_071 yoink_candidate_q_071 \
  yoink_dispatch_q_071 yoink_reconcile_q_071 yoink_witness_q_071
```

After the exact alert-reconciliation receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_WITNESS_REFRESH_QUALIFICATION_ACK=bounded-observer-witness-refresh-qualification \
  npm run postgres:witness-refresh -- apply \
  yoink_cutover_qualification_071 yoink_q_071 yoink_session_q_071 \
  yoink_queue_q_071 yoink_control_q_071 yoink_notify_q_071 \
  yoink_execute_q_071 yoink_retain_q_071 yoink_candidate_q_071 \
  yoink_dispatch_q_071 yoink_reconcile_q_071 yoink_witness_q_071
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:witness-refresh -- verify \
  yoink_cutover_qualification_071 yoink_q_071 yoink_session_q_071 \
  yoink_queue_q_071 yoink_control_q_071 yoink_notify_q_071 \
  yoink_execute_q_071 yoink_retain_q_071 yoink_candidate_q_071 \
  yoink_dispatch_q_071 yoink_reconcile_q_071 yoink_witness_q_071
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, witness configuration, endpoint, key, network request, or runtime
composition. Exactly six of seven task-handler families now have repository
parity. All qualification roles remain inactive, SQLite stays authoritative,
and hosted-delivery signal evaluation still requires its own independent
repository boundary.

## Function-only hosted-delivery transport-lifecycle qualification seam

Version 0.72 decomposes the final `hosted_delivery_recovery` task into its two
real mutation domains and qualifies expired inbox/outbox lease recovery.
Version 0.74 advances that same inactive boundary to contract v2 by adding the
complete lease/acknowledgement/failure lifecycle for already accepted, fixed
`signal_event_v1` inbox messages. Inbox acceptance and durable signal
evaluation remain separate open repository ports. Version 0.75 advances the
boundary to contract v3 with a read-only resolution-plan function for the exact
leased message. Resolution-plan application and downstream evaluation remain
open repository ports, so the honest complete-handler counter remains six of
seven.

The lease-recovery role is `NOLOGIN`, `NOINHERIT`, and `NOBYPASSRLS`, owns no
objects, has schema `USAGE`, zero direct/effective table or column grants, and
may execute exactly three strict security-definer functions. Inbox messages,
outbox events, and hosted-delivery receipts are forced-RLS. All three functions
resolve `session_user` through the server-owned principal registry, check the
expected tenant/user, and use the database statement clock. The expired-lease
function takes a per-principal advisory transaction lock.

Only rows with a nonempty lease that expired by the server timestamp can move.
Inbox attempts below 20 become `failed` with an immediate retry time; attempt
20 becomes `dead_letter`. Outbox attempts below 20 return to `pending`; attempt
20 becomes `dead_letter`. Each winning transition clears the capability and
expiry, records `lease_expired`, and appends the existing length-delimited
SHA-256 receipt with the authenticated user. The function returns four counts
and never exposes message payloads.

The second function accepts only `lease`, `complete`, or `fail` and only the
packaged `signal_event_v1` event type. A lease selects one eligible accepted,
retryable, or expired-processing row with `FOR UPDATE SKIP LOCKED`, increments
its bounded attempt, and applies a fixed 60-second expiry. The application
supplies a fresh 43-character, 256-bit capability; only the existing length-
delimited SHA-256 capability hash is persisted. Completion or failure must
present the exact unexpired token. Completion records `processed`/`worker_ack`;
failure records `retry` with a fixed 30-second delay below attempt 20 or
`dead_letter` at attempt 20. The raw capability is never returned in a receipt
or stored in a table.

The third function accepts only the exact message ID and unexpired capability
for a processing TrackaLacker `signal_event_v1` row. It takes `FOR SHARE`,
recomputes the stored `hosted_delivery_payload_v1` hash, validates the packaged
normalized `trackalacker-push-v1` shape and principal-owned source connection,
and recomputes the source-connection/external-event transport hash. It detects
an existing principal-owned signal before consulting the catalog.

For a new signal, PostgreSQL follows the same resolution priority as the SQLite
repository: exact source listing, retailer/SKU, preferred source-product
retailer, unique source-product retailer, preferred TrackaLacker-slug retailer,
then unique slug retailer. Ambiguous candidates stay ambiguous. A result is
valid for at most 30 seconds and never beyond its inbox lease; a deterministic
length-delimited SHA-256 fingerprint binds principal, message, payload, source,
signal, outcome, public listing projection, and the separate-catalog-authority
flag. Raw identity, offer, and evidence objects are not returned.

The planner contains no write statement. In particular it cannot create a
catalog item, signal event, resolution, occurrence, mission, strategy, incident,
offer observation, notification, spend reservation, or action job. A live
unresolved identity from an auto-create-enabled `trusted_exact` connection only
reports that a future shared-catalog authority would be required.

Native PostgreSQL 16 proves all four transitions, preservation of live leases,
exact receipt-hash parity with SQLite, cross-tenant isolation, idempotent
replay, a single winner under simultaneous calls, mismatched and unmapped
principal denial, direct table denial, clean temporary membership removal, and
immutable receipt rejection after function-catalog tamper. Contract v2 also
proves one-winner signal leasing, same-tenant/different-user isolation, payload
parsing, stored capability-hash parity, wrong-token and cross-principal denial,
completion, delayed retry, attempt-20 dead letter, and immediate-retry
exclusion.
Contract v3 additionally proves exact source-listing and retailer-SKU matches,
ambiguous and unresolved identity, duplicate detection, payload/transport/plan
hash parity, wrong-token, cross-tenant and same-tenant/different-user denial,
post-transition replay denial, direct invocation denial, and unchanged catalog,
signal, mission, strategy, incident, observation, and action counts.

Plan without a database connection:

```bash
npm run postgres:delivery-lease-recovery -- plan \
  yoink_cutover_qualification_074 yoink_q_074 yoink_session_q_074 \
  yoink_queue_q_074 yoink_control_q_074 yoink_notify_q_074 \
  yoink_execute_q_074 yoink_retain_q_074 yoink_candidate_q_074 \
  yoink_dispatch_q_074 yoink_reconcile_q_074 yoink_witness_q_074 \
  yoink_delivery_q_074
```

After the exact witness-refresh receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_DELIVERY_LEASE_RECOVERY_QUALIFICATION_ACK=bounded-delivery-lease-recovery-qualification \
  npm run postgres:delivery-lease-recovery -- apply \
  yoink_cutover_qualification_074 yoink_q_074 yoink_session_q_074 \
  yoink_queue_q_074 yoink_control_q_074 yoink_notify_q_074 \
  yoink_execute_q_074 yoink_retain_q_074 yoink_candidate_q_074 \
  yoink_dispatch_q_074 yoink_reconcile_q_074 yoink_witness_q_074 \
  yoink_delivery_q_074
```

Then independently re-inspect the catalogs and immutable receipt:

```bash
npm run postgres:delivery-lease-recovery -- verify \
  yoink_cutover_qualification_074 yoink_q_074 yoink_session_q_074 \
  yoink_queue_q_074 yoink_control_q_074 yoink_notify_q_074 \
  yoink_execute_q_074 yoink_retain_q_074 yoink_candidate_q_074 \
  yoink_dispatch_q_074 yoink_reconcile_q_074 yoink_witness_q_074 \
  yoink_delivery_q_074
```

Apply refuses reused objects and cannot create a login, membership, principal
mapping, runtime composition, message, signal, mission, action job, retailer
mutation, or production authority. It does not accept an inbox message or
evaluate a signal. SQLite remains authoritative.

## Insert-only unknown-signal catalog-create qualification seam

Version 0.76 adds a separate qualification boundary for the one shared write
that the v0.75 planner deliberately refused: creating the exact catalog rows
for an unresolved product from an already leased `trusted_exact`
TrackaLacker signal. This does not modify the hosted-delivery role. A new
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no object, has schema `USAGE`,
zero direct/effective table or column privileges, and can execute one strict
security-definer function.

The Node adapter begins one `READ COMMITTED` read-write transaction, sets only
that role, requests a plan, then applies its SHA-256 fingerprint within 30
seconds. Both calls bind `session_user` through the server principal registry.
The database invokes the qualified v0.75 resolution planner against the exact
message and one-use inbox capability, locks the retailer/SKU identity with a
transaction advisory lock, locks tenant references as needed, and re-derives
the current plan before inserting anything. A second contender, changed plan,
expired lease, forged token, mismatched user, ambiguous mapping, or existing
listing loses without a partial write.

The routine can insert only four shared catalog relations—`product_families`,
`variants`, `listings`, and `listing_urls`—plus `source_product_refs`,
`source_listing_refs`, and `source_product_aliases` for the authenticated
tenant. Canonical URL/SKU identity must match one of the 13 packaged retailer
formats. Existing references are never refreshed; there is no `UPDATE` or
`DELETE`. Signal events, resolution decisions, occurrences, incidents, offer
observations, missions, strategies, notifications, spend, actions, inbox
acknowledgement, and raw signal results are outside the routine.

Native PostgreSQL 16 proves exact seven-table deltas, a subsequent read-only
plan matching the created listing, unchanged evaluation graphs, and an inbox
that remains `processing` until the separate transport function acknowledges
it. It also proves wrong-token, cross-tenant, same-tenant/different-user,
unmapped, replay, and direct-SQL denial; one winner under simultaneous apply;
clean temporary membership removal; and immutable receipt rejection after
function-catalog tamper.

Plan without a database connection:

```bash
npm run postgres:signal-catalog-apply -- plan \
  yoink_cutover_qualification_076 yoink_q_076 yoink_session_q_076 \
  yoink_queue_q_076 yoink_control_q_076 yoink_notify_q_076 \
  yoink_execute_q_076 yoink_retain_q_076 yoink_candidate_q_076 \
  yoink_dispatch_q_076 yoink_reconcile_q_076 yoink_witness_q_076 \
  yoink_delivery_q_076 yoink_catalog_q_076
```

After the exact hosted-delivery v3 receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_CATALOG_APPLY_QUALIFICATION_ACK=bounded-signal-catalog-apply-qualification \
  npm run postgres:signal-catalog-apply -- apply \
  yoink_cutover_qualification_076 yoink_q_076 yoink_session_q_076 \
  yoink_queue_q_076 yoink_control_q_076 yoink_notify_q_076 \
  yoink_execute_q_076 yoink_retain_q_076 yoink_candidate_q_076 \
  yoink_dispatch_q_076 yoink_reconcile_q_076 yoink_witness_q_076 \
  yoink_delivery_q_076 yoink_catalog_q_076
```

Then independently inspect the catalogs and immutable receipt:

```bash
npm run postgres:signal-catalog-apply -- verify \
  yoink_cutover_qualification_076 yoink_q_076 yoink_session_q_076 \
  yoink_queue_q_076 yoink_control_q_076 yoink_notify_q_076 \
  yoink_execute_q_076 yoink_retain_q_076 yoink_candidate_q_076 \
  yoink_dispatch_q_076 yoink_reconcile_q_076 yoink_witness_q_076 \
  yoink_delivery_q_076 yoink_catalog_q_076
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. Applying this qualification boundary creates no
login, principal mapping, runtime composition, source-reference refresh,
signal-evaluation authority, or retailer-session authority. SQLite remains
authoritative.

## Signal-event and resolution-commit qualification seam

Version 0.77 adds a third, independent hosted-signal role for the committed
state shared by every signal branch before downstream evaluation. It does not
widen the hosted-delivery or catalog-create roles. The new `NOLOGIN`,
`NOINHERIT`, `NOBYPASSRLS` role owns no object, belongs to no role, has schema
`USAGE` plus zero direct/effective table or column privileges, and can execute
one strict security-definer function.

The Node adapter begins one `READ COMMITTED` read-write transaction, requests
a plan, verifies its exact shape and principal-bound SHA-256 fingerprint, then
applies the fingerprint before its 30-second/database-lease deadline. The
database authenticates `session_user`, validates the current inbox capability
before acquiring locks, takes the exact processing row `FOR UPDATE`, serializes
the source/transport identity with a transaction advisory lock, and invokes the
v0.75 resolver again after serialization. Every claim is re-derived on apply.
This makes simultaneous callers converge on one event mutation and one
mutation-free duplicate result without partial state.

For a nonduplicate, the routine performs exactly the current committed-state
equivalent of `SignalRepository.insertEvent` plus `recordResolution`:

- insert one tenant/user-owned `signal_events` row with the normalized,
  already-sanitized identity, offer, and evidence fields;
- update only the exact principal-owned TrackaLacker `source_connections`
  status, `last_event_at`, and `updated_at`; and
- insert one `resolution_decisions` row using `resolver-v1`, with listing and
  variant foreign keys only for a matched resolution.

A transport duplicate returns its existing event ID and writes nothing.
Matched, ambiguous, unresolved, and duplicate outcomes are qualified. If the
current plan still says an unknown product needs shared-catalog creation, this
routine fails closed; the v0.76 boundary must commit that catalog identity in
a separate transaction before event/resolution apply. The function has no SQL
for catalog or source-reference refresh, occurrences, offer observations,
incidents, mission decisions, missions, strategies, notifications, spend,
action jobs, audit/outbox, or inbox transition. It returns IDs, hashes, flags,
and bounded counts only, never the raw signal payload.

Native PostgreSQL 16 proves exact row deltas and stored JSON semantics,
catalog-first composition, all four outcomes, an unchanged downstream graph
and still-processing inbox, invalid capability, cross-tenant, same-tenant/
different-user, unmapped-principal, replay, and direct-SQL denial, exactly one
mutation under concurrent calls, clean temporary membership removal, and
immutable receipt rejection after function-catalog tamper.

Plan without a database connection:

```bash
npm run postgres:signal-resolution-apply -- plan \
  yoink_cutover_qualification_077 yoink_q_077 yoink_session_q_077 \
  yoink_queue_q_077 yoink_control_q_077 yoink_notify_q_077 \
  yoink_execute_q_077 yoink_retain_q_077 yoink_candidate_q_077 \
  yoink_dispatch_q_077 yoink_reconcile_q_077 yoink_witness_q_077 \
  yoink_delivery_q_077 yoink_catalog_q_077 yoink_resolution_q_077
```

After the exact v0.76 catalog-apply receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_RESOLUTION_APPLY_QUALIFICATION_ACK=bounded-signal-resolution-apply-qualification \
  npm run postgres:signal-resolution-apply -- apply \
  yoink_cutover_qualification_077 yoink_q_077 yoink_session_q_077 \
  yoink_queue_q_077 yoink_control_q_077 yoink_notify_q_077 \
  yoink_execute_q_077 yoink_retain_q_077 yoink_candidate_q_077 \
  yoink_dispatch_q_077 yoink_reconcile_q_077 yoink_witness_q_077 \
  yoink_delivery_q_077 yoink_catalog_q_077 yoink_resolution_q_077
```

Then independently inspect the role, routine, forced-RLS tables, immutable
receipt, and dependency fingerprint:

```bash
npm run postgres:signal-resolution-apply -- verify \
  yoink_cutover_qualification_077 yoink_q_077 yoink_session_q_077 \
  yoink_queue_q_077 yoink_control_q_077 yoink_notify_q_077 \
  yoink_execute_q_077 yoink_retain_q_077 yoink_candidate_q_077 \
  yoink_dispatch_q_077 yoink_reconcile_q_077 yoink_witness_q_077 \
  yoink_delivery_q_077 yoink_catalog_q_077 yoink_resolution_q_077
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. No login, principal mapping, membership, runtime
composition, inbox acknowledgement, or retailer-session authority is created.
SQLite remains authoritative and complete handler parity remains six of seven.

## Known-product source-reference refresh qualification seam

Version 0.78 adds a fourth independent hosted-signal role for the exact tenant
reference refresh that follows a committed matched resolution. It does not
widen the hosted-delivery, catalog-create, or event-resolution roles. The new
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no object, belongs to no role,
has zero direct/effective table or column privileges, and can execute one strict
security-definer function across seven forced-RLS tenant tables.

The Node adapter plans and applies within one `READ COMMITTED` read-write
transaction. PostgreSQL authenticates `session_user`, validates the current
leased TrackaLacker inbox capability before taking locks, requires the exact
already-committed event and one unique resolution decision, and invokes the
v0.75 resolver again. The application accepts only a principal-bound SHA-256
plan no older than 30 seconds; the plan contains a hash of the reference
identity, never the raw source product, listing, or alias values.

Only three relations may change:

- `source_product_refs` binds the source product to the resolved variant;
- `source_listing_refs` binds the source listing to the resolved listing; and
- `source_product_aliases` binds the TrackaLacker slug to the variant.

Missing bindings are inserted. An existing binding may update only when the
incoming observation is newer, preserving its source URL while refreshing the
observation timestamp and product title. A current or older replay writes
nothing. Test, ambiguous, unresolved, missing-identity, or non-TrackaLacker
signals are mutation-free. Any attempted remap to another variant or listing
aborts the entire transaction. The function has no SQL for shared catalog,
occurrence, offer, incident, mission, policy, action, notification, spend,
audit/outbox, or inbox-lifecycle mutation.

Native PostgreSQL 16 proves exact insert/update row semantics, zero-write test
and nonmatched outcomes, invalid capability, cross-tenant, same-tenant/
different-user, unmapped-principal and direct-SQL denial, one mutation under
simultaneous calls, mutation-free replay, conflicting-remap rollback and
recovery, clean temporary membership removal, and immutable receipt rejection
after function-catalog tamper.

Plan without a database connection:

```bash
npm run postgres:signal-source-reference-refresh -- plan \
  yoink_cutover_qualification_078 yoink_q_078 yoink_session_q_078 \
  yoink_queue_q_078 yoink_control_q_078 yoink_notify_q_078 \
  yoink_execute_q_078 yoink_retain_q_078 yoink_candidate_q_078 \
  yoink_dispatch_q_078 yoink_reconcile_q_078 yoink_witness_q_078 \
  yoink_delivery_q_078 yoink_catalog_q_078 yoink_resolution_q_078 \
  yoink_reference_q_078
```

After the exact v0.77 resolution-apply receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_SOURCE_REFERENCE_REFRESH_QUALIFICATION_ACK=bounded-signal-source-reference-refresh-qualification \
  npm run postgres:signal-source-reference-refresh -- apply \
  yoink_cutover_qualification_078 yoink_q_078 yoink_session_q_078 \
  yoink_queue_q_078 yoink_control_q_078 yoink_notify_q_078 \
  yoink_execute_q_078 yoink_retain_q_078 yoink_candidate_q_078 \
  yoink_dispatch_q_078 yoink_reconcile_q_078 yoink_witness_q_078 \
  yoink_delivery_q_078 yoink_catalog_q_078 yoink_resolution_q_078 \
  yoink_reference_q_078
```

Then independently inspect the role, function, forced-RLS tables, immutable
receipt, and full prerequisite fingerprint chain:

```bash
npm run postgres:signal-source-reference-refresh -- verify \
  yoink_cutover_qualification_078 yoink_q_078 yoink_session_q_078 \
  yoink_queue_q_078 yoink_control_q_078 yoink_notify_q_078 \
  yoink_execute_q_078 yoink_retain_q_078 yoink_candidate_q_078 \
  yoink_dispatch_q_078 yoink_reconcile_q_078 yoink_witness_q_078 \
  yoink_delivery_q_078 yoink_catalog_q_078 yoink_resolution_q_078 \
  yoink_reference_q_078
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. No login, principal mapping, membership, runtime
composition, downstream evaluation, inbox acknowledgement, or retailer-session
authority is created. SQLite remains authoritative and complete handler parity
remains six of seven.

## Terminal signal-decision apply qualification seam

Version 0.79 adds a fifth independent hosted-signal role for the early terminal
branches that follow the v0.78 source-reference step. It does not widen the
delivery, catalog-create, event-resolution, or reference-refresh roles. The new
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no object, belongs to no role,
has zero direct/effective table or column privileges, and can execute one strict
security-definer function across 11 forced-RLS tenant tables.

The Node adapter plans and applies within one `READ COMMITTED` read-write
transaction. PostgreSQL authenticates `session_user`, validates the exact
leased TrackaLacker inbox capability, invokes the v0.78 planner, and refuses to
continue until its source-reference outcome is mutation-free and settled. It
then locks the committed signal event, validates the unique committed
resolution and normalized offer evidence, derives the current SQLite terminal
outcome, and seals every claim in a principal-bound SHA-256 plan valid for at
most 30 seconds.

Four terminal cases are preserved:

- every test signal terminates as dry-run evidence;
- an ambiguous identity terminates as `ambiguous_identity`;
- an unresolved identity terminates as `unresolved_identity`; and
- a matched event whose event type or availability is not actionable
  terminates as `non_actionable_event`.

Each case atomically inserts one `signal_occurrences` row with no incident, one
notification-only `mission_decisions` row with no mission or strategy, one
`signal_decided` audit event, and one matching outbox event. A matched
actionable signal returns `continue_downstream` with zero writes. An exact
complete replay is mutation-free; any partial graph or changed stored semantics
aborts. The function has no SQL for shared catalog, source-reference, incident,
offer-observation, mission, strategy, notification, spend, action-job, or inbox-
lifecycle mutation. It returns IDs, outcome codes, hashes, flags, and counts,
never the raw signal payload, decision reason, or audit body.

Native PostgreSQL 16 proves exact row deltas and stored audit/outbox semantics,
all terminal outcomes, actionable zero-write continuation, prerequisite
ordering, invalid capability, cross-tenant, same-tenant/different-user,
unmapped-principal and direct-SQL denial, exactly one mutation under concurrent
calls, mutation-free replay, partial-graph rollback and recovery, clean
temporary membership removal, and immutable receipt rejection after function-
catalog tamper.

Plan without a database connection:

```bash
npm run postgres:signal-terminal-decision-apply -- plan \
  yoink_cutover_qualification_079 yoink_q_079 yoink_session_q_079 \
  yoink_queue_q_079 yoink_control_q_079 yoink_notify_q_079 \
  yoink_execute_q_079 yoink_retain_q_079 yoink_candidate_q_079 \
  yoink_dispatch_q_079 yoink_reconcile_q_079 yoink_witness_q_079 \
  yoink_delivery_q_079 yoink_catalog_q_079 yoink_resolution_q_079 \
  yoink_reference_q_079 yoink_terminal_q_079
```

After the exact v0.78 source-reference receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_TERMINAL_DECISION_APPLY_QUALIFICATION_ACK=bounded-signal-terminal-decision-apply-qualification \
  npm run postgres:signal-terminal-decision-apply -- apply \
  yoink_cutover_qualification_079 yoink_q_079 yoink_session_q_079 \
  yoink_queue_q_079 yoink_control_q_079 yoink_notify_q_079 \
  yoink_execute_q_079 yoink_retain_q_079 yoink_candidate_q_079 \
  yoink_dispatch_q_079 yoink_reconcile_q_079 yoink_witness_q_079 \
  yoink_delivery_q_079 yoink_catalog_q_079 yoink_resolution_q_079 \
  yoink_reference_q_079 yoink_terminal_q_079
```

Then independently inspect the role, function, forced-RLS tables, immutable
receipt, and full prerequisite fingerprint chain:

```bash
npm run postgres:signal-terminal-decision-apply -- verify \
  yoink_cutover_qualification_079 yoink_q_079 yoink_session_q_079 \
  yoink_queue_q_079 yoink_control_q_079 yoink_notify_q_079 \
  yoink_execute_q_079 yoink_retain_q_079 yoink_candidate_q_079 \
  yoink_dispatch_q_079 yoink_reconcile_q_079 yoink_witness_q_079 \
  yoink_delivery_q_079 yoink_catalog_q_079 yoink_resolution_q_079 \
  yoink_reference_q_079 yoink_terminal_q_079
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. No login, principal mapping, membership, runtime
composition, actionable signal evaluation, inbox acknowledgement, or retailer-
session authority is created. SQLite remains authoritative and complete
handler parity remains six of seven.

## Actionable offer/incident apply qualification seam

Version 0.80 adds a sixth independent hosted-signal role for the actionable
offer-observation, incident, and occurrence slice after the v0.79 terminal
step. It does not widen the delivery, catalog-create, event-resolution,
reference-refresh, or terminal-decision roles. The new `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role owns no object, belongs to no role, has zero direct/effective
table or column privileges, and can execute one strict security-definer
function across 14 forced-RLS tenant tables.

The Node adapter plans and applies within one `READ COMMITTED` read-write
transaction. PostgreSQL authenticates `session_user`, validates the exact
leased TrackaLacker inbox capability, invokes the v0.79 planner, and requires
its immutable outcome to be `continue_downstream`. It locks the message, exact
committed event, and tenant/user/semantic-key incident cohort, then seals every
claim in a principal-bound SHA-256 plan valid for at most 30 seconds.

The server derives the semantic key from listing, event type, normalized price,
currency, seller type/name, and offer fingerprint. It also derives opaque,
deterministic observation and occurrence IDs from the committed event and a
deterministic new-incident ID from the semantic key. The existing user dedupe
window must be between 30 and 3600 seconds. A new actionable event performs
exactly three statements: insert one `offer_observations` row, insert or update
one open `signal_incidents` row, and insert one linked `signal_occurrences` row.
A complete replay is mutation-free. Partial graphs, ID collisions, changed
offer evidence, inconsistent occurrence counts, or a changed predecessor abort
the transaction.

The function has no SQL for shared catalog, source-reference, terminal-
decision, mission, strategy, notification, spend, action-job, or inbox-
lifecycle mutation and returns no raw signal payload. Native PostgreSQL 16
proves exact inserted and corroborated row semantics, invalid capability,
cross-tenant, same-tenant/different-user, unmapped-principal and direct-SQL
denial, exactly one mutation under simultaneous calls, mutation-free replay,
partial-graph and changed-row recovery, clean temporary membership removal,
and immutable receipt rejection after function-catalog tamper.

Plan without a database connection:

```bash
npm run postgres:signal-offer-incident-apply -- plan \
  yoink_cutover_qualification_080 yoink_q_080 yoink_session_q_080 \
  yoink_queue_q_080 yoink_control_q_080 yoink_notify_q_080 \
  yoink_execute_q_080 yoink_retain_q_080 yoink_candidate_q_080 \
  yoink_dispatch_q_080 yoink_reconcile_q_080 yoink_witness_q_080 \
  yoink_delivery_q_080 yoink_catalog_q_080 yoink_resolution_q_080 \
  yoink_reference_q_080 yoink_terminal_q_080 yoink_offer_q_080
```

After the exact v0.79 terminal-decision receipt is verified, apply once with
the qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_OFFER_INCIDENT_APPLY_QUALIFICATION_ACK=bounded-signal-offer-incident-apply-qualification \
  npm run postgres:signal-offer-incident-apply -- apply \
  yoink_cutover_qualification_080 yoink_q_080 yoink_session_q_080 \
  yoink_queue_q_080 yoink_control_q_080 yoink_notify_q_080 \
  yoink_execute_q_080 yoink_retain_q_080 yoink_candidate_q_080 \
  yoink_dispatch_q_080 yoink_reconcile_q_080 yoink_witness_q_080 \
  yoink_delivery_q_080 yoink_catalog_q_080 yoink_resolution_q_080 \
  yoink_reference_q_080 yoink_terminal_q_080 yoink_offer_q_080
```

Then independently inspect the role, function, 14 forced-RLS tables, immutable
receipt, and full prerequisite fingerprint chain:

```bash
npm run postgres:signal-offer-incident-apply -- verify \
  yoink_cutover_qualification_080 yoink_q_080 yoink_session_q_080 \
  yoink_queue_q_080 yoink_control_q_080 yoink_notify_q_080 \
  yoink_execute_q_080 yoink_retain_q_080 yoink_candidate_q_080 \
  yoink_dispatch_q_080 yoink_reconcile_q_080 yoink_witness_q_080 \
  yoink_delivery_q_080 yoink_catalog_q_080 yoink_resolution_q_080 \
  yoink_reference_q_080 yoink_terminal_q_080 yoink_offer_q_080
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. No login, principal mapping, membership, runtime
composition, mission/policy/action evaluation, inbox acknowledgement, or
retailer-session authority is created. SQLite remains authoritative and
complete handler parity remains six of seven.

## Post-incident decision apply qualification seam

Version 0.81 adds a seventh independent hosted-signal role for the bounded
decision after the v0.80 actionable offer/incident graph has fully settled. It
does not widen any earlier role. The new `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS` role owns no application object, inherits no other role, has zero
direct/effective table or column privileges, and can execute one strict
security-definer function across 17 forced-RLS tenant tables.

The Node adapter plans and applies within one `READ COMMITTED` read-write
transaction. PostgreSQL authenticates `session_user`, validates the exact live
leased-inbox capability, locks the message, invokes the v0.80 planner, and
requires its immutable result to be `already_applied` with no pending writes.
It then revalidates the event, matched resolution, exact occurrence, open
incident, offer observation, source connection, mission context, and any
incident-bound action job. The resulting principal-bound SHA-256 plan is valid
for at most 30 seconds.

Only two terminal branches can mutate. `corroborated` requires exactly one
user-owned action job on the incident and an incident occurrence count of at
least two. `no_mission` requires no exact mission target and a source that is
not both `trusted_exact` and configured to create missions. Either branch
performs exactly three inserts: one notification-only mission decision, one
matching audit event, and one matching outbox event. Exact replay writes
nothing. Partial graphs, changed rows, ambiguous mission bindings, cross-user
jobs, or a changed predecessor abort the transaction.

When a trusted source still needs mission binding or creation, the routine
returns `continue_downstream` with `missionBindingRequired` and
`missionCreationRequired` but performs no mutation. The function has no SQL for
catalog, source-reference, terminal-decision, offer, incident, mission,
strategy, action-job, notification, spend, or inbox-lifecycle mutation and
returns no raw signal payload or decision reason.

Plan without a database connection:

```bash
npm run postgres:signal-post-incident-decision-apply -- plan \
  yoink_cutover_qualification_081 yoink_q_081 yoink_session_q_081 \
  yoink_queue_q_081 yoink_control_q_081 yoink_notify_q_081 \
  yoink_execute_q_081 yoink_retain_q_081 yoink_candidate_q_081 \
  yoink_dispatch_q_081 yoink_reconcile_q_081 yoink_witness_q_081 \
  yoink_delivery_q_081 yoink_catalog_q_081 yoink_resolution_q_081 \
  yoink_reference_q_081 yoink_terminal_q_081 yoink_offer_q_081 \
  yoink_post_q_081
```

After the exact v0.80 offer/incident receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_POST_INCIDENT_DECISION_APPLY_QUALIFICATION_ACK=bounded-signal-post-incident-decision-apply-qualification \
  npm run postgres:signal-post-incident-decision-apply -- apply \
  yoink_cutover_qualification_081 yoink_q_081 yoink_session_q_081 \
  yoink_queue_q_081 yoink_control_q_081 yoink_notify_q_081 \
  yoink_execute_q_081 yoink_retain_q_081 yoink_candidate_q_081 \
  yoink_dispatch_q_081 yoink_reconcile_q_081 yoink_witness_q_081 \
  yoink_delivery_q_081 yoink_catalog_q_081 yoink_resolution_q_081 \
  yoink_reference_q_081 yoink_terminal_q_081 yoink_offer_q_081 \
  yoink_post_q_081
```

Then independently inspect the role, function, 17 forced-RLS tables, immutable
receipt, and full prerequisite fingerprint chain:

```bash
npm run postgres:signal-post-incident-decision-apply -- verify \
  yoink_cutover_qualification_081 yoink_q_081 yoink_session_q_081 \
  yoink_queue_q_081 yoink_control_q_081 yoink_notify_q_081 \
  yoink_execute_q_081 yoink_retain_q_081 yoink_candidate_q_081 \
  yoink_dispatch_q_081 yoink_reconcile_q_081 yoink_witness_q_081 \
  yoink_delivery_q_081 yoink_catalog_q_081 yoink_resolution_q_081 \
  yoink_reference_q_081 yoink_terminal_q_081 yoink_offer_q_081 \
  yoink_post_q_081
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. Qualification creates no login or principal mapping
and grants no runtime authority. SQLite remains authoritative; mission
binding/creation, strategy/policy/action composition, final inbox completion,
and complete seven-of-seven handler parity remain open.

## Signal mission-binding qualification seam

Version 0.82 adds the eighth independent hosted-signal role for exact mission
binding after the v0.81 post-incident continuation.

The sub-boundary accepts only the exact
`continue_downstream` result from the settled v0.81 post-incident decision. A
new independent `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role receives zero direct
table or column privileges and execute permission on one strict
security-definer function. Eighteen tenant tables remain protected by forced
RLS. The function authenticates `session_user`, validates the current leased-
inbox capability, revalidates the entire predecessor chain, and serializes the
message and exact variant before producing a maximum-30-second sealed plan.

One unambiguous user-owned mission is reused. If none exists, the routine may
create a mission only when the source is `trusted_exact` and its policy allows
mission creation. It attaches all known listings for the exact variant, capped
at 10,000, and creates revision 1 of the append-only intent only when the
mission has no policy. The initial policy preserves the SQLite defaults:
the current mission quantity (one for a newly created mission), USD, no
implicit price cap, `add_to_cart`, exact-only substitution, strategy mode,
120-second observation freshness, no expiry or cooldown, and inherited per-
target policy. Mission and initial-policy creation append exact audit and
outbox receipts. The target-policy JSON byte sequence and its SHA-256 policy
hash are verified against the SQLite repository algorithm.

Plan without a database connection:

```bash
npm run postgres:signal-mission-binding-apply -- plan \
  yoink_cutover_qualification_082 yoink_q_082 yoink_session_q_082 \
  yoink_queue_q_082 yoink_control_q_082 yoink_notify_q_082 \
  yoink_execute_q_082 yoink_retain_q_082 yoink_candidate_q_082 \
  yoink_dispatch_q_082 yoink_reconcile_q_082 yoink_witness_q_082 \
  yoink_delivery_q_082 yoink_catalog_q_082 yoink_resolution_q_082 \
  yoink_reference_q_082 yoink_terminal_q_082 yoink_offer_q_082 \
  yoink_post_q_082 yoink_mission_q_082
```

After the exact v0.81 post-incident receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_MISSION_BINDING_APPLY_QUALIFICATION_ACK=bounded-signal-mission-binding-apply-qualification \
  npm run postgres:signal-mission-binding-apply -- apply \
  yoink_cutover_qualification_082 yoink_q_082 yoink_session_q_082 \
  yoink_queue_q_082 yoink_control_q_082 yoink_notify_q_082 \
  yoink_execute_q_082 yoink_retain_q_082 yoink_candidate_q_082 \
  yoink_dispatch_q_082 yoink_reconcile_q_082 yoink_witness_q_082 \
  yoink_delivery_q_082 yoink_catalog_q_082 yoink_resolution_q_082 \
  yoink_reference_q_082 yoink_terminal_q_082 yoink_offer_q_082 \
  yoink_post_q_082 yoink_mission_q_082
```

Then independently inspect the role, function, 18 forced-RLS tables, immutable
receipt, and complete prerequisite fingerprint chain:

```bash
npm run postgres:signal-mission-binding-apply -- verify \
  yoink_cutover_qualification_082 yoink_q_082 yoink_session_q_082 \
  yoink_queue_q_082 yoink_control_q_082 yoink_notify_q_082 \
  yoink_execute_q_082 yoink_retain_q_082 yoink_candidate_q_082 \
  yoink_dispatch_q_082 yoink_reconcile_q_082 yoink_witness_q_082 \
  yoink_delivery_q_082 yoink_catalog_q_082 yoink_resolution_q_082 \
  yoink_reference_q_082 yoink_terminal_q_082 yoink_offer_q_082 \
  yoink_post_q_082 yoink_mission_q_082
```

The receipt permanently records `runtimeAuthority: false` and
`productionReady: false`. Exactly five mutation tables are in scope. Shared
catalog, incident and terminal records, strategy evaluation, action jobs,
spend, notifications, inbox lifecycle, retailer sessions, checkout, and order
submission remain closed. Qualification creates no login or principal mapping;
SQLite remains authoritative and complete handler parity remains six of seven.

## Signal strategy/purchase-policy evaluation qualification seam

Version 0.83 adds the ninth independent hosted-signal role for the bounded
application-owned evaluation immediately after v0.82 mission binding.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function across 19 forced-RLS
tenant tables. Each plan authenticates `session_user`, proves the live leased-
inbox capability through the resolution predecessor, binds the exact settled
event/mission graph, and expires after 30 seconds. Message and canonical
event/mission advisory locks close same-message and cross-message races.

The application evaluator supplies a fingerprinted attestation over the exact
transport hash, listing, mission target and quantity, current immutable policy
revision/hash, full ordered strategy set, selected strategy, freshness, unit
cap, quantity, action, seller/fulfillment policy, and source restriction.
PostgreSQL revalidates current input snapshots on first application.
`matched` and `needs_price` write nothing. `unmatched`, `stale`, and
`quantity_limited` must be quantity-one, first-party, unknown-fulfillment,
notification-only results and atomically append exactly one mission decision,
audit event, and outbox event.

Immutable replay remains valid after a later policy/strategy revision and
after normal outbox delivery; it verifies the original attestation, exact IDs,
payloads, cross-links, and equal canonical creation timestamps while preserving
all delivery lifecycle fields. Partial graphs and changed immutable rows abort.

Plan without a database connection:

```bash
npm run postgres:signal-strategy-evaluation-apply -- plan \
  yoink_cutover_qualification_083 yoink_q_083 yoink_session_q_083 \
  yoink_queue_q_083 yoink_control_q_083 yoink_notify_q_083 \
  yoink_execute_q_083 yoink_retain_q_083 yoink_candidate_q_083 \
  yoink_dispatch_q_083 yoink_reconcile_q_083 yoink_witness_q_083 \
  yoink_delivery_q_083 yoink_catalog_q_083 yoink_resolution_q_083 \
  yoink_reference_q_083 yoink_terminal_q_083 yoink_offer_q_083 \
  yoink_post_q_083 yoink_mission_q_083 yoink_strategy_q_083
```

After the exact v0.82 mission-binding receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_QUALIFICATION_ACK=bounded-signal-strategy-evaluation-apply-qualification \
  npm run postgres:signal-strategy-evaluation-apply -- apply \
  yoink_cutover_qualification_083 yoink_q_083 yoink_session_q_083 \
  yoink_queue_q_083 yoink_control_q_083 yoink_notify_q_083 \
  yoink_execute_q_083 yoink_retain_q_083 yoink_candidate_q_083 \
  yoink_dispatch_q_083 yoink_reconcile_q_083 yoink_witness_q_083 \
  yoink_delivery_q_083 yoink_catalog_q_083 yoink_resolution_q_083 \
  yoink_reference_q_083 yoink_terminal_q_083 yoink_offer_q_083 \
  yoink_post_q_083 yoink_mission_q_083 yoink_strategy_q_083
```

Then independently verify the role, function, 19 forced-RLS tables, immutable
receipt, and complete predecessor fingerprint chain:

```bash
npm run postgres:signal-strategy-evaluation-apply -- verify \
  yoink_cutover_qualification_083 yoink_q_083 yoink_session_q_083 \
  yoink_queue_q_083 yoink_control_q_083 yoink_notify_q_083 \
  yoink_execute_q_083 yoink_retain_q_083 yoink_candidate_q_083 \
  yoink_dispatch_q_083 yoink_reconcile_q_083 yoink_witness_q_083 \
  yoink_delivery_q_083 yoink_catalog_q_083 yoink_resolution_q_083 \
  yoink_reference_q_083 yoink_terminal_q_083 yoink_offer_q_083 \
  yoink_post_q_083 yoink_mission_q_083 yoink_strategy_q_083
```

The receipt permanently records `databaseSemanticEvaluation: false`,
`evaluationAuthority: false`, `runtimeAuthority: false`, and
`productionReady: false`. The fingerprint is an application integrity binding,
not a keyed database authorization. Before activation, policy, strategy, and
source-trust writers must share fixed-order configuration locks (or equivalent
serializable/retry coordination). The v0.84 successor treats every effective
attestation field as untrusted and performs that atomic lock/re-read/rederive
step only for reviewed purchase intents. No action, spend, inbox, retailer-
session, checkout, or order-submission authority exists in this v0.83 role.

## Reviewed purchase-intent action/spend qualification seam

Version 0.84 adds the tenth independent hosted-signal role. It accepts only the
exact v0.83 actionable handoff for a directly reviewed `purchase_intent` and
atomically creates its bounded action-job and spend-reservation graph.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function across 19 forced-RLS
tenant tables. PostgreSQL authenticates `session_user`, verifies the complete
predecessor receipt chain, and takes fixed-order locks over the message,
mission, target, policy, application settings, source, retailer qualification,
and spend policy.

The transaction revalidates the exact active target, current policy and source
trust, remaining and fulfilled quantity, sibling claims, cooldown, current
retailer add-only qualification, and per-order/daily/monthly capacity. It
accepts only fresh first-party shipping evidence, quantity one,
`add_to_cart`, canonical attribution, and the exact reviewed unit/all-in caps.
A valid first application appends an offer/snapshot, action job and initial
event, active reservation and reserved ledger entry, qualified mission
decision, audit event, and outbox event across nine mutation tables. Complete
replay writes nothing; partial or altered graphs abort.

Plan without a database connection:

```bash
npm run postgres:signal-action-spend-apply -- plan \
  yoink_cutover_qualification_084 yoink_q_084 yoink_session_q_084 \
  yoink_queue_q_084 yoink_control_q_084 yoink_notify_q_084 \
  yoink_execute_q_084 yoink_retain_q_084 yoink_candidate_q_084 \
  yoink_dispatch_q_084 yoink_reconcile_q_084 yoink_witness_q_084 \
  yoink_delivery_q_084 yoink_catalog_q_084 yoink_resolution_q_084 \
  yoink_reference_q_084 yoink_terminal_q_084 yoink_offer_q_084 \
  yoink_post_q_084 yoink_mission_q_084 yoink_strategy_q_084 \
  yoink_writer_lock_q_085 \
  yoink_constraint_config_q_086 \
  yoink_action_spend_q_084
```

With the current v0.89 CLI, first apply and verify the shared writer-lock and
bounded constraint-configuration successors below. Then apply the action/spend
boundary once with the qualification connection and explicit acknowledgement;
the Target qualification/settings, source-trust, and non-Target retailer-
qualification successors are applied afterward as documented in their
dedicated sections:

```bash
YOINK_POSTGRES_SIGNAL_ACTION_SPEND_APPLY_QUALIFICATION_ACK=bounded-signal-action-spend-apply-qualification \
  npm run postgres:signal-action-spend-apply -- apply \
  yoink_cutover_qualification_084 yoink_q_084 yoink_session_q_084 \
  yoink_queue_q_084 yoink_control_q_084 yoink_notify_q_084 \
  yoink_execute_q_084 yoink_retain_q_084 yoink_candidate_q_084 \
  yoink_dispatch_q_084 yoink_reconcile_q_084 yoink_witness_q_084 \
  yoink_delivery_q_084 yoink_catalog_q_084 yoink_resolution_q_084 \
  yoink_reference_q_084 yoink_terminal_q_084 yoink_offer_q_084 \
  yoink_post_q_084 yoink_mission_q_084 yoink_strategy_q_084 \
  yoink_writer_lock_q_085 \
  yoink_constraint_config_q_086 \
  yoink_action_spend_q_084
```

Then independently verify the role, function, 19 forced-RLS tables, immutable
receipt, and complete predecessor fingerprint chain:

```bash
npm run postgres:signal-action-spend-apply -- verify \
  yoink_cutover_qualification_084 yoink_q_084 yoink_session_q_084 \
  yoink_queue_q_084 yoink_control_q_084 yoink_notify_q_084 \
  yoink_execute_q_084 yoink_retain_q_084 yoink_candidate_q_084 \
  yoink_dispatch_q_084 yoink_reconcile_q_084 yoink_witness_q_084 \
  yoink_delivery_q_084 yoink_catalog_q_084 yoink_resolution_q_084 \
  yoink_reference_q_084 yoink_terminal_q_084 yoink_offer_q_084 \
  yoink_post_q_084 yoink_mission_q_084 yoink_strategy_q_084 \
  yoink_writer_lock_q_085 \
  yoink_constraint_config_q_086 \
  yoink_action_spend_q_084
```

The receipt permanently records `purchaseIntentOnly: true`,
`strategyActionAuthority: false`, `writerLockProtocolParity: false`,
`attributionPolicyParity: false`, and `runtimeAuthority: false`. Marketplace,
pickup, retailer DOM mutation, checkout, order submission, and inbox completion
remain closed. The bounded pause/guardrail/spend-policy writer and complete
Target qualification/settings activation, bounded source-trust configuration,
and exact Walmart/Amazon/Best Buy qualification now join the fixed-order
locking protocol, but general source lifecycle, strategy, mission-policy, and
reservation writers must do the same. Attribution must
reach policy parity, and final handler composition
and production principal provisioning must be qualified before activation.
SQLite remains authoritative and complete handler parity remains six of seven.

## Shared signal-writer lock qualification seam

Version 0.85 adds the eleventh independent hosted-signal role. It is a
database-owned, lock-only coordination protocol for the five constraint
domains that can invalidate an action decision: source, retailer
qualification, settings, mission policy, and spend. The protocol fixes that
global order and lets a qualified consumer request a nonempty five-bit scope
mask; the v0.84 action/spend successor requests all five scopes with `11111`.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
has no mutation tables, and can execute one strict security-definer function
across seven forced-RLS tenant tables. PostgreSQL authenticates `session_user`,
requires the exact tenant/user identity, validates source and mission ownership
and retailer identity, and takes transaction-scoped advisory locks only in the
declared order. The returned receipt contains identifiers and lock metadata,
never configuration contents or credentials.

Plan without a database connection:

```bash
npm run postgres:signal-writer-lock-protocol -- plan \
  yoink_cutover_qualification_085 yoink_q_085 yoink_session_q_085 \
  yoink_queue_q_085 yoink_control_q_085 yoink_notify_q_085 \
  yoink_execute_q_085 yoink_retain_q_085 yoink_candidate_q_085 \
  yoink_dispatch_q_085 yoink_reconcile_q_085 yoink_witness_q_085 \
  yoink_delivery_q_085 yoink_catalog_q_085 yoink_resolution_q_085 \
  yoink_reference_q_085 yoink_terminal_q_085 yoink_offer_q_085 \
  yoink_post_q_085 yoink_mission_q_085 yoink_strategy_q_085 \
  yoink_writer_lock_q_085
```

After the exact v0.83 strategy-evaluation receipt is verified, apply once with
the qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_WRITER_LOCK_PROTOCOL_QUALIFICATION_ACK=bounded-signal-writer-lock-protocol-qualification \
  npm run postgres:signal-writer-lock-protocol -- apply \
  yoink_cutover_qualification_085 yoink_q_085 yoink_session_q_085 \
  yoink_queue_q_085 yoink_control_q_085 yoink_notify_q_085 \
  yoink_execute_q_085 yoink_retain_q_085 yoink_candidate_q_085 \
  yoink_dispatch_q_085 yoink_reconcile_q_085 yoink_witness_q_085 \
  yoink_delivery_q_085 yoink_catalog_q_085 yoink_resolution_q_085 \
  yoink_reference_q_085 yoink_terminal_q_085 yoink_offer_q_085 \
  yoink_post_q_085 yoink_mission_q_085 yoink_strategy_q_085 \
  yoink_writer_lock_q_085
```

Then independently verify the role, function, seven forced-RLS tables, zero
mutation tables, immutable receipt, and complete predecessor fingerprint chain:

```bash
npm run postgres:signal-writer-lock-protocol -- verify \
  yoink_cutover_qualification_085 yoink_q_085 yoink_session_q_085 \
  yoink_queue_q_085 yoink_control_q_085 yoink_notify_q_085 \
  yoink_execute_q_085 yoink_retain_q_085 yoink_candidate_q_085 \
  yoink_dispatch_q_085 yoink_reconcile_q_085 yoink_witness_q_085 \
  yoink_delivery_q_085 yoink_catalog_q_085 yoink_resolution_q_085 \
  yoink_reference_q_085 yoink_terminal_q_085 yoink_offer_q_085 \
  yoink_post_q_085 yoink_mission_q_085 yoink_strategy_q_085 \
  yoink_writer_lock_q_085
```

The receipt permanently records `lockOnly: true`,
`configurationWriterParity: false`, `reservationWriterParity: false`,
`writerLockProtocolParity: false`, and `runtimeAuthority: false`. The protocol
does not mutate configuration, reservations, actions, inbox state, retailer
sessions, checkout, or orders. The v0.86 pause/guardrail/spend-policy boundary
is the first configuration consumer, v0.87 adds the complete Target
qualification/settings consumer, v0.88 adds the bounded source-trust consumer,
and v0.89 adds exact Walmart/Amazon/Best Buy qualification. General source
lifecycle/status, strategy, mission-policy, and reservation writers must still use the same
scope contract before aggregate parity can become true. There are no runtime
principals and SQLite remains authoritative.

## Bounded constraint-configuration writer qualification seam

Version 0.86 adds the twelfth independent hosted-signal role. It ports exactly
three current user-facing safety operations: global action pause/resume,
guardrail settings, and periodic spend caps. It is not a general configuration
API and cannot mutate sources, retailer qualifications, mission policies,
strategies, reservations, actions, inbox state, retailer sessions, checkout,
or orders.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function across four forced-RLS
tables. PostgreSQL binds `session_user` to exactly one active tenant/user,
consumes the shared settings mask `00100` or spend mask `00001`, owns mutation
timestamps, and requires the expected settings timestamp or spend-policy
revision. Deterministic request identity binds the canonical JSON payload;
exact replay is mutation-free and altered replay aborts. A changed setting or
policy and its audit/outbox receipts commit or roll back together.

Plan without a database connection:

```bash
npm run postgres:signal-constraint-config-apply -- plan \
  yoink_cutover_qualification_086 yoink_q_086 yoink_session_q_086 \
  yoink_queue_q_086 yoink_control_q_086 yoink_notify_q_086 \
  yoink_execute_q_086 yoink_retain_q_086 yoink_candidate_q_086 \
  yoink_dispatch_q_086 yoink_reconcile_q_086 yoink_witness_q_086 \
  yoink_delivery_q_086 yoink_catalog_q_086 yoink_resolution_q_086 \
  yoink_reference_q_086 yoink_terminal_q_086 yoink_offer_q_086 \
  yoink_post_q_086 yoink_mission_q_086 yoink_strategy_q_086 \
  yoink_writer_lock_q_086 yoink_constraint_config_q_086
```

After the exact shared writer-lock receipt is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_CONSTRAINT_CONFIG_APPLY_QUALIFICATION_ACK=bounded-signal-constraint-config-apply-qualification \
  npm run postgres:signal-constraint-config-apply -- apply \
  yoink_cutover_qualification_086 yoink_q_086 yoink_session_q_086 \
  yoink_queue_q_086 yoink_control_q_086 yoink_notify_q_086 \
  yoink_execute_q_086 yoink_retain_q_086 yoink_candidate_q_086 \
  yoink_dispatch_q_086 yoink_reconcile_q_086 yoink_witness_q_086 \
  yoink_delivery_q_086 yoink_catalog_q_086 yoink_resolution_q_086 \
  yoink_reference_q_086 yoink_terminal_q_086 yoink_offer_q_086 \
  yoink_post_q_086 yoink_mission_q_086 yoink_strategy_q_086 \
  yoink_writer_lock_q_086 yoink_constraint_config_q_086
```

Then independently verify the role, function, four forced-RLS mutation tables,
immutable receipt, and complete predecessor fingerprint chain:

```bash
npm run postgres:signal-constraint-config-apply -- verify \
  yoink_cutover_qualification_086 yoink_q_086 yoink_session_q_086 \
  yoink_queue_q_086 yoink_control_q_086 yoink_notify_q_086 \
  yoink_execute_q_086 yoink_retain_q_086 yoink_candidate_q_086 \
  yoink_dispatch_q_086 yoink_reconcile_q_086 yoink_witness_q_086 \
  yoink_delivery_q_086 yoink_catalog_q_086 yoink_resolution_q_086 \
  yoink_reference_q_086 yoink_terminal_q_086 yoink_offer_q_086 \
  yoink_post_q_086 yoink_mission_q_086 yoink_strategy_q_086 \
  yoink_writer_lock_q_086 yoink_constraint_config_q_086
```

The receipt permanently records `settingsPauseWriterParity: true`,
`guardrailSettingsWriterParity: true`, `spendPolicyWriterParity: true`, and
`runtimeAuthority: false`. It also records the incomplete aggregate flags:
`settingsWriterParity: false`, `configurationWriterParity: false`,
`reservationWriterParity: false`, and `writerLockProtocolParity: false`.
Native PostgreSQL 16 proves forced late rollback, exact and altered replay,
server-bound principal isolation, zero direct SQL, an unchanged-policy
zero-write path, and real blocking between an uncommitted pause mutation and
the reviewed action/spend transaction. No runtime principal is provisioned and
SQLite remains authoritative.

## Target qualification/settings writer qualification seam

Version 0.87 adds the thirteenth independent hosted-signal role. It ports the
complete Target add-only activation transaction, not retailer DOM execution.
The operation can only qualify `target-add-v1`, set the current user's control
state to live and unpaused, promote already-created eligible Target shadow jobs,
and append the existing receipts. Walmart, Amazon, and Best Buy remain outside
this boundary because their SQLite activation also changes shared retailer and
listing capability rows that need a separately governed shared-catalog writer.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function over nine forced-RLS
tenant tables. The declared mutation set is exactly six tables. PostgreSQL
binds `session_user` to one active tenant/user and consumes the shared retailer-
qualification then settings mask `01100`.

Before the first mutation, PostgreSQL holds the evidence/trial append boundary
stable and recomputes the exact current 30-day Target qualification hash from
`target-observer-v1` observations and passed `target-add-v1` rehearsals. It
requires at least one Target-sold actionable observation, one shipping
actionable observation, two distinct TCINs, one passed no-click rehearsal, the
latest active companion's exact Target add-v1 capability, and the expected
settings timestamp. One transaction then upserts qualification, enables live
unpaused settings, promotes only unexpired `shadow_ready` first-party shipping
quantity-one add jobs, and appends deterministic action-event, audit, and
outbox rows. Exact replay is mutation-free and validates immutable promotion
events while tolerating ordinary outbox delivery lifecycle changes.

Plan without a database connection:

```bash
npm run postgres:signal-target-qualification-apply -- plan \
  yoink_cutover_qualification_087 yoink_q_087 yoink_session_q_087 \
  yoink_queue_q_087 yoink_control_q_087 yoink_notify_q_087 \
  yoink_execute_q_087 yoink_retain_q_087 yoink_candidate_q_087 \
  yoink_dispatch_q_087 yoink_reconcile_q_087 yoink_witness_q_087 \
  yoink_delivery_q_087 yoink_catalog_q_087 yoink_resolution_q_087 \
  yoink_reference_q_087 yoink_terminal_q_087 yoink_offer_q_087 \
  yoink_post_q_087 yoink_mission_q_087 yoink_strategy_q_087 \
  yoink_writer_lock_q_087 yoink_constraint_config_q_087 \
  yoink_action_spend_q_087 yoink_target_qual_q_087
```

After every predecessor receipt through action/spend is verified, apply once
with the qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_TARGET_QUALIFICATION_APPLY_QUALIFICATION_ACK=bounded-signal-target-qualification-apply-qualification \
  npm run postgres:signal-target-qualification-apply -- apply \
  yoink_cutover_qualification_087 yoink_q_087 yoink_session_q_087 \
  yoink_queue_q_087 yoink_control_q_087 yoink_notify_q_087 \
  yoink_execute_q_087 yoink_retain_q_087 yoink_candidate_q_087 \
  yoink_dispatch_q_087 yoink_reconcile_q_087 yoink_witness_q_087 \
  yoink_delivery_q_087 yoink_catalog_q_087 yoink_resolution_q_087 \
  yoink_reference_q_087 yoink_terminal_q_087 yoink_offer_q_087 \
  yoink_post_q_087 yoink_mission_q_087 yoink_strategy_q_087 \
  yoink_writer_lock_q_087 yoink_constraint_config_q_087 \
  yoink_action_spend_q_087 yoink_target_qual_q_087
```

Then independently verify the role, function, nine forced-RLS tables, six-table
mutation declaration, immutable receipt, and complete predecessor chain:

```bash
npm run postgres:signal-target-qualification-apply -- verify \
  yoink_cutover_qualification_087 yoink_q_087 yoink_session_q_087 \
  yoink_queue_q_087 yoink_control_q_087 yoink_notify_q_087 \
  yoink_execute_q_087 yoink_retain_q_087 yoink_candidate_q_087 \
  yoink_dispatch_q_087 yoink_reconcile_q_087 yoink_witness_q_087 \
  yoink_delivery_q_087 yoink_catalog_q_087 yoink_resolution_q_087 \
  yoink_reference_q_087 yoink_terminal_q_087 yoink_offer_q_087 \
  yoink_post_q_087 yoink_mission_q_087 yoink_strategy_q_087 \
  yoink_writer_lock_q_087 yoink_constraint_config_q_087 \
  yoink_action_spend_q_087 yoink_target_qual_q_087
```

The receipt permanently records `qualificationSettingsWriterParity: true` and
`targetJobPromotionParity: true`, while
`retailerQualificationWriterParity: false`, `configurationWriterParity: false`,
`reservationWriterParity: false`, `writerLockProtocolParity: false`, and
`runtimeAuthority: false` remain explicit. Native PostgreSQL 16 proves forced
late rollback and recovery, wrong/same-tenant-peer/unmapped principal denial,
zero direct SQL, exact evidence recomputation, one-job promotion, immutable
replay, altered-replay rejection, and real blocking between an uncommitted
Target activation and the bounded settings writer. SQLite remains authoritative.

## Source-trust writer qualification seam

Version 0.88 adds the fourteenth independent hosted-signal role. It ports one
explicit trust configuration for an existing private user-owned source; it is
not a source enrollment, credential, delivery-status, or connector-lifecycle
writer. The operation accepts only `informational` or `trusted_exact`, and
`informational` is structurally incompatible with auto-mission creation.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function over three forced-RLS
tenant tables. Its mutation declaration is exactly `source_connections`,
`audit_events`, and `outbox_events`. PostgreSQL binds `session_user` to one
active tenant/user and consumes only the shared source mask `10000`.

Before mutation, the database revalidates exact ownership, private scope, the
current trust/auto-mission invariant, the expected `updated_at`, and the
explicit `CONFIGURE_SOURCE_TRUST_V1` confirmation. PostgreSQL owns a monotonic
next timestamp and atomically updates the source plus deterministic audit and
outbox receipts. Exact replay writes nothing and tolerates ordinary outbox
delivery lifecycle changes; partial graphs, altered payloads, invalid
trust/auto-mission combinations, and stale revisions fail closed.

Plan without a database connection:

```bash
npm run postgres:signal-source-trust-apply -- plan \
  yoink_cutover_qualification_088 yoink_q_088 yoink_session_q_088 \
  yoink_queue_q_088 yoink_control_q_088 yoink_notify_q_088 \
  yoink_execute_q_088 yoink_retain_q_088 yoink_candidate_q_088 \
  yoink_dispatch_q_088 yoink_reconcile_q_088 yoink_witness_q_088 \
  yoink_delivery_q_088 yoink_catalog_q_088 yoink_resolution_q_088 \
  yoink_reference_q_088 yoink_terminal_q_088 yoink_offer_q_088 \
  yoink_post_q_088 yoink_mission_q_088 yoink_strategy_q_088 \
  yoink_writer_lock_q_088 yoink_constraint_config_q_088 \
  yoink_action_spend_q_088 yoink_target_qual_q_088 \
  yoink_source_trust_q_088
```

After every predecessor through Target qualification/settings is verified,
apply once with the qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_SOURCE_TRUST_APPLY_QUALIFICATION_ACK=bounded-signal-source-trust-apply-qualification \
  npm run postgres:signal-source-trust-apply -- apply \
  yoink_cutover_qualification_088 yoink_q_088 yoink_session_q_088 \
  yoink_queue_q_088 yoink_control_q_088 yoink_notify_q_088 \
  yoink_execute_q_088 yoink_retain_q_088 yoink_candidate_q_088 \
  yoink_dispatch_q_088 yoink_reconcile_q_088 yoink_witness_q_088 \
  yoink_delivery_q_088 yoink_catalog_q_088 yoink_resolution_q_088 \
  yoink_reference_q_088 yoink_terminal_q_088 yoink_offer_q_088 \
  yoink_post_q_088 yoink_mission_q_088 yoink_strategy_q_088 \
  yoink_writer_lock_q_088 yoink_constraint_config_q_088 \
  yoink_action_spend_q_088 yoink_target_qual_q_088 \
  yoink_source_trust_q_088
```

Then independently verify the role, function, three forced-RLS/mutation
tables, immutable receipt, and complete predecessor chain:

```bash
npm run postgres:signal-source-trust-apply -- verify \
  yoink_cutover_qualification_088 yoink_q_088 yoink_session_q_088 \
  yoink_queue_q_088 yoink_control_q_088 yoink_notify_q_088 \
  yoink_execute_q_088 yoink_retain_q_088 yoink_candidate_q_088 \
  yoink_dispatch_q_088 yoink_reconcile_q_088 yoink_witness_q_088 \
  yoink_delivery_q_088 yoink_catalog_q_088 yoink_resolution_q_088 \
  yoink_reference_q_088 yoink_terminal_q_088 yoink_offer_q_088 \
  yoink_post_q_088 yoink_mission_q_088 yoink_strategy_q_088 \
  yoink_writer_lock_q_088 yoink_constraint_config_q_088 \
  yoink_action_spend_q_088 yoink_target_qual_q_088 \
  yoink_source_trust_q_088
```

The receipt permanently records `sourceTrustWriterParity: true`, while
`sourceWriterParity: false`, `retailerQualificationWriterParity: false`,
`configurationWriterParity: false`, `reservationWriterParity: false`,
`writerLockProtocolParity: false`, and `runtimeAuthority: false` remain
explicit. Native PostgreSQL 16 proves forced late rollback, wrong,
same-tenant-peer, and unmapped principal denial, zero direct SQL, invariant and
stale-revision rejection, immutable replay, and real contention between an
uncommitted source writer and an independent shared-lock consumer. General
source lifecycle/status and SQLite authority remain unchanged.

## Walmart, Amazon, and Best Buy qualification writer seam

Version 0.89 adds the fifteenth independent hosted-signal role. It ports only
the three packaged `activate_walmart_add`, `activate_amazon_add`, and
`activate_bestbuy_add` operations. It cannot execute retailer DOM actions,
configure arbitrary retailers, insert listings, disable or retire catalog
state, change checkout, or submit an order.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function. The receipt seals nine
forced-RLS tenant tables, five tenant mutation tables, two protected shared
catalog tables (`retailers` and `listings`), and a seven-table total mutation
set. PostgreSQL binds `session_user` to one active tenant/user, consumes the
retailer-qualification then settings mask `01100`, and takes a transaction-
scoped global advisory lock for the exact retailer.

Before mutation, PostgreSQL verifies the fixed retailer ID, display name, and
domain; exact current observer/adapter/confirmation tuple; current 30-day
evidence hash; at least two distinct SKUs; first-party actionable and shipping
coverage; one passed no-click rehearsal; and the newest active companion's
exact adapter capability. Amazon additionally requires a current ephemeral
offer route. One transaction upserts the user qualification, changes only
`execution_supported = 0` rows for the exact retailer and its existing
listings to `1`, conditionally promotes eligible unexpired first-party shipping
quantity-one shadow jobs when actions are already live and unpaused, and
appends deterministic action, audit, and outbox receipts. Exact replay is
mutation-free and validates the immutable graph.

Plan without a database connection:

```bash
npm run postgres:signal-retailer-qualification-apply -- plan \
  yoink_cutover_qualification_089 yoink_q_089 yoink_session_q_089 \
  yoink_queue_q_089 yoink_control_q_089 yoink_notify_q_089 \
  yoink_execute_q_089 yoink_retain_q_089 yoink_candidate_q_089 \
  yoink_dispatch_q_089 yoink_reconcile_q_089 yoink_witness_q_089 \
  yoink_delivery_q_089 yoink_catalog_q_089 yoink_resolution_q_089 \
  yoink_reference_q_089 yoink_terminal_q_089 yoink_offer_q_089 \
  yoink_post_q_089 yoink_mission_q_089 yoink_strategy_q_089 \
  yoink_writer_lock_q_089 yoink_constraint_config_q_089 \
  yoink_action_spend_q_089 yoink_target_qual_q_089 \
  yoink_source_trust_q_089 yoink_retailer_qual_q_089
```

After every predecessor through source trust is verified, apply once with the
qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_RETAILER_QUALIFICATION_APPLY_QUALIFICATION_ACK=bounded-signal-retailer-qualification-apply-qualification \
  npm run postgres:signal-retailer-qualification-apply -- apply \
  yoink_cutover_qualification_089 yoink_q_089 yoink_session_q_089 \
  yoink_queue_q_089 yoink_control_q_089 yoink_notify_q_089 \
  yoink_execute_q_089 yoink_retain_q_089 yoink_candidate_q_089 \
  yoink_dispatch_q_089 yoink_reconcile_q_089 yoink_witness_q_089 \
  yoink_delivery_q_089 yoink_catalog_q_089 yoink_resolution_q_089 \
  yoink_reference_q_089 yoink_terminal_q_089 yoink_offer_q_089 \
  yoink_post_q_089 yoink_mission_q_089 yoink_strategy_q_089 \
  yoink_writer_lock_q_089 yoink_constraint_config_q_089 \
  yoink_action_spend_q_089 yoink_target_qual_q_089 \
  yoink_source_trust_q_089 yoink_retailer_qual_q_089
```

Then independently verify the role, function, tenant/shared table sets,
immutable receipt, exact grants, and complete predecessor chain:

```bash
npm run postgres:signal-retailer-qualification-apply -- verify \
  yoink_cutover_qualification_089 yoink_q_089 yoink_session_q_089 \
  yoink_queue_q_089 yoink_control_q_089 yoink_notify_q_089 \
  yoink_execute_q_089 yoink_retain_q_089 yoink_candidate_q_089 \
  yoink_dispatch_q_089 yoink_reconcile_q_089 yoink_witness_q_089 \
  yoink_delivery_q_089 yoink_catalog_q_089 yoink_resolution_q_089 \
  yoink_reference_q_089 yoink_terminal_q_089 yoink_offer_q_089 \
  yoink_post_q_089 yoink_mission_q_089 yoink_strategy_q_089 \
  yoink_writer_lock_q_089 yoink_constraint_config_q_089 \
  yoink_action_spend_q_089 yoink_target_qual_q_089 \
  yoink_source_trust_q_089 yoink_retailer_qual_q_089
```

The receipt permanently records `nonTargetQualificationWriterParity: true`,
`sharedCatalogExecutionWriterParity: true`,
`retailerQualificationWriterParity: true`, and `runtimeAuthority: false`.
Native PostgreSQL 16 proves forced late rollback across tenant and shared
state, wrong/same-tenant-peer/unmapped principal denial, zero direct SQL,
exact and altered replay, settings-writer and retailer-global contention,
shared-retailer identity tamper rejection, Amazon offer-route validation,
bounded job promotion, and all three operations. General source lifecycle,
mission-policy, reservations, production principals, and the SQLite authority
switch remain closed.

## Mission-policy revision writer seam

Version 0.90 adds the sixteenth independent hosted-signal role. It ports only
one full `revise_mission_policy` replacement and cannot change mission
lifecycle, targets, listings, settings, sources, spend reservations, actions,
checkout, or orders.

The new `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role owns no application object,
inherits no role, receives zero direct/effective table or column privileges,
and can execute one strict security-definer function. The receipt seals six
forced-RLS tenant tables, exactly three mutation tables
(`mission_intent_revisions`, `audit_events`, and `outbox_events`), and one
read-only shared catalog table (`listings`). PostgreSQL binds `session_user` to
one active tenant/user and consumes the settings then mission-policy mask
`00110`.

The request must contain the exact mission ID, current revision and
`intent-policy-v2` hash, a complete bounded preference replacement, and the
`REVISE_MISSION_POLICY_V1` confirmation. PostgreSQL locks and revalidates the
mission, complete ordered target/listing graph, variant and USD identity,
current tax, and store allowances, then reconstructs byte-identical target JSON
and policy hashing. Direct `purchase_intent` + `add_to_cart` preferences also
require at least one enabled execution-supported first-party shipping target,
a reviewed unit-price cap, and an all-in cap sufficient for quantity, tax, and
the current store allowance.

A changed policy appends exactly one revision and one deterministic
audit/outbox pair. An unchanged policy is a true zero-write success. Exact
replay writes nothing and validates the immutable stored graph; an altered or
partial replay fails closed. Strategy-mode preferences do not authorize
strategy actions.

Plan without a database connection:

```bash
npm run postgres:signal-mission-policy-apply -- plan \
  yoink_cutover_qualification_090 yoink_q_090 yoink_session_q_090 \
  yoink_queue_q_090 yoink_control_q_090 yoink_notify_q_090 \
  yoink_execute_q_090 yoink_retain_q_090 yoink_candidate_q_090 \
  yoink_dispatch_q_090 yoink_reconcile_q_090 yoink_witness_q_090 \
  yoink_delivery_q_090 yoink_catalog_q_090 yoink_resolution_q_090 \
  yoink_reference_q_090 yoink_terminal_q_090 yoink_offer_q_090 \
  yoink_post_q_090 yoink_mission_q_090 yoink_strategy_q_090 \
  yoink_writer_lock_q_090 yoink_constraint_config_q_090 \
  yoink_action_spend_q_090 yoink_target_qual_q_090 \
  yoink_source_trust_q_090 yoink_retailer_qual_q_090 \
  yoink_mission_policy_q_090
```

After every predecessor through non-Target retailer qualification is verified,
apply once with the qualification connection and explicit acknowledgement:

```bash
YOINK_POSTGRES_SIGNAL_MISSION_POLICY_APPLY_QUALIFICATION_ACK=bounded-signal-mission-policy-apply-qualification \
  npm run postgres:signal-mission-policy-apply -- apply \
  yoink_cutover_qualification_090 yoink_q_090 yoink_session_q_090 \
  yoink_queue_q_090 yoink_control_q_090 yoink_notify_q_090 \
  yoink_execute_q_090 yoink_retain_q_090 yoink_candidate_q_090 \
  yoink_dispatch_q_090 yoink_reconcile_q_090 yoink_witness_q_090 \
  yoink_delivery_q_090 yoink_catalog_q_090 yoink_resolution_q_090 \
  yoink_reference_q_090 yoink_terminal_q_090 yoink_offer_q_090 \
  yoink_post_q_090 yoink_mission_q_090 yoink_strategy_q_090 \
  yoink_writer_lock_q_090 yoink_constraint_config_q_090 \
  yoink_action_spend_q_090 yoink_target_qual_q_090 \
  yoink_source_trust_q_090 yoink_retailer_qual_q_090 \
  yoink_mission_policy_q_090
```

Then independently verify the role, routine, protected/mutation table sets,
immutable receipt, exact grants, and complete predecessor chain:

```bash
npm run postgres:signal-mission-policy-apply -- verify \
  yoink_cutover_qualification_090 yoink_q_090 yoink_session_q_090 \
  yoink_queue_q_090 yoink_control_q_090 yoink_notify_q_090 \
  yoink_execute_q_090 yoink_retain_q_090 yoink_candidate_q_090 \
  yoink_dispatch_q_090 yoink_reconcile_q_090 yoink_witness_q_090 \
  yoink_delivery_q_090 yoink_catalog_q_090 yoink_resolution_q_090 \
  yoink_reference_q_090 yoink_terminal_q_090 yoink_offer_q_090 \
  yoink_post_q_090 yoink_mission_q_090 yoink_strategy_q_090 \
  yoink_writer_lock_q_090 yoink_constraint_config_q_090 \
  yoink_action_spend_q_090 yoink_target_qual_q_090 \
  yoink_source_trust_q_090 yoink_retailer_qual_q_090 \
  yoink_mission_policy_q_090
```

The receipt permanently records `missionPolicyWriterParity: true`, while
`sourceWriterParity: false`, `configurationWriterParity: false`,
`reservationWriterParity: false`, `writerLockProtocolParity: false`, and
`runtimeAuthority: false` remain explicit. Native PostgreSQL 16 proves forced
late rollback, wrong/same-tenant-peer/unmapped denial, zero direct and cross-
boundary SQL, stale revision/hash denial, unsafe direct-purchase rejection,
byte-identical hashing, exact/altered replay, zero-write unchanged requests,
settings/mission contention, catalog tamper rejection, and zero action
creation. General source lifecycle/status, reservations, production principals,
and the SQLite authority switch remain closed.

## Requirements

- A private PostgreSQL 15+ database reachable only from the operator host.
- A qualification role with `CREATE` on the database and temporary
  superuser/`BYPASSRLS` authority. Do not use this role for the future API or
  worker runtime.
- TLS with server certificate verification. A no-TLS exception exists only for
  an exact loopback host used in local development.
- A quiesced Yoink SQLite source, including stopped API, worker, companion
  ingress, and signal delivery.
- A private `0700` working directory and an archive created with mode `0600`.

Inject the PostgreSQL URI with the deployment secret mechanism. Do not place it
in source control, process arguments, screenshots, support tickets, or shell
history. The CLI never prints the URI.

## Configuration

```text
YOINK_POSTGRES_URL=postgresql://qualification_role@db.example/yoink
YOINK_POSTGRES_TLS_MODE=verify-full
YOINK_POSTGRES_CA_FILE=/private/path/to/ca.pem  # optional private CA
```

`verify-full` is the default. URI parameters such as `sslmode`, `sslcert`,
`sslkey`, and `sslrootcert` are rejected so transport policy cannot be hidden
inside a connection string.

For a disposable loopback PostgreSQL only:

```text
YOINK_POSTGRES_TLS_MODE=local-insecure
```

That exception rejects every non-loopback hostname.

## Offline qualification procedure

1. Pause actions and external ingress. Stop the standalone worker, then stop
   the API. Retain the SQLite database and its WAL/SHM files as one recovery
   set.
2. Export and independently verify an archive:

   ```bash
   npm run portability -- export /private/yoink.sqlite /private/yoink-cutover.yoink.ndjson
   npm run portability -- verify /private/yoink-cutover.yoink.ndjson
   ```

3. Run the server and role preflight:

   ```bash
   npm run postgres:cutover -- preflight
   ```

   Require `serverVersionSupported`, `rowSecurityAvailable`,
   `skipLockedAvailable`, and `cutoverRoleBypassesRls` to be `true`.
   `productionReady` is deliberately always `false` in this tool.

4. Choose a new private schema name. Confirm the source remains quiesced, then
   perform the acknowledged one-shot import:

   ```bash
   YOINK_POSTGRES_CUTOVER_ACK=offline-one-shot \
     npm run postgres:cutover -- import \
     /private/yoink-cutover.yoink.ndjson yoink_cutover_qualification
   ```

5. Require `matched: true`, equal archive/database data SHA-256 values, a
   `verified` receipt, and both authority flags to remain `false`.
6. Re-run reconciliation in a new serializable transaction:

   ```bash
   npm run postgres:cutover -- verify \
     /private/yoink-cutover.yoink.ndjson yoink_cutover_qualification
   ```

7. Preserve the archive, CLI receipts, schema-manifest fingerprint, application
   release, and PostgreSQL version together as qualification evidence. Restart
   the existing SQLite deployment only; do not point Yoink at the qualification
   schema.

The import acknowledgement does not authorize a production cutover. It only
confirms that the operator intentionally requested an offline, one-shot load.

## Failure and recovery behavior

- Archive/schema mismatch, hash corruption, unsupported defaults/checks/
  triggers, target reuse, server-version failure, or failed reconciliation
  exits nonzero with a bounded error category.
- A failed import leaves no partially created target schema because schema,
  data, invariants, reconciliation, RLS, triggers, and receipt share one
  transaction.
- A successful qualification schema is inert. Retain it for inspection or
  remove it later through the database operator's separately reviewed change
  process.
- Never recover by importing into the same schema again, weakening RLS,
  changing receipt authority flags, or writing both SQLite and PostgreSQL.
  Generate a new archive and use a new schema.

## Remaining production gates

The admin Operations projection lists these as required, not complete:

- port the remaining source-lifecycle and reservation writers through the shared fixed-
  order protocol (global pause, guardrails, spend-policy caps, complete Target
  qualification/settings activation, bounded source trust, and exact Walmart/
  Amazon/Best Buy qualification plus full mission-policy revision are already
  qualified);
  add attribution-policy parity and separately qualified strategy-action
  semantics; then compose the qualified purchase-intent action/spend,
  strategy/purchase-policy evaluation, hosted-delivery recovery, fixed signal-
  inbox lifecycle, resolution plan, catalog-create, event/resolution-commit,
  source-reference-refresh, terminal-decision, actionable offer/incident,
  post-incident decision, and mission-binding boundaries with final inbox
  completion to finish the seventh handler. Every API request-repository
  family also remains to be ported;
- production identity-to-login provisioning and activation of the qualified
  tenant/control roles, remaining writer families, and governed semantics for
  mixed source-less offers; all qualified
  roles remain inactive;
- deployed multi-process worker isolation, task-handler idempotent replay,
  sustained load, connection-failure, failover, and outage drills;
- encrypted backups, PITR, restore/reconcile drills, and rollback evidence;
- production TLS ingress, IdP/device risk, workload identity, managed secrets,
  monitoring, paging, and signed deployment artifacts; and
- a controlled quiesce/import/verify/authority-switch exercise where no
  production request depends on SQLite afterward.

Until every gate passes, `activeStorageEngine` remains `sqlite`, dual write is
unsupported, and the PostgreSQL capability reports `productionReady: false`.
