"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BookCover } from "@/components/book-cover";
import { parseMemberLimit, RoomSettingsFields, type RoomSettings } from "@/components/room/room-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import type { BookSummary } from "@/lib/types";

export function NewRoomForm({ books, initialBookId }: { books: BookSummary[]; initialBookId?: string }) {
  const router = useRouter();
  const initial = books.find((book) => book.id === initialBookId) ?? books[0];
  const [bookId, setBookId] = useState(initial.id);
  const [touchedName, setTouchedName] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>({ name: initial.title.slice(0, 80), description: "", mode: "chill", visibility: "private", memberLimit: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseBook = (book: BookSummary) => {
    setBookId(book.id);
    // Keep suggesting the book's title as the room name until the person types their own.
    if (!touchedName) setSettings((s) => ({ ...s, name: book.title.slice(0, 80) }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await getSupabase().rpc("create_room", {
      p_name: settings.name.trim(),
      p_book_id: bookId,
      p_description: settings.description.trim() || null,
      p_visibility: settings.visibility,
      p_mode: settings.mode,
      p_member_limit: settings.mode === "duo" ? 2 : parseMemberLimit(settings.memberLimit),
    });
    if (rpcError) {
      setError(friendlyError(rpcError));
      setBusy(false);
      return;
    }
    router.push(`/rooms/${data as string}?welcome=1`);
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link href="/home" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Link>
        <h1 className="mt-3 text-4xl text-ink">Open a room</h1>
        <p className="mt-2 text-ink-soft">A room is one book and the people reading it with you.</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Which book?</legend>
        <div role="radiogroup" aria-label="Book" className="scroll-slim -mx-1 mt-2 flex gap-3 overflow-x-auto px-1 pb-3 pt-1">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              role="radio"
              aria-checked={book.id === bookId}
              aria-label={book.title}
              onClick={() => chooseBook(book)}
              className={cn("shrink-0 rounded-lg p-1.5 transition-all", book.id === bookId ? "bg-accent-soft ring-2 ring-accent" : "opacity-70 hover:opacity-100")}
            >
              <BookCover book={book} width={88} />
            </button>
          ))}
        </div>
      </fieldset>

      <RoomSettingsFields
        value={settings}
        onChange={(next) => {
          if (next.name !== settings.name) setTouchedName(true);
          setSettings(next);
        }}
      />

      <FormError>{error}</FormError>

      <div className="flex items-center justify-end gap-3 border-t border-line pt-6">
        <Link href="/home" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          Cancel
        </Link>
        <Button type="submit" size="lg" loading={busy} disabled={!settings.name.trim()}>
          Open the room
        </Button>
      </div>
    </form>
  );
}
