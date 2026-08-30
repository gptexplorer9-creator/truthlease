import type { BatchSigner, ConnectorCursor, GenuineTrueForgeEvent, SignedBatchRequest } from './types.js';

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

export async function createSignedBatch(signer: BatchSigner, envelope: SigningEnvelope): Promise<SignedBatchRequest> {
  return {
    ...envelope,
    signature: await signer.sign(signingBytes(envelope)),
    algorithm: signer.algorithm,
    ...(signer.keyId ? { keyId: signer.keyId } : {}),
  };
}
