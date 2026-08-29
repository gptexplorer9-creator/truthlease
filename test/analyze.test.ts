import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeRecall } from "../src/domain/analyze.js";
import type { EvidenceReceipt, RetailerState } from "../src/domain/types.js";

async function seedState(): Promise<RetailerState> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "seed-state.json"), "utf8")) as RetailerState;
}

const evidence: EvidenceReceipt = {
  id: "EV-TEST",
  provider: "bright-data",
  recordedAt: "2026-08-29T12:01:00.000Z",
  recallNumber: "26-719",
  title: "HABA USA recall",
  productName: "HABA Rainbow Rattle",
  recallDate: "August 27, 2026",
  hazard: "Choking and ingestion",
  description: "Exact item and batch recall.",
  identifiers: { itemNumber: "2012261001", batchCode: "0925" },
  sourceUrl: "https://www.cpsc.gov/Recalls/example",
  retrievedAt: "2026-08-29T12:00:00.000Z",
  contentSha256: "a".repeat(64),
};

describe("analyzeRecall", () => {
  it("returns one exact match, two exclusions, and the exact snake_case wire mutation", async () => {
    const state = await seedState();
    const lease = state.leases[0];
    if (lease === undefined) throw new Error("Missing seed lease.");

    const analysis = analyzeRecall(evidence, lease, state);

    expect(analysis.exactMatches.map((listing) => listing.id)).toEqual(["LISTING-1001"]);
    expect(analysis.excludedNearMatches.map(({ listing }) => listing.id)).toEqual([
      "LISTING-1002",
      "LISTING-1003",
    ]);
    expect(analysis.analysisSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.proposedMutation).toEqual({
      listing_id: "LISTING-1001",
      lease_id: "TL-042",
      patch_id: "RP-104",
      expected_version: 7,
      evidence_receipt_id: "EV-TEST",
      analysis_sha256: analysis.analysisSha256,
      reason: "CPSC 26-719 exactly matches item 2012261001 and batch 0925.",
    });
  });

  it("does not treat a single-field match as exact", async () => {
    const state = await seedState();
    const lease = state.leases[0];
    if (lease === undefined) throw new Error("Missing seed lease.");
    const changedEvidence: EvidenceReceipt = {
      ...evidence,
      identifiers: { itemNumber: "2012261001", batchCode: "DOES-NOT-EXIST" },
    };

    expect(() => analyzeRecall(changedEvidence, lease, state)).toThrow(/exactly one/i);
  });
});
