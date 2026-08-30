import type { JsonObject, JsonValue, RunEvent } from "./case-events.js";
import {
  arrayValue,
  booleanValue,
  checkEvidenceContract,
  firstString,
  objectValue,
  type CaseStageKey,
  type CaseStageStatus,
  type CaseViewModel,
} from "./case-model.js";
import type { FeedProvenance, TerminalState } from "./runtime-state.js";
import { classifyFeedProvenance } from "./runtime-state.js";

const STATUS_LABELS: Record<CaseStageStatus, string> = {
  waiting: "Waiting",
  active: "In progress",
  complete: "Complete",
  failed: "Failed",
  denied: "Denied",
  stale: "Stale",
};

const PROVENANCE_LABELS: Record<FeedProvenance, string> = {
  live: "live",
  fixture: "fixture",
  unavailable: "not yet established",
};

const TERMINAL_LABELS: Record<TerminalState, string> = {
  loading: "Connecting",
  connected: "Connected",
  offline: "Offline",
  unauthorized: "Unauthorized",
  unavailable: "Unavailable",
};

const STAGE_IDS: readonly CaseStageKey[] = ["evidence", "proof", "approval", "patch", "verified"];

const FRIENDLY_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export interface QueueCaseSummary {
  caseId: string;
  caseType?: string;
  subject?: string;
  createdAt?: string;
}

export type QueueState = "loading" | "ready" | "unavailable";

export interface RenderRuntimeState {
  feedProvenance?: FeedProvenance;
  terminalState?: TerminalState;
  connectionMessage?: string;
  nextRetryAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  queueCases?: readonly QueueCaseSummary[];
  queueState?: QueueState;
  queueHasMore?: boolean;
  queueLoadingMore?: boolean;
  queueContinuationError?: string;
}

interface NormalizedRuntimeState {
  feedProvenance: FeedProvenance;
  terminalState: TerminalState;
  connectionMessage: string;
  nextRetryAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  queueCases: readonly QueueCaseSummary[];
  queueState: QueueState;
  queueHasMore: boolean;
  queueLoadingMore: boolean;
  queueContinuationError?: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value: unknown, fallback = "Not supplied"): string {
  if (value === undefined || value === null || value === "") return fallback;
  return escapeHtml(value);
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function formatTimestamp(value: string | undefined, fallback = "Not recorded"): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return escapeHtml(value);
  }
  const iso = parsed.toISOString();
  return `<time class="timestamp" datetime="${escapeHtml(iso)}"><span class="timestamp__friendly">${escapeHtml(FRIENDLY_TIME_FORMAT.format(parsed))}</span><span class="timestamp__exact mono">${escapeHtml(iso)}</span></time>`;
}

function defaultConnectionMessage(runtime: NormalizedRuntimeState): string {
  if (runtime.terminalState === "loading") {
    return "Connecting to the ordered read-only case feed.";
  }
  if (runtime.terminalState === "connected") {
    return runtime.feedProvenance === "fixture"
      ? "Reference fixture loaded. This browser is not showing live evidence."
      : "Read-only case feed connected. Browser approval and mutation remain disabled.";
  }
  if (runtime.terminalState === "offline") {
    return "The browser is offline or the local feed is unreachable. Retrying with backoff.";
  }
  if (runtime.terminalState === "unauthorized") {
    return "The feed rejected this browser session. Retrying with backoff without inventing state.";
  }
  return "The case feed is unavailable from this shell. Retrying with backoff when possible.";
}

function normalizeRuntime(
  model: CaseViewModel | undefined,
  runtime: RenderRuntimeState | undefined,
  fallbackState: TerminalState,
): NormalizedRuntimeState {
  const feedProvenance =
    runtime?.feedProvenance ?? model?.provenance ?? classifyFeedProvenance(model?.feedStatus);
  const terminalState = runtime?.terminalState ?? fallbackState;
  const normalized: NormalizedRuntimeState = {
    feedProvenance,
    terminalState,
    connectionMessage: runtime?.connectionMessage ?? "",
    nextRetryAt: runtime?.nextRetryAt,
    lastAttemptAt: runtime?.lastAttemptAt,
    lastSuccessAt: runtime?.lastSuccessAt,
    queueCases: runtime?.queueCases ?? [],
    queueState: runtime?.queueState ?? "loading",
    queueHasMore: runtime?.queueHasMore === true,
    queueLoadingMore: runtime?.queueLoadingMore === true,
    queueContinuationError: runtime?.queueContinuationError,
  };
  normalized.connectionMessage =
    normalized.connectionMessage.trim() !== "" ? normalized.connectionMessage : defaultConnectionMessage(normalized);
  return normalized;
}

function eventTime(event?: RunEvent): string {
  return event ? formatTimestamp(event.timestamp) : "Not recorded";
}

function eventMeta(event?: RunEvent): string {
  if (!event) return "";
  return `<p class="event-meta"><span>Sequence ${event.sequence}</span><span>${eventTime(event)}</span><span class="mono">${escapeHtml(event.id)}</span></p>`;
}

function statusPill(status: CaseStageStatus): string {
  return `<span class="status status--${status}"><span class="status__dot" aria-hidden="true"></span>${STATUS_LABELS[status]}</span>`;
}

function provenanceBadge(provenance: FeedProvenance): string {
  return `<span class="provenance-badge provenance-badge--${provenance}">Feed provenance ${PROVENANCE_LABELS[provenance]}</span>`;
}

function sectionHeader(step: number, title: string, status: CaseStageStatus, eyebrow: string): string {
  return `<header class="stage__header">
    <div class="stage__number" aria-hidden="true">${String(step).padStart(2, "0")}</div>
    <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 id="${STAGE_IDS[step - 1]}-title">${escapeHtml(title)}</h2></div>
    ${statusPill(status)}
  </header>`;
}

function currentStageSummary(model: CaseViewModel): string {
  const active = model.stages.find((stage) => stage.status === "active");
  if (active) return `${active.label} ${STATUS_LABELS[active.status].toLowerCase()}`;
  const caution = model.stages.find(
    (stage) => stage.status === "failed" || stage.status === "denied" || stage.status === "stale",
  );
  if (caution) return `${caution.label} ${STATUS_LABELS[caution.status].toLowerCase()}`;
  const completed = [...model.stages].reverse().find((stage) => stage.status === "complete");
  return completed ? `${completed.label} complete` : "Awaiting evidence";
}

