// Two small features, checked the way a person meets them:
//  * the owner of a room switches it between private and public, and the directory follows;
//  * the What's new window shares a link that opens for someone with no account.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { apiClient, createRoom, signUp, uploadBook } from "./helpers";

test.describe.configure({ mode: "serial" });

let ownerContext: BrowserContext;
let visitorContext: BrowserContext;
let owner: Page;
let visitor: Page;
let ownerEmail: string;
let visitorEmail: string;
let roomId: string;
let bookId: string;
const roomName = `Switching doors ${Date.now().toString(36).slice(-4)}`;

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext();
  visitorContext = await browser.newContext();
  owner = await ownerContext.newPage();
  visitor = await visitorContext.newPage();
});

test.afterAll(async () => {
  await ownerContext?.close();
  await visitorContext?.close();
});

const settings = (page: Page) => page.getByRole("dialog", { name: "Room settings" });
const privacy = (page: Page) => settings(page).getByRole("radiogroup", { name: "Room privacy" });

test("the owner opens a private room to everyone, and the directory shows it", async () => {
  ownerEmail = await signUp(owner, "Olga Owner");
  await owner.waitForURL("**/home");
  bookId = await uploadBook(owner, "the-lighthouse.epub");
  roomId = await createRoom(owner, bookId, { name: roomName, visibility: "Private" });
  await owner.keyboard.press("Escape");

  visitorEmail = await signUp(visitor, "Vic Visitor");
  await visitor.waitForURL("**/home");
  await visitor.goto("/discover");
  await expect(visitor.getByText(roomName)).toHaveCount(0);

  await owner.getByRole("button", { name: "Room settings" }).click();
  await expect(privacy(owner).getByRole("radio", { name: /^Private/ })).toBeChecked();
  await privacy(owner).getByRole("radio", { name: /^Public/ }).click();

  // Opening a room up asks first, and nothing changes until the owner agrees.
  await expect(settings(owner).getByText("Make this room public?")).toBeVisible();
  expect(((await (await apiClient(ownerEmail)).rpc("room_detail", { p_room_id: roomId })).data as { visibility: string }).visibility).toBe("private");
  await settings(owner).getByRole("button", { name: "Make public" }).click();

  await expect(privacy(owner).getByRole("radio", { name: /^Public/ })).toBeChecked();
  await expect(owner.getByText("This room is now public and appears in Open Rooms.")).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(owner.getByText("Open", { exact: true }).first()).toBeVisible();

  await visitor.goto("/discover");
  await expect(visitor.getByRole("heading", { name: roomName })).toBeVisible();
});

test("going private again removes it from the directory, and the visitor who joined stays in", async () => {
  await visitor.goto(`/rooms/${roomId}`);
  await visitor.getByRole("button", { name: "Join this room" }).click();
  await expect(visitor.getByRole("link", { name: /Start reading|Continue reading/ })).toBeVisible();

  await owner.goto(`/rooms/${roomId}`);
  await owner.getByRole("button", { name: "Room settings" }).click();
  // Narrowing is quick to undo, so it needs no confirmation.
  await privacy(owner).getByRole("radio", { name: /^Private/ }).click();
  await expect(privacy(owner).getByRole("radio", { name: /^Private/ })).toBeChecked();
  await expect(owner.getByText(/now private/)).toBeVisible();

  const api = await apiClient(visitorEmail);
  const listed = ((await api.rpc("list_open_rooms")).data ?? []) as { id: string }[];
  expect(listed.map((room) => room.id)).not.toContain(roomId);
  const detail = (await api.rpc("room_detail", { p_room_id: roomId })).data as { is_member: boolean; visibility: string };
  expect(detail).toMatchObject({ is_member: true, visibility: "private" });

  await visitor.goto("/home");
  await expect(visitor.getByText(roomName).first()).toBeVisible();
});

test("only the owner is offered the switch", async () => {
  await visitor.goto(`/rooms/${roomId}`);
  await visitor.getByRole("button", { name: "Room settings" }).click();
  await expect(settings(visitor).getByText("Only the owner can change how this room works.")).toBeVisible();
  await expect(settings(visitor).getByRole("radiogroup", { name: "Room privacy" })).toHaveCount(0);

  // And the backend agrees, whatever the page shows.
  const { error } = await (await apiClient(visitorEmail)).rpc("update_room", { p_room_id: roomId, p_visibility: "open" });
  expect(error?.message).toBe("not_allowed");
});

test("a Private Duo can only be private", async () => {
  await owner.keyboard.press("Escape");
  const duo = await createRoom(owner, bookId, { name: `${roomName} duo`, mode: "Private Duo" });
  await owner.keyboard.press("Escape");
  await owner.goto(`/rooms/${duo}`);
  await owner.getByRole("button", { name: "Room settings" }).click();
  await expect(privacy(owner).getByRole("radio", { name: /^Public/ })).toBeDisabled();
  await expect(privacy(owner).getByRole("radio", { name: /^Unlisted/ })).toBeDisabled();
  await expect(settings(owner).getByText("A Private Duo is always private.")).toBeVisible();
});

test.describe("sharing What's new", () => {
  async function openWhatsNew(page: Page) {
    await page.goto("/home");
    await page.getByRole("button", { name: /^Account menu/ }).click();
    await page.getByRole("menuitem", { name: /What's new/ }).click();
    const dialog = page.getByRole("dialog", { name: /What's new/ });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("the share sheet receives a message and a link", async () => {
    await owner.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: unknown) => {
          (window as unknown as { __shared: unknown[] }).__shared.push(data);
        },
      });
    });
    const dialog = await openWhatsNew(owner);
    await dialog.getByRole("button", { name: "Share" }).click();
    const shared = (await owner.evaluate(() => (window as unknown as { __shared: { title: string; text: string; url: string }[] }).__shared))[0];
    expect(shared.title).toContain("What's new in");
    expect(shared.text).toContain("•");
    expect(new URL(shared.url).pathname).toBe("/whats-new");
  });

  test("without a share sheet, the message is copied", async () => {
    await visitor.addInitScript(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
    const dialog = await openWhatsNew(visitor);
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(visitor.getByText("Copied. Paste it to a friend.")).toBeVisible();
    const copied = await visitor.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("What's new in");
    expect(copied).toMatch(/\/whats-new$/);
  });

  test("the shared link opens for someone with no account, with a preview card", async ({ browser }) => {
    const stranger = await browser.newContext();
    try {
      const page = await stranger.newPage();
      const response = await page.goto("/whats-new");
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe("/whats-new");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Join the alpha" })).toHaveAttribute("href", "/signup");

      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
      expect(ogTitle).toContain("What's new in");
      const ogImage = await page.locator('meta[property="og:image"]').first().getAttribute("content");
      expect(ogImage).toBeTruthy();
      const image = await page.request.get(new URL(ogImage!).pathname);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toContain("image/png");
    } finally {
      await stranger.close();
    }
  });
});
