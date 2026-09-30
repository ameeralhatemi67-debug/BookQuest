import { BookPlus } from "lucide-react";
import type { Metadata } from "next";
import { NewRoomForm } from "@/components/room/new-room";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { BookSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Open a room" };

export default async function NewRoomPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAlpha();
  const params = await searchParams;
  const supabase = await createSupabaseServer();

  const { data } = await supabase
    .from("books")
    .select("id, title, author, format, cover_path, status, page_count, uploader_id")
    .eq("uploader_id", me.user_id)
    .eq("status", "ready")
    .order("created_at", { ascending: false });
  const books = (data ?? []) as BookSummary[];

  if (books.length === 0) {
    return (
      <EmptyState
        className="mx-auto max-w-xl"
        icon={<BookPlus className="size-5" aria-hidden />}
        title="First, add a book"
        action={<ButtonLink href="/books?upload=1">Add a book</ButtonLink>}
      >
        A room needs a book to gather around. Upload an EPUB or PDF and come right back.
      </EmptyState>
    );
  }

  return <NewRoomForm books={books} initialBookId={typeof params.book === "string" ? params.book : undefined} />;
}
