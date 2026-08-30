/** Compatibility augmentation while the server contract is adopted. */
import type { SignedBatchRequest as BaseSignedBatchRequest } from './types';

declare module './types' {
  interface SignedBatchRequest {
    case?: { caseId: string; idempotencyKey: string; caseType: string; subject: Record<string, unknown> };
    run?: { runId: string; caseId: string; idempotencyKey: string; connectorId: string };
  }
}

export type ContractSignedBatchRequest = BaseSignedBatchRequest;