function stageNote(model: CaseViewModel, key: CaseStageKey, title: string): string {
  const note = model.stageNotes[key];
  if (!note) return "";
  return `<div class="notice notice--warning" role="alert"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(note)}</p><p>The raw event remains visible in run activity below.</p></div>`;
}

function readSnapshot(model: CaseViewModel): { lease: JsonObject; listing: JsonObject } {
  const payload = model.snapshot?.payload;
  return {
    lease: objectValue(payload, "lease") ?? objectValue(payload, "priorLease") ?? {},
    listing: objectValue(payload, "listing") ?? objectValue(payload, "priorListing") ?? {},
  };
}

function renderPriorState(model: CaseViewModel, runtime: NormalizedRuntimeState): string {
  const { lease, listing } = readSnapshot(model);
  const leaseId = firstString(lease, "lease_id", "leaseId", "id") ?? model.caseId;
  const listingId = firstString(listing, "listing_id", "listingId", "id");
  const itemNumber = firstString(lease, "item_number", "itemNumber");
  const batchCode = firstString(lease, "batch_code", "batchCode");
  const leaseStatus = firstString(lease, "status");
  const listingStatus = firstString(listing, "status", "publication_status", "publicationStatus");
  const latestEvent = model.events.at(-1);
  const evidenceSource = objectValue(model.evidence?.payload, "source") ?? {};
  const evidenceAuthority = firstString(evidenceSource, "authority");
  const evidenceTransport = firstString(evidenceSource, "transport");
  const evidenceContract = checkEvidenceContract(model.evidence);
  const evidenceCausalLabel = !model.evidence
    ? "Awaiting official fact"
    : !evidenceContract.valid
      ? "Evidence rejected"
      : model.stages[0]?.status === "stale"
        ? "Evidence must be refreshed"
        : "Official fact changed";
  const evidenceState = !model.evidence
    ? "Waiting for a canonical evidence receipt."
    : !evidenceContract.valid
      ? "The received event failed the canonical evidence contract and cannot unlock containment."
      : model.stages[0]?.status === "complete"
        ? `${evidenceAuthority} evidence was retrieved through ${evidenceTransport}.`
        : "The validated evidence receipt cannot unlock containment in its current state.";
  return `<section class="prior-state" id="overview" aria-labelledby="prior-state-title">
    <div class="case-hero">
      <div class="case-hero__heading">
        <div>
          <p class="eyebrow"><a href="/">Case records</a> / Recall containment</p>
          <h1 id="prior-state-title">Containment case ${display(model.caseId)}</h1>
          <p class="lede">A previously active listing is re-evaluated only after official facts change. Containment remains bound to exact evidence, exact matching, native human approval, one atomic patch, and a fresh persisted-state read.</p>
        </div>
        <div class="case-hero__phase"><span>Current position</span><strong>${escapeHtml(currentStageSummary(model))}</strong></div>
      </div>
      <ol class="causal-strip" aria-label="Case causal summary">
        <li><span class="causal-strip__number">01</span><div><strong>Valid when recorded</strong><p>Listing ${display(listingId)} was ${display(listingStatus)} for item ${display(itemNumber)} and batch ${display(batchCode)}.</p></div></li>
        <li><span class="causal-strip__number">02</span><div><strong>${escapeHtml(evidenceCausalLabel)}</strong><p>${escapeHtml(evidenceState)}</p></div></li>
        <li><span class="causal-strip__number">03</span><div><strong>Controlled response</strong><p>Only the exact item and batch may advance through native approval.</p></div></li>
      </ol>
    </div>
    <dl class="state-facts">
      <div><dt>Case</dt><dd class="mono">${display(model.caseId)}</dd></div>
      <div><dt>Run</dt><dd class="mono breakable">${display(model.runId)}</dd></div>
      <div><dt>Feed status</dt><dd>${display(model.feedStatus)}</dd></div>
      <div><dt>Provenance</dt><dd>${provenanceBadge(runtime.feedProvenance)}</dd></div>
      <div><dt>Connection</dt><dd>${TERMINAL_LABELS[runtime.terminalState]}</dd></div>
      <div><dt>Last event</dt><dd>${latestEvent ? `Sequence ${latestEvent.sequence} at ${formatTimestamp(latestEvent.timestamp)}` : "Not recorded"}</dd></div>
    </dl>
  </section>`;
}

function failureBlock(event: RunEvent | undefined, fallback: string): string {
  const message = firstString(event?.payload, "message", "error", "reason") ?? fallback;
  const code = firstString(event?.payload, "code", "error_code", "errorCode");
  return `<div class="notice notice--danger" role="alert"><strong>${display(code, "Stage failed")}</strong><p>${display(message)}</p><p>No downstream action is represented as complete.</p></div>${eventMeta(event)}`;
}

function renderEvidence(model: CaseViewModel): string {
  const stage = model.stages[0]!;
  if (stage.status === "failed") {
    return `<section class="stage" id="evidence" aria-labelledby="evidence-title">${sectionHeader(1, "Official evidence", stage.status, "Required evidence contract")}${stageNote(model, "evidence", "Evidence contract blocked")}${failureBlock(model.evidenceFailure ?? model.evidence, "The received evidence event did not satisfy the canonical source, transport, timestamp, and hash contract.")}</section>`;
  }
  if (!model.evidence) {
    return `<section class="stage" id="evidence" aria-labelledby="evidence-title">${sectionHeader(1, "Official evidence", stage.status, "Required official evidence")}<div class="pending-line"><span class="spinner" aria-hidden="true"></span><p>Waiting for a live official CPSC evidence receipt.</p></div></section>`;
  }

  const payload = model.evidence.payload;
  const source = objectValue(payload, "source") ?? payload;
  const receipt = objectValue(payload, "receipt") ?? payload;
  const url = safeHttpUrl(firstString(source, "url"));
  const transport = firstString(source, "transport");
  const authority = firstString(source, "authority");
  const retrievedAt = firstString(receipt, "retrieved_at");
  const hash = firstString(receipt, "content_hash");
  const title = firstString(payload, "title", "recall_title", "recallTitle");
  const summary = firstString(payload, "summary", "official_summary", "officialSummary");
  return `<section class="stage" id="evidence" aria-labelledby="evidence-title">
    ${sectionHeader(1, "Official evidence", stage.status, `${authority} / ${transport}`)}
    <div class="evidence-grid">
      <div>
        <p class="evidence-kicker">Official source, retrieved through ${display(transport)}</p>
        <h3>${display(title, "Evidence receipt accepted")}</h3>
        <p>${display(summary, "The source receipt is available; no prose summary was supplied.")}</p>
        <p class="hostile-label">External page content is treated as untrusted data, never as instructions.</p>
        ${stage.status === "stale" ? `<div class="notice notice--warning" role="alert"><strong>Evidence receipt is stale</strong><p>Containment cannot advance from this receipt. Retrieve fresh official evidence and begin a new bound analysis.</p></div>` : ""}
      </div>
      <dl class="receipt">
        <div><dt>Authority</dt><dd>${display(authority)}</dd></div>
        <div><dt>Source</dt><dd>${url ? `<a data-ui-key="evidence-source" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open official page<span class="sr-only"> in a new tab</span></a>` : "Not supplied"}</dd></div>
        <div><dt>Retrieved</dt><dd>${formatTimestamp(retrievedAt)}</dd></div>
        <div><dt>Content hash</dt><dd class="mono breakable">${display(hash)}</dd></div>
      </dl>
    </div>
    ${eventMeta(model.evidence)}
  </section>`;
}

