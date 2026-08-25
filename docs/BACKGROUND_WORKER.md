# Background worker operations

Yoink 0.48 retains two safe SQLite worker layouts. Embedded mode is the
zero-configuration local default. External mode runs the same closed handler
registry in a separately supervised process. The registry contains seven closed
task families, including durable TrackaLacker evaluation, observer-repair
candidate quarantine, and observer-recipe witness receipt refresh. Neither mode can execute retailer mutation, checkout,
payment, drawing entry, or order submission.

## Choose a mode

| API setting | Handler location | Intended use | Health behavior |
| --- | --- | --- | --- |
| `embedded` | API process | Default nontechnical local setup | Reports the in-process runtime |
| `external` | `start:worker` process | Local/staging supervision and process-failure drills | Reports standalone heartbeat coverage |
| `disabled` | Nowhere | Intentional work stop | Reports disabled and unhealthy; accepted signals and queued work remain durable but unevaluated |

Local mode defaults to `embedded`. Hosted boundary mode defaults to `external`,
but hosted SQLite remains an integration/staging boundary and is not production
ready. `YOINK_BACKGROUND_WORKER=1|0` maps to embedded/disabled for compatibility.
Do not set that legacy switch together with `YOINK_BACKGROUND_WORKER_MODE`.

## Embedded local setup

```bash
npm install
npm run dev
```

Open **Admin → Operations → Background work**. A `local in process` instance
should become online after its first bounded cycle. This is the recommended
layout for a single-user workstation because shutdown ordering and database
ownership are automatic.

## Separate local or staging process

Build once, then start the API before the worker. The API is the only migration
owner; the worker requires an existing database whose migration ledger exactly
matches its package.

Terminal 1:

```bash
YOINK_DATA_DIR=/explicit/private/yoink-data \
YOINK_BACKGROUND_WORKER_MODE=external \
npm start
```

Terminal 2:

```bash
YOINK_DATA_DIR=/explicit/private/yoink-data \
npm run start:worker
```

Run `npm run build` before these release commands. For source development use
`npm run dev` and `npm run dev:worker` with the same environment and ordering.
Never point independently versioned API and worker packages at one SQLite file.

Migrations 38 and 39 make that exact-package rule enforceable for the standalone
layout. On startup the API records its requested worker mode and a secret-free
fingerprint over the package version, closed task registry, witness requirement,
complete public witness configuration, and public operator-alert webhook
registry. A standalone worker presents its
independently calculated fingerprint with every heartbeat. It cannot create a
schedule, enqueue work, or lease a task unless the API-owned expectation is
`external` and both version and fingerprint match.

The standalone process accepts only bounded operational settings:

- `YOINK_WORKER_ID`: 3–120 letters, numbers, underscores, or hyphens;
- `YOINK_WORKER_POLL_MS`: 500–60,000 milliseconds;
- `YOINK_WORKER_LEASE_SECONDS`: 15–300 seconds;
- `YOINK_WORKER_PRINCIPALS_PER_CYCLE`: 1–500 principals;
- `YOINK_WORKER_TASKS_PER_CYCLE`: 1–1,000 tasks;
- `YOINK_WORKER_TASKS_PER_PRINCIPAL`: 1–100 tasks.

In hosted mode, give the worker the same complete
`YOINK_OBSERVER_RECIPE_WITNESS_*` public configuration as the API. Partial
configuration is rejected, and `YOINK_HOSTED_MODE=1` refuses worker startup
when it is absent. The worker has no retailer, account, payment, device-token,
witness-private-key, or observer-private-signing-key input. Principal iteration
uses a canonical opaque keyset cursor rather than an unbounded table sweep. A
configured webhook adds only its outbound HMAC secret described below; that
secret grants no Yoink, browser, retailer, or purchase authority.

## Operator-alert webhook dispatch

The **Alert reconciliation and dispatch** schedule reconciles sanitized adapter
repair groups and then processes at most 20 connector rows. Configure the same
public `YOINK_OPERATOR_ALERT_WEBHOOKS_JSON` registry on API and standalone
worker. Each entry contains an opaque reference, exact public HTTPS endpoint,
and a dedicated `YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_*` variable name. In
external mode only the worker needs the named 32–512 byte secret value; in
embedded mode the API process is also the worker and needs it.

The public registry is part of deployment attestation, while secret values are
not. Each connector and delivery also pins a one-way binding fingerprint, so a
changed endpoint under the same reference becomes non-leasable until an admin
explicitly re-saves the connector and cancels outstanding work. See
[operator alert webhook connectors](OPERATOR_ALERT_CONNECTORS.md) for exact
configuration, payload, HMAC, retry, dead-letter, and recovery rules.

