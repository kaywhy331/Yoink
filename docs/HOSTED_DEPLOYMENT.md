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
with qualified runtime repositories before treating a deployment as production
hosted.

Version 0.27 adds the client side of an independently operated observer-recipe
transparency witness. Hosted boundary mode now refuses startup without its
public endpoint/log/key configuration. The repository still does not provide
that independent service, its private key, refresh worker, or public monitor.

Version 0.35 adds an asynchronous background-worker contract and a separately
runnable SQLite worker. Hosted boundary configuration defaults the API to
`external` worker mode, but that is a staging/integration process boundary—not
the missing PostgreSQL runtime repository family or production fleet.

Version 0.36 moves authenticated TrackaLacker device-signal evaluation behind
that worker boundary. The API commits the normalized `signal_event_v1` inbox
message and its immediate wake before returning `202`; external mode therefore
requires a healthy standalone worker for evaluation latency. A stopped worker
does not lose intake, but accepted signals remain queued. Health exposes
`durableSignalIngress` and `signalEvaluationOutsideDeviceRequest`, while the
admin worker projection exposes scoped aggregate state and payload-free dead
letters. This does not make external SQLite a production transport.

Version 0.37 adds tenant-scoped, privacy-bounded structural landmarks to the
existing adapter diagnostic channel. The resulting selector is an admin-only,
non-executable maintainer suggestion. Its three-device/two-SKU threshold is not
a cross-account community quorum, and hosted deployments must not aggregate
private tenant repair ledgers into a public rule without the separate shared
evidence, reputation, deletion, governance, and independent-validation plane.

Version 0.44 likewise hardens only the tenant-local community inventory read
projection: one latest eligible vote per contributor and median/range price
evidence. Hosted operators must not reinterpret same-tenant account IDs as a
production community identity or merge private ledgers across tenants. A
shared plane still requires pseudonymous cross-account identity, production
account/device-risk signals, reputation, Sybil/abuse operations, consent and
deletion propagation, independent canaries, and separate governance.

Version 0.54 adds the server-side ingestion seam for one such provider, not the
provider itself. A trusted service may submit a pre-pseudonymized account and
proof hash, coarse subdivision, and separate account/device/region eligibility
decisions with at most a 24-hour lifetime. New observer-recipe trials snapshot
only fully eligible proof and feed a seven-day regional conflict circuit
breaker that can disable read-only distribution. Hosted operators must supply,
audit, and monitor the independent IdP/device-risk decision service; setting
booleans directly does not establish public reputation or Sybil resistance.

Version 0.38 adds hash-only, generation-bound Chrome credential rotation. The
two-phase protocol and extension recovery prevent ordinary network loss from
forcing re-pairing, but they do not make an exposed bearer harmless. Hosted
deployments must still terminate TLS, pin the packaged production extension
origin, monitor/revoke risky devices, protect proxy and witness secrets, and
connect device lifecycle to production identity and incident operations.
Pending and previous credential hashes belong in encrypted backups and must
remain excluded from logs, telemetry, user exports, and support views.

Version 0.39 makes that protocol usable through the hosted request boundary.
An exact allowlisted Chrome extension origin is checked before pairing-code or
bearer lookup; the bounded pairing body resolves only its owning tenant/user;
pending credentials scope only commit; and current/unexpired previous
credentials scope ordinary device routes. Bearer-shaped failures cannot fall
back to proxy headers. Hosted mode also removes the local ZIP endpoints and
onboarding link. A separate deterministic production extension profile accepts
only explicit non-loopback HTTPS origins and uses browser-managed updates. See
[hosted Chrome device transport](HOSTED_DEVICE_TRANSPORT.md).

Version 0.40 adds the durable observer-recipe witness refresh task. The API and
standalone worker must receive the same complete pinned public witness
configuration. Hosted worker startup fails when it is absent. Each bounded run
uses the exact installed transparency checkpoint and reloads only the
package-rooted public manifest; the standalone process never loads the observer
intermediate private signer. Receipt renewal is now scheduled, but the witness
service and its key, independent public-log monitoring, and alert delivery
remain deployment responsibilities. See
[observer witness refresh](OBSERVER_WITNESS_REFRESH.md).

