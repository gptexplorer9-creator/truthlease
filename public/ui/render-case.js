import { arrayValue, booleanValue, firstString, objectValue, } from "./case-model.js";
const STATUS_LABELS = {
    waiting: "Waiting",
    active: "In progress",
    complete: "Complete",
    failed: "Failed",
    denied: "Denied",
    stale: "Stale",
};
export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function display(value, fallback = "Not supplied") {
    if (value === undefined || value === null || value === "")
        return fallback;
    return escapeHtml(value);
}
function safeHttpUrl(value) {
    if (typeof value !== "string")
        return undefined;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
    }
    catch {
        return undefined;
    }
}
function eventTime(event) {
    return event ? `<time datetime="${escapeHtml(event.timestamp)}">${escapeHtml(event.timestamp)}</time>` : "Not recorded";
}
function eventMeta(event) {
    if (!event)
        return "";
    return `<p class="event-meta"><span>Sequence ${event.sequence}</span><span>${eventTime(event)}</span><span class="mono">${escapeHtml(event.id)}</span></p>`;
}
function statusPill(status) {
    return `<span class="status status--${status}"><span class="status__dot" aria-hidden="true"></span>${STATUS_LABELS[status]}</span>`;
}
function sectionHeader(step, title, status, eyebrow) {
    const sectionIds = ["evidence", "proof", "approval", "patch", "verified"];
    return `<header class="stage__header">
    <div class="stage__number" aria-hidden="true">${String(step).padStart(2, "0")}</div>
    <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 id="${sectionIds[step - 1]}-title">${escapeHtml(title)}</h2></div>
    ${statusPill(status)}
  </header>`;
}
function readSnapshot(model) {
    const payload = model.snapshot?.payload;
    return {
        lease: objectValue(payload, "lease") ?? objectValue(payload, "priorLease") ?? {},
        listing: objectValue(payload, "listing") ?? objectValue(payload, "priorListing") ?? {},
    };
}
function renderPriorState(model) {
    const { lease, listing } = readSnapshot(model);
    const leaseId = firstString(lease, "lease_id", "leaseId", "id") ?? model.caseId;
    const listingId = firstString(listing, "listing_id", "listingId", "id");
    const itemNumber = firstString(lease, "item_number", "itemNumber");
    const batchCode = firstString(lease, "batch_code", "batchCode");
    const leaseStatus = firstString(lease, "status");
    const listingStatus = firstString(listing, "status", "publication_status", "publicationStatus");
    return `<section class="prior-state" aria-labelledby="prior-state-title">
    <div>
      <p class="eyebrow">Before this run</p>
      <h1 id="prior-state-title">One lease, one listing, no silent action</h1>
      <p class="lede">Lease <strong>${display(leaseId)}</strong> covers item <strong>${display(itemNumber)}</strong> from batch <strong>${display(batchCode)}</strong>. Its current recorded state is <strong>${display(leaseStatus)}</strong>; listing <strong>${display(listingId)}</strong> is <strong>${display(listingStatus)}</strong>.</p>
    </div>
    <dl class="state-facts">
      <div><dt>Case</dt><dd class="mono">${display(model.caseId)}</dd></div>
      <div><dt>Run</dt><dd class="mono">${display(model.runId)}</dd></div>
      <div><dt>Feed</dt><dd>${display(model.feedStatus)}</dd></div>
      <div><dt>Last event</dt><dd>${display(model.lastSequence)}</dd></div>
    </dl>
  </section>`;
}
function failureBlock(event, fallback) {
    const message = firstString(event?.payload, "message", "error", "reason") ?? fallback;
    const code = firstString(event?.payload, "code", "error_code", "errorCode");
    return `<div class="notice notice--danger" role="alert"><strong>${display(code, "Stage failed")}</strong><p>${display(message)}</p><p>No downstream action is represented as complete.</p></div>${eventMeta(event)}`;
}
function renderEvidence(model) {
    const stage = model.stages[0];
    if (stage.status === "failed") {
        return `<section class="stage" id="evidence" aria-labelledby="evidence-title">${sectionHeader(1, "Official evidence", stage.status, "CPSC authority / Bright Data retrieval")}${failureBlock(model.evidenceFailure, "The official evidence could not be retrieved or validated.")}</section>`;
    }
    if (!model.evidence) {
        return `<section class="stage" id="evidence" aria-labelledby="evidence-title">${sectionHeader(1, "Official evidence", stage.status, "CPSC authority / Bright Data retrieval")}<div class="pending-line"><span class="spinner" aria-hidden="true"></span><p>Waiting for a live official CPSC evidence receipt.</p></div></section>`;
    }
    const payload = model.evidence.payload;
    const source = objectValue(payload, "source") ?? payload;
    const receipt = objectValue(payload, "receipt") ?? payload;
    const url = safeHttpUrl(firstString(source, "url", "source_url", "sourceUrl"));
    const transport = firstString(source, "transport", "retrieved_via", "retrievedVia", "provider") ?? "Bright Data";
    const authority = firstString(source, "authority", "publisher") ?? "U.S. Consumer Product Safety Commission";
    const retrievedAt = firstString(receipt, "retrieved_at", "retrievedAt") ?? model.evidence.timestamp;
    const hash = firstString(receipt, "content_hash", "contentHash", "sha256", "hash");
    const title = firstString(payload, "title", "recall_title", "recallTitle");
    const summary = firstString(payload, "summary", "official_summary", "officialSummary");
    return `<section class="stage" id="evidence" aria-labelledby="evidence-title">
    ${sectionHeader(1, "Official evidence", stage.status, `${authority} / ${transport}`)}
    <div class="evidence-grid">
      <div>
        <p class="evidence-kicker">Official source, retrieved through ${display(transport)}</p>
        <h3>${display(title, "CPSC recall evidence received")}</h3>
        <p>${display(summary, "The source receipt is available; no prose summary was supplied.")}</p>
        <p class="hostile-label">External page content is treated as untrusted data, never as instructions.</p>
        ${stage.status === "stale" ? `<div class="notice notice--warning" role="alert"><strong>Evidence receipt is stale</strong><p>Containment cannot advance from this receipt. Retrieve fresh official evidence and begin a new bound analysis.</p></div>` : ""}
      </div>
      <dl class="receipt">
        <div><dt>Authority</dt><dd>${display(authority)}</dd></div>
        <div><dt>Source</dt><dd>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open official page<span class="sr-only"> in a new tab</span></a>` : "Not supplied"}</dd></div>
        <div><dt>Retrieved</dt><dd>${display(retrievedAt)}</dd></div>
        <div><dt>Content hash</dt><dd class="mono breakable">${display(hash)}</dd></div>
      </dl>
    </div>
    ${eventMeta(model.evidence)}
  </section>`;
}
function differingFields(match) {
    const differences = objectValue(match, "differing_fields") ?? objectValue(match, "differingFields");
    if (differences) {
        return Object.entries(differences)
            .map(([field, value]) => `<li><span>${escapeHtml(field.replaceAll("_", " "))}</span><strong>${display(value)}</strong></li>`)
            .join("");
    }
    const field = firstString(match, "differing_field", "differingField", "reason");
    const actual = firstString(match, "actual", "actual_value", "actualValue");
    const expected = firstString(match, "expected", "expected_value", "expectedValue");
    return `<li><span>${display(field, "Difference")}</span><strong>${display(actual)}${expected ? ` instead of ${display(expected)}` : ""}</strong></li>`;
}
function matchRow(value, kind) {
    const match = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    const id = firstString(match, "listing_id", "listingId", "lease_id", "leaseId", "id");
    const item = firstString(match, "item_number", "itemNumber");
    const batch = firstString(match, "batch_code", "batchCode");
    return `<article class="match match--${kind}">
    <div class="match__heading"><span class="match__marker" aria-hidden="true">${kind === "exact" ? "OK" : "X"}</span><div><p class="eyebrow">${kind === "exact" ? "Exact item + batch" : "Excluded near match"}</p><h4>${display(id)}</h4></div></div>
    <dl class="match__keys"><div><dt>Item</dt><dd class="mono">${display(item)}</dd></div><div><dt>Batch</dt><dd class="mono">${display(batch)}</dd></div></dl>
    ${kind === "excluded" ? `<ul class="differences">${differingFields(match)}</ul>` : ""}
  </article>`;
}
function renderProof(model) {
    const stage = model.stages[1];
    if (stage.status === "failed") {
        return `<section class="stage" id="proof" aria-labelledby="proof-title">${sectionHeader(2, "Deterministic proof", stage.status, "Exact item + batch / sandbox output")}${failureBlock(model.analysisFailure, "The deterministic sandbox analysis did not complete.")}</section>`;
    }
    if (!model.analysis) {
        return `<section class="stage" id="proof" aria-labelledby="proof-title">${sectionHeader(2, "Deterministic proof", stage.status, "Exact item + batch / sandbox output")}<p class="empty-state">${stage.status === "waiting" ? "Official evidence must complete before analysis." : "Evidence is bound. Waiting for deterministic sandbox analysis."}</p></section>`;
    }
    const payload = model.analysis.payload;
    const rule = objectValue(payload, "rule") ?? objectValue(payload, "match_rule") ?? payload;
    const exact = objectValue(payload, "exact_match") ?? objectValue(payload, "exactMatch");
    const exclusions = arrayValue(payload, "excluded_matches").length > 0
        ? arrayValue(payload, "excluded_matches")
        : arrayValue(payload, "excludedMatches");
    const sandbox = objectValue(payload, "sandbox") ?? payload;
    const output = firstString(sandbox, "output", "summary", "result");
    const provider = firstString(sandbox, "provider", "runtime") ?? "Not supplied";
    const runId = firstString(sandbox, "run_id", "runId", "execution_id", "executionId");
    const item = firstString(rule, "item_number", "itemNumber");
    const batch = firstString(rule, "batch_code", "batchCode");
    return `<section class="stage" id="proof" aria-labelledby="proof-title">
    ${sectionHeader(2, "Deterministic proof", stage.status, "Exact item + batch / sandbox output")}
    <div class="rule-banner"><span class="rule-banner__operator">AND</span><p>Contain only records where <code>item_number = ${display(item)}</code> and <code>batch_code = ${display(batch)}</code>.</p></div>
    <div class="match-grid">
      ${exact ? matchRow(exact, "exact") : `<p class="notice notice--danger">The completed analysis did not supply its exact match.</p>`}
      ${exclusions.map((entry) => matchRow(entry, "excluded")).join("") || `<p class="notice notice--warning">No excluded near matches were supplied.</p>`}
    </div>
    <div class="sandbox" aria-label="Sandbox result">
      <div class="sandbox__bar"><span>Sandbox output</span><span>${display(provider)}${runId ? ` / ${display(runId)}` : ""}</span></div>
      <pre><code>${display(output, "No sandbox output supplied.")}</code></pre>
    </div>
    ${eventMeta(model.analysis)}
  </section>`;
}
function renderArguments(payload) {
    const args = objectValue(payload, "arguments") ?? objectValue(payload, "args") ?? {};
    return `<dl class="argument-list">${Object.entries(args)
        .map(([key, value]) => `<div><dt class="mono">${escapeHtml(key)}</dt><dd><code>${escapeHtml(JSON.stringify(value))}</code></dd></div>`)
        .join("") || `<div><dt>Arguments</dt><dd>Not supplied</dd></div>`}</dl>`;
}
function renderApproval(model) {
    const stage = model.stages[2];
    const request = model.approvalRequest;
    const resolution = model.approvalResolution;
    const requestPayload = request?.payload ?? {};
    const action = firstString(requestPayload, "action", "tool_name", "toolName");
    const approvalId = firstString(requestPayload, "approvalId", "approval_id");
    const target = objectValue(requestPayload, "trueforgeTarget") ?? objectValue(requestPayload, "trueforge_target");
    const href = safeHttpUrl(firstString(target, "href", "url"));
    const decision = firstString(resolution?.payload, "decision", "status");
    const actor = firstString(resolution?.payload, "actor", "resolved_by", "resolvedBy");
    let stateCopy = `<p class="empty-state">Deterministic proof must complete before TrueForge can request approval.</p>`;
    if (request && !resolution) {
        stateCopy = `<div class="approval-airlock">
      <div><p class="eyebrow">Human control point</p><h3>Paused for genuine TrueForge approval</h3><p>No retailer state changes while this case is pending. Review the immutable action and exact arguments below, then choose inside TrueForge's native approval UI.</p><div class="approval-choices" aria-label="Decisions available in TrueForge"><span>Approve in TrueForge</span><span>Deny in TrueForge</span></div></div>
      ${href ? `<a class="button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Open genuine TrueForge approval<span class="sr-only"> in a new tab</span></a>` : `<p class="target-missing">No verified TrueForge approval target was supplied. Open the native TrueForge session directly.</p>`}
    </div>`;
    }
    else if (resolution) {
        const denied = stage.status === "denied";
        stateCopy = `<div class="notice ${denied ? "notice--warning" : "notice--success"}" role="status"><strong>${denied ? "Denied in TrueForge" : "Approved in TrueForge"}</strong><p>Decision: ${display(decision)}${actor ? ` by ${display(actor)}` : ""}. ${denied ? "No patch is authorized." : "The backend may apply only the approved arguments shown here."}</p></div>`;
    }
    else if (stage.status === "active") {
        stateCopy = `<p class="empty-state">Proof is complete. Waiting for a native TrueForge approval request.</p>`;
    }
    return `<section class="stage stage--approval" id="approval" aria-labelledby="approval-title">
    ${sectionHeader(3, "Human approval", stage.status, "TrueForge native / display-only")}
    ${stateCopy}
    ${request ? `<div class="action-contract"><div><p class="eyebrow">Approval ID</p><p class="mono breakable">${display(approvalId)}</p></div><div><p class="eyebrow">Tool action</p><p><code>${display(action)}</code></p></div></div>${renderArguments(requestPayload)}${eventMeta(resolution ?? request)}` : ""}
  </section>`;
}
function renderPatch(model) {
    const stage = model.stages[3];
    if (stage.status === "failed") {
        const code = firstString(model.patchFailure?.payload, "code", "error_code", "errorCode");
        const conflict = code?.toLowerCase() === "version_conflict";
        return `<section class="stage" id="patch" aria-labelledby="patch-title">${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}${failureBlock(model.patchFailure, conflict ? "Persisted state changed after approval; the approved patch was not applied." : "The approved patch failed.")}${conflict ? `<div class="notice notice--warning"><strong>Approval is stale</strong><p>Do not auto-retry or change mutation arguments. A new evidence, analysis, and approval run is required.</p></div>` : `<p class="no-retry">No automatic retry with new arguments is permitted after approval.</p>`}</section>`;
    }
    if (!model.patch) {
        return `<section class="stage" id="patch" aria-labelledby="patch-title">${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}<p class="empty-state">${stage.status === "active" ? "Approval is recorded. Waiting for one atomic backend patch receipt." : "No mutation is authorized yet."}</p></section>`;
    }
    const payload = model.patch.payload;
    const patchId = firstString(payload, "patch_id", "patchId");
    const receiptHash = firstString(payload, "receipt_hash", "receiptHash", "hash");
    const lease = objectValue(payload, "lease") ?? {};
    const listing = objectValue(payload, "listing") ?? {};
    const replay = booleanValue(payload, "idempotent_replay") ?? booleanValue(payload, "idempotentReplay");
    return `<section class="stage" id="patch" aria-labelledby="patch-title">
    ${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}
    ${replay ? `<div class="notice notice--info"><strong>Idempotent replay</strong><p>The same patch ID returned its existing receipt. No second mutation was applied.</p></div>` : ""}
    <div class="receipt-card">
      <div class="receipt-card__title"><p class="eyebrow">Atomic patch receipt</p><h3>${display(patchId)}</h3></div>
      <dl>
        <div><dt>Lease</dt><dd><strong>${display(firstString(lease, "lease_id", "leaseId", "id"))}</strong> -&gt; ${display(firstString(lease, "status"))}</dd></div>
        <div><dt>Listing</dt><dd><strong>${display(firstString(listing, "listing_id", "listingId", "id"))}</strong> -&gt; ${display(firstString(listing, "status", "publication_status", "publicationStatus"))}</dd></div>
        <div><dt>Version</dt><dd>${display(payload.prior_version ?? payload.priorVersion)} -&gt; ${display(payload.new_version ?? payload.newVersion)}</dd></div>
        <div><dt>Receipt hash</dt><dd class="mono breakable">${display(receiptHash)}</dd></div>
      </dl>
    </div>
    ${eventMeta(model.patch)}
  </section>`;
}
function verificationCheck(label, object, idKeys) {
    const id = firstString(object, ...idKeys);
    const status = firstString(object, "status", "publication_status", "publicationStatus");
    return `<li><span class="checkmark" aria-hidden="true">OK</span><div><strong>${escapeHtml(label)} ${display(id)}</strong><p>Fresh read returned ${display(status)}.</p></div></li>`;
}
function renderVerification(model) {
    const stage = model.stages[4];
    if (stage.status === "failed") {
        const event = model.verificationFailure ?? model.verification;
        return `<section class="stage" id="verified" aria-labelledby="verified-title">${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}${failureBlock(event, "The post-action persisted-state re-read did not prove the intended result.")}<div class="notice notice--warning"><strong>Containment is not verified</strong><p>A patch receipt alone is not enough to claim the stored outcome.</p></div></section>`;
    }
    if (!model.verification) {
        return `<section class="stage" id="verified" aria-labelledby="verified-title">${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}<p class="empty-state">${stage.status === "active" ? "Patch receipt recorded. Re-reading persisted retailer state now." : "Verification begins only after an applied patch receipt."}</p></section>`;
    }
    const payload = model.verification.payload;
    const lease = objectValue(payload, "lease") ?? {};
    const listing = objectValue(payload, "listing") ?? {};
    const exclusions = arrayValue(payload, "excluded_listings").length > 0 ? arrayValue(payload, "excluded_listings") : arrayValue(payload, "excludedListings");
    const readAt = firstString(payload, "read_at", "readAt") ?? model.verification.timestamp;
    return `<section class="stage stage--verified" id="verified" aria-labelledby="verified-title">
    ${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}
    <div class="verified-banner"><span class="verified-banner__mark" aria-hidden="true">OK</span><div><p class="eyebrow">Persisted result confirmed</p><h3>The affected lease is contained.</h3><p>This is a fresh read of stored retailer state after the patch - not an independent third-party verification.</p></div></div>
    <ul class="verification-list">
      ${verificationCheck("Lease", lease, ["lease_id", "leaseId", "id"])}
      ${verificationCheck("Listing", listing, ["listing_id", "listingId", "id"])}
      ${exclusions.map((entry) => {
        const object = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
        return verificationCheck("Excluded listing", object, ["listing_id", "listingId", "id"]);
    }).join("")}
    </ul>
    <p class="verification-time">Fresh read at ${display(readAt)}</p>
    ${eventMeta(model.verification)}
  </section>`;
}
function renderStageRail(model) {
    return `<nav class="stage-rail" aria-label="Case progress"><ol>${model.stages
        .map((stage, index) => `<li class="stage-rail__item stage-rail__item--${stage.status}"><a href="#${stage.key}"${stage.status === "active" ? ` aria-current="step"` : ""}><span class="stage-rail__number">${String(index + 1).padStart(2, "0")}</span><span><strong>${stage.label}</strong><small>${STATUS_LABELS[stage.status]}</small></span></a></li>`)
        .join("")}</ol></nav>`;
}
function renderContractWarnings(model) {
    if (model.contractWarnings.length === 0)
        return "";
    return `<aside class="contract-warning" role="alert"><strong>Event contract inconsistency</strong><ul>${model.contractWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul><p>The UI will show the received records but will not infer missing authority.</p></aside>`;
}
export function renderCaseHtml(model) {
    const isFixture = model.feedStatus.toLowerCase().includes("fixture");
    return `<a class="skip-link" href="#case-file">Skip to case file</a>
  <div class="shell">
    <header class="product-header">
      <a class="wordmark" href="/" aria-label="TruthLease home"><span class="wordmark__mark" aria-hidden="true">TL</span><span>TruthLease</span></a>
      <div class="product-header__context"><span>Operational case file</span><span class="live-indicator${isFixture ? " live-indicator--fixture" : ""}"><span aria-hidden="true"></span> ${isFixture ? "Reference fixture - not live" : "Read-only live feed"}</span></div>
    </header>
    <main id="case-file">
      ${renderPriorState(model)}
      ${renderStageRail(model)}
      ${renderContractWarnings(model)}
      <div class="case-ledger">
        ${renderEvidence(model)}
        ${renderProof(model)}
        ${renderApproval(model)}
        ${renderPatch(model)}
        ${renderVerification(model)}
      </div>
    </main>
    <footer><p>Append-only run <span class="mono">${display(model.runId)}</span>. Operational states are rendered deterministically from backend events.</p></footer>
  </div>`;
}
export function renderLoadingHtml(caseId) {
    return `<a class="skip-link" href="#case-file">Skip to case file</a><div class="shell"><header class="product-header"><div class="wordmark"><span class="wordmark__mark" aria-hidden="true">TL</span><span>TruthLease</span></div><div class="product-header__context"><span>Operational case file</span></div></header><main id="case-file"><section class="loading-page" aria-busy="true"><span class="spinner" aria-hidden="true"></span><p class="eyebrow">Case ${escapeHtml(caseId)}</p><h1>Opening the append-only case file...</h1><p>Waiting for the ordered backend event feed. No action is taken from this browser.</p></section></main></div>`;
}
export function renderFeedErrorHtml(caseId, message) {
    return `<a class="skip-link" href="#case-file">Skip to case file</a><div class="shell"><header class="product-header"><div class="wordmark"><span class="wordmark__mark" aria-hidden="true">TL</span><span>TruthLease</span></div><div class="product-header__context"><span>Operational case file</span></div></header><main id="case-file"><section class="feed-error" role="alert"><p class="eyebrow">Case ${escapeHtml(caseId)}</p><h1>The case feed is unavailable.</h1><p>${escapeHtml(message)}</p><p>This is a connection problem, not evidence that the operation failed. No browser mutation was attempted.</p></section></main></div>`;
}
