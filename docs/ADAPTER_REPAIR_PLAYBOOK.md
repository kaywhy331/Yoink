# Adapter repair playbook

Use this workflow only on a local-profile Yoink installation. Page snapshots
and decision traces stay in `data/evidence` on the machine that captured them.
They must never be pasted into alerts, hosted diagnostics, community evidence,
portability exports, observer recipes, or any hosted request.

## Repair one incident

1. Claim the incident in **Admin → Retailers → Adapter repair queue**, or note
   the incident ID in the change you are starting. Work on one store and one
   structural fingerprint at a time.
2. Run `npm run repair -- <incident-id | retailer:fingerprint | capsule-id>`.
   The command is read-only. Confirm that it names the recorded failure, the
   packaged selector field, bounded candidate elements, and a promotion
   command.
3. Run the printed replay command with `--expect reproduce`. Stop if replay
   does not reproduce: inspect the recorded versions and trace before editing
   anything.
4. Prefer a selector-pack edit when the packaged grammar can express the
   repair. Change adapter code and bump that store's contract only when it
   cannot. Never load an Add-control selector remotely, and never infer
   visibility, selection, or scope from page-provided attributes.
5. Run replay again with `--expect pass`. The stored page must pass under the
   edited sources without visiting the live store.
6. Run the printed `npm run capsule:promote` command. Review the re-sanitized
   output and privacy scan. An `--allow` exception needs a specific, recorded
   reason; it is not a way to bypass review.
7. Run `npm run check` and `npm run test:adapters` while iterating; the fast
   lane covers pack lint, the promoted corpus, the adapter and runner tests,
   and the corpus-to-server contract check in about a minute. Run the complete
   non-native application suite once before the commit. Use a commit such as
   `fix: walmart price selector (<incident-id>)`.
8. Run `npm run release:local`. It builds the app, packages the companion
   (packaging replays the newest capsule for every open or superseded repair
   group first; a passing replay moves its incident to **Fixed, waiting for a
   live check**), restarts the `yoink-local-api` user unit, waits for health,
   and prints the versions the running app now expects. The app must be
   restarted: it runs from the compiled `dist` tree, and a stale app silently
   skips renewal for a new pack version and answers a new contract version
   with a version mismatch. An unpacked local companion reloads itself within
   a minute of the app reporting new versions; a ZIP install needs a reload on
   `chrome://extensions`. Then use **Check stores now** in the companion menu
   (or wait for the hourly automatic run) and confirm that the live packaged
   diagnostic resolves the incident and the store reports renewed.

The normal verification commands are:

```bash
npm run check
npm run test:adapters                                   # fast lane while iterating
node --import tsx --test --test-concurrency=2 test/*.test.ts
npm run build:extension
npm run test:postgres:native
```

Run the application suite without `test/postgres-native.test.ts` when the
native proof is being run separately. A selector-pack-only change must not
retire an existing authorization; it temporarily reports **Store check pending
after update** until one current packaged check passes. First activation and
manual retirement always remain explicit admin actions.

## Release recheck and incident closure

`npm run capsules:recheck` is safe to run independently. It reads the local
capsule index and SQLite ledger, replays only the newest available snapshot for
each eligible group with packaged bundles, and records an
`adapter_repair_recheck` audit event. It never writes selector packs or adapter
sources. A later matching packaged diagnostic either resolves the incident
with `adapter_fixed_by_replay` or reopens it with
`regressed_after_replay_fix`.

To measure the closure target (M7), run this read-only query for the release
window. It reports every resolution outcome rather than hiding non-fix
closures:

```sql
SELECT
  COALESCE(NULLIF(resolution_code, ''), '(unresolved)') AS resolution_code,
  COUNT(*) AS incidents
FROM operator_alert_incidents
WHERE event_family = 'adapter_repair'
  AND first_seen_at >= '2026-09-04T00:00:00.000Z'
GROUP BY COALESCE(NULLIF(resolution_code, ''), '(unresolved)')
ORDER BY incidents DESC, resolution_code;
```

For the target percentage, divide resolved incidents whose code is
`adapter_fixed_by_replay` or `adapter_recovered` by all resolved adapter-repair
incidents opened in the same window. Investigate every `adapter_aged_out` or
manual resolution separately.

## Safety boundary

Repairs do not change the purchase boundary: exact item, first-party seller,
quantity one, Shipping by default or explicit Pickup, fresh page evidence,
per-store authorization, and manual checkout/order submission. Do not automate
challenges, queues, sign-in, checkout, payment, or order placement. A stored
snapshot is debugging evidence, never authorization to click.
