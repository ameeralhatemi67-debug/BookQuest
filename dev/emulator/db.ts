// PGlite (real Postgres, compiled to WASM) loaded with the Supabase
// compatibility layer and this project's real migrations.
//
// Used by:
//   * the local emulator (`npm run dev:local`)  — persistent data directory
//   * the database test-suite (`npm run test:db`) — fresh in-memory database
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, "..", "..");
const migrationsDir = join(projectRoot, "supabase", "migrations");

export interface Claims {
  sub: string;
  role: "authenticated";
  email?: string;
  [key: string]: unknown;
}

export type Queryable = Pick<Transaction, "query" | "exec">;

export interface EmuDb {
  pg: PGlite;
  /** Runs `fn` in a transaction as the given user (or as `anon` when null), with RLS enforced. */
  asUser<T>(claims: Claims | null, fn: (tx: Transaction) => Promise<T>, settings?: Record<string, string>): Promise<T>;
  /** Runs `fn` in a transaction as the database owner (bypasses RLS). */
  asOwner<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Directory for a persistent database. Omit for an in-memory database. */
  dataDir?: string;
  /** Apply supabase/seed.sql on first boot. */
  seed?: boolean;
  /** Install change-feed triggers on published tables (needed for emulated Realtime). */
  changeFeed?: boolean;
  log?: (message: string) => void;
}

export async function createDb(options: CreateDbOptions = {}): Promise<EmuDb> {
  const log = options.log ?? (() => {});
  if (options.dataDir) await mkdir(options.dataDir, { recursive: true });
  const pg = options.dataDir ? await PGlite.create(options.dataDir) : await PGlite.create();

  const booted = await pg.query<{ exists: boolean }>(
    "select exists (select 1 from pg_namespace where nspname = 'emu') as exists",
  );
  const firstBoot = !booted.rows[0].exists;
  if (firstBoot) {
    await pg.exec(await readFile(join(here, "compat.sql"), "utf8"));
    log("applied Supabase compatibility layer");
  }

  const applied = new Set(
    (await pg.query<{ name: string }>("select name from emu.schema_migrations")).rows.map((r) => r.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    try {
      await pg.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query("insert into emu.schema_migrations (name) values ($1)", [file]);
      });
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
    log(`applied migration ${file}`);
  }

  if (firstBoot && options.seed) {
    await pg.exec(await readFile(join(projectRoot, "supabase", "seed.sql"), "utf8"));
    log("applied seed.sql");
  }

  if (options.changeFeed) {
    await installChangeFeed(pg);
  }

  const db: EmuDb = {
    pg,
    asUser(claims, fn, settings = {}) {
      return pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true), set_config('role', $2, true)", [
          JSON.stringify(claims ?? { role: "anon" }),
          claims ? "authenticated" : "anon",
        ]);
        for (const [key, value] of Object.entries(settings)) {
          await tx.query("select set_config($1, $2, true)", [key, value]);
        }
        return fn(tx);
      }) as Promise<never>;
    },
    asOwner(fn) {
      return pg.transaction(fn) as Promise<never>;
    },
    close: () => pg.close(),
  };
  return db;
}

/** Creates an AFTER trigger on every table in the supabase_realtime publication. */
async function installChangeFeed(pg: PGlite) {
  const tables = await pg.query<{ tablename: string; pk: string[] }>(`
    select t.tablename,
           array(
             select a.attname::text
             from pg_index i
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
             where i.indrelid = format('public.%I', t.tablename)::regclass and i.indisprimary
           ) as pk
    from pg_publication_tables t
    where t.pubname = 'supabase_realtime' and t.schemaname = 'public'
  `);
  for (const { tablename, pk } of tables.rows) {
    const args = pk.map((c) => `'${c}'`).join(", ");
    await pg.exec(`
      drop trigger if exists emu_change_feed on public."${tablename}";
      create trigger emu_change_feed after insert or update or delete on public."${tablename}"
        for each row execute function emu.notify_change(${args});
    `);
  }
}

/** Shape of a Postgres error as thrown by PGlite. */
export interface PgError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
}
