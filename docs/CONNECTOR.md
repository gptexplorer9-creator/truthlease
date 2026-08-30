# Outbound TrueForge operator connector

The connector is an outbound-only bridge. It reads genuine events from the
native TrueForge loopback API and appends authenticated batches to TruthLease.
It has no inbound listener and cannot approve, mutate, or bypass TrueForge
native approval or TruthLease MCP authority.

The server contract is `POST /api/connectors/:connectorId/events` with JSON:

```json
{
  "batchId": "...",
  "case": { "caseId": "...", "idempotencyKey": "...", "caseType": "...", "subject": {} },
  "run": { "runId": "...", "caseId": "...", "idempotencyKey": "...", "connectorId": "...", "trueForgeSessionId": "..." },
  "cursor": null,
  "events": [{ "id": "...", "genuine": true, "source": { "name": "trueforge", "sessionId": "...", "runId": "..." } }],
  "signature": "<HMAC-SHA256 hex>",
  "algorithm": "hmac-sha256",
  "sentAt": "..."
}
```

The server returns `{ accepted: true, cursor, idempotentReplay }`. An accepted
response is valid only when its cursor exactly identifies the final event sent.
The cursor is persisted only after that validation. The default runner writes
connector state to `TRUTHLEASE_CONNECTOR_STATE_PATH` (or
`.truthlease\connector-state/<connectorId>_<caseId>_<runId>.json` by default)
to avoid cursor and in-flight replay loss across process restarts.

Hosts should use a durable `ConnectorStateStore` and reserve the in-flight batch
ID before POST. The runner authenticates transport with a dedicated bearer
token and separately attests provenance with HMAC-SHA256 over the canonical
batch ID, case, run, cursor, genuine TrueForge source identity, complete event
content, and sent time. The hosted ledger rejects missing, changed, or
session-mismatched attestations before any write. Set
`TRUTHLEASE_CONNECTOR_ATTESTATION_SECRET` to a distinct secret of at least 32
UTF-8 bytes on both ends; an optional
`TRUTHLEASE_CONNECTOR_ATTESTATION_KEY_ID` supports explicit key selection.
The hosted `runId`, TrueForge session ID, and every event source run/session
must match exactly. The runner refuses to send bearer credentials over plain
HTTP except to an exact loopback host. Use HTTPS for every remote TruthLease
endpoint. Never reuse the bearer token as attestation material, and never log
credentials or event payloads.

Loopback source configuration and endpoint credentials are host-owned; the
connector itself adds no paid service or resource. Successful steady-state
polls use `CONNECTOR_POLL_INTERVAL_MS`; exponential retry backoff is used only
after retryable failures.
