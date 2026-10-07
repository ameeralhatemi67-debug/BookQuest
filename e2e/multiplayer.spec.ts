// Emotional multiplayer reading, end to end, with two real readers.
//
//   Sara signs up without a code, uploads a book, opens a Race room and invites
//   Fahad. She leaves notes at all five attention levels, a poll, a sealed
//   prediction and a package for Fahad further on. Fahad reads: avatars
//   perform, the page flips, the map glows ahead, the poll hides its results
//   until he votes, the prediction opens when he reaches it, the package
//   unwraps, and the vault opens at the end. Screenshots land in .local/showcase.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { apiClient, createInviteLink, createRoom, goToChapter, openReader, signUp, uploadBook, watchForErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

const shot = (page: Page, name: string) => page.screenshot({ path: `.local/showcase/${name}.png` });

let saraContext: BrowserContext;
let fahadContext: BrowserContext;
let sara: Page;
let fahad: Page;
let saraEmail: string;
let fahadEmail: string;
let roomId: string;
let inviteUrl: string;
let errors: { errors: string[] }[] = [];

test.beforeAll(async ({ browser }) => {
  saraContext = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  fahadContext = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  sara = await saraContext.newPage();
  fahad = await fahadContext.newPage();
  errors = [watchForErrors(sara), watchForErrors(fahad)];
});

test.afterAll(async () => {
  await saraContext?.close();
  await fahadContext?.close();
});

async function leave(page: Page, kind: "Note" | "Package" | "Prediction" | "Poll") {
  await page.getByRole("button", { name: "Leave a note here" }).click();
  const sheet = page.getByRole("dialog", { name: "Leave a note" });
  await expect(sheet).toBeVisible();
  if (kind !== "Note") await sheet.getByRole("radiogroup", { name: "What are you leaving?" }).getByRole("radio", { name: kind }).click();
  return sheet;
}

test("signs up without any code and opens a room", async () => {
  test.setTimeout(240_000);
  await sara.goto("/signup");
  await expect(sara.getByText("No code needed")).toBeVisible();
  await expect(sara.getByLabel("Alpha code")).toHaveCount(0);
  saraEmail = await signUp(sara, "Sara");
  await sara.waitForURL("**/home");
  const bookId = await uploadBook(sara, "the-lighthouse.epub");
  roomId = await createRoom(sara, bookId, { name: "Lighthouse night shift", mode: "Race" });
  inviteUrl = await createInviteLink(sara);
  await sara.keyboard.press("Escape");

  const path = new URL(inviteUrl).pathname;
  await fahad.goto(path);
  await fahad.waitForURL(/\/login\?next=/);
  fahadEmail = await signUp(fahad, "Fahad", { next: path });
  await fahad.waitForURL(`**${path}`);
  await fahad.getByRole("button", { name: "Join and start reading" }).click();
  await fahad.waitForURL(`**/rooms/${roomId}`);
});

