import type { CaseEventFeed, JsonObject, RunEvent, RunEventType } from "../src/ui/case-events.js";

const RUN_ID = "run-truthlease-001";
const BASE_TIME = Date.parse("2026-08-29T20:00:00.000Z");

function event<TType extends RunEventType>(
  sequence: number,
  type: TType,
  payload: JsonObject,
): RunEvent<TType> {
  return {
    type,
    id: `evt-${String(sequence).padStart(2, "0")}`,
    timestamp: new Date(BASE_TIME + sequence * 1_000).toISOString(),
    runId: RUN_ID,
    sequence,
    payload,
  };
}

export const completeEvents: RunEvent[] = [
  event(1, "state.snapshot", {
    lease: {
      lease_id: "TL-042",
      status: "active",
      item_number: "ITEM-8831",
      batch_code: "B-2406-A",
    },
    listing: { listing_id: "LISTING-1001", status: "published" },
  }),
  event(2, "evidence.fetched", {
    title: "Official recall for Example Infant Lounger",
    summary: "A suffocation hazard was identified for the affected item and batch.",
    source: {
      authority: "U.S. Consumer Product Safety Commission",
      transport: "Bright Data Web MCP",
      url: "https://www.cpsc.gov/Recalls/example",
    },
    receipt: {
      retrieved_at: "2026-08-29T20:00:02.000Z",
      content_hash: "sha256:official-evidence-hash",
    },
  }),
  event(3, "analysis.completed", {
    rule: { item_number: "ITEM-8831", batch_code: "B-2406-A" },
    exact_match: {
      listing_id: "LISTING-1001",
      item_number: "ITEM-8831",
      batch_code: "B-2406-A",
    },
    excluded_matches: [
      {
        listing_id: "LISTING-1002",
        item_number: "ITEM-8831",
        batch_code: "B-2405-Z",
        differing_fields: { batch_code: "B-2405-Z" },
      },
      {
        listing_id: "LISTING-1003",
        item_number: "ITEM-4410",
        batch_code: "B-2406-A",
        differing_fields: { item_number: "ITEM-4410" },
      },
    ],
    sandbox: {
      provider: "TrueForge sandbox",
      run_id: "sandbox-8831",
      output: "One exact match. Two near matches excluded by the item + batch conjunction.",
    },
  }),
  event(4, "approval.required", {
    approvalId: "approval-001",
    action: "apply_containment_patch",
    resolutionMode: "trueforge_native",
    status: "pending",
    arguments: {
      lease_id: "TL-042",
      listing_id: "LISTING-1001",
      patch_id: "patch-001",
      expected_version: 7,
      evidence_receipt_id: "evidence-001",
      analysis_sha256: "sha256:analysis-plan",
    },
    trueforgeTarget: { href: "http://127.0.0.1:8790/session/approval-001" },
  }),
  event(5, "approval.resolved", {
    approvalId: "approval-001",
    decision: "approved",
    actor: "owner",
  }),
  event(6, "patch.applied", {
    patch_id: "patch-001",
    prior_version: 7,
    new_version: 8,
    receipt_hash: "sha256:patch-receipt",
    idempotent_replay: false,
    lease: { lease_id: "TL-042", status: "revoked" },
    listing: { listing_id: "LISTING-1001", status: "unpublished" },
  }),
  event(7, "verification.completed", {
    passed: true,
    read_at: "2026-08-29T20:00:07.000Z",
    lease: { lease_id: "TL-042", status: "revoked" },
    listing: { listing_id: "LISTING-1001", status: "unpublished" },
    excluded_listings: [
      { listing_id: "LISTING-1002", status: "published" },
      { listing_id: "LISTING-1003", status: "published" },
    ],
  }),
];

export function completeFeed(events: RunEvent[] = completeEvents): CaseEventFeed {
  return {
    caseId: "TL-042",
    runId: RUN_ID,
    status: "verified",
    lastSequence: events.at(-1)?.sequence ?? 0,
    events,
  };
}

export function fixtureEvent<TType extends RunEventType>(
  sequence: number,
  type: TType,
  payload: JsonObject,
): RunEvent<TType> {
  return event(sequence, type, payload);
}
