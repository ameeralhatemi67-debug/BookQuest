"use client";

import { AlertTriangle, ArrowLeft, BookOpen, BookOpenCheck, ChevronLeft, ChevronRight, List, Map as MapIcon, Maximize2, MessageSquareHeart, Minimize2, Minus, PartyPopper, PenLine, Plus, RotateCcw, ScrollText, Settings2, Sparkles, Star, Vault, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FeedbackDialog } from "@/components/app/feedback";
import { useMe, useReadingContext } from "@/components/app/providers";
import { ProgressTrack, type TrackMarker } from "@/components/room/progress-track";
import { Avatar, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger, PortalContainerContext, Sheet, SheetClose, SheetContent, Tooltip } from "@/components/ui/overlay";
import { cn, plural, timeAgo } from "@/lib/format";
import { formatPercent, type Anchor } from "@/lib/location";
import { useRoomChannel, type RoomChange, type RoomSignal, type RoomTable } from "@/lib/realtime/use-room-channel";
import { AwayStory, awayLines } from "@/components/room/away-story";
import { chaptersFrom } from "@/lib/chapters";
import { friendlyError } from "@/lib/errors";
import { featureOn, featuresOff, type FeatureKey } from "@/lib/features";
import { roomModeFor } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { AwaySummary, BookRow, Marker, RoomDetail, RoomFeatures, RoomMember, WeatherPoint } from "@/lib/types";
import { useReadingCoverage } from "./use-reading-coverage";
import { BookMap, type MapItem } from "./book-map";
import { LeaveSheet, type LeaveKind } from "./leave-sheet";
import { PollMarker, PollSheet } from "./polls";
import { PredictionsPanel, WaxSeal } from "./predictions";
import { AfterpartySheet, EchoMarker, HoldCurtain, LivePresence, MomentPill, RitualCard, WeatherChip, type LiveFriend } from "./social";
import { useRoomLayer } from "./use-room-layer";
import { EpubViewer } from "./epub-viewer";
import { MarkerButton, NoteThread, QUICK_REACTIONS, TrailList, type People } from "./notes";
import { PdfViewer } from "./pdf-viewer";
import { Soundtrack } from "./soundtrack";
import { DEFAULT_SETTINGS, FONT_SIZE, LINE_HEIGHT, ZOOM, type ReaderError, type ReaderSettings, type ReaderTheme, type TocItem, type ViewerHandle, type ViewerLocation, type ViewerMarker, type ViewerSelection } from "./types";
import { useAnnotations } from "./use-annotations";
import { resumeAnchor, useProgressSaver } from "./use-progress";

const SETTINGS_KEY = "marginalia:reader-settings:v2";
const BOOK_URL_SECONDS = 6 * 3600;
const TABLES: RoomTable[] = ["reading_progress", "annotation_markers", "annotation_contents", "annotation_replies", "annotation_reactions", "reading_unlocks", "room_members", "soundtrack_tracks", "room_activity"];

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const legacy = !raw ? localStorage.getItem("marginalia:reader-settings") : null;
    if (raw || legacy) {
      const saved = JSON.parse((raw || legacy)!) as Partial<ReaderSettings>;
      const value = typeof saved.zoom === "number" && Number.isFinite(saved.zoom) && saved.zoom > 0 ? saved.zoom : 1;
      const zoom = legacy ? (value < 1 ? ZOOM.max : 1 / value) : value;
      return { ...DEFAULT_SETTINGS, ...saved, turn: saved.turn === "scroll" ? "scroll" : "flip", zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, zoom)) };
    }
  } catch {
    // fall through
  }
  // First time: follow the system's light / dark preference.
  return { ...DEFAULT_SETTINGS, theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" };
}