test("Sara leaves notes at every attention level, a poll, a prediction and a package", async () => {
  test.setTimeout(300_000);
  await openReader(sara, roomId);
  await goToChapter(sara, /Chapter 1 ·/);
  await expect(sara.getByTestId("reader")).toHaveAttribute("data-turn", "flip");

  const levels: [string, string][] = [
    ["Whisper", "psst. the lighthouse keeper's letter."],
    ["Gentle", "I love how quiet this opening is."],
    ["Excited", "THE FOG HORN SCENE."],
    ["Knock knock", "Read the next line slowly."],
    ["DO NOT IGNORE THIS 😂", "I screamed. Out loud. On a train."],
  ];
  for (const [level, text] of levels) {
    const sheet = await leave(sara, "Note");
    await sheet.getByLabel("Your note").fill(text);
    await sheet.getByRole("radiogroup", { name: "Attention level" }).getByRole("radio", { name: level }).click();
    if (level === "DO NOT IGNORE THIS 😂") {
      await sara.waitForTimeout(900);
      await shot(sara, "01-composer-attention-shout");
    }
    await sheet.getByRole("button", { name: "Leave it here" }).click();
    await expect(sheet).toBeHidden({ timeout: 30_000 });
  }

  // A poll at this passage.
  let sheet = await leave(sara, "Poll");
  await sheet.getByLabel("Question").fill("Who do you trust?");
  await sheet.getByLabel("Answer 1").fill("The keeper");
  await sheet.getByLabel("Answer 2").fill("The visitor");
  await shot(sara, "02-poll-composer");
  await sheet.getByRole("button", { name: "Leave the poll here" }).click();
  await expect(sheet).toBeHidden();

  // A prediction that opens at the next chapter.
  sheet = await leave(sara, "Prediction");
  await sheet.getByLabel("Your prediction").fill("The visitor is the keeper's lost brother.");
  await expect(sheet.getByRole("radio", { name: /The next chapter/ })).toHaveAttribute("aria-checked", "true");
  await shot(sara, "03-prediction-composer");
  await sheet.getByRole("button", { name: "Seal it" }).click();
  await expect(sheet.getByText("Sealed", { exact: true })).toBeVisible();
  await expect(sheet).toBeHidden({ timeout: 10_000 });

  // A package for Fahad, three chapters on.
  await goToChapter(sara, /Chapter 4 ·/);
  sheet = await leave(sara, "Package");
  await expect(sheet.getByLabel("Who the package is for")).toHaveValue(/.+/);
  await sheet.getByLabel("Your message").fill("You made it to the storm. Put the kettle on.");
  await sheet.getByRole("radiogroup", { name: "Attention level" }).getByRole("radio", { name: "Excited" }).click();
  await shot(sara, "04-package-composer");
  await sheet.getByRole("button", { name: "Wrap it and leave it here" }).click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });

  const api = await apiClient(saraEmail);
  const { data: markers } = await api.from("annotation_markers").select("kind, attention").eq("room_id", roomId);
  expect((markers ?? []).map((m) => m.attention).sort()).toEqual(["gentle", "knock", "playful", "playful", "quiet", "shout"]);
  expect((markers ?? []).filter((m) => m.kind === "package")).toHaveLength(1);
});

test("Fahad sees the friends' avatars perform, and the page flip", async () => {
  test.setTimeout(240_000);
  await openReader(fahad, roomId);
  await goToChapter(fahad, /Chapter 1 ·/);
  // Reached notes unlock after the settle time, then perform.
  const shout = fahad.locator('[data-note-avatar][data-attention="shout"]');
  await expect(shout).toBeVisible({ timeout: 20_000 });
  await expect(fahad.locator('[data-note-avatar][data-attention="knock"]')).toBeVisible();
  await expect(fahad.locator('[data-note-avatar][data-attention="quiet"]')).toBeVisible();
  await fahad.mouse.move(10, 10);
  for (const [i, wait] of [[0, 300], [1, 450], [2, 500]] as const) {
    await fahad.waitForTimeout(wait);
    await shot(fahad, `05-attention-${i}`);
  }
  // Zoomed in on the margin, so the motion is legible.
  const lane = (await shout.boundingBox())!;
  await fahad.screenshot({ path: ".local/showcase/06-attention-margin.png", clip: { x: lane.x - 120, y: Math.max(0, lane.y - 260), width: 220, height: 420 } });

  // The poll opens here; results only after voting.
  await fahad.getByRole("button", { name: /Poll from Sara/ }).click();
  const poll = fahad.getByRole("dialog", { name: "Poll" });
  await expect(poll.getByRole("heading", { name: "Who do you trust?" })).toBeVisible();
  await expect(poll.getByLabel("Results")).toHaveCount(0);
  await poll.getByRole("button", { name: "The visitor" }).click();
  await expect(poll.getByLabel("Results")).toBeVisible();
  await fahad.waitForTimeout(900);
  await shot(fahad, "07-poll-results");
  await fahad.keyboard.press("Escape");

  // Flip: the old page lifts on its spine while the next one is revealed.
  await fahad.getByRole("button", { name: "Next page" }).click();
  await fahad.waitForTimeout(170);
  await shot(fahad, "08-flip-early");
  await fahad.waitForTimeout(170);
  await shot(fahad, "09-flip-mid");
  await fahad.waitForTimeout(600);
  await expect.poll(() => fahad.evaluate(() => document.documentElement.dataset.flip ?? "")).toBe("");
});

