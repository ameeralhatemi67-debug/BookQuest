// Critical acceptance scenario — Group.
//
// Five testers in one Race room. The owner and one member use the real UI; the
// other three act through the API (exactly what their browsers would send), so
// the room fills with realistic activity quickly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { apiClient, createRoom, goToChapter, leaveNote, openReader, signUp, uploadBook, waitForSaved, watchForErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

let ownerContext: BrowserContext;
let saraContext: BrowserContext;
let owner: Page;
let sara: Page;
let ownerEmail: string;
let saraEmail: string;
let roomId: string;
let ownerErrors: { errors: string[] };
const others: { name: string; email: string; api: SupabaseClient; id: string }[] = [];
const roomName = `Race to the lighthouse ${Date.now().toString(36).slice(-4)}`;

const read = (api: SupabaseClient, position: number, label: string) =>
  api.rpc("save_progress", { p_room_id: roomId, p_position: position, p_anchor: { type: "epub", cfi: "epubcfi(/6/4!/4/2)" }, p_label: label });

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext();
  saraContext = await browser.newContext();
  owner = await ownerContext.newPage();
  sara = await saraContext.newPage();
  ownerErrors = watchForErrors(owner);
});

test.afterAll(async () => {
  await ownerContext?.close();
  await saraContext?.close();
});

