import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { join, resolve } from "node:path";
import { z } from "zod";

import {
  verifyHmacSha256BatchAttestation,
  type ConnectorAttestationConfig,
  type GenuineTrueForgeEvent,
  type SignedBatchRequest,
} from "../connector/index.js";
import { publicState, RetailerStore } from "../infra/store.js";
import {
  authenticateConnectorIngestion,
  LedgerError,
  type AppendLedgerEventInput,
  type ConnectorAuthenticatorConfig,
  type CreateLedgerCaseInput,
  type LedgerJson,
  type StartLedgerRunInput,
  type TruthLeaseLedger,
} from "../ledger/index.js";
import { canonicalJson } from "../ledger/canonical.js";
import { buildCaseEventFeed, fetchTrueForgeEvents } from "../trueforge/case-feed.js";
import { RunNowError, type RunNowService } from "../trueforge/run-now.js";
import {
  CurrentTrueForgeSessionTrustGate,
  RejectingTrustGate,
  TrueForgeSessionTrustGate,
  type TruthLeaseMcpTrustGate,
} from "../trueforge/trust-gate.js";

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

export function createTruthLeaseMcpServer(
  store: RetailerStore,
  trustGate: TruthLeaseMcpTrustGate = new RejectingTrustGate(),
): McpServer {
  const server = new McpServer({ name: "truthlease", version: "0.1.0" });

  server.registerTool(
    "record_recall_evidence",
    {
      title: "Record Bright Data CPSC evidence",
      description:
        "Persist fresh official CPSC recall evidence only when the server can bind this exact request to the configured TrueForge session's canonical Bright Data trace. TruthLease computes the evidence SHA-256.",
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
        const input = {
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
        };
        const authorization = await trustGate.authorizeEvidence(input);
        try {
          const result = await store.recordRecallEvidence(input);
          authorization.commit();
          return jsonResult(result);
        } catch (error) {
          authorization.release();
          throw error;
        }
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
        const authorization = await trustGate.authorizeMutation(input);
        try {
          const result = await store.applyContainmentPatch(input);
          const enforcedVerification = await store.verifyContainment(input.patch_id);
          if (!enforcedVerification.passed) {
            throw new Error("The containment write did not pass its immediate persisted-state verification.");
          }
          authorization.commit();
          return jsonResult({ ...result, enforcedVerification });
        } catch (error) {
          authorization.release();
          throw error;
        }
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
  trustGate?: TruthLeaseMcpTrustGate;
  ledger?: TruthLeaseLedger;
  connectorAuth?: ConnectorAuthenticatorConfig;
  connectorAttestation?: ConnectorAttestationConfig;
  runNow?: RunNowService;
  operationalAllowedHosts?: readonly string[];
}

type RequestWithRawBody = Request & { rawBody?: string };

const SUPPORTED_EVENT_TYPES = new Set([
  "state.snapshot", "evidence.fetched", "evidence.failed", "analysis.completed", "analysis.failed",
  "approval.required", "approval.resolved", "patch.applied", "patch.failed",
  "verification.completed", "verification.failed",
]);
const LEDGER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CONNECTOR_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEDGER_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_CONNECTOR_EVENTS = 100;

interface ValidatedConnectorBatch {
  readonly caseInput: CreateLedgerCaseInput;
  readonly runInput: StartLedgerRunInput;
  readonly eventInputs: readonly AppendLedgerEventInput[];
  readonly signedRequest: SignedBatchRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new LedgerError("invalid_input", `${field} must be a non-empty string.`);
  }
  return value;
}

function ledgerIdentifier(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!LEDGER_IDENTIFIER.test(value)) {
    throw new LedgerError("invalid_input", `${field} must be 1-160 URL-safe identifier characters.`);
  }
  return value;
}

function connectorIdentifier(record: Record<string, unknown>): string {
  const value = requiredString(record, "connectorId");
  if (!CONNECTOR_IDENTIFIER.test(value)) {
    throw new LedgerError("invalid_input", "connectorId must be 1-128 URL-safe identifier characters.");
  }
  return value;
}

function idempotencyKey(record: Record<string, unknown>): string {
  const value = requiredString(record, "idempotencyKey");
  if (!LEDGER_IDEMPOTENCY_KEY.test(value)) {
    throw new LedgerError("invalid_input", "idempotencyKey must be 1-200 URL-safe identifier characters.");
  }
  return value;
}

