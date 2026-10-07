"use client";

import { ArrowRight, BookOpen, Gift, Globe2, Link2, Lock, Sparkles, Stamp, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMe } from "@/components/app/providers";
import { BookCover } from "@/components/book-cover";
import { GiftBox } from "@/components/reader/package";
import { AwayStory, awayLines } from "@/components/room/away-story";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { Badge, Meter } from "@/components/ui/misc";
import { chaptersFrom } from "@/lib/chapters";
import { featureOn } from "@/lib/features";
import { cn, plural, timeAgo } from "@/lib/format";
import { formatPercent } from "@/lib/location";
import { gapPercent } from "@/lib/progress-track";
import { roomMode, roomModeFor } from "@/lib/room-modes";
import type { AwaySummary, OutlineEntry, RoomCard, RoomPreview, RoomVisibility } from "@/lib/types";

export function VisibilityBadge({ visibility }: { visibility: RoomVisibility }) {
  const Icon = visibility === "private" ? Lock : visibility === "unlisted" ? Link2 : Globe2;
  return (
    <Badge>
      <Icon className="size-3" aria-hidden />
      {visibility === "private" ? "Private" : visibility === "unlisted" ? "Unlisted" : "Open"}
    </Badge>
  );
}

/** "3 things waiting ahead" / "2 new for you" — the pull to keep reading. */
export function WaitingChips({ room, className }: { room: Pick<RoomCard, "waiting" | "unseen">; className?: string }) {
  if (room.waiting === 0 && room.unseen === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {room.unseen > 0 && (
        <Badge tone="gold">
          <Sparkles className="size-3" aria-hidden />
          {room.unseen} new for you
        </Badge>
      )}
      {room.waiting > 0 && (
        <Badge tone="accent">
          <Gift className="size-3" aria-hidden />
          {plural(room.waiting, "thing")} waiting ahead
        </Badge>
      )}
    </div>
  );
}

/** One sentence about where the other reader is — the heart of a Duo. */
export function duoSentence(room: RoomCard, meId: string): ReactNode {
  const me = room.members.find((m) => m.user_id === meId);
  const other = room.members.find((m) => m.user_id !== meId);
  if (!other) return "Waiting for your reading partner to join.";
  const gap = gapPercent(me?.furthest ?? 0, other.furthest);
  const name = other.display_name.split(" ")[0];
  if (Boolean(other.completed_at) && Boolean(me?.completed_at)) return `You and ${name} both finished.`;
  if (other.furthest <= 0 && (me?.furthest ?? 0) <= 0) return `Neither of you has started yet.`;
  if (Math.abs(gap) < 1) return `You and ${name} are on the same page.`;
  return gap > 0 ? `${name} is ${gap}% ahead of you.` : `You're ${-gap}% ahead of ${name}.`;
}

function readHref(room: { id: string }) {
  return `/read/${room.id}`;
}

/**
 * Home's reading desk: the book you are in dominates the screen. Who is where,
 * what is waiting ahead, what happened while you were away, then one button.
 * Everything else on Home is supporting material.
 */
