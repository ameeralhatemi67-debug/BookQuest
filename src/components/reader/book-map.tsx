"use client";

import { BarChart3, Music2, PartyPopper, PenLine, Stamp, X } from "lucide-react";
import { useMemo } from "react";
import { Avatar, personHue } from "@/components/ui/avatar";
import { SheetClose } from "@/components/ui/overlay";
import type { Chapter } from "@/lib/chapters";
import { cn, plural } from "@/lib/format";
import { clamp01 } from "@/lib/location";
import type { Afterparty, RoomMember, WeatherPoint } from "@/lib/types";
import { GiftBox } from "./package";

export type MapItemKind = "note" | "package" | "prediction" | "poll" | "cue";

export interface MapItem {
  id: string;
  kind: MapItemKind;
  position: number;
  authorId: string;
  /** Behind the reader (or theirs): its kind may be shown. Ahead: only that something is there. */
  open: boolean;
}

function Glyph({ item }: { item: MapItem }) {
  const hue = personHue(item.authorId);
  const ink = `oklch(0.58 0.12 ${hue})`;
  if (item.kind === "package") return <GiftBox hue={hue} size={14} />;
  const common = "flex size-4 items-center justify-center rounded-full text-white";
  if (item.kind === "prediction") return <span className={common} style={{ background: `oklch(0.5 0.15 ${hue})` }}><Stamp className="size-2.5" strokeWidth={2.6} aria-hidden /></span>;
  if (item.kind === "poll") return <span className="flex size-4 items-center justify-center rounded-[5px] text-white" style={{ background: ink }}><BarChart3 className="size-2.5" strokeWidth={2.6} aria-hidden /></span>;
  if (item.kind === "cue") return <span className={common} style={{ background: ink }}><Music2 className="size-2.5" strokeWidth={2.6} aria-hidden /></span>;
  return <span className="block size-2.5 rounded-full ring-2 ring-raised" style={{ background: ink }} />;
}

const LEGEND: { kind: MapItemKind; label: string }[] = [
  { kind: "note", label: "Note" },
  { kind: "package", label: "Package" },
  { kind: "prediction", label: "Prediction" },
  { kind: "poll", label: "Poll" },
  { kind: "cue", label: "Song" },
];

/**
 * A zoomed-out map of the whole reading journey. Chapters are short rails in
 * the same language as the progress rail. Behind you, you can see what kind of
 * thing friends left and how the room felt; ahead, only a glow that says how
 * much is waiting.
 */
