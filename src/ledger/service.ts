import { canonicalJson, parseLedgerJson, sha256 } from "./canonical.js";
import { isVerifiedConnector, type VerifiedConnector } from "./auth.js";
import {
  LedgerError,
  type AppendLedgerEventInput,
  type CreateLedgerCaseInput,
  type LedgerCase,
  type LedgerCaseDetail,
  type LedgerCasePage,
  type LedgerDatabase,
  type LedgerEvent,
  type IngestLedgerBatchInput,
  type LedgerBatchWriteResult,
  type LedgerRun,
  type LedgerWriteResult,
  type SqlRow,
  type SqlTransaction,
  type StartLedgerRunInput,
} from "./types.js";

type CaseRow = SqlRow & {
  case_id: string;
  idempotency_key: string;
  request_sha256: string;
  case_type: string;
  subject: unknown;
  created_at: string | Date;
};

type RunRow = SqlRow & {
  run_id: string;
  case_id: string;
  idempotency_key: string;
  request_sha256: string;
  connector_id: string;
  created_at: string | Date;
  next_sequence?: number;
};

type EventRow = SqlRow & {
  event_id: string;
  case_id: string;
  run_id: string;
  sequence: number;
  idempotency_key: string;
  request_sha256: string;
  connector_id: string;
  event_type: string;
  payload: unknown;
  payload_sha256: string;
  occurred_at: string | Date;
  received_at: string | Date;
};

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CONNECTOR_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCase(row: CaseRow): LedgerCase {
  return {
    caseId: row.case_id,
    idempotencyKey: row.idempotency_key,
    caseType: row.case_type,
    subject: parseLedgerJson(row.subject),
    createdAt: iso(row.created_at),
  };
}

function toRun(row: RunRow): LedgerRun {
  return {
    runId: row.run_id,
    caseId: row.case_id,
    idempotencyKey: row.idempotency_key,
    connectorId: row.connector_id,
    createdAt: iso(row.created_at),
  };
}

function toEvent(row: EventRow): LedgerEvent {
  return {
    eventId: row.event_id,
    caseId: row.case_id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    idempotencyKey: row.idempotency_key,
    connectorId: row.connector_id,
    eventType: row.event_type,
    payload: parseLedgerJson(row.payload),
    payloadSha256: row.payload_sha256,
    occurredAt: iso(row.occurred_at),
    receivedAt: iso(row.received_at),
  };
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new LedgerError("invalid_input", `${label} must be 1-160 URL-safe identifier characters.`);
  }
}

function assertConnectorIdentifier(value: string): void {
  if (!CONNECTOR_IDENTIFIER.test(value)) {
    throw new LedgerError("invalid_input", "connectorId must be 1-128 URL-safe identifier characters.");
  }
}

function assertIdempotencyKey(value: string): void {
  if (!IDEMPOTENCY.test(value)) {
    throw new LedgerError("invalid_input", "idempotencyKey must be 1-200 URL-safe identifier characters.");
  }
}

function assertLabel(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 128) {
    throw new LedgerError("invalid_input", `${label} must be between 1 and 128 characters.`);
  }
}

function requestHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

function assertOccurredAt(value: string): void {
  if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(Date.parse(value))) {
    throw new LedgerError("invalid_input", "occurredAt must be a valid timestamp.");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function cursorFor(value: LedgerCase): string {
  return Buffer.from(JSON.stringify([value.createdAt, value.caseId]), "utf8").toString("base64url");
}

function parseCursor(cursor: string | undefined): readonly [string | null, string | null] {
  if (cursor === undefined) return [null, null];
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== "string" ||
      typeof decoded[1] !== "string" ||
      !Number.isFinite(Date.parse(decoded[0]))
    ) {
      throw new Error("invalid cursor");
    }
    return [decoded[0], decoded[1]];
  } catch {
    throw new LedgerError("invalid_input", "Invalid case-list cursor.");
  }
}

/**
 * Append-only production ledger. It has no HTTP or browser surface: callers
 * authenticate connector requests, then invoke these service functions.
 */
