import express from "express";
import { Pool } from "@neondatabase/serverless";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RetailerStore } from "./src/infra/store.js";
import { createPostgresLedgerDatabase, TruthLeaseLedger, type PostgresPool } from "./src/ledger/index.js";
import { createApp } from "./src/mcp/server.js";

const projectRoot = resolve(process.cwd());
const store = new RetailerStore(
  join(projectRoot, "data", "seed-state.json"),
  join(tmpdir(), "truthlease-hosted-read-only-state.json"),
);

const databaseUrl = process.env.DATABASE_URL;
const ledger = databaseUrl
  ? new TruthLeaseLedger(
      createPostgresLedgerDatabase(
        new Pool({ connectionString: databaseUrl }) as unknown as PostgresPool,
      ),
    )
  : undefined;
const connectorToken = process.env.TRUTHLEASE_CONNECTOR_TOKEN;
const connectorId = process.env.TRUTHLEASE_CONNECTOR_ID ?? "local-trueforge";

const app = express();
app.disable("x-powered-by");
app.get("/", (_request, response) => {
  response.redirect(302, "/index.html");
});
app.use(createApp(store, {
  projectRoot,
  hostedReadOnly: true,
  ...(ledger ? { ledger } : {}),
  ...(connectorToken
    ? { connectorAuth: { connectors: { [connectorId]: { kind: "bearer", token: connectorToken } } } }
    : {}),
}));

export default app;
