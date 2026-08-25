# Recoverable Chrome device credential rotation

Yoink 0.38 replaces indefinitely static Chrome bearer credentials with a
recoverable two-phase rotation protocol. The companion renews an eligible
credential after 30 days without asking the user to pair again. Rotation changes
only device authentication; it cannot grant a permission, qualify a retailer,
resume actions, or create browser work.

The server stores only domain-separated SHA-256 token hashes. A raw current or
pending token appears only once in its origin-bound pairing/begin response and
in the extension's trusted local storage; a hosted transport must use HTTPS.
Device credentials, including pending values, never enter the dashboard, audit
data, telemetry, user export, or error messages.

## Why rotation has two phases

Replacing a bearer token in one request can strand a browser when the server
commits but the response is lost. Yoink therefore separates preparation from
commit:

1. The companion authenticates with its current credential and requests
   `POST /api/v1/devices/self/credential-rotation/begin`.
2. The server hashes a random 256-bit pending credential, binds it to exactly
   the next generation, and expires it after 10 minutes. The current credential
   remains current.
3. The companion validates and persists the pending token before attempting
   commit.
4. The companion authenticates the commit request with the pending token and
   its exact generation.
5. The server atomically promotes that hash, clears the pending slot, and keeps
   the former current hash for a two-minute in-flight-request grace period.
6. Only after a valid commit receipt does Chrome replace its locally stored
   current token.

Commit is idempotent for the exact promoted token and generation. If the commit
response is lost, the pending token is already durable in Chrome; the next
health cycle retries commit before using the old token for heartbeat. If a
begin response is lost, the old token was never displaced and a later begin
simply replaces the inaccessible pending hash. An expired or malformed pending
token cannot authenticate any ordinary device API.

## Fail-closed boundaries

- Begin requires the exact current credential. A previous-grace credential
  cannot start another rotation.
- Commit accepts only the exact unexpired pending token and next generation, or
  the exact already-promoted token/generation for idempotent recovery.
- Pending tokens cannot read observations, contribute evidence, lease work, or
  send a heartbeat.
- The previous token expires after two minutes and cannot begin rotation even
  during that grace window.
- Revocation atomically disables the device and clears pending and previous
  hashes.
- A malformed local pending record is discarded by the packaged extension
  normalizer. A transient commit outage retains a valid pending record for the
  next health cycle.
- All rotation routes remain Chrome-origin restricted, tenant/user scoped,
  `no-store`, authenticated, audited, and represented in closed operational
  telemetry as `device.credential_rotation`.

The protocol prevents normal network loss or service-worker suspension from
forcing re-pairing. It does not make a stolen current bearer harmless: until
rotation or revocation, that bearer has the same device authority it had before.
Production still requires TLS, a package-allowlisted extension ID/origin,
secrets and incident operations, device-risk monitoring, and a production
identity lifecycle.

Yoink 0.39 subsequently wires this lifecycle through the hosted scope resolver:
pending tokens can reach only commit, unexpired previous tokens retain their
bounded ordinary-device grace, and one-time pairing establishes the exact
tenant scope without proxy identity headers. The hosted server also requires
an explicit production extension-origin allowlist. See
[hosted Chrome device transport](HOSTED_DEVICE_TRANSPORT.md).

## Persistence and operations

Migration 36 adds credential generation, issued time, pending-hash/expiry, and
previous-hash/expiry state to `extension_devices`. Cross-field triggers reject
partial pending or previous slots, and partial unique indexes prevent hash
reuse within each recovery slot. Existing devices are backfilled at generation
one with their original creation time; migration does not rotate or expose an
existing token.

The admin companion list shows only generation, readiness, and pending status.
Health and the admin snapshot advertise
`rotatableDeviceCredentials=true` and
`recoverableTwoPhaseDeviceCredentialRotation=true`. Those flags describe the
authentication protocol only. Target and Walmart retain their existing
qualification state, while Amazon, Best Buy, marketplace, pickup, checkout,
drawing entry, payment, and order submission remain closed unless separately
qualified and authorized.
