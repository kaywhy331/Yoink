import { resolve } from "node:path";
import { EvidenceCapsuleStore } from "../packages/database/src/evidence-capsule-store.js";

const requestedDataDirectory = String(process.env.YOINK_DATA_DIR ?? "data").trim();
if (!requestedDataDirectory) throw new Error("YOINK_DATA_DIR must identify a non-empty directory.");
const dataDirectory = resolve(process.cwd(), requestedDataDirectory);
const result = new EvidenceCapsuleStore(dataDirectory).prune();
process.stdout.write(`Pruned ${result.removed} evidence capsule${result.removed === 1 ? "" : "s"}; ${result.retained} retained.\n`);
