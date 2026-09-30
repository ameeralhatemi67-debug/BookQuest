// Storage authorization. These run the real policies from
// supabase/migrations/…_storage.sql against storage.objects, which is exactly
// what Supabase Storage consults before serving, signing or accepting a file.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denied, World, type TestBook, type TestUser } from "./helpers";

describe("private storage", () => {
  let w: World;
  let amir: TestUser;
  let sara: TestUser;
  let outsider: TestUser;
  let book: TestBook;

  beforeAll(async () => {
    w = await World.create();
    amir = await w.signUp("Amir");
    sara = await w.signUp("Sara");
    outsider = await w.signUp("Outsider");
    book = await w.makeBook(amir, { size: 4096 });
  });
  afterAll(() => w.close());

  it("creates every bucket private, except avatars, with type and size limits", async () => {
    const buckets = await w.owner<{ id: string; public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id",
    );
    expect(buckets.map((b) => b.id)).toEqual(["annotation-audio", "annotation-images", "annotation-video", "avatars", "books", "covers", "soundtracks"]);
    for (const bucket of buckets) {
      expect(bucket.public).toBe(bucket.id === "avatars");
      expect(Number(bucket.file_size_limit)).toBeGreaterThan(0);
      expect(bucket.allowed_mime_types.length).toBeGreaterThan(0);
      // Nothing executable is ever accepted.
      expect(bucket.allowed_mime_types.join(" ")).not.toMatch(/javascript|html|x-msdownload|x-sh|octet-stream/);
    }
    const byId = Object.fromEntries(buckets.map((b) => [b.id, Number(b.file_size_limit)]));
    expect(byId).toMatchObject({
      books: 500 * 1024 * 1024,
      "annotation-images": 25 * 1024 * 1024,
      "annotation-audio": 100 * 1024 * 1024,
      "annotation-video": 500 * 1024 * 1024,
      avatars: 10 * 1024 * 1024,
    });
  });

  describe("books", () => {
    it("records the size Storage reports, not what the browser claims", async () => {
      const [row] = await w.owner<{ size_bytes: string; status: string; mime_type: string }>(
        "select size_bytes, status, mime_type from public.books where id = $1", [book.id]);
      expect(Number(row.size_bytes)).toBe(4096);
      expect(row.mime_type).toBe("application/epub+zip");
      // size_bytes is not writable from the client at all.
      await denied(w.update(amir, "books", { id: `eq.${book.id}` }, { size_bytes: 1 }), /permission denied/);
    });

    it("refuses to finalize an upload that never reached Storage", async () => {
      const ghost = await w.insert<{ id: string }>(amir, "books", { uploader_id: amir.id, title: "Ghost", format: "pdf" });
      await denied(w.rpc(amir, "finalize_book_upload", { p_book_id: ghost.id }), "upload_missing");
      await w.update(amir, "books", { id: `eq.${ghost.id}` }, { storage_path: `${amir.id}/${ghost.id}/book.pdf` });
      await denied(w.rpc(amir, "finalize_book_upload", { p_book_id: ghost.id }), "upload_missing");
      await denied(w.rpc(sara, "finalize_book_upload", { p_book_id: book.id }), "book_not_found");
    });

    it("rejects an EPUB over 250 MB even though the bucket allows 500 MB for PDFs", async () => {
      const big = await w.insert<{ id: string }>(amir, "books", { uploader_id: amir.id, title: "Huge", format: "epub" });
      const path = `${amir.id}/${big.id}/book.epub`;
      await w.update(amir, "books", { id: `eq.${big.id}` }, { storage_path: path });
      await w.putObject(amir, "books", path, 300 * 1024 * 1024, "application/epub+zip");
      await denied(w.rpc(amir, "finalize_book_upload", { p_book_id: big.id }), "file_too_large");
    });

    it("lets people upload only into their own folder, for their own book", async () => {
      await denied(w.putObject(sara, "books", `${amir.id}/${book.id}/evil.pdf`), /row-level security/);
      await denied(w.putObject(sara, "books", `${sara.id}/${book.id}/evil.pdf`), /row-level security/);
      await denied(w.putObject(sara, "books", `${sara.id}/${crypto.randomUUID()}/book.pdf`), /row-level security/);
      await denied(w.putObject(null, "books", `${amir.id}/${book.id}/anon.pdf`), /row-level security|permission denied/);
    });

    it("is unreadable to anyone who is not reading it — even with the exact path", async () => {
      expect(await w.canReadObject(amir, "books", book.path)).toBe(true);
      expect(await w.canReadObject(sara, "books", book.path)).toBe(false);
      expect(await w.canReadObject(outsider, "books", book.path)).toBe(false);
      expect(await w.canReadObject(null, "books", book.path)).toBe(false);
      // And the row itself is invisible.
      expect(await w.rows(sara, "books", { id: `eq.${book.id}` })).toEqual([]);
    });

    it("becomes readable on joining a room that reads it, and stops on leaving", async () => {
      const room = await w.makeRoom(amir, book, { p_visibility: "unlisted" });
      const [{ join_code }] = await w.owner<{ join_code: string }>("select join_code from public.rooms where id = $1", [room]);
      await w.rpc(sara, "join_with_token", { p_token: join_code });
      expect(await w.canReadObject(sara, "books", book.path)).toBe(true);
      expect(await w.rows(sara, "books", { id: `eq.${book.id}` })).toHaveLength(1);
      expect(await w.canReadObject(outsider, "books", book.path)).toBe(false);

      await w.rpc(sara, "leave_room", { p_room_id: room });
      expect(await w.canReadObject(sara, "books", book.path)).toBe(false);
    });

    it("shows an open room's cover — but never its file — to non-members", async () => {
      const coverPath = `${amir.id}/${book.id}/cover.jpg`;
      await w.putObject(amir, "covers", coverPath, 900, "image/jpeg");
      expect(await w.canReadObject(outsider, "covers", coverPath)).toBe(false);

      const open = await w.makeRoom(amir, book, { p_visibility: "open" });
      expect(await w.canReadObject(outsider, "covers", coverPath)).toBe(true);
      expect(await w.rows(outsider, "books", { id: `eq.${book.id}` })).toHaveLength(1);
      expect(await w.canReadObject(outsider, "books", book.path)).toBe(false);
      expect(await w.canReadObject(null, "covers", coverPath)).toBe(false);

      await w.rpc(amir, "set_room_archived", { p_room_id: open, p_archived: true });
      expect(await w.canReadObject(outsider, "covers", coverPath)).toBe(false);
    });

    it("lets one book back several rooms without duplicating the file", async () => {
      const [{ n }] = await w.owner<{ n: number }>("select count(*)::int as n from public.rooms where book_id = $1", [book.id]);
      expect(n).toBeGreaterThan(1);
      const [{ objects }] = await w.owner<{ objects: number }>(
        "select count(*)::int as objects from storage.objects where bucket_id = 'books' and name = $1", [book.path]);
      expect(objects).toBe(1);
    });

    it("detects the same file uploaded twice by the same person", async () => {
      const sha = "a".repeat(64);
      await w.update(amir, "books", { id: `eq.${book.id}` }, { sha256: sha });
      await denied(
        w.insert(amir, "books", { uploader_id: amir.id, title: "Same again", format: "epub", sha256: sha }),
        /duplicate key/,
      );
      // A different person uploading the same bytes is allowed (and learns nothing about Amir's copy).
      await expect(w.insert(sara, "books", { uploader_id: sara.id, title: "Mine", format: "epub", sha256: sha })).resolves.toBeTruthy();
    });

    it("won't delete a book other people are still reading; afterwards nobody can read it", async () => {
      const room = await w.makeRoom(amir, book, { p_visibility: "open" });
      await w.rpc(sara, "join_open_room", { p_room_id: room });
      await denied(w.rpc(amir, "delete_book", { p_book_id: book.id }), "book_in_use");
      await denied(w.rpc(sara, "delete_book", { p_book_id: book.id }), "book_not_found");

      await w.rpc(sara, "leave_room", { p_room_id: room });
      await w.rpc(amir, "delete_book", { p_book_id: book.id });
      await w.rpc(sara, "join_open_room", { p_room_id: room });
      expect(await w.canReadObject(sara, "books", book.path)).toBe(false);
      // The uploader can still clean the object up.
      expect(await w.canReadObject(amir, "books", book.path)).toBe(true);
    });
  });

  describe("avatars", () => {
    it("lets people write only inside their own folder", async () => {
      await w.putObject(sara, "avatars", `${sara.id}/me.png`, 100, "image/png");
      await denied(w.putObject(sara, "avatars", `${amir.id}/me.png`, 100, "image/png"), /row-level security/);
      await denied(w.putObject(null, "avatars", `${amir.id}/me.png`, 100, "image/png"), /row-level security|permission denied/);
    });
  });

  describe("admin", () => {
    it("can disable a broken book for everyone without reading anyone's notes", async () => {
      const admin = await w.signUp("Admin", { code: null, email: "admin@local.test" });
      const other = await w.makeBook(amir, { title: "Broken" });
      const room = await w.makeRoom(amir, other);
      const note = await w.note(amir, room, 0.5, "private thought");

      await denied(w.rpc(sara, "admin_set_book_disabled", { p_book_id: other.id, p_disabled: true }), "admin_required");
      await w.rpc(admin, "admin_set_book_disabled", { p_book_id: other.id, p_disabled: true });
      expect(await w.canReadObject(amir, "books", other.path)).toBe(true); // uploader may still clean up
      const [{ readable }] = await w.owner<{ readable: boolean }>(
        "select status not in ('deleted', 'disabled') as readable from public.books where id = $1", [other.id]);
      expect(readable).toBe(false);
      // The uploader cannot simply flip it back.
      await denied(w.update(amir, "books", { id: `eq.${other.id}` }, { status: "ready" }), "book_status_locked");

      // Admin sees room + marker metadata, never the note's content or its media.
      const rooms = await w.rpc<{ id: string }[]>(admin, "admin_list_rooms");
      expect(rooms.map((r) => r.id)).toContain(room);
      const markers = await w.rpc<Record<string, unknown>[]>(admin, "admin_list_markers", { p_room_id: room });
      expect(markers).toHaveLength(1);
      expect(JSON.stringify(markers)).not.toContain("private thought");
      expect(await w.rows(admin, "annotation_contents", { marker_id: `eq.${note}` })).toEqual([]);

      await w.rpc(admin, "admin_remove_annotation", { p_marker_id: note, p_reason: "broken test content" });
      expect(await w.rows(amir, "annotation_contents", { marker_id: `eq.${note}` })).toEqual([]);

      const overview = await w.rpc<{ testers: { total: number }; storage: Record<string, { bytes: number }> }>(admin, "admin_overview");
      expect(overview.testers.total).toBe(4);
      expect(overview.storage.books.bytes).toBeGreaterThan(0);
    });

    it("collects feedback privately: testers see their own, admins see all", async () => {
      const admin = (await w.owner<{ id: string }>("select id from auth.users where email = 'admin@local.test'"))[0];
      const adminUser: TestUser = { id: admin.id, name: "Admin", email: "admin@local.test", claims: { sub: admin.id, role: "authenticated" } };
      await w.insert(sara, "alpha_feedback", { user_id: sara.id, category: "love", message: "The unlock moment is great", context: { viewport: "390x844" } });
      await denied(w.insert(sara, "alpha_feedback", { user_id: amir.id, category: "bug", message: "as someone else" }), /row-level security/);
      await denied(w.insert(sara, "alpha_feedback", { user_id: sara.id, category: "rant", message: "bad category" }), /check constraint/);

      expect(await w.rows(sara, "alpha_feedback")).toHaveLength(1);
      expect(await w.rows(amir, "alpha_feedback")).toEqual([]);
      expect(await w.rows(adminUser, "alpha_feedback")).toHaveLength(1);
      // Only an admin can triage.
      expect(await w.update(amir, "alpha_feedback", { category: "eq.love" }, { status: "done" })).toEqual([]);
      expect(await w.update(adminUser, "alpha_feedback", { category: "eq.love" }, { status: "seen" })).toHaveLength(1);
    });
  });
});
