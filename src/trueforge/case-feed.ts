import { createHash } from "node:crypto";

import type { RunEvent, RunEventType } from "../domain/types.js";

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
  return parseJsonObject(event.content);
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
  if (!(["127.0.0.1", "localhost"] as string[]).includes(url.hostname)) {
    throw new Error("TrueForge event feed must use a loopback origin.");
  }
  const response = await fetchImpl(
    new URL(`/api/v1/sessions/${encodeURIComponent(sessionId)}/events?limit=100`, url),
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
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
  const sandbox = ordered.map(({ event }) => event).find((event) => event.type === "sandbox.created");
  const sandboxExec = [...toolCalls.values()].find(
    (call) => call.name === "exec" && record(call.event.tool_calls) === undefined,
  ) ?? [...toolCalls.values()].find((call) => call.name === "exec");
  const sandboxResponse = sandboxExec === undefined ? undefined : responses.get(sandboxExec.id);

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
    if (sandbox !== undefined && sandboxResponse !== undefined && errorMessage(sandboxResponse) === undefined) {
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
  if (sandboxExec !== undefined && sandboxResponse !== undefined && errorMessage(sandboxResponse) !== undefined) {
    generated.push({
      type: "analysis.failed",
      source: sandboxResponse,
      payload: { code: "sandbox_initialization_failed", message: errorMessage(sandboxResponse) ?? "Sandbox failed." },
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
  const ordered = [...entries].sort((left, right) => {
    const byTime = Date.parse(createdAt(left.event)) - Date.parse(createdAt(right.event));
    return byTime !== 0 ? byTime : String(left.event.id).localeCompare(String(right.event.id));
  });
  const indexedCalls = ordered.flatMap(({ event }, eventIndex) =>
    toolCallsFrom(event).map((call) => ({ ...call, eventIndex })),
  );
  const indexedResponses = new Map<string, { event: UnknownRecord; eventIndex: number }>();
  ordered.forEach(({ event }, eventIndex) => {
    if (event.type !== "tool.response") return;
    const callId = string(event.tool_call_id);
    if (callId !== undefined) indexedResponses.set(callId, { event, eventIndex });
  });

  const qualifyingBright = indexedCalls
    .filter(
      (call) =>
        call.serverName === "bright-data" &&
        (call.name === "scrape_as_markdown" || call.name === "search_engine"),
    )
    .map((call) => ({ call, response: indexedResponses.get(call.id) }))
    .find(({ response }) => {
      const content = string(response?.event.content) ?? "";
      return content.includes("www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle") &&
        content.includes("26-719") &&
        content.includes("2012261001") &&
        content.includes("0925");
    });
  const bright = qualifyingBright?.call;
  const brightResponse = qualifyingBright?.response;
  const recordEvidence = indexedCalls.find((call) => call.name === "record_recall_evidence");
  const recordResponse = recordEvidence === undefined ? undefined : indexedResponses.get(recordEvidence.id);
  const sandboxCreatedIndex = ordered.findIndex(({ event }) => event.type === "sandbox.created");
  const sandboxExec = indexedCalls.find((call) => call.name === "exec");
  const sandboxResponse = sandboxExec === undefined ? undefined : indexedResponses.get(sandboxExec.id);
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
  const chronology = [
    bright?.eventIndex ?? -1,
    brightResponse?.eventIndex ?? -1,
    recordEvidence?.eventIndex ?? -1,
    recordResponse?.eventIndex ?? -1,
    sandboxCreatedIndex,
    sandboxExec?.eventIndex ?? -1,
    sandboxResponse?.eventIndex ?? -1,
    apply?.eventIndex ?? -1,
    approvalRequiredIndex,
    approvalResolutionIndex,
    applyResponse?.eventIndex ?? -1,
    verify?.eventIndex ?? -1,
    verifyResponse?.eventIndex ?? -1,
  ];
  const checks: P0VerificationCheck[] = [
    {
      name: "Bright Data performed the qualifying live CPSC scrape",
      passed: bright !== undefined && brightResponse !== undefined && errorMessage(brightResponse.event) === undefined,
      observed: bright === undefined ? null : { callId: bright.id, url: bright.arguments.url },
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
        errorMessage(sandboxResponse.event) === undefined,
      observed: sandboxCreatedIndex < 0 ? null : ordered[sandboxCreatedIndex]?.event.sandbox_id,
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
