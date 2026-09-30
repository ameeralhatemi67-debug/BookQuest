import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Test-only credentials for accounts created on a LOCAL backend during a run.
export const PASSWORD = "local-e2e-password-1";
export const ALPHA_CODE = "LOCAL-ALPHA";

const run = Date.now().toString(36);
export const emailFor = (name: string) => `${name.toLowerCase().replace(/\s+/g, ".")}.${run}@example.test`;

export const fixture = (name: string) => join(__dirname, ".fixtures", name);

/** Reads the backend the app under test is using (same values as the dev server). */
export function backend(): { url: string; key: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const envFile = join(__dirname, "..", ".env.local");
  if ((!url || !key) && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = /^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=(.*)$/.exec(line.trim());
      if (match?.[1] === "NEXT_PUBLIC_SUPABASE_URL") url ??= match[2];
      if (match?.[1] === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") key ??= match[2];
    }
  }
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or .env.local) for e2e tests.");
  return { url, key };
}

/** A plain API client signed in as a test user — used to attack the backend directly, below the UI. */
export async function apiClient(email: string): Promise<SupabaseClient> {
  const { url, key } = backend();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`API sign-in failed for ${email}: ${error.message}`);
  return client;
}

export function anonApi(): SupabaseClient {
  const { url, key } = backend();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------------------------------------------------------------- UI flows
export async function signUp(page: Page, name: string, options: { code?: string | null; next?: string } = {}): Promise<string> {
  const email = emailFor(name);
  await page.goto(options.next ? `/signup?next=${encodeURIComponent(options.next)}` : "/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  if (options.code !== null) await page.getByLabel("Alpha code").fill(options.code ?? ALPHA_CODE);
  await page.getByRole("button", { name: "Create account" }).click();
  return email;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/home");
}

/** Uploads a book through the real pipeline and waits until it is ready. Returns its id. */
export async function uploadBook(page: Page, file: string): Promise<string> {
  await page.goto("/books");
  await page.locator("#book-file").setInputFiles(fixture(file));
  await expect(page.getByText("Ready to read")).toBeVisible({ timeout: 90_000 });
  const link = page.getByRole("link", { name: "Open a room with this book" });
  const href = await link.getAttribute("href");
  return new URL(href!, "http://x").searchParams.get("book")!;
}

export interface RoomOptions {
  name: string;
  mode?: "Chill" | "Race" | "Private Duo";
  visibility?: "Private" | "Unlisted" | "Open";
  description?: string;
  limit?: number;
}

/** Creates a room for a book and returns its id. Leaves the page on the room with the invite dialog closed. */
export async function createRoom(page: Page, bookId: string, options: RoomOptions): Promise<string> {
  await page.goto(`/rooms/new?book=${bookId}`);
  await page.getByLabel("Room name").fill(options.name);
  if (options.description) await page.getByLabel("Description").fill(options.description);
  if (options.mode) await page.getByRole("radio", { name: new RegExp(`^${options.mode}`) }).click();
  if (options.visibility) await page.getByRole("radio", { name: new RegExp(`^${options.visibility}`) }).click();
  if (options.limit) await page.getByLabel("Member limit").fill(String(options.limit));
  await page.getByRole("button", { name: "Open the room" }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomId = /\/rooms\/([0-9a-f-]{36})/.exec(page.url())![1];
  return roomId;
}

/** With the invite dialog open (right after creating a room), mints a personal invitation link. */
export async function createInviteLink(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog", { name: "Invite readers" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create invitation link" }).click();
  const field = dialog.getByLabel("New invitation link");
  await expect(field).toBeVisible();
  return field.inputValue();
}

export async function openReader(page: Page, roomId: string, query = "") {
  await page.goto(`/read/${roomId}${query}`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

export const readerProgress = async (page: Page) => Number(await page.getByTestId("reader").getAttribute("data-progress"));
export const readerFurthest = async (page: Page) => Number(await page.getByTestId("reader").getAttribute("data-furthest"));

/** Waits until the reader has durably saved at least `atLeast` progress. */
export async function waitForSaved(page: Page, atLeast: number) {
  await expect.poll(() => readerFurthest(page), { timeout: 20_000, message: `progress saved ≥ ${atLeast}` }).toBeGreaterThanOrEqual(atLeast);
}

export async function goToChapter(page: Page, title: string | RegExp) {
  await page.getByRole("button", { name: "Contents" }).click();
  const panel = page.getByRole("dialog", { name: "Contents" });
  await panel.getByRole("button", { name: title }).click();
  await expect(panel).toBeHidden();
}

export interface NoteOptions {
  text?: string;
  image?: boolean;
  audio?: boolean;
  link?: string;
}

// 2×3 PNG and a 0.2 s silent WAV, generated in memory — nothing binary is committed.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFUlEQVR4nGPYEqT1//9/BhDeEqQFADyOB7fT3u7uAAAAAElFTkSuQmCC", "base64");
function wav(seconds = 0.2): Buffer {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

/** Leaves a note at the current page through the composer. */
export async function leaveNote(page: Page, options: NoteOptions) {
  await page.getByRole("button", { name: "Leave a note here" }).click();
  const composer = page.getByRole("dialog", { name: "Leave a note" });
  await expect(composer).toBeVisible();
  if (options.text) await composer.getByLabel("Your note").fill(options.text);
  if (options.image) await composer.locator('input[type="file"][accept^="image"]').setInputFiles({ name: "map.png", mimeType: "image/png", buffer: PNG });
  if (options.audio) await composer.locator('input[type="file"][accept^="audio"]').setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: wav() });
  if (options.link) {
    await composer.getByRole("button", { name: "Link" }).click();
    await composer.getByLabel("Link").fill(options.link);
  }
  await composer.getByRole("button", { name: "Leave it here" }).click();
  await expect(composer).toBeHidden({ timeout: 30_000 });
}

/** Collects console errors and failed requests so a test can assert the page stayed clean. */
export function watchForErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Expected noise: probing a locked / missing resource returns 4xx by design.
    if (/Failed to load resource/.test(text)) return;
    // Expected, and wanted: EPUB content is rendered in a sandboxed frame where
    // scripts can never run. Chrome reports each blocked attempt as an "error".
    if (/Blocked script execution in 'about:srcdoc'/.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return { errors };
}
