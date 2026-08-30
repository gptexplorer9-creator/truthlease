import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileConnectorStateStore } from "../src/connector/index.js";

describe("connector file state store", () => {
  it("persists and reloads connector state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "truthlease-connector-state-"));
    const statePath = join(directory, "state.json");

    const store = new FileConnectorStateStore({ path: statePath });
    const initial = {
      cursor: { eventId: "e1", sequence: 1 },
      lastBatchId: "batch-1",
      updatedAt: "2026-08-29T00:00:00.000Z",
    };

    await store.save(initial);
    const reloaded = await store.load();
    expect(reloaded).toEqual(initial);

    await rm(directory, { recursive: true, force: true });
  });

  it("rejects invalid persisted payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "truthlease-connector-state-"));
    const statePath = join(directory, "state.json");

    await writeFile(statePath, "malformed", "utf8");
    const store = new FileConnectorStateStore({ path: statePath });

    await expect(store.load()).rejects.toBeTruthy();
    await rm(directory, { recursive: true, force: true });
  });
});
