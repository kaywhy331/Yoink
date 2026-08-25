# PostgreSQL cutover qualification

Yoink 0.56 adds an offline, one-shot PostgreSQL qualification path. It proves
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
- enables and forces default-deny row-level security on every table with a
  direct `tenant_id`; and
- records `runtime_authority = false` and `cutover_ready = false` in a receipt
  whose constraints prevent either value from becoming true.

The importer re-verifies the file after streaming, so a file changed between
the initial check and the final row does not produce a committed schema. A
failed import rolls back the new schema and receipt atomically.

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

- async PostgreSQL implementations for every API and worker repository;
- RLS/ownership policies for tables whose tenant scope is inherited through a
  foreign-key path, plus explicit classification of shared/global tables;
- independent runtime roles without superuser or `BYPASSRLS`;
- real multi-connection `SKIP LOCKED` lease contention, idempotent replay,
  isolation, load, and outage drills;
- encrypted backups, PITR, restore/reconcile drills, and rollback evidence;
- production TLS ingress, IdP/device risk, workload identity, managed secrets,
  monitoring, paging, and signed deployment artifacts; and
- a controlled quiesce/import/verify/authority-switch exercise where no
  production request depends on SQLite afterward.

Until every gate passes, `activeStorageEngine` remains `sqlite`, dual write is
unsupported, and the PostgreSQL capability reports `productionReady: false`.
