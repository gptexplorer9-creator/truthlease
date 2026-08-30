import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FileConnectorStateStore, LoopbackTrueForgeEventSource, OperatorConnector, ServerContractIngestionClient } from '../src/connector/index.js';

const baseUrl = process.env.TRUTHLEASE_BASE_URL;
const connectorId = process.env.TRUTHLEASE_CONNECTOR_ID ?? 'local-trueforge';
const caseId = process.env.TRUTHLEASE_CASE_ID;
const runId = process.env.TRUTHLEASE_RUN_ID;
const sessionId = process.env.TRUTHLEASE_TRUEFORGE_SESSION_ID;
const ingestionToken = process.env.TRUTHLEASE_INGESTION_TOKEN ?? process.env.TRUTHLEASE_CONNECTOR_TOKEN;
if (!baseUrl || !caseId || !runId || !sessionId || !ingestionToken) {
  throw new Error('TRUTHLEASE_BASE_URL, TRUTHLEASE_CASE_ID, TRUTHLEASE_RUN_ID, TRUTHLEASE_TRUEFORGE_SESSION_ID, and a connector token are required');
}

function sanitizeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

const statePath = process.env.TRUTHLEASE_CONNECTOR_STATE_PATH
  ?? join(process.cwd(), '.truthlease', 'connector-state', `${sanitizeSegment(connectorId)}_${sanitizeSegment(caseId)}_${sanitizeSegment(runId)}.json`);
await mkdir(dirname(statePath), { recursive: true });

const connector = new OperatorConnector(
  new LoopbackTrueForgeEventSource({
    baseUrl: process.env.TRUEFORGE_LOOPBACK_URL ?? 'http://127.0.0.1:8790',
    sessionId,
    caseId,
  }),
  new ServerContractIngestionClient({ baseUrl, connectorId, authorization: `Bearer ${ingestionToken}` }),
  // Compatibility fields only. Authentication is the bearer header over TLS (or loopback HTTP).
  { algorithm: 'none', sign: () => '' },
  new FileConnectorStateStore({ path: statePath }),
  { caseId, caseType: process.env.TRUTHLEASE_CASE_TYPE ?? 'trueforge.operator', subject: { leaseId: caseId, source: 'trueforge_native' }, runId, connectorId },
  { batchSize: Number(process.env.CONNECTOR_BATCH_SIZE ?? 100), pollIntervalMs: Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? 5000), retryBaseMs: 500, retryMaxMs: 30_000, retryJitter: 0.2 },
);

let stopping = false;
const stop = () => { stopping = true; connector.stop(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
console.log('TruthLease outbound connector started');
while (!stopping) {
  try { const result = await connector.syncOnce(); if (result.sent) console.log(`Appended ${result.sent} event(s)`); }
  catch { /* health is available through the host connector instance; do not log secrets or payloads */ }
  await new Promise((resolve) => setTimeout(resolve, connector.nextDelayMs()));
}
