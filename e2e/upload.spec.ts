// Critical acceptance scenario — Large upload.
//
// A synthetic 64 MB PDF (generated locally, never committed) is uploaded
// through the real UI on a throttled connection, paused, resumed and cut off
// mid-flight. We assert where the bytes go, what the reader is shown, what
// ends up in Storage, and who can fetch it.
import { expect, test, type BrowserContext, type CDPSession, type Page, type Request } from "@playwright/test";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { formatBytes } from "../src/lib/format";
import { anonApi, apiClient, backend, fixture, signUp } from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let cdp: CDPSession;
let email: string;
let bookId: string;
const uploads: { url: string; method: string; offset: number | null; bytes: number }[] = [];
const appPosts: { url: string; bytes: number }[] = [];
const fileSize = () => statSync(fixture("large.pdf")).size;

const throttle = (uploadBytesPerSecond: number, offline = false) =>
  cdp.send("Network.emulateNetworkConditions", { offline, latency: 10, downloadThroughput: -1, uploadThroughput: uploadBytesPerSecond });

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  const appOrigin = new URL(baseURL!).origin;
  const storageOrigin = new URL(backend().url).origin;
  page.on("request", (request: Request) => {
    const method = request.method();
    if (method !== "POST" && method !== "PATCH" && method !== "PUT") return;
    const bytes = Number(request.headers()["content-length"] ?? request.postDataBuffer()?.length ?? 0);
    const origin = new URL(request.url()).origin;
    const offset = request.headers()["upload-offset"];
    if (origin === storageOrigin && request.url().includes("/storage/v1/")) uploads.push({ url: request.url(), method, offset: offset === undefined ? null : Number(offset), bytes });
    if (origin === appOrigin) appPosts.push({ url: request.url(), bytes });
  });
});

test.afterAll(async () => {
  await context?.close();
});

