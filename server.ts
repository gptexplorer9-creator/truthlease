import express from "express";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RetailerStore } from "./src/infra/store.js";
import { createApp } from "./src/mcp/server.js";

const projectRoot = resolve(process.cwd());
const store = new RetailerStore(
  join(projectRoot, "data", "seed-state.json"),
  join(tmpdir(), "truthlease-hosted-read-only-state.json"),
);

const app = express();
app.get("/", (_request, response) => {
  response.redirect(302, "/index.html");
});
app.use(createApp(store, { projectRoot, hostedReadOnly: true }));

export default app;
