import { describe, expect, it } from "vitest";

import {
  authenticateConnectorIngestion,
  type LedgerDatabase,
  type SqlQueryResult,
  type SqlRow,
  TruthLeaseLedger,
} from "../src/ledger/index.js";

type Row = SqlRow & Record<string, unknown>;

class FakeLedgerDatabase implements LedgerDatabase {
  private readonly cases = new Map<string, Row>();
  private readonly runs = new Map<string, Row>();
  private readonly events = new Map<string, Row>();
  private serial = 0;
  public failEventInsertFor?: string;
  public raceNextCaseInsert = false;
  public raceNextRunInsert = false;
  public raceHashOverride?: string;
  private pendingExternalCase?: Row;
  private pendingExternalRun?: Row;

  public async transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    const cases = new Map(this.cases);
    const runs = new Map(this.runs);
    const events = new Map(this.events);
    const serial = this.serial;
    try {
      return await operation(this);
    } catch (error) {
      this.cases.clear();
      this.runs.clear();
      this.events.clear();
      for (const [key, value] of cases) this.cases.set(key, value);
      for (const [key, value] of runs) this.runs.set(key, value);
      for (const [key, value] of events) this.events.set(key, value);
      this.serial = serial;
      if (this.pendingExternalCase) this.cases.set(String(this.pendingExternalCase.case_id), this.pendingExternalCase);
      if (this.pendingExternalRun) this.runs.set(String(this.pendingExternalRun.run_id), this.pendingExternalRun);
      this.pendingExternalCase = undefined;
      this.pendingExternalRun = undefined;
      throw error;
    }
  }

  public async query<RowType extends SqlRow = SqlRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<RowType>> {
    const tag = /\/\* (ledger\.[^ ]+)/.exec(text)?.[1];
    const rows: Row[] = [];
    const createdAt = () => new Date(Date.UTC(2026, 7, 29, 20, 0, this.serial++)).toISOString();
    switch (tag) {
      case "ledger.case.by_idempotency": rows.push(...[...this.cases.values()].filter((row) => row.idempotency_key === values[0])); break;
      case "ledger.case.by_id":
      case "ledger.case.read": rows.push(...[...this.cases.values()].filter((row) => row.case_id === values[0])); break;
      case "ledger.case.exists": rows.push(...[...this.cases.values()].filter((row) => row.case_id === values[0])); break;
      case "ledger.case.insert": {
        const row: Row = { case_id: values[0], idempotency_key: values[1], request_sha256: values[2], case_type: values[3], subject: values[4], created_at: createdAt() };
        if (this.raceNextCaseInsert) {
          this.raceNextCaseInsert = false;
          this.pendingExternalCase = { ...row, request_sha256: this.raceHashOverride ?? row.request_sha256 };
          this.raceHashOverride = undefined;
          throw Object.assign(new Error("simulated concurrent case insert"), { code: "23505" });
        }
        this.cases.set(String(values[0]), row); rows.push(row); break;
      }
      case "ledger.run.by_idempotency": rows.push(...[...this.runs.values()].filter((row) => row.idempotency_key === values[0])); break;
      case "ledger.run.by_id":
      case "ledger.run.lock": rows.push(...[...this.runs.values()].filter((row) => row.run_id === values[0])); break;
      case "ledger.run.insert": {
        const row: Row = { run_id: values[0], case_id: values[1], idempotency_key: values[2], request_sha256: values[3], connector_id: values[4], next_sequence: 1, created_at: createdAt() };
        if (this.raceNextRunInsert) {
          this.raceNextRunInsert = false;
          this.pendingExternalRun = { ...row, request_sha256: this.raceHashOverride ?? row.request_sha256 };
          this.raceHashOverride = undefined;
          throw Object.assign(new Error("simulated concurrent run insert"), { code: "23505" });
        }
        this.runs.set(String(values[0]), row); rows.push(row); break;
      }
      case "ledger.run.advance": { const row = this.runs.get(String(values[0])); if (row) row.next_sequence = Number(row.next_sequence) + 1; break; }
      case "ledger.run.list_for_case": rows.push(...[...this.runs.values()].filter((row) => row.case_id === values[0])); break;
      case "ledger.event.by_idempotency": rows.push(...[...this.events.values()].filter((row) => row.run_id === values[0] && row.idempotency_key === values[1])); break;
      case "ledger.event.by_id": rows.push(...[...this.events.values()].filter((row) => row.event_id === values[0])); break;
      case "ledger.event.insert": {
        if (values[0] === this.failEventInsertFor) throw new Error("simulated mid-batch failure");
        const row: Row = { event_id: values[0], case_id: values[1], run_id: values[2], sequence: values[3], idempotency_key: values[4], request_sha256: values[5], connector_id: values[6], event_type: values[7], payload: values[8], payload_sha256: values[9], occurred_at: values[10], received_at: createdAt() };
        this.events.set(String(values[0]), row); rows.push(row); break;
      }
      case "ledger.event.list_for_case": rows.push(...[...this.events.values()].filter((row) => row.case_id === values[0])); break;
      case "ledger.case.list": {
        const limit = Number(values[2]);
        rows.push(...[...this.cases.values()].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))).slice(0, limit)); break;
      }
      default: throw new Error(`Unhandled fake query: ${tag ?? text}`);
    }
    return { rows: rows as unknown as readonly RowType[], rowCount: rows.length };
  }
}

