"use client";

import { ArrowRight, BookOpen, Gift, Globe2, Link2, Lock, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMe } from "@/components/app/providers";
import { BookCover } from "@/components/book-cover";
import { ProgressTrack } from "@/components/room/progress-track";
import { AvatarStack } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { Badge, Meter } from "@/components/ui/misc";
import { cn, plural, timeAgo } from "@/lib/format";
import { formatPercent, isComplete } from "@/lib/location";
import { gapPercent } from "@/lib/progress-track";
import { roomMode } from "@/lib/room-modes";
import type { RoomCard, RoomPreview, RoomVisibility } from "@/lib/types";

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
  if (isComplete(other.furthest) && isComplete(me?.furthest ?? 0)) return `You and ${name} both finished.`;
  if (other.furthest <= 0 && (me?.furthest ?? 0) <= 0) return `Neither of you has started yet.`;
  if (Math.abs(gap) < 1) return `You and ${name} are on the same page.`;
  return gap > 0 ? `${name} is ${gap}% ahead of you.` : `You're ${-gap}% ahead of ${name}.`;
}

function readHref(room: { id: string }) {
  return `/read/${room.id}`;
}

/** The big "pick up where you left off" card at the top of Home. */
export function ContinueReadingCard({ room }: { room: RoomCard }) {
  const me = useMe();
  const mode = roomMode(room.mode);
  const started = Boolean(room.my && room.my.furthest > 0);
  const finished = isComplete(room.my?.furthest ?? 0);
  const unavailable = room.book.status !== "ready";

  return (
    <section aria-labelledby="continue-heading" className="relative overflow-hidden rounded-[2rem] border border-line bg-raised shadow-soft">
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:p-8">
        <Link href={`/rooms/${room.id}`} className="mx-auto shrink-0 sm:mx-0" aria-label={`Open ${room.name}`}>
          <BookCover book={room.book} width={132} priority className="transition-transform duration-300 hover:-translate-y-1" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <p id="continue-heading" className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-ink">
            {finished ? "Finished" : started ? "Continue reading" : "Start reading"}
          </p>
          <h2 className="mt-1.5 truncate font-display text-3xl leading-tight text-ink sm:text-4xl">{room.book.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {room.book.author ? `${room.book.author} · ` : ""}
            <Link href={`/rooms/${room.id}`} className="underline-offset-4 hover:underline">
              {room.name}
            </Link>
          </p>

          <div className="mt-4 text-sm text-ink-soft">
            {started ? (
              <>
                <span className="text-ink">{room.my?.label ?? formatPercent(room.my?.furthest ?? 0)}</span>
                {room.my?.last_read_at ? ` · last read ${timeAgo(room.my.last_read_at)}` : ""}
              </>
            ) : (
              "You haven't opened this one yet."
            )}
          </div>
          {mode.id === "duo" && <p className="mt-1 text-sm text-ink-soft">{duoSentence(room, me.user_id)}</p>}

          <ProgressTrack members={room.members} meId={me.user_id} mode={mode} size="sm" className="mt-3" />
          <WaitingChips room={room} className="mt-3" />

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {unavailable ? (
              <span className="text-sm text-danger">This book is no longer available.</span>
            ) : (
              <Link href={readHref(room)} className={buttonClass("primary", "lg")}>
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

/** A room the tester belongs to. */
export function RoomCardView({ room }: { room: RoomCard }) {
  const me = useMe();
  const mode = roomMode(room.mode);
  const people = room.members.map((m) => ({ id: m.user_id, display_name: m.display_name, avatar_path: m.avatar_path }));
  return (
    <article className="group relative flex gap-4 rounded-3xl border border-line bg-raised p-4 shadow-soft transition-shadow hover:shadow-lift">
      <BookCover book={room.book} width={72} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate font-display text-xl leading-tight text-ink">
          <Link href={`/rooms/${room.id}`} className="after:absolute after:inset-0 after:rounded-3xl">
            {room.name}
          </Link>
        </h3>
        <p className="truncate text-sm text-ink-soft">{room.book.title}</p>
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
          <h3 className="font-display text-xl leading-tight text-ink">{room.name}</h3>
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
