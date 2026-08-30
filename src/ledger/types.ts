/** A deliberately small JSON domain: connector evidence is stored as data, never executed. */
export type LedgerJson =
  | null
  | boolean
  | number
  | string
  | readonly LedgerJson[]
  | { readonly [key: string]: LedgerJson };

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface SqlQueryResult<Row extends SqlRow = SqlRow> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface SqlTransaction {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

/**
 * A transaction-capable PostgreSQL boundary.  Keeping this portable lets the
 * application use Neon Pool, node-postgres, or a test double without putting a
 * database credential in the domain service.
 */
export interface LedgerDatabase extends SqlTransaction {
  transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T>;
}

export interface LedgerCase {
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly caseType: string;
  readonly subject: LedgerJson;
  readonly createdAt: string;
}

export interface LedgerRun {
  readonly runId: string;
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly connectorId: string;
  readonly createdAt: string;
}

export interface LedgerEvent {
  readonly eventId: string;
  readonly caseId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly idempotencyKey: string;
  readonly connectorId: string;
  readonly eventType: string;
  readonly payload: LedgerJson;
  readonly payloadSha256: string;
  readonly receivedAt: string;
}

export interface LedgerCasePage {
  readonly cases: readonly LedgerCase[];
  readonly nextCursor?: string;
}

export interface LedgerCaseDetail {
  readonly case: LedgerCase;
  readonly runs: readonly LedgerRun[];
  readonly events: readonly LedgerEvent[];
}

export interface CreateLedgerCaseInput {
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly caseType: string;
  readonly subject: LedgerJson;
}

export interface StartLedgerRunInput {
  readonly runId: string;
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly connectorId: string;
}

export interface AppendLedgerEventInput {
  readonly eventId: string;
  readonly caseId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly idempotencyKey: string;
  readonly connectorId: string;
  readonly eventType: string;
  readonly payload: LedgerJson;
}

export interface LedgerWriteResult<Value> {
  readonly value: Value;
  readonly idempotentReplay: boolean;
}

export class LedgerError extends Error {
  public constructor(
    public readonly code:
      | "authentication_failed"
      | "conflict"
      | "invalid_input"
      | "not_found"
      | "sequence_conflict",
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}
