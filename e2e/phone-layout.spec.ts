// Phone layout regressions: Home must never be wider than the screen (long,
// unbreakable room titles once made the page zoom out), and the book map must
// stay readable on a phone.
import { expect, test } from "@playwright/test";
import { createRoom, openReader, signUp, uploadBook } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("Home fits a phone with long titles, and the map is readable", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, "Phone Reader");
  await page.waitForURL("**/home");
  const book = await uploadBook(page, "field-notes.pdf");
  await createRoom(page, book, { name: "نواظر الأيك في معرفة النيك , العلامة جلال الدين السيوطي" });
  await page.keyboard.press("Escape");
  const second = await createRoom(page, book, { name: "AnExtremelyLongRoomNameWithoutAnySpacesThatCannotWrapAnywhereAtAll" });
  await page.keyboard.press("Escape");

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Your rooms" })).toBeVisible();
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({ path: ".local/showcase/phone-home.png", fullPage: true });

  await openReader(page, second);
  await page.getByRole("button", { name: "Map and contents" }).click();
  const map = page.getByRole("dialog", { name: "Map and contents" });
  await expect(map.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
  await expect(map.getByText(/You're \d+% in/)).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: ".local/showcase/phone-map.png" });
  await map.getByRole("button", { name: "What the marks mean" }).click();
  await expect(page.getByRole("list", { name: "Key" })).toBeVisible();
  await page.screenshot({ path: ".local/showcase/phone-map-key.png" });
  await page.keyboard.press("Escape");
  await map.getByRole("tab", { name: "Contents" }).click();
  await expect(page.getByText("This book doesn't include a table of contents.")).toBeVisible();
  await page.screenshot({ path: ".local/showcase/phone-contents.png" });
});
