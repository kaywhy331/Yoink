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
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run([
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=2",
  ...applicationTests
], "Running application and cutover contract tests");

run([
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=1",
  nativeTest
], "Running the native PostgreSQL proof in isolation");