test("five testers end up in the same room", async ({ browser }) => {
  ownerEmail = await signUp(owner, "Amir Group");
  await owner.waitForURL("**/home");
  const bookId = await uploadBook(owner, "the-lighthouse.epub");
  roomId = await createRoom(owner, bookId, { name: roomName, mode: "Race", visibility: "Open" });
  await owner.keyboard.press("Escape");

  saraEmail = await signUp(sara, "Sara Group");
  await sara.waitForURL("**/home");
  await sara.goto(`/rooms/${roomId}`);
  await sara.getByRole("button", { name: "Join this room" }).click();
  await expect(sara.getByRole("link", { name: "Start reading" })).toBeVisible();

  for (const name of ["Fahad Group", "Khalid Group", "Noor Group"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = await signUp(page, name);
    await page.waitForURL("**/home");
    await context.close();
    const api = await apiClient(email);
    const id = (await api.auth.getUser()).data.user!.id;
    expect(((await api.rpc("join_open_room", { p_room_id: roomId })).data as { status: string }).status).toBe("joined");
    others.push({ name, email, api, id });
  }
});

test("a new member joining shows up live for people already in the room", async () => {
  // The owner's page was opened before the others joined and was never reloaded.
  await expect(owner.getByText("5 readers")).toBeVisible();
  for (const name of ["Sara Group", "Fahad Group", "Khalid Group", "Noor Group"]) {
    await expect(owner.getByText(`${name} joined.`)).toBeVisible();
  }
});

test("the progress track stays readable, including overlapping positions", async () => {
  const [fahad, khalid, noor] = others;
  await read(fahad.api, 0.62, "Chapter 8");
  await read(khalid.api, 0.31, "Chapter 4");
  await read(noor.api, 0.315, "Chapter 4"); // practically on top of Khalid

  const track = owner.getByRole("list", { name: "Where everyone is in the book" }).first();
  // Everyone is accounted for: 5 readers across the clusters.
  await expect(track.getByRole("button", { name: /Fahad Group/ })).toBeVisible();
  const stack = track.getByRole("button", { name: /2 readers here: .*Khalid Group.*Noor Group|2 readers here: .*Noor Group.*Khalid Group/ });
  await expect(stack).toBeVisible();

  // Tapping a stack lists who is in it — nothing essential needs hover.
  await stack.click();
  const popover = owner.getByRole("dialog").last();
  await expect(popover.getByText("Khalid Group")).toBeVisible();
  await expect(popover.getByText("Noor Group")).toBeVisible();
  await expect(popover.getByText("31%").first()).toBeVisible();
  await owner.keyboard.press("Escape");

  // Race mode: explicit standings, leader first, ties sharing a rank.
  const standings = owner.locator("ol").filter({ hasText: "in front" });
  await expect(standings.locator("li").first()).toContainText("Fahad Group");
  await expect(standings.locator("li").first()).toContainText("62%");
  await expect(standings).toContainText("31% back");
  await expect(standings.locator("li")).toHaveCount(5);

  // Avatars never leave the track (no horizontal overflow of the page).
  const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("presence shows who is reading right now, and clears when they stop", async () => {
  await openReader(sara, roomId);
  await expect(owner.getByText("1 person reading right now")).toBeVisible({ timeout: 20_000 });
  const track = owner.getByRole("list", { name: "Where everyone is in the book" }).first();
  await expect(track.getByRole("button", { name: /Sara Group.*reading now/ })).toBeVisible();

  await sara.goto(`/rooms/${roomId}`);
  await expect(owner.getByText("1 person reading right now")).toBeHidden({ timeout: 20_000 });
});

test("annotations identify their creators and replies stay understandable", async () => {
  const [fahad, khalid] = others;
  await openReader(owner, roomId);
  const rail = owner.getByRole("complementary", { name: "Reading progress" });
  const stack = rail.getByRole("button", { name: /2 readers here: .*Khalid Group.*Noor Group|2 readers here: .*Noor Group.*Khalid Group/ });
  await stack.click();
  await expect(owner.getByRole("dialog").last()).toContainText("Khalid Group");
  await expect(owner.getByRole("dialog").last()).toContainText("Noor Group");
  await owner.keyboard.press("Escape");
  await goToChapter(owner, /Chapter 2 ·/);
  await leaveNote(owner, { text: "First theory: the keeper never sent the letter." });
  await waitForSaved(owner, 0.08);

  const { data: markers } = await fahad.api.from("annotation_markers").select("id, author_id").eq("room_id", roomId);
  expect(markers).toHaveLength(1);
  const markerId = markers![0].id as string;

  // Fahad (62%) and Khalid (31%) are both past it, so they can join the thread.
  expect((await fahad.api.rpc("add_reply", { p_marker_id: markerId, p_body: "I think the brother hid it." })).error).toBeNull();
  expect((await khalid.api.rpc("add_reply", { p_marker_id: markerId, p_body: "Wait until chapter 4…" })).error).toBeNull();
  expect((await khalid.api.rpc("toggle_reaction", { p_marker_id: markerId, p_emoji: "🔥" })).error).toBeNull();

  await owner.getByRole("button", { name: /What's been left in this book/ }).click();
  const trail = owner.getByRole("dialog", { name: /What's been left/ });
  await trail.getByRole("button", { name: /First theory/ }).click();
  const thread = owner.getByRole("dialog", { name: "Note" });
  // Author on the note, a name on every reply, in order.
  await expect(thread.getByText("You", { exact: true }).first()).toBeVisible();
  const replies = thread.getByRole("list", { name: "2 replies" }).locator("li");
  await expect(replies).toHaveCount(2);
  await expect(replies.nth(0)).toContainText("Fahad Group");
  await expect(replies.nth(0)).toContainText("I think the brother hid it.");
  await expect(replies.nth(1)).toContainText("Khalid Group");
  await expect(thread.getByRole("button", { name: /🔥 1, from Khalid Group/ })).toBeVisible();
  await owner.keyboard.press("Escape");

  // Sara has not reached it: she sees a neutral marker count only.
  const saraApi = await apiClient(saraEmail);
  expect((await saraApi.from("annotation_replies").select("*").eq("room_id", roomId)).data).toEqual([]);
});

test("notifications stay restrained however busy the room gets", async () => {
  const [fahad, khalid, noor] = others;
  // A burst of ordinary reading: many saves from three people.
  for (let step = 1; step <= 8; step++) {
    await read(fahad.api, 0.62 + step * 0.01, "Chapter 8");
    await read(khalid.api, 0.31 + step * 0.01, "Chapter 4");
    await read(noor.api, 0.315 + step * 0.01, "Chapter 4");
  }

  const ownerApi = await apiClient(ownerEmail);
  const { data: notifications } = await ownerApi.from("notifications").select("type").eq("room_id", roomId);
  const counts: Record<string, number> = {};
  for (const n of notifications ?? []) counts[n.type as string] = (counts[n.type as string] ?? 0) + 1;
  // 4 joins, 2 replies, 1 reaction, and "reached what you left" once per reader who reached it — and
  // not a single one about somebody merely turning pages.
  expect(counts.member_joined).toBe(4);
  expect(counts.reply).toBe(2);
  expect(counts.reaction).toBe(1);
  expect(counts.unlocked ?? 0).toBeLessThanOrEqual(4);
  expect(Object.keys(counts).sort()).toEqual(["member_joined", "reaction", "reply", "unlocked"].filter((k) => counts[k]).sort());
  expect((notifications ?? []).length).toBeLessThanOrEqual(11);

  // 24 progress saves produced no activity spam either: only milestones / passes.
  const { data: activity } = await ownerApi.from("room_activity").select("type").eq("room_id", roomId);
  const types = (activity ?? []).map((a) => a.type as string);
  expect(types.filter((t) => t === "started_reading").length).toBeLessThanOrEqual(5);
  expect(types.length).toBeLessThan(30);

  // Fahad is in the thread, so he hears about Khalid's reply; Noor is not in it, so she hears no replies.
  expect(((await khalid.api.from("notifications").select("type").eq("type", "reply")).data ?? []).length).toBe(0);
  expect(((await fahad.api.from("notifications").select("type").eq("type", "reply")).data ?? []).length).toBe(1);
  // Noor only heard that a note appeared at a place she had already passed — once.
  expect(((await noor.api.from("notifications").select("type").eq("room_id", roomId)).data ?? []).map((n) => n.type)).toEqual(["note_behind"]);
});

test("leaving and re-joining does not corrupt membership", async () => {
  const [, , noor] = others;
  await owner.goto(`/rooms/${roomId}`);
  await expect(owner.getByText("5 readers")).toBeVisible();

  expect((await noor.api.rpc("leave_room", { p_room_id: roomId })).error).toBeNull();
  await expect(owner.getByText("4 readers")).toBeVisible();
  await expect(owner.getByText("Noor Group left the room.")).toBeVisible();

  expect(((await noor.api.rpc("join_open_room", { p_room_id: roomId })).data as { status: string }).status).toBe("joined");
  await expect(owner.getByText("5 readers")).toBeVisible();
  await expect(owner.getByText("Noor Group came back.")).toBeVisible();

  const ownerApi = await apiClient(ownerEmail);
  const { data: rows } = await ownerApi.from("room_members").select("user_id, status").eq("room_id", roomId);
  expect(rows).toHaveLength(5);
  expect(new Set((rows ?? []).map((r) => r.user_id)).size).toBe(5);
  expect((rows ?? []).every((r) => r.status === "active")).toBe(true);
  // Her place in the book survived.
  const { data: progress } = await noor.api.from("reading_progress").select("furthest").eq("room_id", roomId).eq("user_id", noor.id);
  expect(Number(progress![0].furthest)).toBeCloseTo(0.395, 2);
});

test("the room page stayed free of console errors", async () => {
  expect(ownerErrors.errors).toEqual([]);
});
