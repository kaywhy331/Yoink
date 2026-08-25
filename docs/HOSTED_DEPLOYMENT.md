# Hosted deployment contract

Yoink 0.13 added a deployable authenticated request boundary and durable
delivery protocol; 0.14 adds an offline portability and exact restore-parity
drill. Both preserve the local-first default. They do **not** silently turn
the current SQLite process into a public service. Version 0.19 adds persisted
application roles and split API/UI surfaces; 0.20 adds tenant/user-owned intent
revisions, offer snapshots, spend policy, transactional reservations, and an
append-only spend ledger. Version 0.21 adds reversible topology-bound catalog
identity operations but deliberately refuses to apply them when the database
contains more than one tenant; tenant roles are not global catalog authority.
A hosted operator must still provide TLS termination,
an identity-aware reverse proxy, explicit Host/Origin allowlists, principal
lifecycle management, backups, monitoring, and a PostgreSQL implementation
before treating a deployment as production hosted.

Version 0.27 adds the client side of an independently operated observer-recipe
transparency witness. Hosted boundary mode now refuses startup without its
public endpoint/log/key configuration. The repository still does not provide
that independent service, its private key, refresh worker, or public monitor.

Version 0.35 adds an asynchronous background-worker contract and a separately
runnable SQLite worker. Hosted boundary configuration defaults the API to
`external` worker mode, but that is a staging/integration process boundary—not
the missing PostgreSQL implementation or production fleet.

Version 0.36 moves authenticated TrackaLacker device-signal evaluation behind
that worker boundary. The API commits the normalized `signal_event_v1` inbox
message and its immediate wake before returning `202`; external mode therefore
requires a healthy standalone worker for evaluation latency. A stopped worker
does not lose intake, but accepted signals remain queued. Health exposes
`durableSignalIngress` and `signalEvaluationOutsideDeviceRequest`, while the
admin worker projection exposes scoped aggregate state and payload-free dead
letters. This does not make external SQLite a production transport.

Production catalog curation requires a separately authenticated global-curator
plane with step-up/two-person approval, cross-tenant policy, privacy operations,
and durable operator audit. Do not bypass the 0.21 multi-tenant lock by granting
tenant roles or deleting tenant records.

## Runtime modes

Local mode remains the default. The server binds only to `127.0.0.1`, accepts
loopback Host/Origin values, and uses `tenant_local` / `user_local` when no
authenticated request resolver is configured.

Hosted boundary mode is enabled only with all of:

```text
YOINK_HOSTED_MODE=1
YOINK_HOSTED_PROXY_SECRET=<at least 32 random bytes>
YOINK_HOSTED_HOSTS=yoink.example.com
YOINK_HOSTED_ORIGINS=https://yoink.example.com
YOINK_OBSERVER_RECIPE_WITNESS_URL=https://witness.example.net/v1/checkpoints
YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID=yoink-production
YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID=<sha256 of witness Ed25519 SPKI>
YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI=<base64url DER SPKI>
YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS=900
YOINK_BACKGROUND_WORKER_MODE=external
```

The Node process still binds to loopback. Put an authenticated TLS reverse proxy
on the same host in front of it. Do not expose port 32991 directly and do not
rewrite untrusted client headers into Yoink scope headers.

## Background worker process boundary

In external mode, start the API first with the deployment's explicit
`YOINK_DATA_DIR`, then start `npm run start:worker` with the same directory and
the exact same package version. The API owns migrations. The worker uses exact-
schema mode and refuses to create, seed, or upgrade the database. Supervision
must stop the worker before the API and restart it after API migration.

External health is healthy only while fresh standalone heartbeats cover every
persisted principal without a bounded worker error. A configured external mode
with no live process reports waiting/stopped and unhealthy. See the
[background worker runbook](BACKGROUND_WORKER.md) for commands, settings, and
recovery, and [durable signal ingress](SIGNAL_INGRESS.md) for the device receipt,
pause, replay, and corrected-message retry contract.

Do not scale this SQLite process layout into a production claim. Multiple
hosts, PostgreSQL transactions and row-level tenant isolation, fleet-safe
leases, backup/PITR, production secrets/identity, load and outage drills, SLOs,
and controlled cutover remain required.

## Observer-recipe transparency witness

Operate the witness under a different administrative and signing trust domain.
Its Ed25519 private key must never be placed on the Yoink API host, in SQLite,
in an extension package, in an API request, or in the portability archive. Pin
the public key and stable public log namespace through deployment configuration.
Yoink derives a separate stable pseudonymous log ID for each tenant so tenant
chains cannot compete for one witness sequence; the raw tenant ID is not sent.
The witness URL must be HTTPS, contain an explicit path, and contain no
credentials, query, or fragment.

`POST /api/v1/admin/observer-recipes/witness/publish` sends an exact bounded
contract containing only:

- contract/log identifiers;
- packaged root key ID;
- current manifest generation and hash;
- current local transparency sequence and event hash;
- the previous independent receipt hash.

The endpoint returns an exact-schema Ed25519 receipt with its own monotonic
sequence, predecessor hash, witnessed time, and expiry. Yoink validates the
pinned key, signature, current checkpoint, both hashes, sequence, predecessor,
and lifetime, then commits the receipt plus sanitized check/audit/outbox rows.
It never sends selector definitions, retailer/product facts, URLs, browsing
history, tenant/user/device IDs, credentials, tokens, or mutation data.

