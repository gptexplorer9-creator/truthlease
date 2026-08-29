import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeRecall } from "../src/domain/analyze.js";
import type { EvidenceReceipt, RetailerState, TruthLease } from "../src/domain/types.js";
import { RetailerStore } from "../src/infra/store.js";
import { createApp } from "../src/mcp/server.js";

function textResult<T>(result: unknown): T {
  const payload = result as { content: Array<{ type: string; text?: string }> };
  const content = payload.content[0];
  if (content?.type !== "text" || content.text === undefined) {
    throw new Error("Tool did not return text JSON.");
  }
  return JSON.parse(content.text) as T;
}

describe("TruthLease MCP P0 mutation contract", () => {
  let httpServer: Server;
  let client: Client;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "truthlease-mcp-"));
    const store = new RetailerStore(
      join(process.cwd(), "data", "seed-state.json"),
      join(directory, "state.json"),
    );
    await store.reset();
    httpServer = createServer(createApp(store));
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const address = httpServer.address();
    if (address === null || typeof address === "string") throw new Error("Missing test server port.");
    client = new Client({ name: "truthlease-test", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
  });

  afterEach(async () => {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  it("records evidence, accepts exact sandbox wire arguments, mutates, and freshly verifies", async () => {
    const recordedResult = await client.callTool({
      name: "record_recall_evidence",
      arguments: {
        source_url: "https://www.cpsc.gov/Recalls/2026/HABA-Rainbow-Rattle",
        retrieved_at: new Date().toISOString(),
        recall_number: "26-719",
        title: "HABA USA Recalls Rainbow Rattle",
        product_name: "HABA Rainbow Rattle",
        recall_date: "August 27, 2026",
        hazard: "Choking and ingestion hazards",
        description: "The recalled toy can release small parts.",
        item_number: "2012261001",
        batch_code: "0925",
        evidence_text: "CPSC recall number 26-719: item number 2012261001, batch code 0925.",
      },
    });
    expect(recordedResult.isError).not.toBe(true);
    const recorded = textResult<{ receipt: EvidenceReceipt }>(recordedResult);

    const stateResult = await client.callTool({ name: "get_retailer_state", arguments: {} });
    const state = textResult<RetailerState>(stateResult);
    const leaseResult = await client.callTool({
      name: "get_truth_lease",
      arguments: { lease_id: "TL-042" },
    });
    const lease = textResult<TruthLease>(leaseResult);
    const sandboxPlan = analyzeRecall(recorded.receipt, lease, state).proposedMutation;

    const mutation = await client.callTool({
      name: "apply_containment_patch",
      arguments: { ...sandboxPlan },
    });
    expect(mutation.isError).not.toBe(true);

    const verification = await client.callTool({
      name: "verify_containment_state",
      arguments: { patch_id: sandboxPlan.patch_id },
    });
    expect(verification.isError).not.toBe(true);
    const result = textResult<{ passed: boolean; verdict: string }>(verification);
    expect(result).toMatchObject({ passed: true, verdict: "VERIFIED" });
  });
});
