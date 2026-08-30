import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RetailerStore } from "../src/infra/store.js";
import { createApp } from "../src/mcp/server.js";

describe("hosted read-only deployment boundary", () => {
  let httpServer: Server;
  let origin: string;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "truthlease-hosted-"));
    const store = new RetailerStore(
      join(process.cwd(), "data", "seed-state.json"),
      join(directory, "state.json"),
    );
    httpServer = createServer(
      createApp(store, { projectRoot: process.cwd(), hostedReadOnly: true }),
    );
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const address = httpServer.address();
    if (address === null || typeof address === "string") throw new Error("Missing test port.");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  it("serves health in explicitly read-only mode", async () => {
    const response = await fetch(`${origin}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", mode: "hosted_read_only" });
  });

  it("applies restrictive browser security headers", async () => {
    const response = await fetch(`${origin}/`);

    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'none'");
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), geolocation=(), microphone=()",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("fails the local TrueForge bridge closed instead of synthesizing events", async () => {
    const response = await fetch(`${origin}/api/cases/TL-042/events`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("genuine TrueForge session"),
    });
  });

  it("disables every hosted MCP method before any mutation can run", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await fetch(`${origin}/mcp`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify({}) : undefined,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("disabled") });
    }
  });
});
