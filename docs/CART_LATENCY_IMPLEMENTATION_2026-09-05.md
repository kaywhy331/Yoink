# Faster adapter visibility checks · 2026-09-05

Product-page scans no longer normalize absent or empty inline style attributes. The Target and shared retailer visibility helpers retain the existing normalization for every nonempty attribute, including whitespace, uppercase CSS and hidden ancestors. Computed visibility, challenge detection, exact offer validation, fulfillment selection, one-use Add authorization and cart-delta verification retain their existing behavior. No observation or purchase decision is cached.

This implements the measured fast path from the [latency audit](CART_LATENCY_AUDIT_2026-09-05.md). Earlier offer preparation, product-tab warming, navigation readiness probes and consolidation across inspection passes remain separate work; this change claims no live signal-to-cart improvement.

## Version and release consistency

| Store | Add contract | Observer contract |
| --- | --- | --- |
| Target | `target-add-v9` | `target-observer-v7` |
| Walmart | `walmart-add-v9` | `walmart-observer-v8` |
| Amazon | `amazon-add-v10` | `amazon-observer-v9` |
| Best Buy | `bestbuy-add-v15` | `bestbuy-observer-v13` |

The shared helper also serves the Walmart drawing observer and all nine other store observers. Walmart drawing is v2; Disney, Ravensburger, Riot, Books-A-Million, Fanatics, Kohl's and Macy's are v2; P-Bandai and Pokémon Center are v3. Selector packs are unchanged by this task.

The companion's generated version registry, lane registry, action runners, observer bundles and dependent contract bundles are rebuilt. Admin activation confirmations match their current lane contracts, covered by a registry parity check. Qualification coverage descriptions use current version constants instead of hardcoded versions. Existing qualification/renewal rules remain authoritative; a version update does not grant first activation.

Best Buy contract IDs were allocated above the pre-existing, uncommitted v14/v12 work to avoid reusing an adapter identity. That separate Best Buy and 1.22.6 release work remains outside this commit. The commit is verified independently against committed source, as well as with the existing workspace changes when integrated. Packaging is local verification; no running service or installed companion is restarted by this task.

## Reproducible comparison

Run:

```sh
node --import tsx scripts/benchmark-cart-latency.mjs /tmp/yoink-cart-latency.json
```

The benchmark verifies that all four packaged runners exactly match their source builds. It compares those packages with an in-memory reference that restores only the old empty-style normalization. There are 5 warmups and 20 measured iterations per timing cell, with small commerce fixtures and approximately 9,000-element pages. Each variant runs in isolated Chromium contexts, with intercepted network access and fixture-only clicks.

Both variants exercise current offers, prior rehearsal, changed price/seller, replaced/disabled Add, a new security challenge, hidden ancestors, empty/whitespace/nonempty visible styles, hidden visibility, `aria-hidden`, the `hidden` attribute, expired authorization and duplicate commit. Amazon additionally changes its offer token. Best Buy additionally changes fulfillment after preparation; when the separate pending Shipping-selection implementation is present, its successful/failed selection scenarios run too. The output records which bundle supports that capability. No scenario is reported as having tested an unavailable implementation.

Clean commit benchmark: **16 timing cells / 320 measured iterations / 116 scenario cases passed**. [Raw measurements and bundle hashes](evidence/cart-latency-implementation-2026-09-05.json).

Large-fixture preparation + final checks + fixture click:

| Store | Previous algorithm p50 | Packaged optimization p50 | Previous p95 | Optimized p95 |
| --- | ---: | ---: | ---: | ---: |
| Target | 1,459.5 ms | 500.0 ms | 2,432.4 ms | 605.1 ms |
| Walmart | 1,816.6 ms | 319.3 ms | 2,926.5 ms | 413.2 ms |
| Amazon | 2,556.2 ms | 440.4 ms | 3,734.0 ms | 884.5 ms |
| Best Buy | 2,444.4 ms | 1,755.5 ms | 3,748.3 ms | 2,111.7 ms |

These are local CPU-stage measurements on synthetic pages, not live signal-to-cart times. Shared-host load caused material variance; the raw evidence retains both p50 and p95. The original audit also included separate, pending Best Buy changes, so compare each run against its own reference rather than attributing cross-run differences to this optimization. The clean commit lacks the pending automatic Shipping selector and therefore runs 116 rather than 120 scenarios.

## Validation

- Clean commit: `npm run check`, full extension/TypeScript build and local companion packaging passed. The adapter/capsule suite passed 139 tests; the added registry activation check also passed. The four-store packaged benchmark passed all 116 scenarios and 320 measured iterations.
- The broad `npm test` application phase completed 958 checks: 956 passed and two automatic-requalification fixtures failed because they hardcoded v7 as an unshipped Target observer. The fixtures now derive a future version from the packaged version; both corrected cases passed on rerun. No runtime code change was needed. The wrapper stopped before PostgreSQL because of those initial fixture failures, so its proof runs separately. A single successful full `npm test` invocation is not claimed.
- Combined workspace: `npm run check` and `npm run build` passed with the pre-existing Best Buy/release changes. All 153 adapter/capsule checks and all 145 extension-runtime/registry checks passed, including the corrected version-skew cases. This verifies the combined source without putting those unrelated changes in the commit.
- `node --check scripts/benchmark-cart-latency.mjs` and staged whitespace checks passed. All four packaged runner builds were byte-compared to their source by the benchmark.
- The isolated verification package is `/tmp/yoink-latency-package/Yoink-Companion-1.22.3.zip`, SHA-256 `f20e7a74522a42cab75a4ca6ec54acff0106097201a291a082abc773978b6d0f`. It uses the committed package version; the existing 1.22.6 release edits remain separate. Its local release recheck found no captures in the isolated data directory; promoted-corpus replay is covered by the adapter suite above.

The isolated native PostgreSQL proof passed: **1 proof, 0 failures**, in 13 minutes 11 seconds (`npm run test:postgres:native`, exit 0).
