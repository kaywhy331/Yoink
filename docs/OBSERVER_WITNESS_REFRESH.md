# Observer-recipe witness refresh

Yoink 0.40 schedules renewal of independently signed observer-recipe
transparency receipts. It does not operate the witness, hold its private key,
or replace independent public-log monitoring.

## Safety contract

The fixed `observer_recipe_witness_refresh` task runs every 60 seconds with at
most five attempts. It accepts no remote payload and has no retailer, browser,
checkout, payment, or recipe-mutation capability. A run may only:

1. bind the installed root-signed public manifest to the latest append-only
   local transparency event;
2. reuse a matching receipt while both configured freshness and signed
   validity remain comfortably ahead;
3. publish the exact bounded checkpoint and previous receipt hash to the pinned
   HTTPS witness; or
4. accept a fully verified chained Ed25519 receipt, or record one bounded
   failure class and retry.

No checkpoint is a successful no-op. Local mode without witness configuration
is also an explicit no-op. Hosted recipe delivery remains closed whenever the
required current receipt is absent, stale, invalid, or inconsistent.

## Hosted configuration

Set the same complete values on the API and standalone worker:

```text
YOINK_OBSERVER_RECIPE_WITNESS_URL=https://witness.example.net/v1/checkpoints
YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID=yoink-production
YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID=<sha256 of witness Ed25519 SPKI>
YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI=<base64url DER SPKI>
YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS=900
```

The four identity/key values are all-or-none and validated identically by both
processes. Hosted API and hosted worker startup refuse an absent configuration.
Keep the endpoint in a separate administrative trust domain and never put the
witness private key on either Yoink process.

The API remains the migration owner. Start it first so migration 37 creates the
sixth schedule, then start the exact same packaged worker against the same data
directory. Stop the worker before migrating or stopping the API.

## Signing-key isolation

The API owns the existing observer trust lifecycle. The standalone worker does
not load that intermediate private signer. On every refresh run it loads and
validates only the root-signed public manifest from the configured data
directory, allowing a reviewed public rotation to take effect without restart.
The checkpoint is rejected unless that public manifest, the installed database
manifest, and the latest transparency event agree exactly.

The witness client has only its endpoint, log namespace, pinned Ed25519 public
key, and maximum receipt age. The independent witness private key never enters
Yoink, SQLite, extension packages, logs, exports, or backups.

## Operations and recovery

Health and the Admin Operations workspace expose only fixed configuration,
state, delivery, sequence, attempt, and error-code facts. Raw witness responses,
exception text, selectors, tenant IDs, and private key material are excluded.

For a refresh failure:

1. confirm the API remains healthy and migration 37 is current;
2. compare all five public witness settings on API and worker;
3. verify the separately operated witness and its public log independently;
4. confirm the installed root-signed public manifest matches the database
   manifest and transparency tip;
5. correct the service, network, pin, or reviewed manifest deployment; then
6. retry the stopped task through the authorized Operations control, or use the
   admin publish operation only for explicit bootstrap/recovery.

Never delete receipts, reset sequences, disable the schedule, extend freshness,
copy a private signer to the worker, or bypass hosted recipe delivery to recover
availability. Pin rotation is a reviewed deployment change. Production still
needs an independently operated witness, public consistency monitor, external
alert delivery, PostgreSQL worker fleet, production identity/secrets, and
tested outage procedures.
