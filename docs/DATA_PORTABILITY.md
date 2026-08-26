# Data portability and recovery drill

Yoink 0.14 provides a streaming, deterministic portability archive for an
operator-controlled SQLite database. Yoink 0.56 added an offline PostgreSQL
qualification importer that consumes the same contract, creates a new private
schema atomically, and reconciles every table exactly. Yoink 0.57 completes the
tenant-ownership policy manifest and adds the qualification-only PostgreSQL
worker-store port. Yoink 0.58 adds five inactive exact read-role templates and
live-catalog drift verification. Yoink 0.59 adds a native PostgreSQL 16
three-session worker-lease contention proof. Yoink 0.60 adds an inert
server-bound, read-only tenant-session qualification with an empty principal
registry and restrictive policies over all 82 tenant tables. Yoink 0.61 adds an
inactive server-bound queue writer with 11 exact operations on four tables,
four restrictive policies, no delete access, and native two-principal write
isolation. Yoink 0.62 advances that boundary to contract v2 with the one strict
immutable JSON constraint helper required by task inserts and runs the actual
tenant queue repository through two restricted native pools. Yoink 0.63 advances
to contract v3 with one `SELECT`-only grant on the singleton deployment
expectation and makes new-work schedule/enqueue/lease attestation plus queue SQL
one transaction. Yoink 0.64 adds an inactive, separately receipted
three-table/19-column-grant control role and routes principal pagination, fleet
status, and worker stopping through its native qualification adapter. Yoink
0.65 adds a zero-direct-grant, function-only qualification role for the first
handler family, notification recovery. The runtime API and worker remain
SQLite-backed, the other six handlers remain SQLite-only, and all
PostgreSQL roles remain inactive.

This is an offline operator interface. Yoink deliberately exposes no HTTP route
that downloads a database archive.

## What the archive contains

The `yoink-portability-ndjson-v1` format contains:

- the exact ordered migration ledger and stored-column schema;
- every application-table row, ordered by stable primary key;
- exact tagged encodings for SQLite integers and blobs;
- a SHA-256 digest and row count for every table;
- an aggregate logical-data digest independent of export time; and
- a SHA-256 digest of the complete archive file reported by the CLI.

Rows are streamed rather than accumulated as one in-memory JSON object, so the
number of catalog items, observations, missions, or receipts has no archive
item-count cap. One encoded row is limited to 16 MiB so a corrupt local file
cannot force unbounded line buffering.

The archive includes private application state: missions, source metadata,
hashed device credentials, authorization state, evidence, and audit history.
It is created with mode `0600` and must remain in a private `0700` directory.
It is not encrypted. Its hashes detect corruption and unintended differences;
they are not a signature against an attacker who can rewrite the archive and
its hashes. Use operator-managed encrypted storage and authenticated checksums
for off-host retention.

The observer-recipe Ed25519 key files are outside SQLite and are not included.
Back up `data/observer-recipe-ed25519-private.pem` separately with mode `0600`
and its public-key companion with the deployment configuration and secrets.

## Commands

The CLI builds the current typed database module before each operation:

```bash
npm run portability -- export <source.sqlite> <archive.yoink.ndjson>
npm run portability -- verify <archive.yoink.ndjson>
npm run portability -- compare <source.sqlite> <archive.yoink.ndjson>
npm run portability -- restore <archive.yoink.ndjson> <new.sqlite>
npm run portability -- drill <source.sqlite> <archive.yoink.ndjson> <new.sqlite>
```

`export` opens the source database read-only, takes one consistent SQLite read
transaction, refuses to overwrite an existing archive, and reports both data
and file hashes. `verify` streams the archive and independently recomputes all
counts and hashes. `compare` identifies every table that changed relative to an
archive and exits nonzero on a mismatch.

`restore` accepts only the exact migration ledger and table schema supported by
the running Yoink build. It refuses an existing database or SQLite sidecar,
loads into a newly created database, checks foreign keys and SQLite integrity,
and then requires exact table/data parity. Any failed fresh restore is removed;
an existing target is never modified or cleaned up.

`drill` performs export, verification, fresh restore, and a second comparison
against the source. Stop Yoink and all ingress/worker processes first. A running
companion heartbeat or other legitimate write between export and comparison
correctly makes the drill fail its `sourceStillMatchesArchive` check.

Do not start the restored database alongside the source. It deliberately
contains the same paired-device hashes, pending work, and mutation
qualification state. A restore is inert until an operator explicitly replaces
the source during a controlled recovery.

## Recovery and cutover procedure

1. Pause external ingress and workers, stop Yoink cleanly, and retain the
   existing SQLite file plus WAL/SHM sidecars as the binary recovery set.
2. Run `drill` into new explicit archive and database paths on the same secured
   filesystem.
3. Require `archiveVerified`, `restoreMatched`, and
   `sourceStillMatchesArchive` to all be `true`; record the reported data and
   file SHA-256 values.
4. Open the restored database read-only or in an isolated non-executing
   environment and perform the application smoke checks appropriate to the
   release.
5. For a SQLite recovery, replace the source only in a separate, reversible
   maintenance action and retain the old source read-only until post-startup
   reconciliation passes.

The PostgreSQL qualification importer now proves a one-shot, bounded load,
primary/not-null/foreign-key/index/default/check/trigger translation, complete
table-scope classification, direct and inherited tenant RLS, mixed-source
fail-closed behavior, tamper closure, and the same canonical table/data
reconciliation. A qualification-only asynchronous worker store also exercises
the queue state machine on that inert schema. The native qualification suite
uses two independent production-driver worker pools plus a third lock-holder
session to prove `SKIP LOCKED` distribution, an exact-one-winner race, and
one-use completion capabilities.
The optional role qualifier then divides 94 portable tables into five exact
read-only group roles and leaves the unresolved incident table inaccessible.
The optional tenant-session qualifier adds an empty server-owned principal
registry, zero-argument binder, read-only adapter, and 82 restrictive policies.
Native tests prove that custom setting changes cannot widen a mapped tenant's
scope. It creates no production login, membership, principal mapping, write
role, or runtime authority. The optional worker-control qualifier adds only
principal-ID enumeration, deployment-expectation reads, and heartbeat
read/update through a separate role; native tests prove the exact operations
and denials. The optional notification-recovery qualifier adds one
server-clocked, principal-bound function grant with zero direct table access and
proves exact handler transitions, isolation, idempotent/concurrent replay, and
tamper rejection. Every fixture membership and mapping is removed afterward.
Use the separate [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md)
runbook; its receipt permanently records that runtime authority and cutover
readiness are false.

A production cutover must still add the other six PostgreSQL task handlers and
every request repository, production identity-to-login provisioning and activate the
qualified roles, add remaining write roles,
governed mixed/incident access, deployed worker-fleet and handler replay proof,
production identity, backup/PITR and restore, outage/load testing, and
controlled authority-switch evidence. It must quiesce SQLite, load
PostgreSQL once, reconcile, and switch authority once. Dual writes remain
rejected because they create two competing transaction authorities.

This archive and drill establish the portable dataset and recovery receipt.
They do not claim that PostgreSQL is the runtime source of truth or that a
production identity provider, TLS ingress, monitoring, Windows packaging, or
an off-host backup system has been deployed.
