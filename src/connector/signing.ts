import { createHmac, timingSafeEqual } from 'node:crypto';

import type { BatchSigner, ConnectorCursor, GenuineTrueForgeEvent, SignedBatchRequest } from './types.js';

const MINIMUM_SECRET_BYTES = 32;

export interface ConnectorAttestationCredential {
  readonly secret: string;
  readonly keyId?: string;
}

export interface ConnectorAttestationConfig {
  readonly connectors: Readonly<Record<string, ConnectorAttestationCredential>>;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export interface SigningEnvelope {
  batchId: string;
  case: SignedBatchRequest['case'];
  run: SignedBatchRequest['run'];
  cursor: ConnectorCursor | null;
  events: GenuineTrueForgeEvent[];
  sentAt: string;
}

export function signingBytes(envelope: SigningEnvelope): Uint8Array {
  return new TextEncoder().encode(canonicalJson(envelope));
}

function assertAttestationSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error('Connector attestation secret must contain at least 32 UTF-8 bytes.');
  }
}

function hmacSha256(secret: string, input: Uint8Array): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

function signatureMatches(expected: string, presented: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(presented)) return false;
  const expectedBytes = Buffer.from(expected, 'hex');
  const presentedBytes = Buffer.from(presented, 'hex');
  return expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes);
}

export function createHmacSha256BatchSigner(
  secret: string,
  keyId?: string,
): BatchSigner {
  assertAttestationSecret(secret);
  return {
    algorithm: 'hmac-sha256',
    ...(keyId ? { keyId } : {}),
    sign: (input) => hmacSha256(secret, input),
  };
}

export function signingEnvelope(request: SignedBatchRequest): SigningEnvelope {
  return {
    batchId: request.batchId,
    case: request.case,
    run: request.run,
    cursor: request.cursor,
    events: request.events,
    sentAt: request.sentAt,
  };
}

/**
 * Verifies provenance attestation independently from HTTP transport
 * authentication. Every value the ledger trusts is covered by the canonical
 * HMAC envelope; the signature and algorithm fields themselves are excluded.
 */
export function verifyHmacSha256BatchAttestation(
  request: SignedBatchRequest,
  credential: ConnectorAttestationCredential,
): boolean {
  try {
    assertAttestationSecret(credential.secret);
  } catch {
    return false;
  }
  if (
    request.algorithm !== 'hmac-sha256'
    || (credential.keyId !== undefined && request.keyId !== credential.keyId)
  ) {
    return false;
  }
  const expected = hmacSha256(credential.secret, signingBytes(signingEnvelope(request)));
  return signatureMatches(expected, request.signature);
}

export async function createSignedBatch(signer: BatchSigner, envelope: SigningEnvelope): Promise<SignedBatchRequest> {
  return {
    ...envelope,
    signature: await signer.sign(signingBytes(envelope)),
    algorithm: signer.algorithm,
    ...(signer.keyId ? { keyId: signer.keyId } : {}),
  };
}
