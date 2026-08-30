import { describe, expect, it } from "vitest";

import { buildCaseViewModel } from "../src/ui/case-model.js";
import { renderCaseHtml } from "../src/ui/render-case.js";
import { completeEvents, completeFeed, fixtureEvent, VALID_EVIDENCE_HASH, VALID_EVIDENCE_SOURCE } from "./ui-fixtures.js";

describe("ui truthfulness gates", () => {
  it("blocks downstream completion when analysis arrives after stale evidence", () => {
    const staleEvidence = fixtureEvent(2, "evidence.fetched", {
      stale: true,
      title: "Old CPSC receipt",
      source: VALID_EVIDENCE_SOURCE,
      receipt: { retrieved_at: "2026-01-01T00:00:00.000Z", content_hash: VALID_EVIDENCE_HASH },
    });
    const model = buildCaseViewModel(
      completeFeed([completeEvents[0]!, staleEvidence, completeEvents[2]!]),
    );

    expect(model.stages.map((stage) => stage.status)).toEqual([
      "stale",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(model.contractWarnings).toContain("Analysis arrived from an evidence receipt marked stale.");
    expect(model.stageNotes.proof).toContain("TruthLease will not mark proof complete");
  });

  it("refuses to render patch or verification complete without approved authority", () => {
    const model = buildCaseViewModel(
      completeFeed([
        ...completeEvents.slice(0, 3),
        fixtureEvent(4, "patch.applied", {
          patch_id: "patch-without-approval",
          lease: { lease_id: "TL-042", status: "revoked" },
          listing: { listing_id: "LISTING-1001", status: "unpublished" },
        }),
        fixtureEvent(5, "verification.completed", {
          passed: true,
          read_at: "2026-08-29T20:00:05.000Z",
          lease: { lease_id: "TL-042", status: "revoked" },
          listing: { listing_id: "LISTING-1001", status: "unpublished" },
        }),
      ]),
    );

    expect(model.stages[3]?.status).toBe("waiting");
    expect(model.stages[4]?.status).toBe("waiting");
    expect(model.contractWarnings).toContain(
      "A patch receipt arrived without an explicit approved TrueForge resolution.",
    );
  });

  it("suppresses event-supplied approval links and renders queue entries from the index", () => {
    const pending = buildCaseViewModel(completeFeed(completeEvents.slice(0, 4)));
    const html = renderCaseHtml(pending, {
      queueState: "ready",
      queueCases: [
        {
          caseId: "TL-042",
          caseType: "recall_containment",
          subject: "HABA Rainbow Rattle",
          createdAt: "2026-08-29T20:00:00.000Z",
        },
      ],
    });

    expect(html).not.toContain("http://127.0.0.1:8790/session/approval-001");
    expect(html).toContain("never opens approval URLs supplied by event data");
    expect(html).toContain("recall_containment / HABA Rainbow Rattle");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Feed provenance live");
  });
});
