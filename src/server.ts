import { join, resolve } from "node:path";

import { RetailerStore } from "./infra/store.js";
import { createApp } from "./mcp/server.js";

const projectRoot = resolve(process.env.TRUTHLEASE_PROJECT_ROOT ?? process.cwd());
const host = process.env.TRUTHLEASE_HOST ?? "127.0.0.1";
const port = Number(process.env.TRUTHLEASE_PORT ?? "8787");
const statePath = process.env.TRUTHLEASE_STATE_PATH ?? join(projectRoot, "runtime", "state.json");

if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("P0 may bind only to 127.0.0.1 or localhost.");
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid TRUTHLEASE_PORT: ${String(process.env.TRUTHLEASE_PORT)}`);
}

const store = new RetailerStore(join(projectRoot, "data", "seed-state.json"), statePath);
await store.read();

const app = createApp(store);
app.listen(port, host, () => {
  process.stdout.write(`TruthLease MCP listening on http://${host}:${port}/mcp\n`);
});
