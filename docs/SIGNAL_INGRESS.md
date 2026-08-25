# Durable signal ingress

Yoink 0.36 moves authenticated TrackaLacker device-signal evaluation out of
the HTTP request lifecycle. The device endpoint validates and stores one
normalized message before returning `202`; the embedded or standalone worker
then runs the packaged signal engine for the same tenant and user.

This boundary does not widen retailer execution. Signal evaluation may create
the mission or action job already allowed by reviewed user policy, but the
worker cannot click a browser control, enter checkout, submit an order, or
change a user's preferences. Chrome still performs its independent current-page
verification and every retailer mutation gate remains separate.

## Request contract

`POST /api/v1/devices/self/sources/trackalacker/signals` performs these steps:

1. Authenticate the paired device and bind its tenant/user scope.
2. Enforce the TrackaLacker push schema and exact `Idempotency-Key`.
3. Normalize timestamps, source connection, product/listing identity, offer
   evidence, and canonical credential-free URLs.
4. Discard the ephemeral retailer offer ID after deriving its one-way offer
   fingerprint.
5. In one SQLite transaction, accept or deduplicate a `signal_event_v1` inbox
   message and enqueue an immediate priority-80 wake for the packaged
   `hosted_delivery_recovery` worker family.
6. Return a durable receipt; do not invoke `SignalEngine.process()` in the
   device request.

The response reports `processingState` as `queued`, `processed`, or
`dead_letter`. `backgroundWakeState` is one of:

- `created`: a new immediate worker task was stored;
- `deduplicated`: an active wake already covers this exact inbox message;
- `schedule_paused`: the signal is durable, but its operator-controlled work
  family is paused;
- `not_required`: the exact inbox message was already processed or stopped in
  dead letter.

The extension treats any successful `202` as durable acceptance. Repeating the
same signal and payload returns the same inbox receipt. Reusing its idempotency
identity for different content fails closed.

The local/manual `POST /api/v1/signals` compatibility endpoint remains
synchronous. It is not used by authenticated Chrome signal delivery and should
not be presented as the production device path.

## Worker contract

The worker leases only inbox rows whose event type is exactly
`signal_event_v1`; unrelated hosted inbox contracts remain available to their
own consumers. One task handles at most 25 signal messages. For each message it:

1. claims a one-use 60-second capability;
2. verifies the packaged TrackaLacker source/parser contract;
3. runs the existing transactional, transport-idempotent signal engine;
4. acknowledges the inbox capability only after signal processing commits.

Parser or evaluation failures retain only the fixed
`signal_processing_failed` code and retry after 30 seconds. Twenty failed inbox
claims end in dead letter. The packaged recovery schedule runs every 15 seconds
as a fallback; migration 35 changes only an untouched 0.35 default schedule,
so an operator-customized interval is not overwritten.

If signal processing commits but the inbox acknowledgement is uncertain, the
worker does not write a contradictory retry acknowledgement. The inbox lease is
left to expire. Recovery issues a new capability, and the signal engine's
transport idempotency converts the replay into a duplicate without applying the
signal twice.

Pausing **Signal inbox and delivery recovery** stops new immediate wakes and
periodic draining. Intake remains available and accepted rows remain durable.
Resuming the schedule makes it due immediately; a duplicate device delivery
can also create the deduplicated wake after resume.

## Privacy and retained data

The inbox payload contains the normalized signal contract needed for later
evaluation: source IDs, exact retailer identity, canonical URL, price/status,
seller and fulfillment claims, bounded notification evidence, and parser
version. It is tenant/user scoped and size bounded.

The payload does not contain:

- raw retailer offer IDs;
- push endpoints or subscription keys;
- device bearer tokens;
- cookies, authorization headers, CSRF/session material, or signed URL query
  parameters;
- worker or inbox lease capabilities.

Payload hashes, task capability hashes, fixed result counters, and append-only
receipts are durable. Raw capabilities are returned only to the process that
holds the lease and never appear in the admin API.

## Operations and recovery

Use **Admin → Operations → Background work** or
`GET /api/v1/admin/workers`. The projection includes:

- accepted, processing, retrying, processed, and dead-letter signal counts;
- the worker schedule, queued task state, bounded result counters, and
  heartbeats;
- dead-letter metadata limited to random inbox ID, attempt count, fixed error
  code, timestamps, and `operational_aggregate` classification.

After deploying a parser or evaluator correction, an operator with
`worker.manage` may use **Retry corrected signal**. The corresponding endpoint
is:

```text
POST /api/v1/admin/workers/signal-inbox/{inbox_id}/retry
```

It atomically resets only that dead-lettered `signal_event_v1` row, writes an
audit/outbox receipt, and enqueues or defers a worker wake according to the
current schedule. It returns `409` if another operator or worker already moved
the message. Retrying without correcting a deterministic defect only consumes
the bounded attempt budget again.

Health advertises `durableSignalIngress=true` and
`signalEvaluationOutsideDeviceRequest=true`. An external deployment is healthy
only when the separately supervised worker heartbeat covers every persisted
principal. SQLite remains a local/staging boundary; PostgreSQL fleet safety,
production identity, PITR, and hosted cutover remain roadmap gates.
