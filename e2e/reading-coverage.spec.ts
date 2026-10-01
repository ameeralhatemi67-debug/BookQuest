import { expect, test } from "@playwright/test";
import { apiClient, createRoom, openReader, signUp, uploadBook } from "./helpers";

test("active passage time survives a connection drop, pauses for notes, and jumping to the end cannot finish", async ({ page, context }) => {
  const email=await signUp(page,"Measured reader"); await page.waitForURL("**/home");
  const book=await uploadBook(page,"field-notes.pdf"); const room=await createRoom(page,book,{name:"Reading coverage"});
  await page.keyboard.press("Escape"); await openReader(page,room);
  const api=await apiClient(email); const { data: auth }=await api.auth.getUser();
  const saved=async()=>{ const {data,error}=await api.from("reading_progress").select("read_coverage,active_reading_seconds,completed_at").eq("room_id",room).eq("user_id",auth.user!.id).single(); if(error) throw error; return data!; };
  await expect.poll(async()=>Number((await saved()).read_coverage),{timeout:22_000}).toBeGreaterThan(0);
  const before=Number((await saved()).active_reading_seconds);
  await page.getByRole("button",{name:"Leave a note here"}).click();
  await page.waitForTimeout(17_000); // one full sampling interval, with the reading surface covered
  expect(Number((await saved()).active_reading_seconds)).toBeLessThanOrEqual(before+2);
  await page.keyboard.press("Escape");
  const pages=page.getByLabel("Book pages",{exact:true});
  await pages.evaluate(e=>{ e.scrollTop=e.scrollHeight; });
  await expect(page.locator("header p").nth(1)).toHaveText("Page 24 of 24");
  await expect(page.getByRole("dialog",{name:"You finished the book"})).toHaveCount(0);
  expect((await saved()).completed_at).toBeNull();
  const coverage=Number((await saved()).read_coverage);
  await context.setOffline(true);
  await expect.poll(()=>page.evaluate(({user,room})=>{ const v=JSON.parse(localStorage.getItem(`marginalia:reading:${user}:${room}`)??"null"); return v?.samples?.length??0; },{user:auth.user!.id,room}),{timeout:25_000}).toBeGreaterThan(0);
  await context.setOffline(false);
  await expect.poll(async()=>Number((await saved()).read_coverage),{timeout:25_000}).toBeGreaterThan(coverage);
  expect((await saved()).completed_at).toBeNull();
  await page.getByRole("button",{name:"Reading status"}).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText(/read · .* reached/)).toBeVisible();
  await expect(page.getByText(/words\/min/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Increase zoom"}).click(); await page.getByRole("button",{name:"Increase zoom"}).click();
  await pages.evaluate(e=>{ e.scrollTop+=45; });
  await expect(page.getByTestId("reader")).toHaveAttribute("data-reading-state","reading");
});