function differingFields(match: JsonObject): string {
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

function matchRow(value: JsonValue, kind: "exact" | "excluded"): string {
  const match = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
  const id = firstString(match, "listing_id", "listingId", "lease_id", "leaseId", "id");
  const item = firstString(match, "item_number", "itemNumber");
  const batch = firstString(match, "batch_code", "batchCode");
  return `<article class="match match--${kind}">
    <div class="match__heading"><span class="match__marker" aria-hidden="true">${kind === "exact" ? "OK" : "X"}</span><div><p class="eyebrow">${kind === "exact" ? "Exact item + batch" : "Excluded near match"}</p><h4>${display(id)}</h4></div></div>
    <dl class="match__keys"><div><dt>Item</dt><dd class="mono">${display(item)}</dd></div><div><dt>Batch</dt><dd class="mono">${display(batch)}</dd></div></dl>
    ${kind === "excluded" ? `<ul class="differences">${differingFields(match)}</ul>` : ""}
  </article>`;
}

function renderProof(model: CaseViewModel): string {
  const stage = model.stages[1]!;
  if (stage.status === "failed") {
    return `<section class="stage" id="proof" aria-labelledby="proof-title">${sectionHeader(2, "Deterministic proof", stage.status, "Exact item + batch / sandbox output")}${failureBlock(model.analysisFailure, "The deterministic sandbox analysis did not complete.")}</section>`;
  }
  if (!model.analysis) {
    return `<section class="stage" id="proof" aria-labelledby="proof-title">${sectionHeader(2, "Deterministic proof", stage.status, "Exact item + batch / sandbox output")}<p class="empty-state">${stage.status === "waiting" ? "Official evidence must complete before analysis." : "Evidence is bound. Waiting for deterministic sandbox analysis."}</p></section>`;
  }
  if (stage.status !== "complete") {
    return `<section class="stage" id="proof" aria-labelledby="proof-title">${sectionHeader(2, "Deterministic proof", stage.status, "Exact item + batch / sandbox output")}${stageNote(model, "proof", "Proof not accepted")}${eventMeta(model.analysis)}</section>`;
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
    <div class="proof-verdict" role="group" aria-label="Deterministic match result">
      <div><span class="proof-verdict__value">${exact ? "1" : "0"}</span><span><strong>Exact match</strong><small>Item and batch both match</small></span></div>
      <div><span class="proof-verdict__value">${exclusions.length}</span><span><strong>Near matches excluded</strong><small>Different fields stay visible below</small></span></div>
      <p>No probability and no model judgment authorizes this result.</p>
    </div>
    <div class="match-grid">
      ${exact ? matchRow(exact, "exact") : `<p class="notice notice--danger">The completed analysis did not supply its exact match.</p>`}
      ${exclusions.map((entry) => matchRow(entry, "excluded")).join("") || `<p class="notice notice--warning">No excluded near matches were supplied.</p>`}
    </div>
    <div class="sandbox" role="group" aria-label="Sandbox result">
      <div class="sandbox__bar"><span>Sandbox output</span><span>${display(provider)}${runId ? ` / ${display(runId)}` : ""}</span></div>
      <pre><code>${display(output, "No sandbox output supplied.")}</code></pre>
    </div>
    ${eventMeta(model.analysis)}
  </section>`;
}

function renderArguments(payload: JsonObject): string {
  const args = objectValue(payload, "arguments") ?? objectValue(payload, "args") ?? {};
  return `<dl class="argument-list">${Object.entries(args)
    .map(([key, value]) => `<div><dt class="mono">${escapeHtml(key)}</dt><dd><code>${escapeHtml(JSON.stringify(value))}</code></dd></div>`)
    .join("") || `<div><dt>Arguments</dt><dd>Not supplied</dd></div>`}</dl>`;
}

function renderApproval(model: CaseViewModel): string {
  const stage = model.stages[2]!;
  const request = model.approvalRequest;
  const resolution = model.approvalResolution;
  const requestPayload = request?.payload ?? {};
  const action = firstString(requestPayload, "action", "tool_name", "toolName");
  const approvalId = firstString(requestPayload, "approvalId", "approval_id");
  const decision = firstString(resolution?.payload, "decision", "status");
  const actor = firstString(resolution?.payload, "actor", "resolved_by", "resolvedBy");

  let stateCopy = `<p class="empty-state">Deterministic proof must complete before TrueForge can request approval.</p>`;
  if (stage.status === "waiting" && (request || resolution) && model.stageNotes.approval) {
    stateCopy = stageNote(model, "approval", "Approval not accepted");
  } else if (request && !resolution) {
    stateCopy = `<div class="approval-airlock">
      <span class="approval-airlock__lock" aria-hidden="true">HOLD</span>
      <div><p class="eyebrow">Human control point / 0 writes</p><h3>Execution is paused in TrueForge</h3><p>No retailer state changes while this case is pending. Review the immutable action and exact arguments below, then choose inside TrueForge's native approval UI.</p><div class="approval-choices" role="group" aria-label="Decisions available in TrueForge"><span>Approve exact patch in TrueForge</span><span>Deny in TrueForge</span></div></div>
      <p class="target-missing">For safety, this read-only ledger never opens approval URLs supplied by event data. Return to the native TrueForge session directly.</p>
    </div>`;
  } else if (resolution && stage.status === "denied") {
    stateCopy = `<div class="notice notice--warning" role="status"><strong>Denied in TrueForge</strong><p>Decision: ${display(decision)}${actor ? ` by ${display(actor)}` : ""}. No patch is authorized.</p></div>`;
  } else if (resolution && stage.status === "complete") {
    stateCopy = `<div class="notice notice--success" role="status"><strong>Approved in TrueForge</strong><p>Decision: ${display(decision)}${actor ? ` by ${display(actor)}` : ""}. The backend may apply only the approved arguments shown here.</p></div>`;
  } else if (stage.status === "active") {
    stateCopy = `<p class="empty-state">Proof is complete. Waiting for a native TrueForge approval request.</p>`;
  }

  return `<section class="stage stage--approval" id="approval" aria-labelledby="approval-title">
    ${sectionHeader(3, "Human approval", stage.status, "TrueForge native / display-only")}
    ${stateCopy}
    ${request ? `<div class="action-contract"><div><p class="eyebrow">Approval ID</p><p class="mono breakable">${display(approvalId)}</p></div><div><p class="eyebrow">Tool action</p><p><code>${display(action)}</code></p></div></div>${renderArguments(requestPayload)}${eventMeta(resolution ?? request)}` : resolution ? eventMeta(resolution) : ""}
  </section>`;
}

function renderPatch(model: CaseViewModel): string {
  const stage = model.stages[3]!;
  if (stage.status === "failed") {
    const code = firstString(model.patchFailure?.payload, "code", "error_code", "errorCode");
    const conflict = code?.toLowerCase() === "version_conflict";
    return `<section class="stage" id="patch" aria-labelledby="patch-title">${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}${failureBlock(model.patchFailure, conflict ? "Persisted state changed after approval; the approved patch was not applied." : "The approved patch failed.")}${conflict ? `<div class="notice notice--warning"><strong>Approval is stale</strong><p>Do not auto-retry or change mutation arguments. A new evidence, analysis, and approval run is required.</p></div>` : `<p class="no-retry">No automatic retry with new arguments is permitted after approval.</p>`}</section>`;
  }
  if (!model.patch) {
    return `<section class="stage" id="patch" aria-labelledby="patch-title">${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}<p class="empty-state">${stage.status === "active" ? "Approval is recorded. Waiting for one atomic backend patch receipt." : "No mutation is authorized yet."}</p></section>`;
  }
  if (stage.status !== "complete") {
    return `<section class="stage" id="patch" aria-labelledby="patch-title">${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}${stageNote(model, "patch", "Patch not accepted")}${eventMeta(model.patch)}</section>`;
  }

  const payload = model.patch.payload;
  const patchId = firstString(payload, "patch_id", "patchId");
  const receiptHash = firstString(payload, "receipt_hash", "receiptHash", "hash");
  const lease = objectValue(payload, "lease") ?? {};
  const listing = objectValue(payload, "listing") ?? {};
  const replay = booleanValue(payload, "idempotent_replay") ?? booleanValue(payload, "idempotentReplay");
  const prior = readSnapshot(model);
  const priorLeaseStatus = firstString(prior.lease, "status");
  const priorListingStatus = firstString(prior.listing, "status", "publication_status", "publicationStatus");
  const nextLeaseStatus = firstString(lease, "status");
  const nextListingStatus = firstString(listing, "status", "publication_status", "publicationStatus");
  return `<section class="stage" id="patch" aria-labelledby="patch-title">
    ${sectionHeader(4, "Atomic patch", stage.status, "One version-checked mutation")}
    ${replay ? `<div class="notice notice--info"><strong>Idempotent replay</strong><p>The same patch ID returned its existing receipt. No second mutation was applied.</p></div>` : ""}
    <div class="receipt-card">
      <div class="receipt-card__title"><p class="eyebrow">Atomic patch receipt</p><h3>${display(patchId)}</h3></div>
      <div class="patch-diff" role="group" aria-label="Approved before and after state">
        <div class="patch-diff__header"><span>Object</span><span>Before</span><span>After</span></div>
        <div><strong>${display(firstString(lease, "lease_id", "leaseId", "id"))}</strong><code>${display(priorLeaseStatus)}</code><code>${display(nextLeaseStatus)}</code></div>
        <div><strong>${display(firstString(listing, "listing_id", "listingId", "id"))}</strong><code>${display(priorListingStatus)}</code><code>${display(nextListingStatus)}</code></div>
      </div>
      <dl>
        <div><dt>Version</dt><dd>${display(payload.prior_version ?? payload.priorVersion)} -&gt; ${display(payload.new_version ?? payload.newVersion)}</dd></div>
        <div><dt>Receipt hash</dt><dd class="mono breakable">${display(receiptHash)}</dd></div>
      </dl>
    </div>
    ${eventMeta(model.patch)}
  </section>`;
}

function verificationCheck(label: string, object: JsonObject, idKeys: readonly string[]): string {
  const id = firstString(object, ...idKeys);
  const status = firstString(object, "status", "publication_status", "publicationStatus");
  return `<li><span class="checkmark" aria-hidden="true">OK</span><div><strong>${escapeHtml(label)} ${display(id)}</strong><p>Fresh read returned ${display(status)}.</p></div></li>`;
}

function renderVerification(model: CaseViewModel): string {
  const stage = model.stages[4]!;
  if (stage.status === "failed") {
    const event = model.verificationFailure ?? model.verification;
    return `<section class="stage" id="verified" aria-labelledby="verified-title">${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}${failureBlock(event, "The post-action persisted-state re-read did not prove the intended result.")}<div class="notice notice--warning"><strong>Containment is not verified</strong><p>A patch receipt alone is not enough to claim the stored outcome.</p></div></section>`;
  }
  if (!model.verification) {
    return `<section class="stage" id="verified" aria-labelledby="verified-title">${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}<p class="empty-state">${stage.status === "active" ? "Patch receipt recorded. Re-reading persisted retailer state now." : "Verification begins only after an applied patch receipt."}</p></section>`;
  }
  if (stage.status !== "complete") {
    return `<section class="stage" id="verified" aria-labelledby="verified-title">${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}${stageNote(model, "verified", "Verification not accepted")}${eventMeta(model.verification)}</section>`;
  }

  const payload = model.verification.payload;
  const lease = objectValue(payload, "lease") ?? {};
  const listing = objectValue(payload, "listing") ?? {};
  const exclusions = arrayValue(payload, "excluded_listings").length > 0
    ? arrayValue(payload, "excluded_listings")
    : arrayValue(payload, "excludedListings");
  const readAt = firstString(payload, "read_at", "readAt") ?? model.verification.timestamp;
  return `<section class="stage stage--verified" id="verified" aria-labelledby="verified-title">
    ${sectionHeader(5, "Fresh persisted-state re-read", stage.status, "Verification after mutation")}
    <div class="verified-banner"><span class="verified-banner__mark" aria-hidden="true">OK</span><div><p class="eyebrow">Persisted result confirmed</p><h3>The affected listing is contained; ${exclusions.length} excluded listing${exclusions.length === 1 ? " remains" : "s remain"} untouched.</h3><p>This is a fresh read of stored retailer state after the patch, not an independent third-party verification.</p></div></div>
    <ul class="verification-list">
      ${verificationCheck("Lease", lease, ["lease_id", "leaseId", "id"])}
      ${verificationCheck("Listing", listing, ["listing_id", "listingId", "id"])}
      ${exclusions.map((entry) => {
        const object =
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? (entry as JsonObject)
            : {};
        return verificationCheck("Excluded listing", object, ["listing_id", "listingId", "id"]);
      }).join("")}
    </ul>
    <p class="verification-time">Fresh read at ${formatTimestamp(readAt)}</p>
    ${eventMeta(model.verification)}
  </section>`;
}

function renderStageRail(model: CaseViewModel): string {
  return `<nav class="stage-rail" aria-label="Case progress"><ol>${model.stages
    .map(
      (stage, index) =>
        `<li class="stage-rail__item stage-rail__item--${stage.status}"><a data-ui-key="stage-${stage.key}" href="#${stage.key}"${stage.status === "active" ? ` aria-current="step"` : ""}><span class="stage-rail__number">${String(index + 1).padStart(2, "0")}</span><span><strong>${stage.label}</strong><small>${STATUS_LABELS[stage.status]}</small></span></a></li>`,
    )
    .join("")}</ol></nav>`;
}

function renderContractWarnings(model: CaseViewModel): string {
  if (model.contractWarnings.length === 0) return "";
  return `<aside class="contract-warning" role="alert"><strong>Event contract inconsistency</strong><ul>${model.contractWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul><p>The UI shows received records and activity, but it will not infer missing authority or downstream completion.</p></aside>`;
}

function eventHeading(event: RunEvent): string {
  switch (event.type) {
    case "state.snapshot":
      return "Initial retailer snapshot";
    case "evidence.fetched":
      return checkEvidenceContract(event).valid ? "Official evidence recorded" : "Evidence event rejected";
    case "evidence.failed":
      return "Official evidence failed";
    case "analysis.completed":
      return "Deterministic proof completed";
    case "analysis.failed":
      return "Deterministic proof failed";
    case "approval.required":
      return "Native approval requested";
    case "approval.resolved":
      return "Approval resolved";
    case "patch.applied":
      return "Atomic patch applied";
    case "patch.failed":
      return "Atomic patch failed";
    case "verification.completed":
      return booleanValue(event.payload, "passed") === true
        ? "Verification passed"
        : "Verification did not pass";
    case "verification.failed":
      return "Verification failed";
    default:
      return event.type;
  }
}

function eventSummary(event: RunEvent): string {
  switch (event.type) {
    case "state.snapshot": {
      const lease = objectValue(event.payload, "lease") ?? {};
      const listing = objectValue(event.payload, "listing") ?? {};
      return `Lease ${display(firstString(lease, "lease_id", "leaseId", "id"))} is ${display(firstString(lease, "status"))}; listing ${display(firstString(listing, "listing_id", "listingId", "id"))} is ${display(firstString(listing, "status", "publication_status", "publicationStatus"))}.`;
    }
    case "evidence.fetched":
      return checkEvidenceContract(event).valid
        ? `${display(firstString(objectValue(event.payload, "source"), "authority"))} evidence was recorded with a persisted receipt.`
        : "The received event failed the canonical evidence contract and cannot unlock downstream stages.";
    case "evidence.failed":
    case "analysis.failed":
    case "patch.failed":
    case "verification.failed":
      return display(firstString(event.payload, "message", "error", "reason"), "The event did not include additional detail.");
    case "analysis.completed": {
      const exclusions = arrayValue(event.payload, "excluded_matches").length > 0
        ? arrayValue(event.payload, "excluded_matches")
        : arrayValue(event.payload, "excludedMatches");
      return `One exact match was identified with ${exclusions.length} excluded near match${exclusions.length === 1 ? "" : "es"}.`;
    }
    case "approval.required":
      return `Action ${display(firstString(event.payload, "action", "tool_name", "toolName"))} is paused for native TrueForge approval.`;
    case "approval.resolved":
      return `Decision ${display(firstString(event.payload, "decision", "status"))}${firstString(event.payload, "actor", "resolved_by", "resolvedBy") ? ` by ${display(firstString(event.payload, "actor", "resolved_by", "resolvedBy"))}` : ""}.`;
    case "patch.applied":
      return `Patch ${display(firstString(event.payload, "patch_id", "patchId"))} changed only the approved retailer state.`;
    case "verification.completed":
      return booleanValue(event.payload, "passed") === true
        ? "A fresh persisted-state read confirmed the intended contained result."
        : display(firstString(event.payload, "message", "error", "reason"), "The persisted-state read did not confirm containment.");
    default:
      return "";
  }
}

function eventTone(event: RunEvent): string {
  if (event.type.endsWith("failed") || (event.type === "evidence.fetched" && !checkEvidenceContract(event).valid)) return "danger";
  if (event.type === "approval.required") return "warning";
  if (event.type === "approval.resolved") {
    const decision = firstString(event.payload, "decision", "status")?.toLowerCase();
    return decision === "denied" || decision === "reject" || decision === "rejected" ? "warning" : "success";
  }
  if (event.type === "verification.completed" && booleanValue(event.payload, "passed") === true) {
    return "success";
  }
  return "neutral";
}

function redactActivityPayload(event: RunEvent): JsonValue {
  if (event.type !== "approval.required") return event.payload;
  const targetKey = objectValue(event.payload, "trueforgeTarget")
    ? "trueforgeTarget"
    : objectValue(event.payload, "trueforge_target")
      ? "trueforge_target"
      : undefined;
  if (!targetKey) return event.payload;

  const target = objectValue(event.payload, targetKey) ?? {};
  const originalHref = firstString(target, "href", "url");
  if (!originalHref) return event.payload;

  const replacement = "[event-supplied approval target suppressed]";

  const sanitizedTarget: JsonObject = { ...target };
  if ("href" in sanitizedTarget || !("url" in sanitizedTarget)) {
    sanitizedTarget.href = replacement;
  }
  if ("url" in sanitizedTarget) {
    sanitizedTarget.url = replacement;
  }

  return {
    ...event.payload,
    [targetKey]: sanitizedTarget,
  };
}

function renderRunActivity(model: CaseViewModel, runtime: NormalizedRuntimeState): string {
  return `<section class="activity" id="run-activity" aria-labelledby="run-activity-title">
    <div class="activity__header"><p class="eyebrow">Object timeline</p><h2 id="run-activity-title">Run activity</h2><p class="activity__lede">Every event remains visible with progressive detail. The browser formats this timeline but does not invent missing authority.</p></div>
    <ol class="activity-list">${model.events
      .map(
        (event, index) => `<li class="activity-event activity-event--${eventTone(event)}">
        <details data-event-id="${escapeHtml(event.id)}"${index === model.events.length - 1 ? " open" : ""}>
          <summary data-ui-key="activity-${escapeHtml(event.id)}">
            <span class="activity-event__seq mono">${String(event.sequence).padStart(2, "0")}</span>
            <span class="activity-event__body"><strong>${escapeHtml(eventHeading(event))}</strong><span>${eventSummary(event)}</span></span>
            <span class="activity-event__time">${formatTimestamp(event.timestamp)}</span>
          </summary>
          <div class="activity-event__detail">
            <p class="event-meta"><span>${escapeHtml(event.type)}</span><span class="mono breakable">${escapeHtml(event.id)}</span><span class="mono breakable">${escapeHtml(event.runId)}</span></p>
            <pre><code>${escapeHtml(JSON.stringify(redactActivityPayload(event), null, 2))}</code></pre>
          </div>
        </details>
      </li>`,
      )
      .join("")}</ol>
  </section>`;
}

function queueLink(caseId: string): string {
  return `/?case=${encodeURIComponent(caseId)}`;
}

function queueItemCopy(entry: QueueCaseSummary): string {
  const caseType = entry.caseType?.trim();
  const subject = entry.subject?.trim();
  if (caseType && subject) return `${caseType} / ${subject}`;
  return caseType || subject || "No subject supplied";
}

function renderCaseTable(runtime: NormalizedRuntimeState): string {
  const caseTypes = [...new Set(runtime.queueCases.map((entry) => entry.caseType?.trim()).filter((value): value is string => Boolean(value)))].sort();
  const count = runtime.queueCases.length;
  const countLabel =
    runtime.queueState === "loading"
      ? "Loading case index"
      : runtime.queueState === "unavailable"
        ? "Case index unavailable"
        : count === 1
          ? "1 loaded case"
          : `${count} loaded cases${runtime.queueHasMore ? "; more available" : ""}`;
  const rows = runtime.queueCases
    .map((entry) => {
      const searchValue = [entry.caseId, entry.caseType, entry.subject].filter(Boolean).join(" ");
      return `<tr data-case-row data-case-search-value="${escapeHtml(searchValue)}" data-case-type="${escapeHtml(entry.caseType ?? "")}">
        <td><a class="case-table__link mono" href="${queueLink(entry.caseId)}">${escapeHtml(entry.caseId)}</a></td>
        <td>${display(entry.subject, "No subject supplied")}</td>
        <td>${display(entry.caseType, "Not classified")}</td>
        <td>${entry.createdAt ? formatTimestamp(entry.createdAt) : "Not supplied"}</td>
        <td class="case-table__action"><a href="${queueLink(entry.caseId)}">Open record</a></td>
      </tr>`;
    })
    .join("");
  const emptyRow =
    runtime.queueState === "loading"
      ? `<tr><td colspan="5"><div class="table-empty"><span class="spinner" aria-hidden="true"></span><strong>Loading recorded cases</strong><span>Reading the same-origin case index.</span></div></td></tr>`
      : runtime.queueState === "unavailable"
        ? `<tr><td colspan="5"><div class="table-empty table-empty--error"><strong>Case index unavailable</strong><span>The browser will retry without inventing records.</span></div></td></tr>`
        : count === 0
          ? `<tr><td colspan="5"><div class="table-empty"><strong>No case records yet</strong><span>An authenticated connector must record the first durable case and run.</span></div></td></tr>`
          : "";
  const continuation = runtime.queueContinuationError
    ? `<div class="notice notice--warning" role="alert"><strong>More cases were not loaded</strong><p>${escapeHtml(runtime.queueContinuationError)} Existing records remain visible; refresh the index or try again.</p></div>`
    : runtime.queueHasMore
      ? `<div class="resource-pagination"><p>More recorded cases are available.</p><button class="refresh-button" type="button" data-case-load-more data-ui-key="case-load-more"${runtime.queueLoadingMore ? " disabled" : ""}>${runtime.queueLoadingMore ? "Loading more..." : "Load more cases"}</button></div>`
      : runtime.queueState === "ready" && count > 0
        ? `<p class="resource-panel__note">All available case records in this continuation scan are loaded.</p>`
        : "";
  return `<section class="resource-panel" id="case-records" aria-labelledby="case-records-title">
    <div class="resource-toolbar">
      <div class="resource-toolbar__heading"><h2 id="case-records-title">Recorded cases</h2><span class="result-count" data-case-result-count aria-live="polite">${escapeHtml(countLabel)}</span></div>
      <div class="resource-toolbar__controls" role="search" aria-label="Filter loaded case records">
        <label class="search-control"><span class="sr-only">Search loaded cases</span><span class="search-control__icon" aria-hidden="true">S</span><input type="search" data-case-search autocomplete="off" placeholder="Search loaded cases" /></label>
        <label class="select-control"><span class="sr-only">Filter by case type</span><select data-case-type-filter><option value="">All case types</option>${caseTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}</select></label>
        <button class="refresh-button" type="button" data-case-refresh>Refresh</button>
      </div>
    </div>
    <div class="table-scroll">
      <table class="case-table">
        <thead><tr><th scope="col">Case ID</th><th scope="col">Subject</th><th scope="col">Case type</th><th scope="col">Recorded</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
        <tbody>${rows}${emptyRow}<tr data-case-no-matches hidden><td colspan="5"><div class="table-empty"><strong>No loaded cases match these filters</strong><span>Clear the search or change the case type.</span></div></td></tr></tbody>
      </table>
    </div>
    ${continuation}
    <p class="resource-panel__note">The 30-second refresh reads only the newest bounded page. Search and filters apply to loaded records; use Load more cases to continue discovery without giving this browser mutation authority.</p>
  </section>`;
}

function renderPrimaryNavigation(model: CaseViewModel | undefined, runtime: NormalizedRuntimeState): string {
  const currentQueueCase = model
    ? runtime.queueCases.find((entry) => entry.caseId === model.caseId)
    : undefined;
  const currentCaseCopy = currentQueueCase ? queueItemCopy(currentQueueCase) : undefined;
  const currentCase = model
    ? `<div class="console-nav__group"><p class="console-nav__label">Current case</p>
        <a class="console-nav__link console-nav__link--active" href="${queueLink(model.caseId)}" aria-current="page"><span class="console-nav__icon" aria-hidden="true">#</span><span><strong>${escapeHtml(model.caseId)}</strong><small>${currentCaseCopy ? `${escapeHtml(currentCaseCopy)} / ` : ""}${escapeHtml(currentStageSummary(model))}</small></span></a>
        <a class="console-nav__link console-nav__link--sub" href="#evidence"><span class="console-nav__icon" aria-hidden="true">1</span><span>Official evidence</span></a>
        <a class="console-nav__link console-nav__link--sub" href="#proof"><span class="console-nav__icon" aria-hidden="true">2</span><span>Exact-match proof</span></a>
        <a class="console-nav__link console-nav__link--sub" href="#approval"><span class="console-nav__icon" aria-hidden="true">3</span><span>Native approval</span></a>
        <a class="console-nav__link console-nav__link--sub" href="#patch"><span class="console-nav__icon" aria-hidden="true">4</span><span>Atomic patch</span></a>
        <a class="console-nav__link console-nav__link--sub" href="#verified"><span class="console-nav__icon" aria-hidden="true">5</span><span>Fresh re-read</span></a>
        <a class="console-nav__link console-nav__link--sub" href="#run-activity"><span class="console-nav__icon" aria-hidden="true">-</span><span>Run activity</span></a>
      </div>`
    : "";
  return `<nav class="console-nav" aria-label="Primary navigation">
    <div class="console-nav__group"><p class="console-nav__label">Operations</p>
      <a class="console-nav__link${model ? "" : " console-nav__link--active"}" href="/"${model ? "" : ` aria-current="page"`}><span class="console-nav__icon" aria-hidden="true">[]</span><span>Case records</span>${runtime.queueState === "ready" ? `<span class="console-nav__count">${runtime.queueCases.length}</span>` : ""}</a>
      ${model ? "" : `<a class="console-nav__link" href="#workflow"><span class="console-nav__icon" aria-hidden="true">o</span><span>Control flow</span></a>`}
    </div>
    ${currentCase}
    <div class="console-nav__group"><p class="console-nav__label">System</p>
      <a class="console-nav__link" href="#connection-state"><span class="console-nav__icon" aria-hidden="true">.</span><span>Ledger connection</span></a>
    </div>
  </nav>`;
}

function renderSystemSummary(runtime: NormalizedRuntimeState): string {
  return `<section class="console-system" id="connection-state" aria-labelledby="connection-title">
    <span class="console-system__dot console-system__dot--${runtime.terminalState}" aria-hidden="true"></span>
    <div><strong id="connection-title">${TERMINAL_LABELS[runtime.terminalState]}</strong><small>${runtime.queueState === "ready" ? "Ledger index available" : "Ledger index pending"}</small></div>
    <details><summary aria-label="Connection details">Details</summary><p>${escapeHtml(runtime.connectionMessage)}</p><dl><div><dt>Provenance</dt><dd>${PROVENANCE_LABELS[runtime.feedProvenance]}</dd></div>${runtime.lastSuccessAt ? `<div><dt>Last read</dt><dd>${formatTimestamp(runtime.lastSuccessAt)}</dd></div>` : ""}</dl><p>This browser reads records only. Approval remains native to TrueForge; retailer mutation never runs here.</p></details>
  </section>`;
}

function renderShellFrame(input: {
  caseId: string;
  runId?: string;
  model?: CaseViewModel;
  runtime: NormalizedRuntimeState;
  mainContent: string;
}): string {
  const { caseId, runId, model, runtime, mainContent } = input;
  return `<a class="skip-link" href="#case-file">Skip to workspace</a>
  <div class="shell console-shell">
    <header class="product-header console-topbar">
      <a class="wordmark" href="/" aria-label="TruthLease home"><span class="wordmark__mark" aria-hidden="true">TL</span><span>TruthLease</span></a>
      <div class="console-topbar__scope"><span class="console-topbar__product">Operations</span><span class="console-topbar__divider" aria-hidden="true">/</span><span>${model ? `Case ${escapeHtml(model.caseId)}` : "Case records"}</span></div>
      <div class="product-header__context"><span class="read-only-badge">Read only</span><span class="topbar-connection topbar-connection--${runtime.terminalState}"><span aria-hidden="true"></span>${TERMINAL_LABELS[runtime.terminalState]}</span></div>
    </header>
    <div class="workspace-shell console-body">
      <aside class="workspace-sidebar console-sidebar">
        ${renderPrimaryNavigation(model, runtime)}
        ${renderSystemSummary(runtime)}
      </aside>
      <div class="console-content">
        <main id="case-file" class="workspace-main">${mainContent}</main>
        <footer><p>${model || runId ? `Append-only run <span class="mono breakable">${display(runId ?? model?.runId ?? caseId)}</span>. ` : ""}Operational states are rendered deterministically from persisted backend events and explicit connection state.</p></footer>
      </div>
    </div>
  </div>`;
}


export function renderCaseHtml(model: CaseViewModel, runtime?: RenderRuntimeState): string {
  const normalizedRuntime = normalizeRuntime(model, runtime, "connected");
  return renderShellFrame({
    caseId: model.caseId,
    runId: model.runId,
    model,
    runtime: normalizedRuntime,
    mainContent: `${renderPriorState(model, normalizedRuntime)}${renderStageRail(model)}${renderContractWarnings(model)}<div class="case-ledger">${renderEvidence(model)}${renderProof(model)}${renderApproval(model)}${renderPatch(model)}${renderVerification(model)}</div>${renderRunActivity(model, normalizedRuntime)}`,
  });
}

export function renderEmptyWorkspaceHtml(runtime?: RenderRuntimeState): string {
  const normalizedRuntime = normalizeRuntime(undefined, runtime, "connected");
  const caseCount = normalizedRuntime.queueCases.length;
  const stages = [
    ["01", "Evidence", "Official source receipt"],
    ["02", "Proof", "Deterministic exact match"],
    ["03", "Approval", "Human decision in TrueForge"],
    ["04", "Patch", "One approved atomic change"],
    ["05", "Verified", "Fresh persisted-state re-read"],
  ] as const;
  return renderShellFrame({
    caseId: "",
    runtime: normalizedRuntime,
    mainContent: `<section class="console-page" id="overview" aria-labelledby="case-index-title">
      <header class="console-page__header">
        <div><p class="console-breadcrumb">Operations / Case records</p><h1 id="case-index-title">Case records</h1><p>Find and inspect evidence-bound containment records across the append-only ledger. The browser can read records; it cannot create, approve, or mutate them.</p></div>
        <dl class="console-page__facts">
          <div><dt>Loaded records</dt><dd>${normalizedRuntime.queueState === "ready" ? caseCount : "-"}</dd></div>
          <div><dt>Ledger</dt><dd>${TERMINAL_LABELS[normalizedRuntime.terminalState]}</dd></div>
          <div><dt>Authority</dt><dd>Read only</dd></div>
        </dl>
      </header>
      ${renderCaseTable(normalizedRuntime)}
      <div class="console-support-grid" id="workflow">
        <section class="workflow-reference" aria-labelledby="workflow-title">
          <div class="section-heading"><p class="eyebrow">Control flow</p><h2 id="workflow-title">Containment lifecycle</h2><p>Every completed stage remains visible in the case record.</p></div>
          <ol class="lifecycle-list">${stages.map(([number, label, description]) => `<li><span class="lifecycle-list__number">${number}</span><div><strong>${label}</strong><span>${description}</span></div><span class="status status--waiting">Not started</span></li>`).join("")}</ol>
        </section>
        <aside class="authority-panel" aria-labelledby="authority-title">
          <p class="eyebrow">Execution boundary</p><h2 id="authority-title">Observation is not authorization</h2>
          <dl><div><dt>Evidence</dt><dd>Recorded by the authenticated connector</dd></div><div><dt>Approval</dt><dd>Resolved only inside genuine TrueForge</dd></div><div><dt>Mutation</dt><dd>Applied by the backend after approval</dd></div><div><dt>Verification</dt><dd>Fresh persisted-state re-read, not third-party verification</dd></div></dl>
          <p class="authority-panel__note">${caseCount === 0 && normalizedRuntime.queueState === "ready" ? "The ledger is connected and currently contains 0 cases. This is an honest ready state." : "Open a recorded case to inspect its complete causal history."}</p>
        </aside>
      </div>
    </section>`,
  });
}

export function renderLoadingHtml(caseId: string | undefined, runtime?: RenderRuntimeState): string {
  const normalizedRuntime = normalizeRuntime(undefined, runtime, "loading");
  return renderShellFrame({
    caseId: caseId ?? "",
    runtime: normalizedRuntime,
    mainContent: `<section class="loading-page" aria-busy="true"><span class="spinner" aria-hidden="true"></span><p class="eyebrow">${caseId ? `Case ${escapeHtml(caseId)}` : "Operational ledger"}</p><h1>${caseId ? "Opening the append-only case file..." : "Opening the operational workspace..."}</h1><p>Waiting for persisted backend records. No approval or retailer action runs from this browser.</p></section>`,
  });
}

export function renderFeedErrorHtml(
  caseId: string,
  message: string,
  runtime?: RenderRuntimeState,
): string {
  const missingPublishedCase = /HTTP 404\b/i.test(message) && /\bdoes not exist\b/i.test(message);
  const normalizedRuntime = normalizeRuntime(
    undefined,
    {
      ...runtime,
      connectionMessage: runtime?.connectionMessage ?? message,
      feedProvenance: runtime?.feedProvenance ?? "unavailable",
    },
    runtime?.terminalState ?? "unavailable",
  );
  const title = missingPublishedCase
    ? "No published run exists for this case yet."
    : normalizedRuntime.terminalState === "offline"
      ? "The case feed is offline from this browser."
      : normalizedRuntime.terminalState === "unauthorized"
        ? "The case feed is refusing authorization."
        : "The case feed is unavailable.";
  return renderShellFrame({
    caseId,
    runtime: normalizedRuntime,
    mainContent: missingPublishedCase
      ? `<section class="feed-error" role="status"><p class="eyebrow">Case ${escapeHtml(caseId)}</p><h1>${title}</h1><p>The hosted ledger only displays authenticated events after the outbound connector appends a genuine TrueForge run.</p><p>Run the local evidence loop and publish its verified record, or choose another recorded case. The browser cannot create, approve, or mutate a case.</p><p><a href="/setup.html#approval">Open the genuine-run setup guide</a></p></section>`
      : `<section class="feed-error" role="alert"><p class="eyebrow">Case ${escapeHtml(caseId)}</p><h1>${title}</h1><p>${escapeHtml(message)}</p><p>This is a connection boundary, not evidence that the operation failed. No browser mutation was attempted.</p></section>`,
  });
}

