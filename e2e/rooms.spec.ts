// Critical acceptance scenario — Open / Unlisted / Private rooms.
//
// Visibility has to change discovery AND authorization, so every claim here is
// checked twice: through the UI, and directly against the API as the same user.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { anonApi, apiClient, backend, createRoom, leaveNote, openReader, signUp, uploadBook } from "./helpers";

test.describe.configure({ mode: "serial" });

let ownerContext: BrowserContext;
let visitorContext: BrowserContext;
let owner: Page;
let visitor: Page;
let ownerEmail: string;
let visitorEmail: string;
let bookId: string;
let bookPath: string;
const rooms = { open: "", private: "", unlisted: "" };
let unlistedLink: string;
const suffix = Date.now().toString(36).slice(-4);
const names = { open: `Open harbour ${suffix}`, private: `Private study ${suffix}`, unlisted: `Unlisted circle ${suffix}` };

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

test("an owner sets up one room of each visibility", async () => {
  ownerEmail = await signUp(owner, "Olivia Owner");
  await owner.waitForURL("**/home");
  bookId = await uploadBook(owner, "the-lighthouse.epub");

  rooms.open = await createRoom(owner, bookId, { name: names.open, visibility: "Open", description: `Anyone in the alpha is welcome (${suffix}).`, limit: 4 });
  await owner.keyboard.press("Escape");
  rooms.private = await createRoom(owner, bookId, { name: names.private, visibility: "Private" });
  await owner.keyboard.press("Escape");
  rooms.unlisted = await createRoom(owner, bookId, { name: names.unlisted, visibility: "Unlisted" });

  // The unlisted room offers a shareable room link; the private one does not.
  const dialog = owner.getByRole("dialog", { name: "Invite readers" });
  unlistedLink = await dialog.getByLabel("Room link").inputValue();
  expect(unlistedLink).toMatch(/\/invite\/[0-9a-f]{64}$/);
  await owner.keyboard.press("Escape");

  await owner.goto(`/rooms/${rooms.private}`);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("dialog", { name: "Invite readers" })).toBeVisible();
  await expect(owner.getByLabel("Room link")).toHaveCount(0);
  await owner.keyboard.press("Escape");

  // Something private inside the private room, to try to get at later.
  await openReader(owner, rooms.private);
  await leaveNote(owner, { text: "PRIVATE-ROOM-SECRET", image: true });

  const api = await apiClient(ownerEmail);
  const { data } = await api.from("books").select("storage_path").eq("id", bookId).single();
  bookPath = data!.storage_path as string;
});

test("the directory lists Open rooms only", async () => {
  visitorEmail = await signUp(visitor, "Vera Visitor");
  await visitor.waitForURL("**/home");
  await visitor.goto("/discover");
  await expect(visitor.getByRole("heading", { name: names.open })).toBeVisible();
  await expect(visitor.getByText(`Anyone in the alpha is welcome (${suffix}).`)).toBeVisible();
  await expect(visitor.getByText(names.private)).toHaveCount(0);
  await expect(visitor.getByText(names.unlisted)).toHaveCount(0);

  // Same answer from the API.
  const api = await apiClient(visitorEmail);
  const listed = ((await api.rpc("list_open_rooms")).data ?? []) as { id: string }[];
  const ids = listed.map((r) => r.id);
  expect(ids).toContain(rooms.open);
  expect(ids).not.toContain(rooms.private);
  expect(ids).not.toContain(rooms.unlisted);
});

test("a non-member sees permitted preview metadata of an Open room, and no more", async () => {
  await visitor.goto(`/rooms/${rooms.open}`);
  await expect(visitor.getByRole("heading", { name: names.open, level: 1 })).toBeVisible();
  await expect(visitor.getByText(/1 reader/)).toBeVisible();
  await expect(visitor.getByText("3 spots left")).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Join this room" })).toBeVisible();
  // No way to read without joining.
  await expect(visitor.getByRole("link", { name: /reading/i })).toHaveCount(0);

  const api = await apiClient(visitorEmail);
  const preview = (await api.rpc("room_detail", { p_room_id: rooms.open })).data as Record<string, unknown>;
  expect(preview.is_member).toBe(false);
  expect(preview).not.toHaveProperty("join_code");
  expect((await api.storage.from("books").createSignedUrl(bookPath, 60)).error).toBeTruthy();
});

