import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { join, resolve } from "node:path";
import { z } from "zod";

import { publicState, RetailerStore } from "../infra/store.js";
import { buildCaseEventFeed, fetchTrueForgeEvents } from "../trueforge/case-feed.js";

function jsonResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: value },
  };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : "Unknown TruthLease tool error.",
      },
    ],
  };
}

export function createTruthLeaseMcpServer(store: RetailerStore): McpServer {
  const server = new McpServer({ name: "truthlease", version: "0.1.0" });

  server.registerTool(
    "record_recall_evidence",
    {
      title: "Record Bright Data CPSC evidence",
      description:
        "Validate and persist a fresh official CPSC recall page retrieved through the Bright Data MCP. TruthLease computes the evidence SHA-256; this tool does not fetch the web.",
      inputSchema: {
        source_url: z.string().url(),
        retrieved_at: z.string().datetime({ offset: true }),
        recall_number: z.string().min(1),
        title: z.string().min(1),
        product_name: z.string().min(1),
        recall_date: z.string().min(1),
        hazard: z.string().min(1),
        description: z.string().min(1),
        item_number: z.string().min(1),
        batch_code: z.string().min(1),
        evidence_text: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      source_url,
      retrieved_at,
      recall_number,
      title,
      product_name,
      recall_date,
      hazard,
      description,
      item_number,
      batch_code,
      evidence_text,
    }) => {
      try {
        return jsonResult(
          await store.recordRecallEvidence({
            sourceUrl: source_url,
            retrievedAt: retrieved_at,
            recallNumber: recall_number,
            title,
            productName: product_name,
            recallDate: recall_date,
            hazard,
            description,
            itemNumber: item_number,
            batchCode: batch_code,
            evidenceText: evidence_text,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_truth_lease",
    {
      title: "Get Truth Lease",
      description: "Read one prior decision lease and its downstream listing dependencies.",
      inputSchema: { lease_id: z.string().min(1).default("TL-042") },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ lease_id }) => {
      try {
        return jsonResult(await store.getLease(lease_id));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_retailer_state",
    {
      title: "Get retailer state",
      description: "Read current synthetic retailer listings, leases, state version, and audit receipts.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => jsonResult(publicState(await store.read())),
  );

  server.registerTool(
    "apply_containment_patch",
    {
      title: "Apply exact recall containment patch",
      description:
        "Atomically revoke one invalidated Truth Lease and unpublish its exact dependent listing. This operational mutation must pause in TrueForge for native human approval.",
      inputSchema: {
        listing_id: z.string().min(1),
        lease_id: z.string().min(1),
        patch_id: z.string().min(1),
        expected_version: z.number().int().nonnegative(),
        evidence_receipt_id: z.string().min(1),
        analysis_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        reason: z.string().min(20),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return jsonResult(await store.applyContainmentPatch(input));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "verify_containment_state",
    {
      title: "Verify containment state",
      description:
        "Freshly re-read persisted retailer state after an approved mutation and verify the exact listing, revoked lease, near matches, evidence, and receipt invariants.",
      inputSchema: { patch_id: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ patch_id }) => jsonResult(await store.verifyContainment(patch_id)),
  );

  return server;
}

export interface AppOptions {
  projectRoot?: string;
  trueForgeBaseUrl?: string;
  trueForgeSessionId?: string;
  hostedReadOnly?: boolean;
}

export function createApp(store: RetailerStore, options: AppOptions = {}) {
  const app = express();
  const projectRoot = resolve(options.projectRoot ?? process.env.TRUTHLEASE_PROJECT_ROOT ?? process.cwd());
  const trueForgeBaseUrl = options.trueForgeBaseUrl ?? process.env.TRUTHLEASE_TRUEFORGE_URL ?? "http://127.0.0.1:8790";
  const trueForgeSessionId = options.trueForgeSessionId ?? process.env.TRUTHLEASE_TRUEFORGE_SESSION_ID;
  const hostedReadOnly = options.hostedReadOnly ?? false;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((request, response, next) => {
    const host = request.hostname.toLowerCase();
    if (!hostedReadOnly && host !== "127.0.0.1" && host !== "localhost") {
      response.status(403).json({ error: "Host is not allow-listed." });
      return;
    }
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.json({
      status: "ok",
      service: "truthlease",
      version: "0.1.0",
      mode: hostedReadOnly ? "hosted_read_only" : "local_operational",
    });
  });

  app.get("/api/cases/:leaseId/events", async (request, response) => {
    const leaseId = request.params.leaseId;
    if (leaseId !== "TL-042") {
      response.status(404).json({ error: `Unknown TruthLease case ${leaseId}.` });
      return;
    }
    if (hostedReadOnly) {
      response.status(503).json({
        error:
          "Hosted preview is read-only. Run TruthLease locally with a genuine TrueForge session for operational events.",
      });
      return;
    }
    if (trueForgeSessionId === undefined || trueForgeSessionId.trim().length === 0) {
      response.status(503).json({
        error: "No TrueForge session is bound to the case feed. The UI will not synthesize a run.",
      });
      return;
    }
    const rawAfter = request.query.after;
    const after = rawAfter === undefined ? undefined : Number(rawAfter);
    if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) {
      response.status(400).json({ error: "after must be a non-negative safe integer." });
      return;
    }
    try {
      const events = await fetchTrueForgeEvents(trueForgeBaseUrl, trueForgeSessionId);
      response.json(buildCaseEventFeed(leaseId, trueForgeSessionId, events, after));
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "Failed to read TrueForge events.",
      });
    }
  });

  app.post("/mcp", async (request: Request, response: Response) => {
    if (hostedReadOnly) {
      response.status(503).json({
        error: "The MCP and retailer mutation surface are disabled in the hosted preview.",
      });
      return;
    }
    const server = createTruthLeaseMcpServer(store);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({
          error: error instanceof Error ? error.message : "MCP request failed.",
        });
      }
    }
  });

  app.get("/mcp", (_request, response) => {
    if (hostedReadOnly) {
      response.status(503).json({ error: "The MCP surface is disabled in the hosted preview." });
      return;
    }
    response.status(405).set("Allow", "POST").json({ error: "Use POST for stateless MCP." });
  });
  app.delete("/mcp", (_request, response) => {
    if (hostedReadOnly) {
      response.status(503).json({ error: "The MCP surface is disabled in the hosted preview." });
      return;
    }
    response.status(405).set("Allow", "POST").json({ error: "Use POST for stateless MCP." });
  });

  app.use("/ui", express.static(join(projectRoot, "dist", "src", "ui"), { index: false }));
  app.use(express.static(join(projectRoot, "public"), { index: "index.html" }));

  return app;
}
