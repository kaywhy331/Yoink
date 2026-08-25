# PostgreSQL cutover qualification

Yoink 0.63 extends the offline, one-shot PostgreSQL qualification path. It proves
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
PostgreSQL process any retailer-session capability. The task handlers still use
SQLite repositories. The emulated real-semantics suite continues to prove the
complete store state machine; the separate native suite now proves the
contention-critical path across independent server sessions.

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
execute task handlers, measure production load/outage behavior, or establish
runtime authority.

## Restricted read-role qualification seam

Version 0.58 derives five fresh group roles from the exact contract-v2 schema
manifest. They are qualification artifacts, not production principals:

| Role class | Exact portable tables | Boundary |
| --- | ---: | --- |
| Tenant reader | 82 | 68 direct, 13 inherited, and one mixed table under forced RLS; source-less mixed offers remain hidden |
| Shared-catalog reader | 6 | Shared catalog only; no tenant or mixed-offer access |
| Authorization-catalog reader | 3 | Packaged authorization definitions only |
| Deployment-control reader | 2 | Worker deployment control only |
| Tenant-registry reader | 1 | Tenant registry only; no private user rows |

All five roles are `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEROLE`,
`NOCREATEDB`, `NOREPLICATION`, and `NOBYPASSRLS`. They receive schema `USAGE`
and exact table `SELECT` only. The qualifier revokes public access in the
private schema and verifies exact table grants, rejects extra column grants,
routine/sequence access, object ownership, memberships, schema `CREATE`, or an
unsafe role attribute. `signal_incidents` remains unresolved and receives no
grant. The two cutover-control receipt tables also receive no runtime grant.

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
fleet status, and stopping remain separate control gates.

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
`NOBYPASSRLS`. It receives schema `USAGE` and `SELECT` on the 82 tenant-RLS
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

Principal enumeration, deployment status, and worker stopping still use the
qualification/control connection. Those control operations need their own
least-privilege contract before runtime use.

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

- PostgreSQL implementations for task handlers and every API repository;
- production identity-to-login provisioning, least-privilege principal/
  deployment control, atomic attestation plus tenant queue writes, remaining
  writer families, and governed semantics for mixed source-less offers and the
  unresolved incident table; all qualified roles remain inactive;
- deployed multi-process worker isolation, task-handler idempotent replay,
  sustained load, connection-failure, failover, and outage drills;
- encrypted backups, PITR, restore/reconcile drills, and rollback evidence;
- production TLS ingress, IdP/device risk, workload identity, managed secrets,
  monitoring, paging, and signed deployment artifacts; and
- a controlled quiesce/import/verify/authority-switch exercise where no
  production request depends on SQLite afterward.

Until every gate passes, `activeStorageEngine` remains `sqlite`, dual write is
unsupported, and the PostgreSQL capability reports `productionReady: false`.
