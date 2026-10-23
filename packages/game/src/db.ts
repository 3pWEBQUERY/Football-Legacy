import pg from "pg";

const { Pool } = pg;
// bigint als Zahl zurückgeben (Geldbeträge bleiben weit unter 2^53)
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

declare global {
  // eslint-disable-next-line no-var
  var __flPool: pg.Pool | undefined;
}

export function pool(): pg.Pool {
  if (!globalThis.__flPool) {
    const url = process.env.DATABASE_URL ?? "postgres://fl:fl@localhost:5432/football_legacy";
    globalThis.__flPool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_SIZE ?? 10),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__flPool;
}

export type Db = pg.PoolClient | pg.Pool;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(db, text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Sperrt eine Karriere für die Dauer der Transaktion, damit parallele Klicks
 * (z. B. doppeltes "Weiter") nicht zweimal simulieren.
 */
export async function lockCareer(client: pg.PoolClient, careerId: string) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [careerId]);
}