export class TruthLeaseLedger {
  public constructor(private readonly database: LedgerDatabase) {}

  public async createCase(input: CreateLedgerCaseInput): Promise<LedgerWriteResult<LedgerCase>> {
    this.validateCase(input);
    return this.transactionWithRaceReplay((transaction) => this.createCaseIn(transaction, input));
  }

  private async createCaseIn(
    transaction: SqlTransaction,
    input: CreateLedgerCaseInput,
  ): Promise<LedgerWriteResult<LedgerCase>> {
      const subject = canonicalJson(input.subject);
      const hash = requestHash({ ...input, subject: JSON.parse(subject) });
      const replay = await transaction.query<CaseRow>(
        "/* ledger.case.by_idempotency */ SELECT * FROM truthlease_ledger_cases WHERE idempotency_key = $1 FOR UPDATE",
        [input.idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) return this.idempotentCase(existing, hash);

      const sameId = await transaction.query<CaseRow>(
        "/* ledger.case.by_id */ SELECT * FROM truthlease_ledger_cases WHERE case_id = $1 FOR UPDATE",
        [input.caseId],
      );
      if (sameId.rows[0] !== undefined) {
        throw new LedgerError("conflict", `caseId ${input.caseId} already exists with another request.`);
      }

      const inserted = await transaction.query<CaseRow>(
        `/* ledger.case.insert */ INSERT INTO truthlease_ledger_cases
          (case_id, idempotency_key, request_sha256, case_type, subject)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [input.caseId, input.idempotencyKey, hash, input.caseType, subject],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Ledger case insert returned no record.");
      return { value: toCase(row), idempotentReplay: false };
  }

  public async startRun(input: StartLedgerRunInput): Promise<LedgerWriteResult<LedgerRun>> {
    this.validateRun(input);
    return this.transactionWithRaceReplay((transaction) => this.startRunIn(transaction, input));
  }

  private async startRunIn(
    transaction: SqlTransaction,
    input: StartLedgerRunInput,
  ): Promise<LedgerWriteResult<LedgerRun>> {
      const hash = requestHash(input);
      const replay = await transaction.query<RunRow>(
        "/* ledger.run.by_idempotency */ SELECT * FROM truthlease_ledger_runs WHERE idempotency_key = $1 FOR UPDATE",
        [input.idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) return this.idempotentRun(existing, hash);

      const caseResult = await transaction.query<CaseRow>(
        "/* ledger.case.exists */ SELECT * FROM truthlease_ledger_cases WHERE case_id = $1 FOR KEY SHARE",
        [input.caseId],
      );
      if (caseResult.rows[0] === undefined) {
        throw new LedgerError("not_found", `caseId ${input.caseId} does not exist.`);
      }
      const sameId = await transaction.query<RunRow>(
        "/* ledger.run.by_id */ SELECT * FROM truthlease_ledger_runs WHERE run_id = $1 FOR UPDATE",
        [input.runId],
      );
      if (sameId.rows[0] !== undefined) {
        throw new LedgerError("conflict", `runId ${input.runId} already exists with another request.`);
      }
      const inserted = await transaction.query<RunRow>(
        `/* ledger.run.insert */ INSERT INTO truthlease_ledger_runs
          (run_id, case_id, idempotency_key, request_sha256, connector_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [input.runId, input.caseId, input.idempotencyKey, hash, input.connectorId],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Ledger run insert returned no record.");
      return { value: toRun(row), idempotentReplay: false };
  }

  public async appendAuthenticatedEvent(
    authentication: VerifiedConnector,
    input: AppendLedgerEventInput,
  ): Promise<LedgerWriteResult<LedgerEvent>> {
    this.validateEvent(authentication, input);
    return this.transactionWithRaceReplay((transaction) => this.appendEventIn(transaction, authentication, input));
  }

  private async appendEventIn(
    transaction: SqlTransaction,
    authentication: VerifiedConnector,
    input: AppendLedgerEventInput,
  ): Promise<LedgerWriteResult<LedgerEvent>> {
      if (!isVerifiedConnector(authentication, input.connectorId)) {
        throw new LedgerError("authentication_failed", "A verified connector credential is required.");
      }
      const payload = canonicalJson(input.payload);
      const payloadSha256 = sha256(payload);
      const hash = requestHash({ ...input, payload: JSON.parse(payload) });
      const run = await transaction.query<RunRow>(
        "/* ledger.run.lock */ SELECT * FROM truthlease_ledger_runs WHERE run_id = $1 FOR UPDATE",
        [input.runId],
      );
      const runRow = run.rows[0];
      if (runRow === undefined || runRow.case_id !== input.caseId) {
        throw new LedgerError("not_found", `runId ${input.runId} does not exist for the declared case.`);
      }
      if (runRow.connector_id !== input.connectorId) {
        throw new LedgerError("authentication_failed", "Connector is not authorized for this run.");
      }

      const replay = await transaction.query<EventRow>(
        `/* ledger.event.by_idempotency */ SELECT * FROM truthlease_ledger_events
          WHERE run_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [input.runId, input.idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) return this.idempotentEvent(existing, hash);

      const nextSequence = Number(runRow.next_sequence);
      if (input.sequence !== nextSequence) {
        throw new LedgerError(
          "sequence_conflict",
          `Expected event sequence ${nextSequence} for run ${input.runId}; received ${input.sequence}.`,
        );
      }
      const sameEvent = await transaction.query<EventRow>(
        "/* ledger.event.by_id */ SELECT * FROM truthlease_ledger_events WHERE event_id = $1 FOR UPDATE",
        [input.eventId],
      );
      if (sameEvent.rows[0] !== undefined) {
        throw new LedgerError("conflict", `eventId ${input.eventId} already exists with another request.`);
      }
      const inserted = await transaction.query<EventRow>(
        `/* ledger.event.insert */ INSERT INTO truthlease_ledger_events
          (event_id, case_id, run_id, sequence, idempotency_key, request_sha256, connector_id, event_type, payload, payload_sha256, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::timestamptz)
         RETURNING *`,
        [
          input.eventId, input.caseId, input.runId, input.sequence, input.idempotencyKey,
          hash, input.connectorId, input.eventType, payload, payloadSha256, input.occurredAt,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Ledger event insert returned no record.");
      await transaction.query(
        "/* ledger.run.advance */ UPDATE truthlease_ledger_runs SET next_sequence = next_sequence + 1 WHERE run_id = $1",
        [input.runId],
      );
      return { value: toEvent(row), idempotentReplay: false };
  }

  /** Atomically creates/replays the case and run and appends/replays every event. */
  public async ingestAuthenticatedBatch(
    authentication: VerifiedConnector,
    input: IngestLedgerBatchInput,
  ): Promise<LedgerBatchWriteResult> {
    this.validateCase(input.caseInput);
    this.validateRun(input.runInput);
    if (input.eventInputs.length === 0) {
      throw new LedgerError("invalid_input", "A connector batch requires at least one event.");
    }
    for (const event of input.eventInputs) this.validateEvent(authentication, event);

    return this.transactionWithRaceReplay(async (transaction) => {
      const caseResult = await this.createCaseIn(transaction, input.caseInput);
      const runResult = await this.startRunIn(transaction, input.runInput);
      const events: LedgerEvent[] = [];
      let allReplayed = caseResult.idempotentReplay && runResult.idempotentReplay;
      for (const eventInput of input.eventInputs) {
        const eventResult = await this.appendEventIn(transaction, authentication, eventInput);
        events.push(eventResult.value);
        allReplayed = allReplayed && eventResult.idempotentReplay;
      }
      return {
        case: caseResult.value,
        run: runResult.value,
        events,
        idempotentReplay: allReplayed,
      };
    });
  }

  public async listCases(options: { readonly limit?: number; readonly cursor?: string } = {}): Promise<LedgerCasePage> {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new LedgerError("invalid_input", "limit must be an integer from 1 through 100.");
    }
    const [createdAt, caseId] = parseCursor(options.cursor);
    const result = await this.database.query<CaseRow>(
      `/* ledger.case.list */ SELECT * FROM truthlease_ledger_cases
       WHERE ($1::timestamptz IS NULL OR (created_at, case_id) < ($1::timestamptz, $2::text))
       ORDER BY created_at DESC, case_id DESC LIMIT $3`,
      [createdAt, caseId, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const cases = result.rows.slice(0, limit).map(toCase);
    const last = cases.at(-1);
    return { cases, ...(hasMore && last !== undefined ? { nextCursor: cursorFor(last) } : {}) };
  }

  public async readCase(caseId: string): Promise<LedgerCaseDetail> {
    assertIdentifier(caseId, "caseId");
    const caseResult = await this.database.query<CaseRow>(
      "/* ledger.case.read */ SELECT * FROM truthlease_ledger_cases WHERE case_id = $1",
      [caseId],
    );
    const row = caseResult.rows[0];
    if (row === undefined) throw new LedgerError("not_found", `caseId ${caseId} does not exist.`);
    const [runs, events] = await Promise.all([
      this.database.query<RunRow>(
        "/* ledger.run.list_for_case */ SELECT * FROM truthlease_ledger_runs WHERE case_id = $1 ORDER BY created_at ASC, run_id ASC",
        [caseId],
      ),
      this.database.query<EventRow>(
        `/* ledger.event.list_for_case */ SELECT * FROM truthlease_ledger_events
         WHERE case_id = $1 ORDER BY occurred_at ASC, sequence ASC, event_id ASC`,
        [caseId],
      ),
    ]);
    return { case: toCase(row), runs: runs.rows.map(toRun), events: events.rows.map(toEvent) };
  }

  private idempotentCase(row: CaseRow, hash: string): LedgerWriteResult<LedgerCase> {
    if (row.request_sha256 !== hash) {
      throw new LedgerError("conflict", "idempotencyKey was already used with different case data.");
    }
    return { value: toCase(row), idempotentReplay: true };
  }

  private idempotentRun(row: RunRow, hash: string): LedgerWriteResult<LedgerRun> {
    if (row.request_sha256 !== hash) {
      throw new LedgerError("conflict", "idempotencyKey was already used with different run data.");
    }
    return { value: toRun(row), idempotentReplay: true };
  }

  private idempotentEvent(row: EventRow, hash: string): LedgerWriteResult<LedgerEvent> {
    if (row.request_sha256 !== hash) {
      throw new LedgerError("conflict", "idempotencyKey was already used with different event data.");
    }
    return { value: toEvent(row), idempotentReplay: true };
  }

  private validateCase(input: CreateLedgerCaseInput): void {
    assertIdentifier(input.caseId, "caseId");
    assertIdempotencyKey(input.idempotencyKey);
    assertLabel(input.caseType, "caseType");
    canonicalJson(input.subject);
  }

  private validateRun(input: StartLedgerRunInput): void {
    assertIdentifier(input.runId, "runId");
    assertIdentifier(input.caseId, "caseId");
    assertConnectorIdentifier(input.connectorId);
    assertIdempotencyKey(input.idempotencyKey);
  }

  private validateEvent(authentication: VerifiedConnector, input: AppendLedgerEventInput): void {
    assertIdentifier(input.eventId, "eventId");
    assertIdentifier(input.caseId, "caseId");
    assertIdentifier(input.runId, "runId");
    assertConnectorIdentifier(input.connectorId);
    assertIdempotencyKey(input.idempotencyKey);
    assertLabel(input.eventType, "eventType");
    assertOccurredAt(input.occurredAt);
    canonicalJson(input.payload);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
      throw new LedgerError("invalid_input", "sequence must be a positive safe integer.");
    }
    if (!isVerifiedConnector(authentication, input.connectorId)) {
      throw new LedgerError("authentication_failed", "A verified connector credential is required.");
    }
  }

  /** PostgreSQL cannot lock an absent unique key; retry after 23505 to classify the winner. */
  private async transactionWithRaceReplay<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(operation);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.database.transaction(operation);
    }
  }
}