Hosted delivery of an active observer recipe returns a correlated `503` until
the current transparency tip has a fresh receipt. Installing a manifest or
signing/re-signing a recipe advances that tip and therefore requires another
receipt. Availability or consistency failures expose fixed-code alarms in
`/admin`, `/api/v1/admin/snapshot`, and `/api/v1/health`; raw response and
transport details are discarded. A prior fresh receipt may remain usable until
its configured maximum age during a degraded refresh, then delivery closes.

The admin button is an explicit staging/local operation. Production must invoke
the same authenticated route from an idempotent scheduled worker, monitor
witness availability and public log consistency independently, rotate pins via
reviewed deployment changes, and alert before receipt expiry. Do not weaken the
gate or point the URL back at the Yoink process to claim independence.

## Authenticated request scope

The trusted proxy signs these headers with HMAC-SHA256:

- `X-Yoink-Tenant-Id`
- `X-Yoink-User-Id`
- `X-Yoink-Actor-Kind` (`maintainer`, `user`, `device`, or `service`)
- `X-Yoink-Actor-Id`
- `X-Yoink-Scope-Issued-At` (Unix seconds)
- `X-Yoink-Scope-Nonce` (new random value for every request)
- `X-Yoink-Scope-Signature`

The signature covers protocol version, HTTP method, exact request path/query,
tenant, user, actor kind/ID, timestamp, and nonce. Yoink verifies the principal
relationship, enforces a 60-second clock window, and persists a hash of every
accepted nonce so replay fails closed across process restarts. The helper
`signHostedRequestScope()` in `apps/api/src/hosted-request-auth.ts` defines the
canonical signing format.

The signed actor kind is identity context, not authorization. Persisted role
memberships authorize `/api/v1/user/*` and `/api/v1/admin/*`; an actor claiming
`maintainer` receives no implicit permission. `/api/v1/devices/self/*` and
`/api/v1/internal/*` use fixed package/service capabilities. The exact seeded
loopback control-center identity is the only local bootstrap exception.

Paired Chrome devices do not use proxy scope headers. Their existing Bearer
token is resolved across the device table and produces a scope bound to that
device's exact tenant/user. Revoked devices fail authentication. Chrome remains
the only component allowed to mutate a retailer session.

## Principal provisioning

Only a signed `service` actor with the fixed `internal.principal` capability can
call `POST /api/v1/internal/hosted/principals` (the older
`/api/v1/hosted/principals` path is a deprecated compatibility route), and the
payload must include `PROVISION_HOSTED_PRINCIPAL`. Provisioning is idempotent and
creates private defaults for the new user:

- paused shadow-mode settings;
- three user-owned source connections;
- one default notification strategy;
- thirteen user-owned attribution policies;
- one persisted baseline `yoink_user` role membership.

Source connection IDs are deterministic per user, so a hosted TrackaLacker
event or catalog import cannot attach to the local user's connection. Retailer
mutation qualification is also keyed by user; one user's activation cannot
authorize another user.

## Durable delivery

The hosted delivery API and repository implement:

- inbox uniqueness by tenant, user, source, and message key;
- canonical sanitized payload hashes, exact replay dedupe, and different-body
  idempotency conflicts;
- 64 KiB sanitized payload limits;
- short-lived one-use lease capabilities stored only as hashes;
- bounded retry scheduling and dead-letter state after 20 attempts;
- tenant-scoped outbox leasing and acknowledgement;
- append-only accepted/deduped/leased/retry/processed/delivered/dead-letter
  receipts.

Canonical routes live under `/api/v1/internal/delivery/`; the older
`/api/v1/hosted-delivery/` paths remain a deprecated compatibility facade.
They require the fixed `internal.delivery` service capability. A maintainer
actor label and ordinary user role cannot access them. Secrets, cookies,
authorization values, offer tokens, and other sensitive diagnostic keys are
redacted before persistence.

## PostgreSQL boundary

The current repository implementation uses synchronous `node:sqlite`; simply
pointing it at PostgreSQL is impossible and unsafe. The
`yoink-portability-ndjson-v1` archive now supplies a deterministic logical
dataset, exact schema/migration manifest, table hashes, fresh-SQLite restore,
and reconciliation receipt. See [Data portability and recovery](DATA_PORTABILITY.md).

PostgreSQL must still be delivered as an async repository implementation and
importer with transactional equivalents for every domain operation, migration
parity, row-level tenant tests, lease contention tests, PostgreSQL
backup/restore drills, and a controlled cutover. Until that implementation is
provisioned and verified, SQLite is the runtime source of truth and hosted
boundary mode is suitable for integration/staging—not a claim of completed
production hosting.

Do not use dual writes as a shortcut. The transactional inbox/outbox protocol is
the supported seam for migration and reconciliation.

## Mutation boundaries

Hosted services may collect signals, coordinate private missions, distribute
signed observer-only recipes, and enqueue bounded jobs. They may not click a
retailer page. Downloaded recipes are read-only CSS selector data interpreted by
packaged code; they cannot navigate, submit forms, execute scripts, or authorize
mutation. Pickup, prepare-checkout, and submit-order remain separately closed in
the future-lane matrix until exact packaged runners, live evidence, rehearsals,
recovery coverage, security review, and explicit activation exist for each
retailer.
