import { describe, expect, it } from "vitest";

import { ServerContractIngestionClient } from "../src/connector/server-contract.js";

describe("connector server contract", () => {
  const request = {
    batchId: "b1",
    case: { caseId: "TL-042", idempotencyKey: "case:TL-042", caseType: "trueforge.operator", subject: {} },
    run: { runId: "run-1", caseId: "TL-042", idempotencyKey: "run:run-1", connectorId: "local-trueforge" },
    cursor: null,
    events: [{ id: "e1", sequence: 1, occurredAt: "2026-08-29T00:00:00.000Z", type: "state.snapshot", genuine: true as const, payload: {} }],
    signature: "", algorithm: "none", sentAt: "2026-08-29T00:00:00.000Z",
  };

  it("rejects bearer authorization over non-loopback plain HTTP", () => {
    expect(() => new ServerContractIngestionClient({
      baseUrl: "http://truthlease.example",
      connectorId: "local-trueforge",
      authorization: "Bearer secret",
    })).toThrow(/non-loopback plain HTTP/);
  });

  it("posts the exact connector route and case/run/event envelope", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const client = new ServerContractIngestionClient({
      baseUrl: "http://127.0.0.1:8788",
      connectorId: "local-trueforge",
      authorization: "Bearer secret",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init };
        return new Response(JSON.stringify({ accepted: true, cursor: { eventId: "e1", sequence: 1 }, idempotentReplay: false }), { status: 200 });
      },
    });
    const result = await client.appendBatch(request);
    expect(result.accepted).toBe(true);
    expect(seen?.url).toMatch(/\/api\/connectors\/local-trueforge\/events$/);
    const payload = JSON.parse(String(seen?.init?.body)) as Record<string, any>;
    expect(payload.case.idempotencyKey).toBe("case:TL-042");
    expect(payload.run.idempotencyKey).toBe("run:run-1");
    expect(payload.events[0]).toMatchObject({ eventId: "e1", caseId: "TL-042", runId: "run-1", connectorId: "local-trueforge", eventType: "state.snapshot" });
    expect((seen?.init?.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("rejects an accepted acknowledgement that does not match the final event sent", async () => {
    const client = new ServerContractIngestionClient({
      baseUrl: "https://truthlease.example",
      connectorId: "local-trueforge",
      authorization: "Bearer secret",
      fetchImpl: async () => new Response(JSON.stringify({ accepted: true, cursor: { eventId: "other", sequence: 1 } }), { status: 200 }),
    });
    await expect(client.appendBatch(request)).rejects.toMatchObject({ code: "cursor_mismatch", retryable: false });
  });

  it("rejects malformed optional append result fields", async () => {
    const client = new ServerContractIngestionClient({
      baseUrl: "https://truthlease.example",
      connectorId: "local-trueforge",
      fetchImpl: async () => new Response(JSON.stringify({ accepted: true, cursor: { eventId: "e1", sequence: 1 }, idempotentReplay: "yes" }), { status: 200 }),
    });
    await expect(client.appendBatch(request)).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });
});