export function ReadingDesk({ room, away, outline }: { room: RoomCard; away?: AwaySummary | null; outline?: OutlineEntry[] | null }) {
  const me = useMe();
  const mode = roomModeFor(room);
  const started = Boolean(room.my && room.my.furthest > 0);
  const finished = Boolean(room.my?.completed_at);
  const unavailable = room.book.status !== "ready";
  const chapters = chaptersFrom(outline);
  const people = new Map(room.members.map((m) => [m.user_id, { id: m.user_id, display_name: m.display_name, avatar_path: m.avatar_path }]));
  const personOf = (id: string) => people.get(id) ?? { id, display_name: "A friend", avatar_path: null };
  const lines = featureOn(room.features, "away_summary") ? awayLines(away ?? null, personOf, chapters) : [];
  const readers = [...room.members].sort((x, y) => y.furthest - x.furthest);
  const shown = readers.slice(0, 6);
  const here = room.my?.furthest ?? 0;
  const where = room.my?.label ?? (started ? formatPercent(here) : null);
  const packages = room.packages_waiting ?? 0;
  const things = room.waiting - packages;
  const ready = featureOn(room.features, "predictions") ? room.predictions_ready ?? 0 : 0;

  return (
    <section aria-labelledby="desk-title" className="reading-desk relative overflow-hidden rounded-[2rem] px-5 py-8 sm:px-10 sm:py-12">
      <div className="relative grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <Link href={`/read/${room.id}`} className="desk-book group relative mx-auto block w-fit" aria-label={`Open ${room.book.title}`} tabIndex={-1}>
          <span className="desk-book-pages" aria-hidden />
          <BookCover book={room.book} width={208} priority className="relative rotate-[-2.5deg] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5 group-hover:rotate-[-1deg]" />
        </Link>

        <div className="min-w-0">
          <h1 id="desk-title" dir="auto" className="font-display text-4xl leading-[1.05] text-ink sm:text-6xl">{room.book.title}</h1>
          <p className="mt-2 text-sm text-ink-soft [overflow-wrap:anywhere]">
            {room.book.author ? `${room.book.author} · ` : ""}
            <Link href={`/rooms/${room.id}`} className="underline-offset-4 hover:underline">{room.name}</Link>
          </p>
          <p className="mt-4 text-xl text-ink">
            {finished ? "Finished" : where ? <>{where}{mode.progress.showPercent && room.my?.label ? <span className="text-ink-soft"> · {formatPercent(here)}</span> : null}</> : "Not started yet"}
            {room.my?.last_read_at && !finished ? <span className="ml-2 text-sm text-ink-faint">last read {timeAgo(room.my.last_read_at)}</span> : null}
          </p>

          {/* who is where */}
          <ul className="mt-6 space-y-2.5" aria-label="Where everyone is">
            {shown.map((member) => {
              const isMe = member.user_id === me.user_id;
              return (
                <li key={member.user_id} className="grid grid-cols-[28px_minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3">
                  <Avatar person={personOf(member.user_id)} size={28} />
                  <span className={cn("truncate text-sm", isMe ? "font-medium text-ink" : "text-ink-soft")}>{isMe ? "You" : member.display_name.split(" ")[0]}</span>
                  <span className="relative h-1.5 rounded-full bg-line" aria-hidden>
                    <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", isMe ? "bg-accent" : "bg-ink/30")} style={{ width: `${Math.max(member.furthest > 0 ? 2 : 0, Math.min(1, member.furthest) * 100)}%` }} />
                  </span>
                  <span className="w-[4.5rem] truncate text-right text-sm tabular-nums text-ink-soft">
                    {member.completed_at ? "Finished" : member.furthest <= 0 ? "Not yet" : mode.progress.showPercent ? formatPercent(member.furthest) : (member.label ?? "Reading")}
                  </span>
                </li>
              );
            })}
            {readers.length > shown.length && <li className="pl-10 text-xs text-ink-faint">and {plural(readers.length - shown.length, "more reader")}</li>}
          </ul>

          {(packages > 0 || things > 0 || ready > 0 || room.unseen > 0) && (
            <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink">
              {packages > 0 && <span className="flex items-center gap-2"><GiftBox hue={30} size={22} />{packages === 1 ? "A package is waiting for you" : `${packages} packages are waiting for you`}</span>}
              {things > 0 && <span className="flex items-center gap-2"><Gift className="size-5 text-accent" aria-hidden />{things === 1 ? "1 thing is waiting ahead" : `${things} things are waiting ahead`}</span>}
              {ready > 0 && <span className="flex items-center gap-2"><Stamp className="size-5 text-accent" aria-hidden />{ready === 1 ? "A prediction is ready to open" : `${ready} predictions are ready to open`}</span>}
              {room.unseen > 0 && <span className="flex items-center gap-2"><Sparkles className="size-5 text-gold" aria-hidden />{room.unseen} new for you</span>}
            </p>
          )}

          {lines.length > 0 && (
            <div className="mt-6 border-l-2 border-accent/40 pl-4">
              <p className="mb-2 text-sm font-medium text-ink">While you were away</p>
              <AwayStory lines={lines} personOf={personOf} compact />
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {unavailable ? (
              <span className="text-sm text-danger">This book is no longer available.</span>
            ) : (
              <Link href={readHref(room)} className={buttonClass("primary", "lg", "h-14 px-8 text-lg")}>
                <BookOpen className="size-5" aria-hidden />
                {finished ? "Open the book" : started ? "Continue reading" : "Start reading"}
              </Link>
            )}
            <Link href={`/rooms/${room.id}`} className={buttonClass("ghost", "lg")}>
              Room
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The big "pick up where you left off" card (kept for rooms shown outside Home's desk). */
export const ContinueReadingCard = ReadingDesk;

/** A room the tester belongs to. */
export function RoomCardView({ room }: { room: RoomCard }) {
  const me = useMe();
  const mode = roomModeFor(room);
  const people = room.members.map((m) => ({ id: m.user_id, display_name: m.display_name, avatar_path: m.avatar_path }));
  return (
    <article className="group relative flex gap-4 rounded-3xl border border-line bg-raised p-4 shadow-soft transition-shadow hover:shadow-lift">
      <BookCover book={room.book} width={72} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 dir="auto" className="truncate font-display text-xl leading-tight text-ink">
          <Link href={`/rooms/${room.id}`} className="after:absolute after:inset-0 after:rounded-3xl">
            {room.name}
          </Link>
        </h3>
        <p dir="auto" className="truncate text-sm text-ink-soft">{room.book.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge>{mode.name}</Badge>
          <VisibilityBadge visibility={room.visibility} />
          {room.archived_at && <Badge tone="gold">Archived</Badge>}
        </div>
        <div className="mt-auto pt-3">
          <Meter value={room.my?.furthest ?? 0} label={`Your progress in ${room.book.title}`} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <AvatarStack people={people} size={24} max={5} />
            <span className="truncate text-xs text-ink-faint">
              {room.my && room.my.furthest > 0 ? (mode.id === "duo" ? duoSentence(room, me.user_id) : (room.my.label ?? formatPercent(room.my.furthest))) : "Not started"}
            </span>
          </div>
          <WaitingChips room={room} className="mt-2" />
        </div>
      </div>
    </article>
  );
}

/** An Open room in the directory, as seen by someone who may not be a member. */
export function OpenRoomCard({ room, action }: { room: RoomPreview; action?: ReactNode }) {
  const mode = roomMode(room.mode);
  const people = room.members.map((m) => ({ id: m.user_id, display_name: m.display_name, avatar_path: m.avatar_path }));
  const full = room.member_count >= room.capacity;
  const spots = room.member_limit ? room.capacity - room.member_count : null;
  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-line bg-raised p-5 shadow-soft">
      <div className="flex gap-4">
        <BookCover book={room.book} width={76} />
        <div className="min-w-0 flex-1">
          <h3 dir="auto" className="font-display text-xl leading-tight text-ink">{room.name}</h3>
          <p className="truncate text-sm text-ink-soft">
            {room.book.title}
            {room.book.author ? ` · ${room.book.author}` : ""}
          </p>
          {room.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft">{room.description}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge>{mode.name}</Badge>
            <Badge>{room.book.format.toUpperCase()}</Badge>
            {room.is_closed ? <Badge tone="gold">Closed to new members</Badge> : full ? <Badge tone="gold">Full</Badge> : spots !== null ? <Badge tone="moss">{plural(spots, "spot")} left</Badge> : null}
          </div>
        </div>
      </div>

      {/* Where the group is, without saying who is where. */}
      <div aria-label={`Progress of ${plural(room.member_count, "reader")}`} role="img" className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        {room.progress.map((p, index) => (
          <span key={index} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/60 ring-2 ring-raised" style={{ left: `${Math.min(1, Math.max(0, p)) * 100}%` }} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-ink-faint">
          <AvatarStack people={people} size={24} max={5} />
          <span className="flex items-center gap-1 truncate">
            <Users className="size-3.5" aria-hidden />
            {plural(room.member_count, "reader")} · active {timeAgo(room.last_activity_at)}
          </span>
        </div>
        {action}
      </div>
    </article>
  );
}
