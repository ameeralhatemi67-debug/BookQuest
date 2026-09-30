export interface PageSize { width: number; height: number }

/** View range: 20% enlarges the book, 100% fits one page, 120% fits two. */
export function pdfLayout(sizes: PageSize[], width: number, height: number, zoom: number) {
  const gap = 16;
  const gutter = width < 640 ? 8 : 40;
  const columns = zoom >= 1.2 ? 2 : 1;
  const tops: number[] = [], heights: number[] = [], widths: number[] = [], scales: number[] = [], lefts: number[] = [];
  const rows: { start: number; width: number }[] = [];
  let y = gap, contentWidth = width;
  for (let i = 0; i < sizes.length; i += columns) {
    const row = sizes.slice(i, i + columns);
    const rowWidth = row.reduce((sum, page) => sum + page.width, 0);
    const scale = Math.min(Math.max(1, width - gutter * 2 - gap * (row.length - 1)) / rowWidth, Math.max(1, height - gap * 2) / Math.max(...row.map(page => page.height))) / zoom;
    let x = 0;
    for (const page of row) {
      tops.push(y); widths.push(page.width * scale); heights.push(page.height * scale); scales.push(scale); lefts.push(x);
      x += page.width * scale + gap;
    }
    rows.push({ start: i, width: x - gap });
    contentWidth = Math.max(contentWidth, x - gap + gutter * 2);
    y += Math.max(height, Math.max(...row.map(page => page.height * scale)) + gap * 2);
  }
  for (const row of rows) for (let i = row.start; i < Math.min(sizes.length, row.start + columns); i++) lefts[i] += (contentWidth - row.width) / 2;
  return { tops, heights, widths, scales, lefts, total: Math.max(0, y - gap), width: contentWidth, columns, fitted: zoom >= 1 };
}
