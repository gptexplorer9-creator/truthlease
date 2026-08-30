import { describe, expect, it } from "vitest";

import {
  buildCaseEventFeed,
  P0_CPSC_FALLBACK_QUERY,
  P0_CPSC_RECALL_URL,
  verifyP0SessionEvents,
  verifyTrueForgeEvidenceAuthorization,
  verifyTrueForgeMutationAuthorization,
  type TrueForgeEventEntry,
} from "../src/trueforge/case-feed.js";
import type {
  ApplyContainmentPatchArguments,
  RecordRecallEvidenceInput,
} from "../src/domain/types.js";

const sessionId = "session-p0";

function event(
  index: number,
  value: Record<string, unknown>,
): TrueForgeEventEntry {
  return {
    turn_id: "turn-p0",
    event: {
      id: `event-${index}`,
      created_at: new Date(index * 1_000).toISOString(),
      ...value,
    },
  };
}

function call(
  index: number,
  id: string,
  name: string,
  args: Record<string, unknown>,
  serverName: string,
): TrueForgeEventEntry {
  return event(index, {
    type: "model.message",
    tool_calls: [{
      id,
      function: { name, arguments: JSON.stringify(args) },
      tool_info: { server_name: serverName },
    }],
  });
}

function response(
  index: number,
  toolCallId: string,
  result: Record<string, unknown>,
): TrueForgeEventEntry {
  return event(index, {
    type: "tool.response",
    tool_call_id: toolCallId,
    content: JSON.stringify({ result }),
  });
}

function qualifyingEntries(): TrueForgeEventEntry[] {
  const title = "HABA USA Recalls Rainbow Rattle Grasping and Teething ...";
  const description =
    "2 days ago - This recall involves HABA Rainbow Rattle Grasping and Teething Toy item number 2012261001 and batch code 0925. Recall 26-719.";
  const searchPayload = {
    organic: [{ link: P0_CPSC_RECALL_URL, title, description }],
    current_page: 1,
  };
  const evidenceArguments = {
    source_url: P0_CPSC_RECALL_URL,
    retrieved_at: new Date(3_000).toISOString(),
    recall_number: "26-719",
    title,
    product_name: "HABA Rainbow Rattle Grasping and Teething Toy",
    recall_date: "2 days ago",
    hazard: "Risk of Serious Injury or Death from Choking and Ingestion Hazards",
    description,
    item_number: "2012261001",
    batch_code: "0925",
    evidence_text: JSON.stringify(searchPayload),
  };
  const applyArguments = {
    listing_id: "LISTING-1001",
    lease_id: "TL-042",
    patch_id: "PATCH-1",
    expected_version: 7,
    evidence_receipt_id: "EV-1",
    analysis_sha256: "a".repeat(64),
    reason: "CPSC 26-719 exactly matches item 2012261001 and batch 0925.",
  };
  return [
    call(0, "scrape", "scrape_as_markdown", { url: P0_CPSC_RECALL_URL }, "bright-data"),
    event(1, {
      type: "tool.response",
      tool_call_id: "scrape",
      content: "",
    }),
    call(2, "search", "search_engine", {
      query: P0_CPSC_FALLBACK_QUERY,
      engine: "google",
      cursor: "",
      geo_location: "us",
    }, "bright-data"),
    event(3, {
      type: "tool.response",
      tool_call_id: "search",
      content: JSON.stringify(searchPayload),
    }),
    call(4, "record", "record_recall_evidence", evidenceArguments, "truthlease-local"),
    response(5, "record", {
      receipt: {
        id: "EV-1",
        title,
        description,
        sourceUrl: P0_CPSC_RECALL_URL,
        retrievedAt: evidenceArguments.retrieved_at,
        contentSha256: "b".repeat(64),
      },
    }),
    call(6, "lease", "get_truth_lease", { lease_id: "TL-042" }, "truthlease-local"),
    response(7, "lease", {
      id: "TL-042",
      status: "active",
      subject: {
        listingId: "LISTING-1001",
        itemNumber: "2012261001",
        batchCode: "0925",
      },
    }),
    call(8, "state", "get_retailer_state", {}, "truthlease-local"),
    response(9, "state", {
      version: 7,
      leases: [{
        id: "TL-042",
        status: "active",
        subject: {
          listingId: "LISTING-1001",
          itemNumber: "2012261001",
          batchCode: "0925",
        },
      }],
      listings: [
        { id: "LISTING-1001", itemNumber: "2012261001", batchCode: "0925", published: true },
        { id: "LISTING-1002", itemNumber: "2012261001", batchCode: "0924", published: true },
        { id: "LISTING-1003", itemNumber: "2012261002", batchCode: "0925", published: true },
      ],
    }),
    call(10, "sandbox", "exec", {}, "trueforge-system"),
    event(11, {
      type: "tool.response",
      tool_call_id: "sandbox",
      content: JSON.stringify({ success: true, response: { exitCode: 0 } }),
    }),
    event(12, { type: "sandbox.created", sandbox_id: "sandbox-p0" }),
    call(13, "apply", "apply_containment_patch", applyArguments, "truthlease-local"),
    event(14, {
      type: "tool.approval_required",
      tool_calls: [{ id: "apply" }],
    }),
    event(15, {
      type: "turn.created",
      input: [{
        type: "user.tool_approval",
        tool_call_id: "apply",
        approval: { status: "allow" },
      }],
    }),
    response(16, "apply", {
      idempotentReplay: false,
      receipt: {
        patchId: "PATCH-1",
        expectedVersion: 7,
        appliedVersion: 8,
      },
      lease: { id: "TL-042", status: "revoked" },
      listing: { id: "LISTING-1001", published: false },
    }),
    call(17, "verify", "verify_containment_state", { patch_id: "PATCH-1" }, "truthlease-local"),
    response(18, "verify", {
      passed: true,
      verdict: "VERIFIED",
      observedAt: new Date(18_000).toISOString(),
      checks: [],
    }),
  ];
}

