import { buildCaseEventFeed, fetchTrueForgeEvents } from '../trueforge/case-feed.js';
import { ConnectorError } from './errors.js';
import type { ConnectorCursor, GenuineTrueForgeEvent, TrueForgeEventSource } from './types.js';

export interface LoopbackEventSourceOptions {
  baseUrl: string;
  sessionId: string;
  caseId: string;
  fetchImpl?: typeof fetch;
}

/** Reads the proven native TrueForge session API and derives the same deterministic case events as the local UI feed. */
export class LoopbackTrueForgeEventSource implements TrueForgeEventSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LoopbackEventSourceOptions) {
    const url = new URL(options.baseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new ConnectorError('invalid_loopback', 'TrueForge source must be loopback-only', false);
    if (!options.sessionId || !options.caseId) throw new ConnectorError('invalid_source', 'TrueForge sessionId and caseId are required', false);
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async readAfter(cursor: ConnectorCursor | null, limit: number) {
    try {
      const entries = await fetchTrueForgeEvents(this.baseUrl, this.options.sessionId, this.fetchImpl);
      const feed = buildCaseEventFeed(this.options.caseId, this.options.sessionId, entries, cursor?.sequence);
      const events: GenuineTrueForgeEvent[] = feed.events.slice(0, limit).map((event) => ({
        id: event.id,
        sequence: event.sequence,
        occurredAt: event.timestamp,
        type: event.type,
        genuine: true,
        payload: event.payload,
        source: {
          name: 'trueforge',
          sessionId: this.options.sessionId,
          runId: event.runId,
          ledger: this.options.sessionId,
        },
      }));
      const last = events.at(-1);
      return {
        events,
        nextCursor: last ? { eventId: last.id, sequence: last.sequence } : cursor,
        hasMore: feed.events.length > events.length,
      };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('source_transport_error', 'TrueForge loopback event read failed', true, error);
    }
  }
}
