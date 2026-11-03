import { DataDirectoryConfigurationError, dataDirectoryArguments, resolveDataDirectory, warnAboutLegacyDataDirectory } from "../packages/database/src/data-directory.js";
import { EvidenceCapsuleStore } from "../packages/database/src/evidence-capsule-store.js";

try {
  const { args, env } = dataDirectoryArguments(process.argv.slice(2));
  const resolution = resolveDataDirectory(process.cwd(), env);
  warnAboutLegacyDataDirectory(resolution, (line) => process.stderr.write(`${line}\n`));
  if (args.includes("--print-data-dir")) {
    process.stdout.write(`${resolution.path}\n`);
  } else {
    const result = new EvidenceCapsuleStore(resolution.path).prune();
    process.stdout.write(`Pruned ${result.removed} evidence capsule${result.removed === 1 ? "" : "s"}; ${result.retained} retained.\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof DataDirectoryConfigurationError ? error.exitCode : 1;
}
