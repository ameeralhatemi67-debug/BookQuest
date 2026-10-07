"use client";

import { BarChart3, BellRing, Check, DoorOpen, Gift, Hand, History, Music2, PartyPopper, Plus, Sparkles, Stamp, Users, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, AvatarStack, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger, SheetClose, Tooltip } from "@/components/ui/overlay";
import { cn, plural, timeAgo } from "@/lib/format";
import { formatPercent } from "@/lib/location";
import type { Afterparty, Echo, Marker, Poll, Prediction, Ritual, WeatherPoint } from "@/lib/types";
import type { NoteBundle } from "./use-annotations";
import { WaxSeal } from "./predictions";
import type { ViewerMarker } from "./types";

// ---------------------------------------------------------------- echoes
const MONTH = 30 * 24 * 3600 * 1000;
function ago(iso: string): string {
  const months = Math.round((Date.now() - new Date(iso).getTime()) / MONTH);
  if (months >= 12) return months >= 18 ? `${Math.round(months / 12)} years ago` : "a year ago";
  if (months >= 2) return `${months} months ago`;
  return timeAgo(iso);
}

/** A note from an earlier reading of this book, surfacing as you reach it again. */
export function EchoMarker({ echo, me }: { echo: Echo; me: AvatarPerson }) {
  const person = echo.mine ? me : { id: echo.author_id, display_name: echo.author_name, avatar_path: echo.author_avatar };
  return (
    <Popover>
      <PopoverTrigger className="group flex size-11 items-center justify-center rounded-full" aria-label={echo.mine ? `Something you wrote ${ago(echo.created_at)}` : `${echo.author_name} left this ${ago(echo.created_at)}, in ${echo.room_name}`}>
        <span className="relative rounded-full opacity-70 transition-[opacity,transform] duration-300 group-hover:scale-105 group-hover:opacity-100" style={{ filter: "sepia(.7) saturate(.8)" }}>
          <Avatar person={person} size={28} className="rounded-full" />
          <span className="absolute -inset-1 rounded-full border border-dashed border-ink-faint" aria-hidden />
        </span>
      </PopoverTrigger>
      <PopoverContent side="left" className="w-[min(300px,calc(100vw-24px))] p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
          <History className="size-3.5" aria-hidden />
          {echo.mine ? `You wrote this ${ago(echo.created_at)}` : `${echo.author_name.split(" ")[0]} left this ${ago(echo.created_at)}`}
        </p>
        {echo.quote && <blockquote className="mt-2.5 border-l-2 border-line-strong pl-2.5 font-display text-sm italic text-ink-soft">{echo.quote.length > 200 ? `${echo.quote.slice(0, 200)}…` : echo.quote}</blockquote>}
        {echo.emoji && <p className="mt-2 text-2xl">{echo.emoji}</p>}
        {echo.body && <p className="mt-2 whitespace-pre-wrap break-words font-display text-[15px] leading-relaxed text-ink">{echo.body}</p>}
        {echo.media.length > 0 && <p className="mt-2 text-xs text-ink-faint">With {echo.media.map((k) => (k === "image" ? "a picture" : k === "audio" ? "a voice note" : "a video")).join(" and ")}, kept in {echo.room_name}.</p>}
        <p className="mt-3 border-t border-line pt-2 text-xs text-ink-faint">From your reading in {echo.room_name}</p>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- reaction weather
/** How this page made the room feel, revealed only now that you are here. */
export function WeatherChip({ points, onDone }: { points: WeatherPoint[]; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const tally = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of points) map.set(p.e, (map.get(p.e) ?? 0) + p.n);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [points]);
  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), 4600);
    const done = setTimeout(onDone, 5000);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [onDone]);
  if (!tally.length) return null;
  return (
    <div role="status" data-leaving={leaving} className="weather-chip pointer-events-none flex items-center gap-2.5 rounded-full border border-line bg-raised/95 py-1.5 pl-3 pr-3.5 shadow-lift">
      <span className="text-[11px] font-medium text-ink-faint">This page</span>
      {tally.map(([emoji, n], i) => (
        <span key={emoji} className="flex items-baseline gap-0.5 text-lg leading-none" style={{ "--i": i } as React.CSSProperties}>
          {emoji}
          <span className="text-xs tabular-nums text-ink-soft">×{n}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- live reading
export interface LiveFriend {
  id: string;
  person: AvatarPerson;
  label?: string;
  together: boolean;
}

/**
 * "Sara is reading too": a quiet state, not a chat. One knock says "I'm here
 * now"; Read together pairs two readers' live positions while each still
 * turns their own pages.
 */
export function LivePresence({ friends, together, invitedBy, onKnock, onInvite, onAccept, onLeave, knocked }: {
  friends: LiveFriend[];
  together: string | null;
  invitedBy: string | null;
  onKnock: (id: string) => void;
  onInvite: (id: string) => void;
  onAccept: () => void;
  onLeave: () => void;
  /** A knock that just arrived, shown for a moment. */
  knocked: { from: AvatarPerson; at: number } | null;
}) {
  const partner = together ? friends.find((f) => f.id === together) : undefined;
  const inviter = invitedBy ? friends.find((f) => f.id === invitedBy) : undefined;
  if (!friends.length && !knocked) return null;
  return (
    <div className="pointer-events-auto flex flex-col items-start gap-2">
      {knocked && (
        <p key={knocked.at} role="status" className="flex animate-fade-up items-center gap-2 rounded-full border border-moss/30 bg-raised py-1 pl-1 pr-3 text-sm text-ink shadow-soft">
          <span className="relative">
            <Avatar person={knocked.from} size={26} className="knock-shake rounded-full" />
            <span className="knock-ripple" aria-hidden />
            <span className="knock-ripple" aria-hidden />
          </span>
          {knocked.from.display_name.split(" ")[0]} knocked: reading now
        </p>
      )}
      {inviter && !together && (
        <div role="status" className="flex animate-fade-up items-center gap-2 rounded-2xl border border-line bg-raised p-1.5 pl-2 shadow-lift">
          <Avatar person={inviter.person} size={26} live />
          <span className="text-sm text-ink">{inviter.person.display_name.split(" ")[0]} wants to read together</span>
          <Button size="sm" onClick={onAccept}>Join</Button>
        </div>
      )}
      {partner ? (
        <div className="flex items-center gap-2 rounded-full border border-moss/40 bg-raised py-1 pl-1 pr-1 shadow-soft">
          <span className="live-glow rounded-full"><Avatar person={partner.person} size={28} live /></span>
          <span className="max-w-[12rem] truncate text-sm text-ink">
            Reading with {partner.person.display_name.split(" ")[0]}
            {partner.label ? <span className="text-ink-faint"> · {partner.label}</span> : null}
          </span>
          <button type="button" onClick={onLeave} className="flex size-9 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Stop reading together">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : friends.length > 0 ? (
        <Popover>
          <PopoverTrigger className="flex items-center gap-2 rounded-full border border-line bg-raised/95 py-1 pl-1 pr-3 text-sm text-ink-soft shadow-soft transition-colors hover:text-ink" aria-label={`${friends.map((f) => f.person.display_name).join(", ")} reading now`}>
            <AvatarStack people={friends.map((f) => f.person)} size={26} max={3} />
            <span className="max-w-[11rem] truncate">{friends.length === 1 ? `${friends[0].person.display_name.split(" ")[0]} is reading too` : `${friends.length} friends reading too`}</span>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-2">
            <ul>
              {friends.map((f) => (
                <li key={f.id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
                  <Avatar person={f.person} size={30} live />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{f.person.display_name}</span>
                    {f.label && <span className="block truncate text-xs text-ink-faint">{f.label}</span>}
                  </span>
                  <Tooltip label="Knock: let them know you're reading now">
                    <PopoverClose className="flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label={`Knock on ${f.person.display_name}`} onClick={() => onKnock(f.id)}>
                      <Hand className="size-4" aria-hidden />
                    </PopoverClose>
                  </Tooltip>
                  <Tooltip label="Read together: see each other move, page by page">
                    <PopoverClose className="flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label={`Read together with ${f.person.display_name}`} onClick={() => onInvite(f.id)}>
                      <Users className="size-4" aria-hidden />
                    </PopoverClose>
                  </Tooltip>
                </li>
              ))}
            </ul>
            <p className="px-2 pb-1 pt-2 text-xs leading-relaxed text-ink-faint">Nobody gets a notification. Pages never sync; you each keep your own pace.</p>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- moments (bottom pill)
export function MomentPill({ icon, children, action, onAction, onDismiss }: { icon: ReactNode; children: ReactNode; action: string; onAction: () => void; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto flex animate-fade-up items-center gap-3 rounded-full border border-gold/40 bg-raised py-1.5 pl-2 pr-1.5 shadow-lift" role="status" aria-live="polite">
      {icon}
      <p className="text-sm text-ink">{children}</p>
      <Button size="sm" onClick={onAction}>{action}</Button>
      <button type="button" onClick={onDismiss} className="flex size-9 items-center justify-center rounded-full text-ink-faint hover:bg-sunk" aria-label="Dismiss">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- afterparty
/** A chapter's scrapbook: everything the room left in it, together, once everyone is through. */
export function AfterpartySheet({ party, chapterMarkers, notes, polls, predictions, weather, cues, personOf, meId, onOpenNote, onOpenPoll }: {
  party: Afterparty;
  chapterMarkers: Marker[];
  notes: Map<string, NoteBundle>;
  polls: Poll[];
  predictions: Prediction[];
  weather: WeatherPoint[];
  cues: { position: number; author_id: string }[];
  personOf: (id: string) => AvatarPerson;
  meId: string;
  onOpenNote: (marker: Marker) => void;
  onOpenPoll: (poll: Poll) => void;
}) {
  const inRange = (p: number) => p >= party.start_at && p < party.end_at;
  const mood = new Map<string, number>();
  for (const w of weather) if (inRange(w.p)) mood.set(w.e, (mood.get(w.e) ?? 0) + w.n);
  const moods = [...mood.entries()].sort((a, b) => b[1] - a[1]);
  const authors = [...new Set([...chapterMarkers.map((m) => m.author_id), ...polls.map((p) => p.author_id), ...predictions.map((p) => p.author_id)])];
  const sealedHere = predictions.filter((p) => inRange(p.made_at));
  const pollsHere = polls.filter((p) => inRange(p.position));
  const songs = cues.filter((c) => inRange(c.position)).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-soft text-gold"><PartyPopper className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl leading-tight text-ink">{party.label ?? "This chapter"}: the afterparty</h2>
          <p className="text-xs text-ink-faint">Everyone is through, since {timeAgo(party.opened_at)}. Here&apos;s what the room left in it.</p>
        </div>
        <SheetClose className="-mr-2 flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
          <X className="size-5" aria-hidden />
        </SheetClose>
      </header>
      <div className="scroll-slim min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {authors.length > 0 && <AvatarStack people={authors.map(personOf)} size={28} max={8} />}
          {moods.length > 0 && (
            <p className="flex flex-wrap gap-2 text-lg" aria-label="How it felt">
              {moods.slice(0, 5).map(([e, n]) => <span key={e}>{e}<span className="ml-0.5 text-xs tabular-nums text-ink-soft">×{n}</span></span>)}
            </p>
          )}
          {songs > 0 && <p className="flex items-center gap-1 text-xs text-ink-soft"><Music2 className="size-3.5" aria-hidden />{plural(songs, "song")} cued here</p>}
        </div>

        {chapterMarkers.length === 0 && pollsHere.length === 0 && sealedHere.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">A quiet chapter. Nobody left anything in it.</p>
        ) : null}

        {chapterMarkers.length > 0 && (
          <section aria-label="Notes">
            <ul className="columns-1 gap-3 sm:columns-2 [&>li]:mb-3 [&>li]:break-inside-avoid">
              {chapterMarkers.map((marker) => {
                const bundle = notes.get(marker.id);
                const author = personOf(marker.author_id);
                const image = bundle?.attachments.find((a) => a.kind === "image");
                return (
                  <li key={marker.id}>
                    <button type="button" onClick={() => onOpenNote(marker)} className="block w-full rounded-2xl border border-line bg-raised p-3 text-left shadow-soft transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lift" style={{ rotate: `${((personHue(marker.id) % 5) - 2) * 0.4}deg` }}>
                      <span className="flex items-center gap-2">
                        <Avatar person={author} size={22} />
                        <span className="truncate text-xs font-medium text-ink-soft">{marker.author_id === meId ? "You" : author.display_name.split(" ")[0]}</span>
                      </span>
                      {bundle?.content?.quote && <span className="mt-2 block line-clamp-2 font-display text-sm italic text-ink-faint">“{bundle.content.quote}”</span>}
                      {bundle?.content?.emoji && <span className="mt-2 block text-2xl">{bundle.content.emoji}</span>}
                      {bundle?.content?.body && <span className="mt-1.5 block line-clamp-5 text-sm leading-snug text-ink">{bundle.content.body}</span>}
                      {image && <span className="mt-2 block text-xs text-ink-faint">With a picture. Open to see it.</span>}
                      {!bundle && <span className="mt-2 block text-sm text-ink-faint">…</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {pollsHere.length > 0 && (
          <section aria-label="Polls" className="space-y-2">
            {pollsHere.map((poll) => (
              <button key={poll.id} type="button" onClick={() => onOpenPoll(poll)} className="flex w-full items-center gap-3 rounded-2xl border border-line px-3.5 py-3 text-left hover:bg-sunk">
                <BarChart3 className="size-4 shrink-0 text-ink-soft" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{poll.question}</span>
                <span className="shrink-0 text-xs text-ink-faint">{poll.my_vote === null ? "Vote to see" : plural(poll.votes, "vote")}</span>
              </button>
            ))}
          </section>
        )}

        {sealedHere.length > 0 && (
          <section aria-label="Predictions sealed in this chapter">
            <h3 className="mb-2 text-sm font-medium text-ink">Sealed in this chapter</h3>
            <ul className="space-y-2">
              {sealedHere.map((p) => (
                <li key={p.id} className="flex items-start gap-3">
                  <WaxSeal size="sm" hue={personHue(p.author_id)} />
                  <p className="min-w-0 text-sm text-ink-soft">
                    {p.reached && p.body ? <span className="font-display italic text-ink">“{p.body}”</span> : <>Opens at {p.opens_label ?? formatPercent(p.opens_at)}</>}
                    <span className="block text-xs text-ink-faint">{p.author_id === meId ? "You" : personOf(p.author_id).display_name.split(" ")[0]}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rituals
export function ritualProgress(ritual: Ritual): { done: number; total: number; mine: boolean | null } {
  return { done: ritual.members.filter((m) => m.done).length, total: ritual.members.length, mine: null };
}

/** The one ritual worth mentioning right now, as a small card above the reading status. */
export function RitualCard({ ritual, meId, onAct, onCheckIn }: { ritual: Ritual; meId: string; onAct: () => void; onCheckIn: () => void }) {
  const done = ritual.members.filter((m) => m.done).length;
  const mine = ritual.members.find((m) => m.user_id === meId)?.done ?? false;
  const action = ritual.kind === "predict_before" ? "Seal mine" : ritual.kind === "custom" ? "Mark done" : ritual.kind === "song_within" ? "Add a song" : null;
  return (
    <div className="pointer-events-auto w-[min(300px,calc(100vw-5rem))] animate-fade-up rounded-2xl border border-line bg-raised/95 p-3 shadow-soft">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-accent-ink"><Sparkles className="size-3.5" aria-hidden /> Room ritual</p>
      <p className="mt-1 text-sm leading-snug text-ink">{ritual.title}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="flex gap-0.5" aria-label={`${done} of ${ritual.members.length} done`}>
          {ritual.members.map((m) => <span key={m.user_id} className={cn("h-1.5 w-3 rounded-full", m.done ? "bg-moss" : "bg-line-strong")} />)}
        </span>
        <span className="text-xs tabular-nums text-ink-faint">{done}/{ritual.members.length}</span>
        {mine ? (
          <span className="ml-auto flex items-center gap-1 text-xs text-moss"><Check className="size-3.5" aria-hidden /> You&apos;re in</span>
        ) : action ? (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={ritual.kind === "custom" ? onCheckIn : onAct}>{action}</Button>
        ) : null}
      </div>
    </div>
  );
}

/** "Nobody reads past Chapter 12 until Saturday." A soft line the room agreed on. */
export function HoldCurtain({ ritual, onBack, onPeek }: { ritual: Ritual; onBack: () => void; onPeek: () => void }) {
  const until = ritual.until_at ? new Date(ritual.until_at) : null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[color-mix(in_oklab,var(--paper)_86%,transparent)] p-6 backdrop-blur-[6px]" role="alertdialog" aria-labelledby="hold-title">
      <div className="max-w-sm animate-pop-in text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink"><DoorOpen className="size-6" aria-hidden /></span>
        <h2 id="hold-title" className="mt-4 font-display text-2xl leading-tight text-ink">The room is waiting here</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {ritual.title}
          {until ? ` It lifts ${until.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}.` : ""}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={onBack}>Go back to {ritual.target_label ?? "the line"}</Button>
          <Button variant="ghost" onClick={onPeek}>Read on anyway</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the + menu
export function LeaveMenu({ packages, predictions, polls, onPick }: { packages: boolean; predictions: boolean; polls: boolean; onPick: (kind: "package" | "prediction" | "poll") => void }) {
  if (!packages && !predictions && !polls) return null;
  const rows: { kind: "package" | "prediction" | "poll"; on: boolean; icon: ReactNode; title: string; detail: string }[] = [
    { kind: "package", on: packages, icon: <Gift className="size-4" aria-hidden />, title: "Wrap a package", detail: "For one friend. Opens when they get here." },
    { kind: "prediction", on: predictions, icon: <Stamp className="size-4" aria-hidden />, title: "Seal a prediction", detail: "Opens at a later chapter, or the end." },
    { kind: "poll", on: polls, icon: <BarChart3 className="size-4" aria-hidden />, title: "Ask the room", detail: "A question nobody sees until they arrive." },
  ];
  return (
    <Popover>
      <Tooltip label="Leave something else" side="bottom">
        <PopoverTrigger className="reader-tool" aria-label="Leave something else here">
          <Plus className="size-5" aria-hidden />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(300px,calc(100vw-1rem))] p-1.5">
        <ul>
          {rows.filter((r) => r.on).map((row) => (
            <li key={row.kind}>
              <PopoverClose onClick={() => onPick(row.kind)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-sunk">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">{row.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{row.title}</span>
                  <span className="block text-xs leading-snug text-ink-soft">{row.detail}</span>
                </span>
              </PopoverClose>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export const readyIcon = <BellRing className="size-4" aria-hidden />;
export type { ViewerMarker };