Before leasing new connector work, the worker converts any matching expired
twelfth-attempt lease to a dead letter and appends the fixed
`lease_attempts_exhausted` receipt. This prevents a process loss at the final
claim from stranding work outside the governed admin replay path. Manual replay
itself remains an API/admin operation; the worker receives only the unchanged
exact row afterward.

## Signal inbox behavior

The authenticated Chrome signal endpoint stores `signal_event_v1` and an
immediate priority wake atomically. The worker leases only that exact event
contract and evaluates at most 25 messages per handler run. Ephemeral offer
IDs, device credentials, push subscription keys, and lease capabilities are
not in its durable payload.

The **Signal inbox and delivery recovery** schedule is a 15-second fallback.
Pausing it prevents new immediate signal wakes as well as periodic draining;
device intake continues and reports `backgroundWakeState=schedule_paused`.
Resume makes the schedule immediately due. This schedule changes evaluation
latency only—it does not change user intent or grant browser action authority.

Signal failures retry from the inbox after 30 seconds and stop after 20 claims.
The Operations view exposes only fixed error metadata for stopped messages. Use
**Retry corrected signal** only after deploying the relevant packaged parser or
evaluation correction. The reset, audit/outbox receipt, and worker wake commit
atomically. See [durable signal ingress](SIGNAL_INGRESS.md) for the complete
contract and failure semantics.

## Observer repair candidate evaluation

The **Observer repair candidate evaluation** schedule runs every 60 seconds. It
examines only current privacy-bounded repair groups and can compile at most 25
thresholded layout candidates per run. Each field/selector must already have
three distinct paired devices and two exact SKUs in the same user-scoped repair
ledger.

The signing-free worker repository accepts only availability/unit-price/seller/
fulfillment `text` fields and an add-control `disabled_state` field, with fixed
field-aware selector grammar. It groups mature compatible fields for one layout
into an unsigned `quarantined` recipe row. Scoped deterministic fingerprints
make retry idempotent. Exact SKU/device IDs and observed page/offer values are
not copied into the candidate or audit receipt. The worker cannot load recipe
signing keys, promote a candidate, create trials, or distribute an envelope;
remote recipes remain structurally unavailable to mutation runners. See
[durable observer-repair candidate evaluation](OBSERVER_REPAIR_CANDIDATE_EVALUATION.md).

## Observer-recipe witness refresh

The **Observer trust witness refresh** schedule runs every 60 seconds. It
operates only on the exact installed manifest and latest append-only
transparency event. With no checkpoint it succeeds without a network request;
with a matching receipt well outside its refresh window it also performs no
network request. Otherwise it sends the same bounded public checkpoint used by
the manual admin operation and accepts only a correctly pinned, chained,
current Ed25519 receipt.

The standalone worker reconstructs a verification-only trust authority on
every run. It reloads the package-rooted public manifest so a reviewed key
rotation does not require worker restart, but it never opens or creates the
intermediate private signer. Failed publication records one fixed witness
failure class and follows normal bounded retry/dead-letter behavior; exception
or response content is not retained. Never disable the schedule or weaken
hosted delivery to work around an outage. See
[observer witness refresh](OBSERVER_WITNESS_REFRESH.md) for bootstrap,
recovery, and key-separation requirements.

## Health and operator checks

`GET /api/v1/health` exposes fixed operational facts:

- `backgroundWorkerMode` is `embedded`, `external`, or `disabled`;
- `backgroundWorkerDeployment` is `local_in_process` or `standalone`;
- `backgroundWorkerRuntime` reports the current lifecycle state;
- `backgroundWorkerHealthy` requires a current heartbeat, no bounded worker
  error, and—in external mode—attested coverage of every persisted principal
  with no concurrently online mismatch;
- `backgroundWorkerDeploymentAttested` and
  `backgroundWorkerDeploymentContractVersion` expose the fixed deployment gate
  without exposing its fingerprint inputs;
- `durableSignalIngress` and `signalEvaluationOutsideDeviceRequest` remain
  `true` for the packaged TrackaLacker device path;
- `durableObserverRepairCandidateEvaluation` is `true`, while
  `generatedObserverRepairCandidatesExecutable` and
  `generatedObserverRepairCandidatesAutoPromoted` remain `false`;
- `durableObserverRecipeWitnessRefresh` is `true`, while
  `observerRecipeWitnessRefreshConfigured` reports whether this process has a
  complete public witness configuration;