Version 0.41 binds that split process to an API-owned deployment expectation.
Both processes independently hash the exact package version, closed task
registry, witness requirement, and complete public witness configuration.
Hosted health requires exact attested principal coverage and rejects any online
mismatch; a mismatched standalone worker cannot create, enqueue, or lease work.
Only the fingerprint and hash-chained configuration-transition metadata enter
SQLite. This prevents accidental drift in packaged code, not a malicious binary
from lying, and is not hardware remote attestation or release provenance. See
[worker deployment attestation](WORKER_DEPLOYMENT_ATTESTATION.md).

Version 0.42 adds deployment-owned, HMAC-signed operator-alert webhooks. The
admin plane stores only an opaque reference and binding fingerprint; exact
HTTPS endpoints and secret-variable names come from the public deployment
registry, and only the process executing delivery resolves each secret value.
The public registry is now part of worker attestation. Existing queued rows
also require an exact binding match, so changing a destination under the same
reference cannot silently retarget historical alerts. This is optional; an
empty registry is a healthy no-connector state. See
[operator alert connectors](OPERATOR_ALERT_CONNECTORS.md).

Version 0.43 adds no new destination input. It allows a permission-gated
operator to replay only an exact dead letter while the same saved connector and
attested public binding remain current. The stable delivery ID, payload,
idempotency key, and binding are reused; three manual cycles are the maximum.
Hosted deployments should still feed the sanitized rolling health projection
to an independent monitor because the packaged 24-hour/five-minute SLO view is
not itself paging or external availability evidence.

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
YOINK_HOSTED_EXTENSION_ORIGINS=chrome-extension://<exact-production-extension-id>
YOINK_HOSTED_SERVICE_CAPABILITIES_JSON={"delivery_worker":"internal.delivery","identity_risk_worker":"internal.eligibility","principal_sync":"internal.principal"}
YOINK_OBSERVER_RECIPE_WITNESS_URL=https://witness.example.net/v1/checkpoints
YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID=yoink-production
YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID=<sha256 of witness Ed25519 SPKI>
YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI=<base64url DER SPKI>
YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS=900
YOINK_BACKGROUND_WORKER_MODE=external
```

Optional signed-webhook delivery additionally uses the same public registry on
API and worker plus the named secret only on the external worker:

```text
YOINK_OPERATOR_ALERT_WEBHOOKS_JSON=[{"reference":"ops_primary","endpoint":"https://alerts.example.com/v1/yoink","signingSecretEnvironment":"YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY"}]
YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY=<32-512 byte random secret; worker only>
```

The Node process still binds to loopback. Put an authenticated TLS reverse proxy
on the same host in front of it. Do not expose port 32991 directly and do not
rewrite untrusted client headers into Yoink scope headers.

Build the matching production companion with explicit origins; then publish it
through the deployment's reviewed managed-browser or Chrome Web Store channel:

```bash
YOINK_EXTENSION_API_ORIGIN=https://api.yoink.example \
YOINK_EXTENSION_APP_ORIGIN=https://app.yoink.example \
npm run package:extension:production
```

Set `YOINK_HOSTED_EXTENSION_ORIGINS` to the exact ID assigned to that reviewed
package. A bounded multi-ID list is for controlled release transitions only.
Do not reuse the local unpacked package or enable the local release endpoint in
hosted mode.

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

If webhook delivery is configured, API and worker must share the exact public
registry or attestation closes new work. Keep the named secret out of API in
external mode, out of process arguments and shell history, and out of SQLite,
backups, logs, telemetry, and support tooling. Enforce destination egress at the
network boundary; Yoink's configuration validation does not replace production
DNS/IP policy or a managed secret provider.

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

The admin button remains an explicit bootstrap/recovery operation. Version 0.40
runs the same bounded publish-and-accept contract through the durable
`observer_recipe_witness_refresh` task before receipt expiry. Give API and
worker the exact same witness settings and supervise the worker independently.
Production must still monitor witness availability and public log consistency
outside Yoink, rotate pins through reviewed deployment changes, and alert on
task failure or freshness loss. Do not weaken the gate or point the URL back at
the Yoink process to claim independence.

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
`/api/v1/internal/*` use fixed package or singular deployment-owned service
capabilities. Hosted mode requires `YOINK_HOSTED_SERVICE_CAPABILITIES_JSON`,
which maps each signed service actor ID to exactly one internal capability.
Use `{}` to deny every internal service. Capability headers are rejected; the
server performs this mapping only after authenticating the signed scope. See
[internal service capability isolation](INTERNAL_SERVICE_CAPABILITIES.md). The
exact seeded loopback control-center identity is the only local bootstrap
exception.

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

## Observer contributor eligibility

The canonical route
`POST /api/v1/internal/observer-recipes/contributor-eligibility` requires a
signed `service` actor with the fixed `internal.eligibility` capability. It is
separate from principal provisioning, delivery, ordinary user roles, and paired
device bearer scope. The body is an exact closed contract; unknown keys and raw
identity, network/postal location, risk features, or proof payloads fail closed.

The upstream provider must create stable pseudonyms before ingestion, issue
fresh non-replayable proof decisions, use only canonical coarse subdivisions,
expire state within 24 hours, propagate revocation/deletion, and be monitored
independently. Yoink stores only the current bounded state plus redacted audit
evidence and immutable trial snapshots. Its health projection truthfully
reports the seam and SLO implemented while `productionIdentityRiskProvider`
remains false for this repository's local deployment.

## PostgreSQL boundary

The runtime repository implementation uses synchronous `node:sqlite`; simply
pointing it at PostgreSQL is impossible and unsafe. The
`yoink-portability-ndjson-v1` archive supplies a deterministic logical dataset,
exact schema/migration manifest, table hashes, fresh-SQLite restore, and
reconciliation receipt. Version 0.56 adds a production-driver-backed,
serializable one-shot qualification importer into a new private PostgreSQL
schema. It preserves the packaged relational invariants, forces direct-tenant
RLS, reconciles exact logical hashes, and permanently leaves runtime authority
false. See [Data portability and recovery](DATA_PORTABILITY.md) and the
[PostgreSQL cutover qualification](POSTGRES_CUTOVER.md) runbook.

PostgreSQL must still be delivered as async repository implementations with
transactional equivalents for every domain operation, active production
principals and restricted write roles, deployed worker-fleet load/outage and
handler-replay drills, PostgreSQL backup/PITR and restore drills, and a
controlled cutover. Version 0.59 proves the lease algorithm across three native
PostgreSQL 16 backend sessions. Version 0.60 separately qualifies an empty
server-owned tenant-principal registry, zero-argument binder, read-only adapter,
and restrictive policies across all 83 tenant tables; native fixture principals
prove isolation. Version 0.61 separately qualifies an inactive four-table queue
writer with 11 exact operations, no delete access, four restrictive policies,
and native two-principal write isolation. Version 0.62 runs the tenant queue
repository through contract v2 of that writer, including only the imported
immutable JSON helper required by the task constraint. Version 0.63 adds one
`SELECT`-only deployment-expectation grant and validates the exact expectation
inside the same tenant queue transaction before schedule, enqueue, or lease SQL.
Already-leased completion/failure recovery remains available. Principal
enumeration, fleet status, and stopping run through a separate inactive
three-table/19-column-grant role in the 0.64 native qualification path. Version
0.65 qualifies the first handler family through a separate function-only role:
notification recovery has zero direct table grants and server-bound tenant/user
resolution. Version 0.66 qualifies execution recovery through a second
zero-direct-grant function that preserves action/spend receipts and refuses
cross-tenant shared-incident mutation. Version 0.67 adds a third function-only
role for server-clocked 30/90-day privacy retention with a 500-row evidence cap
and authenticated receipt attribution. Version 0.68 qualifies a fourth
function-only role for two-phase, server-revalidated observer-candidate
evaluation bounded to 2,000 diagnostics and 25 unsigned non-executable
quarantine candidates. Version 0.69 proves a separate secretless connector-
dispatch sub-boundary with exact user isolation, server-clocked two-phase
leasing, and one-use hashed capabilities. Version 0.70 adds the separate
server-derived and evidence-revalidated diagnostic reconciliation boundary,
completing five of seven handlers. No production login, mapping, membership, handler composition, or
API repository is provisioned. None of these releases deploys that runtime. Until
it is provisioned and verified, SQLite is the source of truth and hosted
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
