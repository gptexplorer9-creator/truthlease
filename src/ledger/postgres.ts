import type { LedgerDatabase, SqlQueryResult, SqlRow, SqlTransaction } from "./types.js";

export interface PostgresClient {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  release(): void;
}

export interface PostgresPool {
  connect(): Promise<PostgresClient>;
}

/** Adapts a transaction-capable Neon Pool (or pg Pool) to the ledger boundary. */
export function createPostgresLedgerDatabase(pool: PostgresPool): LedgerDatabase {
  return {
    async query<Row extends SqlRow = SqlRow>(text: string, values: readonly unknown[] = []) {
      const client = await pool.connect();
      try {
        return await client.query<Row>(text, values);
      } finally {
        client.release();
      }
    },
    async transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const transaction: SqlTransaction = {
          query: (text, values = []) => client.query(text, values),
        };
        const result = await operation(transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the originating database failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
