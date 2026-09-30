import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { apiClient, createInviteLink, createRoom, goToChapter, openReader, signUp, uploadBook, waitForSaved, watchForErrors, wav } from "./helpers";

test.describe.configure({ mode: "serial" });
let context: BrowserContext, page: Page, room: string, invite: string, email: string;
let errors: { errors: string[] };

const audioFile = () => ({ name: "reading.wav", mimeType: "audio/wav", buffer: wav(30) });

test.beforeAll(async ({ browser }, info) => {
  context = await browser.newContext({ viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch });
  page = await context.newPage(); errors = watchForErrors(page);
});
test.afterAll(async () => context?.close());

test("creates a shared read on a phone or laptop", async () => {
  email = await signUp(page, "Soundtrack Reader");
  await page.waitForURL("**/home");
  const book = await uploadBook(page, "the-lighthouse.epub");
  room = await createRoom(page, book, { name: "A book with a soundtrack" });
  invite = await createInviteLink(page); await page.keyboard.press("Escape");
  await openReader(page, room);
});

test("fits small phones, tablets, landscape phones and laptops", async () => {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [844, 390], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.frameLocator("main iframe").locator("body").evaluate((body) => parseFloat(getComputedStyle(body).columnWidth)), { timeout: 5000 }).toBeLessThanOrEqual(width);
    for (const name of ["Contents", "Reading settings", "Soundtrack", "Leave a note here"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  }
  await page.screenshot({ path: "test-results/reader-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.frameLocator("main iframe").locator("body").evaluate((body) => parseFloat(getComputedStyle(body).columnWidth)).catch(() => Infinity)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/reader-mobile.png" });
});

test("settings, focus and keyboard dismissal work", async () => {
  await page.getByRole("button", { name: "Reading settings" }).click();
  for (const theme of ["Sepia", "Dark", "Light"]) {
    await page.getByRole("radio", { name: theme, exact: true }).click();
    await expect(page.getByTestId("reader")).toHaveAttribute("data-reader-theme", theme.toLowerCase());
  }
  await page.getByRole("button", { name: "Increase text size" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Focus on the book" }).click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-focus", "true");
  await page.getByRole("button", { name: "Show reading controls" }).click();
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Contents", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Contents", exact: true })).toBeHidden();
});

test("uploads, plays, pauses, hides and stops the soundtrack", async () => {
  await page.getByRole("button", { name: "Soundtrack", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Soundtrack", exact: true });
  await expect(panel.getByText("Every book has a mood")).toBeVisible();
  await panel.getByLabel("Audio file", { exact: true }).setInputFiles(audioFile());
  await panel.getByLabel("Track name").fill("Rain at the window");
  await panel.getByRole("button", { name: "Add to soundtrack" }).click();
  await expect(panel.getByRole("button", { name: "Play Rain at the window" })).toBeEnabled();
  await panel.getByRole("button", { name: "Play Rain at the window" }).click();
  await expect(panel.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  const pausedAt = await page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime);
  await panel.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(pausedAt);
  await panel.getByRole("button", { name: "Close soundtrack" }).click();
  await expect(page.getByTestId("music-player")).toBeVisible();
  await page.getByRole("button", { name: "Hide music player" }).click();
  await expect(page.getByTestId("music-player")).toBeHidden();
  expect(await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
  await page.getByRole("button", { name: "Soundtrack", exact: true }).click();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  expect(await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused && a.currentTime === 0)).toBe(true);
  await panel.getByRole("button", { name: "Close soundtrack" }).click();
});

test("a friend's page cue stays private then plays when reached", async ({ browser }) => {
  await goToChapter(page, /Chapter 6 ·/); await waitForSaved(page, 0.3);
  await page.getByRole("button", { name: "Soundtrack", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Soundtrack", exact: true });
  await panel.getByLabel("Audio file", { exact: true }).setInputFiles(audioFile());
  await panel.getByLabel("Track name").fill("A song for chapter six");
  await panel.getByLabel("Start when a friend reaches this page").check();
  await panel.getByRole("button", { name: "Leave music here" }).click();
  await expect(panel.getByRole("button", { name: "Play A song for chapter six" })).toBeEnabled();
  await panel.getByRole("button", { name: "Close soundtrack" }).click();

  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const friend = await other.newPage();
  try {
    const path = new URL(invite).pathname;
    const friendEmail = await signUp(friend, "Music Friend", { next: path });
    await friend.waitForURL(`**${path}`); await friend.getByRole("button", { name: "Join and start reading" }).click();
    await friend.waitForURL(`**/rooms/${room}`); await openReader(friend, room);
    const client = await apiClient(friendEmail);
    const { data } = await client.from("soundtrack_tracks").select("title").eq("room_id", room);
    expect(data!.map((t) => t.title)).toEqual(["Rain at the window"]);
    await friend.getByRole("button", { name: "Soundtrack", exact: true }).click();
    await friend.getByLabel("Play music when I reach a page cue").check();
    await friend.getByRole("button", { name: "Close soundtrack" }).click();
    await goToChapter(friend, /Chapter 6 ·/);
    await expect(friend.getByTestId("music-player")).toContainText("A song for chapter six");
    await expect.poll(() => friend.locator("audio").evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
    await friend.getByRole("button", { name: "Stop music" }).click();
  } finally { await other.close(); }
});

test("keeps the book usable during a Wi-Fi drop and saves after reconnecting", async () => {
  await context.setOffline(true);
  try {
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText(/Reconnecting|Place not saved yet/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("reader")).toHaveAttribute("data-ready", "true");
  } finally { await context.setOffline(false); }
  await expect(page.getByTestId("reader")).toHaveAttribute("data-save-status", "saved", { timeout: 20000 });
});

test("opens the journey, search, profile, feedback and room settings", async () => {
  await page.goto(`/rooms/${room}/journey`);
  await expect(page.getByRole("heading", { name: /journey/i }).first()).toBeVisible();
  await page.goto("/search"); await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  await page.goto("/profile"); await expect(page.getByRole("heading", { name: /profile/i })).toBeVisible();
  await page.getByLabel("Display name").fill("A Soundtrack Reader");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Name updated.")).toBeVisible();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByLabel("Your feedback").fill("The soundtrack controls are easy to reach on a phone.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText(/Thank you — that goes straight/)).toBeVisible();
  await page.goto(`/rooms/${room}`);
  await page.getByRole("button", { name: "Room settings" }).click();
  await expect(page.getByRole("dialog", { name: "Room settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors.errors).toEqual([]);
  expect(email).toBeTruthy();
});
