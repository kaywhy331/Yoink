#!/usr/bin/env node
// Refuses a git index that holds a file under data/ or any *.pem / *.key file
// (YOINK-DATA-DIR). The data directory keeps the Ed25519 signing keys and the
// YoinkBot secret key, and .gitignore alone gives way to one `git add -f`.
// The index is what the next commit records, so this catches a staged key in
// the pre-commit hook and a committed one in CI; `npm run check` runs it.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = [/^data\//, /\.pem$/i, /\.key$/i];

export function forbiddenPaths(paths) {
  return paths.filter((path) => FORBIDDEN.some((pattern) => pattern.test(path)));
}

/** Every path in the index, repository-relative; null outside a git work tree. */
export function indexedPaths(cwd = process.cwd()) {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  const listed = spawnSync("git", ["ls-files", "-z", "--full-name", "--", ":/"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  return listed.stdout.split("\0").filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = indexedPaths();
  if (!paths) {
    process.stdout.write("Secret files: not a git work tree, nothing staged to check.\n");
    process.exit(0);
  }
  const found = forbiddenPaths(paths);
  if (found.length) {
    process.stderr.write(
      "Files from the data directory or private keys are staged or committed. Keys and data never belong in git:\n  "
      + `${found.join("\n  ")}\n`
      + "Unstage them with `git rm --cached <path>` (the file stays on disk) and keep them in the data directory outside the repository.\n"
      + "A key that was already pushed is exposed: replace it, do not just delete the file.\n"
    );
    process.exit(1);
  }
  process.stdout.write(`Secret files: none of ${paths.length} indexed files is under data/ or a *.pem / *.key file.\n`);
}
