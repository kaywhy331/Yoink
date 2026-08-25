# Operator alert webhook connectors

Yoink 0.42 adds durable external delivery for the existing privacy-classified
operator alert family. It does not send product notifications, page content,
exact SKUs, account data, or purchase instructions, and it has no retailer
mutation authority.

## Trust boundary

An admin connector stores only a tenant-scoped name, enabled state, minimum
severity, `webhook` kind, opaque endpoint reference, and one-way binding
fingerprint. The admin API and UI reject URLs and signing secrets.

The deployer owns the reference registry through
`YOINK_OPERATOR_ALERT_WEBHOOKS_JSON`. Each entry has exactly:

```json
[
  {
    "reference": "ops_primary",
    "endpoint": "https://alerts.example.com/v1/yoink",
    "signingSecretEnvironment": "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY"
  }
]
```

The referenced signing-secret variable must contain 32–512 bytes in the
process that executes the worker:

```text
YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY=<random deployment secret>
```

Only exact public HTTPS endpoints are accepted. Credentials, query strings,
fragments, IP literals, localhost, redirects, and nonstandard ports are
rejected. Because DNS resolution and outbound-network policy remain deployment
responsibilities, production should additionally enforce an egress allowlist
and obtain secrets from its managed secret provider rather than a shell file.

In external-worker mode, give API and worker the same public registry. Only the
worker needs the referenced secret value. In embedded mode, the API process is
also the worker and therefore needs it. Secret values are held in process
memory, excluded from the deployment fingerprint, and never enter SQLite,
HTTP responses, audit payloads, logs, or an extension package.

## Binding and retarget protection

Yoink hashes the exact reference, normalized endpoint, and signing-secret
variable name into a public binding fingerprint. Saving an admin connector
pins that fingerprint; every queued delivery copies it. A worker leases a row
only when reference and binding both match its attested registry.

Changing a registry entry under the same reference therefore makes the
connector visibly unbound and leaves old work non-leasable. Review the change,
then explicitly re-save the connector. That action cancels outstanding rows
before pinning the new binding, so historical events are not silently sent to
a different destination.

## Payload and signature

Each request is stable JSON with contract version 1 and only:

- opaque event and incident IDs;
- lifecycle event, severity, and allowlisted reason;
- retailer, diagnostic operation, and failure stage;
- structural layout fingerprint;
- bounded occurrence and affected-entity counts;
- first-seen, last-seen, and emitted timestamps; and
- `operational_aggregate` privacy classification.

The request contains no exact product ID, URL, DOM/text, cookie, token, actor
identity, free-form note, account field, payment field, or action capability.
Headers include opaque delivery/event IDs and
`X-Yoink-Signature: sha256=<HMAC-SHA256 of exact body>`. Receivers should verify
the HMAC before parsing and deduplicate on `X-Yoink-Delivery-ID`.

## Retry and dead-letter behavior

The packaged **Alert reconciliation and dispatch** task performs at most 20
deliveries per run. Each row has a random, one-use, 15–300 second lease
capability that is stored only as a hash. HTTP 2xx completes delivery; 408,
425, 429, 5xx, timeout, and network failure retry with bounded exponential
backoff. Redirects and other HTTP failures dead-letter immediately. Attempts
stop after 12 claims.

Queued, leased, retry, delivered, dead-letter, cancelled, and expired-lease
reclaim transitions have append-only receipts. Response bodies and exception
text are discarded. Admin Alerts shows binding health and bounded delivery
metadata without capability material.

To recover:

1. fix the reviewed endpoint, signing secret, receiver, or egress policy;
2. restart API and worker with the same package and public registry;
3. require healthy worker deployment attestation;
4. if the public binding changed, explicitly re-save the admin connector; and
5. create a new qualifying alert event to verify delivery. A dedicated manual
   dead-letter replay control is intentionally not yet shipped.

Email, pager/on-call providers, a managed secret provider, DNS/IP egress
enforcement, manual per-delivery replay, production retention jobs, and
independent delivery SLO monitoring remain open.