describe("TrueForge case feed", () => {
  it("unwraps MCP result envelopes and verifies real sandbox event order", () => {
    const verification = verifyP0SessionEvents(sessionId, qualifyingEntries());

    expect(verification.passed).toBe(true);
    expect(verification.checks.every((check) => check.passed)).toBe(true);
  });

  it("maps wrapped evidence, patch, and verification responses", () => {
    const feed = buildCaseEventFeed("TL-042", sessionId, qualifyingEntries());

    expect(feed.events.map((item) => item.type)).toEqual(expect.arrayContaining([
      "evidence.fetched",
      "patch.applied",
      "verification.completed",
    ]));
    expect(feed.status).toBe("verified");
  });

  it("rejects a sandbox response unless success is true and exitCode is zero", () => {
    const entries = qualifyingEntries();
    entries[11]!.event.content = JSON.stringify({
      success: false,
      response: { exitCode: 1, result: "analysis failed" },
    });

    const verification = verifyP0SessionEvents(sessionId, entries);
    const feed = buildCaseEventFeed("TL-042", sessionId, entries);

    expect(verification.passed).toBe(false);
    expect(verification.checks.find((check) => check.name.includes("sandbox"))?.passed).toBe(false);
    expect(feed.events.some((item) => item.type === "analysis.completed")).toBe(false);
    expect(feed.events.some((item) => item.type === "analysis.failed")).toBe(true);
  });

  it("rejects a non-canonical Bright Data request and a mutation from the wrong server", () => {
    const wrongQuery = qualifyingEntries();
    const searchCalls = wrongQuery[2]!.event.tool_calls as Array<{
      function: { arguments: string };
    }>;
    searchCalls[0]!.function.arguments = JSON.stringify({
      query: "broader unbound query",
      engine: "google",
      cursor: "",
      geo_location: "us",
    });
    expect(verifyP0SessionEvents(sessionId, wrongQuery).passed).toBe(false);

    const wrongServer = qualifyingEntries();
    const applyCalls = wrongServer[13]!.event.tool_calls as Array<{
      tool_info: { server_name: string };
    }>;
    applyCalls[0]!.tool_info.server_name = "untrusted-mcp";
    expect(verifyP0SessionEvents(sessionId, wrongServer).passed).toBe(false);
  });

  it("issues exact-call evidence and approval proofs and rejects altered arguments", () => {
    const entries = qualifyingEntries();
    const recordCall = (entries[4]!.event.tool_calls as Array<{
      function: { arguments: string };
    }>)[0]!;
    const wire = JSON.parse(recordCall.function.arguments) as Record<string, string>;
    const evidenceInput: RecordRecallEvidenceInput = {
      sourceUrl: wire.source_url!,
      retrievedAt: wire.retrieved_at!,
      recallNumber: wire.recall_number!,
      title: wire.title!,
      productName: wire.product_name!,
      recallDate: wire.recall_date!,
      hazard: wire.hazard!,
      description: wire.description!,
      itemNumber: wire.item_number!,
      batchCode: wire.batch_code!,
      evidenceText: wire.evidence_text!,
    };
    const applyCall = (entries[13]!.event.tool_calls as Array<{
      function: { arguments: string };
    }>)[0]!;
    const mutationInput = JSON.parse(
      applyCall.function.arguments,
    ) as ApplyContainmentPatchArguments;

    expect(verifyTrueForgeEvidenceAuthorization(entries, evidenceInput)?.callId).toBe("record");
    expect(verifyTrueForgeEvidenceAuthorization(entries, {
      ...evidenceInput,
      batchCode: "9999",
    })).toBeUndefined();
    expect(verifyTrueForgeMutationAuthorization(entries, mutationInput)?.callId).toBe("apply");
    expect(verifyTrueForgeMutationAuthorization(entries, {
      ...mutationInput,
      expected_version: 99,
    })).toBeUndefined();
  });

  it("rejects an exec that is not bound to the created sandbox turn", () => {
    const entries = qualifyingEntries();
    entries[12]!.turn_id = "unrelated-turn";

    expect(verifyP0SessionEvents(sessionId, entries).passed).toBe(false);
    expect(
      buildCaseEventFeed("TL-042", sessionId, entries).events.some(
        (item) => item.type === "analysis.completed",
      ),
    ).toBe(false);
  });

  it("requires successful lease and retailer-state responses before analysis", () => {
    const entries = qualifyingEntries();
    entries[9]!.event.content = JSON.stringify({ error: "state read failed" });

    const verification = verifyP0SessionEvents(sessionId, entries);

    expect(verification.passed).toBe(false);
    expect(
      verification.checks.find((check) => check.name.includes("before sandbox analysis"))?.passed,
    ).toBe(false);
  });

  it("accepts a later canonical Bright Data retry after an incomplete first attempt", () => {
    const entries = [
      call(-4, "scrape-incomplete", "scrape_as_markdown", {
        url: P0_CPSC_RECALL_URL,
      }, "bright-data"),
      event(-3, {
        type: "tool.response",
        tool_call_id: "scrape-incomplete",
        content: "",
      }),
      call(-2, "search-incomplete", "search_engine", {
        query: P0_CPSC_FALLBACK_QUERY,
        engine: "google",
        cursor: "",
        geo_location: "us",
      }, "bright-data"),
      ...qualifyingEntries(),
    ];

    expect(verifyP0SessionEvents(sessionId, entries).passed).toBe(true);
  });
});
