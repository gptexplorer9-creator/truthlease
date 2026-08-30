export type LeaseStatus = "active" | "revoked";

export interface ProductIdentifiers {
  itemNumber: string;
  batchCode: string;
}

export interface RecallEvidence {
  recallNumber: string;
  title: string;
  productName: string;
  recallDate: string;
  hazard: string;
  description: string;
  identifiers: ProductIdentifiers;
  sourceUrl: string;
  retrievedAt: string;
  contentSha256: string;
}

export interface EvidenceReceipt extends RecallEvidence {
  id: string;
  provider: "bright-data";
  recordedAt: string;
}

export interface RecordRecallEvidenceInput {
  sourceUrl: string;
  retrievedAt: string;
  recallNumber: string;
  title: string;
  productName: string;
  recallDate: string;
  hazard: string;
  description: string;
  itemNumber: string;
  batchCode: string;
  evidenceText: string;
}

export interface RecordRecallEvidenceResult {
  idempotentReplay: boolean;
  receipt: EvidenceReceipt;
}

export interface TruthLease {
  id: string;
  decisionType: "publish_product_listing";
  subject: ProductIdentifiers & {
    listingId: string;
    sku: string;
  };
  supportingClaim: string;
  validityConditions: string[];
  downstreamListingIds: string[];
  status: LeaseStatus;
}

export interface Listing extends ProductIdentifiers {
  id: string;
  sku: string;
  title: string;
  published: boolean;
  lastPatchId?: string;
}

export interface AuditEvent {
  id: string;
  type: "containment_patch_applied";
  occurredAt: string;
  patchId: string;
  leaseId: string;
  listingId: string;
  evidenceReceiptId: string;
  evidenceSha256: string;
  analysisSha256: string;
  reason: string;
  expectedVersion: number;
  appliedVersion: number;
  before: { listingPublished: true; leaseStatus: "active" };
  after: { listingPublished: false; leaseStatus: "revoked" };
}

export interface RetailerState {
  version: number;
  leases: TruthLease[];
  listings: Listing[];
  evidenceReceipts: EvidenceReceipt[];
  auditEvents: AuditEvent[];
}

/** Exact snake_case wire contract emitted by the TrueForge sandbox and accepted by MCP. */
export interface ApplyContainmentPatchArguments {
  listing_id: string;
  lease_id: string;
  patch_id: string;
  expected_version: number;
  evidence_receipt_id: string;
  analysis_sha256: string;
  reason: string;
}

export interface ApplyContainmentPatchResult {
  idempotentReplay: boolean;
  receipt: AuditEvent;
  observedStateVersion: number;
  listing: Listing;
  lease: TruthLease;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  observed: unknown;
}

export interface ContainmentVerification {
  patchId: string;
  observedAt: string;
  stateVersion: number;
  passed: boolean;
  verdict: "VERIFIED" | "NOT VERIFIED";
  checks: VerificationCheck[];
}

export type RunEventType =
  | "state.snapshot"
  | "evidence.fetched"
  | "evidence.failed"
  | "analysis.completed"
  | "analysis.failed"
  | "approval.required"
  | "approval.resolved"
  | "patch.applied"
  | "patch.failed"
  | "verification.completed"
  | "verification.failed";

export interface RunEvent<TPayload = unknown> {
  type: RunEventType;
  id: string;
  timestamp: string;
  runId: string;
  sequence: number;
  payload: TPayload;
}
