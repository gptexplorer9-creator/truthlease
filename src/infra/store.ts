import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { analyzeRecall, normalizeIdentifier } from "../domain/analyze.js";
import type {
  ApplyContainmentPatchArguments,
  ApplyContainmentPatchResult,
  AuditEvent,
  ContainmentVerification,
  EvidenceReceipt,
  Listing,
  RecordRecallEvidenceInput,
  RecordRecallEvidenceResult,
  RetailerState,
  TruthLease,
} from "../domain/types.js";

const MAX_EVIDENCE_AGE_MS = 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizedText(value: string): string {
  return normalizeIdentifier(value);
}

function samePatchRequest(event: AuditEvent, input: ApplyContainmentPatchArguments): boolean {
  return (
    event.listingId === input.listing_id &&
    event.leaseId === input.lease_id &&
    event.patchId === input.patch_id &&
    event.expectedVersion === input.expected_version &&
    event.evidenceReceiptId === input.evidence_receipt_id &&
    event.analysisSha256 === input.analysis_sha256.toLowerCase() &&
    event.reason === input.reason
  );
}

export class RetailerStore {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly seedPath: string,
    private readonly statePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async reset(): Promise<RetailerState> {
    const seed = await this.readFile(this.seedPath);
    await this.writeFile(seed);
    return clone(seed);
  }