test("private and unlisted rooms do not exist for a non-member who guesses the address", async () => {
  for (const id of [rooms.private, rooms.unlisted]) {
    await visitor.goto(`/rooms/${id}`);
    await expect(visitor.getByRole("heading", { name: "This room isn't available" })).toBeVisible();
    // The reader and the journey bounce back to the same dead end.
    await visitor.goto(`/read/${id}`);
    await expect(visitor.getByRole("heading", { name: "This room isn't available" })).toBeVisible();
    await visitor.goto(`/rooms/${id}/journey`);
    await expect(visitor.getByRole("heading", { name: "This room isn't available" })).toBeVisible();
  }
});

test("a non-member cannot bypass authorization by changing ids at the API", async () => {
  const api = await apiClient(visitorEmail);
  const id = rooms.private;

  expect((await api.from("rooms").select("*").eq("id", id)).data).toEqual([]);
  expect((await api.rpc("room_detail", { p_room_id: id })).error?.message).toBe("room_not_found");
  expect((await api.rpc("room_journey", { p_room_id: id })).error?.message).toBe("room_not_found");
  for (const table of ["room_members", "reading_progress", "room_activity", "annotation_markers", "annotation_contents", "annotation_attachments", "annotation_replies", "room_invites"]) {
    const result = await api.from(table).select("*").eq("room_id", id);
    expect(result.data ?? [], table).toEqual([]);
  }

  // Writes are refused too.
  expect((await api.rpc("save_progress", { p_room_id: id, p_position: 0.5 })).error?.message).toBe("not_a_member");
  expect((await api.rpc("create_annotation", { p_room_id: id, p_position: 0.1, p_anchor: { type: "epub", cfi: "x" }, p_body: "hi" })).error?.message).toBe("not_a_member");
  expect((await api.rpc("join_open_room", { p_room_id: id })).error?.message).toBe("room_not_open");
  expect((await api.rpc("create_invite", { p_room_id: id })).error?.message).toBe("not_allowed");
  expect((await api.from("room_members").insert({ room_id: id, user_id: (await api.auth.getUser()).data.user!.id })).error).toBeTruthy();

  // The owner's note and its media stay out of reach even with exact ids and paths.
  const ownerApi = await apiClient(ownerEmail);
  const { data: attachments } = await ownerApi.from("annotation_attachments").select("marker_id, bucket, path").eq("room_id", id);
  expect(attachments).toHaveLength(1);
  const attachment = attachments![0];
  expect((await api.from("annotation_contents").select("*").eq("marker_id", attachment.marker_id)).data).toEqual([]);
  expect((await api.storage.from(attachment.bucket).createSignedUrl(attachment.path, 60)).error).toBeTruthy();
  expect((await api.storage.from(attachment.bucket).download(attachment.path)).error).toBeTruthy();
  expect((await api.rpc("add_reply", { p_marker_id: attachment.marker_id, p_body: "x" })).error?.message).toBe("note_unavailable");
});

