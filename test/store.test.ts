import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeRecall } from "../src/domain/analyze.js";
import type { RecordRecallEvidenceInput, RetailerState } from "../src/domain/types.js";
import { RetailerStore } from "../src/infra/store.js";

const NOW = new Date("2026-08-29T20:00:00.000Z");
const evidenceInput: RecordRecallEvidenceInput = {
  sourceUrl:
    "https://www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle-Grasping-and-Teething-Toys-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-and-Ingestion-Hazards",
  retrievedAt: "2026-08-29T19:55:00.000Z",
  recallNumber: "26-719",
  title: "HABA USA Recalls Rainbow Rattle",
  productName: "HABA Rainbow Rattle",
  recallDate: "August 27, 2026",
  hazard: "Choking and ingestion hazards",
  description: "The recalled toy can release small parts.",
  itemNumber: "2012261001",
  batchCode: "0925",
  evidenceText:
    "Official CPSC recall number 26-719. HABA Rainbow Rattle item number 2012261001, batch code 0925.",
};

async function testStore(path?: string): Promise<RetailerStore> {
  const directory = await mkdtemp(join(tmpdir(), "truthlease-store-"));
  return new RetailerStore(
    join(process.cwd(), "data", "seed-state.json"),
    path ?? join(directory, "state.json"),
    () => new Date(NOW),
  );
}

async function prepare(store: RetailerStore) {
  await store.reset();
  const recorded = await store.recordRecallEvidence(evidenceInput);
  const state = await store.read();
  const lease = state.leases[0];
  if (lease === undefined) throw new Error("Missing seed lease.");
  const request = analyzeRecall(recorded.receipt, lease, state).proposedMutation;
  return { recorded, request };
}

describe("RetailerStore", () => {
  it("persists a server-hashed evidence receipt without changing the operational version", async () => {
    const store = await testStore();
    await store.reset();
    const result = await store.recordRecallEvidence(evidenceInput);
    const state = await store.read();

    expect(result.receipt.provider).toBe("bright-data");
    expect(result.receipt.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(state.version).toBe(7);
    expect(state.evidenceReceipts).toHaveLength(1);
  });

  it("atomically revokes the lease, unpublishes one listing, and verifies near matches", async () => {
    const store = await testStore();
    const { request } = await prepare(store);
    const result = await store.applyContainmentPatch(request);
    const verification = await store.verifyContainment(request.patch_id);

    expect(result.idempotentReplay).toBe(false);
    expect(result.listing.published).toBe(false);
    expect(result.lease.status).toBe("revoked");
    expect(verification.verdict).toBe("VERIFIED");
    expect(verification.passed).toBe(true);
  });

  it("returns the original receipt for an exact idempotent retry", async () => {
    const store = await testStore();
    const { request } = await prepare(store);
    const first = await store.applyContainmentPatch(request);
    const second = await store.applyContainmentPatch(request);

    expect(second.idempotentReplay).toBe(true);
    expect(second.receipt.id).toBe(first.receipt.id);
  });

  it("rejects patch ID reuse with changed arguments", async () => {
    const store = await testStore();
    const { request } = await prepare(store);
    await store.applyContainmentPatch(request);

    await expect(
      store.applyContainmentPatch({ ...request, reason: `${request.reason} changed` }),
    ).rejects.toThrow(/different arguments/i);
  });

  it("rejects a stale version and an invented analysis digest", async () => {
    const store = await testStore();
    const { request } = await prepare(store);
    await expect(
      store.applyContainmentPatch({ ...request, expected_version: 6 }),
    ).rejects.toThrow(/version conflict/i);
    await expect(
      store.applyContainmentPatch({ ...request, analysis_sha256: "f".repeat(64) }),
    ).rejects.toThrow(/evidence-bound deterministic analysis/i);
  });

  it("rejects stale, non-CPSC, and internally inconsistent evidence", async () => {
    const store = await testStore();
    await store.reset();
    await expect(
      store.recordRecallEvidence({ ...evidenceInput, sourceUrl: "https://example.com/Recalls/fake" }),
    ).rejects.toThrow(/cpsc/i);
    await expect(
      store.recordRecallEvidence({ ...evidenceInput, retrievedAt: "2026-08-29T18:00:00.000Z" }),
    ).rejects.toThrow(/stale/i);
    await expect(
      store.recordRecallEvidence({ ...evidenceInput, batchCode: "9999" }),
    ).rejects.toThrow(/batch code/i);
  });

  it("writes valid JSON atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "truthlease-json-"));
    const path = join(directory, "state.json");
    const store = await testStore(path);
    const { request } = await prepare(store);
    await store.applyContainmentPatch(request);
    const state = JSON.parse(await readFile(path, "utf8")) as RetailerState;
    expect(state.version).toBe(8);
    expect(state.leases[0]?.status).toBe("revoked");
  });
});