function boundedLabel(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (value.length > 128) {
    throw new LedgerError("invalid_input", `${field} must be between 1 and 128 characters.`);
  }
  return value;
}

/** Validate and detach the complete batch before the first ledger mutation. */
function validateConnectorBatch(
  body: unknown,
  pathConnectorId: string,
): ValidatedConnectorBatch {
  if (!CONNECTOR_IDENTIFIER.test(pathConnectorId)) {
    throw new LedgerError("invalid_input", "connectorId must be 1-128 URL-safe identifier characters.");
  }
  if (!isRecord(body)) throw new LedgerError("invalid_input", "Connector batch must be a JSON object.");

  const rawCase = body.case;
  const rawRun = body.run;
  const rawEvents = body.events;
  if (!isRecord(rawCase) || !isRecord(rawRun) || !Array.isArray(rawEvents) || rawEvents.length === 0) {
    throw new LedgerError("invalid_input", "Connector batch requires case, run, and at least one event.");
  }
  if (rawEvents.length > MAX_CONNECTOR_EVENTS) {
    throw new LedgerError("invalid_input", `Connector batch cannot exceed ${MAX_CONNECTOR_EVENTS} events.`);
  }

  const batchId = ledgerIdentifier(body, "batchId");
  const signature = body.signature;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
  }
  if (body.algorithm !== "hmac-sha256") {
    throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
  }
  const keyId = body.keyId;
  if (keyId !== undefined && (typeof keyId !== "string" || keyId.length < 1 || keyId.length > 128)) {
    throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
  }
  const sentAt = requiredString(body, "sentAt");
  if (!Number.isFinite(Date.parse(sentAt))) {
    throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
  }
  let cursor: SignedBatchRequest["cursor"] = null;
  if (body.cursor !== null) {
    if (!isRecord(body.cursor)) {
      throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
    }
    const sequence = body.cursor.sequence;
    if (sequence !== undefined && (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1)) {
      throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
    }
    cursor = {
      eventId: ledgerIdentifier(body.cursor, "eventId"),
      ...(typeof sequence === "number" ? { sequence } : {}),
    };
  }

  const caseId = ledgerIdentifier(rawCase, "caseId");
  const runId = ledgerIdentifier(rawRun, "runId");
  const runCaseId = ledgerIdentifier(rawRun, "caseId");
  const runConnectorId = connectorIdentifier(rawRun);
  const trueForgeSessionId = ledgerIdentifier(rawRun, "trueForgeSessionId");
  if (runCaseId !== caseId) throw new LedgerError("invalid_input", "Run caseId must match the batch caseId.");
  if (runConnectorId !== pathConnectorId) throw new LedgerError("authentication_failed", "Connector identity mismatch.");
  if (runId !== trueForgeSessionId) {
    throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
  }

  const subject = rawCase.subject;
  if (!isRecord(subject)) throw new LedgerError("invalid_input", "Case subject must be a JSON object.");
  canonicalJson(subject);
  const caseInput: CreateLedgerCaseInput = {
    caseId,
    idempotencyKey: idempotencyKey(rawCase),
    caseType: boundedLabel(rawCase, "caseType"),
    subject: subject as LedgerJson,
  };
  const runInput: StartLedgerRunInput = {
    runId,
    caseId: runCaseId,
    idempotencyKey: idempotencyKey(rawRun),
    connectorId: runConnectorId,
  };

  let previousSequence: number | undefined;
  const signedEvents: GenuineTrueForgeEvent[] = [];
  const eventInputs = rawEvents.map((rawEvent, index): AppendLedgerEventInput => {
    if (!isRecord(rawEvent)) throw new LedgerError("invalid_input", "Every connector event must be a JSON object.");
    if (rawEvent.genuine !== true || !isRecord(rawEvent.source)) {
      throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
    }
    const eventType = boundedLabel(rawEvent, "type");
    if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
      throw new LedgerError("invalid_input", `Unsupported event type ${eventType}.`);
    }
    const eventId = ledgerIdentifier(rawEvent, "id");
    const sourceSessionId = ledgerIdentifier(rawEvent.source, "sessionId");
    const sourceRunId = ledgerIdentifier(rawEvent.source, "runId");
    if (
      rawEvent.source.name !== "trueforge"
      || sourceSessionId !== trueForgeSessionId
      || sourceRunId !== runId
    ) {
      throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
    }
    const sequence = rawEvent.sequence;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new LedgerError("invalid_input", "sequence must be a positive safe integer.");
    }
    if (previousSequence !== undefined && sequence !== previousSequence + 1) {
      throw new LedgerError("invalid_input", "Connector event sequences must be contiguous and ordered.");
    }
    previousSequence = sequence;
    const payload = rawEvent.payload;
    if (!isRecord(payload)) throw new LedgerError("invalid_input", "Every connector event payload must be a JSON object.");
    canonicalJson(payload);
    const occurredAt = requiredString(rawEvent, "occurredAt");
    if (!Number.isFinite(Date.parse(occurredAt))) {
      throw new LedgerError("invalid_input", "occurredAt must be a valid timestamp.");
    }
    const sourceVersion = rawEvent.source.version;
    const sourceLedger = rawEvent.source.ledger;
    if (
      (sourceVersion !== undefined && (typeof sourceVersion !== "string" || sourceVersion.length > 128))
      || (sourceLedger !== undefined && (typeof sourceLedger !== "string" || sourceLedger.length > 160))
    ) {
      throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
    }
    signedEvents.push({
      id: eventId,
      sequence,
      occurredAt,
      type: eventType,
      genuine: true,
      payload,
      source: {
        name: "trueforge",
        sessionId: sourceSessionId,
        runId: sourceRunId,
        ...(typeof sourceVersion === "string" ? { version: sourceVersion } : {}),
        ...(typeof sourceLedger === "string" ? { ledger: sourceLedger } : {}),
      },
    });
    return {
      eventId,
      caseId,
      runId,
      sequence,
      idempotencyKey: `event:${eventId}`,
      connectorId: pathConnectorId,
      eventType,
      payload: payload as LedgerJson,
      occurredAt,
    };
  });

  const signedRequest: SignedBatchRequest = {
    batchId,
    case: {
      caseId,
      idempotencyKey: caseInput.idempotencyKey,
      caseType: caseInput.caseType,
      subject,
    },
    run: {
      runId,
      caseId: runCaseId,
      idempotencyKey: runInput.idempotencyKey,
      connectorId: runConnectorId,
      trueForgeSessionId,
    },
    cursor,
    events: signedEvents,
    signature,
    algorithm: "hmac-sha256",
    ...(typeof keyId === "string" ? { keyId } : {}),
    sentAt,
  };
  return { caseInput, runInput, eventInputs, signedRequest };
}

