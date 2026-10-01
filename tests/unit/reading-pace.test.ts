import { expect, it } from "vitest";
import { readingIdleLimit, readingPace } from "../../src/components/reader/use-reading-coverage";

it("calibrates sustained reading while excluding fast scans, long-idle outliers, and short fragments", () => {
  expect(readingPace(120,30,240)).toBe(240);
  expect(readingPace(200,30,240)).toBe(272);
  expect(readingPace(400,2,240)).toBe(240);
  expect(readingPace(200,500,240)).toBe(240);
  expect(readingPace(20,5,240)).toBe(240);
  expect(readingIdleLimit(400,240)).toBe(215);
  expect(readingIdleLimit(0,240)).toBe(45);
  expect(readingIdleLimit(1200,240)).toBe(600); // a two-page spread gets enough uninterrupted reading time
});
