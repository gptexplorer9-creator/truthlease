import { describe, expect, it } from "vitest";

import { buildCaseViewModel } from "../src/ui/case-model.js";
import { completeEvents, completeFeed, fixtureEvent, VALID_EVIDENCE_HASH, VALID_EVIDENCE_SOURCE } from "./ui-fixtures.js";

describe("deterministic case state", () => {
  it("keeps every completed stage visible after verification", () => {
    const model = buildCaseViewModel(completeFeed());
    expect(model.stages.map((stage) => [stage.label, stage.status])).toEqual([
      ["Evidence", "complete"],
      ["Proof", "complete"],
      ["Approval", "complete"],
      ["Patch", "complete"],
      ["Verified", "complete"],
    ]);
    expect(model.contractWarnings).toEqual([]);
  });

  it("treats denial as terminal authority, not as patch permission", () => {
    const denied = fixtureEvent(5, "approval.resolved", {
      approvalId: "approval-001",
      decision: "denied",
    });
    const feed = completeFeed([...completeEvents.slice(0, 4), denied]);
    const model = buildCaseViewModel(feed);

    expect(model.stages[2]?.status).toBe("denied");
    expect(model.stages[3]?.status).toBe("waiting");
    expect(model.stages[4]?.status).toBe("waiting");
  });

  it("never calls a failed verification complete", () => {
    const failedRead = fixtureEvent(7, "verification.completed", {
      passed: false,
      message: "The excluded listing changed unexpectedly.",
    });
    const model = buildCaseViewModel(
      completeFeed([...completeEvents.slice(0, 6), failedRead]),
    );

    expect(model.stages[4]?.status).toBe("failed");
  });

  it("rejects an exact match whose item or batch differs from the declared rule", () => {
    const mismatchedAnalysis = fixtureEvent(3, "analysis.completed", {
      ...completeEvents[2]!.payload,
      exact_match: {
        listing_id: "LISTING-1001",
        item_number: "ITEM-OTHER",
        batch_code: "B-2406-A",
      },
    });
    const model = buildCaseViewModel(completeFeed([
      ...completeEvents.slice(0, 2),
      mismatchedAnalysis,
      ...completeEvents.slice(3),
    ]));

    expect(model.stages.map((stage) => stage.status)).toEqual([
      "complete",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(model.contractWarnings).toContain(
      "Analysis completed without an exact match equal to the declared item-and-batch rule.",
    );
  });

  it("requires identified revoked and unpublished records for verified completion", () => {
    const wrongStatuses = fixtureEvent(7, "verification.completed", {
      passed: true,
      lease: { lease_id: "TL-042", status: "active" },
      listing: { listing_id: "LISTING-1001", status: "published" },
    });
    const missingLeaseId = fixtureEvent(7, "verification.completed", {
      passed: true,
      lease: { status: "revoked" },
      listing: { listing_id: "LISTING-1001", status: "unpublished" },
    });

    for (const verification of [wrongStatuses, missingLeaseId]) {
      const model = buildCaseViewModel(
        completeFeed([...completeEvents.slice(0, 6), verification]),
      );
      expect(model.stages[4]?.status).toBe("waiting");
      expect(model.contractWarnings).toContain(
        "Verification completed without a revoked lease and unpublished listing identified in persisted state.",
      );
    }
  });

  it("surfaces impossible authority ordering as a contract warning", () => {
    const feed = completeFeed([
      ...completeEvents.slice(0, 3),
      fixtureEvent(4, "patch.applied", { patch_id: "patch-without-approval" }),
    ]);
    const model = buildCaseViewModel(feed);

    expect(model.contractWarnings).toContain(
      "A patch receipt arrived without an explicit approved TrueForge resolution.",
    );
  });

  it("blocks progress and labels a stale evidence receipt explicitly", () => {
    const staleEvidence = fixtureEvent(2, "evidence.fetched", {
      stale: true,
      title: "Old CPSC receipt",
      source: VALID_EVIDENCE_SOURCE,
      receipt: { retrieved_at: "2026-01-01T00:00:00.000Z", content_hash: VALID_EVIDENCE_HASH },
    });
    const model = buildCaseViewModel(completeFeed([completeEvents[0]!, staleEvidence]));

    expect(model.stages[0]?.status).toBe("stale");
    expect(model.stages[1]?.status).toBe("waiting");
    expect(model.stages[2]?.status).toBe("waiting");
  });
});
