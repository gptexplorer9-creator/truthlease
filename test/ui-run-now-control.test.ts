import { describe, expect, it, vi } from "vitest";

import { loadRunNowStatus, startRunNow } from "../src/ui/run-now-control.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Run Now browser transport", () => {
  it("hides the control when the server does not expose the capability", async () => {
    await expect(loadRunNowStatus(async () => json({}, 404))).resolves.toEqual({ enabled: false });
  });

  it("reads only the bounded public readiness projection", async () => {
    await expect(loadRunNowStatus(async () => json({
      enabled: true,
      ready: false,
      reason: "Connect required TrueForge MCP server(s): truthlease-local.",
      secret: "must-not-cross",
    }))).resolves.toEqual({
      enabled: true,
      ready: false,
      reason: "Connect required TrueForge MCP server(s): truthlease-local.",
    });
  });

  it("posts only the fixed case id and validates the genuine session receipt", async () => {
    const fetchImpl = vi.fn(async () => json({
      caseId: "TL-042",
      sessionId: "session-real-1",
      turnId: "turn-real-1",
      turnStatus: "running",
      approvalUrl: "http://127.0.0.1:8790/session/session-real-1",
      startedAt: "2026-08-30T04:30:00.000Z",
    }, 202));
    await expect(startRunNow("TL-042", fetchImpl)).resolves.toMatchObject({
      sessionId: "session-real-1",
      turnStatus: "running",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/run-now", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ caseId: "TL-042" }),
    }));
  });
});
