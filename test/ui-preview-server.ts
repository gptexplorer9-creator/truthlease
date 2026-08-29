import { resolve } from "node:path";

import express from "express";

import { completeFeed } from "./ui-fixtures.js";

const app = express();
const projectRoot = resolve(process.cwd());
const port = 4179;

app.get("/api/cases/:leaseId/events", (request, response) => {
  const pending = request.params.leaseId === "TL-PENDING";
  const sourceFeed = completeFeed();
  if (request.params.leaseId !== sourceFeed.caseId && !pending) {
    response.status(404).json({ error: "fixture_case_not_found" });
    return;
  }
  const feed = {
    ...sourceFeed,
    caseId: request.params.leaseId,
    status: "reference_fixture_not_live",
    lastSequence: pending ? 4 : sourceFeed.lastSequence,
    events: pending ? sourceFeed.events.slice(0, 4) : sourceFeed.events,
  };
  const after = Number(request.query.after ?? -1);
  response.json({
    ...feed,
    events: feed.events.filter((event) => event.sequence > after),
  });
});

app.use("/ui", express.static(resolve(projectRoot, "dist", "src", "ui")));
app.use(express.static(resolve(projectRoot, "public")));

app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`TruthLease labeled reference fixture at http://127.0.0.1:${port}\n`);
});
