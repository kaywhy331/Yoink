# Observer recipe rooted-trust runbook

Yoink observer recipes are expiring selector data interpreted by packaged,
read-only extension code. They cannot contain JavaScript, XPath, regex,
navigation, events, forms, identity decisions, checkout, or mutation actions.
Rooted trust changes who may sign that data; it grants no retailer capability.

## Trust material

- The repository and extension package contain the public offline-root key only.
- The offline private root must be `0600`, stored outside the application host
  in production, and loaded only by the explicit issuance CLI.
- The API process loads one online intermediate private key. It never loads the
  offline root.
- SQLite and portability archives store public manifests, signatures, hashes,
  revocations, and transparency receipts—not private keys.
- Never paste a private key into `/admin`, an API request, a ticket, a log, or a
  recipe JSON field.

## Initialize a deployment

With the offline root mounted only for this operation:

```bash
npm run recipe-trust -- initialize \
  --root-private /secure/offline/observer-recipe-root-private.pem \
  --data-dir /var/lib/yoink
```

The command refuses overwrite, verifies that the private root matches the
public package pin, creates or loads the online intermediate, writes generation
one with `0600` permissions, and prints public metadata only. Start or restart
Yoink, paste the generated manifest JSON into `/admin` → Community → Observer
recipe registry, and install it. Confirm that the panel reports `SIGNING READY`,
generation 1, one manifest receipt, and one transparency event.

## Renew the current intermediate

Renew before either the manifest or active intermediate expires:

```bash
npm run recipe-trust -- renew \
  --root-private /secure/offline/observer-recipe-root-private.pem \
  --data-dir /var/lib/yoink
```

This writes `observer-recipe-trust-manifest.pending.json` without overwriting an
existing pending file. Review its public metadata, install its JSON through the
admin control, then explicitly re-sign reviewed recipes marked with an older
root generation. A renewal using the same intermediate does not require a
restart.

## Rotate or revoke an intermediate

Create a new named online intermediate and a monotonic successor manifest:

```bash
npm run recipe-trust -- rotate \
  --root-private /secure/offline/observer-recipe-root-private.pem \
  --data-dir /var/lib/yoink
```

Add `--revoke-current` when the previous active key must become permanently
invalid, or `--revoke <key-id,...>` for other known keys. Revocations cannot be
removed by later manifests. Installation records the new public manifest and
activates its file, but signing intentionally remains closed until the API
process is restarted and loads the new fingerprint-named private key. After
restart:

1. Confirm `/admin` reports the new generation and `SIGNING READY`.
2. Explicitly re-sign each reviewed active recipe marked with an older
   generation.
3. Confirm paired-companion trials resume and transparency events advance.
4. Remove the reviewed pending-manifest copy through the host's controlled
   secret/configuration process; do not overwrite it in place.

Companions accept the rotation only when the server supplies the complete
root-signed chain extending their stored generation. Older generations,
conflicting hashes, removed revocations, missing prior keys, expired manifests,
and recipes signed by retired or revoked keys fail closed.

## Recovery

If the active manifest expires, recipe promotion and distribution close, but
the historical root signature remains usable to validate a monotonic recovery
successor. Issue a renewal if the current intermediate remains trusted and its
private key is available; otherwise rotate and revoke it. Never delete or edit
an installed manifest/transparency row. If the manifest file and immutable
database receipt disagree, stop distribution, restore a verified backup, and
reconcile the exact manifest hashes before continuing.

The development ZIP feed packages `observer-recipe-root.js` but never any
private key or manifest private material. Production extension release and an
independently witnessed transparency checkpoint remain separate deployment
controls.
