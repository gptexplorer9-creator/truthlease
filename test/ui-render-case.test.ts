import { describe, expect, it } from "vitest";

import { buildCaseViewModel } from "../src/ui/case-model.js";
import { renderCaseHtml } from "../src/ui/render-case.js";
import { renderEmptyWorkspaceHtml } from "../src/ui/render-shell.js";
import { completeEvents, completeFeed, fixtureEvent, VALID_EVIDENCE_HASH, VALID_EVIDENCE_SOURCE } from "./ui-fixtures.js";

describe("operational case-file renderer", () => {
  it("renders an honest product workspace when the real ledger has no cases", () => {
    const html = renderEmptyWorkspaceHtml({
      terminalState: "connected",
      queueState: "ready",
      queueCases: [],
      connectionMessage: "Append-only ledger connected. No case records have been recorded yet.",
    });

    expect(html).toContain("Find and inspect evidence-bound containment records");
    expect(html).toContain("No case records yet");
    expect(html).toContain("Loaded records</dt><dd>0");
    expect(html).toContain("Containment lifecycle");
    expect(html.match(/Not started/g)).toHaveLength(5);
    expect(html).not.toContain("TL-042");
    expect(html).not.toContain("case feed is unavailable");
  });

  it("renders the complete evidence-to-verification record without browser action controls", () => {
    const html = renderCaseHtml(buildCaseViewModel(completeFeed()));

    expect(html).toContain("Evidence");
    expect(html).toContain("Proof");
    expect(html).toContain("Approval");
    expect(html).toContain("Patch");
    expect(html).toContain("Verified");
    expect(html).toContain("Valid when recorded");
    expect(html).toContain("Official fact changed");
    expect(html).toContain("Controlled response");
    expect(html).toContain("Bright Data Web MCP");
    expect(html).toContain(VALID_EVIDENCE_HASH);
    expect(html).toContain("LISTING-1001");
    expect(html).toContain("LISTING-1002");
    expect(html).toContain("LISTING-1003");
    expect(html).toContain("1</span><span><strong>Exact match");
    expect(html).toContain("2</span><span><strong>Near matches excluded");
    expect(html).toContain("apply_containment_patch");
    expect(html).toContain("lease_id");
    expect(html).toContain("Fresh persisted-state re-read");
    expect(html).toContain("Approved before and after state");
    expect(html).toContain("excluded listings remain untouched");
    expect(html).toContain("not an independent third-party verification");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("mutation endpoint");
  });

  it("shows a real native approval target but suppresses unsafe schemes", () => {
    const pending = completeFeed(completeEvents.slice(0, 4));
    const realTarget = renderCaseHtml(buildCaseViewModel(pending));
    expect(realTarget).toContain("Open genuine TrueForge approval");
    expect(realTarget).toContain("Approve exact patch in TrueForge");
    expect(realTarget).toContain("Deny in TrueForge");
    expect(realTarget).toContain("Human control point / 0 writes");
    expect(realTarget).toContain("http://127.0.0.1:8790/session/approval-001");

    const unsafeRequest = fixtureEvent(4, "approval.required", {
      approvalId: "approval-unsafe",
      action: "apply_containment_patch",
      resolutionMode: "trueforge_native",
      status: "pending",
      trueforgeTarget: { href: "javascript:alert(1)" },
    });
    const unsafeTarget = renderCaseHtml(
      buildCaseViewModel(completeFeed([...completeEvents.slice(0, 3), unsafeRequest])),
    );
    expect(unsafeTarget).not.toContain("javascript:");
    expect(unsafeTarget).not.toContain("Open genuine TrueForge approval");
    expect(unsafeTarget).toContain("No verified TrueForge approval target was supplied");
  });

  it("escapes hostile source content instead of interpreting it as markup", () => {
    const hostileEvidence = fixtureEvent(2, "evidence.fetched", {
      title: "<img src=x onerror=alert(1)>",
      source: { url: "https://www.cpsc.gov/Recalls/example", transport: "Bright Data" },
      receipt: { content_hash: "sha256:test" },
    });
    const html = renderCaseHtml(
      buildCaseViewModel(completeFeed([completeEvents[0]!, hostileEvidence])),
    );

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Evidence contract blocked");
    expect(html).toContain("Evidence event rejected");
    expect(html).toContain("Evidence rejected");
    expect(html).not.toContain("Official CPSC evidence was retrieved through Bright Data");
    expect(html).not.toContain("Official source, retrieved through");
  });

  it("renders version conflict and idempotent replay honestly", () => {
    const versionConflict = fixtureEvent(6, "patch.failed", {
      code: "version_conflict",
      message: "Expected version 7; found version 8.",
    });
    const conflictHtml = renderCaseHtml(
      buildCaseViewModel(completeFeed([...completeEvents.slice(0, 5), versionConflict])),
    );
    expect(conflictHtml).toContain("Approval is stale");
    expect(conflictHtml).toContain("Do not auto-retry");

    const replay = fixtureEvent(6, "patch.applied", {
      patch_id: "patch-001",
      idempotent_replay: true,
      lease: { lease_id: "TL-042", status: "revoked" },
      listing: { listing_id: "LISTING-1001", status: "unpublished" },
    });
    const replayHtml = renderCaseHtml(
      buildCaseViewModel(completeFeed([...completeEvents.slice(0, 5), replay])),
    );
    expect(replayHtml).toContain("Idempotent replay");
    expect(replayHtml).toContain("No second mutation was applied");
  });

  it("withholds the verified banner when persisted statuses do not prove containment", () => {
    const invalidVerification = fixtureEvent(7, "verification.completed", {
      passed: true,
      lease: { lease_id: "TL-042", status: "active" },
      listing: { listing_id: "LISTING-1001", status: "published" },
    });
    const html = renderCaseHtml(
      buildCaseViewModel(completeFeed([...completeEvents.slice(0, 6), invalidVerification])),
    );

    expect(html).toContain("Verification not accepted");
    expect(html).not.toContain("Persisted result confirmed");
    expect(html).not.toContain("stage stage--verified");
  });

  it("renders stale evidence as a blocking state", () => {
    const staleEvidence = fixtureEvent(2, "evidence.fetched", {
      stale: true,
      title: "Old CPSC receipt",
      source: VALID_EVIDENCE_SOURCE,
      receipt: { retrieved_at: "2026-01-01T00:00:00.000Z", content_hash: VALID_EVIDENCE_HASH },
    });
    const html = renderCaseHtml(
      buildCaseViewModel(completeFeed([completeEvents[0]!, staleEvidence])),
    );

    expect(html).toContain("Evidence receipt is stale");
    expect(html).toContain("Containment cannot advance from this receipt");
    expect(html).toContain("Proof</strong><small>Waiting");
  });
});
