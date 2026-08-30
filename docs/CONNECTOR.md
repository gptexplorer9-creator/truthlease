# Outbound TrueForge operator connector

The connector is an outbound-only bridge. It reads genuine events from the
native TrueForge loopback API and appends authenticated batches to TruthLease.
It has no inbound listener and cannot approve, mutate, or bypass TrueForge
native approval or TruthLease MCP authority.

The server contract is `POST /api/connectors/:connectorId/events` with JSON:

```json
{
  "case": { "caseId": "...", "idempotencyKey": "...", "caseType": "...", "subject": {} },
  "run": { "runId": "...", "caseId": "...", "idempotencyKey": "...", "connectorId": "..." },
  "events": [], "signature": "", "algorithm": "none", "sentAt": "..."
}
```

The server returns `{ accepted: true, cursor, idempotentReplay }`. An accepted
response is valid only when its cursor exactly identifies the final event sent.
The cursor is persisted only after that validation. The default runner writes
connector state to `TRUTHLEASE_CONNECTOR_STATE_PATH` (or
`.truthlease\connector-state/<connectorId>_<caseId>_<runId>.json` by default)
to avoid cursor and in-flight replay loss across process restarts.

Hosts should use a durable `ConnectorStateStore` and reserve the in-flight batch
ID before POST. The body-level `signature` and `algorithm` properties remain
only for wire compatibility; they are not an authentication or cryptographic
verification boundary. The runner authenticates with a dedicated bearer token
and refuses to send that credential over plain HTTP except to an exact loopback
host. Use HTTPS for every remote TruthLease endpoint. Never reuse the bearer
token as signing material, and never log credentials or event payloads.

Loopback source configuration and endpoint credentials are host-owned; the
connector itself adds no paid service or resource. Successful steady-state
polls use `CONNECTOR_POLL_INTERVAL_MS`; exponential retry backoff is used only
after retryable failures.
