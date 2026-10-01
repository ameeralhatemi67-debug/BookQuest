"use client";

// EPUB viewer built on epub.js.
//
// Positions are EPUB CFIs — stable across devices, window sizes and font
// settings. Normalized progress comes from a locations index that is generated
// once when the book is uploaded and shared by every reader, so "43%" is the
// same sentence for everyone.
import type { Book, Contents, Location, Rendition } from "epubjs";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { EPUB_LOCATION_CHARS, loadEpubJs } from "@/lib/books/epub";
import { epubLabel, epubProgress, epubReach, isEpubAnchor, type EpubAnchor } from "@/lib/location";
import { getSupabase } from "@/lib/supabase/client";
import { personHue } from "@/components/ui/avatar";
import { FONT_STACK, ReaderError, THEME_COLORS, WIDTH_PX, type ReaderSettings, type TocItem, type ViewerHandle, type ViewerProps, type ViewerSelection } from "./types";
import { bindDoubleTap } from "./double-tap";

const BOOK_CACHE = "marginalia-books-v1";

/** Downloads the EPUB with progress and keeps it in the browser's Cache Storage for instant re-opens. */
async function fetchBook(url: string, cacheKey: string, onProgress?: (fraction: number | null) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(BOOK_CACHE);
    const hit = await cache.match(cacheKey);
    if (hit) return await hit.arrayBuffer();
  } catch {
    cache = null; // Cache Storage unavailable (private mode): just download.
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new ReaderError("download", "The book couldn't be downloaded. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new ReaderError(response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404 ? "unauthorized" : "download", "The book couldn't be downloaded.");
  }

  const total = Number(response.headers.get("content-length")) || 0;
  let buffer: ArrayBuffer;
  if (response.body && total > 0) {
    const reader = response.body.getReader();
    const bytes = new Uint8Array(total);
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > bytes.length) break; // content-length lied; fall through with what we have
      bytes.set(value, received);
      received += value.length;
      onProgress?.(received / total);
    }
    buffer = bytes.buffer.slice(0, received);
  } else {
    onProgress?.(null);
    buffer = await response.arrayBuffer();
  }

  try {
    await cache?.put(cacheKey, new Response(buffer.slice(0), { headers: { "content-type": "application/epub+zip" } }));
  } catch {
    // Quota exceeded or similar: reading still works, it just won't be cached.
  }
  return buffer;
}

function settingsCss(settings: ReaderSettings): string {
  const colors = THEME_COLORS[settings.theme];
  const font = FONT_STACK[settings.font];
  const family = font ? `font-family: ${font} !important;` : "";
  // In sepia / dark, books that hard-code black text or white boxes would be unreadable.
  const recolor = settings.theme === "light" ? "" : `body * { color: inherit !important; background-color: transparent !important; }`;
  return `
    html { background: transparent !important; touch-action: manipulation; }
    body {
      background: transparent !important;
      color: ${colors.ink} !important;
      font-size: ${settings.fontSize}% !important;
      line-height: ${settings.lineHeight} !important;
      ${family}
      -webkit-text-size-adjust: 100%;
      overflow-wrap: break-word;
      -webkit-tap-highlight-color: transparent;
    }
    p, li, blockquote, dd, dt, td, div { line-height: ${settings.lineHeight} !important; ${family} }
    ${recolor}
    a, a:link, a:visited { color: ${colors.link} !important; }
    img, svg, video { max-width: 100% !important; height: auto; }
    ::selection { background: rgba(180, 83, 42, 0.28); }
  `;
}

interface EpubInternals {
  book: Book;
  rendition: Rendition;
  total: number;
  /** Flattened table of contents with the spine index each entry starts at. */
  chapters: { label: string; spineIndex: number; tocIndex: number }[];
  location: Location | null;
}

