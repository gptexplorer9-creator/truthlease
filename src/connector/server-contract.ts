import { ConnectorError } from './errors.js';
import { parseAuthorizedHttpUrl, validateAppendResponse } from './transport-validation.js';
import type { ConnectorCursor, SignedBatchRequest, TruthLeaseIngestionClient } from './types.js';

export interface ServerAppendLedgerEventInput {
  eventId: string;
  caseId: string;
  runId: string;
  sequence: number;
  idempotencyKey: string;
  connectorId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  cursor?: ConnectorCursor | null;
}

export interface ServerIngestionEnvelope {
  case: SignedBatchRequest['case'];
  run: SignedBatchRequest['run'];
  events: ServerAppendLedgerEventInput[];
  signature: string;
  algorithm: string;
  keyId?: string;
  sentAt: string;
}

export interface ServerIngestionClientOptions {
  baseUrl: string;
  connectorId: string;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  authorization?: string;
  timeoutMs?: number;
}

/** Exact TruthLease server contract; outbound-only and credential-safe. */
export class ServerContractIngestionClient implements TruthLeaseIngestionClient {
  private readonly fetchImpl: NonNullable<ServerIngestionClientOptions['fetchImpl']>;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(private readonly options: ServerIngestionClientOptions) {
    const base = parseAuthorizedHttpUrl(options.baseUrl, options.authorization);
    if (!options.connectorId) throw new ConnectorError('invalid_connector_id', 'connectorId is required', false);
    this.endpoint = `${base.toString().replace(/\/$/, '')}/api/connectors/${encodeURIComponent(options.connectorId)}/events`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async appendBatch(request: SignedBatchRequest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const envelope: ServerIngestionEnvelope = {
      case: request.case,
      run: request.run,
      events: request.events.map((event) => {
        if (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 1) {
          throw new ConnectorError('invalid_event', 'Every TrueForge event requires a stable positive sequence', false);
        }
        return {
          eventId: event.id,
          caseId: request.case.caseId,
          runId: request.run.runId,
          sequence: Number(event.sequence),
          idempotencyKey: `event:${event.id}`,
          connectorId: request.run.connectorId,
          eventType: event.type,
          payload: event.payload,
          occurredAt: event.occurredAt,
          cursor: request.cursor,
        };
      }),
      signature: request.signature,
      algorithm: request.algorithm,
      ...(request.keyId ? { keyId: request.keyId } : {}),
      sentAt: request.sentAt,
    };
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(this.options.authorization ? { authorization: this.options.authorization } : {}) },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      const raw = await response.text();
      let body: unknown;
      try { body = raw ? JSON.parse(raw) : {}; } catch (cause) { throw new ConnectorError('invalid_response', 'TruthLease returned invalid JSON', response.status >= 500, cause); }
      if (!response.ok) throw new ConnectorError(response.status === 409 ? 'cursor_conflict' : `http_${response.status}`, `TruthLease rejected the batch (${response.status})`, response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500);
      return validateAppendResponse(body, request);
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('transport_error', 'TruthLease ingestion request failed', true, error);
    } finally { clearTimeout(timer); }
  }
}
