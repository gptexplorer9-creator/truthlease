import { describe, expect, it } from "vitest";

import { MemoryConnectorStateStore, OperatorConnector, canonicalJson, type GenuineTrueForgeEvent, type TrueForgeEventSource, type TruthLeaseIngestionClient } from "../src/connector/index.js";

const event = (id: string, sequence: number): GenuineTrueForgeEvent => ({ id, sequence, occurredAt: "2026-08-29T00:00:00.000Z", type: "state.snapshot", genuine: true, payload: { sequence } });
class Source implements TrueForgeEventSource {
  constructor(private readonly events: GenuineTrueForgeEvent[]) {}
  async readAfter(cursor: { eventId: string } | null, limit: number) {
    const start = cursor ? this.events.findIndex((candidate) => candidate.id === cursor.eventId) + 1 : 0;
    const events = this.events.slice(start, start + limit);
    const last = events.at(-1);
    return { events, nextCursor: last ? { eventId: last.id, sequence: last.sequence } : cursor, hasMore: start + events.length < this.events.length };
  }
}

describe("outbound operator connector", () => {
  it("canonicalizes JSON deterministically", () => {
    expect(canonicalJson({ z: 1, a: { d: true, c: 2 } })).toBe('{"a":{"c":2,"d":true},"z":1}');
  });

  it("persists the cursor only after an accepted append", async () => {
    const store = new MemoryConnectorStateStore();
    let calls = 0;
    const client: TruthLeaseIngestionClient = {
      async appendBatch(request) {
        calls += 1;
        expect(request.case.caseId).toBe("case-1");
        expect(request.run.connectorId).toBe("connector-1");
        return { accepted: true, cursor: { eventId: "e1", sequence: 1 } };
      },
    };
    const connector = new OperatorConnector(
      new Source([event("e1", 1)]), client,
      { algorithm: "test", sign: () => "sig" }, store,
      { caseId: "case-1", caseType: "test", subject: {}, runId: "run-1", connectorId: "connector-1" },
      {}, { now: () => new Date("2026-08-29T00:00:00.000Z") }, { id: () => "batch-1" },
    );
    expect((await connector.syncOnce()).sent).toBe(1);
    expect(calls).toBe(1);
    expect((await store.load())?.cursor).toEqual({ eventId: "e1", sequence: 1 });
    expect(connector.nextDelayMs()).toBe(5_000);
  });

  it("rejects non-genuine events before any remote call", async () => {
    let called = false;
    const bad = { ...event("e1", 1), genuine: false } as unknown as GenuineTrueForgeEvent;
    const client: TruthLeaseIngestionClient = { async appendBatch() { called = true; return { accepted: true, cursor: { eventId: "e1" } }; } };
    const connector = new OperatorConnector(new Source([bad]), client, { algorithm: "test", sign: () => "sig" }, new MemoryConnectorStateStore(), { caseId: "case-1", caseType: "test", subject: {}, runId: "run-1", connectorId: "connector-1" });
    await expect(connector.syncOnce()).rejects.toThrow(/non-genuine/);
    expect(called).toBe(false);
  });

  it("uses retry backoff only after retryable failures", async () => {
    const source: TrueForgeEventSource = {
      async readAfter() { throw new Error("temporarily unavailable"); },
    };
    const connector = new OperatorConnector(
      source,
      { async appendBatch() { throw new Error("not reached"); } },
      { algorithm: "none", sign: () => "" },
      new MemoryConnectorStateStore(),
      { caseId: "case-1", caseType: "test", subject: {}, runId: "run-1", connectorId: "connector-1" },
      { retryBaseMs: 250, retryMaxMs: 2_000, retryJitter: 0, pollIntervalMs: 5_000 },
    );
    await expect(connector.syncOnce()).rejects.toThrow("temporarily unavailable");
    expect(connector.nextDelayMs()).toBe(250);
  });
});
