import { ConnectorError } from './errors.js';
import type { ConnectorCursor, SignedBatchRequest } from './types.js';

export interface ValidatedAppendResult {
  accepted: boolean;
  cursor: ConnectorCursor | null;
  duplicate?: boolean;
  idempotentReplay?: boolean;
  receiptId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoopback(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function parseAuthorizedHttpUrl(value: string, authorization?: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ConnectorError('invalid_endpoint', 'Ingestion endpoint must be a valid http(s) URL', false, cause);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorError('invalid_endpoint', 'Ingestion endpoint must be http(s)', false);
  }
  if (authorization && url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new ConnectorError('insecure_endpoint', 'Authorization cannot be sent to a non-loopback plain HTTP endpoint', false);
  }
  return url;
}

function parseCursor(value: unknown): ConnectorCursor | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.eventId !== 'string' || value.eventId.length === 0) return undefined;
  if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1) return undefined;
  return { eventId: value.eventId, sequence: value.sequence };
}

function optionalBoolean(body: Record<string, unknown>, key: 'duplicate' | 'idempotentReplay') {
  const value = body[key];
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ConnectorError('invalid_response', `TruthLease response field ${key} must be boolean`, false);
  }
  return value as boolean | undefined;
}

/** Validate a successful HTTP append acknowledgement against the exact final event sent. */
export function validateAppendResponse(body: unknown, request: SignedBatchRequest): ValidatedAppendResult {
  if (!isRecord(body) || typeof body.accepted !== 'boolean' || !('cursor' in body)) {
    throw new ConnectorError('invalid_response', 'TruthLease response omitted a valid accepted/cursor result', false);
  }
  const cursor = parseCursor(body.cursor);
  if (body.cursor !== null && cursor === undefined) {
    throw new ConnectorError('invalid_response', 'TruthLease response contained an invalid cursor', false);
  }
  const last = request.events.at(-1);
  if (!last || typeof last.sequence !== 'number' || !Number.isSafeInteger(last.sequence) || last.sequence < 1) {
    throw new ConnectorError('invalid_request', 'Append request requires a final event with a stable positive sequence', false);
  }
  if (body.accepted && (!cursor || cursor.eventId !== last.id || cursor.sequence !== last.sequence)) {
    throw new ConnectorError('cursor_mismatch', 'TruthLease accepted the batch without acknowledging the exact final event sent', false);
  }
  if (!body.accepted && cursor !== null) {
    throw new ConnectorError('invalid_response', 'TruthLease returned a cursor for an unaccepted batch', false);
  }
  if (body.receiptId !== undefined && (typeof body.receiptId !== 'string' || body.receiptId.length === 0)) {
    throw new ConnectorError('invalid_response', 'TruthLease response field receiptId must be a non-empty string', false);
  }
  const duplicate = optionalBoolean(body, 'duplicate');
  const idempotentReplay = optionalBoolean(body, 'idempotentReplay');
  return {
    accepted: body.accepted,
    cursor: cursor ?? null,
    ...(duplicate === undefined ? {} : { duplicate }),
    ...(idempotentReplay === undefined ? {} : { idempotentReplay }),
    ...(body.receiptId === undefined ? {} : { receiptId: body.receiptId as string }),
  };
}