function ledgerStatus(error: LedgerError): number {
  switch (error.code) {
    case "authentication_failed": return 401;
    case "not_found": return 404;
    case "conflict":
    case "sequence_conflict": return 409;
    case "invalid_input": return 400;
  }
}

function feedStatus(eventType: string | undefined): string {
  switch (eventType) {
    case "verification.completed": return "verified";
    case "verification.failed": return "verification_failed";
    case "patch.applied": return "patch_applied";
    case "patch.failed": return "mutation_failed";
    case "approval.required": return "approval_pending";
    case "approval.resolved": return "approval_resolved";
    case "analysis.completed": return "proof_complete";
    case "analysis.failed": return "analysis_failed";
    case "evidence.fetched": return "evidence_fetched";
    case "evidence.failed": return "evidence_failed";
    case "state.snapshot": return "case_open";
    default: return "awaiting_events";
  }
}

export function createApp(store: RetailerStore, options: AppOptions = {}) {
  const app = express();
  const projectRoot = resolve(options.projectRoot ?? process.env.TRUTHLEASE_PROJECT_ROOT ?? process.cwd());
  const trueForgeBaseUrl = options.trueForgeBaseUrl ?? process.env.TRUTHLEASE_TRUEFORGE_URL ?? "http://127.0.0.1:8790";
  const trueForgeSessionId = options.trueForgeSessionId ?? process.env.TRUTHLEASE_TRUEFORGE_SESSION_ID;
  const hostedReadOnly = options.hostedReadOnly ?? false;
  const operationalAllowedHosts = new Set(
    options.operationalAllowedHosts?.map((host) => host.toLowerCase()) ?? ["127.0.0.1", "localhost"],
  );
  const ledger = options.ledger;
  const runNow = options.runNow;
  const trustGate = options.trustGate ?? (
    runNow
      ? new CurrentTrueForgeSessionTrustGate(trueForgeBaseUrl, () => runNow.currentSessionId())
      : trueForgeSessionId === undefined || trueForgeSessionId.trim().length === 0
        ? new RejectingTrustGate()
        : new TrueForgeSessionTrustGate(trueForgeBaseUrl, trueForgeSessionId)
  );
  app.disable("x-powered-by");
  app.use(express.json({
    limit: "1mb",
    verify: (request, _response, buffer) => {
      (request as RequestWithRawBody).rawBody = buffer.toString("utf8");
    },
  }));
  app.use((request, response, next) => {
    response.set({
      "Content-Security-Policy": [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'self'",
        "font-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "img-src 'self' data:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
      ].join("; "),
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    const host = request.hostname.toLowerCase();
    if (!hostedReadOnly && !operationalAllowedHosts.has(host)) {
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
      mode: hostedReadOnly ? (ledger ? "hosted_ledger" : "hosted_read_only") : "local_operational",
      ledger: ledger ? "configured" : "unconfigured",
    });
  });

  app.get("/api/cases", async (request, response) => {
    if (!ledger) {
      response.status(503).json({ error: "The production case ledger is not configured." });
      return;
    }
    const rawLimit = request.query.limit;
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
    try {
      response.json(await ledger.listCases({ ...(limit === undefined ? {} : { limit }), ...(cursor ? { cursor } : {}) }));
    } catch (error) {
      if (error instanceof LedgerError) {
        response.status(ledgerStatus(error)).json({ error: error.message, code: error.code });
        return;
      }
      response.status(500).json({ error: "Failed to read the production case ledger." });
    }
  });

  app.get("/api/cases/:leaseId/events", async (request, response) => {
    const leaseId = request.params.leaseId;
    const rawAfter = request.query.after;
    const after = rawAfter === undefined ? undefined : Number(rawAfter);
    if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) {
      response.status(400).json({ error: "after must be a non-negative safe integer." });
      return;
    }

    if (ledger) {
      try {
        const detail = await ledger.readCase(leaseId);
        const run = detail.runs.at(-1);
        if (!run) {
          response.status(409).json({ error: `Case ${leaseId} has no operational run yet.` });
          return;
        }
        const allEvents = detail.events
          .filter((event) => event.runId === run.runId)
          .sort((left, right) => left.sequence - right.sequence);
        const events = allEvents
          .filter((event) => after === undefined || event.sequence > after)
          .map((event) => ({
            type: event.eventType,
            id: event.eventId,
            timestamp: event.occurredAt,
            runId: event.runId,
            sequence: event.sequence,
            payload: event.payload,
          }));
        response.json({
          caseId: detail.case.caseId,
          runId: run.runId,
          status: feedStatus(allEvents.at(-1)?.eventType),
          lastSequence: allEvents.at(-1)?.sequence ?? 0,
          events,
        });
      } catch (error) {
        if (error instanceof LedgerError) {
          response.status(ledgerStatus(error)).json({ error: error.message, code: error.code });
          return;
        }
        response.status(500).json({ error: "Failed to read the production case ledger." });
      }
      return;
    }
    if (leaseId !== "TL-042") {
      response.status(404).json({ error: `Unknown TruthLease case ${leaseId}.` });
      return;
    }
    if (hostedReadOnly) {
      response.status(503).json({
        error:
          "The hosted product is read-only. Run TruthLease locally with a genuine TrueForge session for operational events.",
      });
      return;
    }
    const activeTrueForgeSessionId = runNow?.currentSessionId() ?? trueForgeSessionId;
    if (activeTrueForgeSessionId === undefined || activeTrueForgeSessionId.trim().length === 0) {
      response.status(503).json({
        error: "No TrueForge session is bound to the case feed. The UI will not synthesize a run.",
      });
      return;
    }

    try {
      const events = await fetchTrueForgeEvents(trueForgeBaseUrl, activeTrueForgeSessionId);
      response.json(buildCaseEventFeed(leaseId, activeTrueForgeSessionId, events, after));
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "Failed to read TrueForge events.",
      });
    }
  });

  app.get("/api/run-now/status", async (_request, response) => {
    if (!runNow) {
      response.status(404).json({ enabled: false });
      return;
    }
    try {
      response.json(await runNow.status());
    } catch {
      response.status(503).json({
        enabled: true,
        ready: false,
        reason: "Run Now readiness could not be verified.",
        cooldownRemainingMs: 0,
      });
    }
  });

  app.post("/api/run-now", async (request, response) => {
    if (!runNow) {
      response.status(404).json({ enabled: false, error: "Run Now is not configured." });
      return;
    }
    if (
      !isRecord(request.body) ||
      Object.keys(request.body).some((key) => key !== "caseId") ||
      typeof request.body.caseId !== "string"
    ) {
      response.status(400).json({ error: "Run Now accepts only a caseId string." });
      return;
    }
    try {
      response.status(202).json(await runNow.start(request.body.caseId));
    } catch (error) {
      if (error instanceof RunNowError) {
        response.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      response.status(502).json({ error: "Run Now failed closed before a genuine session could start." });
    }
  });

  app.post("/api/connectors/:connectorId/events", async (request: RequestWithRawBody, response) => {
    if (!ledger || !options.connectorAuth || !options.connectorAttestation) {
      response.status(503).json({ error: "Authenticated and attested connector ingestion is not configured." });
      return;
    }
    try {
      const rawConnectorId = request.params.connectorId;
      if (typeof rawConnectorId !== "string" || rawConnectorId.trim() === "") {
        throw new LedgerError("invalid_input", "connectorId path parameter is required.");
      }
      const connectorId = rawConnectorId;
      if (!CONNECTOR_IDENTIFIER.test(connectorId)) {
        throw new LedgerError("invalid_input", "connectorId must be 1-128 URL-safe identifier characters.");
      }
      const authorization = request.header("authorization");
      const timestamp = request.header("x-truthlease-timestamp");
      const signature = request.header("x-truthlease-signature");
      const presented = authorization?.startsWith("Bearer ")
        ? { kind: "bearer" as const, token: authorization.slice("Bearer ".length) }
        : timestamp && signature
          ? { kind: "hmac-sha256" as const, timestamp, signature }
          : { kind: "bearer" as const, token: "" };
      const verified = authenticateConnectorIngestion(options.connectorAuth, connectorId, request.rawBody ?? "", presented);
      const batch = validateConnectorBatch(request.body, connectorId);
      const attestationCredential = options.connectorAttestation.connectors[connectorId];
      if (
        attestationCredential === undefined
        || !verifyHmacSha256BatchAttestation(batch.signedRequest, attestationCredential)
      ) {
        throw new LedgerError("authentication_failed", "Connector provenance attestation failed.");
      }
      const result = await ledger.ingestAuthenticatedBatch(verified, batch);
      const finalEvent = result.events.at(-1);
      const cursor = finalEvent ? { eventId: finalEvent.eventId, sequence: finalEvent.sequence } : null;
      response.status(result.idempotentReplay ? 200 : 202).json({
        accepted: true,
        cursor,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (error) {
      if (error instanceof LedgerError) {
        response.status(ledgerStatus(error)).json({ error: error.message, code: error.code });
        return;
      }
      response.status(500).json({ error: "Connector ingestion failed closed." });
    }
  });

  app.post("/mcp", async (request: Request, response: Response) => {
    if (hostedReadOnly) {
      response.status(503).json({
        error: "The MCP and retailer mutation surface are disabled in the hosted product.",
      });
      return;
    }
    const server = createTruthLeaseMcpServer(store, trustGate);
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
      await transport.handleRequest(
        request as unknown as Parameters<typeof transport.handleRequest>[0],
        response as unknown as Parameters<typeof transport.handleRequest>[1],
        request.body,
      );
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
      response.status(503).json({ error: "The MCP surface is disabled in the hosted product." });
      return;
    }
    response.status(405).set("Allow", "POST").json({ error: "Use POST for stateless MCP." });
  });
  app.delete("/mcp", (_request, response) => {
    if (hostedReadOnly) {
      response.status(503).json({ error: "The MCP surface is disabled in the hosted product." });
      return;
    }
    response.status(405).set("Allow", "POST").json({ error: "Use POST for stateless MCP." });
  });

  app.use("/ui", express.static(join(projectRoot, "dist", "src", "ui"), { index: false }));
  app.use(express.static(join(projectRoot, "public"), { index: "index.html" }));

  return app;
}
