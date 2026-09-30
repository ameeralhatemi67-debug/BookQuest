import { describe, expect, it } from "vitest";
import {
  clamp01, denormalizeRect, epubLabel, epubProgress, epubReach, formatPercent, isComplete, mergeLineRects,
  normalizeRect, parseAnchor, pdfAnchorProgress, pdfLabel, pdfProgress, pdfViewState, roundProgress,
} from "@/lib/location";

describe("progress normalization", () => {
  it("clamps anything into 0..1", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("rounds to the precision stored in Postgres (6 decimals)", () => {
    expect(roundProgress(1 / 3)).toBe(0.333333);
    expect(roundProgress(0.9999999)).toBe(1);
    expect(roundProgress(-1)).toBe(0);
  });

  it("treats 99.5% and beyond as finished", () => {
    expect(isComplete(0.99)).toBe(false);
    expect(isComplete(0.995)).toBe(true);
    expect(isComplete(1)).toBe(true);
  });

  it("formats percentages without lying at the edges", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0.499)).toBe("49%");
    expect(formatPercent(0.992)).toBe("99%"); // not "100%" until it really is
    expect(formatPercent(0.996)).toBe("100%");
    expect(formatPercent(3)).toBe("100%");
  });
});

describe("EPUB location mapping", () => {
  it("maps a location index to progress", () => {
    expect(epubProgress(0, 400)).toBe(0);
    expect(epubProgress(100, 400)).toBe(0.25);
    expect(epubProgress(400, 400)).toBe(1);
  });

  it("is safe when locations are not generated yet", () => {
    expect(epubProgress(10, 0)).toBe(0);
    expect(epubProgress(Number.NaN, 400)).toBe(0);
    expect(epubProgress(-5, 400)).toBe(0);
    expect(epubProgress(900, 400)).toBe(1);
  });

  it("uses the END of the visible page as what has been reached", () => {
    // Page shows locations 100..104 → everything up to 104 counts as read.
    expect(epubReach(104, 400, false)).toBe(0.26);
    // On the last page the book is finished even if the index stops short.
    expect(epubReach(398, 400, true)).toBe(1);
  });

  it("guarantees a note on the visible page is never still locked", () => {
    const total = 500;
    const noteIndex = 212; // marker position = its location index / total
    const notePosition = epubProgress(noteIndex, total);
    // Any page that displays the note ends at or after the note's location.
    for (const pageEnd of [212, 213, 220]) {
      expect(epubReach(pageEnd, total, false)).toBeGreaterThanOrEqual(notePosition);
    }
    // A page that ends before it does not unlock it.
    expect(epubReach(211, total, false)).toBeLessThan(notePosition);
  });

  it("labels by chapter, falling back to a percentage", () => {
    expect(epubLabel("Chapter 4 · The Storm", 0.3)).toBe("Chapter 4 · The Storm");
    expect(epubLabel("   ", 0.3)).toBe("30% through");
    expect(epubLabel(null, 0.004)).toBe("<1% through");
  });
});

