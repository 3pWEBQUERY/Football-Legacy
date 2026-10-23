import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db";

function migrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations"),
    path.resolve(process.cwd(), "packages/game/migrations"),
    path.resolve(process.cwd(), "../../packages/game/migrations"),
  ].filter(Boolean) as string[];
  const found = candidates.find((d) => fs.existsSync(d));
  if (!found) throw new Error("Migrationsverzeichnis nicht gefunden");
  return found;
}

/** Führt alle noch nicht angewendeten SQL-Migrationen in Reihenfolge aus. */
export async function migrate(log: (msg: string) => void = () => {}): Promise<string[]> {
  const db = pool();
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  await db.query("select pg_advisory_lock(424242)");
  try {
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    const done: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations(name) values ($1)", [file]);
        await client.query("commit");
        log(`Migration ${file} angewendet`);
        done.push(file);
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
