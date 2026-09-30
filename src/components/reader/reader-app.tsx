"use client";

import { AlertTriangle, ArrowLeft, BookOpenCheck, ChevronLeft, ChevronRight, List, MessageSquareHeart, Minus, PenLine, Plus, RotateCcw, ScrollText, Settings2, Sparkles, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FeedbackDialog } from "@/components/app/feedback";
import { useMe, useReadingContext } from "@/components/app/providers";
import { ProgressTrack, type TrackMarker } from "@/components/room/progress-track";
import { Avatar, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger, PortalContainerContext, Sheet, SheetClose, SheetContent, Tooltip } from "@/components/ui/overlay";
import { cn, plural } from "@/lib/format";
import { formatPercent, type Anchor } from "@/lib/location";
import { useRoomChannel, type RoomChange, type RoomTable } from "@/lib/realtime/use-room-channel";
import { roomMode } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { BookRow, Marker, RoomDetail, RoomMember } from "@/lib/types";
import { NoteComposer } from "./composer";
import { EpubViewer } from "./epub-viewer";
import { MarkerButton, NoteThread, QUICK_REACTIONS, TrailList, type People } from "./notes";
import { PdfViewer } from "./pdf-viewer";
import { DEFAULT_SETTINGS, FONT_SIZE, LINE_HEIGHT, ZOOM, type ReaderError, type ReaderSettings, type ReaderTheme, type TocItem, type ViewerHandle, type ViewerLocation, type ViewerMarker, type ViewerSelection } from "./types";
import { useAnnotations } from "./use-annotations";
import { resumeAnchor, useProgressSaver } from "./use-progress";

const SETTINGS_KEY = "marginalia:reader-settings";
const BOOK_URL_SECONDS = 6 * 3600;
const TABLES: RoomTable[] = ["reading_progress", "annotation_markers", "annotation_contents", "annotation_replies", "annotation_reactions", "reading_unlocks", "room_members"];

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) };
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
        className={cn("relative flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sunk hover:text-ink", active && "bg-sunk text-ink")}
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

function Stepper({ label, value, onChange, min, max, step, format }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; format: (value: number) => string }) {
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-soft">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(clamp(value - step))} disabled={value <= min + 1e-9} aria-label={`Decrease ${label.toLowerCase()}`} className="flex size-10 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-sunk disabled:opacity-40">
          <Minus className="size-4" aria-hidden />
        </button>
        <span className="w-14 text-center text-sm tabular-nums text-ink" aria-live="polite">
          {format(value)}
        </span>
        <button type="button" onClick={() => onChange(clamp(value + step))} disabled={value >= max - 1e-9} aria-label={`Increase ${label.toLowerCase()}`} className="flex size-10 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-sunk disabled:opacity-40">
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
      <div role="radiogroup" aria-label="Page theme" className="grid grid-cols-3 gap-2">
        {(Object.keys(THEME_SWATCH) as ReaderTheme[]).map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={settings.theme === theme}
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
          <Stepper label="Zoom" value={settings.zoom} onChange={(zoom) => onChange({ zoom })} {...ZOOM} format={(v) => `${Math.round(v * 100)}%`} />
          <button type="button" onClick={() => onChange({ zoom: 1 })} className="text-sm text-accent-ink underline-offset-4 hover:underline">
            Fit to width
          </button>
        </>
      )}
    </div>
  );
}

