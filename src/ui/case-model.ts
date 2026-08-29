import type { JsonObject, JsonValue, RunEvent, RunEventType } from "./case-events.js";

export const CASE_STAGE_KEYS = ["evidence", "proof", "approval", "patch", "verified"] as const;

export type CaseStageKey = (typeof CASE_STAGE_KEYS)[number];
export type CaseStageStatus = "waiting" | "active" | "complete" | "failed" | "denied" | "stale";

export interface CaseStageView {
  key: CaseStageKey;
  label: string;
  status: CaseStageStatus;
  event?: RunEvent;
}

export interface CaseViewModel {
  caseId: string;
  runId: string;
  feedStatus: string;
  lastSequence: number;
  events: readonly RunEvent[];
  snapshot?: RunEvent<"state.snapshot">;
  evidence?: RunEvent<"evidence.fetched">;
  evidenceFailure?: RunEvent<"evidence.failed">;
  analysis?: RunEvent<"analysis.completed">;
  analysisFailure?: RunEvent<"analysis.failed">;
  approvalRequest?: RunEvent<"approval.required">;
  approvalResolution?: RunEvent<"approval.resolved">;
  patch?: RunEvent<"patch.applied">;
  patchFailure?: RunEvent<"patch.failed">;
  verification?: RunEvent<"verification.completed">;
  verificationFailure?: RunEvent<"verification.failed">;
  stages: readonly CaseStageView[];
  contractWarnings: readonly string[];
}

function latest<TType extends RunEventType>(
  events: readonly RunEvent[],
  type: TType,
): RunEvent<TType> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) {
      return event as RunEvent<TType>;
    }
  }
  return undefined;
}

function later(first?: RunEvent, second?: RunEvent): RunEvent | undefined {
  if (!first) return second;
  if (!second) return first;
  return first.sequence > second.sequence ? first : second;
}

function normalizedDecision(event?: RunEvent<"approval.resolved">): string | undefined {
  if (!event) return undefined;
  const decision = stringValue(event.payload, "decision") ?? stringValue(event.payload, "status");
  return decision?.toLowerCase();
}

export function buildCaseViewModel(input: {
  caseId: string;
  runId: string;
  status: string;
  lastSequence: number;
  events: readonly RunEvent[];
}): CaseViewModel {
  const snapshot = latest(input.events, "state.snapshot");
  const evidence = latest(input.events, "evidence.fetched");
  const evidenceFailure = latest(input.events, "evidence.failed");
  const analysis = latest(input.events, "analysis.completed");
  const analysisFailure = latest(input.events, "analysis.failed");
  const approvalRequest = latest(input.events, "approval.required");
  const approvalResolution = latest(input.events, "approval.resolved");
  const patch = latest(input.events, "patch.applied");
  const patchFailure = latest(input.events, "patch.failed");
  const verification = latest(input.events, "verification.completed");
  const verificationFailure = latest(input.events, "verification.failed");

  const finalEvidenceEvent = later(evidence, evidenceFailure);
  const finalAnalysisEvent = later(analysis, analysisFailure);
  const finalPatchEvent = later(patch, patchFailure);
  const finalVerificationEvent = later(verification, verificationFailure);
  const decision = normalizedDecision(approvalResolution);
  const approvalDenied = decision === "deny" || decision === "denied" || decision === "rejected";
  const approvalApproved = decision === "approve" || decision === "approved";
  const verifiedPassed =
    finalVerificationEvent?.type === "verification.completed" &&
    booleanValue(finalVerificationEvent.payload, "passed") === true;
  const freshness = objectValue(evidence?.payload, "freshness");
  const evidenceStale =
    booleanValue(evidence?.payload, "stale") === true ||
    booleanValue(freshness, "stale") === true ||
    firstString(evidence?.payload, "freshness_status", "freshnessStatus")?.toLowerCase() === "stale";

  const evidenceStatus: CaseStageStatus =
    finalEvidenceEvent?.type === "evidence.failed"
      ? "failed"
      : finalEvidenceEvent?.type === "evidence.fetched"
        ? evidenceStale
          ? "stale"
          : "complete"
        : "active";
  const proofStatus: CaseStageStatus =
    finalAnalysisEvent?.type === "analysis.failed"
      ? "failed"
      : finalAnalysisEvent?.type === "analysis.completed"
        ? "complete"
        : evidenceStatus === "complete"
          ? "active"
          : "waiting";
  const approvalStatus: CaseStageStatus = approvalDenied
    ? "denied"
    : approvalApproved
      ? "complete"
      : approvalRequest
        ? "active"
        : proofStatus === "complete"
          ? "active"
          : "waiting";
  const patchStatus: CaseStageStatus =
    finalPatchEvent?.type === "patch.failed"
      ? "failed"
      : finalPatchEvent?.type === "patch.applied"
        ? "complete"
        : approvalApproved
          ? "active"
          : "waiting";
  const verifiedStatus: CaseStageStatus =
    finalVerificationEvent?.type === "verification.failed"
      ? "failed"
      : finalVerificationEvent?.type === "verification.completed"
        ? verifiedPassed
          ? "complete"
          : "failed"
        : patchStatus === "complete"
          ? "active"
          : "waiting";

  const warnings: string[] = [];
  if (approvalResolution && !approvalRequest) {
    warnings.push("Approval resolution arrived without a preceding approval request.");
  }
  if (patch && !approvalApproved) {
    warnings.push("A patch receipt arrived without an explicit approved TrueForge resolution.");
  }
  if ((verification || verificationFailure) && !patch) {
    warnings.push("A verification event arrived without a preceding applied patch receipt.");
  }
  if (approvalRequest && stringValue(approvalRequest.payload, "resolutionMode") !== "trueforge_native") {
    warnings.push("The approval request does not declare the required trueforge_native resolution mode.");
  }
  if (evidenceStale && analysis) {
    warnings.push("Analysis arrived from an evidence receipt marked stale.");
  }

  return {
    caseId: input.caseId,
    runId: input.runId,
    feedStatus: input.status,
    lastSequence: input.lastSequence,
    events: input.events,
    snapshot,
    evidence,
    evidenceFailure,
    analysis,
    analysisFailure,
    approvalRequest,
    approvalResolution,
    patch,
    patchFailure,
    verification,
    verificationFailure,
    stages: [
      { key: "evidence", label: "Evidence", status: evidenceStatus, event: finalEvidenceEvent },
      { key: "proof", label: "Proof", status: proofStatus, event: finalAnalysisEvent },
      {
        key: "approval",
        label: "Approval",
        status: approvalStatus,
        event: approvalResolution ?? approvalRequest,
      },
      { key: "patch", label: "Patch", status: patchStatus, event: finalPatchEvent },
      { key: "verified", label: "Verified", status: verifiedStatus, event: finalVerificationEvent },
    ],
    contractWarnings: warnings,
  };
}

export function stringValue(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function numberValue(object: JsonObject | undefined, key: string): number | undefined {
  const value = object?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(object: JsonObject | undefined, key: string): boolean | undefined {
  const value = object?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function objectValue(object: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = object?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function arrayValue(object: JsonObject | undefined, key: string): JsonValue[] {
  const value = object?.[key];
  return Array.isArray(value) ? value : [];
}

export function firstString(
  object: JsonObject | undefined,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = stringValue(object, key);
    if (value !== undefined) return value;
  }
  return undefined;
}
