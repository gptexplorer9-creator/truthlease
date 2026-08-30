import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createHmacSha256BatchSigner,
  FileConnectorStateStore,
  LoopbackTrueForgeEventSource,
  OperatorConnector,
  ServerContractIngestionClient,
} from '../src/connector/index.js';

const baseUrl = process.env.TRUTHLEASE_BASE_URL;
const connectorId = process.env.TRUTHLEASE_CONNECTOR_ID ?? 'local-trueforge';
const runOnce = process.env.CONNECTOR_RUN_ONCE === 'true';
const caseId = process.env.TRUTHLEASE_CASE_ID;
const runId = process.env.TRUTHLEASE_RUN_ID;
const sessionId = process.env.TRUTHLEASE_TRUEFORGE_SESSION_ID;
const ingestionToken = process.env.TRUTHLEASE_INGESTION_TOKEN ?? process.env.TRUTHLEASE_CONNECTOR_TOKEN;
const attestationSecret = process.env.TRUTHLEASE_CONNECTOR_ATTESTATION_SECRET;
const attestationKeyId = process.env.TRUTHLEASE_CONNECTOR_ATTESTATION_KEY_ID;
if (!baseUrl || !caseId || !runId || !sessionId || !ingestionToken || !attestationSecret) {
  throw new Error('TruthLease URL, case/run/session identity, transport token, and attestation secret are required');
}
if (runId !== sessionId) {
  throw new Error('TRUTHLEASE_RUN_ID must exactly match TRUTHLEASE_TRUEFORGE_SESSION_ID');
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
  createHmacSha256BatchSigner(attestationSecret, attestationKeyId),
  new FileConnectorStateStore({ path: statePath }),
  {
    caseId,
    caseType: process.env.TRUTHLEASE_CASE_TYPE ?? 'trueforge.operator',
    subject: { leaseId: caseId, source: 'trueforge_native' },
    runId,
    connectorId,
    trueForgeSessionId: sessionId,
  },
  { batchSize: Number(process.env.CONNECTOR_BATCH_SIZE ?? 100), pollIntervalMs: Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? 5000), retryBaseMs: 500, retryMaxMs: 30_000, retryJitter: 0.2 },
);

let stopping = false;
const stop = () => { stopping = true; connector.stop(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
console.log('TruthLease outbound connector started');
while (!stopping) {
  try {
    const result = await connector.syncOnce();
    if (result.sent) console.log(`Appended ${result.sent} event(s)`);
    if (runOnce) break;
  }
  catch (error) {
    if (runOnce) throw error;
    /* health is available through the host connector instance; do not log secrets or payloads */
  }
  await new Promise((resolve) => setTimeout(resolve, connector.nextDelayMs()));
}
