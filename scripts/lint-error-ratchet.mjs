#!/usr/bin/env node
// Ratchet for caller-actionable repository failures (C23/I7). A bare
// `throw new Error(` from a repository becomes an HTTP 500; caller mistakes
// should throw InputValidationError (400), DomainConflictError (409) or
// DomainNotFoundError (404). The count per file may only go down: a new bare
// throw fails `npm run check`; converting one lets you lower the baseline with
// `node scripts/lint-error-ratchet.mjs --write-baseline`.
//
// Invariant ("should never happen") throws are legitimately bare, so this
// is a ceiling, not a target of zero.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "packages", "database", "src");
const BASELINE = join(ROOT, "scripts", "error-ratchet-baseline.json");
const PATTERN = /throw new Error\(/g;

export function countBareThrows(directory = SOURCE) {
  const counts = {};
  for (const file of readdirSync(directory).filter((name) => name.endsWith("-repository.ts")).sort()) {
    const matches = readFileSync(join(directory, file), "utf8").match(PATTERN);
    if (matches?.length) counts[file] = matches.length;
  }
  return counts;
}

export function compareToBaseline(counts, baseline) {
  const over = [];
  const under = [];
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[file] ?? 0;
    const allowed = baseline[file] ?? 0;
    if (now > allowed) over.push(`${file}: ${now} bare throws (baseline ${allowed})`);
    else if (now < allowed) under.push(`${file}: ${now} (baseline ${allowed})`);
  }
  return { over, under };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = countBareThrows();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE, `${JSON.stringify({ total, files: counts }, null, 2)}\n`);
    process.stdout.write(`Wrote the error ratchet baseline: ${total} bare throws in repositories.\n`);
    process.exit(0);
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8")).files ?? {};
  } catch {
    process.stderr.write(`Missing or unreadable ${BASELINE}; create it with --write-baseline.\n`);
    process.exit(1);
  }
  const { over, under } = compareToBaseline(counts, baseline);
  if (over.length) {
    process.stderr.write(
      "New bare `throw new Error(` in a repository. Throw InputValidationError, DomainConflictError or "
      + `DomainNotFoundError for caller mistakes (packages/domain/src):\n  ${over.join("\n  ")}\n`
    );
    process.exit(1);
  }
  if (under.length) {
    process.stdout.write(`Fewer bare throws than the baseline; lower it with --write-baseline:\n  ${under.join("\n  ")}\n`);
  }
  process.stdout.write(`Error ratchet: ${total} bare throws in repositories, within the baseline.\n`);
}
