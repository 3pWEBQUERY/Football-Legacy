import { pool } from "./db";
import { MIGRATIONS } from "./migrations";

/** Führt alle noch nicht angewendeten SQL-Migrationen in Reihenfolge aus. */
export async function migrate(log: (msg: string) => void = () => {}): Promise<string[]> {
  const db = pool();
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  await db.query("select pg_advisory_lock(424242)");
  try {
    const applied = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    const done: string[] = [];
    for (const m of MIGRATIONS) {
      if (applied.has(m.name)) continue;
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query(m.sql);
        await client.query("insert into schema_migrations(name) values ($1)", [m.name]);
        await client.query("commit");
        log(`Migration ${m.name} angewendet`);
        done.push(m.name);
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    }
    return done;
  } finally {
    await db.query("select pg_advisory_unlock(424242)");
  }
}
