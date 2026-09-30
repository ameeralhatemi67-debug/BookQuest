// Critical acceptance scenario — Duo.
//
//   Amir creates an account, uploads a book, opens a Private Duo room, invites
//   Sara, reads ahead and leaves notes (one with an image, one with audio).
//   Sara joins, reads from the start, sees neutral markers ahead, cannot get at
//   their contents, reaches them one by one, replies, refreshes, and comes back
//   on another "device".
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  apiClient, anonApi, createInviteLink, createRoom, emailFor, goToChapter, leaveNote, openReader, readerProgress,
  signIn, signUp, uploadBook, waitForSaved, watchForErrors,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let amirContext: BrowserContext;
let saraContext: BrowserContext;
let amir: Page;
let sara: Page;
let amirEmail: string;
let saraEmail: string;
let roomId: string;
let bookId: string;
let inviteUrl: string;
let amirErrors: { errors: string[] };
let saraErrors: { errors: string[] };

test.beforeAll(async ({ browser }) => {
  amirContext = await browser.newContext();
  saraContext = await browser.newContext();
  amir = await amirContext.newPage();
  sara = await saraContext.newPage();
  amirErrors = watchForErrors(amir);
  saraErrors = watchForErrors(sara);
});

test.afterAll(async () => {
  await amirContext?.close();
  await saraContext?.close();
});

test("A · creates an account", async () => {
  amirEmail = await signUp(amir, "Amir");
  await amir.waitForURL("**/home");
  await expect(amir.getByRole("heading", { name: /Welcome, Amir/ })).toBeVisible();
});

test("A · uploads a book", async () => {
  bookId = await uploadBook(amir, "the-lighthouse.epub");
  expect(bookId).toMatch(/^[0-9a-f-]{36}$/);
  // Metadata came from the file itself, not the filename.
  await amir.goto("/books");
  await expect(amir.getByRole("heading", { name: "The Lighthouse Keeper's Year" })).toBeVisible();
  await expect(amir.locator("p", { hasText: "A. N. Original" })).toBeVisible();
});

test("A · creates a Private Duo room and invites B", async () => {
  roomId = await createRoom(amir, bookId, { name: "Lighthouse for two", mode: "Private Duo" });
  inviteUrl = await createInviteLink(amir);
  expect(inviteUrl).toMatch(/\/invite\/[0-9a-f]{64}$/);
  await amir.keyboard.press("Escape");
  await expect(amir.getByRole("heading", { name: "Lighthouse for two" })).toBeVisible();
  await expect(amir.getByText("Private Duo").first()).toBeVisible();
});

test("A · reads to 50% and leaves notes at ~20%, ~45% and ~70%", async () => {
  await openReader(amir, roomId);

  await goToChapter(amir, /Chapter 3 ·/);
  await leaveNote(amir, { text: "I did not see this coming. Remember the letter from chapter one?" });

  await goToChapter(amir, /Chapter 6 ·/);
  await leaveNote(amir, { text: "This is the map I was talking about", image: true });

  await goToChapter(amir, /Chapter 9 ·/);
  await leaveNote(amir, { text: "Listen to this when you get here", audio: true });

  await goToChapter(amir, /Chapter 7 ·/);
  await waitForSaved(amir, 0.6); // furthest is where the last note was left

  const api = await apiClient(amirEmail);
  const { data: markers } = await api.from("annotation_markers").select("position").eq("room_id", roomId).order("position");
  const positions = (markers ?? []).map((m) => Number(m.position));
  expect(positions).toHaveLength(3);
  expect(positions[0]).toBeGreaterThan(0.15);
  expect(positions[0]).toBeLessThan(0.25);
  expect(positions[1]).toBeGreaterThan(0.4);
  expect(positions[1]).toBeLessThan(0.5);
  expect(positions[2]).toBeGreaterThan(0.65);
  expect(positions[2]).toBeLessThan(0.75);
});

