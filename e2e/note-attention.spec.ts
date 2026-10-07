import { expect, test } from "@playwright/test";
import { apiClient, createRoom, openReader, signUp, uploadBook, watchForErrors } from "./helpers";

for (const format of ["pdf", "epub"] as const) for (const touch of [false, true]) {
  test(`${format}: ${touch ? "touch" : "mouse"} note bubbles, point pins, replies and a five-minute snooze`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1360, height: 860 }, isMobile: touch, hasTouch: touch });
    const page = await context.newPage();
    const errors = watchForErrors(page);
    try {
      const email = await signUp(page, `Attention ${format} ${touch ? "Touch" : "Mouse"}`);
      await page.waitForURL("**/home");
      const book = await uploadBook(page, format === "pdf" ? "field-notes.pdf" : "the-lighthouse.epub");
      const room = await createRoom(page, book, { name: "Living margins" });
      await page.keyboard.press("Escape"); await openReader(page, room);
      const paper = format === "pdf" ? page.locator('[data-page="1"]') : page.locator('.reader-page iframe').first();
      await expect(paper).toBeVisible();
      const profile=page.locator('.progress-avatar-drop').first(), figure=profile.locator('.progress-avatar-figure');
      if (touch) await expect(figure).toHaveCSS("transform","none");
      else {
        const original=(await figure.boundingBox())!;
        await profile.hover();
        await expect.poll(async()=>((await figure.boundingBox())!.x-original.x)).toBeGreaterThan(20);
        await expect.poll(()=>figure.evaluate(e=>getComputedStyle(e,"::before").borderBottomLeftRadius)).toBe("0px");
        await page.mouse.move(500,30);
      }
      if (format === "pdf") {
        await page.getByLabel("Book pages", { exact: true }).dblclick({ position: { x: 2, y: 30 } });
        await expect(page.getByRole("dialog", { name: "Leave a note" })).toHaveCount(0);
      }
      const box = (await (format === "epub" ? page.locator('[data-note-surface]') : paper).boundingBox())!;
      const point = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.35 };
      if (touch) { await page.touchscreen.tap(point.x,point.y); await page.touchscreen.tap(point.x,point.y); }
      else await page.mouse.dblclick(point.x,point.y);
      const composer = page.getByRole("dialog",{name:"Leave a note"});
      await expect(composer).toBeVisible();
      await expect(page.locator('[data-note-pin="draft"]')).toBeVisible();
      await expect(composer.getByLabel("Who can see this note")).toHaveValue("room");
      const api = await apiClient(email);
      const { data: auth } = await api.auth.getUser();
      await composer.getByLabel("Who can see this note").selectOption(auth.user!.id);
      await composer.getByRole("radiogroup", { name: "Attention level" }).getByRole("radio", { name: "Excited" }).click();
      await composer.getByLabel("Your note").fill("A little thought from this exact spot.");
      await composer.getByRole("button",{name:"Leave it here"}).click();
      await expect(composer).toBeHidden();
      const { data: marker } = await api.from("annotation_markers").select("id,recipient_id,attention").eq("room_id",room).single();
      expect(marker).toMatchObject({ recipient_id:auth.user!.id, attention:"playful" });
      const avatar = page.locator(`[data-note-avatar="${marker!.id}"]`);
      const pin = page.locator(`[data-note-pin="${marker!.id}"]`);
      await expect(avatar).toBeVisible(); await expect(pin).toBeVisible();
      // Your own notes sit still; the performance is for the friend who finds them.
      await expect(avatar).toHaveAttribute("data-attention","still");
      await avatar.click();
      const bubble = page.getByRole("dialog",{name:/Note from Attention/});
      await expect(bubble).toBeVisible();
      await expect(bubble).toContainText("A little thought from this exact spot.");
      await expect(bubble).toHaveCSS("opacity","1");
      if (format === "pdf") await page.screenshot({path:`.local/note-bubble-${touch ? "phone" : "desktop"}.png`});
      await expect(page.getByRole("dialog",{name:"Note",exact:true})).toHaveCount(0);
      await bubble.getByRole("button",{name:"Reply to this note"}).click();
      const thread = page.getByRole("dialog",{name:"Note",exact:true});
      await expect(thread.getByLabel("Reply to this note")).toBeVisible();
      await page.keyboard.press("Escape");
      if (touch) { const a=(await avatar.boundingBox())!; await page.touchscreen.tap(a.x+a.width/2,a.y+a.height/2); await page.touchscreen.tap(a.x+a.width/2,a.y+a.height/2); }
      else await avatar.dblclick();
      await expect(thread).toBeVisible(); await page.keyboard.press("Escape");
      if (format === "pdf" && !touch) {
        await page.getByRole("button",{name:"Decrease zoom"}).click(); await page.getByRole("button",{name:"Decrease zoom"}).click();
        const right=(await page.locator('[data-page="2"]').boundingBox())!;
        const note=(await avatar.boundingBox())!;
        expect(note.x+note.width).toBeLessThanOrEqual(right.x+1);
      }
      await page.clock.install();
      const beforePin = (await pin.boundingBox())!;
      const a = (await avatar.boundingBox())!;
      const x=a.x+a.width/2, y=a.y+a.height/2;
      if (touch) {
        const cdp=await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
        for (const dx of [-75,-15,-90,-15]) await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx,y:y+20}]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      } else {
        await page.mouse.move(x,y); await page.mouse.down();
        for(const dx of [-75,-15,-90,-15]) await page.mouse.move(x+dx,y+20,{steps:3});
        await page.mouse.up();
      }
      await expect(avatar).toHaveAttribute("data-sleeping","true");
      await expect(avatar).toHaveAttribute("data-attention","still");
      const moved = (await avatar.boundingBox())!, surface=(await avatar.locator('xpath=ancestor::*[@data-note-surface]').boundingBox())!;
      expect(moved.x).toBeGreaterThanOrEqual(surface.x-1); expect(moved.y).toBeGreaterThanOrEqual(surface.y-1);
      expect(moved.y+moved.height).toBeLessThanOrEqual(surface.y+surface.height+1);
      expect((await pin.boundingBox())!.x).toBeCloseTo(beforePin.x,1);
      await page.clock.fastForward(5*60_000+100);
      await expect(avatar).toHaveAttribute("data-sleeping","false");
      // Your own notes sit still; the performance is for the friend who finds them.
      await expect(avatar).toHaveAttribute("data-attention","still");
      if (!touch && format === "pdf") await page.screenshot({path:".local/note-avatar-spread.png"});
      expect(errors.errors).toEqual([]);
    } finally { await context.close(); }
  });
}
