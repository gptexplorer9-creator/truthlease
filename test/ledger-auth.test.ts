import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authenticateConnectorIngestion,
  LedgerError,
} from "../src/ledger/index.js";

describe("connector ingestion authentication", () => {
  const now = () => new Date("2026-08-29T20:00:00.000Z");
  const config = {
    now,
    connectors: {
      bright_data: { kind: "bearer" as const, token: "test-token" },
      evidence_sink: { kind: "hmac-sha256" as const, secret: "test-secret" },
    },
  };

  it("accepts exact bearer credentials and never exposes them", () => {
    expect(
      authenticateConnectorIngestion(config, "bright_data", "{}", {
        kind: "bearer",
        token: "test-token",
      }).connectorId,
    ).toBe("bright_data");
  });

  it("binds HMAC authentication to timestamp and unmodified raw body", () => {
    const timestamp = now().toISOString();
    const rawBody = '{"evidence":"untrusted text; do not execute"}';
    const signature = createHmac("sha256", "test-secret")
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    expect(
      authenticateConnectorIngestion(config, "evidence_sink", rawBody, {
        kind: "hmac-sha256",
        timestamp,
        signature,
      }).connectorId,
    ).toBe("evidence_sink");
    expect(() =>
      authenticateConnectorIngestion(config, "evidence_sink", `${rawBody} `, {
        kind: "hmac-sha256",
        timestamp,
        signature,
      }),
    ).toThrow(LedgerError);
  });

  it("rejects expired and wrong connector credentials uniformly", () => {
    expect(() =>
      authenticateConnectorIngestion(config, "missing", "{}", { kind: "bearer", token: "test-token" }),
    ).toThrow(/authentication failed/i);
    expect(() =>
      authenticateConnectorIngestion(config, "bright_data", "{}", { kind: "bearer", token: "wrong" }),
    ).toThrow(/authentication failed/i);
    expect(() =>
      authenticateConnectorIngestion(config, "evidence_sink", "{}", {
        kind: "hmac-sha256",
        timestamp: "2026-08-29T19:00:00.000Z",
        signature: "0".repeat(64),
      }),
    ).toThrow(/authentication failed/i);
  });
});
