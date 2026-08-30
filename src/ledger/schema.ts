/** Idempotent PostgreSQL schema for the append-only TruthLease production ledger. */
export const ledgerMigrationStatements = [
  `CREATE TABLE IF NOT EXISTS truthlease_ledger_cases (
    case_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_sha256 CHAR(64) NOT NULL,
    case_type TEXT NOT NULL,
    subject JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(case_id) BETWEEN 1 AND 160),
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    CHECK (length(case_type) BETWEEN 1 AND 128)
  )`,
  `CREATE TABLE IF NOT EXISTS truthlease_ledger_runs (
    run_id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES truthlease_ledger_cases(case_id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_sha256 CHAR(64) NOT NULL,
    connector_id TEXT NOT NULL,
    next_sequence INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(run_id) BETWEEN 1 AND 160),
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    CHECK (length(connector_id) BETWEEN 1 AND 128),
    CHECK (next_sequence >= 1)
  )`,
  `CREATE INDEX IF NOT EXISTS truthlease_ledger_runs_case_created_idx
    ON truthlease_ledger_runs (case_id, created_at ASC, run_id ASC)`,
  `CREATE TABLE IF NOT EXISTS truthlease_ledger_events (
    event_id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES truthlease_ledger_cases(case_id) ON DELETE RESTRICT,
    run_id TEXT NOT NULL REFERENCES truthlease_ledger_runs(run_id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_sha256 CHAR(64) NOT NULL,
    connector_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sequence >= 1),
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    CHECK (length(connector_id) BETWEEN 1 AND 128),
    CHECK (length(event_type) BETWEEN 1 AND 128),
    UNIQUE (run_id, sequence),
    UNIQUE (run_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS truthlease_ledger_events_case_received_idx
    ON truthlease_ledger_events (case_id, received_at ASC, event_id ASC)`,
  `CREATE INDEX IF NOT EXISTS truthlease_ledger_events_run_sequence_idx
    ON truthlease_ledger_events (run_id, sequence ASC)`,
] as const;
