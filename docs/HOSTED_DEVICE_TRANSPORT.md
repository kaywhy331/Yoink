# Hosted Chrome device transport

Yoink 0.39 completes the repository-side Chrome transport seam needed before a
hosted deployment can pair or rotate a companion safely. It does not turn the
SQLite staging runtime into a production service. PostgreSQL, a production
identity provider, TLS termination, a deployed browser release channel,
device-risk operations, backups/PITR, and fleet workers remain separate exit
gates.

## Two package profiles

The checked-in extension is the `local` profile. Its runtime configuration is
package-owned, points only to `http://127.0.0.1:32991`, includes the loopback
host permission, and permits the exact-version unpacked ZIP channel.

A production artifact is built explicitly:

```bash
YOINK_EXTENSION_API_ORIGIN=https://api.yoink.example \
YOINK_EXTENSION_APP_ORIGIN=https://app.yoink.example \
npm run package:extension:production
```

The packager accepts only exact, credential-free HTTPS origins and rejects
loopback. It generates a production `runtime-config.js`, replaces the manifest
host permission with only the configured API origin, disables local ZIP update
logic, and writes `Yoink-Companion-<version>-production.zip`. The build is
deterministic. Retailer host access remains optional and unchanged.

Production packages report their profile in the authenticated heartbeat. The
popup opens only the packaged application origin and describes updates as
browser-managed. It never queries or opens Yoink's local extension release
endpoint. Building an archive does not publish it or assign a Chrome extension
ID; release signing, managed-browser/Chrome Web Store publication, staged
rollout, rollback, and provenance are deployment responsibilities.

## Exact origin policy

Hosted startup now requires:

```text
YOINK_HOSTED_EXTENSION_ORIGINS=chrome-extension://<exact-32-character-id>
```

Multiple explicitly reviewed IDs may be comma-separated for a bounded release
transition. Values must be exact `chrome-extension://` origins with Chrome's
32-character `a` through `p` ID alphabet and no credentials, path, query, or
fragment. The server checks this policy before reading a pairing body or
resolving a device bearer. A foreign extension therefore cannot probe pairing
codes or credential slots through the hosted resolver.

Local mode deliberately keeps the structural origin check so an unpacked
developer extension can be loaded without a preassigned ID. Health and the
admin snapshot distinguish this local behavior from an explicit hosted origin
policy.

## One-time pairing scope

An authenticated user still creates the five-minute pairing code. On the exact
`POST /api/v1/devices/pair` route only, the hosted resolver pre-reads the bounded
JSON body and looks up the hash of that unconsumed code. The existing database
schema already makes `device_pairing_codes.code_hash` globally unique. A valid
code therefore resolves exactly one tenant/user and a temporary device actor;
the repository consumes it atomically while creating the device.

The raw code is never placed in a URL, header, log, telemetry record, or audit
payload. It cannot scope another route. A malformed, expired, used, or unknown
code fails authentication without selecting a tenant. A rejected extension
origin is stopped before code lookup and does not consume the code.

## Credential-slot routing

Hosted request scoping now mirrors the repository's two-phase rotation state:

- the current credential may scope ordinary device routes and begin rotation;
- an unexpired previous credential may scope ordinary device routes during the
  two-minute grace, but repository validation prevents it from beginning a new
  rotation;
- an unexpired pending credential may scope only the exact rotation commit
  route;
- the promoted token may replay the exact generation commit idempotently;
- a bearer-shaped but unknown or expired token fails immediately and cannot
  fall back to trusted-proxy identity headers.

The API still performs the route-specific credential and generation checks
after scope resolution. Scope selection is not action authorization. Device
roles cannot load user/admin surfaces, and no transport profile can qualify a
retailer or widen an action runner.

## Release-channel separation

When hosted mode is enabled, both local extension release endpoints return a
closed `404 local_extension_release_disabled` response, health reports
`localExtensionUpdates=false`, and the user overview supplies no local download
URL. The dashboard renders managed installation guidance instead of silently
falling back to the unpacked ZIP path.

Local mode retains the existing hash/size/version-bound ZIP feed for developer
installations. The two channels never share a runtime configuration or archive
name, which makes an accidental loopback production build and an accidental
hosted ZIP feed testable failures.

## Verification boundary

The automated suite covers exact origin acceptance/rejection, pairing-code
tenant resolution, wrong-route code rejection, pending-token denial on
heartbeat, pending commit, current/previous recovery, invalid-bearer fallback
denial, hosted ZIP closure, empty hosted onboarding URL, production manifest
and runtime contents, loopback rejection, deterministic packaging, managed
update behavior, and HTTPS-only service-worker requests.

No migration is required for 0.39; migration 36 remains current. The pairing
code uniqueness and tenant/user ownership needed by this flow have existed
since migration 2, while credential slots are supplied by migration 36.
