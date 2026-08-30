/** Outbound-only contracts for the TrueForge -> TruthLease operator bridge. */
export interface ConnectorCursor {
  eventId: string;
  sequence?: number;
}

export interface GenuineTrueForgeEvent {
  id: string;
  sequence?: number;
  occurredAt: string;
  type: string;
  genuine: true;
  payload: Record<string, unknown>;
  source?: { name?: string; version?: string; ledger?: string };
}

export interface TrueForgeEventSource {
  readAfter(cursor: ConnectorCursor | null, limit: number): Promise<{
    events: GenuineTrueForgeEvent[];
    nextCursor: ConnectorCursor | null;
    hasMore: boolean;
  }>;
}

export interface ConnectorState {
  cursor: ConnectorCursor | null;
  lastBatchId?: string;
  pendingBatchId?: string;
  pendingEventIds?: string[];
  updatedAt: string;
}

export interface ConnectorStateStore {
  load(): Promise<ConnectorState | null>;
  save(state: ConnectorState): Promise<void>;
}

export interface BatchSigner {
  algorithm: string;
  keyId?: string;
  sign(input: Uint8Array): Promise<string> | string;
}

export interface ConnectorIdentity {
  caseId: string;
  caseType: string;
  subject: Record<string, unknown>;
  runId: string;
  connectorId: string;
}

export interface SignedBatchRequest {
  batchId: string;
  case: { caseId: string; idempotencyKey: string; caseType: string; subject: Record<string, unknown> };
  run: { runId: string; caseId: string; idempotencyKey: string; connectorId: string };
  cursor: ConnectorCursor | null;
  events: GenuineTrueForgeEvent[];
  signature: string;
  algorithm: string;
  keyId?: string;
  sentAt: string;
}

export interface TruthLeaseIngestionClient {
  appendBatch(request: SignedBatchRequest): Promise<{
    accepted: boolean;
    cursor: ConnectorCursor | null;
    duplicate?: boolean;
    idempotentReplay?: boolean;
    receiptId?: string;
  }>;
}

export interface ConnectorHealthSnapshot {
  status: 'idle' | 'healthy' | 'draining' | 'backing_off' | 'degraded' | 'stopped';
  connected: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  pendingEvents: number;
  cursor: ConnectorCursor | null;
  lastError?: { code: string; message: string; retryable: boolean };
}

export interface OperatorConnectorConfig {
  batchSize: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryJitter: number;
  pollIntervalMs: number;
}

export interface ConnectorClock { now(): Date }
export interface ConnectorRandom { id(): string }