test("B · creates an account through the invitation and joins", async () => {
  const path = new URL(inviteUrl).pathname;
  // Opening the invitation signed-out leads to sign-in, and remembers where B was going.
  await sara.goto(path);
  await sara.waitForURL(/\/login\?next=/);
  saraEmail = await signUp(sara, "Sara", { next: path });
  await sara.waitForURL(`**${path}`);
  await expect(sara.getByRole("heading", { name: "Lighthouse for two" })).toBeVisible();
  await expect(sara.getByText("Amir invited you to read")).toBeVisible();
  await sara.getByRole("button", { name: "Join and start reading" }).click();
  await sara.waitForURL(`**/rooms/${roomId}`);
  expect(saraEmail).toBe(emailFor("Sara"));
});

test("B · sees A's progress and neutral markers ahead, and nothing else", async () => {
  // The room shows both readers on the shared track.
  const track = sara.getByRole("list", { name: "Where everyone is in the book" }).first();
  await expect(track.getByRole("button", { name: /Amir/ })).toBeVisible();
  await expect(sara.getByText("3 things waiting ahead")).toBeVisible();

  await openReader(sara, roomId);
  expect(await readerProgress(sara)).toBeLessThan(0.1);
  await expect(sara.getByText("3 things waiting ahead")).toBeVisible();

  // The trail says who left something — never what.
  await sara.getByRole("button", { name: /What's been left in this book/ }).click();
  const trail = sara.getByRole("dialog", { name: /What's been left/ });
  await expect(trail.getByText("3 things waiting ahead of you")).toBeVisible();
  await expect(trail.getByText("Amir left 3 things")).toBeVisible();
  await expect(trail).not.toContainText("did not see this coming");
  await expect(trail).not.toContainText("map");
  await sara.keyboard.press("Escape");
});

test("B · cannot retrieve protected note content early (at the API, not just the UI)", async () => {
  const api = await apiClient(saraEmail);

  const markers = await api.from("annotation_markers").select("*").eq("room_id", roomId).order("position");
  expect(markers.data).toHaveLength(3);
  expect(JSON.stringify(markers.data)).not.toMatch(/did not see|map I was|Listen to this/);

  for (const table of ["annotation_contents", "annotation_attachments", "annotation_replies", "annotation_reactions"]) {
    const result = await api.from(table).select("*").eq("room_id", roomId);
    expect(result.data, table).toEqual([]);
  }

  // Guessing ids does not help either.
  const ids = (markers.data ?? []).map((m) => m.id as string);
  const byId = await api.from("annotation_contents").select("*").in("marker_id", ids);
  expect(byId.data).toEqual([]);
  const reply = await api.rpc("add_reply", { p_marker_id: ids[2], p_body: "let me in" });
  expect(reply.error?.message).toBe("note_unavailable");

  // Media: even with the real storage path, signing and downloading are refused.
  const amirApi = await apiClient(amirEmail);
  const { data: attachments } = await amirApi.from("annotation_attachments").select("bucket, path, kind").eq("room_id", roomId);
  expect(attachments?.map((a) => a.kind).sort()).toEqual(["audio", "image"]);
  for (const attachment of attachments ?? []) {
    expect((await api.storage.from(attachment.bucket).createSignedUrl(attachment.path, 60)).error).toBeTruthy();
    expect((await api.storage.from(attachment.bucket).download(attachment.path)).error).toBeTruthy();
    expect((await anonApi().storage.from(attachment.bucket).download(attachment.path)).error).toBeTruthy();
  }
});

test("B · reaches 20%: the first note unlocks, and B replies", async () => {
  await goToChapter(sara, /Chapter 3 ·/);

  // The reveal.
  const reveal = sara.getByRole("status").filter({ hasText: "Amir left something here" });
  await expect(reveal).toBeVisible({ timeout: 20_000 });
  await reveal.getByRole("button", { name: "Open" }).click();

  const note = sara.getByRole("dialog", { name: "Note" });
  await expect(note.getByText("I did not see this coming. Remember the letter from chapter one?")).toBeVisible();

  await note.getByLabel("Reply to this note").fill("I forgot about the letter entirely!");
  await note.getByRole("button", { name: "Send reply" }).click();
  await expect(note.getByText("I forgot about the letter entirely!")).toBeVisible();
  await sara.keyboard.press("Escape");

  // Only that one is open; the other two are still sealed.
  const api = await apiClient(saraEmail);
  const contents = await api.from("annotation_contents").select("body").eq("room_id", roomId);
  expect(contents.data).toHaveLength(1);
});

test("A · sees B's reply and is told B reached the note", async () => {
  // Live: the thread updates without a reload.
  await amir.getByRole("button", { name: /What's been left in this book/ }).click();
  const trail = amir.getByRole("dialog", { name: /What's been left/ });
  await trail.getByRole("button", { name: /I did not see this coming/ }).click();
  const note = amir.getByRole("dialog", { name: "Note" });
  await expect(note.getByText("I forgot about the letter entirely!")).toBeVisible({ timeout: 20_000 });
  await amir.keyboard.press("Escape");

  await amir.goto("/notifications");
  await expect(amir.getByText(/Sara replied to something you left/)).toBeVisible();
  await expect(amir.getByText(/Sara reached something you left/)).toBeVisible();
  await expect(amir.getByText(/Sara joined Lighthouse for two/)).toBeVisible();
  // Notifications never quote content.
  await expect(amir.locator("main")).not.toContainText("forgot about the letter");
});

test("B · reaches 45%: the second note unlocks, with its image", async () => {
  await goToChapter(sara, /Chapter 6 ·/);
  const reveal = sara.getByRole("status").filter({ hasText: "Amir left something here" });
  await expect(reveal).toBeVisible({ timeout: 20_000 });
  await reveal.getByRole("button", { name: "Open" }).click();

  const note = sara.getByRole("dialog", { name: "Note" });
  await expect(note.getByText("This is the map I was talking about")).toBeVisible();
  const image = note.getByRole("img", { name: /map\.png/ });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await sara.keyboard.press("Escape");

  // The 70% note is still locked.
  const api = await apiClient(saraEmail);
  const contents = await api.from("annotation_contents").select("body").eq("room_id", roomId);
  expect(contents.data).toHaveLength(2);
  expect(JSON.stringify(contents.data)).not.toContain("Listen to this");
  await expect(sara.getByText("1 thing waiting ahead")).toBeVisible();
});

test("B · refreshes the browser: place and unlocks survive", async () => {
  await waitForSaved(sara, 0.4);
  const before = await readerProgress(sara);
  await sara.reload();
  await expect(sara.getByTestId("reader")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect.poll(() => readerProgress(sara)).toBeCloseTo(before, 1);
  await expect(sara.locator("header").getByText(/Chapter 6/)).toBeVisible();

  // Going back does not lock anything again.
  await goToChapter(sara, /Chapter 1 ·/);
  await sara.getByRole("button", { name: /What's been left in this book/ }).click();
  const trail = sara.getByRole("dialog", { name: /What's been left/ });
  await expect(trail.getByText("I did not see this coming. Remember the letter from chapter one?")).toBeVisible();
  await expect(trail.getByText("This is the map I was talking about")).toBeVisible();
  await expect(trail.getByText("1 thing waiting ahead of you")).toBeVisible();
  await sara.keyboard.press("Escape");
  await goToChapter(sara, /Chapter 6 ·/);
  await waitForSaved(sara, 0.4);
});

test("B · returns on another device: reading position restores", async ({ browser }) => {
  const device = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const page = await device.newPage();
  await signIn(page, saraEmail);
  await expect(page.getByRole("heading", { name: "The Lighthouse Keeper's Year" })).toBeVisible();
  await page.getByRole("link", { name: "Continue reading" }).click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(page.locator("header").getByText(/Chapter 6/)).toBeVisible();
  expect(await readerProgress(page)).toBeGreaterThan(0.4);
  await device.close();
});

test("the pages stayed free of console errors", async () => {
  expect(amirErrors.errors, "Amir's console").toEqual([]);
  expect(saraErrors.errors, "Sara's console").toEqual([]);
});
