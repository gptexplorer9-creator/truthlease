import { describe, expect, it } from "vitest";

import {
  buildCaseEventFeed,
  verifyP0SessionEvents,
  type TrueForgeEventEntry,
} from "../src/trueforge/case-feed.js";

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
    call(0, "bright", "search_engine", {}, "bright-data"),
    event(1, {
      type: "tool.response",
      tool_call_id: "bright",
      content:
        "www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle 26-719 2012261001 0925",
    }),
    call(2, "record", "record_recall_evidence", {}, "truthlease-local"),
    response(3, "record", {
      receipt: {
        id: "EV-1",
        title: "Official CPSC recall",
        description: "Exact recalled item and batch.",
        sourceUrl: "https://www.cpsc.gov/Recalls/2026/example",
        retrievedAt: "2026-08-29T00:00:00.000Z",
        contentSha256: "b".repeat(64),
      },
    }),
    call(4, "sandbox", "exec", {}, "trueforge-system"),
    event(5, {
      type: "tool.response",
      tool_call_id: "sandbox",
      content: JSON.stringify({ success: true, response: { exitCode: 0 } }),
    }),
    event(6, { type: "sandbox.created", sandbox_id: "sandbox-p0" }),
    call(7, "apply", "apply_containment_patch", applyArguments, "truthlease-local"),
    event(8, {
      type: "tool.approval_required",
      tool_calls: [{ id: "apply" }],
    }),
    event(9, {
      type: "turn.created",
      input: [{
        type: "user.tool_approval",
        tool_call_id: "apply",
        approval: { status: "allow" },
      }],
    }),
    response(10, "apply", {
      idempotentReplay: false,
      receipt: {
        patchId: "PATCH-1",
        expectedVersion: 7,
        appliedVersion: 8,
      },
      lease: { id: "TL-042", status: "revoked" },
      listing: { id: "LISTING-1001", published: false },
    }),
    call(11, "verify", "verify_containment_state", {}, "truthlease-local"),
    response(12, "verify", {
      passed: true,
      verdict: "VERIFIED",
      observedAt: "2026-08-29T00:00:12.000Z",
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
});