export const EpubViewer = forwardRef<ViewerHandle, ViewerProps & { size: number | null; hasLocations: boolean; locationsPath: string }>(function EpubViewer(
  { bookId, url, settings, initialAnchor, markers, draftAnchor, renderMarker, onReady, onRelocate, onSelection, onAddNote, onToggleChrome, onError, onLoadProgress, size, hasLocations, locationsPath },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const internals = useRef<EpubInternals | null>(null);
  const callbacks = useRef({ onReady, onRelocate, onSelection, onAddNote, onToggleChrome, onError, onLoadProgress });
  const settingsRef = useRef(settings);
  const highlighted = useRef(new Map<string, string>()); // marker id → cfiRange
  const [ready, setReady] = useState(false);
  const [placements, setPlacements] = useState<{ id: string; top: number; pinX: number; pinY: number }[]>([]);
  const [layoutTick, setLayoutTick] = useState(0);

  useLayoutEffect(() => {
    callbacks.current = { onReady, onRelocate, onSelection, onAddNote, onToggleChrome, onError, onLoadProgress };
  });

  // ------------------------------------------------------------ open the book
  useEffect(() => {
    let disposed = false;
    let book: Book | null = null;
    let rendition: Rendition | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const gestureCleanups: (() => void)[] = [];
    const highlights = highlighted.current;

    (async () => {
      const ePub = await loadEpubJs();
      const buffer = await fetchBook(url, `https://book.cache/${bookId}-${size ?? 0}`, (f) => callbacks.current.onLoadProgress?.(f));
      if (disposed) return;
      callbacks.current.onLoadProgress?.(1);

      try {
        book = ePub(buffer);
        await book.ready;
      } catch {
        throw new ReaderError("corrupt", "This EPUB couldn't be opened. The file may be damaged.");
      }
      if (disposed) return;

      // The shared locations index: stored next to the book at upload time.
      let loaded = false;
      if (hasLocations) {
        try {
          const { data } = await getSupabase().storage.from("books").download(locationsPath);
          if (data) {
            book.locations.load(await data.text());
            loaded = book.locations.length() > 0;
          }
        } catch {
          loaded = false;
        }
      }
      if (!loaded) await book.locations.generate(EPUB_LOCATION_CHARS);
      if (disposed) return;
      const total = book.locations.length();

      // Table of contents → flat list with the progress each entry starts at.
      const firstLocationOfSpine = new Map<number, number>();
      const cfis = ((book.locations as unknown as { _locations?: string[] })._locations ?? []) as string[];
      cfis.forEach((cfi, index) => {
        const match = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
        if (!match) return;
        const spineIndex = Number(match[1]) / 2 - 1;
        if (!firstLocationOfSpine.has(spineIndex)) firstLocationOfSpine.set(spineIndex, index);
      });

      const toc: TocItem[] = [];
      const chapters: EpubInternals["chapters"] = [];
      const walk = (items: { id: string; href: string; label: string; subitems?: unknown[] }[], depth: number) => {
        for (const item of items) {
          const section = book!.spine.get(item.href.split("#")[0]) as { index?: number } | undefined;
          const spineIndex = typeof section?.index === "number" ? section.index : null;
          const first = spineIndex === null ? undefined : firstLocationOfSpine.get(spineIndex);
          const label = item.label.replace(/\s+/g, " ").trim();
          toc.push({ id: `${toc.length}`, label, depth, target: item.href, progress: first === undefined || total === 0 ? null : first / total });
          if (spineIndex !== null) chapters.push({ label, spineIndex, tocIndex: toc.length - 1 });
          if (item.subitems?.length) walk(item.subitems as typeof items, depth + 1);
        }
      };
      walk((book.navigation?.toc ?? []) as never, 0);

      if (!host.current) return;
      rendition = book.renderTo(host.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
        allowScriptedContent: false, // book scripts never run
      });

      const state: EpubInternals = { book, rendition, total, chapters, location: null };
      internals.current = state;

      const chapterAt = (spineIndex: number) => {
        let current: EpubInternals["chapters"][number] | null = null;
        for (const chapter of chapters) {
          if (chapter.spineIndex <= spineIndex) current = chapter;
          else break;
        }
        return current;
      };

      // ---- per-document set-up (runs for every chapter iframe)
      const selectionFromRange = (range: Range, contents: Contents): ViewerSelection => {
        const quote = range.toString().replace(/\s+/g, " ").trim();
        const start = range.cloneRange();
        start.collapse(true);
        const cfi = contents.cfiFromRange(start);
        const position = epubProgress(Number(book!.locations.locationFromCfi(cfi)), total);
        const rect = range.getBoundingClientRect();
        const frameRect = (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect();
        const chapter = state.location ? chapterAt(state.location.start.index) : null;
        return {
          anchor: { type: "epub", cfi, ...(quote ? { cfiRange: contents.cfiFromRange(range) } : {}), href: state.location?.start.href },
          position, label: epubLabel(chapter?.label, position), quote: quote ? quote.slice(0, 1200) : null,
          rect: quote && frameRect ? { left: rect.left + frameRect.left, top: rect.top + frameRect.top, width: rect.width, height: rect.height } : null,
        };
      };
      rendition.hooks.content.register((contents: Contents) => {
        void contents.addStylesheetCss(settingsCss(settingsRef.current), "reader-settings");
        const doc = contents.document;
        gestureCleanups.push(bindDoubleTap(doc, (event) => {
          try {
            const selected = doc.getSelection();
            let range = selected && !selected.isCollapsed && selected.rangeCount ? selected.getRangeAt(0) : null;
            if (!range) {
              const caretDoc = doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null };
              const caret = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
              range = caretDoc.caretRangeFromPoint?.(event.clientX, event.clientY) ?? doc.createRange();
              if (caret) { range.setStart(caret.offsetNode, caret.offset); range.collapse(true); }
              else if (!range.startContainer.parentElement) { range.selectNodeContents(event.target as Node); range.collapse(true); }
            }
            const note = selectionFromRange(range, contents);
            const box = host.current?.getBoundingClientRect();
            const frameBox = (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect();
            if (!note.quote && isEpubAnchor(note.anchor) && box && frameBox) {
              note.anchor.x = Math.max(0, Math.min(1, (event.clientX + frameBox.left - box.left) / box.width));
              note.anchor.y = Math.max(0, Math.min(1, (event.clientY + frameBox.top - box.top) / box.height));
            }
            callbacks.current.onAddNote(note);
          } catch {
            const location = state.location;
            if (location) callbacks.current.onAddNote({ anchor: { type: "epub", cfi: location.start.cfi, href: location.start.href }, position: epubProgress(location.start.location, total), label: epubLabel(chapterAt(location.start.index)?.label, epubProgress(location.start.location, total)), quote: null, rect: null });
          }
        }, (event) => {
          if (!doc.getSelection()?.isCollapsed || disposed) return;
          const container = host.current?.getBoundingClientRect();
          const frameRect = (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect();
          if (!container || !frameRect) return;
          const zone = (event.clientX + frameRect.left - container.left) / container.width;
          if (zone < 0.22) void rendition!.prev();
          else if (zone > 0.78) void rendition!.next();
          else callbacks.current.onToggleChrome();
        }));

        // Swipe to turn the page.
        let touch: { x: number; y: number; t: number } | null = null;
        doc.addEventListener("touchstart", (event) => {
          const t = event.changedTouches[0];
          touch = { x: t.clientX, y: t.clientY, t: Date.now() };
        }, { passive: true });
        doc.addEventListener("touchend", (event) => {
          if (!touch) return;
          const t = event.changedTouches[0];
          const dx = t.clientX - touch.x;
          const dy = t.clientY - touch.y;
          const quick = Date.now() - touch.t < 700;
          touch = null;
          if (!quick || Math.abs(dx) < 50 || Math.abs(dy) > 60) return;
          if (!doc.getSelection()?.isCollapsed) return;
          if (dx < 0) void rendition!.next();
          else void rendition!.prev();
        }, { passive: true });

        // Clearing the selection dismisses the floating toolbar.
        doc.addEventListener("selectionchange", () => {
          if (doc.getSelection()?.isCollapsed) callbacks.current.onSelection(null);
        });
      });

      rendition.on("relocated", (location: Location) => {
        state.location = location;
        const chapter = chapterAt(location.start.index);
        const progress = epubProgress(location.start.location, total);
        let visibleWords: number | undefined;
        try {
          const start = rendition!.getRange(location.start.cfi) as Range | undefined;
          const end = rendition!.getRange(location.end.cfi) as Range | undefined;
          if (start && end && start.startContainer.ownerDocument === end.endContainer.ownerDocument) {
            const text = start.cloneRange();
            text.setEnd(end.endContainer, end.endOffset);
            visibleWords = text.toString().match(/\S+/g)?.length ?? 0;
          }
        } catch { /* use the conservative fallback when a cross-chapter range cannot resolve */ }
        callbacks.current.onRelocate({
          visibleWords,
          progress,
          reach: epubReach(location.end.location, total, location.atEnd),
          label: epubLabel(chapter?.label, progress),
          anchor: { type: "epub", cfi: location.start.cfi, href: location.start.href },
          chapterIndex: chapter ? chapter.tocIndex : null,
          chapterLabel: chapter?.label ?? null,
        });
        setLayoutTick((n) => n + 1);
      });

      rendition.on("selected", (cfiRange: string, contents: Contents) => {
        try {
          const selection = selectionFromRange(contents.range(cfiRange), contents);
          if (selection.quote) callbacks.current.onSelection(selection);
        } catch {
          // A selection that cannot be turned into a CFI is simply ignored.
        }
      });

      rendition.on("keyup", (event: KeyboardEvent) => {
        if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") void rendition!.next();
        else if (event.key === "ArrowLeft" || event.key === "PageUp") void rendition!.prev();
      });

      const start = isEpubAnchor(initialAnchor) ? initialAnchor.cfi : undefined;
      try {
        await rendition.display(start);
      } catch {
        // A stale anchor (e.g. the file was replaced): open at the beginning rather than fail.
        await rendition.display();
      }
      if (disposed) return;

      // Keep the page fitted to its container (rotation, window resize, reading width).
      resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const element = host.current;
          if (!element || !rendition) return;
          try {
            rendition.resize(element.clientWidth, element.clientHeight);
          } catch {
            // The rendition may be mid-navigation; the next resize will catch up.
          }
        }, 150);
      });
      resizeObserver.observe(host.current);

      setReady(true);
      callbacks.current.onReady({ toc });
    })().catch((error: unknown) => {
      if (disposed) return;
      callbacks.current.onError(error instanceof ReaderError ? error : new ReaderError("corrupt", "This EPUB couldn't be displayed. The file may be damaged."));
    });

    return () => {
      disposed = true;
      gestureCleanups.forEach(cleanup => cleanup());
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      internals.current = null;
      highlights.clear();
      try {
        rendition?.destroy();
        book?.destroy();
      } catch {
        // epub.js can throw while tearing down a half-initialised rendition.
      }
    };
    // The book is opened once per (bookId, url); later prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, url]);

  // ------------------------------------------------------------ settings
  useEffect(() => {
    const previous = settingsRef.current;
    settingsRef.current = settings;
    const state = internals.current;
    if (!state || !ready) return;
    const css = settingsCss(settings);
    for (const contents of state.rendition.getContents() as unknown as Contents[]) void contents.addStylesheetCss(css, "reader-settings");
    // Anything that changes how text flows needs the page re-laid-out at the same place.
    const reflow = previous.fontSize !== settings.fontSize || previous.lineHeight !== settings.lineHeight || previous.font !== settings.font;
    if (reflow && state.location) {
      const cfi = state.location.start.cfi;
      const timer = setTimeout(() => void state.rendition.display(cfi).catch(() => {}), 60);
      return () => clearTimeout(timer);
    }
  }, [settings, ready]);

  // ------------------------------------------------------------ highlights for readable notes
  useEffect(() => {
    const state = internals.current;
    if (!state || !ready) return;
    const wanted = new Map<string, { cfiRange: string; hue: number }>();
    for (const marker of markers) {
      if (marker.open && isEpubAnchor(marker.anchor) && marker.anchor.cfiRange) {
        wanted.set(marker.id, { cfiRange: marker.anchor.cfiRange, hue: personHue(marker.authorId) });
      }
    }
    for (const [id, cfiRange] of highlighted.current) {
      if (!wanted.has(id)) {
        try {
          state.rendition.annotations.remove(cfiRange, "highlight");
        } catch {
          // already gone
        }
        highlighted.current.delete(id);
      }
    }
    for (const [id, { cfiRange, hue }] of wanted) {
      if (highlighted.current.has(id)) continue;
      try {
        state.rendition.annotations.add("highlight", cfiRange, { id }, undefined, "marginalia-highlight", {
          fill: `hsl(${hue} 70% 55%)`,
          "fill-opacity": "0.22",
          "mix-blend-mode": "multiply",
          "pointer-events": "none",
        });
        highlighted.current.set(id, cfiRange);
      } catch {
        // An anchor that no longer resolves simply has no highlight; its margin marker still works.
      }
    }
  }, [markers, ready]);

  // ------------------------------------------------------------ margin markers for the visible page
  useEffect(() => {
    const state = internals.current;
    const container = host.current;
    if (!state || !ready || !container) return;
    const measure = () => {
      const box = container.getBoundingClientRect();
      const next: { id: string; top: number; pinX: number; pinY: number }[] = [];
      const anchors = [...markers, ...(draftAnchor ? [{ id: "draft", anchor: draftAnchor }] : [])];
      for (const marker of anchors) {
        if (!isEpubAnchor(marker.anchor)) continue;
        let range: Range | undefined;
        try {
          range = state.rendition.getRange(marker.anchor.cfi) as Range | undefined;
        } catch {
          range = undefined;
        }
        if (!range) continue; // its chapter is not on screen
        const frameRect = (range.startContainer.ownerDocument?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
        if (!frameRect) continue;
        let rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
          const element = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
          if (!element) continue;
          rect = element.getBoundingClientRect();
        }
        const left = rect.left + frameRect.left;
        // Only markers whose anchor falls inside the visible page (column).
        if (left < box.left - 2 || left > box.right - 2) continue;
        const pinX = marker.anchor.x === undefined ? left - box.left : marker.anchor.x * box.width;
        const pinY = marker.anchor.y === undefined ? rect.top + frameRect.top - box.top : marker.anchor.y * box.height;
        next.push({ id: marker.id, top: pinY, pinX, pinY });
      }
      // Keep markers from sitting on top of each other.
      next.sort((a, b) => a.top - b.top);
      for (let i = 1; i < next.length; i++) {
        if (next[i].top - next[i - 1].top < 40) next[i].top = next[i - 1].top + 40;
      }
      setPlacements(next);
    };
    // Wait a frame so epub.js has finished positioning the page.
    const frameId = requestAnimationFrame(measure);
    const late = setTimeout(measure, 250);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(late);
    };
  }, [markers, draftAnchor, ready, layoutTick, settings.fontSize, settings.lineHeight, settings.font, settings.width]);

  // ------------------------------------------------------------ keyboard (outside the book iframe)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      const rendition = internals.current?.rendition;
      if (!rendition) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        void rendition.next();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        void rendition.prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useImperativeHandle(ref, () => ({
    next: () => void internals.current?.rendition.next(),
    prev: () => void internals.current?.rendition.prev(),
    async goToAnchor(anchor) {
      if (isEpubAnchor(anchor)) await internals.current?.rendition.display(anchor.cfi).catch(() => {});
    },
    async goToTarget(target) {
      await internals.current?.rendition.display(target).catch(() => {});
    },
    async goToProgress(progress) {
      const state = internals.current;
      if (!state || state.total === 0) return;
      const cfi = state.book.locations.cfiFromLocation(Math.round(progress * state.total));
      if (cfi) await state.rendition.display(cfi).catch(() => {});
    },
    currentSelection() {
      const state = internals.current;
      if (!state?.location) return null;
      const { start } = state.location;
      const position = epubProgress(start.location, state.total);
      let chapter: string | null = null;
      for (const c of state.chapters) if (c.spineIndex <= start.index) chapter = c.label;
      const anchor: EpubAnchor = { type: "epub", cfi: start.cfi, href: start.href };
      return { anchor, position, label: epubLabel(chapter, position), quote: null, rect: null };
    },
    clearSelection() {
      const state = internals.current;
      if (!state) return;
      for (const contents of state.rendition.getContents() as unknown as Contents[]) contents.window.getSelection()?.removeAllRanges();
    },
  }));

  const byId = new Map(markers.map((m) => [m.id, m]));

  return (
    <div className="reader-page relative mx-auto flex h-full w-full justify-center px-4 py-4 sm:px-12 sm:py-6" style={{ maxWidth: WIDTH_PX[settings.width] + 96 }}>
      <div ref={frame} data-note-surface className="relative h-full w-full min-w-0">
        {/* epub.js renders the book's iframe into this element */}
        <div ref={host} className="h-full w-full" style={{ colorScheme: settings.theme === "dark" ? "dark" : "light" }} />
        {placements.map(p => (p.id === "draft" || byId.get(p.id)?.open) && <span key={`pin-${p.id}`} data-note-pin={p.id} className={`note-pin ${p.id === "draft" ? "note-pin-draft" : ""}`} style={{ left: p.pinX, top: p.pinY, background: p.id === "draft" ? undefined : `oklch(0.62 0.12 ${personHue(byId.get(p.id)!.authorId)})` }} aria-hidden />)}
        {/* margin layer: things left on this page */}
        <div className="pointer-events-none absolute inset-y-0 -right-2 w-0 sm:-right-9" aria-label="Notes on this page">
          {placements.map((placement) => {
            const marker = byId.get(placement.id);
            if (!marker) return null;
            return (
              <div key={placement.id} className="pointer-events-auto absolute right-0 translate-x-1/2" style={{ top: Math.min((frame.current?.clientHeight ?? Infinity) - 44, Math.max(0, placement.top - 8)) }}>
                {renderMarker(marker)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
