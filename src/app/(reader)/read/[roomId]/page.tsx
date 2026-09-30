import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReaderBook } from "@/components/reader/reader-app";
import { ReaderLoader } from "@/components/reader/reader-loader";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { RoomDetail } from "@/lib/types";

export const metadata: Metadata = { title: "Reading" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReadPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  await requireAlpha(`/read/${roomId}`);
  if (!UUID.test(roomId)) redirect("/home");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("room_detail", { p_room_id: roomId });
  // Not a member (or no such room): the room page explains what is possible from here.
  if (error || !data || !(data as RoomDetail).is_member) redirect(`/rooms/${roomId}`);
  const room = data as RoomDetail;

  const { data: book } = await supabase
    .from("books")
    .select("id, title, author, format, status, storage_path, size_bytes, has_locations, page_count, uploader_id")
    .eq("id", room.book.id)
    .maybeSingle();

  // A deleted / disabled book is still shown in the reader shell, with an explanation.
  const readerBook: ReaderBook = (book as ReaderBook | null) ?? {
    id: room.book.id,
    title: room.book.title,
    author: room.book.author,
    format: room.book.format,
    status: room.book.status === "ready" ? "deleted" : room.book.status,
    storage_path: null,
    size_bytes: null,
    has_locations: false,
    page_count: room.book.page_count,
    uploader_id: room.book.uploader_id ?? "",
  };

  return <ReaderLoader room={room} book={readerBook} />;
}
