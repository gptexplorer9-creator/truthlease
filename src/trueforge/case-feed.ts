import { createHash } from "node:crypto";

import type {
  ApplyContainmentPatchArguments,
  RecordRecallEvidenceInput,
  RunEvent,
  RunEventType,
} from "../domain/types.js";

type UnknownRecord = Record<string, unknown>;

export interface TrueForgeEventEntry {
  turn_id: string;
  event: UnknownRecord;
}

export interface CaseEventFeed {
  caseId: string;
  runId: string;
  status: string;
  lastSequence: number;
  events: RunEvent<UnknownRecord>[];
}

export interface P0VerificationCheck {
  name: string;
  passed: boolean;
  observed: unknown;
}

export interface P0SessionVerification {
  sessionId: string;
  passed: boolean;
  checks: P0VerificationCheck[];
}

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: UnknownRecord;
  serverName?: string;
  event: UnknownRecord;
}

interface IndexedToolCall extends ToolCallRecord {
  eventIndex: number;
  turnId: string;
}

interface IndexedEvent {
  event: UnknownRecord;
  eventIndex: number;
}

interface EvidenceTrace {
  mode: "scrape" | "fallback_search";
  scrape: IndexedToolCall;
  scrapeResponse: IndexedEvent;
  search?: IndexedToolCall;
  searchResponse?: IndexedEvent;
  recordEvidence: IndexedToolCall;
  input: RecordRecallEvidenceInput;
}

interface SandboxTrace {
  created: IndexedEvent;
  exec: IndexedToolCall;
  response: IndexedEvent;
}

export interface TrueForgeAuthorizationProof {
  callId: string;
  authorizedAt: string;
}

export const P0_CPSC_RECALL_URL =
  "https://www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle-Grasping-and-Teething-Toys-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-and-Ingestion-Hazards";

export const P0_CPSC_FALLBACK_QUERY =
  'site:cpsc.gov/Recalls/2026 "26-719" "2012261001" "0925" HABA Rainbow Rattle';

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function createdAt(event: UnknownRecord): string {
  return string(event.created_at) ?? new Date(0).toISOString();
}

function parseJsonObject(value: unknown): UnknownRecord | undefined {
  if (record(value) !== undefined) return record(value);
  if (typeof value !== "string") return undefined;
  try {
    return record(JSON.parse(value));
  } catch {
    const begin = value.indexOf("_BEGIN=====");
    const end = value.lastIndexOf("=====UNTRUSTED_");
    if (begin < 0 || end <= begin) return undefined;
    const candidate = value.slice(begin + "_BEGIN=====".length, end).trim();
    try {
      return record(JSON.parse(candidate));
    } catch {
      return undefined;
    }
  }
}

