export const CASE_STAGE_KEYS = ["evidence", "proof", "approval", "patch", "verified"];
function latest(events, type) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === type) {
            return event;
        }
    }
    return undefined;
}
function later(first, second) {
    if (!first)
        return second;
    if (!second)
        return first;
    return first.sequence > second.sequence ? first : second;
}
function normalizedDecision(event) {
    if (!event)
        return undefined;
    const decision = stringValue(event.payload, "decision") ?? stringValue(event.payload, "status");
    return decision?.toLowerCase();
}
export function buildCaseViewModel(input) {
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
    const verifiedPassed = finalVerificationEvent?.type === "verification.completed" &&
        booleanValue(finalVerificationEvent.payload, "passed") === true;
    const freshness = objectValue(evidence?.payload, "freshness");
    const evidenceStale = booleanValue(evidence?.payload, "stale") === true ||
        booleanValue(freshness, "stale") === true ||
        firstString(evidence?.payload, "freshness_status", "freshnessStatus")?.toLowerCase() === "stale";
    const evidenceStatus = finalEvidenceEvent?.type === "evidence.failed"
        ? "failed"
        : finalEvidenceEvent?.type === "evidence.fetched"
            ? evidenceStale
                ? "stale"
                : "complete"
            : "active";
    const proofStatus = finalAnalysisEvent?.type === "analysis.failed"
        ? "failed"
        : finalAnalysisEvent?.type === "analysis.completed"
            ? "complete"
            : evidenceStatus === "complete"
                ? "active"
                : "waiting";
    const approvalStatus = approvalDenied
        ? "denied"
        : approvalApproved
            ? "complete"
            : approvalRequest
                ? "active"
                : proofStatus === "complete"
                    ? "active"
                    : "waiting";
    const patchStatus = finalPatchEvent?.type === "patch.failed"
        ? "failed"
        : finalPatchEvent?.type === "patch.applied"
            ? "complete"
            : approvalApproved
                ? "active"
                : "waiting";
    const verifiedStatus = finalVerificationEvent?.type === "verification.failed"
        ? "failed"
        : finalVerificationEvent?.type === "verification.completed"
            ? verifiedPassed
                ? "complete"
                : "failed"
            : patchStatus === "complete"
                ? "active"
                : "waiting";
    const warnings = [];
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
export function stringValue(object, key) {
    const value = object?.[key];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
export function numberValue(object, key) {
    const value = object?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function booleanValue(object, key) {
    const value = object?.[key];
    return typeof value === "boolean" ? value : undefined;
}
export function objectValue(object, key) {
    const value = object?.[key];
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
export function arrayValue(object, key) {
    const value = object?.[key];
    return Array.isArray(value) ? value : [];
}
export function firstString(object, ...keys) {
    for (const key of keys) {
        const value = stringValue(object, key);
        if (value !== undefined)
            return value;
    }
    return undefined;
}
