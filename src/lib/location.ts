// The unified location model.
//
// Everything social in this product — friends' positions, note markers, the
// spoiler lock, milestones, the Journey — works on ONE number: a normalized
// progress value between 0 (first page) and 1 (the end). How that number is
// derived is a per-format detail that stays inside the reader:
//
//   EPUB  a CFI (stable across devices, font sizes and window sizes), mapped
//         to progress through a locations index generated once per book.
//   PDF   a page number plus normalized coordinates inside that page.
//
// A location therefore always carries: the normalized progress, a human label,
// and a format-specific anchor used only to navigate / draw.
import type { BookFormat } from "@/lib/limits";

export interface EpubAnchor {
  type: "epub";
  /** CFI of the start of the location (resume point / marker position). */
  cfi: string;
  /** Exact double-tap point within the visible page. */
  x?: number;
  y?: number;
  /** CFI range of a highlighted passage, when the note is attached to a selection. */
  cfiRange?: string;
  /** Spine href of the chapter, used for the label and as a navigation fallback. */
  href?: string;
}

/** A rectangle in page space: every value is a fraction (0..1) of the page's width / height. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfAnchor {
  type: "pdf";
  /** 1-based page number. */
  page: number;
  /** Vertical position inside the page, 0 (top) .. 1 (bottom). */
  y?: number;
  x?: number;
  /** Highlight rectangles of a text selection, normalized to the page box. */
  rects?: NormRect[];
}

export type Anchor = EpubAnchor | PdfAnchor;

export interface BookLocation {
  bookId: string;
  format: BookFormat;
  /** Normalized progress 0..1. */
  progress: number;
  /** "Chapter 4 · The Storm" / "Page 12 of 300". */
  label: string;
  anchor: Anchor;
}

/** Display rounding at the end of the book. Earned completion uses completed_at. */
export const COMPLETION_THRESHOLD = 0.995;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The precision stored in Postgres (numeric(7,6)). */
export function roundProgress(value: number): number {
  return Math.round(clamp01(value) * 1_000_000) / 1_000_000;
}

/** @deprecated Position alone cannot establish completion. Read completed_at instead. */
export function isComplete(progress: number): boolean {
  return progress >= COMPLETION_THRESHOLD;
}

export function formatPercent(progress: number): string {
  const p = clamp01(progress);
  if (p > 0 && p < 0.01) return "<1%";
  if (p >= COMPLETION_THRESHOLD) return "100%";
  return `${Math.min(99, Math.floor(p * 100))}%`;
}

// ---------------------------------------------------------------- EPUB

/**
 * Progress for an EPUB location index. epub.js splits the book into `total`
 * equal-sized "locations"; being at location `index` means `index / total`
 * of the text is behind the reader.
 */
export function epubProgress(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return 0;
  return roundProgress(index / total);
}

/**
 * How far the visible page *reaches*. We treat the end of the visible page as
 * "read up to here": it is what unlocks notes, so a note sitting on the page
 * you are looking at is never still locked. On the last page the reach is 1.
 */
export function epubReach(endIndex: number, total: number, atEnd: boolean): number {
  if (atEnd) return 1;
  return epubProgress(endIndex, total);
}

export function epubLabel(chapter: string | null | undefined, progress: number): string {
  const name = chapter?.trim();
  return name ? name : `${formatPercent(progress)} through`;
}

// ---------------------------------------------------------------- PDF

/** Progress of a point inside a PDF: pages before it, plus the fraction of its own page. */
export function pdfProgress(page: number, y: number, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 0;
  const p = Math.min(Math.max(1, Math.floor(page)), totalPages);
  return roundProgress((p - 1 + clamp01(y)) / totalPages);
}

export function pdfAnchorProgress(anchor: PdfAnchor, totalPages: number): number {
  const y = anchor.rects?.length ? Math.min(...anchor.rects.map((r) => r.y)) : (anchor.y ?? 0);
  return pdfProgress(anchor.page, y, totalPages);
}

export function pdfLabel(page: number, totalPages: number): string {
  return `Page ${page} of ${totalPages}`;
}

export interface PdfViewport {
  /** Top edge of every page in scroll coordinates (px), in page order. */
  pageTops: number[];
  /** Height of every page (px). */
  pageHeights: number[];
  scrollTop: number;
  viewportHeight: number;
}

