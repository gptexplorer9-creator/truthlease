import { describe, expect, it, vi } from "vitest";

import { RunNowError, TrueForgeRunNowService, runPrompt } from "../src/trueforge/run-now.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function readyFetch() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/healthz") return text("OK!");
    if (url.pathname === "/api/v1/settings/model-providers") {
      return json({ data: [{ name: "openai", manifest: { type: "openai" } }] });
    }
    if (url.pathname === "/api/v1/settings/mcp-servers") {
      return json({ data: [{ name: "bright-data" }, { name: "truthlease-local" }] });
    }
    if (url.pathname === "/api/v1/agents") return json({ data: [{ name: "truthlease-recall-monitor" }] });
    if (url.pathname === "/api/v1/sessions" && init?.method === "POST") {
      return json({ data: { id: "session-real-1" } }, 201);
    }
    if (url.pathname === "/api/v1/sessions/session-real-1/turns" && init?.method === "POST") {
      return json({ data: { id: "turn-real-1", state: { status: "running" } } });
    }
    return json({ error: "unexpected" }, 404);
  });
}

describe("TrueForge Run Now", () => {
  it("rejects any non-loopback or credentialed TrueForge origin", () => {
    for (const baseUrl of [
      "https://127.0.0.1:8790",
      "http://example.com:8790",
      "http://user:pass@127.0.0.1:8790",
      "http://127.0.0.1:8790/path",
    ]) {
      expect(() => new TrueForgeRunNowService({ baseUrl })).toThrow(RunNowError);
    }
  });

  it("fails readiness closed when a required provider is missing", async () => {
    const fetchImpl = readyFetch();
    fetchImpl.mockImplementationOnce(async () => text("OK!"));
    fetchImpl.mockImplementationOnce(async () => json({ data: [] }));
    const service = new TrueForgeRunNowService({ baseUrl: "http://127.0.0.1:8790", fetchImpl });
    await expect(service.status()).resolves.toMatchObject({
      enabled: true,
      ready: false,
      reason: "Connect an OpenAI model provider in TrueForge.",
    });
  });

  it("creates one genuine named session and a non-streaming guarded turn", async () => {
    const fetchImpl = readyFetch();
    const service = new TrueForgeRunNowService({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl,
      cooldownMs: 60_000,
      now: () => new Date("2026-08-30T04:30:00.000Z"),
    });

    const result = await service.start("TL-042");
    expect(result).toEqual({
      caseId: "TL-042",
      sessionId: "session-real-1",
      turnId: "turn-real-1",
      turnStatus: "running",
      approvalUrl: "http://127.0.0.1:8790/session/session-real-1",
      startedAt: "2026-08-30T04:30:00.000Z",
    });
    expect(service.currentSessionId()).toBe("session-real-1");

    const sessionCall = fetchImpl.mock.calls.find(([input]) => new URL(input).pathname === "/api/v1/sessions");
    expect(JSON.parse(String(sessionCall?.[1]?.body))).toEqual({
      agent: { name: "truthlease-recall-monitor" },
    });
    const turnCall = fetchImpl.mock.calls.find(([input]) => new URL(input).pathname.endsWith("/turns"));
    const turnBody = JSON.parse(String(turnCall?.[1]?.body));
    expect(turnBody).toMatchObject({ previous_turn_id: "none", stream: false });
    expect(turnBody.input[0].content).toContain("stop at TrueForge native approval with zero writes");
    await expect(service.status()).resolves.toMatchObject({ ready: false, cooldownRemainingMs: 60_000 });
  });

  it("accepts the live TrueForge top-level session and turn response shape", async () => {
    const fetchImpl = readyFetch();
    fetchImpl.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/healthz") return json({ status: "ok" });
      if (url.pathname === "/api/v1/settings/model-providers") return json({ data: [{ name: "openai" }] });
      if (url.pathname === "/api/v1/settings/mcp-servers") {
        return json({ data: [{ name: "bright-data" }, { name: "truthlease-local" }] });
      }
      if (url.pathname === "/api/v1/agents") return json({ data: [{ name: "truthlease-recall-monitor" }] });
      if (url.pathname === "/api/v1/sessions" && init?.method === "POST") {
        return json({ id: "session-live-shape" }, 201);
      }
      if (url.pathname === "/api/v1/sessions/session-live-shape/turns" && init?.method === "POST") {
        return json({ id: "turn-live-shape", state: { status: "running" } }, 201);
      }
      return json({ error: "unexpected" }, 404);
    });
    const service = new TrueForgeRunNowService({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl,
    });

    await expect(service.start("TL-042")).resolves.toMatchObject({
      sessionId: "session-live-shape",
      turnId: "turn-live-shape",
      turnStatus: "running",
    });
  });

  it("binds the session before the agent turn can call the local MCP", async () => {
    let service: TrueForgeRunNowService;
    const fetchImpl = readyFetch();
    fetchImpl.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/healthz") return json({ status: "ok" });
      if (url.pathname === "/api/v1/settings/model-providers") return json({ data: [{ name: "openai" }] });
      if (url.pathname === "/api/v1/settings/mcp-servers") {
        return json({ data: [{ name: "bright-data" }, { name: "truthlease-local" }] });
      }
      if (url.pathname === "/api/v1/agents") return json({ data: [{ name: "truthlease-recall-monitor" }] });
      if (url.pathname === "/api/v1/sessions" && init?.method === "POST") {
        return json({ id: "session-bound-before-turn" }, 201);
      }
      if (url.pathname.endsWith("/turns") && init?.method === "POST") {
        expect(service.currentSessionId()).toBe("session-bound-before-turn");
        return json({ id: "turn-bound-before-turn", state: { status: "running" } }, 201);
      }
      return json({ error: "unexpected" }, 404);
    });
    service = new TrueForgeRunNowService({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl,
    });

    await service.start("TL-042");
  });

  it("acquires the single-flight lock before asynchronous readiness checks", async () => {
    const service = new TrueForgeRunNowService({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl: readyFetch(),
    });

    const first = service.start("TL-042");
    await expect(service.start("TL-042")).rejects.toMatchObject({
      code: "run_in_progress",
      status: 409,
    });
    await expect(first).resolves.toMatchObject({ sessionId: "session-real-1" });
  });

  it("accepts only the fixed owned case", async () => {
    const service = new TrueForgeRunNowService({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl: readyFetch(),
    });
    await expect(service.start("OTHER")).rejects.toMatchObject({ code: "unsupported_case", status: 400 });
  });

  it("keeps the prompt evidence-bound and approval-gated", () => {
    const prompt = runPrompt("TL-042");
    expect(prompt).toContain("bright-data");
    expect(prompt).toContain("never use a direct web tool");
    expect(prompt).toContain("Only after a human approves");
    expect(prompt).toContain("verify_containment_state");
  });
});
