import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RetailerStore } from "../src/infra/store.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, "..");
const store = new RetailerStore(
  join(projectRoot, "data", "seed-state.json"),
  join(projectRoot, "runtime", "state.json"),
);
const state = await store.reset();
process.stdout.write(`Reset TruthLease retailer state to version ${state.version}.\n`);