test("rejects files that are not really books, before uploading a byte", async () => {
  email = await signUp(page, "Uma Uploader");
  await page.waitForURL("**/home");
  await page.goto("/books");

  await page.locator("#book-file").setInputFiles(fixture("not-a-book.pdf"));
  await expect(page.getByText("Upload failed")).toBeVisible();
  await expect(page.getByText(/named \.pdf but doesn't look like a real PDF/)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  await page.locator("#book-file").setInputFiles(fixture("corrupt.epub"));
  await expect(page.getByText("Upload failed")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/This EPUB couldn't be opened/)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  await page.locator("#book-file").setInputFiles({ name: "holiday.mobi", mimeType: "application/octet-stream", buffer: Buffer.from("not supported") });
  await expect(page.getByText("Only EPUB and PDF books are supported.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  expect(uploads).toEqual([]);
});

test("uploads a large book with real progress, pause, resume and recovery from a dropped connection", async () => {
  test.setTimeout(300_000);
  const size = fileSize();
  expect(size).toBeGreaterThan(60 * 1024 * 1024);
  const totalLabel = formatBytes(size).replace(".", "\.");

  await throttle(4 * 1024 * 1024); // ~4 MB/s: slow enough to watch
  await page.locator("#book-file").setInputFiles(fixture("large.pdf"));

  // Named stages, not a frozen button.
  const status = page.locator("[aria-live='polite']").first();
  await expect(status.getByText(/Uploading/).first()).toBeVisible({ timeout: 60_000 });
  const bar = page.getByRole("progressbar", { name: /Upload progress for large\.pdf/ });
  await expect(bar).toBeVisible();

  // "12 MB / 64 MB · 19%" — bytes and a percentage that really move.
  const percent = async () => Number(await bar.getAttribute("aria-valuenow"));
  await expect.poll(percent, { timeout: 30_000 }).toBeGreaterThan(5);
  await expect(status.getByText(new RegExp(`\\d+(\\.\\d+)? MB / ${totalLabel}`))).toBeVisible();
  const first = await percent();
  await expect.poll(percent, { timeout: 30_000 }).toBeGreaterThan(first + 5);

  // Pause: progress stops. Resume: it continues from where it was.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(status.getByText("Paused", { exact: true })).toBeVisible();
  const paused = await percent();
  await page.waitForTimeout(2500);
  expect(await percent()).toBe(paused);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(percent, { timeout: 30_000 }).toBeGreaterThan(paused);
  expect(await percent()).toBeGreaterThanOrEqual(paused); // never restarts from zero

  // Cut the connection mid-upload.
  const before = await percent();
  await throttle(0, true);
  await expect(status.getByText(/Connection interrupted|retrying/i).first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);
  await throttle(24 * 1024 * 1024); // back online, faster
  await expect.poll(percent, { timeout: 90_000 }).toBeGreaterThan(before);

  await expect(page.getByText("Ready to read")).toBeVisible({ timeout: 180_000 });
  const href = await page.getByRole("link", { name: "Open a room with this book" }).getAttribute("href");
  bookId = new URL(href!, "http://x").searchParams.get("book")!;
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test("the bytes went straight to Storage over the resumable protocol, never through the app server", async () => {
  const resumable = uploads.filter((u) => u.url.includes("/storage/v1/upload/resumable"));
  const chunk = 6 * 1024 * 1024;
  // Each request is bounded to 6 MB. A connection cut can hide a request from
  // Chromium's event log; the final stored-size and range checks prove continuity.
  const offsets = [...new Set(resumable.map((u) => u.offset).filter((o): o is number => o !== null))].sort((a, b) => a - b);
  expect(offsets.length).toBeGreaterThanOrEqual(Math.ceil(fileSize() / chunk) - 1);
  expect(offsets.at(-1)!).toBeGreaterThanOrEqual(fileSize() - chunk);
  for (const request of resumable) expect(request.bytes).toBeLessThanOrEqual(chunk);
  // The interrupted chunk was re-sent from its own offset (a resume), not from zero.
  expect(resumable.filter((u) => u.offset === 0).length).toBeLessThanOrEqual(1);

  // Nothing large was ever POSTed to the Next.js / Vercel origin.
  const biggest = Math.max(0, ...appPosts.map((p) => p.bytes));
  expect(biggest).toBeLessThan(64 * 1024);
});

test("a successful upload produces valid storage metadata", async () => {
  const api = await apiClient(email);
  const { data: book } = await api.from("books").select("status, size_bytes, mime_type, format, page_count, sha256, storage_path, title, cover_path").eq("id", bookId).single();
  expect(book).toMatchObject({ status: "ready", size_bytes: fileSize(), mime_type: "application/pdf", format: "pdf", page_count: 12, title: "Field Notes" });
  expect(book!.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(book!.cover_path).toBeTruthy();

  // The stored object is intact at both ends.
  const signed = await api.storage.from("books").createSignedUrl(book!.storage_path as string, 120);
  expect(signed.error).toBeNull();
  const head = await fetch(signed.data!.signedUrl, { headers: { Range: "bytes=0-7" } });
  expect(head.status).toBe(206);
  expect(await head.text()).toBe("%PDF-1.7");
  const size = fileSize();
  const tail = await fetch(signed.data!.signedUrl, { headers: { Range: `bytes=${size - 6}-${size - 1}` } });
  expect(await tail.text()).toBe("%%EOF\n");
  expect(head.headers.get("content-range")).toBe(`bytes 0-7/${size}`);
  const stored = await fetch(signed.data!.signedUrl);
  const hash = createHash("sha256").update(Buffer.from(await stored.arrayBuffer())).digest("hex");
  expect(hash).toBe(book!.sha256);
});

test("uploading the very same file again is recognised instead of stored twice", async () => {
  uploads.length = 0;
  await page.goto("/books");
  await page.locator("#book-file").setInputFiles(fixture("large.pdf"));
  await expect(page.getByText("Already in your library")).toBeVisible({ timeout: 60_000 });
  expect(uploads.filter((u) => u.url.includes("/upload/resumable"))).toEqual([]);
});

test("an unauthorized user cannot retrieve the uploaded book", async ({ browser }) => {
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const otherEmail = await signUp(otherPage, "Nosy Neighbour");
  await otherPage.waitForURL("**/home");
  await other.close();

  const owner = await apiClient(email);
  const { data: book } = await owner.from("books").select("storage_path").eq("id", bookId).single();
  const path = book!.storage_path as string;

  const stranger = await apiClient(otherEmail);
  expect((await stranger.from("books").select("id").eq("id", bookId)).data).toEqual([]);
  expect((await stranger.storage.from("books").createSignedUrl(path, 60)).error).toBeTruthy();
  expect((await stranger.storage.from("books").download(path)).error).toBeTruthy();
  expect((await anonApi().storage.from("books").download(path)).error).toBeTruthy();
  expect((await fetch(`${backend().url}/storage/v1/object/public/books/${path}`)).ok).toBe(false);
});

test("a cancelled upload leaves nothing behind", async () => {
  await page.goto("/books");
  await throttle(2 * 1024 * 1024);
  await page.locator("#book-file").setInputFiles(fixture("cancel-me.pdf"));
  const bar = page.getByRole("progressbar", { name: /Upload progress for cancel-me.pdf/ });
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow")), { timeout: 60_000 }).toBeGreaterThan(3);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Upload cancelled")).toBeVisible();
  await expect(page.getByText("Nothing was added to your library.")).toBeVisible();
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  const api = await apiClient(email);
  const { data: rows } = await api.from("books").select("status, storage_path").eq("original_filename", "cancel-me.pdf");
  expect(rows).toHaveLength(1);
  expect(rows![0].status).toBe("failed");
  // The partial object was discarded: there is nothing to sign or download.
  expect((await api.storage.from("books").createSignedUrl(rows![0].storage_path as string, 60)).error).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Field Notes" })).toHaveCount(2); // the finished book + the unfinished entry
  await expect(page.getByText("Upload failed")).toBeVisible();
});

test("a PDF that is damaged past its header is refused before uploading", async () => {
  await page.goto("/books");
  uploads.length = 0;
  const size = 20 * 1024 * 1024;
  const buffer = Buffer.alloc(size, 1);
  buffer.write("%PDF-1.7\n", 0, "latin1");
  await page.locator("#book-file").setInputFiles({ name: "abandoned.pdf", mimeType: "application/pdf", buffer });
  // This file is not a valid PDF past its header, so it is refused when opened — before any upload.
  await expect(page.getByText("Upload failed")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/This PDF couldn't be opened/)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  expect(uploads.filter((u) => u.url.includes("/upload/resumable"))).toEqual([]);
});
