# Worker deployment attestation

Yoink 0.42 prevents a standalone SQLite worker with a different packaged,
public trust, or public alert-connector configuration from receiving new work.
Contract 2 supersedes contract 1 while preserving its append-only transition
history. This is deterministic
drift detection inside reviewed Yoink code. It is not hardware remote
attestation and cannot prove that a malicious replacement binary is honest.

## Fingerprint contract

API and worker independently calculate a domain-separated SHA-256 fingerprint
over:

- deployment contract version;
- exact Yoink runtime version;
- every closed background task kind with its packaged interval and maximum
  attempt count;
- whether an observer-recipe witness is required and configured;
- the exact witness HTTPS endpoint and log namespace;
- witness Ed25519 key ID and a nested hash of its public SPKI;
- configured maximum receipt age; and
- a hash of sorted operator-alert webhook bindings, where each binding hashes
  the exact reference, HTTPS endpoint, and signing-secret variable name.

No private key, webhook secret value, device credential, proxy secret, tenant/user identifier,
retailer evidence, product data, URL history, or task capability is an input or
stored output. Witness/connector endpoints and public keys remain process
configuration; SQLite receives only the final 64-character deployment
fingerprint. Connector and queued-delivery rows separately retain only their
public one-way binding so a changed destination cannot receive historical work
silently.

## API-owned expectation

After applying migrations, the API records one active worker mode
(`embedded`, `external`, or `disabled`), exact runtime version, and expected
fingerprint. A real change appends a hash-chained
`api_startup_contract` event before updating the current projection. Starting
again with identical configuration is a no-op, so supervision does not flood
history.

The standalone worker calculates its own fingerprint. Before it may create
default schedules, enqueue a due schedule, or lease a task, the SQLite adapter
requires all of:

1. the API expectation exists;
2. desired mode is `external`;
3. runtime version matches; and
4. fingerprint matches exactly.

The inactive PostgreSQL qualification path enforces the same contract at a
narrower database boundary. Queue-write contract v3 gives the server-bound
tenant writer `SELECT` only on this singleton expectation and validates all four
conditions inside the same `READ COMMITTED` transaction before schedule,
enqueue, or new-lease SQL. Already-leased completion/failure recovery remains
available. The writer cannot update the expectation. Native qualification proves a
deliberate mismatch leaves the queue unchanged. Version 0.64 supplies the
separate least-privilege control boundary: 19 exact column grants on users,
expectation, and heartbeat tables route principal pagination, fleet status, and
stopping through their own adapter without queue, insert, delete, login,
membership, or runtime authority. Version 0.65 adds one separate function-only
notification-recovery handler boundary with no direct table privileges; it
does not weaken or participate in deployment attestation and remains inactive.

A mismatch may write only its normal bounded heartbeat with
`worker_deployment_mismatch`. This gives the API and Operations workspace
diagnostic evidence while leaving the queue untouched. External health also
requires every persisted principal to have a current matching heartbeat and
requires zero concurrently online mismatched workers.

An already-leased task may record its success, bounded failure, or uncertain
transition. That preserves the existing at-most-once recovery model; it does
not grant another lease after the expectation changes. Stop worker before API
during normal upgrades to avoid this bounded overlap.

## Recovery

For `worker_deployment_mismatch` or
`worker_deployment_expectation_mismatch`:

1. stop every standalone worker;
2. confirm the API and worker use the exact same reviewed Yoink package;
3. compare witness required/configured state, URL, log ID, key ID, public SPKI,
   maximum age, and the exact public webhook registry without copying private
   key or webhook-secret material;
4. start the API and let it own all migrations and the current expectation;
5. start one matching worker; then
6. require healthy attested coverage in `/api/v1/health` and Admin Operations
   before restoring normal supervision.

Do not edit fingerprints or events, delete heartbeat evidence, weaken the
lease gate, or run another worker to outvote a mismatch. One matching worker
does not hide an online mismatched worker.

## Remaining production boundary

The contract catches accidental version, task-registry, public witness, and
public alert-registry drift in this SQLite process layout. Production still needs
signed artifact provenance, workload identity, managed secret retrieval and rotation,
production PostgreSQL login provisioning, activation of the qualified
principal/deployment control role and composition with the tenant queue
repository, and remaining restricted writer families (the server-bound session
registry is empty), deployment of the
natively qualified lease algorithm across a supervised fleet, deployment orchestration,
independent monitoring, and tested rollback/outage procedures.