describe("PDF location mapping", () => {
  it("maps page + offset to progress", () => {
    expect(pdfProgress(1, 0, 10)).toBe(0);
    expect(pdfProgress(1, 1, 10)).toBe(0.1);
    expect(pdfProgress(6, 0.5, 10)).toBe(0.55);
    expect(pdfProgress(10, 1, 10)).toBe(1);
  });

  it("clamps out-of-range pages and offsets", () => {
    expect(pdfProgress(0, 0, 10)).toBe(0);
    expect(pdfProgress(99, 0.5, 10)).toBe(0.95);
    expect(pdfProgress(3, 7, 10)).toBe(0.3);
    expect(pdfProgress(3, 0, 0)).toBe(0);
  });

  it("positions a note by the top of its highlight, or its point", () => {
    expect(pdfAnchorProgress({ type: "pdf", page: 3, y: 0.5 }, 10)).toBe(0.25);
    expect(
      pdfAnchorProgress({ type: "pdf", page: 3, rects: [{ x: 0.1, y: 0.6, w: 0.5, h: 0.02 }, { x: 0.1, y: 0.4, w: 0.5, h: 0.02 }] }, 10),
    ).toBe(0.24);
    expect(pdfAnchorProgress({ type: "pdf", page: 3 }, 10)).toBe(0.2);
  });

  it("labels pages", () => {
    expect(pdfLabel(12, 300)).toBe("Page 12 of 300");
  });

  describe("scroll geometry → reading position", () => {
    // 4 pages, each 1000px tall with a 20px gap.
    const pageTops = [0, 1020, 2040, 3060];
    const pageHeights = [1000, 1000, 1000, 1000];

    it("starts at the top of page 1", () => {
      const s = pdfViewState({ pageTops, pageHeights, scrollTop: 0, viewportHeight: 800 });
      expect(s).toMatchObject({ page: 1, offset: 0, progress: 0 });
      expect(s.reach).toBe(0.2); // 800px of a 4×1000px book
    });

    it("tracks the page under the top edge and how far into it we are", () => {
      const s = pdfViewState({ pageTops, pageHeights, scrollTop: 1520, viewportHeight: 800 });
      expect(s.page).toBe(2);
      expect(s.offset).toBe(0.5);
      expect(s.progress).toBe(0.375);
      // bottom edge = 2320 → page 3, 28% in
      expect(s.reach).toBe(0.57);
    });

    it("reaches 100% when the last page's bottom is on screen", () => {
      const s = pdfViewState({ pageTops, pageHeights, scrollTop: 3260, viewportHeight: 800 });
      expect(s.page).toBe(4);
      expect(s.reach).toBe(1);
    });

    it("tolerates sub-pixel scroll rounding at the very end", () => {
      const s = pdfViewState({ pageTops, pageHeights, scrollTop: 3258.6, viewportHeight: 800 });
      expect(s.reach).toBe(1);
    });

    it("never reports more than it shows, and is monotonic while scrolling down", () => {
      let previous = -1;
      for (let top = 0; top <= 3260; top += 137) {
        const s = pdfViewState({ pageTops, pageHeights, scrollTop: top, viewportHeight: 800 });
        expect(s.reach).toBeGreaterThanOrEqual(s.progress);
        expect(s.reach).toBeGreaterThanOrEqual(previous);
        expect(s.reach).toBeLessThanOrEqual(1);
        previous = s.reach;
      }
    });

    it("handles pages of different sizes and a short document", () => {
      const s = pdfViewState({ pageTops: [0, 520], pageHeights: [500, 1500], scrollTop: 520, viewportHeight: 600 });
      expect(s.page).toBe(2);
      expect(s.progress).toBe(0.5);
      expect(s.reach).toBe(0.7);
      const whole = pdfViewState({ pageTops: [0], pageHeights: [400], scrollTop: 0, viewportHeight: 900 });
      expect(whole.reach).toBe(1);
    });

    it("is safe before any page has been laid out", () => {
      expect(pdfViewState({ pageTops: [], pageHeights: [], scrollTop: 0, viewportHeight: 800 })).toEqual({ page: 1, offset: 0, progress: 0, reach: 0 });
    });
  });

  describe("annotation rectangles", () => {
    const page = { width: 600, height: 800 };

    it("round-trips between pixels and page-normalized space at any zoom", () => {
      const rect = { left: 60, top: 200, width: 300, height: 16 };
      const norm = normalizeRect(rect, page);
      expect(norm).toEqual({ x: 0.1, y: 0.25, w: 0.5, h: 0.02 });
      // Same anchor drawn on the page rendered at 2× zoom.
      expect(denormalizeRect(norm, { width: 1200, height: 1600 })).toEqual({ left: 120, top: 400, width: 600, height: 32 });
    });

    it("keeps rectangles inside the page", () => {
      const norm = normalizeRect({ left: 550, top: 790, width: 200, height: 50 }, page);
      expect(norm.x + norm.w).toBeLessThanOrEqual(1);
      expect(norm.y + norm.h).toBeLessThanOrEqual(1);
      expect(normalizeRect({ left: -40, top: -10, width: 10, height: 10 }, page)).toMatchObject({ x: 0, y: 0 });
    });

    it("merges the fragments of a line into one bar and drops empties", () => {
      const merged = mergeLineRects([
        { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
        { x: 0.3, y: 0.2005, w: 0.25, h: 0.02 },
        { x: 0.1, y: 0.23, w: 0.4, h: 0.02 },
        { x: 0.5, y: 0.5, w: 0, h: 0.02 },
      ]);
      expect(merged).toHaveLength(2);
      expect(merged[0]).toMatchObject({ x: 0.1, y: 0.2, w: 0.45 });
      expect(merged[1]).toMatchObject({ x: 0.1, y: 0.23, w: 0.4 });
    });

    it("caps how many rectangles an anchor can carry", () => {
      const many = Array.from({ length: 200 }, (_, i) => ({ x: 0.1, y: i * 0.004, w: 0.5, h: 0.002 }));
      expect(mergeLineRects(many, 40).length).toBeLessThanOrEqual(40);
    });
  });
});

describe("anchors coming back from the database", () => {
  it("accepts well-formed anchors for the right format only", () => {
    expect(parseAnchor({ type: "epub", cfi: "epubcfi(/6/4!/4/2)" }, "epub")).toBeTruthy();
    expect(parseAnchor({ type: "pdf", page: 3, y: 0.2 }, "pdf")).toBeTruthy();
    expect(parseAnchor({ type: "pdf", page: 3 }, "epub")).toBeNull();
    expect(parseAnchor({ type: "epub", cfi: "x" }, "pdf")).toBeNull();
  });

  it("rejects junk instead of navigating somewhere random", () => {
    expect(parseAnchor(null, "epub")).toBeNull();
    expect(parseAnchor("epubcfi(/6/4)", "epub")).toBeNull();
    expect(parseAnchor({ type: "pdf", page: 0 }, "pdf")).toBeNull();
    expect(parseAnchor({ type: "pdf" }, "pdf")).toBeNull();
    expect(parseAnchor({ type: "epub" }, "epub")).toBeNull();
  });
});
