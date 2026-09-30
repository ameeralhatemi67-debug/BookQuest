"use client";

// PDF viewer built on PDF.js: a continuous, vertically scrolling stack of pages.
//
// Only the pages near the viewport are ever rendered (canvas + selectable text
// layer); everything else is an empty placeholder of the right size. Combined
// with HTTP range requests this lets a 500 MB, 1000-page PDF open quickly.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { personHue } from "@/components/ui/avatar";
import { loadPdfJs, openPdfUrl } from "@/lib/books/pdf";
import { pdfLayout } from "@/lib/books/pdf-layout";
import { isPdfAnchor, mergeLineRects, normalizeRect, pdfAnchorProgress, pdfLabel, pdfViewState, type NormRect, type PdfAnchor } from "@/lib/location";
import { ReaderError, type TocItem, type ViewerHandle, type ViewerMarker, type ViewerProps, type ViewerSelection } from "./types";
import { bindDoubleTap } from "./double-tap";

const PAGE_GAP = 16;
const MAX_CANVAS_PIXELS = 12_000_000; // keeps memory sane on phones at high zoom
const OVERSCAN = 1; // pages rendered above / below the viewport

interface Size {
  width: number;
  height: number;
}

interface PageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  top: number;
  left: number;
  width: number;
  height: number;
  scale: number;
  onSize: (pageNumber: number, size: Size) => void;
  children?: ReactNode;
}

/** One rendered page: canvas underneath, invisible selectable text on top. */
const PdfPage = memo(function PdfPage({ doc, pageNumber, top, left, width, height, scale, onSize, children }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: { cancel(): void } | null = null;

    (async () => {
      const pdfjs = await loadPdfJs();
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onSize(pageNumber, { width: base.width, height: base.height });

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const textHost = textRef.current;
      if (!canvas || !textHost) return;

      // Render at device resolution, within a pixel budget.
      let ratio = Math.min(window.devicePixelRatio || 1, 2.5);
      const pixels = viewport.width * viewport.height * ratio * ratio;
      if (pixels > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      task = page.render({ canvas, canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise;
      if (cancelled) return;

      textHost.replaceChildren();
      textHost.style.setProperty("--total-scale-factor", String(scale));
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textHost, viewport });
      textLayer = layer;
      await layer.render();
      if (cancelled) return;
      // Lets a selection be dragged past the last line without jumping to the top.
      const end = document.createElement("div");
      end.className = "endOfContent";
      textHost.append(end);
    })().catch((error: unknown) => {
      if (cancelled || (error as { name?: string })?.name === "RenderingCancelledException") return;
      setFailed(true);
    });

    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [doc, pageNumber, scale, onSize]);

  return (
    <div
      data-page={pageNumber}
      className="pdf-page absolute bg-[var(--page)] shadow-soft"
      style={{ top, left, width, height, touchAction: "manipulation" }}
      aria-label={`Page ${pageNumber}`}
      role="group"
    >
      <canvas ref={canvasRef} className="block size-full" aria-hidden />
      <div ref={textRef} className="pdf-text-layer" />
      {failed && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-faint">This page couldn&apos;t be displayed.</p>}
      {children}
    </div>
  );
});

function HighlightRects({ rects, hue }: { rects: NormRect[]; hue: number }) {
  return (
    <>
      {rects.map((rect, index) => (
        <span
          key={index}
          aria-hidden
          className="pointer-events-none absolute z-[2] rounded-[2px] mix-blend-multiply"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, background: `hsl(${hue} 75% 60% / 0.3)` }}
        />
      ))}
    </>
  );
}

