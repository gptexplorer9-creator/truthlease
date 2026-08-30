import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RetailerStore } from "../src/infra/store.js";
import type {
  AppendLedgerEventInput,
  CreateLedgerCaseInput,
  LedgerCase,
  LedgerCaseDetail,
  LedgerEvent,
  LedgerRun,
  StartLedgerRunInput,
  TruthLeaseLedger,
} from "../src/ledger/index.js";
import { createApp } from "../src/mcp/server.js";
import { signingBytes, type SigningEnvelope } from "../src/connector/index.js";

class RouteLedger {
  public writes = 0;
  private readonly cases = new Map<string, LedgerCase>();
  private readonly runs = new Map<string, LedgerRun>();
  private readonly events = new Map<string, LedgerEvent>();

  public async createCase(input: CreateLedgerCaseInput) {
    const existing = this.cases.get(input.caseId);
    if (existing) return { value: existing, idempotentReplay: true };
    const value = { ...input, createdAt: "2026-08-29T20:00:00.000Z" };
    this.cases.set(input.caseId, value);
    this.writes += 1;
    return { value, idempotentReplay: false };
  }

  public async startRun(input: StartLedgerRunInput) {
    const existing = this.runs.get(input.runId);
    if (existing) return { value: existing, idempotentReplay: true };
    const value = { ...input, createdAt: "2026-08-29T20:00:01.000Z" };
    this.runs.set(input.runId, value);
    this.writes += 1;
    return { value, idempotentReplay: false };
  }

  public async appendAuthenticatedEvent(_authentication: unknown, input: AppendLedgerEventInput) {
    const existing = this.events.get(input.eventId);
    if (existing) return { value: existing, idempotentReplay: true };
    const value: LedgerEvent = {
      ...input,
      payloadSha256: "a".repeat(64),
      receivedAt: `2026-08-29T20:00:0${input.sequence + 1}.000Z`,
    };
    this.events.set(input.eventId, value);
    this.writes += 1;
    return { value, idempotentReplay: false };
  }

  public async ingestAuthenticatedBatch(authentication: unknown, input: { caseInput: CreateLedgerCaseInput; runInput: StartLedgerRunInput; eventInputs: readonly AppendLedgerEventInput[] }) {
    const caseResult = await this.createCase(input.caseInput);
    const runResult = await this.startRun(input.runInput);
    const events: LedgerEvent[] = [];
    let idempotentReplay = caseResult.idempotentReplay && runResult.idempotentReplay;
    for (const event of input.eventInputs) {
      const result = await this.appendAuthenticatedEvent(authentication, event);
      events.push(result.value);
      idempotentReplay = idempotentReplay && result.idempotentReplay;
    }
    return { case: caseResult.value, run: runResult.value, events, idempotentReplay };
  }

  public async readCase(caseId: string): Promise<LedgerCaseDetail> {
    const ledgerCase = this.cases.get(caseId);
    if (!ledgerCase) throw new Error("missing case");
    return {
      case: ledgerCase,
      runs: [...this.runs.values()].filter((run) => run.caseId === caseId),
      events: [...this.events.values()].filter((event) => event.caseId === caseId),
    };
  }

  public async listCases() {
    return { cases: [...this.cases.values()] };
  }
}

const attestationSecret = "route-attestation-secret-32-bytes-minimum";

function batch() {
  const envelope: SigningEnvelope = {
    batchId: "batch-1",
    case: {
      caseId: "TL-042",
      idempotencyKey: "case-TL-042",
      caseType: "recall_containment",
      subject: { leaseId: "TL-042" },
    },
    run: {
      runId: "run-1",
      caseId: "TL-042",
      idempotencyKey: "run-run-1",
      connectorId: "bright-data",
      trueForgeSessionId: "run-1",
    },
    cursor: null,
    events: [
      {
        id: "event-1",
        sequence: 1,
        type: "state.snapshot",
        genuine: true,
        source: { name: "trueforge", sessionId: "run-1", runId: "run-1" },
        payload: { lease: { lease_id: "TL-042", status: "active" } },
        occurredAt: "2026-08-29T19:59:00.000Z",
      },
      {
        id: "event-2",
        sequence: 2,
        type: "evidence.fetched",
        genuine: true,
        source: { name: "trueforge", sessionId: "run-1", runId: "run-1" },
        payload: { title: "Official recall" },
        occurredAt: "2026-08-29T19:59:01.000Z",
      },
    ],
    sentAt: "2026-08-29T20:00:00.000Z",
  };
  return {
    ...envelope,
    algorithm: "hmac-sha256" as const,
    signature: createHmac("sha256", attestationSecret).update(signingBytes(envelope)).digest("hex"),
  };
}

