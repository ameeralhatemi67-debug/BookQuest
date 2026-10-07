import { BookPlus, Compass, Library, Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityList, type ActivityPerson } from "@/components/room/activity";
import { OpenRoomCard, ReadingDesk, RoomCardView } from "@/components/room/room-card";
import { BookCover } from "@/components/book-cover";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, EmptyState, SectionHeading } from "@/components/ui/misc";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Activity, AwaySummary, HomeData, RoomLayer, RoomPreview } from "@/lib/types";

export const metadata: Metadata = { title: "Home" };

// Activity worth surfacing on Home: what friends did, never page turns.
const HOME_ACTIVITY = ["joined", "started_reading", "chapter_completed", "milestone", "finished", "passed", "note_left", "replied", "prediction_sealed", "poll_added", "ritual_started", "afterparty"];

export default async function HomePage() {
  const me = await requireAlpha();
  const supabase = await createSupabaseServer();

  const [{ data: homeData, error }, { data: openData }] = await Promise.all([supabase.rpc("my_home"), supabase.rpc("list_open_rooms")]);
  if (error || !homeData) {
    return (
      <EmptyState title="We couldn't load your library">
        The server didn&apos;t answer. Check your connection and refresh the page.
      </EmptyState>
    );
  }

  const home = homeData as HomeData;
  const active = home.rooms.filter((room) => !room.archived_at);
  const archived = home.rooms.filter((room) => room.archived_at);
  const [current, ...others] = active;
  const openRooms = ((openData ?? []) as RoomPreview[]).filter((room) => !room.is_member).slice(0, 3);
  const readyBooks = home.books.filter((book) => book.status === "ready");

  // The desk's book: what happened while you were away, and its chapters to tell it with.
  let away: AwaySummary | null = null;
  let outline: RoomLayer["outline"] = null;
  if (current) {
    const [awayResult, layerResult] = await Promise.all([
      supabase.rpc("room_away", { p_room_id: current.id }),
      supabase.rpc("room_layer", { p_room_id: current.id }),
    ]);
    away = (awayResult.data as AwaySummary | null) ?? null;
    outline = (layerResult.data as RoomLayer | null)?.outline ?? null;
  }

  // Recent activity across the tester's active rooms (other people's, not their own).
  let activity: Activity[] = [];
  if (active.length > 0) {
    const { data } = await supabase
      .from("room_activity")
      .select("id, room_id, actor_id, type, data, created_at")
      .in("room_id", active.slice(0, 12).map((room) => room.id))
      .in("type", HOME_ACTIVITY)
      .or(`actor_id.is.null,actor_id.neq.${me.user_id}`)
      .order("created_at", { ascending: false })
      .limit(8);
    activity = (data ?? []) as Activity[];
  }
  const people = new Map<string, ActivityPerson>();
  for (const room of home.rooms) for (const member of room.members) people.set(member.user_id, member);
  // Someone who acted and has since left a room still deserves a name.
  const missing = [...new Set(activity.map((a) => a.actor_id).filter((id): id is string => Boolean(id) && !people.has(id!)))];
  if (missing.length > 0) {
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_path").in("id", missing);
    for (const p of data ?? []) people.set(p.id, { user_id: p.id, display_name: p.display_name, avatar_path: p.avatar_path });
  }
  const roomNames = new Map(home.rooms.map((room) => [room.id, room.name]));

  // ---------------------------------------------------------------- first run
  if (home.rooms.length === 0) {
    return (
      <div className="mx-auto max-w-3xl animate-fade-up">
        <h1 className="text-4xl text-ink sm:text-5xl">Welcome, {me.display_name.split(" ")[0]}.</h1>
        <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-soft">
          Reading alone, together: you and your friends move through the same book at your own pace, and leave things inside it for each other to find.
        </p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { n: 1, title: "Add a book", body: "Upload an EPUB or PDF you want to read with someone." },
            { n: 2, title: "Open a room", body: "A room is a book plus the people reading it with you." },
            { n: 3, title: "Invite a friend", body: "Send them the link, then start reading. Leave them something." },
          ].map((step) => (
            <li key={step.n} className="rounded-3xl border border-line bg-raised p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft font-display text-lg text-accent-ink">{step.n}</span>
              <h2 className="mt-3 font-display text-xl text-ink">{step.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          {readyBooks.length > 0 ? (
            <ButtonLink href={`/rooms/new?book=${readyBooks[0].id}`} size="lg" icon={<Plus className="size-5" aria-hidden />}>
              Open a room for {readyBooks[0].title}
            </ButtonLink>
          ) : (
            <ButtonLink href="/books?upload=1" size="lg" icon={<BookPlus className="size-5" aria-hidden />}>
              Add your first book
            </ButtonLink>
          )}
          <ButtonLink href="/discover" variant="secondary" size="lg" icon={<Compass className="size-5" aria-hidden />}>
            Browse open rooms
          </ButtonLink>
        </div>
        <p className="mt-6 text-sm text-ink-faint">Got an invitation link from a friend? Just open it — you&apos;ll land in their room.</p>
      </div>
    );
  }

  // ---------------------------------------------------------------- returning reader
  return (
    <div className="space-y-12">
      {current ? (
        <ReadingDesk room={current} away={away} outline={outline} />
      ) : (
        <EmptyState icon={<Users className="size-5" aria-hidden />} title="No active rooms right now" action={<ButtonLink href="/books">Start a new room</ButtonLink>}>
          Your finished rooms are kept below as journeys.
        </EmptyState>
      )}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-12">
          <section aria-labelledby="rooms-heading">
            <SectionHeading
              id="rooms-heading"
              title="Your rooms"
              hint="The books you're inside, and who's in them with you."
              action={
                <Link href={readyBooks.length > 0 ? "/rooms/new" : "/books?upload=1"} className={buttonClass("secondary", "sm")}>
                  <Plus className="size-4" aria-hidden />
                  New room
                </Link>
              }
            />
            {others.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {others.map((room) => (
                  <RoomCardView key={room.id} room={room} />
                ))}
              </div>
            ) : (
              <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-sm text-ink-soft">
                {current ? "That's your only room for now. You can read the same book with different people in separate rooms." : "No rooms yet."}
              </p>
            )}
          </section>

          {openRooms.length > 0 && (
            <section aria-labelledby="open-heading">
              <SectionHeading
                id="open-heading"
                title="Open rooms"
                hint="Groups any alpha tester can join."
                action={
                  <Link href="/discover" className={buttonClass("ghost", "sm")}>
                    See all
                  </Link>
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {openRooms.map((room) => (
                  <OpenRoomCard key={room.id} room={room} action={<Link href={`/rooms/${room.id}`} className={buttonClass("secondary", "sm")}>Take a look</Link>} />
                ))}
              </div>
            </section>
          )}

          {archived.length > 0 && (
            <section aria-labelledby="archived-heading">
              <SectionHeading id="archived-heading" title="Journeys" hint="Rooms that have ended, kept as a memory." />
              <div className="grid gap-4 sm:grid-cols-2">
                {archived.map((room) => (
                  <RoomCardView key={room.id} room={room} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-10">
          <section aria-labelledby="activity-heading">
            <SectionHeading id="activity-heading" title="Lately" />
            <Card className="px-4 py-2">
              <ActivityList activities={activity} people={people} meId={me.user_id} roomNames={roomNames} empty="Quiet for now. You'll see here when friends join, reach a milestone or leave something in a book." />
            </Card>
          </section>

          <section aria-labelledby="books-heading">
            <SectionHeading
              id="books-heading"
              title="My books"
              action={
                <Link href="/books" className={buttonClass("ghost", "sm")}>
                  <Library className="size-4" aria-hidden />
                  All
                </Link>
              }
            />
            {readyBooks.length > 0 ? (
              <ul className="flex gap-3 overflow-x-auto pb-2">
                {readyBooks.slice(0, 6).map((book) => (
                  <li key={book.id}>
                    <Link href={`/books#${book.id}`} aria-label={book.title}>
                      <BookCover book={book} width={84} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">
                You haven&apos;t uploaded a book yet.{" "}
                <Link href="/books?upload=1" className="font-medium text-accent-ink underline-offset-4 hover:underline">
                  Add one
                </Link>
                .
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
