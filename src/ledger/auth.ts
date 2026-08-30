import { createHmac, timingSafeEqual } from "node:crypto";

import { LedgerError } from "./types.js";

const verifiedConnectorBrand = Symbol("truthlease.verifiedConnector");

export type ConnectorCredentials =
  | { readonly kind: "bearer"; readonly token: string }
  | { readonly kind: "hmac-sha256"; readonly secret: string };

export type PresentedConnectorAuth =
  | { readonly kind: "bearer"; readonly token: string }
  | { readonly kind: "hmac-sha256"; readonly timestamp: string; readonly signature: string };

export interface ConnectorAuthenticatorConfig {
  readonly connectors: Readonly<Record<string, ConnectorCredentials>>;
  /** Defaults to five minutes.  Set explicitly in tests when using historical fixtures. */
  readonly maxClockSkewMs?: number;
  readonly now?: () => Date;
}

export interface VerifiedConnector {
  readonly connectorId: string;
  readonly [verifiedConnectorBrand]: true;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Verifies caller-supplied credentials before anything is written.  HMAC signs
 * `${timestamp}.${rawBody}` so the body that was authenticated can be retained
 * as inert evidence without ever being fetched or interpreted by the ledger.
 */
export function authenticateConnectorIngestion(
  config: ConnectorAuthenticatorConfig,
  connectorId: string,
  rawBody: string,
  presented: PresentedConnectorAuth,
): VerifiedConnector {
  const expected = config.connectors[connectorId];
  if (expected === undefined || expected.kind !== presented.kind) {
    throw new LedgerError("authentication_failed", "Connector authentication failed.");
  }

  if (expected.kind === "bearer" && presented.kind === "bearer") {
    if (!safeEqual(expected.token, presented.token)) {
      throw new LedgerError("authentication_failed", "Connector authentication failed.");
    }
  }

  if (expected.kind === "hmac-sha256" && presented.kind === "hmac-sha256") {
    const timestamp = Date.parse(presented.timestamp);
    const maxClockSkewMs = config.maxClockSkewMs ?? 5 * 60_000;
    if (!Number.isFinite(timestamp) || Math.abs((config.now?.() ?? new Date()).getTime() - timestamp) > maxClockSkewMs) {
      throw new LedgerError("authentication_failed", "Connector authentication failed.");
    }
    const expectedSignature = createHmac("sha256", expected.secret)
      .update(`${presented.timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    if (!safeEqual(expectedSignature, presented.signature.toLowerCase())) {
      throw new LedgerError("authentication_failed", "Connector authentication failed.");
    }
  }

  return { connectorId, [verifiedConnectorBrand]: true };
}

export function isVerifiedConnector(value: unknown, connectorId: string): value is VerifiedConnector {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<VerifiedConnector>).connectorId === connectorId &&
    (value as Partial<VerifiedConnector>)[verifiedConnectorBrand] === true
  );
}