export const PdfViewer = forwardRef<ViewerHandle, ViewerProps>(function PdfViewer(
  { url, settings, initialAnchor, markers, renderMarker, onReady, onRelocate, onSelection, onAddNote, onError, onLoadProgress },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  const [sizes, setSizes] = useState<Map<number, Size>>(new Map());
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [range, setRange] = useState<[number, number]>([1, 2]);
  const callbacks = useRef({ onReady, onRelocate, onSelection, onAddNote, onError, onLoadProgress });
  const restored = useRef(false);
  const pendingAnchor = useRef<PdfAnchor | null>(isPdfAnchor(initialAnchor) ? initialAnchor : null);
  const currentAnchor = useRef<PdfAnchor | null>(null);

  useLayoutEffect(() => {
    callbacks.current = { onReady, onRelocate, onSelection, onAddNote, onError, onLoadProgress };
  });

  // ------------------------------------------------------------ open the document
  useEffect(() => {
    let disposed = false;
    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      task = await openPdfUrl(url);
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        // With range requests "loaded" is only what has been needed so far.
        callbacks.current.onLoadProgress?.(total > 0 ? Math.min(1, loaded / Math.min(total, 2_000_000)) : null);
      };
      const pdf = await task.promise;
      if (disposed) return;
      const first = await pdf.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      if (disposed) return;
      setBaseSize({ width: viewport.width, height: viewport.height });
      setDoc(pdf);
      callbacks.current.onLoadProgress?.(1);

      // Outline → table of contents (resolved to page numbers in the background).
      const toc: TocItem[] = [];
      const outline = await pdf.getOutline().catch(() => null);
      const flatten = async (items: { title: string; dest: unknown; items?: unknown[] }[], depth: number) => {
        for (const item of items) {
          if (toc.length >= 300) return;
          let page: number | null = null;
          try {
            const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : (item.dest as unknown[] | null);
            if (dest?.[0]) page = (await pdf.getPageIndex(dest[0] as never)) + 1;
          } catch {
            page = null;
          }
          if (page) toc.push({ id: `${toc.length}`, label: item.title.replace(/\s+/g, " ").trim() || `Page ${page}`, depth, target: String(page), progress: (page - 1) / pdf.numPages });
          if (item.items?.length) await flatten(item.items as typeof items, depth + 1);
        }
      };
      if (outline) await flatten(outline as never, 0);
      if (!disposed) callbacks.current.onReady({ toc, pageCount: pdf.numPages });
    })().catch((error: unknown) => {
      if (disposed) return;
      const name = (error as { name?: string }).name ?? "";
      const status = (error as { status?: number }).status;
      if (name === "PasswordException") callbacks.current.onError(new ReaderError("unsupported", "This PDF is password-protected and can't be opened here."));
      else if (name === "ResponseException" || name === "UnexpectedResponseException" || name === "MissingPDFException") {
        callbacks.current.onError(new ReaderError(status === 400 || status === 401 || status === 403 || status === 404 ? "unauthorized" : "download", "The book couldn't be downloaded."));
      } else if (name === "InvalidPDFException") callbacks.current.onError(new ReaderError("corrupt", "This PDF couldn't be opened. The file may be damaged."));
      else callbacks.current.onError(new ReaderError("download", "The book couldn't be loaded. Check your connection and try again."));
    });

    return () => {
      disposed = true;
      void task?.destroy().catch(() => {});
    };
  }, [url]);

  // ------------------------------------------------------------ geometry
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // Use fractional content dimensions. clientWidth rounds up at some browser
    // zoom levels, making a fitted page stack wider than its scroll container.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainer(current => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageCount = doc?.numPages ?? 0;
  const layout = useMemo(() => pdfLayout(Array.from({ length: pageCount }, (_, index) => sizes.get(index + 1) ?? baseSize ?? { width: 612, height: 792 }), container.width, container.height, settings.zoom), [pageCount, sizes, baseSize, container, settings.zoom]);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const onSize = useCallback((pageNumber: number, size: Size) => {
    setSizes((current) => {
      const known = current.get(pageNumber) ?? baseSize;
      if (known && Math.abs(known.width - size.width) < 0.5 && Math.abs(known.height - size.height) < 0.5) return current;
      const next = new Map(current);
      next.set(pageNumber, size);
      return next;
    });
  }, [baseSize]);

  // ------------------------------------------------------------ scroll → location
  const report = useCallback(() => {
    const element = scroller.current;
    const { tops, heights } = layoutRef.current;
    if (!element || tops.length === 0) return;
    const inset = layoutRef.current.fitted ? PAGE_GAP : 0;
    const state = pdfViewState({ pageTops: tops, pageHeights: heights, scrollTop: element.scrollTop + inset, viewportHeight: element.clientHeight - inset });

    // Which pages intersect the viewport (plus overscan)?
    const bottom = element.scrollTop + element.clientHeight;
    let last = state.page;
    while (last < tops.length && tops[last] < bottom) last++;
    const next: [number, number] = [Math.max(1, state.page - OVERSCAN), Math.min(tops.length, last + OVERSCAN)];
    setRange((current) => (current[0] === next[0] && current[1] === next[1] ? current : next));

    if (!restored.current) return; // don't report the pre-restore position as progress
    currentAnchor.current = { type: "pdf", page: state.page, y: Math.round(state.offset * 10000) / 10000 };
    callbacks.current.onRelocate({
      progress: state.progress,
      reach: state.reach,
      label: pdfLabel(state.page, tops.length),
      anchor: currentAnchor.current,
      chapterIndex: null,
      chapterLabel: null,
      page: state.page,
      pageCount: tops.length,
    });
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        report();
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [report]);

  const scrollToAnchor = useCallback((anchor: PdfAnchor, behavior: ScrollBehavior = "auto") => {
    const element = scroller.current;
    const { tops, heights } = layoutRef.current;
    if (!element || tops.length === 0) return;
    currentAnchor.current = anchor;
    const index = Math.min(Math.max(1, anchor.page), tops.length) - 1;
    const y = layoutRef.current.fitted ? 0 : anchor.rects?.length ? Math.min(...anchor.rects.map((r) => r.y)) : (anchor.y ?? 0);
    // A highlight is shown with a little context above it; a resume point is restored exactly.
    const context = !layoutRef.current.fitted && anchor.rects?.length ? Math.min(120, element.clientHeight * 0.25) : 0;
    element.scrollTo({ top: Math.max(0, tops[index] - (layoutRef.current.fitted ? PAGE_GAP : 0) + y * heights[index] - context), behavior });
  }, []);

  // Restore the saved position once the layout exists; keep the place when zoom / width changes.
  useLayoutEffect(() => {
    if (!doc || !baseSize || container.width === 0 || container.height === 0) return;
    if (settings.zoom > 0.8 && scroller.current) scroller.current.scrollLeft = 0;
    if (!restored.current) {
      if (pendingAnchor.current) scrollToAnchor(pendingAnchor.current);
      restored.current = true;
      report();
      return;
    }
    if (currentAnchor.current) scrollToAnchor(currentAnchor.current);
    report();
    // `layout` changes whenever scale or page sizes change.
  }, [doc, baseSize, container, layout, settings.zoom, report, scrollToAnchor]);

  // ------------------------------------------------------------ selection → anchor
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const selection = document.getSelection();
      const root = scroller.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !root) return callbacks.current.onSelection(null);
      const range = selection.getRangeAt(0);
      const startElement = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
      const pageElement = startElement?.closest<HTMLElement>("[data-page]");
      if (!pageElement || !root.contains(pageElement)) return callbacks.current.onSelection(null);

      const quote = selection.toString().replace(/\s+/g, " ").trim();
      if (!quote) return callbacks.current.onSelection(null);

      const page = Number(pageElement.dataset.page);
      const box = pageElement.getBoundingClientRect();
      // Keep only the part of the selection that lies on its first page.
      const rects = mergeLineRects(
        [...range.getClientRects()]
          .filter((r) => r.width > 1 && r.height > 1 && r.bottom > box.top && r.top < box.bottom)
          .map((r) => normalizeRect({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }, { width: box.width, height: box.height })),
      );
      if (rects.length === 0) return callbacks.current.onSelection(null);

      const total = layoutRef.current.tops.length;
      const anchor: PdfAnchor = { type: "pdf", page, y: rects[0].y, rects };
      const bounds = range.getBoundingClientRect();
      const result: ViewerSelection = {
        anchor,
        position: pdfAnchorProgress(anchor, total),
        label: pdfLabel(page, total),
        quote: quote.slice(0, 1200),
        rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      };
      callbacks.current.onSelection(result);
      return result;
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 220);
    };
    document.addEventListener("selectionchange", onChange);
    const root = scroller.current;
    const unbind = root ? bindDoubleTap(root, (event) => {
      const pageElement = (event.target as Element | null)?.closest<HTMLElement>("[data-page]");
      if (!pageElement) return;
      const page = Number(pageElement.dataset.page);
      const selected = read();
      if (selected && isPdfAnchor(selected.anchor) && selected.anchor.page === page) return callbacks.current.onAddNote(selected);
      const box = pageElement.getBoundingClientRect();
      const anchor: PdfAnchor = { type: "pdf", page, x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
      callbacks.current.onAddNote({ anchor, position: pdfAnchorProgress(anchor, layoutRef.current.tops.length), label: pdfLabel(page, layoutRef.current.tops.length), quote: null, rect: null });
    }) : undefined;
    return () => {
      unbind?.();
      document.removeEventListener("selectionchange", onChange);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ------------------------------------------------------------ keyboard
  const scrollByViewport = useCallback((direction: 1 | -1) => {
    const element = scroller.current;
    if (!element) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { tops, heights, columns, fitted } = layoutRef.current;
    if (fitted && tops.length) {
      const state = pdfViewState({ pageTops: tops, pageHeights: heights, scrollTop: element.scrollTop + PAGE_GAP, viewportHeight: element.clientHeight });
      const index = Math.min(tops.length - 1, Math.max(0, state.page - 1 + direction * columns));
      element.scrollTo({ top: tops[index] - PAGE_GAP, behavior: "auto" });
      return;
    }
    element.scrollBy({ top: direction * element.clientHeight * 0.88, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      const element = scroller.current;
      if (!element) return;
      if (event.key === "PageDown" || event.key === "ArrowRight" || (event.key === " " && !event.shiftKey)) {
        event.preventDefault();
        scrollByViewport(1);
      } else if (event.key === "PageUp" || event.key === "ArrowLeft" || (event.key === " " && event.shiftKey)) {
        event.preventDefault();
        scrollByViewport(-1);
      } else if (event.key === "Home") element.scrollTo({ top: 0 });
      else if (event.key === "End") element.scrollTo({ top: element.scrollHeight });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrollByViewport]);

  useImperativeHandle(ref, () => ({
    next: () => scrollByViewport(1),
    prev: () => scrollByViewport(-1),
    async goToAnchor(anchor) {
      if (isPdfAnchor(anchor)) scrollToAnchor(anchor);
    },
    async goToTarget(target) {
      const page = Number(target);
      if (Number.isFinite(page)) scrollToAnchor({ type: "pdf", page, y: 0 });
    },
    async goToProgress(progress) {
      const total = layoutRef.current.tops.length;
      if (total === 0) return;
      const exact = Math.min(0.999999, Math.max(0, progress)) * total;
      scrollToAnchor({ type: "pdf", page: Math.floor(exact) + 1, y: exact % 1 });
    },
    currentSelection() {
      const element = scroller.current;
      const { tops, heights } = layoutRef.current;
      if (!element || tops.length === 0) return null;
      // "Here" = a third of the way down the screen, where the eye usually is.
      const state = pdfViewState({ pageTops: tops, pageHeights: heights, scrollTop: element.scrollTop + element.clientHeight / 3, viewportHeight: 1 });
      const anchor: PdfAnchor = { type: "pdf", page: state.page, y: Math.round(state.offset * 10000) / 10000 };
      return { anchor, position: pdfAnchorProgress(anchor, tops.length), label: pdfLabel(state.page, tops.length), quote: null, rect: null };
    },
    clearSelection() {
      document.getSelection()?.removeAllRanges();
    },
  }));

  // Markers grouped by page, so each rendered page draws only its own.
  const markersByPage = useMemo(() => {
    const map = new Map<number, ViewerMarker[]>();
    for (const marker of markers) {
      if (!isPdfAnchor(marker.anchor)) continue;
      const list = map.get(marker.anchor.page) ?? [];
      list.push(marker);
      map.set(marker.anchor.page, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [markers]);

  const pages: number[] = [];
  if (doc) for (let page = range[0]; page <= Math.min(range[1], pageCount); page++) pages.push(page);

  return (
    <div ref={scroller} className="scroll-slim h-full w-full overflow-y-auto overscroll-contain" style={{ overflowAnchor: "none", overflowX: settings.zoom <= 0.8 ? "auto" : "hidden" }} tabIndex={0} aria-label="Book pages">
      <div className="relative mx-auto" style={{ height: layout.total, width: layout.width }}>
        {doc &&
          pages.map((page) => {
            const pageMarkers = markersByPage.get(page) ?? [];
            let lastTop = -1;
            return (
              <PdfPage key={page} doc={doc} pageNumber={page} top={layout.tops[page - 1]} left={layout.lefts[page - 1]} width={layout.widths[page - 1]} height={layout.heights[page - 1]} scale={layout.scales[page - 1]} onSize={onSize}>
                {pageMarkers.map((marker) => {
                  const anchor = marker.anchor as PdfAnchor;
                  const y = anchor.rects?.length ? anchor.rects[0].y : (anchor.y ?? 0);
                  // Nudge markers that would overlap each other.
                  let top = y * layout.heights[page - 1];
                  if (lastTop >= 0 && top - lastTop < 40) top = lastTop + 40;
                  lastTop = top;
                  return (
                    <div key={marker.id}>
                      {marker.open && anchor.rects && <HighlightRects rects={anchor.rects} hue={personHue(marker.authorId)} />}
                      <div className="absolute right-0 z-[3] translate-x-1/3 sm:translate-x-[85%]" style={{ top: Math.max(0, top - 8) }}>
                        {renderMarker(marker)}
                      </div>
                    </div>
                  );
                })}
              </PdfPage>
            );
          })}
      </div>
    </div>
  );
});
