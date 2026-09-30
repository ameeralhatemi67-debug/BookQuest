import type { Metadata } from "next";
import { BooksView, type LibraryEntry } from "@/components/books/books-view";
import { EmptyState } from "@/components/ui/misc";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { BookRow } from "@/lib/types";

export const metadata: Metadata = { title: "My books" };

export default async function BooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAlpha();
  const params = await searchParams;
  const supabase = await createSupabaseServer();

  const { data: books, error } = await supabase
    .from("books")
    .select("id, uploader_id, title, author, format, status, storage_path, cover_path, original_filename, mime_type, size_bytes, sha256, page_count, has_locations, metadata, error, created_at")
    .eq("uploader_id", me.user_id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  if (error) {
    return <EmptyState title="We couldn't load your books">Check your connection and refresh the page.</EmptyState>;
  }

  // Which of the tester's rooms read each book (rooms are visible through RLS only if they are a member).
  const ids = (books ?? []).map((book) => book.id);
  const roomsByBook = new Map<string, { id: string; name: string }[]>();
  if (ids.length > 0) {
    const [{ data: rooms }, { data: memberships }] = await Promise.all([
      supabase.from("rooms").select("id, name, book_id, archived_at").in("book_id", ids),
      supabase.from("room_members").select("room_id").eq("user_id", me.user_id).eq("status", "active"),
    ]);
    const mine = new Set((memberships ?? []).map((m) => m.room_id));
    for (const room of rooms ?? []) {
      if (!mine.has(room.id) || room.archived_at) continue;
      const list = roomsByBook.get(room.book_id) ?? [];
      list.push({ id: room.id, name: room.name });
      roomsByBook.set(room.book_id, list);
    }
  }

  const entries: LibraryEntry[] = ((books ?? []) as BookRow[]).map((book) => ({ ...book, rooms: roomsByBook.get(book.id) ?? [] }));
  return <BooksView userId={me.user_id} books={entries} autoUpload={params.upload === "1"} />;
}
