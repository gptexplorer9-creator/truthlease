import { createHash } from "node:crypto";

import type {
  ApplyContainmentPatchArguments,
  EvidenceReceipt,
  Listing,
  RetailerState,
  TruthLease,
} from "./types.js";

export interface MatchAnalysis {
  exactMatches: Listing[];
  excludedNearMatches: Array<{
    listing: Listing;
    matchingFields: Array<"itemNumber" | "batchCode">;
  }>;
  analysisSha256: string;
  proposedMutation: ApplyContainmentPatchArguments;
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function analyzeRecall(
  evidence: EvidenceReceipt,
  lease: TruthLease,
  state: RetailerState,
  patchId = "RP-104",
): MatchAnalysis {
  if (lease.status !== "active") {
    throw new Error(`Lease ${lease.id} is not active.`);
  }

  const recalledItem = normalizeIdentifier(evidence.identifiers.itemNumber);
  const recalledBatch = normalizeIdentifier(evidence.identifiers.batchCode);
  if (recalledItem.length === 0 || recalledBatch.length === 0) {
    throw new Error("Official evidence is missing an exact item number or batch code.");
  }

  const exactMatches: Listing[] = [];
  const excludedNearMatches: MatchAnalysis["excludedNearMatches"] = [];

  for (const listing of state.listings) {
    const itemMatches = normalizeIdentifier(listing.itemNumber) === recalledItem;
    const batchMatches = normalizeIdentifier(listing.batchCode) === recalledBatch;

    if (itemMatches && batchMatches) {
      exactMatches.push(listing);
    } else if (itemMatches || batchMatches) {
      excludedNearMatches.push({
        listing,
        matchingFields: [
          ...(itemMatches ? (["itemNumber"] as const) : []),
          ...(batchMatches ? (["batchCode"] as const) : []),
        ],
      });
    }
  }

  if (exactMatches.length !== 1) {
    throw new Error(`Expected exactly one recalled listing, observed ${exactMatches.length}.`);
  }

  const exact = exactMatches[0];
  if (exact === undefined || !lease.downstreamListingIds.includes(exact.id)) {
    throw new Error("The exact match is not an authorized downstream dependency of the lease.");
  }

  const analysisRecord = {
    evidence_receipt_id: evidence.id,
    evidence_sha256: evidence.contentSha256,
    lease_id: lease.id,
    state_version: state.version,
    exact_listing_id: exact.id,
    excluded_near_match_ids: excludedNearMatches.map(({ listing }) => listing.id).sort(),
  };
  const analysisSha256 = createHash("sha256")
    .update(JSON.stringify(analysisRecord), "utf8")
    .digest("hex");

  return {
    exactMatches,
    excludedNearMatches,
    analysisSha256,
    proposedMutation: {
      listing_id: exact.id,
      lease_id: lease.id,
      patch_id: patchId,
      expected_version: state.version,
      evidence_receipt_id: evidence.id,
      analysis_sha256: analysisSha256,
      reason: `CPSC ${evidence.recallNumber} exactly matches item ${evidence.identifiers.itemNumber} and batch ${evidence.identifiers.batchCode}.`,
    },
  };
}
