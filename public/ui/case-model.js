import { classifyFeedProvenance } from "./runtime-state.js";
export const CASE_STAGE_KEYS = ["evidence", "proof", "approval", "patch", "verified"];
export const EXPECTED_CPSC_AUTHORITY = "U.S. Consumer Product Safety Commission";
export const EXPECTED_BRIGHT_DATA_TRANSPORT = "Bright Data Web MCP";
export const EXPECTED_CPSC_SOURCE_URL = "https://www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle-Grasping-and-Teething-Toys-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-and-Ingestion-Hazards";
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
function addWarning(warnings, message) {
    if (!warnings.includes(message)) {
        warnings.push(message);
    }
}
function setStageNote(notes, key, message) {
    if (notes[key] === undefined) {
        notes[key] = message;
    }
}
function hasIdentityStatus(object, idKeys) {
    const id = firstString(object, ...idKeys);
    const status = firstString(object, "status", "publication_status", "publicationStatus");
    return id !== undefined && status !== undefined;
}
function analysisHasContract(event) {
    const payload = event?.payload;
    const rule = objectValue(payload, "rule") ?? objectValue(payload, "match_rule") ?? payload;
    const exact = objectValue(payload, "exact_match") ?? objectValue(payload, "exactMatch");
    const ruleItem = firstString(rule, "item_number", "itemNumber");
    const ruleBatch = firstString(rule, "batch_code", "batchCode");
    const exactItem = firstString(exact, "item_number", "itemNumber");
    const exactBatch = firstString(exact, "batch_code", "batchCode");
    return (ruleItem !== undefined &&
        ruleBatch !== undefined &&
        firstString(exact, "listing_id", "listingId", "id") !== undefined &&
        exactItem === ruleItem &&
        exactBatch === ruleBatch);
}
function patchHasContract(event) {
    if (!event)
        return false;
    return (firstString(event.payload, "patch_id", "patchId") !== undefined &&
        hasIdentityStatus(objectValue(event.payload, "lease"), ["lease_id", "leaseId", "id"]) &&
        hasIdentityStatus(objectValue(event.payload, "listing"), ["listing_id", "listingId", "id"]));
}
function verificationHasContract(event, patch) {
    if (!event || !patch)
        return false;
    const lease = objectValue(event.payload, "lease");
    const listing = objectValue(event.payload, "listing");
    const patchedLease = objectValue(patch.payload, "lease");
    const patchedListing = objectValue(patch.payload, "listing");
    const leaseId = firstString(lease, "lease_id", "leaseId", "id");
    const listingId = firstString(listing, "listing_id", "listingId", "id");
    return (leaseId !== undefined &&
        leaseId === firstString(patchedLease, "lease_id", "leaseId", "id") &&
        firstString(lease, "status")?.toLowerCase() === "revoked" &&
        listingId !== undefined &&
        listingId === firstString(patchedListing, "listing_id", "listingId", "id") &&
        firstString(listing, "status", "publication_status", "publicationStatus")?.toLowerCase() === "unpublished");
}
export function checkEvidenceContract(event) {
    if (!event || event.type !== "evidence.fetched")
        return { valid: false, problems: ["No evidence receipt was supplied."] };
    const source = objectValue(event.payload, "source");
    const receipt = objectValue(event.payload, "receipt");
    const authority = firstString(source, "authority");
    const transport = firstString(source, "transport");
    const url = firstString(source, "url");
    const retrievedAt = firstString(receipt, "retrieved_at");
    const hash = firstString(receipt, "content_hash");
    const problems = [];
    if (authority !== EXPECTED_CPSC_AUTHORITY)
        problems.push("The canonical CPSC authority is missing or different.");
    if (transport !== EXPECTED_BRIGHT_DATA_TRANSPORT)
        problems.push("The Bright Data Web MCP transport is missing or different.");
    if (url !== EXPECTED_CPSC_SOURCE_URL)
        problems.push("The source URL is not the canonical CPSC recall page.");
    if (!retrievedAt || Number.isNaN(Date.parse(retrievedAt)))
        problems.push("The retrieval timestamp is missing or invalid.");
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash))
        problems.push("The content hash must be exactly 64 hexadecimal characters.");
    return { valid: problems.length === 0, problems };
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
    const freshness = objectValue(evidence?.payload, "freshness");
    const evidenceStale = booleanValue(evidence?.payload, "stale") === true ||
        booleanValue(freshness, "stale") === true ||
        firstString(evidence?.payload, "freshness_status", "freshnessStatus")?.toLowerCase() === "stale";
    const evidenceContract = checkEvidenceContract(evidence);
    const evidenceContractInvalid = evidence !== undefined && !evidenceContract.valid;
    const stageNotes = {
        evidence: undefined,
        proof: undefined,
        approval: undefined,
        patch: undefined,
        verified: undefined,
    };
    const warnings = [];
    const evidenceReady = finalEvidenceEvent?.type === "evidence.fetched" && !evidenceStale && evidenceContract.valid;
    const analysisAfterEvidence = analysis !== undefined && evidence !== undefined && analysis.sequence > evidence.sequence;
    const proofTrusted = finalAnalysisEvent?.type === "analysis.completed" &&
        evidenceReady &&
        analysisAfterEvidence &&
        analysisHasContract(analysis);
    if (evidenceContractInvalid) {
        addWarning(warnings, `Evidence receipt rejected: ${evidenceContract.problems.join(" ")}`);
        setStageNote(stageNotes, "evidence", "The received evidence event does not satisfy the canonical CPSC and Bright Data receipt contract. It is retained in run activity but cannot unlock analysis or approval.");
    }
    if (analysis && evidenceContractInvalid) {
        addWarning(warnings, "Analysis arrived after a malformed evidence receipt.");
        setStageNote(stageNotes, "proof", "A proof event was received, but the upstream evidence receipt failed the canonical source, transport, timestamp, or hash contract.");
    }
    else if (analysis && evidenceStale) {
        addWarning(warnings, "Analysis arrived from an evidence receipt marked stale.");
        setStageNote(stageNotes, "proof", "A proof event was received, but the upstream evidence receipt is stale. TruthLease will not mark proof complete or unlock downstream stages.");
    }
    else if (analysis && !evidence) {
        addWarning(warnings, "Deterministic proof arrived without a fresh official evidence receipt.");
        setStageNote(stageNotes, "proof", "A proof event was received before any qualifying official evidence receipt. The raw event remains visible, but TruthLease does not accept it as completed proof.");
    }
    else if (analysis && !analysisAfterEvidence) {
        addWarning(warnings, "Deterministic proof did not occur after the qualifying evidence receipt.");
        setStageNote(stageNotes, "proof", "The proof event does not follow the evidence receipt in the causal order, so the UI will not render proof complete.");
    }
    else if (analysis && !analysisHasContract(analysis)) {
        addWarning(warnings, "Analysis completed without an exact match equal to the declared item-and-batch rule.");
        setStageNote(stageNotes, "proof", "The proof event does not identify one listing whose item and batch exactly equal the declared rule.");
    }
    const approvalRequestNative = stringValue(approvalRequest?.payload, "resolutionMode") === "trueforge_native";
    const approvalRequestAfterProof = approvalRequest !== undefined && analysis !== undefined && approvalRequest.sequence > analysis.sequence;
    if (approvalResolution && !approvalRequest) {
        addWarning(warnings, "Approval resolution arrived without a preceding approval request.");
        setStageNote(stageNotes, "approval", "A resolution was received without a valid pending approval request. The UI keeps the approval stage incomplete.");
    }
    if (approvalRequest && stringValue(approvalRequest.payload, "resolutionMode") !== "trueforge_native") {
        addWarning(warnings, "The approval request does not declare the required trueforge_native resolution mode.");
        setStageNote(stageNotes, "approval", "The approval request does not declare the native TrueForge resolution mode required by this shell.");
    }
    if (approvalRequest && !proofTrusted) {
        addWarning(warnings, "Approval request arrived before trusted deterministic proof completed.");
        setStageNote(stageNotes, "approval", "An approval request was received, but upstream proof is not trustworthy enough to unlock human approval in this UI.");
    }
    else if (approvalRequest && !approvalRequestAfterProof) {
        addWarning(warnings, "Approval request did not occur after deterministic proof.");
        setStageNote(stageNotes, "approval", "The approval request does not follow deterministic proof in the event order, so the stage cannot render active authority.");
    }
    const approvalResolutionAfterRequest = approvalResolution !== undefined &&
        approvalRequest !== undefined &&
        approvalResolution.sequence > approvalRequest.sequence;
    if (approvalResolution && approvalRequest && !approvalResolutionAfterRequest) {
        addWarning(warnings, "Approval resolution did not occur after the approval request.");
        setStageNote(stageNotes, "approval", "The approval resolution is out of order relative to the request. TruthLease will not treat it as authoritative completion.");
    }
    const approvalRequestTrusted = !!approvalRequest && approvalRequestNative && proofTrusted && approvalRequestAfterProof;
    const approvalResolutionTrusted = !!approvalResolution && approvalRequestTrusted && approvalResolutionAfterRequest;
    const approvalDeniedTrusted = approvalResolutionTrusted && approvalDenied;
    const approvalApprovedTrusted = approvalResolutionTrusted && approvalApproved;
    const patchAfterApproval = patch !== undefined && approvalResolution !== undefined && patch.sequence > approvalResolution.sequence;
    const patchFailureAfterApproval = patchFailure !== undefined && approvalResolution !== undefined && patchFailure.sequence > approvalResolution.sequence;
    const trustedPatchReceipt = finalPatchEvent?.type === "patch.applied" &&
        approvalApprovedTrusted &&
        patchAfterApproval &&
        patchHasContract(patch);
    const trustedPatchFailure = finalPatchEvent?.type === "patch.failed" && approvalApprovedTrusted && patchFailureAfterApproval;
    if (patch && !approvalApprovedTrusted) {
        addWarning(warnings, "A patch receipt arrived without an explicit approved TrueForge resolution.");
        setStageNote(stageNotes, "patch", "A patch receipt was received without a trustworthy approved TrueForge resolution. The UI shows the event but not a completed mutation.");
    }
    else if (patch && !patchAfterApproval) {
        addWarning(warnings, "Patch receipt did not occur after the approved TrueForge resolution.");
        setStageNote(stageNotes, "patch", "The patch receipt is out of causal order relative to approval, so mutation completion is withheld.");
    }
    else if (patch && !patchHasContract(patch)) {
        addWarning(warnings, "Patch receipt is missing the persisted mutation contract fields.");
        setStageNote(stageNotes, "patch", "The patch receipt is missing the minimum persisted mutation fields required to render the patch stage complete.");
    }
    if (patchFailure && !approvalApprovedTrusted) {
        addWarning(warnings, "Patch failure arrived without an explicit approved TrueForge resolution.");
        setStageNote(stageNotes, "patch", "A patch failure event was received without a trustworthy approved TrueForge resolution, so the patch stage stays incomplete.");
    }
    else if (patchFailure && !patchFailureAfterApproval) {
        addWarning(warnings, "Patch failure did not occur after the approved TrueForge resolution.");
        setStageNote(stageNotes, "patch", "The patch failure event is out of order relative to approval, so the UI refuses to treat it as the stage terminal event.");
    }
    const verificationAfterPatch = verification !== undefined && patch !== undefined && verification.sequence > patch.sequence;
    const verificationFailureAfterPatch = verificationFailure !== undefined &&
        patch !== undefined &&
        verificationFailure.sequence > patch.sequence;
    const verificationPassed = finalVerificationEvent?.type === "verification.completed" &&
        booleanValue(finalVerificationEvent.payload, "passed") === true;
    const trustedVerification = finalVerificationEvent?.type === "verification.completed" &&
        trustedPatchReceipt &&
        verificationAfterPatch &&
        verificationPassed &&
        verificationHasContract(verification, patch);
    const trustedVerificationFailure = finalVerificationEvent?.type === "verification.failed" &&
        trustedPatchReceipt &&
        verificationFailureAfterPatch;
    const trustedVerificationMiss = finalVerificationEvent?.type === "verification.completed" &&
        trustedPatchReceipt &&
        verificationAfterPatch &&
        !verificationPassed;
    if ((verification || verificationFailure) && !patch) {
        addWarning(warnings, "A verification event arrived without a preceding applied patch receipt.");
        setStageNote(stageNotes, "verified", "A verification event was received before any applied patch receipt. TruthLease will not render a verified result.");
    }
    else if (verification && !trustedPatchReceipt) {
        addWarning(warnings, "Verification arrived before a trustworthy applied patch receipt.");
        setStageNote(stageNotes, "verified", "A verification event was received, but the mutation receipt is not trustworthy enough to support a green verified state.");
    }
    else if (verification && !verificationAfterPatch) {
        addWarning(warnings, "Verification did not occur after the applied patch receipt.");
        setStageNote(stageNotes, "verified", "The verification event is out of order relative to the applied patch receipt, so the UI will not render a verified completion.");
    }
    else if (verification && verificationPassed && !verificationHasContract(verification, patch)) {
        addWarning(warnings, "Verification completed without matching the patch receipt's revoked lease and unpublished listing.");
        setStageNote(stageNotes, "verified", "The verification event reports success but does not prove the same revoked lease and unpublished listing identified by the trusted patch receipt.");
    }
    if (verificationFailure && patch && !trustedPatchReceipt) {
        addWarning(warnings, "Verification failure arrived before a trustworthy applied patch receipt.");
        setStageNote(stageNotes, "verified", "A verification failure event was received before the applied patch receipt became trustworthy, so the verified stage stays incomplete.");
    }
    else if (verificationFailure && patch && !verificationFailureAfterPatch) {
        addWarning(warnings, "Verification failure did not occur after the applied patch receipt.");
        setStageNote(stageNotes, "verified", "The verification failure event is out of order relative to the patch receipt, so it cannot close the verified stage.");
    }
    const evidenceStatus = finalEvidenceEvent?.type === "evidence.failed"
        ? "failed"
        : finalEvidenceEvent?.type === "evidence.fetched"
            ? evidenceContractInvalid
                ? "failed"
                : evidenceStale
                    ? "stale"
                    : "complete"
            : "active";
    const proofStatus = finalAnalysisEvent?.type === "analysis.failed" && evidenceReady
        ? "failed"
        : proofTrusted
            ? "complete"
            : analysis && !proofTrusted
                ? "waiting"
                : evidenceReady
                    ? "active"
                    : "waiting";
    const approvalStatus = approvalDeniedTrusted
        ? "denied"
        : approvalApprovedTrusted
            ? "complete"
            : approvalRequestTrusted
                ? "active"
                : approvalRequest || approvalResolution
                    ? "waiting"
                    : proofTrusted
                        ? "active"
                        : "waiting";
    const patchStatus = trustedPatchFailure
        ? "failed"
        : trustedPatchReceipt
            ? "complete"
            : patch || patchFailure
                ? "waiting"
                : approvalApprovedTrusted
                    ? "active"
                    : "waiting";
    const verifiedStatus = trustedVerificationFailure || trustedVerificationMiss
        ? "failed"
        : trustedVerification
            ? "complete"
            : verification || verificationFailure
                ? "waiting"
                : trustedPatchReceipt
                    ? "active"
                    : "waiting";
    return {
        caseId: input.caseId,
        runId: input.runId,
        feedStatus: input.status,
        provenance: classifyFeedProvenance(input.status),
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
        stageNotes,
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
