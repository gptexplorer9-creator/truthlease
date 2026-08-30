import { describe, expect, it } from "vitest";

import { ledgerMigrationStatements } from "../src/ledger/index.js";

describe("ledger migration", () => {
  it("creates append-only entities and enforces per-run sequence and idempotency uniqueness", () => {
    const sql = ledgerMigrationStatements.join("\n");
    expect(sql).toContain("truthlease_ledger_cases");
    expect(sql).toContain("truthlease_ledger_runs");
    expect(sql).toContain("truthlease_ledger_events");
    expect(sql).toContain("UNIQUE (run_id, sequence)");
    expect(sql).toContain("UNIQUE (run_id, idempotency_key)");
    expect(sql).not.toMatch(/\bDELETE FROM\b|\bUPDATE truthlease_ledger_events\b/i);
  });
});
