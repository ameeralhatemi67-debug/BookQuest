import { afterAll, beforeAll, expect, it } from "vitest";
import { World, denied, type TestUser } from "./helpers";
import type { SoundtrackTrack } from "../../src/lib/soundtrack";

let w: World, author: TestUser, friend: TestUser, outsider: TestUser, room: string;
beforeAll(async () => {
  w = await World.create();
  author = await w.signUp("DJ"); friend = await w.signUp("Listener"); outsider = await w.signUp("Stranger");
  room = await w.makeRoom(author, await w.makeBook(author));
  await w.inviteAndJoin(author, room, friend);
});
afterAll(() => w.close());

it("protects cue titles and audio, validates uploads, and revokes removed members", async () => {
  const args = { p_room_id: room, p_title: "A surprise", p_extension: "mp3", p_starts_at: 0.5 };
  await denied(w.rpc(outsider, "create_soundtrack_track", args), "not_a_member");
  await denied(w.rpc(author, "create_soundtrack_track", { ...args, p_extension: "html" }), "invalid_audio_type");
  await denied(w.rpc(author, "create_soundtrack_track", { ...args, p_starts_at: -1 }), "invalid_position");
  const t = await w.rpc<SoundtrackTrack>(author, "create_soundtrack_track", args);
  await denied(w.rpc(author, "finalize_soundtrack_track", { p_track_id: t.id }), "upload_missing");
  await denied(w.putObject(friend, "soundtracks", t.storage_path, 1000, "audio/mpeg"), /row-level security/);
  await w.putObject(author, "soundtracks", t.storage_path, 1000, "audio/mpeg");
  await w.rpc(author, "finalize_soundtrack_track", { p_track_id: t.id });
  expect(await w.rows(friend, "soundtrack_tracks")).toEqual([]);
  expect(await w.canReadObject(friend, "soundtracks", t.storage_path)).toBe(false);
  expect(await w.rows(outsider, "soundtrack_tracks")).toEqual([]);
  await denied(w.update(author, "soundtrack_tracks", { id: `eq.${t.id}` }, { starts_at: 0 }), /permission denied/);
  await w.read(friend, room, 0.5);
  expect(await w.rows(friend, "soundtrack_tracks")).toHaveLength(1);
  expect(await w.canReadObject(friend, "soundtracks", t.storage_path)).toBe(true);
  await denied(w.rpc(friend, "delete_soundtrack_track", { p_track_id: t.id }), "track_not_found");
  await denied(w.rpc(author, "delete_soundtrack_track", { p_track_id: t.id }), "remove_audio_first");
  await w.rpc(friend, "leave_room", { p_room_id: room });
  expect(await w.canReadObject(friend, "soundtracks", t.storage_path)).toBe(false);
});

it("shares uncued music with members and refuses oversized audio", async () => {
  await w.inviteAndJoin(author, room, friend);
  const t = await w.rpc<SoundtrackTrack>(author, "create_soundtrack_track", { p_room_id: room, p_title: "Reading music", p_extension: "wav" });
  await w.putObject(author, "soundtracks", t.storage_path, 104857601, "audio/wav");
  await denied(w.rpc(author, "finalize_soundtrack_track", { p_track_id: t.id }), "file_too_large");
  await w.owner("update storage.objects set metadata = '{\"size\":1000,\"mimetype\":\"audio/wav\"}' where name = $1", [t.storage_path]);
  await w.rpc(author, "finalize_soundtrack_track", { p_track_id: t.id });
  expect(await w.canReadObject(friend, "soundtracks", t.storage_path)).toBe(true);
});
