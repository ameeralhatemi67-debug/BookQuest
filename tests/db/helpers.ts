// Test harness for database-layer tests.
//
// Every test file boots a fresh in-memory Postgres (PGlite), applies the
// Supabase compatibility layer + the real migrations, and then talks to it the
// way the Data API does: as the `authenticated` (or `anon`) role with the
// caller's JWT claims set, so RLS and function grants are genuinely enforced.
import { expect } from "vitest";
import { createDb, type Claims, type EmuDb } from "../../dev/emulator/db";
import { callRpc, tableRequest } from "../../dev/emulator/rest";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  claims: Claims;
}

export interface TestBook {
  id: string;
  path: string;
}

export class World {
  private constructor(public db: EmuDb) {}

  static async create(): Promise<World> {
    return new World(await createDb({ seed: true }));
  }

  close() {
    return this.db.close();
  }

  /** Creates an auth user the way GoTrue would; our trigger builds the profile + alpha record. */
  async signUp(name: string, options: { code?: string | null; email?: string } = {}): Promise<TestUser> {
    const email = options.email ?? `${name.toLowerCase()}@test.local`;
    const code = options.code === undefined ? "LOCAL-ALPHA" : options.code;
    const meta = { display_name: name, ...(code ? { alpha_code: code } : {}) };
    const res = await this.db.pg.query<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2::text::jsonb, now()) returning id",
      [email, JSON.stringify(meta)],
    );
    const id = res.rows[0].id;
    return { id, name, email, claims: { sub: id, role: "authenticated", email } };
  }

  rpc<T = unknown>(user: TestUser | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.db.asUser(user?.claims ?? null, (tx) => callRpc(tx, fn, args)) as Promise<T>;
  }

  /** SELECT through the emulated Data API (RLS applies). `filters` use PostgREST syntax, e.g. { room_id: "eq.…" }. */
  async rows<T = Record<string, unknown>>(user: TestUser | null, table: string, filters: Record<string, string> = {}): Promise<T[]> {
    const result = await this.db.asUser(user?.claims ?? null, (tx) =>
      tableRequest(tx, { method: "GET", table, query: new URLSearchParams(filters) }),
    );
    return result.rows as T[];
  }

  async insert<T = Record<string, unknown>>(user: TestUser | null, table: string, record: Record<string, unknown>): Promise<T> {
    const result = await this.db.asUser(user?.claims ?? null, (tx) =>
      tableRequest(tx, { method: "POST", table, query: new URLSearchParams(), body: record, prefer: "return=representation" }),
    );
    return (result.rows as T[])[0];
  }

  async update(user: TestUser | null, table: string, filters: Record<string, string>, patch: Record<string, unknown>) {
    const result = await this.db.asUser(user?.claims ?? null, (tx) =>
      tableRequest(tx, { method: "PATCH", table, query: new URLSearchParams(filters), body: patch, prefer: "return=representation" }),
    );
    return result.rows as Record<string, unknown>[];
  }

  async remove(user: TestUser | null, table: string, filters: Record<string, string>) {
    const result = await this.db.asUser(user?.claims ?? null, (tx) =>
      tableRequest(tx, { method: "DELETE", table, query: new URLSearchParams(filters), prefer: "return=representation" }),
    );
    return result.rows as Record<string, unknown>[];
  }

  /** Raw SQL as the database owner (test setup / inspection only). */
  async owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.pg.query<T>(sql, params)).rows;
  }

  // ------------------------------------------------------------ storage
  /** Attempts to create a Storage object as `user`; the INSERT policy decides. */
  async putObject(user: TestUser | null, bucket: string, name: string, size = 1024, mimetype = "application/octet-stream") {
    await this.db.asUser(user?.claims ?? null, (tx) =>
      tx.query(
        "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::text::uuid, $3, $4::text::jsonb)",
        [bucket, name, user?.id ?? null, JSON.stringify({ size, mimetype })],
      ),
    );
  }

  /** Can `user` read (download / sign a URL for) this object? The SELECT policy decides. */
  async canReadObject(user: TestUser | null, bucket: string, name: string): Promise<boolean> {
    const rows = await this.db.asUser(user?.claims ?? null, async (tx) => {
      const res = await tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]);
      return res.rows;
    });
    return rows.length === 1;
  }

  // ------------------------------------------------------------ fixtures
  /** Walks a book through the real upload state machine until it is `ready`. */
  async makeBook(user: TestUser, options: { title?: string; format?: "epub" | "pdf"; size?: number } = {}): Promise<TestBook> {
    const format = options.format ?? "epub";
    const book = await this.insert<{ id: string }>(user, "books", {
      uploader_id: user.id,
      title: options.title ?? "Test Book",
      author: "An Author",
      format,
    });
    const path = `${user.id}/${book.id}/book.${format}`;
    await this.update(user, "books", { id: `eq.${book.id}` }, { storage_path: path });
    await this.putObject(user, "books", path, options.size ?? 2048, format === "epub" ? "application/epub+zip" : "application/pdf");
    await this.rpc(user, "finalize_book_upload", { p_book_id: book.id });
    await this.update(user, "books", { id: `eq.${book.id}` }, { status: "ready" });
    return { id: book.id, path };
  }

  async makeRoom(owner: TestUser, book: TestBook, settings: Record<string, unknown> = {}): Promise<string> {
    return this.rpc<string>(owner, "create_room", { p_name: "A Room", p_book_id: book.id, ...settings });
  }

  /** Owner mints an invitation and `user` joins with it. */
  async inviteAndJoin(owner: TestUser, roomId: string, user: TestUser) {
    const invite = await this.rpc<{ token: string }>(owner, "create_invite", { p_room_id: roomId });
    return this.rpc<{ status: string }>(user, "join_with_token", { p_token: invite.token });
  }

  read(user: TestUser, roomId: string, position: number, extra: Record<string, unknown> = {}) {
    return this.rpc<{ furthest: number; unlocked: string[]; completed: boolean; first: boolean }>(user, "save_progress", {
      p_room_id: roomId,
      p_position: position,
      p_anchor: { type: "epub", cfi: `epubcfi(/6/${Math.round(position * 100)})` },
      p_label: `${Math.round(position * 100)}%`,
      ...extra,
    });
  }

  note(user: TestUser, roomId: string, position: number, body: string, extra: Record<string, unknown> = {}) {
    return this.rpc<string>(user, "create_annotation", {
      p_room_id: roomId,
      p_position: position,
      p_anchor: { type: "epub", cfi: `epubcfi(/6/${Math.round(position * 100)}!/4/2)` },
      p_location_label: `Chapter ${Math.ceil(position * 10)}`,
      p_body: body,
      ...extra,
    });
  }
}

/** Asserts that a database call is rejected with a message matching `pattern`. */
export async function denied(promise: Promise<unknown>, pattern: string | RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}
