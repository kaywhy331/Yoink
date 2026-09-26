import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const testFiles = readdirSync(new URL("../test/", import.meta.url))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => `test/${file}`);
const nativeTest = "test/postgres-native.test.ts";
const applicationTests = testFiles.filter((file) => file !== nativeTest);

// Timeouts so one hung socket or jsdom window fails instead of hanging
// `npm test` forever (PLAT-17); node:test defaults to Infinity. With the
// runner's process isolation, --test-timeout bounds each whole test FILE, not
// each test, so these are per-file budgets sized well above the slowest
// healthy file on a loaded host.
const APPLICATION_TEST_TIMEOUT_MS = Number(process.env.YOINK_TEST_TIMEOUT_MS || 900_000);
const NATIVE_TEST_TIMEOUT_MS = Number(process.env.YOINK_NATIVE_TEST_TIMEOUT_MS || 1_800_000);

function run(args, label) {
  console.log(`\n${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

// Both suites always run, so a red application suite still tells you whether
// the native PostgreSQL proof broke too; the exit status is the worst of the two.
const statuses = [];
statuses.push(run([
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=2",
  `--test-timeout=${APPLICATION_TEST_TIMEOUT_MS}`,
  ...applicationTests
], "Running application and cutover contract tests"));

statuses.push(run([
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=1",
  `--test-timeout=${NATIVE_TEST_TIMEOUT_MS}`,
  nativeTest
], "Running the native PostgreSQL proof in isolation"));

const failed = statuses.find((status) => status !== 0);
if (failed !== undefined) {
  console.error(`\nTests failed (application ${statuses[0]}, native PostgreSQL ${statuses[1]}).`);
  process.exit(failed);
}