/** The floating toolbar over a text selection: react in one tap, or write a note. */
function SelectionToolbar({ selection, onReact, onNote }: { selection: ViewerSelection; onReact: (emoji: string) => void; onNote: () => void }) {
  if (!selection.rect) return null;
  const width = 252;
  const left = Math.min(Math.max(8, selection.rect.left + selection.rect.width / 2 - width / 2), window.innerWidth - width - 8);
  // Above the selection when there is room (clear of the native handles on touch), else below.
  const above = selection.rect.top > 120;
  const top = above ? selection.rect.top - 56 : Math.min(window.innerHeight - 64, selection.rect.top + selection.rect.height + 12);
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

export function ReaderApp({ room: initialRoom, book }: { room: RoomDetail; book: ReaderBook }) {
  const me = useMe();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabase();
  const { setReading } = useReadingContext();
  const mode = roomMode(initialRoom.mode);
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
  const [panel, setPanel] = useState<"toc" | "trail" | null>(null);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [composer, setComposer] = useState<ViewerSelection | null>(null);
  const [selection, setSelection] = useState<ViewerSelection | null>(null);
  const [reveal, setReveal] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const deepLinked = useRef(false);

  const annotations = useAnnotations({ roomId: initialRoom.id, meId: me.user_id });
  // Stable pieces of the annotations API, so memoised values below only change when the data does.
  const { markUnlocked, loadNotes, markSeen, createNote, isOpen, onChange: onAnnotationChange, resync: resyncAnnotations } = annotations;
  // Computed once: where to open the book.
  const [initialAnchor] = useState<Anchor | null>(() => resumeAnchor(initialRoom.id, book.format, initialRoom.my));

  // ------------------------------------------------------------ settings
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
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
    },
    [markUnlocked],
  );
  const { report, saveNow, status: saveStatus, furthest } = useProgressSaver({
    roomId: initialRoom.id,
    initialFurthest: initialRoom.my?.furthest ?? 0,
    lockedPositions: annotations.lockedPositions,
    onUnlocked,
    onCompleted: useCallback(() => setFinished(true), []),
  });

  const onRelocate = useCallback(
    (next: ViewerLocation) => {
      setLocation(next);
      setSelection(null);
      setReading({ roomId: initialRoom.id, bookId: book.id, label: next.label, progress: next.reach });
      if (!archived) report(next);
    },
    [archived, book.id, initialRoom.id, report, setReading],
  );

  useEffect(() => () => setReading({}), [setReading]);

  // ------------------------------------------------------------ friends (durable state; refreshed on hints)
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

  const onChange = useCallback(
    (change: RoomChange) => {
      if (change.table === "reading_progress" || change.table === "room_members") refreshMembers();
      else onAnnotationChange(change);
    },
    [onAnnotationChange, refreshMembers],
  );
  const onResync = useCallback(() => {
    refreshMembers();
    resyncAnnotations();
  }, [resyncAnnotations, refreshMembers]);

  const { status: liveStatus, live } = useRoomChannel({
    roomId: initialRoom.id,
    userId: me.user_id,
    tables: TABLES,
    onChange,
    onResync,
    // Rough position only, and only occasionally (the hook throttles).
    presence: { user_id: me.user_id, reading: true, progress: location ? Math.round(location.reach * 50) / 50 : undefined },
  });
  const readingNow = useMemo(() => new Set([...live.values()].filter((p) => p.reading).map((p) => p.user_id)), [live]);

  // My own avatar should move the instant I turn a page, not after the round trip.
  const trackMembers = useMemo(
    () => members.map((m) => (m.user_id === me.user_id ? { ...m, furthest: Math.max(m.furthest, furthest), label: location?.label ?? m.label } : m)),
    [members, me.user_id, furthest, location?.label],
  );

  // ------------------------------------------------------------ markers for the viewer
  const viewerMarkers = useMemo<ViewerMarker[]>(
    () =>
      annotations.markers.map((marker) => {
        const open = isOpen(marker);
        const unlock = annotations.unlocks.get(marker.id);
        return {
          id: marker.id,
          authorId: marker.author_id,
          anchor: marker.anchor,
          position: marker.position,
          open,
          seen: marker.author_id === me.user_id || Boolean(unlock?.seen_at),
          fresh: annotations.fresh.has(marker.id),
        };
      }),
    [annotations.markers, annotations.unlocks, annotations.fresh, isOpen, me.user_id],
  );
  const trackMarkers = useMemo<TrackMarker[]>(() => viewerMarkers.map((m) => ({ id: m.id, position: m.position, authorId: m.authorId, open: m.open })), [viewerMarkers]);
  const markerById = useMemo(() => new Map(annotations.markers.map((m) => [m.id, m])), [annotations.markers]);
  const unseenCount = useMemo(() => viewerMarkers.filter((m) => m.open && !m.seen).length, [viewerMarkers]);
  const aheadCount = useMemo(() => viewerMarkers.filter((m) => !m.open).length, [viewerMarkers]);

  const personOf = useCallback((id: string): AvatarPerson => people.get(id) ?? { id, display_name: "A former member", avatar_path: null }, [people]);

  const openNote = useCallback(
    (marker: Marker) => {
      setPanel(null);
      setComposer(null);
      setActiveNote(marker.id);
      void loadNotes([marker.id]);
      void markSeen([marker.id]);
      setReveal((current) => current.filter((id) => id !== marker.id));
    },
    [loadNotes, markSeen],
  );

  const renderMarker = useCallback(
    (marker: ViewerMarker) => {
      const source = markerById.get(marker.id);
      if (!source) return null;
      return <MarkerButton marker={marker} author={personOf(marker.authorId)} onOpen={() => openNote(source)} />;
    },
    [markerById, openNote, personOf],
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

  // ------------------------------------------------------------ writing
  const startNote = useCallback((from: ViewerSelection | null) => {
    const target = from ?? viewer.current?.currentSelection() ?? null;
    if (!target) return;
    saveNow();
    setSelection(null);
    setActiveNote(null);
    setPanel(null);
    setComposer(target);
  }, [saveNow]);

  const quickReact = useCallback(
    async (target: ViewerSelection, emoji: string) => {
      setSelection(null);
      viewer.current?.clearSelection();
      saveNow();
      try {
        await createNote({ anchor: target.anchor, position: target.position, label: target.label, emoji, quote: target.quote });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [createNote, saveNow],
  );

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const revealMarkers = reveal.map((id) => markerById.get(id)).filter((m): m is Marker => Boolean(m));
  const active = activeNote ? markerById.get(activeNote) : undefined;
  const canModerate = initialRoom.my_role === "owner" || initialRoom.my_role === "moderator";
  const progressNow = location?.reach ?? initialRoom.my?.furthest ?? 0;
  const theme = settings.theme;

  return (
    <PortalContainerContext.Provider value={root}>
      <div
        ref={setRoot}
        data-testid="reader"
        data-ready={ready ? "true" : "false"}
        data-save-status={saveStatus}
        data-progress={progressNow.toFixed(4)}
        data-furthest={furthest.toFixed(4)}
        data-live={liveStatus}
        data-reader-theme={theme}
        className={cn("reader-root fixed inset-0 flex flex-col overflow-hidden", theme === "dark" && "dark")}>
        {/* ---------------------------------------------------------- top bar */}
        <header
          className={cn(
            "pt-safe absolute inset-x-0 top-0 z-20 border-b border-line/70 bg-paper/95 backdrop-blur-sm transition-transform duration-300",
            !chrome && "-translate-y-full md:translate-y-0",
          )}
        >
          <div className="flex h-14 items-center gap-1 px-1.5 sm:px-3">
            <Link href={`/rooms/${initialRoom.id}`} className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label={`Back to ${initialRoom.name}`}>
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate font-display text-[15px] leading-tight text-ink">{book.title}</p>
              <p className="truncate text-xs text-ink-faint">{location?.label ?? initialRoom.name}</p>
            </div>
            {!archived && (
              <IconButton label="Leave a note here" onClick={() => startNote(null)}>
                <PenLine className="size-5" aria-hidden />
              </IconButton>
            )}
            <IconButton label="What's been left in this book" onClick={() => setPanel(panel === "trail" ? null : "trail")} active={panel === "trail"} badge={unseenCount}>
              <Sparkles className="size-5" aria-hidden />
            </IconButton>
            <IconButton label="Contents" onClick={() => setPanel(panel === "toc" ? null : "toc")} active={panel === "toc"}>
              <List className="size-5" aria-hidden />
            </IconButton>
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
        </header>

        {/* ---------------------------------------------------------- the book */}
        <main className="relative min-h-0 flex-1 pb-[4.5rem] pt-14" style={{ background: "var(--page)", color: "var(--page-ink)" }}>
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
                  key={`${url}-${attempt}`}
                  ref={viewer}
                  bookId={book.id}
                  url={url}
                  size={book.size_bytes}
                  hasLocations={book.has_locations}
                  locationsPath={`${book.uploader_id}/${book.id}/locations.json`}
                  settings={settings}
                  initialAnchor={initialAnchor}
                  markers={viewerMarkers}
                  renderMarker={renderMarker}
                  onReady={(info) => {
                    setToc(info.toc);
                    setReady(true);
                  }}
                  onRelocate={onRelocate}
                  onSelection={setSelection}
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
                  initialAnchor={initialAnchor}
                  markers={viewerMarkers}
                  renderMarker={renderMarker}
                  onReady={(info) => {
                    setToc(info.toc);
                    setReady(true);
                  }}
                  onRelocate={onRelocate}
                  onSelection={setSelection}
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
            </>
          )}
        </main>

        {/* ---------------------------------------------------------- reveal */}
        {revealMarkers.length > 0 && !activeNote && !composer && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
            <div className="pointer-events-auto flex animate-fade-up items-center gap-3 rounded-full border border-gold/40 bg-raised py-1.5 pl-2 pr-1.5 shadow-lift" role="status" aria-live="polite">
              <Avatar person={personOf(revealMarkers[0].author_id)} size={30} className="animate-unlock rounded-full" />
              <p className="text-sm text-ink">
                {revealMarkers.length === 1 ? (
                  <>
                    <span className="font-medium">{personOf(revealMarkers[0].author_id).display_name.split(" ")[0]}</span> left something here
                  </>
                ) : (
                  <>{plural(revealMarkers.length, "thing")} just opened for you</>
                )}
              </p>
              <Button size="sm" onClick={() => (revealMarkers.length === 1 ? openNote(revealMarkers[0]) : (setPanel("trail"), setReveal([])))}>
                Open
              </Button>
              <button type="button" onClick={() => setReveal([])} className="flex size-9 items-center justify-center rounded-full text-ink-faint hover:bg-sunk" aria-label="Dismiss">
                <span aria-hidden>×</span>
              </button>
            </div>
          </div>
        )}

        {selection && !composer && !archived && <SelectionToolbar selection={selection} onReact={(emoji) => void quickReact(selection, emoji)} onNote={() => startNote(selection)} />}

        {/* ---------------------------------------------------------- bottom bar */}
        <footer
          className={cn(
            "pb-safe absolute inset-x-0 bottom-0 z-20 border-t border-line/70 bg-paper/95 backdrop-blur-sm transition-transform duration-300",
            !chrome && "translate-y-full md:translate-y-0",
          )}
        >
          <div className="mx-auto flex max-w-4xl items-center gap-1 px-1.5 pt-1 sm:gap-3 sm:px-4">
            <button type="button" onClick={() => viewer.current?.prev()} className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label="Previous page">
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <ProgressTrack members={trackMembers} meId={me.user_id} mode={mode} markers={trackMarkers} liveIds={readingNow} size="sm" />
              <div className="-mt-1 flex items-center justify-between gap-2 px-3 pb-1 text-[11px] text-ink-faint">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="tabular-nums text-ink-soft">{formatPercent(progressNow)}</span>
                  {aheadCount > 0 && <span className="truncate">· {plural(aheadCount, "thing")} waiting ahead</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {saveStatus === "error" && (
                    <span className="flex items-center gap-1 text-danger" role="status">
                      <WifiOff className="size-3" aria-hidden />
                      Place not saved yet — retrying
                    </span>
                  )}
                  {saveStatus !== "error" && liveStatus === "offline" && (
                    <span className="flex items-center gap-1" role="status">
                      <WifiOff className="size-3" aria-hidden />
                      Reconnecting
                    </span>
                  )}
                  {readingNow.size > 1 && saveStatus !== "error" && liveStatus !== "offline" && <span>{plural(readingNow.size - 1, "friend")} reading now</span>}
                </span>
              </div>
            </div>
            <button type="button" onClick={() => viewer.current?.next()} className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label="Next page">
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        </footer>

        {/* ---------------------------------------------------------- panels */}
        <Sheet open={panel === "toc"} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent title="Contents">
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
                    const inside = start === null ? [] : viewerMarkers.filter((m) => m.position >= start && m.position < nextStart);
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
                          {/* the trail: who left something in this chapter — never what */}
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
          </SheetContent>
        </Sheet>

        <Sheet open={panel === "trail"} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent title="What's been left in this book">
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-xl text-ink">Left in this book</h2>
              <SheetClose className="flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
                <span aria-hidden className="text-xl leading-none">×</span>
              </SheetClose>
            </header>
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 py-4">
              {annotations.error && <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{annotations.error}</p>}
              <TrailList
                roomId={initialRoom.id}
                markers={annotations.markers}
                annotations={annotations}
                people={people}
                meId={me.user_id}
                furthest={furthest}
                onOpen={(marker) => {
                  void viewer.current?.goToAnchor(marker.anchor);
                  openNote(marker);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={Boolean(active)} onOpenChange={(open) => !open && setActiveNote(null)}>
          <SheetContent title="Note" onOpenAutoFocus={(event) => event.preventDefault()}>
            {active && (
              <NoteThread
                marker={active}
                bundle={annotations.notes.get(active.id)}
                meId={me.user_id}
                people={people}
                annotations={annotations}
                canModerate={canModerate}
                archived={archived}
                onJump={() => void viewer.current?.goToAnchor(active.anchor)}
                onRemoved={() => setActiveNote(null)}
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
              <NoteComposer
                selection={composer}
                annotations={annotations}
                onDone={() => {
                  setComposer(null);
                  viewer.current?.clearSelection();
                }}
              />
            )}
          </SheetContent>
        </Sheet>

        <Dialog open={finished} onOpenChange={setFinished}>
          <DialogContent title="You finished the book" description={`That's the last page of ${book.title}.`}>
            <div className="flex flex-col items-center text-center">
              <span className="flex size-16 animate-pop-in items-center justify-center rounded-full bg-gold-soft text-gold">
                <BookOpenCheck className="size-8" aria-hidden />
              </span>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                {mode.id === "duo" ? "Everything you two left in these pages is kept as your journey." : "Everything the room left in these pages is kept as its journey."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href={`/rooms/${initialRoom.id}/journey`} className={buttonClass("primary")}>
                  <ScrollText className="size-4" aria-hidden />
                  See the journey
                </Link>
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