export function BookMap({
  chapters, members, meId, furthest, here, items, weather, afterparties, liveIds, lens, lensEnabled, onLens, onGo, onAfterparty,
}: {
  chapters: Chapter[];
  members: RoomMember[];
  meId: string;
  furthest: number;
  here: number;
  items: MapItem[];
  weather: WeatherPoint[];
  afterparties: Afterparty[];
  liveIds: Set<string>;
  lens: string | null;
  lensEnabled: boolean;
  onLens: (id: string | null) => void;
  onGo: (position: number) => void;
  onAfterparty: (chapterIndex: number) => void;
}) {
  const visible = useMemo(() => (lens ? items.filter((i) => i.authorId === lens) : items), [items, lens]);
  const ahead = visible.filter((i) => !i.open).length;
  const current = chapters.find((c) => here >= c.start - 1e-9 && here < c.end) ?? chapters[0];
  const partyByChapter = new Map(afterparties.map((a) => [a.chapter_index, a]));
  const maxAhead = Math.max(1, ...chapters.map((c) => visible.filter((i) => !i.open && i.position >= c.start && i.position < c.end).length));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight text-ink">The map</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              {current ? <>You&apos;re in <span className="text-ink">{current.label}</span>. </> : null}
              {ahead > 0 ? `${plural(ahead, "thing")} waiting ahead.` : "Nothing waiting ahead yet."}
            </p>
          </div>
          <SheetClose className="-mr-2 flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
            <X className="size-5" aria-hidden />
          </SheetClose>
        </div>
        {lensEnabled && members.length > 1 && (
          <div role="radiogroup" aria-label="Whose trail to show" className="scroll-slim -mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1">
            <button type="button" role="radio" aria-checked={lens === null} onClick={() => onLens(null)} className={cn("h-9 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors", lens === null ? "bg-ink text-paper" : "bg-sunk text-ink-soft hover:text-ink")}>
              Everyone
            </button>
            {members.map((m) => (
              <button key={m.user_id} type="button" role="radio" aria-checked={lens === m.user_id} onClick={() => onLens(m.user_id)} className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-sm transition-colors", lens === m.user_id ? "bg-ink text-paper" : "bg-sunk text-ink-soft hover:text-ink")}>
                <Avatar person={{ id: m.user_id, display_name: m.display_name, avatar_path: m.avatar_path }} size={26} live={liveIds.has(m.user_id)} />
                {m.user_id === meId ? "You" : m.display_name.split(" ")[0]}
              </button>
            ))}
          </div>
        )}
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint" aria-label="Key">
          {LEGEND.map((l) => (
            <li key={l.kind} className="flex items-center gap-1"><Glyph item={{ id: l.kind, kind: l.kind, position: 0, authorId: meId, open: true }} />{l.label}</li>
          ))}
          <li className="flex items-center gap-1"><span className="block h-2 w-4 rounded-full bg-gold/60 blur-[1.5px]" />Waiting ahead</li>
        </ul>
      </header>

      <ol className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="Chapters">
        {chapters.map((chapter) => {
          const span = Math.max(0.0001, chapter.end - chapter.start);
          const at = (p: number) => `${clamp01((p - chapter.start) / span) * 100}%`;
          const inside = visible.filter((i) => i.position >= chapter.start && i.position < chapter.end);
          const behind = inside.filter((i) => i.open);
          const waiting = inside.filter((i) => !i.open);
          const reachedAll = furthest >= chapter.end - 1e-6;
          const reachedSome = furthest > chapter.start;
          const isHere = current?.index === chapter.index;
          const readers = members.filter((m) => m.position >= chapter.start && m.position < chapter.end && (!lens || lens === m.user_id));
          const mood = new Map<string, number>();
          for (const w of weather) if (w.p >= chapter.start && w.p < chapter.end) mood.set(w.e, (mood.get(w.e) ?? 0) + w.n);
          const topMood = [...mood.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          const party = partyByChapter.get(chapter.index);
          const glowCenter = waiting.length ? waiting.reduce((sum, i) => sum + i.position, 0) / waiting.length : 0;
          const fill = clamp01((furthest - chapter.start) / span);
          return (
            <li key={chapter.index}>
              <div className={cn("group relative rounded-2xl px-3 py-2.5 transition-colors", isHere ? "bg-accent-soft/55" : "hover:bg-sunk/70")}>
                <button type="button" onClick={() => onGo(chapter.start)} className="absolute inset-0 rounded-2xl" aria-label={`Go to ${chapter.label}${waiting.length ? `, ${plural(waiting.length, "thing")} waiting` : ""}`} />
                <div className="pointer-events-none flex items-baseline gap-2">
                  <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">{chapter.index + 1}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", reachedSome ? "text-ink" : "text-ink-soft")}>{chapter.label}</span>
                  {isHere && <span className="shrink-0 text-[11px] font-medium text-accent-ink">You&apos;re here</span>}
                  {topMood.length > 0 && (
                    <span className="flex shrink-0 gap-1.5 text-xs" aria-label={`Reactions: ${topMood.map(([e, n]) => `${e} ${n}`).join(", ")}`}>
                      {topMood.map(([e, n]) => <span key={e} className="tabular-nums text-ink-soft">{e}<span className="ml-0.5 text-[10px]">{n}</span></span>)}
                    </span>
                  )}
                  {!reachedAll && waiting.length > 0 && <span className="shrink-0 text-[11px] font-medium text-gold">{waiting.length} waiting</span>}
                </div>
                {/* the chapter as a short rail */}
                <div className="pointer-events-none relative ml-8 mt-2 h-6">
                  <div className={cn("absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full", reachedAll ? "bg-line" : "bg-[repeating-linear-gradient(90deg,var(--line)_0_6px,transparent_6px_10px)]")} />
                  {fill > 0 && <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent/70" style={{ width: `${fill * 100}%` }} />}
                  {waiting.length > 0 && (
                    <span className="map-glow absolute top-1/2 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/70 blur-[5px]" style={{ left: at(glowCenter), width: `${18 + (waiting.length / maxAhead) * 46}px`, opacity: 0.35 + (waiting.length / maxAhead) * 0.6 }} aria-hidden />
                  )}
                  {behind.map((item) => (
                    <span key={item.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at(item.position) }}>
                      <Glyph item={item} />
                    </span>
                  ))}
                  {readers.map((m) => (
                    <span key={m.user_id} className={cn("absolute -top-3.5 -translate-x-1/2 transition-[left] duration-700", m.user_id === meId && "z-10")} style={{ left: at(m.position) }}>
                      <Avatar person={{ id: m.user_id, display_name: m.display_name, avatar_path: m.avatar_path }} size={18} ring live={liveIds.has(m.user_id)} className={m.user_id === meId ? "rounded-full outline outline-2 outline-offset-1 outline-accent" : undefined} />
                    </span>
                  ))}
                </div>
                {party && (
                  <button type="button" onClick={() => onAfterparty(chapter.index)} className="relative z-10 ml-8 mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-gold-soft px-3 text-xs font-medium text-ink transition-transform hover:scale-[1.03] active:scale-95">
                    <PartyPopper className="size-3.5 text-gold" aria-hidden /> Afterparty
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="flex items-center gap-1.5 border-t border-line px-5 py-3 text-xs text-ink-faint">
        <PenLine className="size-3.5" aria-hidden /> Kinds and moods show only where you&apos;ve already been.
      </p>
    </div>
  );
}