export interface PdfViewState {
  /** 1-based page at the top of the viewport. */
  page: number;
  /** How far into that page the top of the viewport is (0..1). */
  offset: number;
  /** Progress of the top of the viewport (where to resume). */
  progress: number;
  /** Progress of the bottom of the viewport (what has been reached). */
  reach: number;
}

/** Locates a vertical scroll coordinate inside the page stack. */
function locate(y: number, tops: number[], heights: number[], firstInRow = false): { page: number; offset: number } {
  const count = tops.length;
  if (count === 0) return { page: 1, offset: 0 };
  let index = 0;
  // Pages are in order, so a binary search keeps this cheap for 1000-page PDFs.
  let lo = 0;
  let hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // Browsers round scrollTop to device pixels; a restored fractional page top
    // must not become the preceding page just because it rounded down.
    if (tops[mid] <= y + 0.5) {
      index = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (firstInRow) while (index > 0 && tops[index - 1] === tops[index]) index--;
  const height = heights[index] || 1;
  return { page: index + 1, offset: clamp01((y - tops[index]) / height) };
}

/** Derives the reading position of a vertically scrolled PDF from pure geometry. */
export function pdfViewState(view: PdfViewport): PdfViewState {
  const total = view.pageTops.length;
  if (total === 0) return { page: 1, offset: 0, progress: 0, reach: 0 };
  const top = locate(Math.max(0, view.scrollTop), view.pageTops, view.pageHeights, true);
  const lastBottom = view.pageTops[total - 1] + view.pageHeights[total - 1];
  const bottomY = view.scrollTop + view.viewportHeight;
  // Within a couple of pixels of the end counts as the end (sub-pixel scroll rounding).
  const atEnd = bottomY >= lastBottom - 2;
  const bottom = locate(Math.min(bottomY, lastBottom), view.pageTops, view.pageHeights);
  return {
    page: top.page,
    offset: top.offset,
    progress: pdfProgress(top.page, top.offset, total),
    reach: atEnd ? 1 : pdfProgress(bottom.page, bottom.offset, total),
  };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Converts a pixel rectangle (relative to the page's top-left) into page-normalized space. */
export function normalizeRect(rect: { left: number; top: number; width: number; height: number }, page: { width: number; height: number }): NormRect {
  const x = clamp01(rect.left / page.width);
  const y = clamp01(rect.top / page.height);
  return {
    x: round4(x),
    y: round4(y),
    w: round4(Math.min(1 - x, Math.max(0, rect.width / page.width))),
    h: round4(Math.min(1 - y, Math.max(0, rect.height / page.height))),
  };
}

export function denormalizeRect(rect: NormRect, page: { width: number; height: number }) {
  return { left: rect.x * page.width, top: rect.y * page.height, width: rect.w * page.width, height: rect.h * page.height };
}

/**
 * A text selection produces one client rect per line fragment (often several
 * per line). Merge fragments that share a line so the stored anchor stays
 * small and the highlight draws as clean bars.
 */
export function mergeLineRects(rects: NormRect[], limit = 40): NormRect[] {
  const sorted = [...rects].filter((r) => r.w > 0.001 && r.h > 0.001).sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: NormRect[] = [];
  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    const sameLine = last && Math.abs(last.y - rect.y) < Math.min(last.h, rect.h) * 0.6;
    if (sameLine && rect.x <= last.x + last.w + 0.02) {
      const right = Math.max(last.x + last.w, rect.x + rect.w);
      const bottom = Math.max(last.y + last.h, rect.y + rect.h);
      last.x = Math.min(last.x, rect.x);
      last.y = Math.min(last.y, rect.y);
      last.w = round4(right - last.x);
      last.h = round4(bottom - last.y);
    } else {
      merged.push({ ...rect });
    }
  }
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------- generic

export function isEpubAnchor(anchor: Anchor | null | undefined): anchor is EpubAnchor {
  return anchor?.type === "epub" && typeof anchor.cfi === "string";
}

export function isPdfAnchor(anchor: Anchor | null | undefined): anchor is PdfAnchor {
  return anchor?.type === "pdf" && Number.isFinite(anchor.page);
}

/** Validates an anchor that came back from the database before it is used to navigate. */
export function parseAnchor(value: unknown, format: BookFormat): Anchor | null {
  if (!value || typeof value !== "object") return null;
  const anchor = value as Anchor;
  if (format === "epub") return isEpubAnchor(anchor) ? anchor : null;
  return isPdfAnchor(anchor) && anchor.page >= 1 ? anchor : null;
}