  public async read(): Promise<RetailerState> {
    try {
      return clone(await this.readFile(this.statePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return this.reset();
    }
  }

  public async getLease(leaseId: string): Promise<TruthLease> {
    const state = await this.read();
    const lease = state.leases.find((candidate) => candidate.id === leaseId);
    if (lease === undefined) {
      throw new Error(`Truth Lease ${leaseId} does not exist.`);
    }
    return lease;
  }

  public async recordRecallEvidence(
    input: RecordRecallEvidenceInput,
  ): Promise<RecordRecallEvidenceResult> {
    this.validateOfficialEvidence(input);
    const contentSha256 = createHash("sha256").update(input.evidenceText, "utf8").digest("hex");
    const retrievedAt = new Date(input.retrievedAt).toISOString();
    const receiptIdentitySha256 = createHash("sha256")
      .update(contentSha256, "utf8")
      .update("\0", "utf8")
      .update(retrievedAt, "utf8")
      .digest("hex");
    const receipt: EvidenceReceipt = {
      id: `EV-${receiptIdentitySha256.slice(0, 16).toUpperCase()}`,
      provider: "bright-data",
      sourceUrl: input.sourceUrl,
      retrievedAt,
      recordedAt: this.now().toISOString(),
      recallNumber: input.recallNumber.trim(),
      title: input.title.trim(),
      productName: input.productName.trim(),
      recallDate: input.recallDate.trim(),
      hazard: input.hazard.trim(),
      description: input.description.trim(),
      identifiers: {
        itemNumber: input.itemNumber.trim(),
        batchCode: input.batchCode.trim(),
      },
      contentSha256,
    };

    let result: RecordRecallEvidenceResult | undefined;
    const operation = this.writeQueue.then(async () => {
      const state = await this.read();
      const prior = state.evidenceReceipts.find((candidate) => candidate.id === receipt.id);
      if (prior !== undefined) {
        const comparablePrior = { ...prior, recordedAt: receipt.recordedAt };
        if (JSON.stringify(comparablePrior) !== JSON.stringify(receipt)) {
          throw new Error(`Evidence receipt ${receipt.id} already exists with different metadata.`);
        }
        result = { idempotentReplay: true, receipt: prior };
        return;
      }

      state.evidenceReceipts.push(receipt);
      await this.writeFile(state);
      result = { idempotentReplay: false, receipt };
    });

    this.writeQueue = operation.catch(() => undefined);
    await operation;
    if (result === undefined) throw new Error("Evidence recording completed without a receipt.");
    return clone(result);
  }

  public async applyContainmentPatch(
    input: ApplyContainmentPatchArguments,
  ): Promise<ApplyContainmentPatchResult> {
    let result: ApplyContainmentPatchResult | undefined;
    const operation = this.writeQueue.then(async () => {
      const state = await this.read();
      const priorReceipt = state.auditEvents.find((event) => event.patchId === input.patch_id);
      if (priorReceipt !== undefined) {
        if (!samePatchRequest(priorReceipt, input)) {
          throw new Error(`Patch ID ${input.patch_id} was already used with different arguments.`);
        }
        const listing = state.listings.find((candidate) => candidate.id === input.listing_id);
        const lease = state.leases.find((candidate) => candidate.id === input.lease_id);
        if (listing === undefined || lease === undefined) {
          throw new Error(`State disappeared after the original ${input.patch_id} mutation.`);
        }
        result = {
          idempotentReplay: true,
          receipt: priorReceipt,
          observedStateVersion: state.version,
          listing,
          lease,
        };
        return;
      }

      if (state.version !== input.expected_version) {
        throw new Error(
          `State version conflict: expected ${input.expected_version}, observed ${state.version}. Re-read and re-analyze; never auto-retry with changed arguments.`,
        );
      }
      if (!/^[a-f0-9]{64}$/i.test(input.analysis_sha256)) {
        throw new Error("analysis_sha256 must be a 64-character SHA-256 digest.");
      }

      const evidence = state.evidenceReceipts.find(
        (candidate) => candidate.id === input.evidence_receipt_id,
      );
      if (evidence === undefined) {
        throw new Error(`Evidence receipt ${input.evidence_receipt_id} does not exist.`);
      }
      this.assertEvidenceFresh(evidence.retrievedAt);

      const lease = state.leases.find((candidate) => candidate.id === input.lease_id);
      if (lease === undefined || lease.status !== "active") {
        throw new Error(`Truth Lease ${input.lease_id} is missing or inactive.`);
      }
      const analysis = analyzeRecall(evidence, lease, state, input.patch_id);
      const expected = analysis.proposedMutation;
      const normalizedInput = { ...input, analysis_sha256: input.analysis_sha256.toLowerCase() };
      if (JSON.stringify(expected) !== JSON.stringify(normalizedInput)) {
        throw new Error("Patch arguments do not match the evidence-bound deterministic analysis.");
      }

      const listing = state.listings.find((candidate) => candidate.id === input.listing_id);
      if (listing === undefined || !listing.published) {
        throw new Error(`Listing ${input.listing_id} is missing or already unpublished.`);
      }

      const appliedVersion = state.version + 1;
      const receipt: AuditEvent = {
        id: `AR-${randomUUID()}`,
        type: "containment_patch_applied",
        occurredAt: this.now().toISOString(),
        patchId: input.patch_id,
        leaseId: input.lease_id,
        listingId: input.listing_id,
        evidenceReceiptId: evidence.id,
        evidenceSha256: evidence.contentSha256,
        analysisSha256: input.analysis_sha256.toLowerCase(),
        reason: input.reason,
        expectedVersion: input.expected_version,
        appliedVersion,
        before: { listingPublished: true, leaseStatus: "active" },
        after: { listingPublished: false, leaseStatus: "revoked" },
      };

      listing.published = false;
      listing.lastPatchId = input.patch_id;
      lease.status = "revoked";
      state.version = appliedVersion;
      state.auditEvents.push(receipt);
      await this.writeFile(state);

      result = {
        idempotentReplay: false,
        receipt,
        observedStateVersion: state.version,
        listing: clone(listing),
        lease: clone(lease),
      };
    });

    this.writeQueue = operation.catch(() => undefined);
    await operation;
    if (result === undefined) throw new Error("The mutation completed without a receipt.");
    return result;
  }

  public async verifyContainment(patchId: string): Promise<ContainmentVerification> {
    const state = await this.read();
    const patchReceipts = state.auditEvents.filter((event) => event.patchId === patchId);
    const receipt = patchReceipts[0];
    const evidence = state.evidenceReceipts.find(
      (candidate) => candidate.id === receipt?.evidenceReceiptId,
    );
    const exact = state.listings.find((listing) => listing.id === receipt?.listingId);
    const lease = state.leases.find((candidate) => candidate.id === receipt?.leaseId);
    const exactMatches = evidence === undefined
      ? []
      : state.listings.filter(
          (listing) =>
            normalizedText(listing.itemNumber) === normalizedText(evidence.identifiers.itemNumber) &&
            normalizedText(listing.batchCode) === normalizedText(evidence.identifiers.batchCode),
        );
    const nearMatches = evidence === undefined
      ? []
      : state.listings.filter((listing) => {
          const itemMatches =
            normalizedText(listing.itemNumber) === normalizedText(evidence.identifiers.itemNumber);
          const batchMatches =
            normalizedText(listing.batchCode) === normalizedText(evidence.identifiers.batchCode);
          return itemMatches !== batchMatches;
        });

    const checks = [
      {
        name: "approved patch has exactly one durable audit receipt",
        passed: patchReceipts.length === 1,
        observed: patchReceipts.map((event) => event.id),
      },
      {
        name: "audit receipt is bound to persisted Bright Data evidence",
        passed:
          receipt !== undefined &&
          evidence !== undefined &&
          receipt.evidenceSha256 === evidence.contentSha256 &&
          receipt.analysisSha256.length === 64,
        observed: evidence === undefined
          ? null
          : { evidenceReceiptId: evidence.id, contentSha256: evidence.contentSha256 },
      },
      {
        name: "evidence identifies exactly one retailer listing",
        passed: exactMatches.length === 1 && exactMatches[0]?.id === receipt?.listingId,
        observed: exactMatches.map((listing) => listing.id),
      },
      {
        name: "exact recalled listing is unpublished",
        passed: exact?.published === false && exact.lastPatchId === patchId,
        observed: exact ?? null,
      },
      {
        name: "invalidated Truth Lease is revoked in the same patch",
        passed: lease?.status === "revoked" && receipt?.after.leaseStatus === "revoked",
        observed: lease ?? null,
      },
      {
        name: "all identifier near matches remain published",
        passed: nearMatches.length > 0 && nearMatches.every((listing) => listing.published),
        observed: nearMatches.map((listing) => ({ id: listing.id, published: listing.published })),
      },
      {
        name: "state version equals the atomic patch receipt",
        passed: receipt !== undefined && state.version === receipt.appliedVersion,
        observed: { stateVersion: state.version, appliedVersion: receipt?.appliedVersion ?? null },
      },
    ];
    const passed = checks.every((check) => check.passed);

    return {
      patchId,
      observedAt: this.now().toISOString(),
      stateVersion: state.version,
      passed,
      verdict: passed ? "VERIFIED" : "NOT VERIFIED",
      checks,
    };
  }

  private validateOfficialEvidence(input: RecordRecallEvidenceInput): void {
    let url: URL;
    try {
      url = new URL(input.sourceUrl);
    } catch {
      throw new Error("source_url must be a valid official CPSC URL.");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "www.cpsc.gov" ||
      !url.pathname.toLowerCase().startsWith("/recalls/")
    ) {
      throw new Error("Evidence source must be an HTTPS www.cpsc.gov/Recalls page.");
    }
    this.assertEvidenceFresh(input.retrievedAt);

    const requiredFields = [
      input.recallNumber,
      input.title,
      input.productName,
      input.recallDate,
      input.hazard,
      input.description,
      input.itemNumber,
      input.batchCode,
      input.evidenceText,
    ];
    if (requiredFields.some((value) => value.trim().length === 0)) {
      throw new Error("Official evidence fields and evidence_text must be non-empty.");
    }
    const normalizedEvidence = normalizedText(input.evidenceText);
    for (const [label, value] of [
      ["recall number", input.recallNumber],
      ["item number", input.itemNumber],
      ["batch code", input.batchCode],
    ] as const) {
      if (!normalizedEvidence.includes(normalizedText(value))) {
        throw new Error(`evidence_text does not contain the declared ${label}.`);
      }
    }
  }

  private assertEvidenceFresh(retrievedAt: string): void {
    const retrieved = Date.parse(retrievedAt);
    if (!Number.isFinite(retrieved)) throw new Error("retrieved_at must be a valid timestamp.");
    const age = this.now().getTime() - retrieved;
    if (age > MAX_EVIDENCE_AGE_MS) {
      throw new Error("Evidence is stale; fetch a fresh official CPSC page through Bright Data.");
    }
    if (age < -MAX_CLOCK_SKEW_MS) {
      throw new Error("retrieved_at is too far in the future.");
    }
  }

  private async readFile(path: string): Promise<RetailerState> {
    const state = JSON.parse(await readFile(path, "utf8")) as RetailerState;
    state.evidenceReceipts ??= [];
    return state;
  }

  private async writeFile(state: RetailerState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.statePath);
  }
}

export function publicState(state: RetailerState): {
  version: number;
  listings: Listing[];
  leases: TruthLease[];
  evidenceReceipts: EvidenceReceipt[];
  auditEvents: AuditEvent[];
} {
  return clone(state);
}