describe("hosted connector ingestion routes", () => {
  let httpServer: Server;
  let origin: string;
  let ledger: RouteLedger;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "truthlease-connector-route-"));
    const store = new RetailerStore(join(process.cwd(), "data", "seed-state.json"), join(directory, "state.json"));
    ledger = new RouteLedger();
    httpServer = createServer(createApp(store, {
      projectRoot: process.cwd(),
      hostedReadOnly: true,
      ledger: ledger as unknown as TruthLeaseLedger,
      connectorAuth: { connectors: { "bright-data": { kind: "bearer", token: "route-secret" } } },
      connectorAttestation: { connectors: { "bright-data": { secret: attestationSecret } } },
    }));
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

  async function ingest(value: unknown, token = "route-secret") {
    return fetch(`${origin}/api/connectors/bright-data/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  }

  it("rejects missing or invalid connector authentication without writing", async () => {
    const response = await ingest(batch(), "wrong-secret");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "authentication_failed" });
    expect(ledger.writes).toBe(0);
  });

  it("rejects a valid bearer when provenance attestation is missing, changed, or session-mismatched", async () => {
    const missing = { ...batch(), signature: "" };
    expect((await ingest(missing)).status).toBe(401);

    const changed = batch();
    changed.events[0]!.payload = { lease: { lease_id: "TL-forged", status: "active" } };
    expect((await ingest(changed)).status).toBe(401);

    const mismatched = batch();
    mismatched.events[0]!.source.sessionId = "another-session";
    expect((await ingest(mismatched)).status).toBe(401);
    expect(ledger.writes).toBe(0);
  });

  it("ingests, reads after a sequence cursor, and reports an exact replay", async () => {
    const first = await ingest(batch());
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      accepted: true,
      cursor: { eventId: "event-2", sequence: 2 },
      idempotentReplay: false,
    });

    const read = await fetch(`${origin}/api/cases/TL-042/events?after=1`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      caseId: "TL-042",
      runId: "run-1",
      lastSequence: 2,
      events: [{ id: "event-2", sequence: 2, type: "evidence.fetched", timestamp: "2026-08-29T19:59:01.000Z" }],
    });

    const replay = await ingest(batch());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ accepted: true, idempotentReplay: true });
    expect(ledger.writes).toBe(4);
  });

  it("prevalidates cross-bound identities and the entire malformed batch before any write", async () => {
    const crossBound = batch();
    crossBound.events[1]!.source.runId = "other-run";
    const crossResponse = await ingest(crossBound);
    expect(crossResponse.status).toBe(401);
    expect(ledger.writes).toBe(0);

    const nonContiguous = batch();
    nonContiguous.events[1]!.sequence = 3;
    const sequenceResponse = await ingest(nonContiguous);
    expect(sequenceResponse.status).toBe(400);
    expect(ledger.writes).toBe(0);

    const unsupported = batch();
    unsupported.events[1]!.type = "arbitrary.event";
    const typeResponse = await ingest(unsupported);
    expect(typeResponse.status).toBe(400);
    expect(ledger.writes).toBe(0);

    const tooLarge = batch();
    tooLarge.events = Array.from({ length: 101 }, (_, index) => ({
      ...tooLarge.events[0]!,
      id: `event-${index + 1}`,
      sequence: index + 1,
    }));
    const sizeResponse = await ingest(tooLarge);
    expect(sizeResponse.status).toBe(400);
    expect(ledger.writes).toBe(0);
  });

  it("rejects invalid after cursors and keeps every hosted MCP method disabled", async () => {
    expect((await fetch(`${origin}/api/cases/TL-042/events?after=-1`)).status).toBe(400);
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await fetch(`${origin}/mcp`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? "{}" : undefined,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("disabled") });
    }
  });
});
