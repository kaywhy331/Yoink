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
```

The Node process still binds to loopback. Put an authenticated TLS reverse proxy
on the same host in front of it. Do not expose port 32991 directly and do not
rewrite untrusted client headers into Yoink scope headers.

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
