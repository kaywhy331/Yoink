# Background worker operations

Yoink 0.39 retains two safe SQLite worker layouts. Embedded mode is the
zero-configuration local default. External mode runs the same closed handler
registry in a separately supervised process. The registry now evaluates only
durably accepted packaged TrackaLacker signals in addition to its maintenance
families. Neither mode can execute retailer mutation, checkout, payment,
drawing entry, or order submission.

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

The standalone process accepts only bounded operational settings:

- `YOINK_WORKER_ID`: 3–120 letters, numbers, underscores, or hyphens;
- `YOINK_WORKER_POLL_MS`: 500–60,000 milliseconds;
- `YOINK_WORKER_LEASE_SECONDS`: 15–300 seconds;
- `YOINK_WORKER_PRINCIPALS_PER_CYCLE`: 1–500 principals;
- `YOINK_WORKER_TASKS_PER_CYCLE`: 1–1,000 tasks;
- `YOINK_WORKER_TASKS_PER_PRINCIPAL`: 1–100 tasks.

The worker configuration has no retailer, account, payment, or credential
inputs. Principal iteration uses a canonical opaque keyset cursor rather than
an unbounded table sweep.

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

## Health and operator checks

`GET /api/v1/health` exposes fixed operational facts:

- `backgroundWorkerMode` is `embedded`, `external`, or `disabled`;
- `backgroundWorkerDeployment` is `local_in_process` or `standalone`;
- `backgroundWorkerRuntime` reports the current lifecycle state;
- `backgroundWorkerHealthy` requires a current heartbeat, no bounded worker
  error, and—in external mode—coverage of every persisted principal;
- `durableSignalIngress` and `signalEvaluationOutsideDeviceRequest` remain
  `true` for the packaged TrackaLacker device path;
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

## Production gate

The separate process proves lifecycle, asynchronous port, bounded enumeration,
and recovery semantics against SQLite. Production still requires the roadmap's
async PostgreSQL repository/importer, row-level tenant isolation, fleet-safe
leases, production identity and secrets, backups/PITR, load and outage drills,
SLO alerting, and controlled cutover. Do not advertise external SQLite mode as
a production worker fleet.
