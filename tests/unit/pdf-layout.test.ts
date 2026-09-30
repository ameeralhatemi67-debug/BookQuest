import { expect, it } from "vitest";
import { pdfLayout } from "../../src/lib/books/pdf-layout";
import { pdfViewState } from "../../src/lib/location";

it("fits complete single pages and paired spreads, including phones, mixed sizes and an odd last page", () => {
  const sizes = [{ width: 612, height: 792 }, { width: 800, height: 600 }, { width: 612, height: 1000 }];
  for (const [width, height] of [[1360, 650], [390, 650], [844, 210]]) {
    for (const zoom of [1, 0.8]) {
      const layout = pdfLayout(sizes, width, height, zoom);
      for (let i = 0; i < sizes.length; i++) {
        expect(layout.lefts[i]).toBeGreaterThanOrEqual(0);
        expect(layout.lefts[i] + layout.widths[i]).toBeLessThanOrEqual(width + 0.01);
        expect(layout.heights[i]).toBeLessThanOrEqual(height - 32 + 0.01);
      }
      const state = pdfViewState({ pageTops: layout.tops, pageHeights: layout.heights, scrollTop: 16, viewportHeight: height - 16 });
      expect(state.page).toBe(1);
      expect(state.progress).toBe(0);
      expect(state.reach).toBeCloseTo((zoom === 1 ? 1 : 2) / 3, 5);
      if (zoom < 1) {
        expect(layout.tops[0]).toBe(layout.tops[1]);
        expect(layout.lefts[1]).toBeGreaterThan(layout.lefts[0] + layout.widths[0]);
        expect(layout.tops[2]).toBeGreaterThanOrEqual(height);
      }
    }
  }
  expect(pdfLayout(sizes, 1360, 650, 2).widths[0]).toBeCloseTo(pdfLayout(sizes, 1360, 650, 1).widths[0] * 2);
  expect(pdfViewState({ pageTops: [16, 1020.4], pageHeights: [1000, 1000], scrollTop: 1020, viewportHeight: 600 }).page).toBe(2);
});