test("the map glows ahead, the package waits sealed on the rail, the lens filters", async () => {
  await fahad.getByRole("button", { name: "Map and contents" }).click();
  const map = fahad.getByRole("dialog", { name: "Map and contents" });
  await expect(map.getByRole("heading", { name: "The map" })).toBeVisible();
  await expect(map.getByText(/waiting/).first()).toBeVisible();
  await fahad.waitForTimeout(400);
  await shot(fahad, "10-book-map");
  await map.getByRole("radio", { name: "Sara" }).click();
  await expect(fahad.getByTestId("reader")).toHaveAttribute("data-lens", /.+/);
  await fahad.keyboard.press("Escape");
  await shot(fahad, "11-friend-lens");
  await fahad.getByRole("button", { name: "Everyone" }).click();
  await expect(fahad.getByTestId("reader")).not.toHaveAttribute("data-lens", /.+/);
});

test("the prediction opens when Fahad reaches the next chapter", async () => {
  test.setTimeout(120_000);
  await goToChapter(fahad, /Chapter 2 ·/);
  await expect(fahad.getByText("A prediction is ready to open")).toBeVisible({ timeout: 30_000 });
  await shot(fahad, "12-prediction-ready");
  await fahad.getByRole("status").filter({ hasText: "A prediction is ready to open" }).getByRole("button", { name: "Open" }).click();
  const trail = fahad.getByRole("dialog", { name: "What's been left in this book" });
  await trail.getByRole("button", { name: "Open it" }).click();
  await expect(trail.getByText("The visitor is the keeper's lost brother.")).toBeVisible({ timeout: 10_000 });
  await trail.getByRole("button", { name: "Way off" }).click();
  await fahad.waitForTimeout(500);
  await shot(fahad, "13-prediction-opened");
  await fahad.keyboard.press("Escape");
});

test("the package unwraps at Chapter 4", async () => {
  test.setTimeout(120_000);
  await goToChapter(fahad, /Chapter 4 ·/);
  const gift = fahad.getByRole("button", { name: /Open the package Sara wrapped for you/ });
  await expect(gift).toBeVisible({ timeout: 30_000 });
  await gift.click();
  const note = fahad.getByRole("dialog", { name: "Note" });
  await expect(note.getByRole("button", { name: "Unwrap it" })).toBeVisible();
  await shot(fahad, "14-package-wrapped");
  await note.getByRole("button", { name: "Unwrap it" }).click();
  await fahad.waitForTimeout(250);
  await shot(fahad, "15-package-unwrapping");
  await expect(note.getByText("You made it to the storm. Put the kettle on.")).toBeVisible({ timeout: 5_000 });
  await shot(fahad, "16-package-open");
  await fahad.keyboard.press("Escape");
});

test("Home is a reading desk", async () => {
  await sara.goto("/home");
  await expect(sara.getByRole("heading", { name: "The Lighthouse Keeper's Year", level: 1 })).toBeVisible();
  await shot(sara, "17-home-desk");
  await fahad.goto("/home");
  await shot(fahad, "18-home-desk-fahad");
});

test("rituals live on the room page, and the vault opens at the end", async () => {
  test.setTimeout(120_000);
  await sara.goto(`/rooms/${roomId}`);
  await sara.getByRole("button", { name: "New ritual" }).click();
  const dialog = sara.getByRole("dialog", { name: "Start a ritual" });
  await dialog.getByRole("radio", { name: "Everyone predicts" }).click();
  await dialog.getByRole("button", { name: "Start the ritual" }).click();
  await expect(dialog).toBeHidden();
  await expect(sara.getByText(/Everyone seal one prediction before/).first()).toBeVisible();
  await shot(sara, "19-room-rituals");

  const api = await apiClient(fahadEmail);
  await api.rpc("save_progress", { p_room_id: roomId, p_position: 1, p_anchor: null, p_label: "The end" });
  await fahad.goto(`/rooms/${roomId}/vault`);
  await expect(fahad.getByRole("heading", { name: "The vault" })).toBeVisible();
  await fahad.waitForTimeout(1600);
  await shot(fahad, "20-vault");
  await fahad.getByRole("button", { name: "Replay the reading" }).click();
  await fahad.waitForTimeout(2000);
  await fahad.screenshot({ path: ".local/showcase/21-vault-full.png", fullPage: true });

  await sara.goto(`/rooms/${roomId}/vault`);
  await expect(sara.getByRole("heading", { name: "The vault is sealed" })).toBeVisible();
  for (const watcher of errors) expect(watcher.errors).toEqual([]);
});
