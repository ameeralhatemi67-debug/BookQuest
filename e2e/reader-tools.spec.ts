import { expect, test } from "@playwright/test";
import { apiClient, createRoom, openReader, signUp, uploadBook, watchForErrors } from "./helpers";

for (const format of ["pdf", "epub"] as const) for (const touch of [false, true]) {
  test(`${format}: ${touch ? "phone double-tap" : "desktop double-click"}, drawing and saved attachment`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1360, height: 860 }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const errors = watchForErrors(page);
    try {
      const email = await signUp(page, `Sketch ${format} ${touch ? "Touch" : "Mouse"}`);
      await page.waitForURL("**/home");
      const book = await uploadBook(page, format === "pdf" ? "field-notes.pdf" : "the-lighthouse.epub");
      const room = await createRoom(page, book, { name: "Reader tools" });
      await page.keyboard.press("Escape"); await openReader(page, room);
      if (format === "pdf") {
        const viewport = page.getByLabel("Book pages", { exact: true });
        const first = page.locator('[data-page="1"]');
        if (!touch) {
          // Reproduce fractional available widths from OS scaling / browser zoom.
          await page.getByTestId("reader").evaluate(element => { element.style.right = "0.3px"; });
          await expect.poll(() => viewport.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(1360);
        }
        const assertFits = async (numbers: number[]) => {
          const box = (await viewport.boundingBox())!;
          for (const number of numbers) {
            await expect.poll(async () => {
              const paper = await page.locator(`[data-page="${number}"]`).boundingBox();
              return paper && paper.x >= box.x - 1 && paper.y >= box.y - 1 && paper.x + paper.width <= box.x + box.width + 1 && paper.y + paper.height <= box.y + box.height + 1;
            }).toBe(true);
            const paper = (await page.locator(`[data-page="${number}"]`).boundingBox())!;
            expect(paper.x).toBeGreaterThanOrEqual(box.x - 1); expect(paper.y).toBeGreaterThanOrEqual(box.y - 1);
            expect(paper.x + paper.width).toBeLessThanOrEqual(box.x + box.width + 1);
            expect(paper.y + paper.height).toBeLessThanOrEqual(box.y + box.height + 1);
          }
        };
        await assertFits([1]);
        await expect(page.locator("footer.reader-footer")).toHaveCount(0);
        const rail = page.getByRole("complementary", { name: "Reading progress" });
        await expect(rail.locator('[data-orientation="vertical"]')).toBeVisible();
        const railBox = (await rail.boundingBox())!;
        expect(railBox.height).toBeGreaterThan(railBox.width * 5);
        await rail.getByRole("button", { name: /Sketch.*you/ }).click();
        await expect(page.getByText("(you)", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(viewport).toHaveCSS("overflow-x", "hidden");
        const normalWidth = (await first.boundingBox())!.width;
        if (!touch) expect((await first.boundingBox())!.height).toBeGreaterThan((await viewport.boundingBox())!.height * 0.94);
        if (!touch) await page.screenshot({ path: ".local/reader-full-page.png" });
        await page.getByRole("button", { name: "Decrease zoom" }).click();
        await expect(page.getByText("110%", { exact: true })).toBeVisible();
        await assertFits([1]);
        expect((await first.boundingBox())!.width).toBeLessThan(normalWidth);
        await page.getByRole("button", { name: "Decrease zoom" }).click();
        await expect(page.getByText("120%", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Decrease zoom" })).toBeDisabled();
        await page.keyboard.press("Escape"); await assertFits([1, 2]);
        await expect(viewport).toHaveCSS("overflow-x", "hidden");
        expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
        if (!touch) await page.screenshot({ path: ".local/reader-two-pages.png" });
        const a = (await first.boundingBox())!, b = (await page.locator('[data-page="2"]').boundingBox())!;
        expect(a.y).toBeCloseTo(b.y, 0); expect(b.x).toBeGreaterThan(a.x + a.width);
        if (!touch) expect(a.height).toBeGreaterThan((await viewport.boundingBox())!.height * 0.94);
        if (!touch) {
          for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [844, 390], [1024, 768], [1360, 860]]) {
            await page.setViewportSize({ width, height });
            await assertFits([1, 2]);
            for (const number of [1, 2]) {
              const paper = (await page.locator(`[data-page="${number}"]`).boundingBox())!;
              for (const name of ["Previous page", "Next page"]) {
                const arrow = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
                expect(arrow.x + arrow.width <= paper.x + 1 || arrow.x >= paper.x + paper.width - 1 || arrow.y >= paper.y + paper.height - 1).toBe(true);
              }
            }
            const note = (await page.getByRole("button", { name: "Leave a note here" }).boundingBox())!;
            for (const name of ["Decrease zoom", "Increase zoom"]) {
              const control = (await page.getByRole("button", { name }).boundingBox())!;
              expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
              expect(control.x).toBeGreaterThanOrEqual(0); expect(control.x + control.width).toBeLessThanOrEqual(note.x);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            if (width === 390) await page.screenshot({ path: ".local/reader-phone-spread.png" });
          }
        }
        await page.getByRole("button", { name: "Increase zoom" }).click();
        await expect(page.getByText("110%", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape"); await assertFits([1]);
        expect((await page.locator('[data-page="2"]').boundingBox())!.y).toBeGreaterThanOrEqual((await viewport.boundingBox())!.y + (await viewport.boundingBox())!.height);
        await page.getByRole("button", { name: "Reading settings" }).click();
        await page.getByRole("button", { name: "Two pages", exact: true }).click();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Next page" }).click();
        await expect(page.locator("header p").nth(1)).toHaveText("Page 3 of 24");
        await assertFits([3, 4]);
        await page.getByRole("button", { name: "Reading settings" }).click();
        await page.getByRole("button", { name: "Full page", exact: true }).click();
        await page.keyboard.press("Escape"); await assertFits([3]);
        await page.getByRole("button", { name: "Increase zoom" }).click();
        await expect(viewport).toHaveCSS("overflow-x", "hidden"); // 90%
        await page.getByRole("button", { name: "Increase zoom" }).click();
        await expect(page.getByText("80%", { exact: true })).toBeVisible();
        await expect(viewport).toHaveCSS("overflow-x", "auto");
        for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Increase zoom" }).click();
        await expect(page.getByText("20%", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Increase zoom" })).toBeDisabled();
        expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        await page.getByRole("button", { name: "Reading settings" }).click();
        await page.getByRole("button", { name: "Two pages", exact: true }).click();
        await expect(viewport).toHaveCSS("overflow-x", "hidden");
        await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(0);
        await page.getByRole("button", { name: "Full page", exact: true }).click();
        await page.keyboard.press("Escape");
        await expect(page.locator("header p").nth(1)).toHaveText("Page 3 of 24");
        await assertFits([3]);
      }
      const paper = format === "pdf" ? page.locator('[data-page="3"]') : page.frameLocator("iframe").locator("body");
      if (touch) {
        const box = (await paper.boundingBox())!;
        const x = box.x + Math.min(box.width / 2, 160), y = box.y + 80;
        await page.touchscreen.tap(x, y); await page.touchscreen.tap(x, y);
      } else await paper.dblclick({ position: { x: 80, y: 80 } });
      const composer = page.getByRole("dialog", { name: "Leave a note", exact: true });
      await expect(composer).toBeVisible();
      await composer.getByRole("button", { name: "Draw", exact: true }).click();
      await expect(composer.getByRole("button", { name: "Add drawing" })).toBeDisabled();
      await composer.getByLabel("Stroke color").fill("#2468ac");
      await composer.getByLabel("Stroke size").fill("8");
      const canvas = composer.getByLabel("Drawing canvas");
      const box = (await canvas.boundingBox())!;
      if (touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 20, y: box.y + 25 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 90, y: box.y + 65 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(box.x + 20, box.y + 25); await page.mouse.down();
        await page.mouse.move(box.x + 90, box.y + 65, { steps: 8 }); await page.mouse.up();
      }
      expect(await canvas.evaluate((element: HTMLCanvasElement) => {
        const bytes = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
        for (let i = 0; i < bytes.length; i += 4) if (bytes[i] === 36 && bytes[i + 1] === 104 && bytes[i + 2] === 172) return true;
        return false;
      })).toBe(true);
      if (format === "pdf" && !touch) await page.screenshot({ path: ".local/reader-drawing.png" });
      await composer.getByRole("button", { name: "Add drawing" }).click();
      await composer.getByRole("button", { name: "Leave it here" }).click(); await expect(composer).toBeHidden();
      const api = await apiClient(email);
      const { data: marker } = await api.from("annotation_markers").select("id, anchor").eq("room_id", room).single();
      expect((marker!.anchor as { type: string }).type).toBe(format);
      if (format === "pdf") expect((marker!.anchor as { page: number }).page).toBe(3);
      const { data: attachment } = await api.from("annotation_attachments").select("mime_type, width, height, original_name").eq("marker_id", marker!.id).single();
      expect(attachment).toMatchObject({ mime_type: "image/png", width: 800, height: 480 });
      expect(attachment!.original_name).toMatch(/^drawing-.*\.png$/);
      await page.goto(`/read/${room}?note=${marker!.id}`);
      const thread = page.getByRole("dialog", { name: "Note", exact: true });
      await expect(thread).toBeVisible();
      await expect.poll(() => thread.locator("img").last().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(800);
      if (format === "pdf" && !touch) {
        await page.evaluate(() => {
          localStorage.removeItem("marginalia:reader-settings:v2");
          localStorage.setItem("marginalia:reader-settings", JSON.stringify({ theme: "dark", zoom: 0.8 }));
        });
        await page.reload();
        await expect(page.getByTestId("reader")).toHaveAttribute("data-ready", "true");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("reader")).toHaveAttribute("data-reader-theme", "dark");
        await page.getByRole("button", { name: "Reading settings" }).click();
        await expect(page.getByText("120%", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Increase zoom" }).click();
        await expect(page.getByText("110%", { exact: true })).toBeVisible();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("marginalia:reader-settings:v2")!).zoom)).toBe(1.1);
        await page.reload();
        await expect(page.getByTestId("reader")).toHaveAttribute("data-ready", "true");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Reading settings" }).click();
        await expect(page.getByText("110%", { exact: true })).toBeVisible();
      }
      expect(errors.errors).toEqual([]);
    } finally { await context.close(); }
  });
}