// ---------------------------------------------------------------- small pieces
function IconButton({ label, onClick, children, active, badge }: { label: string; onClick?: () => void; children: ReactNode; active?: boolean; badge?: number }) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={badge ? `${label} (${badge} new)` : label}
        aria-pressed={active}
        className={cn("reader-tool relative", active && "bg-sunk text-ink")}
      >
        {children}
        {badge ? (
          <span className="absolute right-1 top-1 flex min-w-[18px] animate-pop-in items-center justify-center rounded-full bg-gold px-1 text-[11px] font-semibold leading-[18px] text-white" aria-hidden>
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

function Stepper({ label, value, onChange, min, max, step, format, reversed = false, compact = false }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; format: (value: number) => string; reversed?: boolean; compact?: boolean }) {
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
  const direction = reversed ? -1 : 1;
  return (
    <div className={compact ? "reader-zoom" : "flex items-center justify-between gap-3"}>
      {!compact && <span className="text-sm text-ink-soft">{label}</span>}
      <div className={cn("flex items-center", !compact && "gap-1")}>
        <button type="button" onClick={() => onChange(clamp(value - step * direction))} disabled={reversed ? value >= max - 1e-9 : value <= min + 1e-9} aria-label={`Decrease ${label.toLowerCase()}`} className={compact ? "reader-tool" : "flex size-10 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-sunk disabled:opacity-40"}>
          <Minus className="size-4" aria-hidden />
        </button>
        <span className={cn("text-center text-sm tabular-nums text-ink", compact ? "reader-zoom-value w-10" : "w-14")} aria-live="polite">
          {format(value)}
        </span>
        <button type="button" onClick={() => onChange(clamp(value + step * direction))} disabled={reversed ? value <= min + 1e-9 : value >= max - 1e-9} aria-label={`Increase ${label.toLowerCase()}`} className={compact ? "reader-tool" : "flex size-10 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-sunk disabled:opacity-40"}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div>
      <span className="text-sm text-ink-soft">{label}</span>
      <div role="radiogroup" aria-label={label} className="mt-1.5 flex gap-1 rounded-full bg-sunk p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn("h-9 flex-1 rounded-full text-sm font-medium transition-colors", value === option.id ? "bg-raised text-ink shadow-soft" : "text-ink-soft hover:text-ink")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const THEME_SWATCH: Record<ReaderTheme, { label: string; bg: string; fg: string }> = {
  light: { label: "Light", bg: "#fbf8f1", fg: "#2b2521" },
  sepia: { label: "Sepia", bg: "#f4e8cf", fg: "#3f3120" },
  dark: { label: "Dark", bg: "#1d1a17", fg: "#d9d0c1" },
};

function SettingsPanel({ settings, onChange, format }: { settings: ReaderSettings; onChange: (patch: Partial<ReaderSettings>) => void; format: "epub" | "pdf" }) {
  return (
    <div className="space-y-4">
      <div>
        <Segmented label="Page turns" value={settings.turn} onChange={(turn) => onChange({ turn })} options={[{ id: "flip", label: "Flip" }, { id: "scroll", label: "Scroll" }]} />
        <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
          {settings.turn === "flip"
            ? format === "pdf" && settings.zoom < 1 ? "Pages turn like a book at 100% and wider. Enlarged pages scroll." : "Tap the edges, swipe, or use the arrow keys to turn the page."
            : "Scroll straight through the book."}
        </p>
      </div>
      <div role="radiogroup" aria-label="Page theme" className="grid grid-cols-3 gap-2">
        {(Object.keys(THEME_SWATCH) as ReaderTheme[]).map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={settings.theme === theme}
            aria-label={THEME_SWATCH[theme].label}
            onClick={() => onChange({ theme })}
            className={cn("flex h-14 flex-col items-center justify-center rounded-xl border text-sm font-medium transition-shadow", settings.theme === theme ? "border-accent ring-2 ring-accent/40" : "border-line-strong")}
            style={{ background: THEME_SWATCH[theme].bg, color: THEME_SWATCH[theme].fg }}
          >
            <span className="font-display text-lg leading-none">Aa</span>
            <span className="text-[11px]">{THEME_SWATCH[theme].label}</span>
          </button>
        ))}
      </div>
      {format === "epub" ? (
        <>
          <Stepper label="Text size" value={settings.fontSize} onChange={(fontSize) => onChange({ fontSize })} {...FONT_SIZE} format={(v) => `${v}%`} />
          <Stepper label="Line spacing" value={settings.lineHeight} onChange={(lineHeight) => onChange({ lineHeight })} {...LINE_HEIGHT} format={(v) => v.toFixed(1)} />
          <Segmented label="Reading width" value={settings.width} onChange={(width) => onChange({ width })} options={[{ id: "narrow", label: "Narrow" }, { id: "medium", label: "Medium" }, { id: "wide", label: "Wide" }]} />
          <Segmented label="Typeface" value={settings.font} onChange={(font) => onChange({ font })} options={[{ id: "original", label: "Book's own" }, { id: "serif", label: "Serif" }, { id: "sans", label: "Sans" }]} />
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-ink-faint">Use + and − beside the note button. 100% fits one page; 120% fits two.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onChange({ zoom: 1 })} aria-pressed={settings.zoom === 1}>Full page</Button>
            <Button variant="secondary" size="sm" onClick={() => onChange({ zoom: ZOOM.max })} aria-pressed={settings.zoom === ZOOM.max}>Two pages</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The floating toolbar over a text selection: react in one tap, or write a note. */
function SelectionToolbar({ selection, onReact, onNote }: { selection: ViewerSelection; onReact: (emoji: string) => void; onNote: () => void }) {
  if (!selection.rect) return null;
  const width = 272;
  const left = Math.min(Math.max(8, selection.rect.left + selection.rect.width / 2 - width / 2), window.innerWidth - width - 8);
  // Above the selection when there is room (clear of the native handles on touch), else below.
  const above = selection.rect.top > 120;
  const top = Math.max(8, Math.min(window.innerHeight - 64, above ? selection.rect.top - 56 : selection.rect.top + selection.rect.height + 12));
  return (
    <div
      role="toolbar"
      aria-label="Selected passage"
      className="fixed z-40 flex animate-pop-in items-center gap-0.5 rounded-full border border-line bg-raised p-1 shadow-lift"
      style={{ left, top, width }}
      // Keep the text selection alive while tapping the toolbar.
      onMouseDown={(event) => event.preventDefault()}
    >
      {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
        <button key={emoji} type="button" onClick={() => onReact(emoji)} className="flex size-10 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-sunk" aria-label={`React with ${emoji}`}>
          {emoji}
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px bg-line" aria-hidden />
      <button type="button" onClick={onNote} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover">
        <PenLine className="size-4" aria-hidden />
        Note
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- the reader
export type ReaderBook = Pick<BookRow, "id" | "title" | "author" | "format" | "status" | "storage_path" | "size_bytes" | "has_locations" | "page_count" | "uploader_id">;

const PARTY_SEEN_KEY = (roomId: string) => `marginalia:afterparty-seen:${roomId}`;
function readPartySeen(roomId: string): Set<number> {
  try {
    return new Set((JSON.parse(localStorage.getItem(PARTY_SEEN_KEY(roomId)) ?? "[]") as number[]).filter(Number.isFinite));
  } catch {
    return new Set();
  }
}

function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (value: T) => void; tabs: { id: T; label: string; badge?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-full bg-sunk p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors", value === tab.id ? "bg-raised text-ink shadow-soft" : "text-ink-soft hover:text-ink")}
        >
          {tab.label}
          {tab.badge ? <span className="flex min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-semibold leading-[18px] text-white">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

function RateBook({ roomId, initial }: { roomId: string; initial: { stars: number; line: string | null } | null }) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [line, setLine] = useState(initial?.line ?? "");
  const [saved, setSaved] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { error } = await getSupabase().rpc("rate_book", { p_room_id: roomId, p_stars: stars, p_line: line });
    setBusy(false);
    if (error) return void toast.error(friendlyError(error));
    setSaved(true);
  }
  return (
    <div className="mt-5 w-full rounded-2xl bg-sunk/70 p-4 text-left">
      <p className="text-sm font-medium text-ink">Your final rating</p>
      <p className="text-xs text-ink-faint">Kept sealed in the vault until everyone opens it.</p>
      <div role="radiogroup" aria-label="Stars" className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => { setStars(n); setSaved(false); }} className="flex size-10 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95">
            <Star className={cn("size-6", n <= stars ? "fill-gold text-gold" : "text-line-strong")} aria-hidden />
          </button>
        ))}
      </div>
      <input value={line} onChange={(e) => { setLine(e.target.value); setSaved(false); }} maxLength={240} placeholder="One line for the vault (optional)" aria-label="One line for the vault" className="mt-2 h-10 w-full rounded-xl border border-line-strong bg-raised px-3 text-sm text-ink" />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="secondary" loading={busy} disabled={!stars || saved} onClick={() => void save()}>{saved ? "Saved" : "Save rating"}</Button>
      </div>
    </div>
  );
}

export function ReaderApp({ room: initialRoom, book }: { room: RoomDetail; book: ReaderBook }) {
  const me = useMe();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabase();
  const { setReading } = useReadingContext();
  const mode = roomModeFor(initialRoom);
  const archived = Boolean(initialRoom.archived_at);

  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  // Client-only component (see reader-loader.tsx), so localStorage is available on first render.
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; body: string; retry?: boolean } | null>(null);
  const [loadFraction, setLoadFraction] = useState<number | null>(0);
  const [ready, setReady] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [location, setLocation] = useState<ViewerLocation | null>(null);
  const [members, setMembers] = useState<RoomMember[]>(initialRoom.members);
  const [people, setPeople] = useState<People>(() => new Map(initialRoom.people.map((p) => [p.user_id, { id: p.user_id, display_name: p.display_name, avatar_path: p.avatar_path }])));
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<"map" | "trail" | null>(null);
  const [mapTab, setMapTab] = useState<"map" | "contents">("map");
  const [trailTab, setTrailTab] = useState<"notes" | "predictions">("notes");
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [unwrap, setUnwrap] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<ViewerSelection | null>(null);
  const [leaveKind, setLeaveKind] = useState<LeaveKind>("note");
  const [activePoll, setActivePoll] = useState<string | null>(null);
  const [party, setParty] = useState<number | null>(null);
  const [partySeen, setPartySeen] = useState<Set<number>>(() => readPartySeen(initialRoom.id));
  const [readyDismissed, setReadyDismissed] = useState(0);
  const [selection, setSelection] = useState<ViewerSelection | null>(null);
  const [reveal, setReveal] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [musicRevision, setMusicRevision] = useState(0);
  const [lens, setLens] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherPoint[] | null>(null);
  const [together, setTogether] = useState<string | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const [partner, setPartner] = useState<{ id: string; progress: number } | null>(null);
  const [knocks, setKnocks] = useState<Map<string, number>>(new Map());
  const [knocked, setKnocked] = useState<{ from: AvatarPerson; at: number } | null>(null);
  const [away, setAway] = useState<AwaySummary | null>(null);
  const [peeked, setPeeked] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState(() => Date.now());
  const deepLinked = useRef(false);
  const weatherSeen = useRef(new Set<number>());
  const lastTurnSent = useRef(0);
  const showAfterpartyRef = useRef<(index: number) => void>(() => {});
  const markersRef = useRef<Map<string, Marker>>(new Map());

  const annotations = useAnnotations({ roomId: initialRoom.id, meId: me.user_id });
  // Stable pieces of the annotations API, so memoised values below only change when the data does.
  const { markUnlocked, loadNotes, markSeen, createNote, isOpen, onChange: onAnnotationChange, resync: resyncAnnotations } = annotations;
  // Computed once: where to open the book.
  const [initialAnchor] = useState<Anchor | null>(() => resumeAnchor(initialRoom.id, book.format, initialRoom.my));
  // Switching between flip and scroll reopens an EPUB in its other flow, at the same place.
  const [viewerAnchor, setViewerAnchor] = useState<Anchor | null>(initialAnchor);
  const locationRef = useRef<ViewerLocation | null>(null);

  // ------------------------------------------------------------ the social layer
  const social = useRoomLayer({ roomId: initialRoom.id, bookId: book.id, toc, ready });
  const { refresh: refreshLayer } = social;
  const layer = social.layer;
  const features = useMemo<RoomFeatures>(() => layer?.features ?? initialRoom.features ?? {}, [layer?.features, initialRoom.features]);
  const on = useCallback((key: FeatureKey) => featureOn(features, key), [features]);
  const activeLens = on("friend_lens") ? lens : null;
  const chapters = useMemo(
    () => chaptersFrom(layer?.outline ?? toc.filter((t) => t.progress !== null).map((t) => ({ label: t.label, start: t.progress!, depth: t.depth }))),
    [layer?.outline, toc],
  );
  const layerRef = useRef(layer);
  const featuresRef = useRef(features);
  const togetherRef = useRef(together);
  useLayoutEffect(() => {
    layerRef.current = layer;
    featuresRef.current = features;
    togetherRef.current = together;
  });

  // ------------------------------------------------------------ settings
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    if (patch.turn && locationRef.current) setViewerAnchor(locationRef.current.anchor);
    setSettings((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // not persisted; still applied
      }
      return next;
    });
  }, []);

  // ------------------------------------------------------------ the book file (private → short-lived signed URL)
  const bookUnavailable = book.status !== "ready" || !book.storage_path;
  const fatal = bookUnavailable
    ? {
        title: book.status === "disabled" ? "This book has been disabled" : "This book is no longer available",
        body: book.status === "disabled" ? "An admin switched this book off. Your notes and progress are kept." : "The person who uploaded it removed it. Your room, notes and journey are still here.",
        retry: false,
      }
    : failure;

  useEffect(() => {
    let cancelled = false;
    if (bookUnavailable || !book.storage_path) return;
    supabase.storage
      .from("books")
      .createSignedUrl(book.storage_path, BOOK_URL_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setFailure({ title: "We couldn't open this book", body: "You may no longer have access to it, or the connection dropped. Try again in a moment.", retry: true });
          return;
        }
        setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, bookUnavailable, book.storage_path, supabase]);

  const onViewerError = useCallback((error: ReaderError) => {
    const copy: Record<ReaderError["code"], { title: string; body: string; retry?: boolean }> = {
      download: { title: "The book didn't finish loading", body: "Check your connection and try again. Your place is saved.", retry: true },
      unauthorized: { title: "You can't open this book", body: "Your access to it may have changed. Go back to the room to check.", retry: true },
      corrupt: { title: "This book can't be displayed", body: error.message },
      unsupported: { title: "This book can't be displayed", body: error.message },
    };
    setFailure(copy[error.code]);
  }, []);

  // ------------------------------------------------------------ progress
  const onUnlocked = useCallback(
    (ids: string[]) => {
      markUnlocked(ids);
      setReveal(ids);
      refreshLayer();
    },
    [markUnlocked, refreshLayer],
  );
  const { report, saveNow, status: saveStatus, furthest } = useProgressSaver({
    roomId: initialRoom.id,
    initialFurthest: initialRoom.my?.furthest ?? 0,
    lockedPositions: annotations.lockedPositions,
    onUnlocked,
    onCompleted: useCallback(() => setFinished(true), []),
  });

  // Every new percent can open predictions, polls and weather: re-read the layer.
  const furthestPercent = Math.floor(furthest * 100);
  useEffect(() => {
    if (furthestPercent > 0) refreshLayer();
  }, [furthestPercent, refreshLayer]);

  const completion = useCallback(() => setFinished(true), []);
  const reading = useReadingCoverage({ roomId: initialRoom.id, userId: me.user_id, location,
    paused: !ready || archived || Boolean(panel || activeNote || composer || activePoll || party !== null), initial: initialRoom.my, onCompleted: completion });

  // ------------------------------------------------------------ live room
  const memberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshMembers = useCallback(() => {
    if (memberTimer.current) return;
    memberTimer.current = setTimeout(async () => {
      memberTimer.current = null;
      const { data, error } = await supabase.rpc("room_detail", { p_room_id: initialRoom.id });
      if (error) {
        if (error.message === "room_not_found") router.replace("/home");
        return;
      }
      const detail = data as RoomDetail;
      if (!detail.is_member) return router.replace(`/rooms/${initialRoom.id}`);
      setMembers(detail.members);
      setPeople(new Map(detail.people.map((p) => [p.user_id, { id: p.user_id, display_name: p.display_name, avatar_path: p.avatar_path }])));
    }, 400);
  }, [initialRoom.id, router, supabase]);

  useEffect(() => () => {
    if (memberTimer.current) clearTimeout(memberTimer.current);
  }, []);

  const personOf = useCallback((id: string): AvatarPerson => people.get(id) ?? { id, display_name: "A former member", avatar_path: null }, [people]);

  const onChange = useCallback(
    (change: RoomChange) => {
      if (change.table === "soundtrack_tracks") {
        setMusicRevision((n) => n + 1);
        refreshLayer();
      } else if (change.table === "reading_progress" || change.table === "room_members") refreshMembers();
      else if (change.table === "room_activity") refreshLayer();
      else onAnnotationChange(change);
    },
    [onAnnotationChange, refreshMembers, refreshLayer],
  );
  const onResync = useCallback(() => {
    refreshMembers();
    resyncAnnotations();
    refreshLayer();
    setMusicRevision((n) => n + 1);
  }, [resyncAnnotations, refreshMembers, refreshLayer]);

  const onSignal = useCallback((signal: RoomSignal) => {
    if (signal.kind === "changed") return refreshLayer();
    if (!featuresRef.current || featuresRef.current.live_ghosts === false) return;
    if (signal.kind === "knock") {
      if (signal.to && signal.to !== me.user_id) return;
      const at = Date.now();
      setKnocks((current) => new Map(current).set(signal.from, at));
      setKnocked({ from: personOf(signal.from), at });
      setTimeout(() => {
        setKnocked((current) => (current?.at === at ? null : current));
        setKnocks((current) => {
          if (current.get(signal.from) !== at) return current;
          const next = new Map(current);
          next.delete(signal.from);
          return next;
        });
      }, 4800);
    } else if (signal.kind === "together") {
      if (signal.to !== me.user_id) return;
      if (signal.action === "invite") setInvitedBy(signal.from);
      else if (signal.action === "accept") {
        setTogether(signal.from);
        toast.success(`Reading together with ${personOf(signal.from).display_name.split(" ")[0]}`);
      } else if (signal.action === "leave") {
        setTogether((current) => (current === signal.from ? null : current));
        setPartner(null);
      }
    } else if (signal.kind === "turn") {
      if (togetherRef.current === signal.from) setPartner({ id: signal.from, progress: signal.progress });
    }
  }, [me.user_id, personOf, refreshLayer]);

  const { status: liveStatus, live, send } = useRoomChannel({
    roomId: initialRoom.id,
    userId: me.user_id,
    tables: TABLES,
    onChange,
    onResync,
    onSignal,
    fastPresence: Boolean(together),
    // Rough position only, and only occasionally (the hook throttles). Finer while reading together.
    presence: {
      user_id: me.user_id,
      reading: true,
      progress: location ? (together ? Math.round(location.reach * 500) / 500 : Math.round(location.reach * 50) / 50) : undefined,
      label: together ? location?.label : undefined,
      together,
    },
  });
  const readingNow = useMemo(() => new Set([...live.values()].filter((p) => p.reading).map((p) => p.user_id)), [live]);
  const announceChange = useCallback(() => {
    refreshLayer();
    send({ kind: "changed", from: me.user_id, what: "layer" });
  }, [me.user_id, refreshLayer, send]);

  const onRelocate = useCallback(
    (next: ViewerLocation) => {
      locationRef.current = next;
      setLocation(next);
      setSelection(null);
      // "Just opened" belongs to the page it happened on.
      setReveal((current) => {
        const kept = current.filter((id) => {
          const marker = markersRef.current.get(id);
          return marker && marker.position >= next.progress - 0.02 && marker.position <= next.reach + 0.02;
        });
        return kept.length === current.length ? current : kept;
      });
      setReading({ roomId: initialRoom.id, bookId: book.id, label: next.label, progress: next.reach, featuresOff: featuresOff(featuresRef.current) });
      if (!archived) report(next);
      // Reaction weather: once per page, only what the room felt about what you can now see.
      const current = layerRef.current;
      if (current && featuresRef.current.reaction_weather !== false) {
        const key = Math.round(next.progress * 500);
        if (!weatherSeen.current.has(key)) {
          const points = current.weather.filter((w) => w.p >= next.progress - 0.0015 && w.p <= next.reach + 0.0015);
          if (points.length) {
            weatherSeen.current.add(key);
            setWeather(points);
          }
        }
      }
      // Reading together: page turns travel instantly, never the page itself.
      const now = Date.now();
      if (togetherRef.current && now - lastTurnSent.current > 700) {
        lastTurnSent.current = now;
        send({ kind: "turn", from: me.user_id, progress: Math.round(next.reach * 1000) / 1000 });
      }
    },
    [archived, book.id, initialRoom.id, me.user_id, report, send, setReading],
  );

  useEffect(() => () => setReading({}), [setReading]);

  // A minute clock for rituals with a date.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // While you were away: told once, when you arrive.
  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("room_away", { p_room_id: initialRoom.id, p_mark: true }).then(({ data }) => {
      const summary = data as AwaySummary | null;
      if (cancelled || !summary?.since) return;
      if (Date.now() - new Date(summary.since).getTime() < 45 * 60_000) return;
      if (summary.members.length || summary.afterparties.length) setAway(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [initialRoom.id, supabase]);

  // ------------------------------------------------------------ friends on the rail
  const togetherActive = together && readingNow.has(together) ? together : null;
  const trackMembers = useMemo(
    () => members.map((m) => {
      if (m.user_id === me.user_id) return { ...m, ...reading.stats, position: location?.progress ?? m.position, furthest: Math.max(m.furthest, furthest), label: location?.label ?? m.label };
      if (features.live_ghosts === false || !readingNow.has(m.user_id)) return m;
      // Live ghosts: a friend reading right now moves on the rail as they read.
      const progress = partner?.id === m.user_id ? partner.progress : live.get(m.user_id)?.progress;
      return typeof progress === "number" ? { ...m, position: progress } : m;
    }),
    [members, me.user_id, furthest, location, reading.stats, features.live_ghosts, readingNow, partner, live],
  );

  // ------------------------------------------------------------ markers for the viewer
  const polls = useMemo(() => (on("polls") ? layer?.polls ?? [] : []), [on, layer?.polls]);
  const predictions = useMemo(() => (on("predictions") ? layer?.predictions ?? [] : []), [on, layer?.predictions]);
  const echoes = useMemo(() => (on("echoes") ? social.echoes : []), [on, social.echoes]);
  const viewerMarkers = useMemo<ViewerMarker[]>(
    () => [
      ...annotations.markers
        .filter((marker) => !activeLens || marker.author_id === activeLens)
        .map((marker) => {
          const unlock = annotations.unlocks.get(marker.id);
          return {
            id: marker.id,
            kind: marker.kind === "package" ? ("package" as const) : ("note" as const),
            title: marker.package_title,
            authorId: marker.author_id,
            attention: marker.attention,
            anchor: marker.anchor,
            position: marker.position,
            open: isOpen(marker),
            seen: marker.author_id === me.user_id || Boolean(unlock?.seen_at),
            fresh: annotations.fresh.has(marker.id),
          };
        }),
      ...polls
        .filter((poll) => !activeLens || poll.author_id === activeLens)
        .map((poll) => ({ id: `poll:${poll.id}`, kind: "poll" as const, authorId: poll.author_id, anchor: poll.anchor, position: poll.position, open: poll.reached, seen: poll.my_vote !== null || poll.author_id === me.user_id, fresh: false })),
      // Echoes surface only as you reach them again.
      ...(activeLens ? [] : echoes)
        .filter((echo) => echo.position <= furthest + 1e-6)
        .map((echo) => ({ id: `echo:${echo.id}`, kind: "echo" as const, authorId: echo.mine ? me.user_id : echo.author_id, anchor: echo.anchor, position: echo.position, open: true, seen: true, fresh: false })),
    ],
    [annotations.markers, annotations.unlocks, annotations.fresh, isOpen, me.user_id, polls, echoes, furthest, activeLens],
  );
  const trackMarkers = useMemo<TrackMarker[]>(() => [
    ...annotations.markers.map((m) => ({ id: m.id, position: m.position, authorId: m.author_id, open: isOpen(m), kind: m.kind === "package" ? ("package" as const) : ("note" as const) })),
    ...predictions.map((p) => ({ id: `prediction:${p.id}`, position: p.opens_at, authorId: p.author_id, open: p.reached, kind: "prediction" as const })),
    ...polls.map((p) => ({ id: `poll:${p.id}`, position: p.position, authorId: p.author_id, open: p.reached, kind: "poll" as const })),
  ], [annotations.markers, isOpen, predictions, polls]);
  const mapItems = useMemo<MapItem[]>(() => [
    ...annotations.markers.map((m) => ({ id: m.id, kind: m.kind === "package" ? ("package" as const) : ("note" as const), position: m.position, authorId: m.author_id, open: isOpen(m) })),
    ...predictions.map((p) => ({ id: `prediction:${p.id}`, kind: "prediction" as const, position: p.opens_at, authorId: p.author_id, open: p.reached || p.author_id === me.user_id })),
    ...polls.map((p) => ({ id: `poll:${p.id}`, kind: "poll" as const, position: p.position, authorId: p.author_id, open: p.reached })),
    ...(on("soundtrack") ? layer?.cues ?? [] : []).map((c, i) => ({ id: `cue:${i}`, kind: "cue" as const, position: c.position, authorId: c.author_id, open: c.open })),
  ], [annotations.markers, isOpen, predictions, polls, layer?.cues, on, me.user_id]);
  const markerById = useMemo(() => new Map(annotations.markers.map((m) => [m.id, m])), [annotations.markers]);
  useLayoutEffect(() => {
    markersRef.current = markerById;
  });
  const pollById = useMemo(() => new Map(polls.map((p) => [p.id, p])), [polls]);
  const echoById = useMemo(() => new Map(echoes.map((e) => [e.id, e])), [echoes]);
  const unseenCount = useMemo(() => viewerMarkers.filter((m) => (m.kind === "note" || m.kind === "package") && m.open && !m.seen).length, [viewerMarkers]);
  const aheadCount = useMemo(() => annotations.markers.filter((m) => !isOpen(m)).length, [annotations.markers, isOpen]);
  const readyPredictions = useMemo(() => predictions.filter((p) => p.reached && !p.revealed_at), [predictions]);

  const openNote = useCallback(
    (marker: Marker) => {
      setPanel(null);
      setComposer(null);
      setActivePoll(null);
      setParty(null);
      // The first opening of a package addressed to you is an unwrapping.
      if (marker.kind === "package" && marker.recipient_id === me.user_id && !annotations.unlocks.get(marker.id)?.seen_at) {
        setUnwrap((current) => new Set(current).add(marker.id));
      }
      setActiveNote(marker.id);
      void loadNotes([marker.id]);
      void markSeen([marker.id]);
      setReveal((current) => current.filter((id) => id !== marker.id));
    },
    [loadNotes, markSeen, annotations.unlocks, me.user_id],
  );

  const renderMarker = useCallback(
    (marker: ViewerMarker) => {
      if (marker.kind === "poll") {
        const poll = pollById.get(marker.id.slice(5));
        if (!poll) return null;
        return <PollMarker marker={marker} author={personOf(marker.authorId)} voted={poll.my_vote !== null || poll.author_id === me.user_id} onOpen={() => setActivePoll(poll.id)} />;
      }
      if (marker.kind === "echo") {
        const echo = echoById.get(marker.id.slice(5));
        return echo ? <EchoMarker echo={echo} me={{ id: me.user_id, display_name: me.display_name, avatar_path: me.avatar_path }} /> : null;
      }
      const source = markerById.get(marker.id);
      if (!source) return null;
      return <MarkerButton marker={marker} author={personOf(marker.authorId)} onOpen={() => openNote(source)} viewerId={me.user_id} bundle={annotations.notes.get(marker.id)} animated={features.animated_notes !== false} onPreview={() => { void loadNotes([marker.id]); void markSeen([marker.id]); }} />;
    },
    [markerById, pollById, echoById, openNote, personOf, me.user_id, me.display_name, me.avatar_path, annotations.notes, loadNotes, markSeen, features.animated_notes],
  );

  // Deep link from a notification: /read/{room}?note={marker}
  const noteParam = searchParams.get("note");
  useEffect(() => {
    if (!noteParam || deepLinked.current || !ready || !annotations.loaded) return;
    deepLinked.current = true;
    const marker = markerById.get(noteParam);
    if (!marker || !isOpen(marker)) return;
    void viewer.current?.goToAnchor(marker.anchor).then(() => openNote(marker));
  }, [noteParam, ready, annotations.loaded, isOpen, markerById, openNote]);

  // Deep link from the room page: /read/{room}?party={chapter}
  const partyParam = searchParams.get("party");
  const partyLinked = useRef(false);
  useEffect(() => {
    if (partyParam === null || partyLinked.current || !ready || !layer) return;
    partyLinked.current = true;
    const index = Number(partyParam);
    if (layer.afterparties.some((a) => a.chapter_index === index)) showAfterpartyRef.current(index);
  }, [partyParam, ready, layer]);

  // ------------------------------------------------------------ writing
  const leaveKinds = useMemo<LeaveKind[]>(() => [
    "note",
    ...(on("packages") && members.length > 1 ? (["package"] as const) : []),
    ...(on("predictions") ? (["prediction"] as const) : []),
    ...(on("polls") ? (["poll"] as const) : []),
  ], [on, members.length]);

  const startNote = useCallback((from: ViewerSelection | null, kind: LeaveKind = "note") => {
    const target = from ?? viewer.current?.currentSelection() ?? null;
    if (!target) return;
    saveNow();
    setSelection(null);
    setActiveNote(null);
    setActivePoll(null);
    setPanel(null);
    setChrome(true);
    setLeaveKind(kind);
    setComposer(target);
  }, [saveNow]);

  const quickReact = useCallback(
    async (target: ViewerSelection, emoji: string) => {
      setSelection(null);
      viewer.current?.clearSelection();
      saveNow();
      try {
        await createNote({ anchor: target.anchor, position: target.position, label: target.label, emoji, quote: target.quote });
        refreshLayer();
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [createNote, saveNow, refreshLayer],
  );

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------------------ moments
  const revealMarkers = reveal.map((id) => markerById.get(id)).filter((m): m is Marker => Boolean(m));
  const active = activeNote ? markerById.get(activeNote) : undefined;
  const poll = activePoll ? pollById.get(activePoll) : undefined;
  const afterparties = useMemo(() => (on("afterparty") ? layer?.afterparties ?? [] : []), [on, layer?.afterparties]);
  const freshParty = afterparties.filter((a) => !partySeen.has(a.chapter_index)).at(-1);
  const openParty = party !== null ? afterparties.find((a) => a.chapter_index === party) : undefined;
  const markPartySeen = useCallback((indexes: number[]) => {
    setPartySeen((current) => {
      const next = new Set([...current, ...indexes]);
      try {
        localStorage.setItem(PARTY_SEEN_KEY(initialRoom.id), JSON.stringify([...next]));
      } catch {
        // per-device convenience only
      }
      return next;
    });
  }, [initialRoom.id]);
  const showAfterparty = useCallback((index: number) => {
    setPanel(null);
    setActiveNote(null);
    setParty(index);
    markPartySeen([index]);
    const target = afterparties.find((a) => a.chapter_index === index);
    if (target) {
      const ids = annotations.markers.filter((m) => m.position >= target.start_at && m.position < target.end_at && isOpen(m)).map((m) => m.id);
      if (ids.length) void loadNotes(ids);
    }
  }, [afterparties, annotations.markers, isOpen, loadNotes, markPartySeen]);
  useLayoutEffect(() => {
    showAfterpartyRef.current = showAfterparty;
  });

  const rituals = useMemo(() => (on("rituals") ? (layer?.rituals ?? []).filter((r) => !r.ended_at) : []), [on, layer?.rituals]);
  const reach = location?.reach ?? furthest;
  const hold = rituals.find((r) => r.kind === "hold_until" && r.until_at && new Date(r.until_at).getTime() > clock && r.target_at !== null && reach > r.target_at + 0.003 && !peeked.has(r.id) && r.created_by !== undefined);
  const ritualNow = rituals
    .filter((r) => r.kind !== "hold_until" && !r.members.find((m) => m.user_id === me.user_id)?.done && (r.target_at === null || r.target_at > (location?.progress ?? 0) - 0.001))
    .filter((r) => r.kind !== "vote_before" || Boolean(r.poll_id && pollById.get(r.poll_id)?.reached))
    .sort((a, b) => (a.target_at ?? 2) - (b.target_at ?? 2))[0];

  const liveFriends = useMemo<LiveFriend[]>(() => (features.live_ghosts === false ? [] : [...live.values()]
    .filter((p) => p.reading && p.user_id !== me.user_id && people.has(p.user_id))
    .map((p) => ({ id: p.user_id, person: personOf(p.user_id), label: p.label, together: p.together === me.user_id }))), [features.live_ghosts, live, me.user_id, people, personOf]);

  const awayStory = useMemo(() => awayLines(away, personOf, chapters), [away, personOf, chapters]);
  const canModerate = initialRoom.my_role === "owner" || initialRoom.my_role === "moderator";
  const progressNow = location?.reach ?? initialRoom.my?.furthest ?? 0;
  const theme = settings.theme;
  const atEnd = furthest >= 0.98 || Boolean(initialRoom.my?.completed_at);

  return (
    <PortalContainerContext.Provider value={root}>
      <div
        ref={setRoot}
        data-testid="reader"
        data-ready={ready ? "true" : "false"}
        data-save-status={saveStatus}
        data-progress={progressNow.toFixed(4)}
        data-read-coverage={reading.stats.read_coverage ?? 0}
        data-reading-state={reading.state}
        data-furthest={furthest.toFixed(4)}
        data-live={liveStatus}
        data-reader-theme={theme}
        data-turn={settings.turn}
        data-lens={activeLens ?? undefined}
        data-focus={chrome ? "false" : "true"}
        className={cn("reader-root fixed inset-0 flex flex-col overflow-hidden", theme === "dark" && "dark")}>
        {/* ---------------------------------------------------------- top bar */}
        <header
          inert={!chrome}
          className={cn(
            "reader-header pt-safe absolute inset-x-0 top-0 z-20 transition-transform duration-300",
            !chrome && "-translate-y-full",
          )}
        >
          <div className="reader-header-content mx-auto max-w-7xl px-1 sm:px-6">
            <div className="reader-heading">
              <Link href={`/rooms/${initialRoom.id}`} className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label={`Back to ${initialRoom.name}`}>
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
              <div className="min-w-0 flex-1 px-1">
                <p className="truncate font-display text-base leading-tight text-ink sm:text-xl">{book.title}</p>
                <p className="truncate text-xs text-ink-soft">{location?.label ?? initialRoom.name}</p>
              </div>
            </div>
            <div className="reader-actions">
              {book.format === "pdf" && <Stepper label="Zoom" value={settings.zoom} onChange={(zoom) => updateSettings({ zoom })} {...ZOOM} reversed compact format={(v) => `${Math.round(v * 100)}%`} />}
              {!archived && (
                <IconButton label="Leave a note here" onClick={() => startNote(null)}>
                  <PenLine className="size-5" aria-hidden />
                </IconButton>
              )}
              <IconButton label="What's been left in this book" onClick={() => setPanel(panel === "trail" ? null : "trail")} active={panel === "trail"} badge={unseenCount + readyPredictions.length}>
                <Sparkles className="size-5" aria-hidden />
              </IconButton>
              <IconButton label={on("book_map") ? "Map and contents" : "Contents"} onClick={() => { setMapTab(on("book_map") ? "map" : "contents"); setPanel(panel === "map" ? null : "map"); }} active={panel === "map"}>
                {on("book_map") ? <MapIcon className="size-5" aria-hidden /> : <List className="size-5" aria-hidden />}
              </IconButton>
              {on("soundtrack") && <Soundtrack roomId={initialRoom.id} meId={me.user_id} location={location} furthest={furthest} revision={musicRevision} archived={archived} canModerate={canModerate} />}
              <Popover>
                <Tooltip label="Reading settings" side="bottom">
                  <PopoverTrigger className="flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label="Reading settings">
                    <Settings2 className="size-5" aria-hidden />
                  </PopoverTrigger>
                </Tooltip>
                <PopoverContent align="end" className="w-[min(320px,calc(100vw-1rem))]">
                  <SettingsPanel settings={settings} onChange={updateSettings} format={book.format} />
                  <div className="mt-4 border-t border-line pt-3">
                    <FeedbackDialog>
                      <button type="button" className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-sm text-ink-soft hover:bg-sunk hover:text-ink">
                        <MessageSquareHeart className="size-4 text-accent" aria-hidden />
                        Send feedback about this page
                      </button>
                    </FeedbackDialog>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </header>

        {/* ---------------------------------------------------------- the book */}
        <main className="reader-stage relative min-h-0 flex-1" style={{ color: "var(--page-ink)" }}>
          <div className="reader-book relative h-full min-w-0" data-format={book.format}>
            {fatal ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="max-w-md text-center" role="alert">
                  <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-sunk text-ink-soft">
                    <AlertTriangle className="size-5" aria-hidden />
                  </span>
                  <h1 className="mt-4 text-2xl text-ink">{fatal.title}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{fatal.body}</p>
                  <div className="mt-5 flex justify-center gap-2">
                    {fatal.retry && (
                      <Button
                        onClick={() => {
                          setFailure(null);
                          setUrl(null);
                          setReady(false);
                          setAttempt((n) => n + 1);
                        }}
                        icon={<RotateCcw className="size-4" aria-hidden />}
                      >
                        Try again
                      </Button>
                    )}
                    <Link href={`/rooms/${initialRoom.id}`} className={buttonClass("secondary")}>
                      Back to the room
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {url && book.format === "epub" && (
                  <EpubViewer
                    key={`${url}-${attempt}-${settings.turn}`}
                    ref={viewer}
                    bookId={book.id}
                    url={url}
                    size={book.size_bytes}
                    hasLocations={book.has_locations}
                    locationsPath={`${book.uploader_id}/${book.id}/locations.json`}
                    settings={settings}
                    initialAnchor={viewerAnchor}
                    markers={viewerMarkers}
                    draftAnchor={composer?.anchor}
                    renderMarker={renderMarker}
                    onReady={(info) => {
                      setToc(info.toc);
                      setReady(true);
                    }}
                    onRelocate={onRelocate}
                    onSelection={setSelection}
                    onAddNote={(target) => { if (!archived) startNote(target); }}
                    onToggleChrome={() => setChrome((c) => !c)}
                    onError={onViewerError}
                    onLoadProgress={setLoadFraction}
                  />
                )}
                {url && book.format === "pdf" && (
                  <PdfViewer
                    key={`${url}-${attempt}`}
                    ref={viewer}
                    bookId={book.id}
                    url={url}
                    settings={settings}
                    initialAnchor={viewerAnchor}
                    markers={viewerMarkers}
                    draftAnchor={composer?.anchor}
                    renderMarker={renderMarker}
                    onReady={(info) => {
                      setToc(info.toc);
                      setReady(true);
                    }}
                    onRelocate={onRelocate}
                    onSelection={setSelection}
                    onAddNote={(target) => { if (!archived) startNote(target); }}
                    onToggleChrome={() => setChrome((c) => !c)}
                    onError={onViewerError}
                    onLoadProgress={setLoadFraction}
                  />
                )}
                {!ready && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4" style={{ background: "var(--page)" }} role="status" aria-live="polite">
                    <Spinner className="size-6" label="Opening the book" />
                    <p className="text-sm text-ink-soft">{loadFraction !== null && loadFraction > 0 && loadFraction < 1 ? `Opening the book… ${Math.floor(loadFraction * 100)}%` : "Opening the book…"}</p>
                  </div>
                )}
                {hold && ready && (
                  <HoldCurtain
                    ritual={hold}
                    onBack={() => void viewer.current?.goToProgress(Math.max(0, (hold.target_at ?? 0) - 0.004))}
                    onPeek={() => setPeeked((current) => new Set(current).add(hold.id))}
                  />
                )}
              </>
            )}
            <button type="button" onClick={() => viewer.current?.prev()} className="reader-turn reader-tool reader-turn-prev" aria-label="Previous page" disabled={!ready}>
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button type="button" onClick={() => viewer.current?.next()} className="reader-turn reader-tool reader-turn-next" aria-label="Next page" disabled={!ready}>
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        </main>

        <button type="button" className="reader-focus reader-tool" onClick={() => setChrome((c) => !c)} aria-label={chrome ? "Focus on the book" : "Show reading controls"} aria-pressed={!chrome}>
          {chrome ? <Maximize2 className="size-4" aria-hidden /> : <Minimize2 className="size-4" aria-hidden />}
        </button>

        {/* ---------------------------------------------------------- lens */}
        {activeLens && (
          <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--reader-header-height)+env(safe-area-inset-top)+12px)] z-30 flex justify-center px-4">
            <div className="pointer-events-auto flex animate-fade-up items-center gap-2 rounded-full bg-ink py-1 pl-1 pr-1 text-paper shadow-lift" role="status">
              <Avatar person={personOf(activeLens)} size={28} />
              <span className="text-sm">{activeLens === me.user_id ? "Your trail" : `${personOf(activeLens).display_name.split(" ")[0]}'s trail`}</span>
              <button type="button" onClick={() => setLens(null)} className="flex h-8 items-center rounded-full bg-paper/15 px-3 text-xs font-medium hover:bg-paper/25">Everyone</button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- corner: weather, live, ritual */}
        <div className="reader-corner pointer-events-none absolute z-20 flex flex-col items-end gap-2">
          {weather && <WeatherChip key={weather.map((w) => `${w.p}${w.e}`).join()} points={weather} onDone={() => setWeather(null)} />}
          <LivePresence
            friends={liveFriends}
            together={togetherActive}
            invitedBy={invitedBy && readingNow.has(invitedBy) ? invitedBy : null}
            knocked={knocked}
            onKnock={(id) => {
              send({ kind: "knock", from: me.user_id, to: id });
              toast(`Knocked. ${personOf(id).display_name.split(" ")[0]} will see you're reading now.`);
            }}
            onInvite={(id) => {
              send({ kind: "together", from: me.user_id, to: id, action: "invite" });
              toast(`Asked ${personOf(id).display_name.split(" ")[0]} to read together.`);
            }}
            onAccept={() => {
              if (!invitedBy) return;
              send({ kind: "together", from: me.user_id, to: invitedBy, action: "accept" });
              setTogether(invitedBy);
              setInvitedBy(null);
            }}
            onLeave={() => {
              if (together) send({ kind: "together", from: me.user_id, to: together, action: "leave" });
              setTogether(null);
              setPartner(null);
            }}
          />
          {ritualNow && !archived && (
            <RitualCard
              ritual={ritualNow}
              meId={me.user_id}
              onAct={() => {
                if (ritualNow.kind === "predict_before") startNote(null, "prediction");
                else if (ritualNow.kind === "vote_before" && ritualNow.poll_id) setActivePoll(ritualNow.poll_id);
                else toast("Open the music button in the header to add a song at this page.");
              }}
              onCheckIn={async () => {
                const { error } = await supabase.rpc("checkin_ritual", { p_ritual_id: ritualNow.id });
                if (error) return void toast.error(friendlyError(error));
                announceChange();
              }}
            />
          )}
        </div>

        {/* ---------------------------------------------------------- moments */}
        {!activeNote && !composer && !activePoll && party === null && (
          <div className="reader-moments pointer-events-none absolute inset-x-0 z-30 flex flex-col items-center gap-2 px-4">
            {revealMarkers.length > 0 && (
              <MomentPill
                icon={<Avatar person={personOf(revealMarkers[0].author_id)} size={30} className="animate-unlock rounded-full" />}
                action="Open"
                onAction={() => (revealMarkers.length === 1 ? openNote(revealMarkers[0]) : (setTrailTab("notes"), setPanel("trail"), setReveal([])))}
                onDismiss={() => setReveal([])}
              >
                {revealMarkers.length === 1 ? (
                  revealMarkers[0].kind === "package" ? (
                    <><span className="font-medium">{personOf(revealMarkers[0].author_id).display_name.split(" ")[0]}</span>&apos;s package is ready to unwrap</>
                  ) : (
                    <><span className="font-medium">{personOf(revealMarkers[0].author_id).display_name.split(" ")[0]}</span> left something here</>
                  )
                ) : (
                  <>{plural(revealMarkers.length, "thing")} just opened for you</>
                )}
              </MomentPill>
            )}
            {readyPredictions.length > readyDismissed && (
              <MomentPill icon={<WaxSeal size="sm" />} action="Open" onAction={() => { setTrailTab("predictions"); setPanel("trail"); }} onDismiss={() => setReadyDismissed(readyPredictions.length)}>
                {readyPredictions.length === 1 ? "A prediction is ready to open" : `${readyPredictions.length} predictions are ready to open`}
              </MomentPill>
            )}
            {freshParty && (
              <MomentPill icon={<span className="grid size-[30px] place-items-center rounded-full bg-gold-soft text-gold"><PartyPopper className="size-4" aria-hidden /></span>} action="Go" onAction={() => showAfterparty(freshParty.chapter_index)} onDismiss={() => markPartySeen([freshParty.chapter_index])}>
                The {freshParty.label ?? "chapter"} afterparty is open
              </MomentPill>
            )}
          </div>
        )}

        {selection && !composer && !archived && <SelectionToolbar selection={selection} onReact={(emoji) => void quickReact(selection, emoji)} onNote={() => startNote(selection)} />}

        {/* ---------------------------------------------------------- shared progress */}
        <aside
          aria-label="Reading progress"
          className={cn(
            "reader-progress absolute z-20 flex flex-col items-center gap-2 transition-transform duration-300",
            !chrome && "-translate-x-full",
          )}
          inert={!chrome}
        >
          <span className="flex flex-col items-center text-[11px] tabular-nums text-ink-soft" aria-label={`${formatPercent(reading.stats.read_coverage ?? 0)} read`}>
            {formatPercent(reading.stats.read_coverage ?? 0)}<span className="text-[9px]">read</span>
          </span>
          <ProgressTrack members={trackMembers} meId={me.user_id} mode={mode} markers={trackMarkers} liveIds={readingNow} size="sm" orientation="vertical" className="flex-1" lens={activeLens} onLens={on("friend_lens") ? setLens : undefined} knocks={knocks} />
          <Popover>
            <PopoverTrigger className="reader-tool" aria-label="Reading status">
              {saveStatus === "error" || liveStatus === "offline" ? <WifiOff className="size-4 text-danger" aria-hidden /> : <BookOpenCheck className="size-4" aria-hidden />}
            </PopoverTrigger>
            <PopoverContent side="right" className="w-64 text-sm text-ink-soft">
              <p className="font-medium text-ink">{formatPercent(reading.stats.read_coverage ?? 0)} read · {formatPercent(progressNow)} reached</p>
              <p className="capitalize">{reading.state}{reading.state === "paused" ? " · time isn’t counting" : ""}</p>
              <p>{Math.round(reading.stats.estimated_wpm ?? 240)} words/min · {(reading.stats.pace_samples ?? 0) > 0 ? "adapting to your pace" : "learning your pace"}</p>
              <p>{Math.floor((reading.stats.active_reading_seconds ?? 0) / 60)} min of active reading</p>
              <p className="text-xs leading-relaxed">Time on visible passages builds reading credit. Returning adds credit; skipping to the end won’t finish the book.</p>
              {reading.pending && <p className="text-xs text-ink-soft">Reading time saved on this device, waiting to sync.</p>}
              {aheadCount > 0 && <p className="mt-2">{plural(aheadCount, "thing")} waiting ahead</p>}
              {readingNow.size > 1 && <p className="mt-2">{plural(readingNow.size - 1, "friend")} reading now</p>}
              <p className="mt-2">{saveStatus === "error" ? "Place not saved yet — retrying" : liveStatus === "offline" ? "Reconnecting" : "Your place saves as you read."}</p>
            </PopoverContent>
          </Popover>
          {(saveStatus === "error" || liveStatus === "offline") && <span role="status" className="reader-connection rounded-lg border border-line bg-raised px-3 py-2 text-xs text-ink-soft shadow-soft">{saveStatus === "error" ? "Place not saved yet — retrying" : "Reconnecting"}</span>}
        </aside>

        {/* ---------------------------------------------------------- map and contents */}
        <Sheet open={panel === "map"} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent title={on("book_map") ? "Map and contents" : "Contents"} className={on("book_map") ? "sm:w-[min(560px,96vw)]" : undefined}>
            {on("book_map") && (
              <div className="border-b border-line px-5 pb-3 pt-3">
                <Tabs label="Map or contents" value={mapTab} onChange={setMapTab} tabs={[{ id: "map", label: "Map" }, { id: "contents", label: "Contents" }]} />
              </div>
            )}
            {on("book_map") && mapTab === "map" ? (
              <BookMap
                chapters={chapters}
                members={trackMembers}
                meId={me.user_id}
                furthest={furthest}
                here={location?.progress ?? furthest}
                items={mapItems}
                weather={on("reaction_weather") ? layer?.weather ?? [] : []}
                afterparties={afterparties}
                liveIds={readingNow}
                lens={activeLens}
                lensEnabled={on("friend_lens")}
                onLens={setLens}
                onGo={(position) => {
                  setPanel(null);
                  void viewer.current?.goToProgress(position);
                }}
                onAfterparty={showAfterparty}
              />
            ) : (
              <>
                <header className="flex items-center justify-between border-b border-line px-5 py-4">
                  <h2 className="font-display text-xl text-ink">Contents</h2>
                  <SheetClose className="flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
                    <span aria-hidden className="text-xl leading-none">×</span>
                  </SheetClose>
                </header>
                <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {toc.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-ink-faint">This book doesn&apos;t include a table of contents.</p>
                  ) : (
                    <ol>
                      {toc.map((item, index) => {
                        // Notes that fall inside this entry (up to the next entry that has a known position).
                        const start = item.progress;
                        const nextStart = toc.slice(index + 1).find((t) => t.progress !== null)?.progress ?? 1.0000001;
                        const inside = start === null ? [] : viewerMarkers.filter((m) => (m.kind === "note" || m.kind === "package") && m.position >= start && m.position < nextStart);
                        const current = start !== null && location !== null && location.progress >= start - 1e-6 && location.progress < nextStart;
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setPanel(null);
                                void viewer.current?.goToTarget(item.target);
                              }}
                              aria-current={current ? "location" : undefined}
                              className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-sunk", current ? "bg-accent-soft/60 font-medium text-ink" : "text-ink-soft")}
                              style={{ paddingLeft: 12 + item.depth * 16 }}
                            >
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {/* the trail: who left something in this chapter, never what */}
                              {inside.length > 0 && (
                                <span className="flex shrink-0 items-center gap-1" aria-label={`${plural(inside.length, "note")} in this section`}>
                                  {inside.slice(0, 6).map((m) => (
                                    <span
                                      key={m.id}
                                      className="size-2 rounded-full"
                                      style={m.open ? { background: `oklch(0.62 0.12 ${personHue(m.authorId)})` } : { boxShadow: `inset 0 0 0 1.5px oklch(0.62 0.1 ${personHue(m.authorId)})` }}
                                    />
                                  ))}
                                  {inside.length > 6 && <span className="text-[10px] text-ink-faint">+{inside.length - 6}</span>}
                                </span>
                              )}
                              {start !== null && <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-faint">{Math.round(start * 100)}%</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>

        {/* ---------------------------------------------------------- notes and predictions */}
        <Sheet open={panel === "trail"} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent title="What's been left in this book">
            <header className="border-b border-line px-5 pb-3 pt-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl text-ink">Left in this book</h2>
                <SheetClose className="-mr-2 flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
                  <span aria-hidden className="text-xl leading-none">×</span>
                </SheetClose>
              </div>
              {on("predictions") && (
                <div className="mt-3">
                  <Tabs label="Notes or predictions" value={trailTab} onChange={setTrailTab} tabs={[{ id: "notes", label: "Notes", badge: unseenCount }, { id: "predictions", label: "Predictions", badge: readyPredictions.length }]} />
                </div>
              )}
            </header>
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overflow-x-clip px-3 py-4">
              {trailTab === "predictions" && on("predictions") ? (
                <PredictionsPanel predictions={predictions} personOf={personOf} meId={me.user_id} hueOf={personHue} onChanged={announceChange} />
              ) : (
                <>
                  {annotations.error && <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{annotations.error}</p>}
                  <TrailList
                    roomId={initialRoom.id}
                    markers={activeLens ? annotations.markers.filter((m) => m.author_id === activeLens) : annotations.markers}
                    annotations={annotations}
                    people={people}
                    meId={me.user_id}
                    furthest={furthest}
                    onOpen={(marker) => {
                      void viewer.current?.goToAnchor(marker.anchor);
                      openNote(marker);
                    }}
                  />
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={Boolean(active)} onOpenChange={(open) => !open && setActiveNote(null)}>
          <SheetContent title="Note" onOpenAutoFocus={(event) => event.preventDefault()}>
            {active && (
              <NoteThread
                key={active.id}
                marker={active}
                bundle={annotations.notes.get(active.id)}
                meId={me.user_id}
                people={people}
                annotations={annotations}
                canModerate={canModerate}
                archived={archived}
                unwrap={unwrap.has(active.id)}
                onJump={() => void viewer.current?.goToAnchor(active.anchor)}
                onRemoved={() => setActiveNote(null)}
              />
            )}
          </SheetContent>
        </Sheet>

        <Sheet open={Boolean(poll)} onOpenChange={(open) => !open && setActivePoll(null)}>
          <SheetContent title="Poll" onOpenAutoFocus={(event) => event.preventDefault()}>
            {poll && <PollSheet poll={poll} personOf={personOf} meId={me.user_id} onJump={() => void viewer.current?.goToAnchor(poll.anchor)} onChanged={announceChange} />}
          </SheetContent>
        </Sheet>

        <Sheet open={Boolean(openParty)} onOpenChange={(open) => !open && setParty(null)}>
          <SheetContent title="Chapter afterparty" className="sm:w-[min(560px,96vw)]">
            {openParty && (
              <AfterpartySheet
                party={openParty}
                chapterMarkers={annotations.markers.filter((m) => m.position >= openParty.start_at && m.position < openParty.end_at && isOpen(m))}
                notes={annotations.notes}
                polls={polls}
                predictions={predictions}
                weather={layer?.weather ?? []}
                cues={layer?.cues ?? []}
                personOf={personOf}
                meId={me.user_id}
                onOpenNote={openNote}
                onOpenPoll={(p) => { setParty(null); setActivePoll(p.id); }}
              />
            )}
          </SheetContent>
        </Sheet>

        <Sheet
          open={Boolean(composer)}
          onOpenChange={(open) => {
            if (!open) {
              setComposer(null);
              viewer.current?.clearSelection();
            }
          }}
        >
          <SheetContent title="Leave a note">
            {composer && (
              <LeaveSheet
                kind={leaveKind}
                kinds={leaveKinds}
                onKind={setLeaveKind}
                selection={composer}
                roomId={initialRoom.id}
                chapters={chapters}
                annotations={annotations}
                members={members}
                meId={me.user_id}
                features={features}
                onDone={(what, detail) => {
                  setComposer(null);
                  viewer.current?.clearSelection();
                  if (what === "prediction") toast.success(`Sealed. It opens at ${detail ?? "its point"}.`);
                  if (what !== "note") announceChange();
                  else refreshLayer();
                }}
              />
            )}
          </SheetContent>
        </Sheet>

        {/* ---------------------------------------------------------- while you were away */}
        <Dialog open={awayStory.length > 0} onOpenChange={(open) => !open && setAway(null)}>
          <DialogContent title="While you were away" description={away?.since ? `Since you last read, ${timeAgo(away.since)}.` : undefined}>
            <AwayStory lines={awayStory} personOf={personOf} />
            <div className="mt-6 flex justify-end">
              <Button size="lg" onClick={() => setAway(null)} icon={<BookOpen className="size-5" aria-hidden />}>Continue reading</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={finished} onOpenChange={setFinished}>
          <DialogContent title="You finished the book" description={`You’ve read through ${book.title}, including its ending.`}>
            <div className="flex flex-col items-center text-center">
              <span className="flex size-16 animate-pop-in items-center justify-center rounded-full bg-gold-soft text-gold">
                <BookOpenCheck className="size-8" aria-hidden />
              </span>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                {mode.id === "duo" ? "Everything you two left in these pages is kept as your journey." : "Everything the room left in these pages is kept as its journey."}
              </p>
              {atEnd && <RateBook roomId={initialRoom.id} initial={layer?.my_rating ?? null} />}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {on("vault") ? (
                  <Link href={`/rooms/${initialRoom.id}/vault`} className={buttonClass("primary")}>
                    <Vault className="size-4" aria-hidden />
                    Open the vault
                  </Link>
                ) : (
                  <Link href={`/rooms/${initialRoom.id}/journey`} className={buttonClass("primary")}>
                    <ScrollText className="size-4" aria-hidden />
                    See the journey
                  </Link>
                )}
                <Button variant="secondary" onClick={() => setFinished(false)}>
                  Stay in the book
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PortalContainerContext.Provider>
  );
}
