import type { ReactNode } from "react";
import type { Anchor } from "@/lib/location";

export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderFont = "original" | "serif" | "sans";
export type ReaderWidth = "narrow" | "medium" | "wide";
/** Turn pages like a book, or scroll through them. */
export type ReaderTurn = "flip" | "scroll";

export interface ReaderSettings {
  theme: ReaderTheme;
  /** EPUB text size in percent of the book's own size. */
  fontSize: number;
  /** EPUB line height multiplier. */
  lineHeight: number;
  width: ReaderWidth;
  font: ReaderFont;
  /** PDF view range: 0.2 = enlarged book; 1 = full page; 1.2 = two pages. */
  zoom: number;
  turn: ReaderTurn;
}

export const DEFAULT_SETTINGS: ReaderSettings = { theme: "light", fontSize: 110, lineHeight: 1.7, width: "medium", font: "serif", zoom: 1, turn: "flip" };

export const FONT_SIZE = { min: 80, max: 180, step: 10 };
export const LINE_HEIGHT = { min: 1.3, max: 2.1, step: 0.1 };
export const ZOOM = { min: 0.2, max: 1.2, step: 0.1 };
export const WIDTH_PX: Record<ReaderWidth, number> = { narrow: 560, medium: 700, wide: 880 };

export const FONT_STACK: Record<ReaderFont, string | null> = {
  original: null,
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

export const THEME_COLORS: Record<ReaderTheme, { page: string; ink: string; link: string }> = {
  light: { page: "#fbf8f1", ink: "#2b2521", link: "#8a3d1d" },
  sepia: { page: "#f4e8cf", ink: "#3f3120", link: "#8a3d1d" },
  dark: { page: "#1d1a17", ink: "#d9d0c1", link: "#f0a984" },
};

export interface TocItem {
  id: string;
  label: string;
  depth: number;
  /** Where the entry starts in the book (0..1), when known. */
  progress: number | null;
  /** Opaque navigation target understood by the viewer that produced it. */
  target: string;
}

/** What a viewer reports every time the visible page changes. */
export interface ViewerLocation {
  /** Progress of the top / start of the visible page — where to resume. */
  progress: number;
  /** Progress of the end of the visible page — what has been reached. */
  reach: number;
  label: string;
  anchor: Anchor;
  chapterIndex: number | null;
  chapterLabel: string | null;
  /** PDF: current page number and total. */
  page?: number;
  pageCount?: number;
  /** Words actually visible; image-only pages report zero. */
  visibleWords?: number;
}

/** A passage the reader selected (or the current page, when nothing is selected). */
export interface ViewerSelection {
  anchor: Anchor;
  position: number;
  label: string;
  quote: string | null;
  /** Viewport rectangle of the selection, to place the floating toolbar. */
  rect: { left: number; top: number; width: number; height: number } | null;
}

/** A marker as the viewer needs to draw it. */
export interface ViewerMarker {
  id: string;
  /** note: a friend's note · package: wrapped for one friend · poll: a passage poll · echo: a note from an earlier reading */
  kind?: "note" | "package" | "poll" | "echo";
  /** A package's wrapping label, visible before it opens. */
  title?: string | null;
  authorId: string;
  attention?: import("@/lib/types").NoteAttention;
  anchor: Anchor;
  position: number;
  /** Open = readable by this viewer. Locked markers are drawn neutrally. */
  open: boolean;
  /** Opened before? (unseen ones get a small highlight) */
  seen: boolean;
  /** Unlocked during this session — play the reveal. */
  fresh: boolean;
}

export interface ViewerHandle {
  next(): void;
  prev(): void;
  goToAnchor(anchor: Anchor): Promise<void>;
  goToTarget(target: string): Promise<void>;
  goToProgress(progress: number): Promise<void>;
  /** The location of "here", for adding a note without selecting text. */
  currentSelection(): ViewerSelection | null;
  clearSelection(): void;
}

export interface ViewerProps {
  bookId: string;
  url: string;
  settings: ReaderSettings;
  initialAnchor: Anchor | null;
  markers: ViewerMarker[];
  draftAnchor?: Anchor | null;
  onReady(info: { toc: TocItem[]; pageCount?: number }): void;
  onRelocate(location: ViewerLocation): void;
  onSelection(selection: ViewerSelection | null): void;
  onAddNote(selection: ViewerSelection): void;
  /** Draws one marker; the viewer decides where it goes (margin of its page). */
  renderMarker(marker: ViewerMarker): ReactNode;
  onToggleChrome(): void;
  onError(error: ReaderError): void;
  onLoadProgress?(fraction: number | null): void;
}

export type ReaderErrorCode = "download" | "corrupt" | "unsupported" | "unauthorized";

export class ReaderError extends Error {
  constructor(
    public code: ReaderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReaderError";
  }
}