test("an unauthenticated visitor gets nothing: no pages, no rows, no book, no media", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of [`/rooms/${rooms.private}`, `/rooms/${rooms.open}`, `/read/${rooms.open}`, "/home", "/discover", "/admin", `/rooms/${rooms.open}/journey`]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login\?next=/);
  }
  await context.close();

  const anon = anonApi();
  expect((await anon.rpc("list_open_rooms")).error).toBeTruthy();
  for (const table of ["rooms", "books", "room_members", "annotation_markers", "annotation_contents", "profiles", "notifications"]) {
    const result = await anon.from(table).select("*");
    expect(result.data ?? [], table).toEqual([]);
  }
  expect((await anon.storage.from("books").download(bookPath)).error).toBeTruthy();
  expect((await anon.storage.from("books").createSignedUrl(bookPath, 60)).error).toBeTruthy();

  // Private buckets have no public URL at all.
  const { url } = backend();
  const direct = await fetch(`${url}/storage/v1/object/public/books/${bookPath}`);
  expect(direct.ok).toBe(false);
  const ownerApi = await apiClient(ownerEmail);
  const { data: attachments } = await ownerApi.from("annotation_attachments").select("bucket, path").eq("room_id", rooms.private);
  for (const a of attachments ?? []) {
    expect((await fetch(`${url}/storage/v1/object/public/${a.bucket}/${a.path}`)).ok).toBe(false);
    expect((await anon.storage.from(a.bucket).download(a.path)).error).toBeTruthy();
  }
});

