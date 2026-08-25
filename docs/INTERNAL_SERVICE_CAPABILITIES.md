# Internal service capability isolation

Yoink 0.55.0 removes the blanket authority previously granted to every hosted
`service` actor. Delivery processing, contributor-eligibility attestation, and
principal provisioning are separate trust domains. One internal workload
identity may receive exactly one of:

- `internal.delivery`
- `internal.eligibility`
- `internal.principal`

An unconfigured service receives no permission. A user, maintainer, or device
scope cannot carry an internal service capability. The exact local loopback
bootstrap remains the development/operator exception, and paired devices retain
only `device.self`.

## Deployment contract

Hosted mode requires `YOINK_HOSTED_SERVICE_CAPABILITIES_JSON` to be present. It
is an exact JSON object whose keys are signed service actor IDs and whose values
are one fixed capability. For example:

```text
YOINK_HOSTED_SERVICE_CAPABILITIES_JSON={"delivery_worker":"internal.delivery","identity_risk_worker":"internal.eligibility","principal_sync":"internal.principal"}
```

Use `{}` during a fail-closed deployment stage where no internal services
should be admitted. The registry accepts at most 64 actor IDs, rejects unknown
capabilities, arrays, malformed IDs, and multi-capability values, and derives a
deterministic deployment fingerprint.

The trusted proxy continues to sign tenant, user, actor, method, full path,
timestamp, assurance context, session, and one-use nonce. It does **not** sign
or forward a capability. After the signature, principal, expiry, and replay
checks pass, the API maps the verified service actor ID to the deployment-owned
registry. `X-Yoink-Service-Capability` and
`X-Yoink-Internal-Service-Capability` are rejected. The signing helper also
rejects a scope that already contains a capability.

This gives each request one server-derived capability and makes registry
omission a denial rather than a broad default.

## Defense in depth

The canonical internal routes require the matching permission:

| Route family | Required capability |
| --- | --- |
| `/api/v1/internal/delivery/*` | `internal.delivery` |
| `/api/v1/internal/observer-recipes/contributor-eligibility` | `internal.eligibility` |
| `/api/v1/internal/hosted/principals` | `internal.principal` |

The delivery, eligibility, and principal repositories repeat that exact check.
This prevents trusted in-process code from bypassing HTTP route policy. The
background maintenance runtime adds `internal.delivery` only while executing
the hosted-delivery recovery task; unrelated task families receive no internal
capability.

Public health reports policy version, configured count, coverage, and a
fingerprint. The admin Access workspace adds the per-workload capability view,
but it receives only one-way opaque actor references. Raw actor IDs, proxy
secrets, request signatures, and workload credentials are structurally absent
from both projections.

## Security boundary and remaining work

This release is authorization isolation, not cryptographic workload identity.
The HMAC proxy remains a deployment trust root: a compromised signer can still
assert any configured actor ID. Production must place the signer behind a
managed identity boundary and bind verified mTLS, OIDC workload identity, or an
equivalent short-lived workload assertion to the exact actor ID before using
this seam. It also still needs managed secret rotation, signed artifacts,
independent monitoring, incident response, and deployment-level tests proving
that different workload processes cannot obtain one another's identity.

No database migration is required. Version 0.55 changes request-boundary and
repository authorization only; retailer qualifications, evidence, mutation
lanes, purchase state, and Chrome execution contracts are unchanged.