- `standaloneWitnessRefreshLoadsSigningKeys` remains `false`;
- `durableOperatorAlertConnectorDispatch` is `true`, while
  `operatorAlertConnectorRegistryConfigured` reports whether a public registry
  is present without exposing its endpoints or bindings;
- `governedOperatorAlertConnectorReplay` and
  `operatorAlertConnectorHealthProjection` are `true`; replay still requires
  `alert.manage`, exact eligibility, and explicit confirmation;
- `productionWorkerFleetReady` remains `false`.

The admin view considers a heartbeat online for 30 seconds. It shows only
operational aggregates, fixed error codes, sanitized result fields, and task
history. Lease capability material and exception text never reach the view.

## Shutdown and recovery

Send `SIGINT` or `SIGTERM` to the standalone process. It stops new cycles,
waits for an active bounded cycle, records stopped heartbeats, closes SQLite,
and exits. Stop the worker before the API when both are externally supervised.

After an abrupt process loss, external health becomes unhealthy when the
30-second heartbeat window expires. A leased task is not guessed complete:
after its bounded lease expires, a restarted worker can reclaim it with a new
one-use capability. If persistence fails after a handler result, Yoink records
an uncertain transition in process status and leaves the lease for recovery; it
does not issue a contradictory failure transition.

Recovery sequence:

1. Confirm the API can open the database and `/api/v1/health` reports database
   ready.
2. Confirm the API and worker are built from the exact same Yoink version.
3. Start the standalone worker once and wait for `standalone worker ready`.
4. Confirm external health is running/healthy and the admin view shows complete
   principal coverage without task or signal-inbox dead-letter growth.
5. If the worker reports an initialization failure, stop it and let the API
   apply migrations first; never bypass the exact-schema check.

For hosted recovery, also confirm the API and worker have the same witness URL,
log ID, key ID, public SPKI, and maximum age. A witness-refresh dead letter is
an availability or consistency incident: inspect the independent service and
public log, correct the deployment, then use the normal authorized task retry.
Do not copy either observer or witness private signing material onto the worker.

If connectors are configured, also compare the public webhook registry and
confirm each named signing-secret variable is present only where delivery runs.
A connector that becomes unbound after a reviewed registry change must be
explicitly re-saved; do not edit its binding fingerprint in SQLite.

A `worker_deployment_mismatch` means the process fingerprint differs from the
API expectation. Stop the worker, compare the exact package and public witness
settings, then restart the API before restarting the worker. Do not edit the
fingerprint in SQLite or retry tasks around the gate. The current expectation
is mutable only as API startup configuration; every actual transition has a
hash-chained append-only event, while unchanged restarts are idempotent. See
[worker deployment attestation](WORKER_DEPLOYMENT_ATTESTATION.md).

## Production gate

The separate process proves lifecycle, asynchronous port, bounded enumeration,
and recovery semantics against SQLite. Version 0.57 additionally qualifies a
complete PostgreSQL worker-store port on an inert imported schema, including
direct/inherited tenant isolation and single-connection `SKIP LOCKED` queue
semantics. Version 0.58 qualifies five inactive least-privilege read group
roles but creates no runtime login, membership, tenant-session binding, or write
role. Version 0.59 additionally proves `SKIP LOCKED` distribution, an exact-one-
winner lease race, and one-use completion across three distinct native
PostgreSQL 16 backend sessions using the production driver. Version 0.60 pins
worker qualification pools to `READ COMMITTED` and separately proves an inert
server-bound, read-only tenant session across simultaneous native principals;
its registry remains empty outside disposable tests. Version 0.61 qualifies one
server-bound four-table queue writer with 11 exact
operations, no delete access, and native two-principal write isolation. It has
no active principal, membership, handler, or runtime authority. Version 0.62
routes the actual tenant queue repository through contract v2 of that role,
including its single immutable JSON constraint helper, and proves scheduling,
retry, heartbeat, completion, and contention. Version 0.63 advances to contract
v3 with one `SELECT`-only deployment-expectation grant and validates attestation
inside the same tenant queue transaction before schedule, enqueue, or lease SQL.
Already-leased completion/failure recovery remains available. Principal
enumeration, deployment status, and stopping still use the qualification
connection. Production still requires PostgreSQL task-handler repositories,
production login provisioning, restricted control and remaining writer
families, a deployed multi-process worker fleet with handler replay and failure testing, production
identity and secrets, backups/PITR, load and outage drills, SLO
alerting, and controlled cutover. Do not advertise either external SQLite mode
or the qualification store as a production worker fleet.
