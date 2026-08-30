import { createRequire } from "node:module";

import { ledgerMigrationStatements } from "../src/ledger/schema.js";

interface MigrationClient {
  query(text: string): Promise<unknown>;
  release(): void;
}

interface MigrationPool {
  connect(): Promise<MigrationClient>;
  end(): Promise<void>;
}

interface NeonDriverModule {
  Pool: new (options: { connectionString: string }) => MigrationPool;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required; never place it in source control.");
  }

  // Deliberately dynamic: the shared package manifest remains owned by the
  // integration lane. Run only after it adds @neondatabase/serverless.
  const require = createRequire(import.meta.url);
  let driver: NeonDriverModule;
  try {
    driver = require("@neondatabase/serverless") as NeonDriverModule;
  } catch {
    throw new Error("Missing @neondatabase/serverless. Install it before running this migration.");
  }

  const pool = new driver.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of ledgerMigrationStatements) await client.query(statement);
    await client.query("COMMIT");
    process.stdout.write("TruthLease ledger migration applied.\n");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
