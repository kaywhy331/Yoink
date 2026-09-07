# TrackaLacker History price references

Sync products in the Chrome companion after updating Yoink and reloading the
extension. The signed-in TrackaLacker session supplies each listing's History
table. The sync summary reports how many listings yielded reported MSRP,
estimates, or no usable reference. Open a product's Details to see its History
amount, category, source link, source-local date/time, and matching report count.

| History row | Result |
| --- | --- |
| In Stock (MSRP), $39.99 | Reported MSRP: $39.99 |
| In Stock (~ MSRP), $93.97 | Estimated MSRP: $93.97 |
| In Stock (Under MSRP), $24.97 | MSRP unknown; $24.97 is below an unspecified MSRP |
| Price Surge, $199.99 or $214.95 | MSRP unknown |
| Out of Stock, plain In Stock, or missing price | Does not establish MSRP |

Reported MSRP means TrackaLacker explicitly labels that price MSRP; it is not
independent manufacturer verification. When multiple eligible rows exist, a
reported MSRP takes precedence over an estimate; the newest row within that
category supplies the amount. Conflicting amounts at the same newest timestamp
produce no reference. Duplicate rows across pages count once. A History row does
not set current stock or overwrite the current observed store price.

## Apply a buy price

In Settings → Quick add setups, choose:

- **MSRP** or **MSRP ± percent** to require reported MSRP.
- **MSRP (allow history estimate)** or **MSRP ± percent (allow history estimate)**
  to use a `~ MSRP` price when reported MSRP is unavailable.

For $93.97, an offset of **-10** sets the item cap to **$84.57**. Positive offsets
permit prices above the reference. Quantity, taxes, and store reserves still
use the existing total-limit review. Save the setup and select it from Quick
add, or apply it to selected plans through the existing bulk setup workflow.
Importing History alone does not enable cart actions or alter saved limits.
Linked setups use the new evidence when explicitly applied and during the
existing profile reconciliation workflow.

## Capture limits and updates

- History stays bound to the exact source listing and its mapped retailer SKU.
  It is not copied to every retailer or variant.
- The extension fetches up to three pages per listing, with a 15-second request
  timeout, a pause between requests, and a cache for duplicate listings in the
  same sync. It only follows pagination on the same TrackaLacker listing path.
- A login/security challenge, access denial, or rate limit stops further History
  enrichment in that sync. Products can still import without History. Complete
  any verification in TrackaLacker and retry once access is available.
- Unsupported or unrendered History markup yields no new reference. The parser
  reads tables with Time, Price, and Status columns; it does not guess MSRP from
  other page text or unrelated React data.
- An unavailable History page preserves previously captured evidence and its
  original date. A reported MSRP supersedes an estimate and clears the estimate.
  Inspect the displayed date before using an old reference.
- Migration 67 adds local SQLite storage for the estimate and provenance. It
  applies on API startup using the existing migration/backup mechanism. The
  hosted PostgreSQL catalog-import proof path has not gained History ingestion.

Automated tests cover the supplied categories, malformed/conflicting rows,
pagination boundaries, failed fetches, listing binding, storage, and price caps.
Browser tests exercise the displayed reference and saved estimate setup.
Live TrackaLacker HTML and Windows Chrome verification remain necessary; the
development browser encountered TrackaLacker's human-verification page.
