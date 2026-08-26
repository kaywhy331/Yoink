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
registry and restrictive policies over the then-current 82 tenant tables. Yoink 0.61 adds an
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
SQLite-backed. Yoink 0.66 adds the same bounded model for execution recovery,
including action/spend receipt parity and fail-closed cross-tenant shared-
incident handling. The other five handlers remain SQLite-only, and all
PostgreSQL roles remain inactive.
Yoink 0.67 adds a third function-only role for bounded operational retention:
30-day telemetry/task history, 90-day observer-recovery evidence, a 500-row
evidence cap, authenticated receipt attribution, and exact retention/audit/
outbox parity. The other four handlers remain SQLite-only.
Yoink 0.68 adds the fourth function-only role for bounded observer-candidate
evaluation. It derives at most 25 aggregate proposals from 2,000 sanitized
diagnostics, revalidates the evidence before apply, and can create only
unsigned, non-executable quarantine candidates. The other three handlers
remain SQLite-only.
Yoink 0.69 adds a separate function-only connector-dispatch sub-boundary with
server-bound user isolation, two-phase leasing, one-use hashed capabilities,
and endpoint references only. Alert diagnostic reconciliation remains
SQLite-only, so complete-handler coverage remains four of seven.
Yoink 0.70 adds the independent function-only diagnostic-reconciliation
boundary, completing `adapter_alert_reconciliation`. It derives and revalidates
bounded sanitized repair groups and preserves incident lifecycle, dashboard,
audit, outbox, and secretless connector-queue receipts. Five of seven handlers
now have PostgreSQL repository parity; the remaining two handlers and all
request repositories remain SQLite-only, and every PostgreSQL runtime role
stays inactive.
Yoink 0.71 adds the sixth function-only boundary for independent observer-
witness refresh. HTTPS publication and pinned Ed25519 verification remain in
the application outside database transactions; PostgreSQL re-derives the
tenant-scoped public checkpoint and accepts only an exact fresh canonical
receipt plan. Six of seven handlers now have PostgreSQL repository parity;
hosted-delivery recovery and all request repositories remain SQLite-only, and
every PostgreSQL runtime role stays inactive.
Yoink 0.72 decomposes the final hosted-delivery handler and adds a seventh
function-only role for its complete lease-recovery half. PostgreSQL now applies
the exact inbox/outbox expired-lease retry/dead-letter matrix and deterministic
SHA-256 delivery receipts with server-bound principals and server time. Complete
handler coverage remains six of seven because durable signal evaluation is
still SQLite-only; every PostgreSQL role remains inactive.
Yoink 0.73 adds migration 48, which rebuilds signal incidents with exact
tenant/user ownership and refuses missing or multi-principal historical
evidence. The PostgreSQL manifest now classifies all 95 portable tables, with
83 tenant-scoped tables and no unresolved grant class. Signal evaluation and
all production PostgreSQL authority remain closed.
Yoink 0.74 advances the hosted-delivery qualification contract to v2. The same
zero-direct-grant role may now execute a second exact function for the fixed
`signal_event_v1` inbox lease, acknowledgement, retry, and attempt-20 dead-
letter lifecycle. PostgreSQL binds each transition to the database-
authenticated tenant/user and statement clock, stores only a one-use
capability hash, and appends the existing deterministic receipt. Inbox
acceptance and signal evaluation remain SQLite-only, complete-handler parity
remains six of seven, and every PostgreSQL runtime role remains inactive.
Yoink 0.75 advances that boundary to contract v3 with a third exact function
that derives a capability-bound, maximum-30-second signal-resolution plan.
PostgreSQL verifies the stored payload and transport hashes, principal-owned
TrackaLacker source, duplicate state, and the current shared catalog without
returning raw signal payloads or changing any catalog or evaluation row.
Unknown exact identities explicitly require a later, separately qualified
shared-catalog authority. Resolution-plan apply and downstream signal
evaluation remain SQLite-only, complete-handler parity remains six of seven,
and every PostgreSQL runtime role remains inactive.
Yoink 0.76 adds a distinct, separately receipted function-only role for the
unknown-product catalog-create step. It re-derives the leased trusted-exact
signal plan inside one two-phase transaction and can insert only a new family,
variant, listing, canonical URL, and exact tenant source references across the
13 packaged canonical retailer formats. It cannot update or delete catalog
state, refresh an existing reference, mutate or complete signal evaluation, or
return raw signal payloads. Native PostgreSQL proves exact row deltas, one-
winner concurrency, isolation/replay/direct denial, and catalog-tamper
detection. Resolution/evaluation apply and all runtime authority remain closed,
so complete-handler parity remains six of seven and SQLite stays authoritative.
Yoink 0.77 adds another distinct function-only role for the exact event and
resolution commit. It revalidates and serializes the leased plan in a two-phase
transaction, treats a transport duplicate as a zero-write result, or inserts
one signal event, updates the exact source heartbeat, and inserts one resolution
decision. Unknown products must pass the v0.76 catalog role first. The function
cannot refresh source references, create downstream occurrence/incident/offer/
mission/action state, acknowledge the inbox, or return the raw payload. Native
PostgreSQL proves all four resolution outcomes, exact row deltas, isolation,
replay, one-mutation concurrency, direct denial, and catalog-tamper detection.
Downstream signal evaluation, final handler composition, and all runtime
authority remain closed, so complete-handler parity stays six of seven and
SQLite remains authoritative.

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
The optional role qualifier originally divided 94 portable tables into five
exact read-only group roles and left the unresolved incident table inaccessible;
migration 48 now classifies and grants all 95 through the same bounded classes.
The optional tenant-session qualifier adds an empty server-owned principal
registry, zero-argument binder, read-only adapter, and 83 restrictive policies.
Native tests prove that custom setting changes cannot widen a mapped tenant's
scope. It creates no production login, membership, principal mapping, write
role, or runtime authority. The optional worker-control qualifier adds only
principal-ID enumeration, deployment-expectation reads, and heartbeat
read/update through a separate role; native tests prove the exact operations
and denials. The optional notification-recovery qualifier adds one
server-clocked, principal-bound function grant with zero direct table access and
proves exact handler transitions, isolation, idempotent/concurrent replay, and
tamper rejection. The optional execution-recovery qualifier adds a second
server-clocked, principal-bound function-only role, preserves action, ledger,
audit, and outbox receipts, and refuses cross-tenant shared-incident mutation.
The optional operational-retention qualifier adds the third function-only role,
proves bounded old/current privacy deletion and recent-review preservation, and
returns only counts, cutoffs, and receipt IDs.
The optional observer-candidate qualifier adds the fourth function-only role,
uses a server-derived two-phase evidence plan, and returns only aggregate
candidate evidence and receipt IDs; identifiers used for device/SKU thresholds
are neither returned nor copied into the candidate.
Every fixture membership and mapping is removed afterward.
Use the separate [PostgreSQL cutover qualification](POSTGRES_CUTOVER.md)
runbook; its receipt permanently records that runtime authority and cutover
readiness are false.

A production cutover must still complete and compose the hosted signal-
evaluation handler, every request repository, production identity-to-login
provisioning and activation of the qualified roles, add remaining write roles,
governed mixed/incident access, deployed worker-fleet and handler replay proof,
production identity, backup/PITR and restore, outage/load testing, and
controlled authority-switch evidence. It must quiesce SQLite, load
PostgreSQL once, reconcile, and switch authority once. Dual writes remain
rejected because they create two competing transaction authorities.

This archive and drill establish the portable dataset and recovery receipt.
They do not claim that PostgreSQL is the runtime source of truth or that a
production identity provider, TLS ingress, monitoring, Windows packaging, or
an off-host backup system has been deployed.
