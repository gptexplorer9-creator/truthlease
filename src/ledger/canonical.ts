import { createHash } from "node:crypto";

import { LedgerError, type LedgerJson } from "./types.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 32;
const MAX_CANONICAL_BYTES = 128 * 1024;

function validate(value: unknown, depth: number): asserts value is LedgerJson {
  if (depth > MAX_DEPTH) {
    throw new LedgerError("invalid_input", "Ledger JSON exceeds the maximum nesting depth.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LedgerError("invalid_input", "Ledger JSON cannot contain non-finite numbers.");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => validate(item, depth + 1));
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new LedgerError("invalid_input", "Ledger payload must contain plain JSON values only.");
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new LedgerError("invalid_input", `Ledger payload contains a reserved key: ${key}.`);
    }
    validate(child, depth + 1);
  }
}

function sortJson(value: LedgerJson): LedgerJson {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  validate(value, 0);
  const serialized = JSON.stringify(sortJson(value));
  if (Buffer.byteLength(serialized, "utf8") > MAX_CANONICAL_BYTES) {
    throw new LedgerError("invalid_input", "Ledger JSON exceeds the 128 KiB limit.");
  }
  return serialized;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseLedgerJson(value: unknown): LedgerJson {
  if (typeof value === "string") return JSON.parse(value) as LedgerJson;
  // Re-serializing rejects prototypes and gives callers a detached value.
  return JSON.parse(canonicalJson(value)) as LedgerJson;
}
