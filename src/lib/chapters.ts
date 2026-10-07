// Chapters as the social layer sees them: top-level contents entries with a
// known start, shared by every reader of the same file (see books.outline).
// Books without a usable outline fall back to equal tenths, so the map,
// afterparties and predictions still have places to point at.
import type { OutlineEntry } from "@/lib/types";

export interface Chapter {
  index: number;
  label: string;
  start: number;
  end: number;
  /** Equal tenths standing in for a book without a usable outline. */
  synthetic?: boolean;
}

export function chaptersFrom(outline: OutlineEntry[] | null | undefined): Chapter[] {
  const tops = (outline ?? []).filter((e) => e.depth === 0 && Number.isFinite(e.start)).sort((a, b) => a.start - b.start);
  const unique: OutlineEntry[] = [];
  for (const entry of tops) if (!unique.length || Math.abs(entry.start - unique[unique.length - 1].start) > 0.0001) unique.push(entry);
  if (unique.length < 2) {
    return Array.from({ length: 10 }, (_, i) => ({ index: i, label: `${i * 10}–${(i + 1) * 10}%`, start: i / 10, end: (i + 1) / 10, synthetic: true }));
  }
  return unique.map((entry, i) => ({ index: i, label: entry.label || `Part ${i + 1}`, start: entry.start, end: unique[i + 1]?.start ?? 1 }));
}

export function chapterAt(chapters: Chapter[], position: number): Chapter | null {
  let found: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.start <= position + 1e-9) found = chapter;
    else break;
  }
  return found ?? chapters[0] ?? null;
}

/** The chapter after the one containing `position`, if there is one. */
export function nextChapter(chapters: Chapter[], position: number): Chapter | null {
  return chapters.find((c) => c.start > position + 0.0005) ?? null;
}

/** How many chapter openings a reader crossed moving from `from` to `to`. */
export function chaptersCrossed(chapters: Chapter[], from: number, to: number): number {
  return chapters.filter((c) => c.start > from + 1e-6 && c.start <= to + 1e-6).length;
}
