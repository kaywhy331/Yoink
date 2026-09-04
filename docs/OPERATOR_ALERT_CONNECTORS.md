# Operator alert webhook connectors

Yoink 0.42 adds durable external delivery for the existing privacy-classified
operator alert family. Version 0.43 adds governed dead-letter replay and a
sanitized health/SLO projection. Neither release sends product notifications,
page content, exact SKUs, account data, or purchase instructions, and neither
has retailer mutation authority.

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
Evidence-capsule IDs, snapshot content, and adapter decision traces are also
excluded. They remain local even when an adapter-repair incident is routed to
an external connector.
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

Queued, leased, retry, delivered, dead-letter, cancelled, expired-lease reclaim,
and operator replay transitions have append-only receipts. Response bodies and
exception text are discarded. Migration 40 also makes the database reject any
delivery transition that changes the tenant, connector, incident/event,
endpoint binding, payload, payload hash, idempotency identity, privacy class, or
creation evidence. A twelfth claim lost to process failure becomes a dead
letter after its lease expires instead of remaining stranded.

## Governed manual replay

An `alert.manage` operator may replay only a current dead letter. The request
contains exactly one allowlisted operational reason and
`RETRY_OPERATOR_ALERT_CONNECTOR_DELIVERY` confirmation. Replay is rejected when
the connector is disabled, its saved configuration changed, its deployment
binding is unavailable or drifted, the delivery is not dead-lettered, another
request already moved it, it belongs to another tenant, or three prior manual
replays exist.

An accepted replay resets only mutable attempt state. It reuses the original
delivery ID, event ID, stable payload bytes and hash, receiver idempotency
identity, endpoint reference, and exact binding fingerprint. The operator
cannot edit the message or select a new destination. Each replay and reason is
written to both the append-only delivery event chain and audit/outbox history.
Receivers must continue to deduplicate on `X-Yoink-Delivery-ID` because a
successful response may have been lost before the original dead letter.

## Health and delivery SLO

Admin Alerts derives connector state from operational receipts only:

- `disabled` and `unbound` describe configuration gates;
- `idle` is a bound connector with no current or 24-hour activity;
- `healthy` has only on-time active work or accepted delivery;
- `degraded` has a retry, recovered dead letter, or active work older than the
  five-minute target in the rolling 24-hour window; and
- `critical` has an unresolved dead letter or active work older than 15
  minutes.

The projection exposes active/dead-letter counts, accepted and dead-letter
outcomes, retry count, oldest-active age, last terminal timestamps, and a
receipt-derived success percentage. It exposes no payload, endpoint, binding
fingerprint, secret, response body, capability, SKU, URL, or user identity. It
is an in-application operational projection, not an independent external SLO
monitor.

To recover:

1. fix the reviewed endpoint, signing secret, receiver, or egress policy;
2. restart API and worker with the same package and public registry;
3. require healthy worker deployment attestation;
4. if the public binding changed, explicitly re-save the admin connector; old
   work cannot be retargeted and must remain cancelled/dead-lettered;
5. for an unchanged exact binding, use **Replay once** on the eligible dead
   letter and verify the receiver deduplicates the stable delivery ID; and
6. confirm the 24-hour projection returns from critical to degraded and then
   healthy or idle as retained receipt history advances.

Email, pager/on-call providers, a managed secret provider, DNS/IP egress
enforcement, production connector-retention jobs, and independent delivery SLO
monitoring remain open.

## Replay-verified repair state

A local release recheck can move an adapter-repair incident to
`fixed_pending_live`. Connector copy says that the packaged replay passes and
that a live store check is still required; it never includes the capsule ID,
snapshot, trace, candidate selector, or repair command. The first later
matching packaged diagnostic resolves it with `adapter_fixed_by_replay`. A
matching adapter-defect failure reopens it with
`regressed_after_replay_fix`. See the
[adapter repair playbook](ADAPTER_REPAIR_PLAYBOOK.md).
