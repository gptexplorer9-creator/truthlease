import { ConnectorError } from './errors.js';
import { parseAuthorizedHttpUrl, validateAppendResponse } from './transport-validation.js';
import type { SignedBatchRequest, TruthLeaseIngestionClient } from './types.js';

export interface HttpIngestionClientOptions {
  endpoint: string;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  authorization?: string;
  timeoutMs?: number;
}

/** Outbound HTTP only: no local listener and no inbound command path. */
export class HttpTruthLeaseIngestionClient implements TruthLeaseIngestionClient {
  private readonly fetchImpl: NonNullable<HttpIngestionClientOptions['fetchImpl']>;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpIngestionClientOptions) {
    parseAuthorizedHttpUrl(options.endpoint, options.authorization);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async appendBatch(request: SignedBatchRequest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', accept: 'application/json', 'idempotency-key': request.batchId,
          ...(this.options.authorization ? { authorization: this.options.authorization } : {}),
        },
        body: JSON.stringify(request), signal: controller.signal,
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