test("any tester can join an Open room from the directory", async () => {
  await visitor.goto("/discover");
  const card = visitor.locator("li", { has: visitor.getByRole("heading", { name: names.open }) });
  await card.getByRole("button", { name: "Join" }).click();
  await visitor.waitForURL(`**/rooms/${rooms.open}`);
  await expect(visitor.getByRole("heading", { name: names.open, level: 1 })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Start reading" })).toBeVisible();

  // Now — and only now — the book is readable.
  const api = await apiClient(visitorEmail);
  expect((await api.storage.from("books").createSignedUrl(bookPath, 60)).error).toBeNull();
  // Joining twice changes nothing.
  expect(((await api.rpc("join_open_room", { p_room_id: rooms.open })).data as { status: string }).status).toBe("already_member");
  const me = (await api.auth.getUser()).data.user!.id;
  expect((await api.from("room_members").select("*").eq("room_id", rooms.open).eq("user_id", me)).data).toHaveLength(1);
});

test("the owner sees the newcomer arrive without reloading", async () => {
  await owner.goto(`/rooms/${rooms.open}`);
  await expect(owner.getByText("2 readers of 4")).toBeVisible();
  await expect(owner.getByText("Vera Visitor joined.")).toBeVisible();
});

test("a valid link lets a tester into an Unlisted room", async () => {
  await visitor.goto(new URL(unlistedLink).pathname);
  await expect(visitor.getByRole("heading", { name: names.unlisted })).toBeVisible();
  await visitor.getByRole("button", { name: "Join and start reading" }).click();
  await visitor.waitForURL(`**/rooms/${rooms.unlisted}`);
  await expect(visitor.getByRole("heading", { name: names.unlisted, level: 1 })).toBeVisible();
});

test("invalid, revoked and used invitations fail with a clear explanation", async ({ browser }) => {
  await visitor.goto("/invite/not-a-real-token");
  await expect(visitor.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();

  // The private room's link code is inert: private rooms are invitation-only.
  const ownerApi = await apiClient(ownerEmail);
  const revoked = (await ownerApi.rpc("create_invite", { p_room_id: rooms.private })).data as { id: string; token: string };
  await ownerApi.rpc("revoke_invite", { p_invite_id: revoked.id });
  await visitor.goto(`/invite/${revoked.token}`);
  await expect(visitor.getByRole("heading", { name: "This invitation was withdrawn" })).toBeVisible();

  const single = (await ownerApi.rpc("create_invite", { p_room_id: rooms.private })).data as { token: string };
  await visitor.goto(`/invite/${single.token}`);
  await visitor.getByRole("button", { name: "Join and start reading" }).click();
  await visitor.waitForURL(`**/rooms/${rooms.private}`);

  const context = await browser.newContext();
  const late = await context.newPage();
  await signUp(late, "Larry Late");
  await late.waitForURL("**/home");
  await late.goto(`/invite/${single.token}`);
  await expect(late.getByRole("heading", { name: "This invitation has already been used" })).toBeVisible();
  await context.close();
});

test("a full room says so and refuses the join", async ({ browser }) => {
  // Open room has a limit of 4 and holds 2: fill it, then try a fifth.
  const extras: string[] = [];
  for (const name of ["Fill One", "Fill Two"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    extras.push(await signUp(page, name));
    await page.waitForURL("**/home");
    const api = await apiClient(extras[extras.length - 1]);
    expect(((await api.rpc("join_open_room", { p_room_id: rooms.open })).data as { status: string }).status).toBe("joined");
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = await signUp(page, "Fifth Wheel");
  await page.waitForURL("**/home");
  await page.goto(`/rooms/${rooms.open}`);
  await expect(page.getByText("Full", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Join this room" })).toHaveCount(0);
  const api = await apiClient(email);
  expect((await api.rpc("join_open_room", { p_room_id: rooms.open })).error?.message).toBe("room_full");
  await context.close();
});

test("leaving and re-joining keeps one membership and the reader's place", async () => {
  const api = await apiClient(visitorEmail);
  const me = (await api.auth.getUser()).data.user!.id;
  await api.rpc("save_progress", { p_room_id: rooms.unlisted, p_position: 0.33, p_anchor: { type: "epub", cfi: "epubcfi(/6/10!/4/2)" }, p_label: "Chapter 4" });

  await visitor.goto(`/rooms/${rooms.unlisted}`);
  await visitor.getByRole("button", { name: "Room settings" }).click();
  const settings = visitor.getByRole("dialog", { name: "Room settings" });
  await settings.getByRole("button", { name: "Leave", exact: true }).click();
  await settings.getByRole("button", { name: "Leave", exact: true }).click();
  await visitor.waitForURL("**/home");
  expect((await api.from("rooms").select("id").eq("id", rooms.unlisted)).data).toEqual([]);

  await visitor.goto(new URL(unlistedLink).pathname);
  await visitor.getByRole("button", { name: "Join and start reading" }).click();
  await visitor.waitForURL(`**/rooms/${rooms.unlisted}`);

  const membership = await api.from("room_members").select("status").eq("room_id", rooms.unlisted).eq("user_id", me);
  expect(membership.data).toEqual([{ status: "active" }]);
  const progress = await api.from("reading_progress").select("furthest, label").eq("room_id", rooms.unlisted).eq("user_id", me);
  expect(progress.data).toEqual([{ furthest: 0.33, label: "Chapter 4" }]);
  await expect(visitor.getByRole("link", { name: "Continue reading" })).toBeVisible();
});

test("the owner can close a room and remove a member", async () => {
  await owner.goto(`/rooms/${rooms.unlisted}`);
  await owner.getByRole("button", { name: "Manage Vera Visitor" }).click();
  await owner.getByRole("menuitem", { name: "Remove from room" }).click();
  await owner.getByRole("dialog", { name: "Remove Vera Visitor?" }).getByRole("button", { name: "Remove" }).click();
  await expect(owner.getByText("1 reader", { exact: true })).toBeVisible();

  // Removed: the link no longer lets them back in.
  await visitor.goto(new URL(unlistedLink).pathname);
  await expect(visitor.getByText("You were removed from this room.")).toBeVisible();
  const api = await apiClient(visitorEmail);
  expect((await api.rpc("join_with_token", { p_token: new URL(unlistedLink).pathname.split("/").pop() })).error?.message).toBe("removed_from_room");
  expect((await api.from("notifications").select("type").eq("type", "removed")).data).toHaveLength(1);

  // Close the open room to newcomers.
  await owner.goto(`/rooms/${rooms.open}`);
  await owner.getByRole("button", { name: "Room settings" }).click();
  await owner.getByRole("dialog", { name: "Room settings" }).getByRole("button", { name: "Close room" }).click();
  await expect(owner.getByRole("dialog", { name: "Room settings" }).getByText("Closed to new members")).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(owner.getByText("Closed to new members").first()).toBeVisible();
});
