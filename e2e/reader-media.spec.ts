import { expect, test } from "@playwright/test";
import { apiClient, createRoom, goToChapter, openReader, signUp, uploadBook } from "./helpers";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("records a voice note and plays uploaded video from a note deep link", async ({ page }) => {
  const email = await signUp(page, "Media Reader"); await page.waitForURL("**/home");
  const book = await uploadBook(page, "the-lighthouse.epub");
  const room = await createRoom(page, book, { name: "Voice and video read" });
  await page.keyboard.press("Escape"); await openReader(page, room); await goToChapter(page, /Chapter 2 ·/);
  await page.getByRole("button", { name: "Leave a note here" }).click();
  const composer = page.getByRole("dialog", { name: "Leave a note", exact: true });
  await composer.getByRole("button", { name: "Record", exact: true }).click();
  await expect(composer.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
  await composer.getByRole("button", { name: "Done", exact: true }).click();
  await composer.getByLabel("Your note").fill("A recorded thought for this page.");
  await composer.getByRole("button", { name: "Leave it here" }).click(); await expect(composer).toBeHidden();
  const api = await apiClient(email);
  const { data: audio } = await api.from("annotation_markers").select("id").eq("room_id", room).single();
  await page.goto(`/read/${room}?note=${audio!.id}`);
  const thread = page.getByRole("dialog", { name: "Note", exact: true });
  await thread.getByRole("button", { name: "Play voice note" }).click();
  await expect(thread.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" })); });
    recorder.start();
    for (let frame = 0; frame < 10; frame++) {
      context.fillStyle = frame % 2 ? "#a96542" : "#f2eadb"; context.fillRect(0, 0, 160, 90);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    recorder.stop(); const blob = await done; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByRole("button", { name: "Leave a note here" }).click();
  await composer.locator('input[type=file][accept^="video/"]').setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: Buffer.from(bytes) });
  await composer.getByLabel("Your note").fill("A short video from this page.");
  await composer.getByRole("button", { name: "Leave it here" }).click(); await expect(composer).toBeHidden();
  const { data: markers } = await api.from("annotation_markers").select("id").eq("room_id", room);
  const video = markers!.find(marker => marker.id !== audio!.id);
  await page.goto(`/read/${room}?note=${video!.id}`);
  await thread.getByRole("button", { name: /Play video/ }).click();
  await expect.poll(() => thread.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
  await thread.locator("video").evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => thread.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
});
