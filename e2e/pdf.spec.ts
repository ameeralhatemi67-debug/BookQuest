// The PDF reader: page navigation, zoom, resume, and notes anchored to a
// selected passage (page + normalized rectangles + the quoted text).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { apiClient, createInviteLink, createRoom, openReader, readerProgress, signUp, uploadBook, waitForSaved, watchForErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let email: string;
let roomId: string;
let inviteUrl: string;
let errors: { errors: string[] };

const label = (p: Page) => p.locator("header p").nth(1);

/** Selects the text of the first line-ish span on a page, the way a reader would by dragging. */
async function selectTextOnPage(p: Page, pageNumber: number) {
  await p.locator(`[data-page="${pageNumber}"]`).scrollIntoViewIfNeeded();
  await p.evaluate((n) => {
    const layer = document.querySelector(`[data-page="${n}"] .pdf-text-layer`);
    const spans = [...(layer?.querySelectorAll("span") ?? [])].filter((s) => (s.textContent ?? "").trim().length > 20);
    const first = spans[3];
    const last = spans[5];
    const range = document.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(last.firstChild!, (last.textContent ?? "").length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, pageNumber);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  errors = watchForErrors(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("opens a PDF at page 1 with its page count", async () => {
  email = await signUp(page, "Petra Pdf");
  await page.waitForURL("**/home");
  const bookId = await uploadBook(page, "field-notes.pdf");
  roomId = await createRoom(page, bookId, { name: "Field notes, slowly" });
  inviteUrl = await createInviteLink(page);
  await page.keyboard.press("Escape");

  await openReader(page, roomId);
  await expect(label(page)).toHaveText("Page 1 of 24");
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  // Real, selectable text was laid over the page image.
  await expect(page.locator('[data-page="1"] .pdf-text-layer span').first()).toBeAttached();
  await expect(page.locator('[data-page="1"] .pdf-text-layer')).toContainText("Field Notes, page 1");
});

test("only renders the pages near the viewport", async () => {
  const rendered = await page.locator("[data-page]").count();
  expect(rendered).toBeLessThanOrEqual(4);
  expect(rendered).toBeGreaterThanOrEqual(1);
});

test("navigates by keyboard and tracks page and progress", async () => {
  await page.locator('[aria-label="Book pages"]').focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(350);
  }
  await expect(label(page)).toHaveText(/Page [3-7] of 24/);
  const progress = await readerProgress(page);
  expect(progress).toBeGreaterThan(0.1);
  expect(progress).toBeLessThan(0.4);

  // The contents panel is honest when a PDF has no outline.
  await page.getByRole("button", { name: "Contents" }).click();
  await expect(page.getByText("This book doesn't include a table of contents.")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("zooming keeps the reader on the same page", async () => {
  const before = await label(page).textContent();
  const width = async () => (await page.locator("[data-page]").first().boundingBox())!.width;
  const initial = await width();

  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Increase zoom" }).click();
  await page.getByRole("button", { name: "Increase zoom" }).click();
  await expect.poll(width).toBeGreaterThan(initial * 1.25);
  await expect(label(page)).toHaveText(before!);

  await page.getByRole("button", { name: "Fit to width" }).click();
  await expect.poll(width).toBeCloseTo(initial, -1);
  await expect(label(page)).toHaveText(before!);
  await page.keyboard.press("Escape");
});

test("a note can be anchored to a selected passage", async () => {
  const current = Number(/Page (\d+)/.exec((await label(page).textContent())!)![1]);
  const target = current + 1;
  await expect(page.locator(`[data-page="${target}"] .pdf-text-layer span`).nth(8)).toBeAttached();
  await selectTextOnPage(page, target);

  const toolbar = page.getByRole("toolbar", { name: "Selected passage" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Note" }).click();

  const composer = page.getByRole("dialog", { name: "Leave a note" });
  await expect(composer.locator("blockquote")).toContainText(/\w+ \w+/); // the quoted passage
  await composer.getByLabel("Your note").fill("This line again. Compare with the first page.");
  await composer.getByRole("button", { name: "Leave it here" }).click();
  await expect(composer).toBeHidden();

  // The anchor is robust: page number + rectangles normalized to the page + the quote.
  const api = await apiClient(email);
  const { data: markers } = await api.from("annotation_markers").select("id, position, anchor, location_label").eq("room_id", roomId);
  expect(markers).toHaveLength(1);
  const anchor = markers![0].anchor as { type: string; page: number; y: number; rects: { x: number; y: number; w: number; h: number }[] };
  expect(anchor.type).toBe("pdf");
  expect(anchor.page).toBe(target);
  expect(anchor.rects.length).toBeGreaterThanOrEqual(1);
  for (const rect of anchor.rects) {
    for (const value of [rect.x, rect.y, rect.w, rect.h]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  }
  expect(markers![0].location_label).toBe(`Page ${target} of 24`);
  expect(Number(markers![0].position)).toBeCloseTo((target - 1 + anchor.rects[0].y) / 24, 3);
  const { data: contents } = await api.from("annotation_contents").select("quote, body").eq("marker_id", markers![0].id);
  expect(contents![0].quote!.length).toBeGreaterThan(20);

  // The highlight and the margin marker are drawn on that page.
  const pageElement = page.locator(`[data-page="${target}"]`);
  await expect(pageElement.getByRole("button", { name: /Open what Petra Pdf left here/ })).toBeVisible();
  await expect(pageElement.locator("span.mix-blend-multiply").first()).toBeVisible();
});

test("the highlight stays on its passage when the page is re-rendered at another zoom", async () => {
  const highlight = page.locator("span.mix-blend-multiply").first();
  const pageBox = async () => (await page.locator("[data-page]", { has: highlight }).boundingBox())!;
  const relative = async () => {
    const h = (await highlight.boundingBox())!;
    const p = await pageBox();
    return { x: (h.x - p.x) / p.width, y: (h.y - p.y) / p.height, w: h.width / p.width };
  };
  const before = await relative();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Increase zoom" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const after = await relative();
  expect(after.x).toBeCloseTo(before.x, 2);
  expect(after.y).toBeCloseTo(before.y, 2);
  expect(after.w).toBeCloseTo(before.w, 2);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Fit to width" }).click();
  await page.keyboard.press("Escape");
});

test("the place is restored after a reload", async () => {
  await waitForSaved(page, 0.1);
  const before = (await label(page).textContent())!;
  const progress = await readerProgress(page);
  await page.reload();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(label(page)).toHaveText(before);
  await expect.poll(() => readerProgress(page)).toBeCloseTo(progress, 1);
});

test("another reader sees the note locked, then unlocked on reaching its page", async ({ browser }) => {
  const other = await browser.newContext();
  const reader = await other.newPage();
  const path = new URL(inviteUrl).pathname;
  await signUp(reader, "Quentin Pdf", { next: path });
  await reader.waitForURL(`**${path}`);
  await reader.getByRole("button", { name: "Join and start reading" }).click();
  await reader.waitForURL(`**/rooms/${roomId}`);

  await openReader(reader, roomId);
  await expect(label(reader)).toHaveText("Page 1 of 24");
  await expect(reader.getByText("1 thing waiting ahead")).toBeVisible();

  await reader.locator('[aria-label="Book pages"]').focus();
  const status = reader.getByRole("status").filter({ hasText: "Petra left something here" });
  for (let i = 0; i < 14 && !(await status.isVisible()); i++) {
    await reader.keyboard.press("PageDown");
    await reader.waitForTimeout(1300);
  }
  await expect(status).toBeVisible({ timeout: 15_000 });
  await status.getByRole("button", { name: "Open" }).click();
  await expect(reader.getByRole("dialog", { name: "Note" }).getByText("This line again. Compare with the first page.")).toBeVisible();
  await other.close();
});

test("the PDF reader stayed free of console errors", async () => {
  expect(errors.errors).toEqual([]);
});
