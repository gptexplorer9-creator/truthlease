import { asConnectorError, ConnectorError } from './errors.js';
import { createSignedBatch } from './signing.js';
import type { BatchSigner, ConnectorClock, ConnectorCursor, ConnectorHealthSnapshot, ConnectorIdentity, ConnectorRandom, ConnectorState, ConnectorStateStore, GenuineTrueForgeEvent, OperatorConnectorConfig, TruthLeaseIngestionClient, TrueForgeEventSource } from './types.js';

const clock: ConnectorClock = { now: () => new Date() };
const random: ConnectorRandom = { id: () => crypto.randomUUID() };
const validCursor = (value: ConnectorCursor | null) => value === null || (typeof value.eventId === 'string' && value.eventId.length > 0);

function validateEvents(events: GenuineTrueForgeEvent[], identity: ConnectorIdentity) {
  if (identity.runId !== identity.trueForgeSessionId) {
    throw new ConnectorError('invalid_identity', 'Hosted runId must exactly match the genuine TrueForge session identity', false);
  }
  const ids = new Set<string>();
  for (const event of events) {
    if (
      event.genuine !== true
      || event.source?.name !== 'trueforge'
      || event.source.sessionId !== identity.trueForgeSessionId
      || event.source.runId !== identity.runId
      || !event.id
      || ids.has(event.id)
      || !Number.isSafeInteger(event.sequence)
      || Number(event.sequence) < 1
    ) {
      throw new ConnectorError('invalid_event', 'Event source returned a non-genuine, duplicate, or unsequenced event', false);
    }
    ids.add(event.id);
  }
}

export class OperatorConnector {
  private readonly config: OperatorConnectorConfig;
  private state: ConnectorState = { cursor: null, updatedAt: new Date(0).toISOString() };
  private health: ConnectorHealthSnapshot = { status: 'idle', connected: false, consecutiveFailures: 0, pendingEvents: 0, cursor: null };
  private started = false;

  constructor(
    private readonly source: TrueForgeEventSource,
    private readonly client: TruthLeaseIngestionClient,
    private readonly signer: BatchSigner,
    private readonly store: ConnectorStateStore,
    private readonly identity: ConnectorIdentity,
    config: Partial<OperatorConnectorConfig> = {},
    private readonly now: ConnectorClock = clock,
    private readonly ids: ConnectorRandom = random,
  ) {
    this.config = { batchSize: Math.max(1, config.batchSize ?? 100), retryBaseMs: Math.max(1, config.retryBaseMs ?? 500), retryMaxMs: Math.max(1, config.retryMaxMs ?? 30_000), retryJitter: Math.min(1, Math.max(0, config.retryJitter ?? 0.2)), pollIntervalMs: Math.max(1, config.pollIntervalMs ?? 5_000) };
  }

  async start() {
    if (this.started) return;
    this.state = (await this.store.load()) ?? this.state;
    if (!validCursor(this.state.cursor)) throw new ConnectorError('invalid_state', 'Stored cursor is invalid', false);
    this.health.cursor = this.state.cursor;
    this.started = true;
    this.health.status = 'healthy';
  }

  stop() { this.started = false; this.health.status = 'stopped'; this.health.connected = false; }
  snapshot() { return { ...this.health, cursor: this.health.cursor ? { ...this.health.cursor } : null, lastError: this.health.lastError && { ...this.health.lastError } }; }

  /** One bounded pass. The host owns scheduling and shutdown. */
  async syncOnce() {
    if (!this.started) await this.start();
    const attemptAt = this.now.now().toISOString();
    this.health.status = 'draining'; this.health.lastAttemptAt = attemptAt;
    try {
      const read = await this.source.readAfter(this.state.cursor, this.config.batchSize);
      validateEvents(read.events, this.identity); this.health.pendingEvents = read.events.length;
      if (!read.events.length) { this.health.status = 'healthy'; this.health.connected = true; this.health.lastSuccessAt = attemptAt; this.health.lastError = undefined; this.health.consecutiveFailures = 0; return { sent: 0, cursor: this.state.cursor }; }
      const eventIds = read.events.map((event) => event.id);
      const replay = this.state.pendingBatchId && JSON.stringify(this.state.pendingEventIds) === JSON.stringify(eventIds);
      const batchId = replay ? this.state.pendingBatchId! : this.ids.id();
      if (!replay) {
        const pending: ConnectorState = { ...this.state, pendingBatchId: batchId, pendingEventIds: eventIds, updatedAt: attemptAt };
        await this.store.save(pending); this.state = pending;
      }
      const sentAt = this.now.now().toISOString();
      const request = await createSignedBatch(this.signer, {
        batchId,
        case: { caseId: this.identity.caseId, idempotencyKey: `case:${this.identity.caseId}`, caseType: this.identity.caseType, subject: this.identity.subject },
        run: {
          runId: this.identity.runId,
          caseId: this.identity.caseId,
          idempotencyKey: `run:${this.identity.runId}`,
          connectorId: this.identity.connectorId,
          trueForgeSessionId: this.identity.trueForgeSessionId,
        },
        cursor: this.state.cursor,
        events: read.events,
        sentAt,
      });
      const result = await this.client.appendBatch(request);
      if (!result.accepted || !validCursor(result.cursor)) throw new ConnectorError('append_not_accepted', 'TruthLease did not accept a valid cursor', false);
      const next: ConnectorState = { cursor: result.cursor, lastBatchId: batchId, updatedAt: sentAt };
      await this.store.save(next); this.state = next; this.health.cursor = next.cursor; this.health.pendingEvents = 0; this.health.connected = true; this.health.status = 'healthy'; this.health.lastSuccessAt = sentAt; this.health.lastError = undefined; this.health.consecutiveFailures = 0;
      return { sent: read.events.length, cursor: next.cursor };
    } catch (error) {
      const failure = asConnectorError(error); this.health.connected = false; this.health.status = failure.retryable ? 'backing_off' : 'degraded'; this.health.consecutiveFailures += 1; this.health.lastFailureAt = attemptAt; this.health.lastError = { code: failure.code, message: failure.message, retryable: failure.retryable }; throw failure;
    }
  }

  retryDelayMs() { const base = Math.min(this.config.retryMaxMs, this.config.retryBaseMs * (2 ** Math.max(0, this.health.consecutiveFailures - 1))); return Math.max(0, Math.round(base + base * this.config.retryJitter * (Math.random() * 2 - 1))); }
  nextDelayMs() { return this.health.status === 'backing_off' ? this.retryDelayMs() : this.config.pollIntervalMs; }
}
