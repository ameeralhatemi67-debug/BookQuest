import { expect, test } from "@playwright/test";
import { anonApi, apiClient, backend, createRoom, PASSWORD, signIn, signUp, uploadBook, watchForErrors } from "./helpers";

test("profile pictures, room editing and archiving round trip", async ({ page }) => {
  const email = await signUp(page, "Management Reader");
  await page.waitForURL("**/home");
  const book = await uploadBook(page, "the-lighthouse.epub");
  const room = await createRoom(page, book, { name: "Management read" });
  await page.keyboard.press("Escape");
  await page.goto("/profile");
  // A browser-generated picture exercises the real crop and Storage path.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d")!; context.fillStyle = "#a96542"; context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Choose a profile picture").setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.getByText("Picture updated.")).toBeVisible();
  const api = await apiClient(email);
  const userId = (await api.auth.getUser()).data.user!.id;
  expect((await api.from("profiles").select("avatar_path").eq("id", userId).single()).data?.avatar_path).toBeTruthy();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add a picture" })).toBeVisible();
  await page.goto(`/rooms/${room}`);
  await page.getByRole("button", { name: "Room settings" }).click();
  await page.getByLabel("Room name").fill("Our revised reading room");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Our revised reading room" })).toBeVisible();
  await page.getByRole("button", { name: "Room settings" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  expect((await api.rpc("room_detail", { p_room_id: room })).data.archived_at).toBeTruthy();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Archive this room", { exact: true })).toBeVisible();
  expect((await api.rpc("room_detail", { p_room_id: room })).data.archived_at).toBeNull();
});

test("all admin sections load", async ({ page }) => {
  const api = anonApi();
  const created = await api.auth.signUp({ email: "admin@local.test", password: PASSWORD, options: { data: { display_name: "Local Admin" } } });
  if (created.error) expect(created.error.message).toMatch(/registered|exists/i);
  const errors = watchForErrors(page);
  await signIn(page, "admin@local.test");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Alpha admin" })).toBeVisible();
  for (const tab of ["Overview", "Testers", "Access", "Rooms", "Books", "Feedback", "Errors & log"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("tabpanel").locator("[role=status]")).toHaveCount(0);
    await expect(page.getByRole("tabpanel")).not.toContainText("Couldn't");
  }
  expect(errors.errors).toEqual([]);
});

test("a recovery email opens on a second device and changes the password", async ({ browser, page }) => {
  const email = await signUp(page, "Password Recovery Reader");
  await page.waitForURL("**/home");
  await page.goto("/forgot-password"); await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();
  const mails = await (await fetch(`${backend().url}/emu/inbox?to=${encodeURIComponent(email)}`)).json();
  const recovery = mails.find((mail: { type: string }) => mail.type === "recovery");
  expect(recovery).toBeTruthy();
  const other = await browser.newContext();
  try {
    const second = await other.newPage(); await second.goto(recovery.link);
    await expect(second.getByLabel("New password")).toBeVisible();
    await second.getByLabel("New password").fill(`${PASSWORD}-changed`);
    await second.getByLabel("Repeat it").fill(`${PASSWORD}-changed`);
    await second.getByRole("button", { name: "Save new password" }).click();
    await second.waitForURL("**/home");
    expect((await anonApi().auth.signInWithPassword({ email, password: `${PASSWORD}-changed` })).error).toBeNull();
    expect((await anonApi().auth.signInWithPassword({ email, password: PASSWORD })).error).toBeTruthy();
  } finally { await other.close(); }
});
