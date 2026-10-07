import { expect, test, type Page } from "@playwright/test";
import { createRoom, openReader, signUp, uploadBook } from "./helpers";

// Motion capture: slows the animation clock so frames of the page flip and of
// each attention performance can be inspected (and stitched into GIFs).
// Not part of the acceptance suite; run it by name.
test.skip(!process.env.MOTION_CAPTURE, "set MOTION_CAPTURE=1 to record motion frames");

async function slow(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
}

test("records the flip and the attention levels", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, "Motion");
  await page.waitForURL("**/home");
  const book = await uploadBook(page, "the-lighthouse.epub");
  const room = await createRoom(page, book, { name: "Motion" });
  await page.keyboard.press("Escape");
  await openReader(page, room);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.waitForTimeout(1500);

  // ---- the flip, at a tenth of the speed
  await slow(page, 0.1);
  await page.getByRole("button", { name: "Next page" }).click();
  for (let i = 0; i < 24; i++) {
    await page.screenshot({ path: `.local/motion/flip-${String(i).padStart(2, "0")}.png`, clip: { x: 260, y: 64, width: 900, height: 796 } });
    await page.waitForTimeout(280);
  }
  await slow(page, 1);

  // ---- every attention level in the composer stage, at a fifth of the speed
  await page.getByRole("button", { name: "Leave a note here" }).click();
  const sheet = page.getByRole("dialog", { name: "Leave a note" });
  const stage = sheet.locator(".na").first();
  for (const [level, file] of [["Whisper", "quiet"], ["Gentle", "gentle"], ["Excited", "playful"], ["Knock knock", "knock"], ["DO NOT IGNORE THIS 😂", "shout"]] as const) {
    await sheet.getByRole("radiogroup", { name: "Attention level" }).getByRole("radio", { name: level }).click();
    await page.waitForTimeout(900);
    await slow(page, 0.2);
    const box = (await stage.boundingBox())!;
    for (let i = 0; i < 30; i++) {
      await page.screenshot({ path: `.local/motion/${file}-${String(i).padStart(2, "0")}.png`, clip: { x: box.x - 60, y: box.y - 70, width: 150, height: 130 } });
      await page.waitForTimeout(110);
    }
    await slow(page, 1);
  }
  expect(true).toBe(true);
});