function parseArguments(value: unknown): UnknownRecord {
  return parseJsonObject(value) ?? {};
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = record(value);
  if (object !== undefined) {
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizedEvidenceText(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function externalPayload(event: UnknownRecord): string {
  const content = string(event.content) ?? "";
  const begin = content.indexOf("_BEGIN=====");
  const end = content.lastIndexOf("=====UNTRUSTED_");
  return begin >= 0 && end > begin
    ? content.slice(begin + "_BEGIN=====".length, end).trim()
    : content.trim();
}

function emptyExternalPayload(event: UnknownRecord): boolean {
  return externalPayload(event).length === 0;
}

function recordEvidenceInput(arguments_: UnknownRecord): RecordRecallEvidenceInput | undefined {
  const sourceUrl = string(arguments_.source_url);
  const retrievedAt = string(arguments_.retrieved_at);
  const recallNumber = string(arguments_.recall_number);
  const title = string(arguments_.title);
  const productName = string(arguments_.product_name);
  const recallDate = string(arguments_.recall_date);
  const hazard = string(arguments_.hazard);
  const description = string(arguments_.description);
  const itemNumber = string(arguments_.item_number);
  const batchCode = string(arguments_.batch_code);
  const evidenceText = string(arguments_.evidence_text);
  if (
    sourceUrl === undefined || retrievedAt === undefined || recallNumber === undefined ||
    title === undefined || productName === undefined || recallDate === undefined ||
    hazard === undefined || description === undefined || itemNumber === undefined ||
    batchCode === undefined || evidenceText === undefined
  ) return undefined;
  return {
    sourceUrl,
    retrievedAt,
    recallNumber,
    title,
    productName,
    recallDate,
    hazard,
    description,
    itemNumber,
    batchCode,
    evidenceText,
  };
}

function evidenceInputToWire(input: RecordRecallEvidenceInput): UnknownRecord {
  return {
    source_url: input.sourceUrl,
    retrieved_at: input.retrievedAt,
    recall_number: input.recallNumber,
    title: input.title,
    product_name: input.productName,
    recall_date: input.recallDate,
    hazard: input.hazard,
    description: input.description,
    item_number: input.itemNumber,
    batch_code: input.batchCode,
    evidence_text: input.evidenceText,
  };
}

function orderedTrace(entries: TrueForgeEventEntry[]): {
  ordered: TrueForgeEventEntry[];
  calls: IndexedToolCall[];
  responses: Map<string, IndexedEvent>;
} {
  const ordered = [...entries].sort((left, right) => {
    const byTime = Date.parse(createdAt(left.event)) - Date.parse(createdAt(right.event));
    return byTime !== 0 ? byTime : String(left.event.id).localeCompare(String(right.event.id));
  });
  const calls = ordered.flatMap(({ event, turn_id: turnId }, eventIndex) =>
    toolCallsFrom(event).map((call) => ({ ...call, eventIndex, turnId })),
  );
  const responses = new Map<string, IndexedEvent>();
  ordered.forEach(({ event }, eventIndex) => {
    if (event.type !== "tool.response") return;
    const callId = string(event.tool_call_id);
    if (callId !== undefined) responses.set(callId, { event, eventIndex });
  });
  return { ordered, calls, responses };
}

function findSandboxTrace(entries: TrueForgeEventEntry[]): SandboxTrace | undefined {
  const { ordered, calls, responses } = orderedTrace(entries);
  for (let eventIndex = 0; eventIndex < ordered.length; eventIndex += 1) {
    const entry = ordered[eventIndex]!;
    if (entry.event.type !== "sandbox.created") continue;
    const candidates = calls.filter((call) =>
      call.name === "exec" &&
      (call.serverName === undefined || call.serverName === "trueforge-system") &&
      call.turnId === entry.turn_id,
    );
    for (const exec of candidates) {
      const response = responses.get(exec.id);
      if (
        response !== undefined &&
        exec.eventIndex < response.eventIndex
      ) {
        return { created: { event: entry.event, eventIndex }, exec, response };
      }
    }
  }
  return undefined;
}

function evidenceIdentifiersAreBound(input: RecordRecallEvidenceInput, payload: unknown): boolean {
  const boundText = normalizedEvidenceText(
    `${typeof payload === "string" ? payload : JSON.stringify(payload)} ${P0_CPSC_RECALL_URL.replace(/[-_/]/g, " ")}`,
  );
  return [
    input.recallNumber,
    input.title,
    input.productName,
    input.recallDate,
    input.hazard,
    input.description,
    input.itemNumber,
    input.batchCode,
  ].map(normalizedEvidenceText).every((value) => value.length > 0 && boundText.includes(value));
}

function scrapeEvidenceIsBound(input: RecordRecallEvidenceInput, scrapePayload: string): boolean {
  return scrapePayload.length > 0 &&
    input.evidenceText === scrapePayload &&
    evidenceIdentifiersAreBound(input, scrapePayload);
}

function fallbackEvidenceIsBound(input: RecordRecallEvidenceInput, searchPayload: UnknownRecord): boolean {
  const organic = array(searchPayload.organic).map(record).find((item) =>
    string(item?.link) === P0_CPSC_RECALL_URL,
  );
  if (
    organic === undefined ||
    string(organic.title) !== input.title ||
    string(organic.description) !== input.description
  ) return false;
  const submittedPayload = parseJsonObject(input.evidenceText);
  if (submittedPayload === undefined || !equalJson(submittedPayload, searchPayload)) return false;
  return evidenceIdentifiersAreBound(input, searchPayload);
}

function findEvidenceTrace(
  entries: TrueForgeEventEntry[],
  expectedInput?: RecordRecallEvidenceInput,
  excludedCallIds: ReadonlySet<string> = new Set(),
): EvidenceTrace | undefined {
  const { calls, responses } = orderedTrace(entries);
  const records = calls.filter((call) =>
    call.name === "record_recall_evidence" &&
    call.serverName === "truthlease-local" &&
    !excludedCallIds.has(call.id),
  ).reverse();
  for (const recordCall of records) {
    const input = recordEvidenceInput(recordCall.arguments);
    if (
      input === undefined ||
      input.sourceUrl !== P0_CPSC_RECALL_URL ||
      (expectedInput !== undefined && !equalJson(recordCall.arguments, evidenceInputToWire(expectedInput)))
    ) continue;
    const scrapes = calls.filter((call) =>
      call.serverName === "bright-data" &&
      call.name === "scrape_as_markdown" &&
      call.arguments.url === P0_CPSC_RECALL_URL &&
      call.eventIndex < recordCall.eventIndex,
    );
    for (const scrape of scrapes) {
      const scrapeResponse = responses.get(scrape.id);
      if (
        scrapeResponse === undefined ||
        errorMessage(scrapeResponse.event) !== undefined ||
        scrapeResponse.eventIndex <= scrape.eventIndex ||
        scrapeResponse.eventIndex >= recordCall.eventIndex
      ) continue;
      const scrapePayload = externalPayload(scrapeResponse.event);
      const retrievedAt = Date.parse(input.retrievedAt);
      const scrapeObservedAt = Date.parse(createdAt(scrapeResponse.event));
      if (
        scrapeEvidenceIsBound(input, scrapePayload) &&
        Number.isFinite(retrievedAt) && Number.isFinite(scrapeObservedAt) &&
        Math.abs(retrievedAt - scrapeObservedAt) <= 120_000
      ) {
        return {
          mode: "scrape",
          scrape,
          scrapeResponse,
          recordEvidence: recordCall,
          input,
        };
      }
      if (!emptyExternalPayload(scrapeResponse.event)) continue;
      const searches = calls.filter((call) =>
        call.serverName === "bright-data" &&
        call.name === "search_engine" &&
        call.arguments.query === P0_CPSC_FALLBACK_QUERY &&
        call.arguments.engine === "google" &&
        call.arguments.geo_location === "us" &&
        call.arguments.cursor === "" &&
        call.eventIndex > scrapeResponse.eventIndex &&
        call.eventIndex < recordCall.eventIndex,
      );
      for (const search of searches) {
        const searchResponse = responses.get(search.id);
        const searchPayload = searchResponse === undefined
          ? undefined
          : parseJsonObject(searchResponse.event.content);
        const retrievedAt = Date.parse(input.retrievedAt);
        const searchObservedAt = searchResponse === undefined
          ? Number.NaN
          : Date.parse(createdAt(searchResponse.event));
        if (
          searchResponse === undefined || searchPayload === undefined ||
          errorMessage(searchResponse.event) !== undefined ||
          searchResponse.eventIndex <= search.eventIndex ||
          searchResponse.eventIndex >= recordCall.eventIndex ||
          !Number.isFinite(retrievedAt) || !Number.isFinite(searchObservedAt) ||
          Math.abs(retrievedAt - searchObservedAt) > 120_000 ||
          !fallbackEvidenceIsBound(input, searchPayload)
        ) continue;
        return {
          mode: "fallback_search",
          scrape,
          scrapeResponse,
          search,
          searchResponse,
          recordEvidence: recordCall,
          input,
        };
      }
    }
  }
  return undefined;
}

export function verifyTrueForgeEvidenceAuthorization(
  entries: TrueForgeEventEntry[],
  input: RecordRecallEvidenceInput,
  excludedCallIds: ReadonlySet<string> = new Set(),
): TrueForgeAuthorizationProof | undefined {
  const trace = findEvidenceTrace(entries, input, excludedCallIds);
  return trace === undefined
    ? undefined
    : { callId: trace.recordEvidence.id, authorizedAt: createdAt(trace.recordEvidence.event) };
}

export function verifyTrueForgeMutationAuthorization(
  entries: TrueForgeEventEntry[],
  input: ApplyContainmentPatchArguments,
  excludedCallIds: ReadonlySet<string> = new Set(),
): TrueForgeAuthorizationProof | undefined {
  const { ordered, calls, responses } = orderedTrace(entries);
  const applyCandidates = calls.filter((call) =>
    call.name === "apply_containment_patch" &&
    call.serverName === "truthlease-local" &&
    !excludedCallIds.has(call.id) &&
    !responses.has(call.id) &&
    equalJson(call.arguments, input),
  ).reverse();
  for (const apply of applyCandidates) {
    const approvalRequiredIndex = ordered.findIndex(({ event }, eventIndex) =>
      eventIndex > apply.eventIndex &&
      event.type === "tool.approval_required" &&
      array(event.tool_calls).some((item) => string(record(item)?.id) === apply.id),
    );
    if (approvalRequiredIndex < 0) continue;
    const approvalResolutionIndex = ordered.findIndex(({ event }, eventIndex) =>
      eventIndex > approvalRequiredIndex &&
      event.type === "turn.created" &&
      array(event.input).some((item) => {
        const approval = record(item);
        return approval?.type === "user.tool_approval" &&
          approval.tool_call_id === apply.id &&
          record(approval.approval)?.status === "allow";
      }),
    );
    if (approvalResolutionIndex < 0) continue;
    return {
      callId: apply.id,
      authorizedAt: createdAt(ordered[approvalResolutionIndex]!.event),
    };
  }
  return undefined;
}

function toolCallsFrom(event: UnknownRecord): ToolCallRecord[] {
  if (event.type !== "model.message") return [];
  return array(event.tool_calls).flatMap((candidate) => {
    const call = record(candidate);
    const fn = record(call?.function);
    const info = record(call?.tool_info);
    const id = string(call?.id);
    const name = string(fn?.name);
    if (id === undefined || name === undefined) return [];
    return [{
      id,
      name,
      arguments: parseArguments(fn?.arguments),
      serverName: string(info?.server_name),
      event,
    }];
  });
}

function responsePayload(event: UnknownRecord): UnknownRecord | undefined {
  const payload = parseJsonObject(event.content);
  return record(payload?.result) ?? payload;
}

function errorMessage(event: UnknownRecord): string | undefined {
  const payload = responsePayload(event);
  const direct = string(payload?.error) ?? string(payload?.message);
  if (direct !== undefined) return direct;
  const errors = array(payload?.error);
  for (const item of errors) {
    const message = string(record(item)?.text);
    if (message !== undefined) return message;
  }
  const content = string(event.content);
  return content?.toLowerCase().includes("error") ? content : undefined;
}

export function sandboxExecutionSucceeded(event: UnknownRecord): boolean {
  const payload = parseJsonObject(event.content);
  const response = record(payload?.response);
  return payload?.success === true && response?.exitCode === 0;
}

function listingStatus(published: unknown): string {
  return published === false ? "unpublished" : "published";
}

function leaseSnapshot(state: UnknownRecord, leaseId: string): UnknownRecord {
  const lease = array(state.leases).map(record).find((candidate) => candidate?.id === leaseId);
  const subject = record(lease?.subject);
  return {
    lease_id: leaseId,
    status: string(lease?.status) ?? "unknown",
    item_number: string(subject?.itemNumber) ?? "unknown",
    batch_code: string(subject?.batchCode) ?? "unknown",
  };
}

function listingSnapshot(state: UnknownRecord, leaseId: string): UnknownRecord {
  const lease = array(state.leases).map(record).find((candidate) => candidate?.id === leaseId);
  const subject = record(lease?.subject);
  const listingId = string(subject?.listingId);
  const listing = array(state.listings).map(record).find((candidate) => candidate?.id === listingId);
  return {
    listing_id: listingId ?? "unknown",
    status: listingStatus(listing?.published),
  };
}

function statusFor(events: RunEvent<UnknownRecord>[]): string {
  const last = events.at(-1);
  if (last?.type === "verification.completed" && last.payload.passed === true) return "verified";
  if (events.some((event) => event.type.endsWith(".failed"))) return "failed";
  const resolution = events.findLast((event) => event.type === "approval.resolved");
  if (resolution?.payload.decision === "denied") return "denied";
  if (events.some((event) => event.type === "approval.required") && resolution === undefined) {
    return "pending_approval";
  }
  return events.length === 0 ? "waiting" : "running";
}

export async function fetchTrueForgeEvents(
  baseUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TrueForgeEventEntry[]> {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "http:" ||
    !(["127.0.0.1", "localhost", "[::1]"] as string[]).includes(url.hostname) ||
    url.username !== "" || url.password !== "" ||
    url.pathname !== "/" || url.search !== "" || url.hash !== ""
  ) {
    throw new Error("TrueForge event feed must use an exact credential-free HTTP loopback origin.");
  }
  const expectedOrigin = url.origin;
  const requestUrl = new URL(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/events?limit=100`,
    `${expectedOrigin}/`,
  );
  const response = await fetchImpl(
    requestUrl,
    {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`TrueForge event request rejected redirect HTTP ${response.status}.`);
  }
  if (response.url !== "" && new URL(response.url).origin !== expectedOrigin) {
    throw new Error("TrueForge event response origin did not match the configured loopback origin.");
  }
  if (!response.ok) throw new Error(`TrueForge event request failed with HTTP ${response.status}.`);
  const body = record(await response.json());
  return array(body?.data).flatMap((item) => {
    const entry = record(item);
    const event = record(entry?.event);
    const turnId = string(entry?.turn_id);
    return event !== undefined && turnId !== undefined ? [{ turn_id: turnId, event }] : [];
  });
}

export function buildCaseEventFeed(
  leaseId: string,
  sessionId: string,
  entries: TrueForgeEventEntry[],
  after?: number,
): CaseEventFeed {
  const ordered = [...entries].sort((left, right) => {
    const byTime = Date.parse(createdAt(left.event)) - Date.parse(createdAt(right.event));
    return byTime !== 0 ? byTime : String(left.event.id).localeCompare(String(right.event.id));
  });
  const toolCalls = new Map<string, ToolCallRecord>();
  const responses = new Map<string, UnknownRecord>();
  for (const { event } of ordered) {
    for (const call of toolCallsFrom(event)) toolCalls.set(call.id, call);
    if (event.type === "tool.response") {
      const callId = string(event.tool_call_id);
      if (callId !== undefined) responses.set(callId, event);
    }
  }

  const generated: Array<{ type: RunEventType; source: UnknownRecord; payload: UnknownRecord }> = [];
  const sandboxTrace = findSandboxTrace(entries);
  const sandbox = sandboxTrace?.created.event;
  const sandboxExec = sandboxTrace?.exec;
  const sandboxResponse = sandboxTrace?.response.event;

  for (const call of toolCalls.values()) {
    const response = responses.get(call.id);
    if (call.name === "get_retailer_state" && response !== undefined) {
      const state = responsePayload(response);
      if (state !== undefined) {
        generated.push({
          type: "state.snapshot",
          source: response,
          payload: {
            lease: leaseSnapshot(state, leaseId),
            listing: listingSnapshot(state, leaseId),
          },
        });
      }
    }
    if (call.name === "record_recall_evidence" && response !== undefined) {
      const result = responsePayload(response);
      const receipt = record(result?.receipt);
      if (receipt !== undefined) {
        generated.push({
          type: "evidence.fetched",
          source: response,
          payload: {
            title: string(receipt.title) ?? "Official CPSC recall",
            summary: string(receipt.description) ?? "Official recall evidence was recorded.",
            source: {
              authority: "U.S. Consumer Product Safety Commission",
              transport: "Bright Data Web MCP",
              url: string(receipt.sourceUrl) ?? string(call.arguments.source_url) ?? "unknown",
            },
            receipt: {
              evidence_receipt_id: string(receipt.id) ?? "unknown",
              retrieved_at: string(receipt.retrievedAt) ?? "unknown",
              content_hash: string(receipt.contentSha256) ?? "unknown",
            },
          },
        });
      } else {
        generated.push({
          type: "evidence.failed",
          source: response,
          payload: { code: "evidence_record_failed", message: errorMessage(response) ?? "Evidence was not recorded." },
        });
      }
    }
  }

  const applyCalls = [...toolCalls.values()].filter((call) => call.name === "apply_containment_patch");
  for (const apply of applyCalls) {
    const stateCall = [...toolCalls.values()].find((call) => call.name === "get_retailer_state");
    const state = stateCall === undefined ? undefined : responsePayload(responses.get(stateCall.id) ?? {});
    const itemNumber = string(leaseSnapshot(state ?? {}, leaseId).item_number) ?? "unknown";
    const batchCode = string(leaseSnapshot(state ?? {}, leaseId).batch_code) ?? "unknown";
    const listings = array(state?.listings).map(record).filter((item): item is UnknownRecord => item !== undefined);
    const exact = listings.find((listing) => listing.id === apply.arguments.listing_id);
    const exclusions = listings
      .filter((listing) => listing.id !== apply.arguments.listing_id)
      .map((listing) => {
        const differing: UnknownRecord = {};
        if (listing.itemNumber !== itemNumber) differing.item_number = listing.itemNumber as never;
        if (listing.batchCode !== batchCode) differing.batch_code = listing.batchCode as never;
        return {
          listing_id: string(listing.id) ?? "unknown",
          item_number: string(listing.itemNumber) ?? "unknown",
          batch_code: string(listing.batchCode) ?? "unknown",
          differing_fields: differing,
        };
      });
    if (
      sandbox !== undefined &&
      sandboxResponse !== undefined &&
      sandboxExecutionSucceeded(sandboxResponse)
    ) {
      generated.push({
        type: "analysis.completed",
        source: apply.event,
        payload: {
          rule: { item_number: itemNumber, batch_code: batchCode },
          exact_match: {
            listing_id: string(exact?.id) ?? string(apply.arguments.listing_id) ?? "unknown",
            item_number: string(exact?.itemNumber) ?? itemNumber,
            batch_code: string(exact?.batchCode) ?? batchCode,
          },
          excluded_matches: exclusions,
          sandbox: {
            provider: "TrueForge local Bubblewrap sandbox",
            run_id: string(sandbox.sandbox_id) ?? string(sandbox.id) ?? "unknown",
            output: string(sandboxResponse.content) ?? "Sandbox completed.",
          },
        },
      });
    }
  }
  if (
    sandboxExec !== undefined &&
    sandboxResponse !== undefined &&
    !sandboxExecutionSucceeded(sandboxResponse)
  ) {
    generated.push({
      type: "analysis.failed",
      source: sandboxResponse,
      payload: {
        code: "sandbox_execution_failed",
        message: errorMessage(sandboxResponse) ?? "Sandbox returned a non-zero or unsuccessful result.",
      },
    });
  }

  const approvals = new Map<string, { event: UnknownRecord; callId: string }>();
  for (const { event } of ordered) {
    if (event.type !== "tool.approval_required") continue;
    for (const item of array(event.tool_calls)) {
      const callId = string(record(item)?.id);
      const call = callId === undefined ? undefined : toolCalls.get(callId);
      if (callId === undefined || call === undefined || call.name !== "apply_containment_patch") continue;
      const approvalId = string(event.id) ?? callId;
      approvals.set(callId, { event, callId });
      generated.push({
        type: "approval.required",
        source: event,
        payload: {
          approvalId,
          action: "apply_containment_patch",
          resolutionMode: "trueforge_native",
          status: "pending",
          arguments: call.arguments,
        },
      });
    }
  }

  for (const { event } of ordered) {
    if (event.type !== "turn.created") continue;
    for (const input of array(event.input)) {
      const approval = record(input);
      if (approval?.type !== "user.tool_approval") continue;
      const callId = string(approval.tool_call_id);
      const prior = callId === undefined ? undefined : approvals.get(callId);
      if (prior === undefined) continue;
      const decision = string(record(approval.approval)?.status) === "allow" ? "approved" : "denied";
      generated.push({
        type: "approval.resolved",
        source: event,
        payload: { approvalId: string(prior.event.id) ?? callId, decision },
      });
    }
  }

  for (const apply of applyCalls) {
    const response = responses.get(apply.id);
    if (response === undefined) continue;
    const result = responsePayload(response);
    const receipt = record(result?.receipt);
    const listing = record(result?.listing);
    const lease = record(result?.lease);
    if (receipt !== undefined && listing !== undefined && lease !== undefined) {
      generated.push({
        type: "patch.applied",
        source: response,
        payload: {
          patch_id: string(receipt.patchId) ?? string(apply.arguments.patch_id) ?? "unknown",
          prior_version: number(receipt.expectedVersion) ?? number(apply.arguments.expected_version) ?? -1,
          new_version: number(receipt.appliedVersion) ?? number(result?.observedStateVersion) ?? -1,
          receipt_hash: createHash("sha256").update(string(response.content) ?? "").digest("hex"),
          idempotent_replay: result?.idempotentReplay === true,
          lease: { lease_id: string(lease.id) ?? "unknown", status: string(lease.status) ?? "unknown" },
          listing: {
            listing_id: string(listing.id) ?? "unknown",
            status: listingStatus(listing.published),
          },
        },
      });
    } else {
      const message = errorMessage(response) ?? "Containment patch failed.";
      generated.push({
        type: "patch.failed",
        source: response,
        payload: {
          code: message.toLowerCase().includes("version conflict") ? "version_conflict" : "patch_failed",
          message,
        },
      });
    }
  }

  for (const call of toolCalls.values()) {
    if (call.name !== "verify_containment_state") continue;
    const response = responses.get(call.id);
    if (response === undefined) continue;
    const verification = responsePayload(response);
    if (verification === undefined) {
      generated.push({
        type: "verification.failed",
        source: response,
        payload: { code: "verification_failed", message: errorMessage(response) ?? "Verification failed." },
      });
      continue;
    }
    const checks = array(verification.checks).map(record).filter((item): item is UnknownRecord => item !== undefined);
    const listing = record(checks.find((check) => string(check.name)?.includes("listing is unpublished"))?.observed);
    const lease = record(checks.find((check) => string(check.name)?.includes("Lease is revoked"))?.observed);
    const excluded = array(checks.find((check) => string(check.name)?.includes("near matches"))?.observed)
      .map(record)
      .filter((item): item is UnknownRecord => item !== undefined)
      .map((item) => ({
        listing_id: string(item.id) ?? "unknown",
        status: listingStatus(item.published),
      }));
    generated.push({
      type: "verification.completed",
      source: response,
      payload: {
        passed: verification.passed === true,
        read_at: string(verification.observedAt) ?? createdAt(response),
        lease: { lease_id: string(lease?.id) ?? leaseId, status: string(lease?.status) ?? "unknown" },
        listing: {
          listing_id: string(listing?.id) ?? "unknown",
          status: listingStatus(listing?.published),
        },
        excluded_listings: excluded,
      },
    });
  }

  generated.sort((left, right) => {
    const byTime = Date.parse(createdAt(left.source)) - Date.parse(createdAt(right.source));
    return byTime !== 0 ? byTime : String(left.source.id).localeCompare(String(right.source.id));
  });
  const allEvents = generated.map((item, index): RunEvent<UnknownRecord> => ({
    type: item.type,
    id: `${sessionId}:${string(item.source.id) ?? index}`,
    timestamp: createdAt(item.source),
    runId: sessionId,
    sequence: index + 1,
    payload: item.payload,
  }));
  const lastSequence = allEvents.at(-1)?.sequence ?? 0;
  const events = after === undefined ? allEvents : allEvents.filter((event) => event.sequence > after);
  return {
    caseId: leaseId,
    runId: sessionId,
    status: statusFor(allEvents),
    lastSequence,
    events,
  };
}

export function verifyP0SessionEvents(
  sessionId: string,
  entries: TrueForgeEventEntry[],
): P0SessionVerification {
  const { ordered, calls: indexedCalls, responses: indexedResponses } = orderedTrace(entries);
  const evidenceTrace = findEvidenceTrace(entries);
  const recordEvidence = evidenceTrace?.recordEvidence;
  const recordResponse = recordEvidence === undefined ? undefined : indexedResponses.get(recordEvidence.id);
  const sandboxTrace = findSandboxTrace(entries);
  const sandboxCreatedIndex = sandboxTrace?.created.eventIndex ?? -1;
  const sandboxExec = sandboxTrace?.exec;
  const sandboxResponse = sandboxTrace?.response;
  const successfulReadBeforeSandbox = (name: string) => indexedCalls
    .map((call) => ({ call, response: indexedResponses.get(call.id) }))
    .find(({ call, response }) =>
      call.name === name &&
      call.serverName === "truthlease-local" &&
      sandboxExec !== undefined &&
      call.eventIndex < sandboxExec.eventIndex &&
      response !== undefined &&
      response.eventIndex > call.eventIndex &&
      response.eventIndex < sandboxExec.eventIndex &&
      errorMessage(response.event) === undefined &&
      responsePayload(response.event) !== undefined,
    );
  const leaseRead = successfulReadBeforeSandbox("get_truth_lease");
  const stateRead = successfulReadBeforeSandbox("get_retailer_state");
  const applyCalls = indexedCalls.filter((call) => call.name === "apply_containment_patch");
  const apply = applyCalls[0];
  const approvalRequiredIndex = apply === undefined
    ? -1
    : ordered.findIndex(({ event }) =>
        event.type === "tool.approval_required" &&
        array(event.tool_calls).some((item) => string(record(item)?.id) === apply.id),
      );
  const approvalResolutionIndex = apply === undefined
    ? -1
    : ordered.findIndex(({ event }) =>
        event.type === "turn.created" &&
        array(event.input).some((item) => {
          const input = record(item);
          return input?.type === "user.tool_approval" &&
            input.tool_call_id === apply.id &&
            record(input.approval)?.status === "allow";
        }),
      );
  const applyResponse = apply === undefined ? undefined : indexedResponses.get(apply.id);
  const verify = indexedCalls.find((call) => call.name === "verify_containment_state");
  const verifyResponse = verify === undefined ? undefined : indexedResponses.get(verify.id);
  const verification = verifyResponse === undefined ? undefined : responsePayload(verifyResponse.event);
  const truthLeaseToolNames = new Set([
    "record_recall_evidence",
    "get_truth_lease",
    "get_retailer_state",
    "apply_containment_patch",
    "verify_containment_state",
  ]);
  const truthLeaseCalls = indexedCalls.filter((call) => truthLeaseToolNames.has(call.name));
  const requiredWireKeys = [
    "listing_id",
    "lease_id",
    "patch_id",
    "expected_version",
    "evidence_receipt_id",
    "analysis_sha256",
    "reason",
  ];
  const forbiddenWireKeys = [
    "listingId",
    "leaseId",
    "patchId",
    "expectedVersion",
    "evidenceReceiptId",
    "analysisSha256",
  ];
  const evidenceChronology = evidenceTrace?.mode === "fallback_search"
    ? [
        evidenceTrace.scrape.eventIndex,
        evidenceTrace.scrapeResponse.eventIndex,
        evidenceTrace.search?.eventIndex ?? -1,
        evidenceTrace.searchResponse?.eventIndex ?? -1,
        recordEvidence?.eventIndex ?? -1,
      ]
    : [
        evidenceTrace?.scrape.eventIndex ?? -1,
        evidenceTrace?.scrapeResponse.eventIndex ?? -1,
        recordEvidence?.eventIndex ?? -1,
      ];
  const chronology = [
    ...evidenceChronology,
    recordResponse?.eventIndex ?? -1,
    leaseRead?.call.eventIndex ?? -1,
    leaseRead?.response?.eventIndex ?? -1,
    stateRead?.call.eventIndex ?? -1,
    stateRead?.response?.eventIndex ?? -1,
    sandboxExec?.eventIndex ?? -1,
    sandboxResponse?.eventIndex ?? -1,
    sandboxCreatedIndex,
    apply?.eventIndex ?? -1,
    approvalRequiredIndex,
    approvalResolutionIndex,
    applyResponse?.eventIndex ?? -1,
    verify?.eventIndex ?? -1,
    verifyResponse?.eventIndex ?? -1,
  ];
  const checks: P0VerificationCheck[] = [
    {
      name: "Bright Data used the canonical scrape or its exact empty-scrape fallback search",
      passed: evidenceTrace !== undefined,
      observed: evidenceTrace === undefined
        ? null
        : {
            scrapeCallId: evidenceTrace.scrape.id,
            url: evidenceTrace.scrape.arguments.url,
            mode: evidenceTrace.mode,
            searchCallId: evidenceTrace.search?.id ?? null,
            query: evidenceTrace.search?.arguments.query ?? null,
          },
    },
    {
      name: "TruthLease persisted a server-hashed evidence receipt",
      passed: recordEvidence !== undefined && recordResponse !== undefined && responsePayload(recordResponse.event)?.receipt !== undefined,
      observed: recordEvidence?.id ?? null,
    },
    {
      name: "TrueForge created and successfully ran its native sandbox",
      passed:
        sandboxCreatedIndex >= 0 &&
        sandboxExec !== undefined &&
        sandboxResponse !== undefined &&
        sandboxExecutionSucceeded(sandboxResponse.event),
      observed: sandboxCreatedIndex < 0 ? null : ordered[sandboxCreatedIndex]?.event.sandbox_id,
    },
    {
      name: "TruthLease successfully read the lease and retailer state before sandbox analysis",
      passed: leaseRead !== undefined && stateRead !== undefined,
      observed: {
        leaseCallId: leaseRead?.call.id ?? null,
        stateCallId: stateRead?.call.id ?? null,
      },
    },
    {
      name: "sandbox emitted the exact snake_case mutation wire contract",
      passed:
        apply !== undefined &&
        requiredWireKeys.every((key) => Object.hasOwn(apply.arguments, key)) &&
        forbiddenWireKeys.every((key) => !Object.hasOwn(apply.arguments, key)) &&
        /^[a-f0-9]{64}$/.test(string(apply.arguments.analysis_sha256) ?? ""),
      observed: apply?.arguments ?? null,
    },
    {
      name: "the only containment patch paused for native approval",
      passed: applyCalls.length === 1 && approvalRequiredIndex >= 0,
      observed: { applyCalls: applyCalls.length, approvalRequiredIndex },
    },
    {
      name: "the owner explicitly approved that exact tool call",
      passed: approvalResolutionIndex >= 0,
      observed: approvalResolutionIndex,
    },
    {
      name: "approved atomic mutation returned a durable receipt",
      passed: applyResponse !== undefined && responsePayload(applyResponse.event)?.receipt !== undefined,
      observed: applyResponse === undefined ? null : responsePayload(applyResponse.event)?.receipt,
    },
    {
      name: "fresh persisted-state verification passed",
      passed: verification?.passed === true && verification?.verdict === "VERIFIED",
      observed: verification === undefined ? null : { passed: verification.passed, verdict: verification.verdict },
    },
    {
      name: "all TruthLease reads, evidence, mutation, and verification used the bound local MCP server",
      passed:
        [...truthLeaseToolNames].every((name) => truthLeaseCalls.some((call) => call.name === name)) &&
        truthLeaseCalls.every((call) => call.serverName === "truthlease-local"),
      observed: truthLeaseCalls.map((call) => ({ name: call.name, serverName: call.serverName ?? null })),
    },
    {
      name: "the qualifying transitions occurred in strict order",
      passed: chronology.every((value) => value >= 0) && chronology.every((value, index) => index === 0 || value > chronology[index - 1]!),
      observed: chronology,
    },
    {
      name: "agent surface did not call the disallowed direct-web tool",
      passed: indexedCalls.every((call) => call.name !== "fetch_official_recall"),
      observed: indexedCalls.map((call) => call.name),
    },
  ];
  return { sessionId, passed: checks.every((check) => check.passed), checks };
}
