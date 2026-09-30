"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { VisibilityBadge } from "@/components/room/room-card";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/field";
import { Badge, Spinner } from "@/components/ui/misc";
import { friendlyError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { roomMode } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { SearchResults } from "@/lib/types";

const EMPTY: SearchResults = { books: [], rooms: [], people: [] };

export function SearchView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<{ results: SearchResults; searchedFor: string; loading: boolean; error: string | null }>({ results: EMPTY, searchedFor: "", loading: false, error: null });
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      const { data, error } = await getSupabase().rpc("search_all", { p_query: term });
      if (cancelled) return;
      setState({ results: error ? EMPTY : (data as SearchResults), searchedFor: term, loading: false, error: error ? friendlyError(error) : null });
      // Keep the URL shareable / restorable without adding history entries.
      router.replace(`/search?q=${encodeURIComponent(term)}`, { scroll: false });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, router]);

  const { results, loading, error } = state;
  const show = term.length >= 2 && state.searchedFor === term;
  const nothing = show && !loading && results.books.length + results.rooms.length + results.people.length === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl text-ink">Search</h1>
        <p className="mt-2 text-ink-soft">Your books, your rooms, open rooms and fellow testers. To search the notes inside a book, open it and use the ✦ panel.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A title, an author, a room, a name…" aria-label="Search" autoFocus className="h-12 pl-12 text-base" />
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            <Spinner className="size-4" />
          </span>
        )}
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {term.length < 2 && <p className="text-sm text-ink-faint">Type at least two characters.</p>}
      {nothing && <p className="text-sm text-ink-soft">Nothing found for “{term}”.</p>}

      {show && results.rooms.length > 0 && (
        <section aria-labelledby="search-rooms">
          <h2 id="search-rooms" className="mb-3 font-display text-xl text-ink">Rooms</h2>
          <ul className="space-y-2">
            {results.rooms.map((room) => (
              <li key={room.id}>
                <Link href={`/rooms/${room.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-3 transition-shadow hover:shadow-soft">
                  <BookCover book={room.book} width={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{room.name}</span>
                    <span className="block truncate text-sm text-ink-soft">
                      {room.book.title} · {plural(room.member_count, "reader")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge>{roomMode(room.mode).name}</Badge>
                    <VisibilityBadge visibility={room.visibility} />
                    {room.is_member && <Badge tone="moss">You&apos;re in</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {show && results.books.length > 0 && (
        <section aria-labelledby="search-books">
          <h2 id="search-books" className="mb-3 font-display text-xl text-ink">Books</h2>
          <ul className="space-y-2">
            {results.books.map((book) => (
              <li key={book.id}>
                <Link href={book.mine ? `/books#${book.id}` : "/home"} className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-3 transition-shadow hover:shadow-soft">
                  <BookCover book={book} width={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{book.title}</span>
                    <span className="block truncate text-sm text-ink-soft">{book.author ?? "Unknown author"}</span>
                  </span>
                  <Badge>{book.mine ? "Your upload" : "In one of your rooms"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {show && results.people.length > 0 && (
        <section aria-labelledby="search-people">
          <h2 id="search-people" className="mb-3 font-display text-xl text-ink">People</h2>
          <ul className="space-y-2">
            {results.people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-3">
                <Avatar person={person} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{person.display_name}</span>
                  <span className="block truncate text-sm text-ink-soft">
                    {person.shared_rooms.length > 0 ? (
                      <>
                        Reading with you in{" "}
                        {person.shared_rooms.slice(0, 3).map((room, index) => (
                          <span key={room.id}>
                            {index > 0 && ", "}
                            <Link href={`/rooms/${room.id}`} className="text-accent-ink underline-offset-4 hover:underline">
                              {room.name}
                            </Link>
                          </span>
                        ))}
                      </>
                    ) : (
                      "Alpha tester · no rooms in common yet"
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
