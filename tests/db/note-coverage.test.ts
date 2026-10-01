import { afterAll, beforeAll, expect, it } from "vitest";
import { World, denied, type TestUser } from "./helpers";

let w: World, author: TestUser, recipient: TestUser, other: TestUser, outsider: TestUser, room: string;
beforeAll(async () => {
  w = await World.create();
  author = await w.signUp("Author"); recipient = await w.signUp("Recipient"); other = await w.signUp("Other"); outsider = await w.signUp("Outsider");
  room = await w.makeRoom(author, await w.makeBook(author), { p_visibility: "open" });
  await w.rpc(recipient, "join_open_room", { p_room_id: room }); await w.rpc(other, "join_open_room", { p_room_id: room });
});
afterAll(() => w.close());

it("protects a chosen-reader note across content, bytes, unlocks, counters, activity and notifications", async () => {
  await w.read(recipient, room, 1); await w.read(other, room, 1);
  const id = await w.note(author, room, 0.2, "Private message", { p_publish: false, p_attention: "playful", p_recipient_id: recipient.id });
  const path = `${room}/${id}/private.png`;
  await w.putObject(author, "annotation-images", path, 100, "image/png");
  await w.insert(author, "annotation_attachments", { marker_id: id, room_id: room, kind: "image", bucket: "annotation-images", path, mime_type: "image/png", size_bytes: 100 });
  await w.rpc(author, "publish_annotation", { p_marker_id: id });
  expect(await w.rows(recipient, "annotation_contents", { marker_id: `eq.${id}` })).toHaveLength(1);
  expect(await w.canReadObject(recipient,"annotation-images",path)).toBe(true);
  expect(await w.rows(other, "annotation_markers", { id: `eq.${id}` })).toEqual([]);
  for (const table of ["annotation_contents", "annotation_attachments", "annotation_replies", "annotation_reactions", "reading_unlocks"]) expect(await w.rows(other,table,{marker_id:`eq.${id}`})).toEqual([]);
  expect(await w.canReadObject(other,"annotation-images",path)).toBe(false);
  await denied(w.rpc(other,"add_reply",{p_marker_id:id,p_body:"Guess"}),/note_unavailable/);
  expect(await w.rows(other,"notifications",{marker_id:`eq.${id}`})).toEqual([]);
  expect(await w.rows(other,"room_activity",{type:"eq.note_left"})).toEqual([]);
  const card = await w.rpc<{ note_count: number; waiting: number; unseen: number }>(other,"room_detail",{p_room_id:room});
  expect([card.note_count,card.waiting,card.unseen]).toEqual([0,0,0]);
  const journey = await w.rpc<{totals:{notes:number;images:number};moments:unknown[]}>(other,"room_journey",{p_room_id:room});
  expect(journey.totals.notes).toBe(0); expect(journey.totals.images).toBe(0); expect(journey.moments).toEqual([]);
  const self = await w.note(author,room,0.1,"Only myself",{p_recipient_id:author.id});
  expect(await w.rows(recipient,"annotation_markers",{id:`eq.${self}`})).toEqual([]);
  expect(await w.rows(author,"annotation_contents",{marker_id:`eq.${self}`})).toHaveLength(1);
  await denied(w.note(author,room,0.1,"No",{p_recipient_id:outsider.id}),/invalid_recipient/);
  await denied(w.note(author,room,0.1,"No",{p_attention:"wild"}),/invalid_attention/);
});

async function session(user: TestUser, start: number, end: number, seconds: number, words = 120, extra = {}) {
  await w.owner("update public.reading_progress set coverage_sampled_at=clock_timestamp()-interval '30 seconds' where user_id=$1 and room_id=$2",[user.id,room]);
  return w.rpc<{read_coverage:number;active_reading_seconds:number;estimated_wpm:number;completed:boolean}>(user,"record_reading_session",{p_room_id:room,p_samples:[{id:crypto.randomUUID(),start,end,seconds,words,kind:"reading",...extra}]});
}
it("earns credit through time and revisits, rejects scanning and duplicate time, and cannot finish from a last-page jump", async () => {
  await w.read(author,room,1);
  expect((await w.rows<{completed_at:string|null}>(author,"reading_progress",{user_id:`eq.${author.id}`}))[0].completed_at).toBeNull();
  const scan = await session(author,0,0.1,30,120,{kind:"scanning"}); expect(scan.read_coverage).toBe(0);
  const first = await session(author,0,0.1,12); expect(Number(first.read_coverage)).toBeCloseTo(0.04,2);
  const back = await session(author,0,0.1,18,120,{kind:"revisiting"}); expect(Number(back.read_coverage)).toBeCloseTo(0.1,3);
  const repeat = await session(author,0,0.1,30); expect(Number(repeat.read_coverage)).toBeCloseTo(0.1,3);
  const sample = {id:crypto.randomUUID(),start:0.1,end:0.2,seconds:30,words:120,kind:"reading",wpm:300};
  await w.owner("update public.reading_progress set coverage_sampled_at=clock_timestamp()-interval '30 seconds' where user_id=$1 and room_id=$2",[author.id,room]);
  const once = await w.rpc<{active_reading_seconds:number}>(author,"record_reading_session",{p_room_id:room,p_samples:[sample]});
  const twice = await w.rpc<{active_reading_seconds:number}>(author,"record_reading_session",{p_room_id:room,p_samples:[sample]});
  expect(twice.active_reading_seconds).toBe(once.active_reading_seconds);
  const instant = await w.rpc<{accepted:{seconds:number}[]}>(author,"record_reading_session",{p_room_id:room,p_samples:[{...sample,id:crypto.randomUUID()}]});
  expect(Number(instant.accepted[0]?.seconds ?? 0)).toBeLessThan(1);
  for(let i=2;i<10;i++) await session(author,i/10,(i+1)/10,30);
  const [row] = await w.rows<{read_coverage:number;completed_at:string|null;estimated_wpm:number}>(author,"reading_progress",{user_id:`eq.${author.id}`});
  expect(Number(row.read_coverage)).toBeGreaterThanOrEqual(0.9); expect(row.completed_at).not.toBeNull(); expect(Number(row.estimated_wpm)).toBeGreaterThan(240);
  await session(author,0.9,1,30);
  expect(await w.rows(author,"room_activity",{type:"eq.finished",actor_id:`eq.${author.id}`})).toHaveLength(1);
  await denied(session(outsider,0,0.1,15),/not_a_member/);
  await denied(session(author,-0.1,0.2,15),/invalid_sample/);
});
