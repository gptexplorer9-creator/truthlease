import { describe, expect, it } from "vitest";

import { ledgerMigrationStatements } from "../src/ledger/index.js";

describe("ledger migration", () => {
  it("creates append-only entities and enforces per-run sequence and idempotency uniqueness", () => {
    const sql = ledgerMigrationStatements.join("\n");
    expect(sql).toContain("truthlease_ledger_cases");
    expect(sql).toContain("truthlease_ledger_runs");
    expect(sql).toContain("truthlease_ledger_events");
    expect(sql).toContain("UNIQUE (run_id, sequence)");
    expect(sql).toContain("SET occurred_at = received_at WHERE occurred_at IS NULL");
    expect(sql).not.toContain("occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(sql).toContain("UNIQUE (run_id, idempotency_key)");
    const compatibilityBackfill =
      "UPDATE truthlease_ledger_events SET occurred_at = received_at WHERE occurred_at IS NULL";
    const remainingSql = sql.replace(compatibilityBackfill, "");
    expect(remainingSql).not.toContain("DELETE FROM");
    expect(remainingSql).not.toContain("UPDATE truthlease_ledger_events");
  });
});