const auth = () => authenticateConnectorIngestion(
  { connectors: { bright_data: { kind: "bearer", token: "token" } } },
  "bright_data",
  "{}",
  { kind: "bearer", token: "token" },
);

async function preparedLedger(): Promise<TruthLeaseLedger> {
  const ledger = new TruthLeaseLedger(new FakeLedgerDatabase());
  await ledger.createCase({ caseId: "case-1", idempotencyKey: "case-create-1", caseType: "recall", subject: { raw: "untrusted evidence as data" } });
  await ledger.startRun({ runId: "run-1", caseId: "case-1", idempotencyKey: "run-start-1", connectorId: "bright_data" });
  return ledger;
}

describe("TruthLeaseLedger", () => {
  it("writes immutable case/run/event records and returns exact replays", async () => {
    const ledger = await preparedLedger();
    const request = { eventId: "event-1", caseId: "case-1", runId: "run-1", sequence: 1, idempotencyKey: "event-1-key", connectorId: "bright_data", eventType: "evidence.received", payload: { text: "hostile content stays inert", tags: ["recall"] }, occurredAt: "2026-08-29T19:59:00.000Z" } as const;
    const first = await ledger.appendAuthenticatedEvent(auth(), request);
    const replay = await ledger.appendAuthenticatedEvent(auth(), request);
    const detail = await ledger.readCase("case-1");

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.value.eventId).toBe(first.value.eventId);
    expect(detail.runs).toHaveLength(1);
    expect(detail.events).toEqual([expect.objectContaining({ sequence: 1, payload: request.payload, occurredAt: request.occurredAt })]);
  });

  it("rejects a sequence gap, changed replay, and a forged authentication object", async () => {
    const ledger = await preparedLedger();
    const input = { eventId: "event-1", caseId: "case-1", runId: "run-1", sequence: 1, idempotencyKey: "event-1-key", connectorId: "bright_data", eventType: "evidence.received", payload: { value: 1 }, occurredAt: "2026-08-29T19:59:00.000Z" };
    await expect(ledger.appendAuthenticatedEvent(auth(), { ...input, sequence: 2 })).rejects.toMatchObject({ code: "sequence_conflict" });
    await ledger.appendAuthenticatedEvent(auth(), input);
    await expect(ledger.appendAuthenticatedEvent(auth(), { ...input, payload: { value: 2 } })).rejects.toMatchObject({ code: "conflict" });
    await expect(ledger.appendAuthenticatedEvent({ connectorId: "bright_data" } as never, { ...input, eventId: "event-2", sequence: 2, idempotencyKey: "event-2-key" })).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("rolls back the complete connector batch when a later event fails", async () => {
    const database = new FakeLedgerDatabase();
    database.failEventInsertFor = "event-2";
    const ledger = new TruthLeaseLedger(database);
    const caseInput = { caseId: "case-atomic", idempotencyKey: "case-atomic-key", caseType: "recall", subject: {} } as const;
    const runInput = { runId: "run-atomic", caseId: "case-atomic", idempotencyKey: "run-atomic-key", connectorId: "bright_data" } as const;
    const first = { eventId: "event-1", caseId: "case-atomic", runId: "run-atomic", sequence: 1, idempotencyKey: "event-1-key", connectorId: "bright_data", eventType: "state.snapshot", payload: {}, occurredAt: "2026-08-29T19:59:00.000Z" } as const;
    const second = { ...first, eventId: "event-2", sequence: 2, idempotencyKey: "event-2-key", occurredAt: "2026-08-29T19:59:01.000Z" } as const;

    await expect(ledger.ingestAuthenticatedBatch(auth(), { caseInput, runInput, eventInputs: [first, second] })).rejects.toThrow(/mid-batch/);
    await expect(ledger.readCase(caseInput.caseId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("classifies concurrent unique races as exact replay or conflict", async () => {
    const database = new FakeLedgerDatabase();
    const ledger = new TruthLeaseLedger(database);
    const caseInput = { caseId: "case-race", idempotencyKey: "case-race-key", caseType: "recall", subject: {} } as const;
    database.raceNextCaseInsert = true;
    await expect(ledger.createCase(caseInput)).resolves.toMatchObject({ idempotentReplay: true });

    database.raceNextRunInsert = true;
    database.raceHashOverride = "f".repeat(64);
    await expect(ledger.startRun({ runId: "run-race", caseId: caseInput.caseId, idempotencyKey: "run-race-key", connectorId: "bright_data" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects connector IDs longer than the 128-character schema limit", async () => {
    const ledger = await preparedLedger();
    await expect(ledger.startRun({ runId: "run-2", caseId: "case-1", idempotencyKey: "run-2-key", connectorId: `a${"b".repeat(128)}` })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("provides bounded list and read service APIs without an Express route", async () => {
    const ledger = await preparedLedger();
    const page = await ledger.listCases({ limit: 1 });
    expect(page.cases).toHaveLength(1);
    expect(page.cases[0]?.caseId).toBe("case-1");
    await expect(ledger.readCase("missing")).rejects.toMatchObject({ code: "not_found" });
  });
});
