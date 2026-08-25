# Data portability and recovery drill

Yoink 0.14 provides a streaming, deterministic portability archive for an
operator-controlled SQLite database. Yoink 0.56 adds an offline PostgreSQL
qualification importer that consumes the same contract, creates a new private
schema atomically, and reconciles every table exactly. The runtime API and
worker remain SQLite-only.

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
primary/not-null/foreign-key/index/default/check/trigger translation, direct
tenant RLS, tamper closure, and the same canonical table/data reconciliation.
Use the separate [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md)
runbook; its receipt permanently records that runtime authority and cutover
readiness are false.

A production cutover must still add the async PostgreSQL repository family,
complete inherited tenant isolation, fleet lease contention, production
identity, backup/PITR and restore, outage/load testing, and controlled authority
switch evidence. It must quiesce SQLite, load PostgreSQL once, reconcile, and
switch authority once. Dual writes remain rejected because they create two
competing transaction authorities.

This archive and drill establish the portable dataset and recovery receipt.
They do not claim that PostgreSQL is the runtime source of truth or that a
production identity provider, TLS ingress, monitoring, Windows packaging, or
an off-host backup system has been deployed.
