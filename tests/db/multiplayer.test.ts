import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denied, World, type TestBook, type TestUser } from "./helpers";

interface Layer {
  features: Record<string, boolean>;
  furthest: number;
  predictions: { id: string; open: boolean; body: string | null; verdicts: Record<string, number> | null }[];
  polls: { id: string; reached: boolean; question: string | null; options: string[] | null; my_vote: number | null; votes: number; results: { option: number; user_id: string }[] | null }[];
  rituals: { id: string; kind: string; members: { user_id: string; done: boolean }[] }[];
  afterparties: { chapter_index: number; label: string }[];
  weather: { p: number; e: string; n: number }[];
  cues: { position: number; open: boolean }[];
}

const OUTLINE = [
  { label: "One", start: 0, depth: 0 },
  { label: "Two", start: 0.3, depth: 0 },
  { label: "Two, part b", start: 0.4, depth: 1 },
  { label: "Three", start: 0.6, depth: 0 },
];

describe("emotional multiplayer reading", () => {
  let w: World;
  let sara: TestUser, fahad: TestUser, amir: TestUser, outsider: TestUser;
  let book: TestBook;
  let room: string;

  const layer = (user: TestUser) => w.rpc<Layer>(user, "room_layer", { p_room_id: room });

  beforeAll(async () => {
    w = await World.create();
    sara = await w.signUp("Sara");
    fahad = await w.signUp("Fahad");
    amir = await w.signUp("Amir");
    outsider = await w.signUp("Outsider");
    book = await w.makeBook(sara);
    room = await w.makeRoom(sara, book, { p_member_limit: 75 });
    await w.inviteAndJoin(sara, room, fahad);
    await w.inviteAndJoin(sara, room, amir);
  });
  afterAll(() => w.close());

  it("allows rooms of up to 75 readers and no more", async () => {
    await denied(w.makeRoom(sara, book, { p_member_limit: 76 }), "invalid_room_settings");
    const detail = await w.rpc<{ capacity: number; features: Record<string, boolean> }>(sara, "room_detail", { p_room_id: room });
    expect(detail.capacity).toBe(75);
    expect(detail.features).toEqual({});
  });

  it("lets only room staff or an admin switch features, and enforces them", async () => {
    await denied(w.rpc(fahad, "set_room_features", { p_room_id: room, p_features: { predictions: false } }), "not_allowed");
    await denied(w.rpc(sara, "set_room_features", { p_room_id: room, p_features: { telepathy: true } }), "invalid_features");
    expect(await w.rpc(sara, "set_room_features", { p_room_id: room, p_features: { predictions: false } })).toEqual({ predictions: false });
    await denied(
      w.rpc(fahad, "seal_prediction", { p_room_id: room, p_body: "x", p_made_at: 0.1, p_made_label: "One", p_opens_at: 0.5, p_opens_label: "Three", p_opens_kind: "point" }),
      "feature_off",
    );
    await w.rpc(sara, "set_room_features", { p_room_id: room, p_features: { predictions: true } });
  });

  it("keeps a sealed prediction sealed for everyone until they reach its opening point", async () => {
    await w.read(sara, room, 0.1);
    await w.read(fahad, room, 0.1);
    const id = await w.rpc<string>(sara, "seal_prediction", {
      p_room_id: room, p_body: "The butler did it.", p_made_at: 0.1, p_made_label: "One", p_opens_at: 0.35, p_opens_label: "Two", p_opens_kind: "chapter",
    });
    const hidden = await w.rpc<string>(sara, "seal_prediction", {
      p_room_id: room, p_body: "Even I won't remember this.", p_made_at: 0.1, p_made_label: "One", p_opens_at: 0.5, p_opens_label: "Two, part b", p_opens_kind: "point", p_hide_from_author: true,
    });
    await denied(
      w.rpc(sara, "seal_prediction", { p_room_id: room, p_body: "Backwards", p_made_at: 0.5, p_made_label: "x", p_opens_at: 0.2, p_opens_label: "y", p_opens_kind: "point" }),
      "invalid_unlock",
    );

    const before = (await layer(fahad)).predictions.find((p) => p.id === id)!;
    expect(before).toMatchObject({ open: false, body: null });
    await denied(w.rpc(fahad, "reveal_prediction", { p_prediction_id: id }), "prediction_sealed");
    // The author can read their own, unless they chose to hide it from themself too.
    expect((await layer(sara)).predictions.find((p) => p.id === id)!.body).toBe("The butler did it.");
    expect((await layer(sara)).predictions.find((p) => p.id === hidden)!).toMatchObject({ open: false, body: null });
    expect((await w.rpc<{ predictions_ready: number }>(fahad, "room_detail", { p_room_id: room })).predictions_ready).toBe(0);

    await w.read(fahad, room, 0.36);
    expect((await w.rpc<{ predictions_ready: number }>(fahad, "room_detail", { p_room_id: room })).predictions_ready).toBe(1);
    await w.rpc(fahad, "reveal_prediction", { p_prediction_id: id, p_verdict: "way_off" });
    const after = (await layer(fahad)).predictions.find((p) => p.id === id)!;
    expect(after).toMatchObject({ open: true, body: "The butler did it.", verdicts: { way_off: 1 } });
    expect((await w.rpc<{ predictions_ready: number }>(fahad, "room_detail", { p_room_id: room })).predictions_ready).toBe(0);

    // Nobody can edit it, and only staff can take it down.
    await denied(w.rpc(fahad, "remove_prediction", { p_prediction_id: id }), "not_allowed");
    await denied(w.rows(sara, "predictions"), /permission denied/);
    await denied(w.rpc(outsider, "room_layer", { p_room_id: room }), "room_not_found");
  });

  it("hides a poll's question and results until reached, and results until you vote", async () => {
    const poll = await w.rpc<string>(sara, "create_poll", {
      p_room_id: room, p_position: 0.45, p_anchor: { type: "epub", cfi: "epubcfi(/6/45)" }, p_location_label: "Two",
      p_question: "Who do you trust?", p_options: ["The butler", "The niece", " ", "Nobody"],
    });
    const amirView = (await layer(amir)).polls.find((p) => p.id === poll)!;
    expect(amirView).toMatchObject({ reached: false, question: null, options: null, results: null });
    await denied(w.rpc(amir, "vote_poll", { p_poll_id: poll, p_option: 0 }), "poll_ahead");

    await w.read(fahad, room, 0.5);
    const fahadView = (await layer(fahad)).polls.find((p) => p.id === poll)!;
    expect(fahadView).toMatchObject({ reached: true, question: "Who do you trust?", options: ["The butler", "The niece", "Nobody"], results: null });
    await denied(w.rpc(fahad, "vote_poll", { p_poll_id: poll, p_option: 3 }), "invalid_option");
    await w.rpc(fahad, "vote_poll", { p_poll_id: poll, p_option: 1 });
    await denied(w.rpc(fahad, "vote_poll", { p_poll_id: poll, p_option: 0 }), "already_voted");
    const voted = (await layer(fahad)).polls.find((p) => p.id === poll)!;
    expect(voted.results).toEqual([{ option: 1, user_id: fahad.id }]);
    expect((await layer(sara)).polls.find((p) => p.id === poll)!).toMatchObject({ votes: 1, results: null });
  });

  it("delivers a package only to its recipient, with a heads-up but no contents", async () => {
    await denied(w.note(sara, room, 0.7, "For everyone?", { p_kind: "package" }), "invalid_recipient");
    const pkg = await w.note(sara, room, 0.7, "Open me at the wedding", { p_kind: "package", p_recipient_id: amir.id, p_title: "For Amir", p_attention: "shout" });
    const [marker] = await w.rows<{ kind: string; package_title: string; attention: string }>(amir, "annotation_markers", { id: `eq.${pkg}` });
    expect(marker).toMatchObject({ kind: "package", package_title: "For Amir", attention: "shout" });
    expect(await w.rows(amir, "annotation_contents", { marker_id: `eq.${pkg}` })).toEqual([]);
    expect(await w.rows(fahad, "annotation_markers", { id: `eq.${pkg}` })).toEqual([]);
    const [heads] = await w.rows<{ type: string; data: { title: string } }>(amir, "notifications", { marker_id: `eq.${pkg}` });
    expect(heads).toMatchObject({ type: "package", data: { title: "For Amir" } });
    expect((await w.rpc<{ packages_waiting: number }>(amir, "room_detail", { p_room_id: room })).packages_waiting).toBe(1);
    await denied(w.note(sara, room, 0.2, "Too loud", { p_attention: "louder" }), "invalid_attention");
  });

  it("opens a chapter afterparty once every reader has cleared that chapter", async () => {
    await w.rpc(fahad, "set_book_outline", { p_book_id: book.id, p_outline: OUTLINE });
    await w.rpc(sara, "set_book_outline", { p_book_id: book.id, p_outline: [{ label: "Ignored", start: 0 }] });
    expect((await layer(sara)).afterparties).toEqual([]);
    await w.read(sara, room, 0.32);
    // Amir has not started: nothing opens.
    expect((await layer(sara)).afterparties).toEqual([]);
    await w.read(amir, room, 0.31);
    const parties = (await layer(amir)).afterparties;
    expect(parties.map((p) => p.label)).toEqual(["One"]);
    expect(await w.rows(sara, "room_activity", { type: "eq.afterparty" })).toHaveLength(1);
    expect((await w.rows<{ type: string }>(fahad, "notifications", { type: "eq.afterparty" }))).toHaveLength(1);
  });

  it("reports ritual progress per reader", async () => {
    const ritual = await w.rpc<string>(sara, "create_ritual", {
      p_room_id: room, p_kind: "predict_before", p_title: "Everyone predict before Three", p_target_at: 0.6, p_target_label: "Three",
    });
    const custom = await w.rpc<string>(fahad, "create_ritual", { p_room_id: room, p_kind: "custom", p_title: "Read one chapter aloud" });
    await denied(w.rpc(sara, "create_ritual", { p_room_id: room, p_kind: "hold_until", p_title: "Wait", p_target_at: 0.7 }), "invalid_ritual");
    await w.rpc(amir, "checkin_ritual", { p_ritual_id: custom });
    const rituals = (await layer(fahad)).rituals;
    const done = (id: string) => Object.fromEntries(rituals.find((r) => r.id === id)!.members.map((m) => [m.user_id, m.done]));
    expect(done(ritual)).toEqual({ [sara.id]: true, [fahad.id]: false, [amir.id]: false });
    expect(done(custom)).toEqual({ [sara.id]: false, [fahad.id]: false, [amir.id]: true });
    await denied(w.rpc(amir, "end_ritual", { p_ritual_id: ritual }), "not_allowed");
    await w.rpc(sara, "end_ritual", { p_ritual_id: ritual });
  });

  it("only shows reaction weather the reader has already reached", async () => {
    await w.note(sara, room, 0.55, "", { p_emoji: "😱" });
    expect((await layer(amir)).weather.some((w) => w.e === "😱")).toBe(false);
    await w.read(amir, room, 0.56);
    expect((await layer(amir)).weather).toContainEqual({ p: 0.55, e: "😱", n: 1 });
  });

  it("summarizes what friends did while a reader was away", async () => {
    await w.rpc(amir, "room_away", { p_room_id: room, p_mark: true });
    await w.owner("update private.room_visits set seen_at = now() - interval '1 day' where user_id = $1", [amir.id]);
    await w.owner("update public.reading_progress set last_read_at = now() - interval '1 day' where user_id = $1", [amir.id]);
    await w.owner("update private.progress_snapshots set at = at - interval '2 days'");
    const note = await w.note(amir, room, 0.4, "My theory");
    await w.read(sara, room, 0.8);
    await w.note(sara, room, 0.78, "Ahead of you");
    await w.rpc(sara, "add_reply", { p_marker_id: note, p_body: "Wrong!" });
    const away = await w.rpc<{ members: { user_id: string; from: number; to: number; left_ahead: number; packages: number; replies: number; reply_label: string }[] }>(amir, "room_away", { p_room_id: room });
    const saraSummary = away.members.find((m) => m.user_id === sara.id)!;
    expect(saraSummary).toMatchObject({ left_ahead: 2, packages: 1, replies: 1, reply_label: "Chapter 4" });
    expect(Number(saraSummary.to)).toBeCloseTo(0.8);
    expect(Number(saraSummary.from)).toBeLessThan(0.8);
  });

  it("opens the vault only at the end, and collects the room's memory", async () => {
    await denied(w.rpc(fahad, "room_vault", { p_room_id: room }), "vault_locked");
    await denied(w.rpc(fahad, "rate_book", { p_room_id: room, p_stars: 5 }), "finish_first");
    await w.read(fahad, room, 1);
    await w.rpc(fahad, "rate_book", { p_room_id: room, p_stars: 4, p_line: "Would trust the niece again." });
    const vault = await w.rpc<{ predictions: { body: string }[]; ratings: { stars: number }[]; polls: unknown[]; timeline: unknown[]; first_note: { body: string } | null; chapters: { label: string }[] }>(fahad, "room_vault", { p_room_id: room });
    expect(vault.predictions.map((p) => p.body)).toContain("Even I won't remember this.");
    expect(vault.ratings).toEqual([{ user_id: fahad.id, stars: 4, line: "Would trust the niece again." }]);
    expect(vault.polls).toHaveLength(1);
    expect(vault.timeline.length).toBeGreaterThan(3);
    expect(vault.chapters.map((c) => c.label)).toEqual(["One", "Two", "Three"]);
    // A package for someone else stays out of the vault.
    expect(JSON.stringify(vault)).not.toContain("Open me at the wedding");
  });

  it("brings back a reader's own notes from an earlier reading of the same book", async () => {
    const reread = await w.makeRoom(sara, book);
    const echoes = await w.rpc<{ body: string; mine: boolean; room_name: string }[]>(sara, "reading_echoes", { p_room_id: reread });
    expect(echoes.map((e) => e.body)).toContain("Ahead of you");
    expect(echoes.every((e) => e.room_name === "A Room")).toBe(true);
    // Friends' notes she reached come back too, and her own package is still hers.
    expect(echoes.find((e) => e.body === "My theory")?.mine).toBe(false);
    expect(echoes.find((e) => e.body === "Open me at the wedding")?.mine).toBe(true);
    await w.inviteAndJoin(sara, reread, fahad);
    const fahadsEchoes = (await w.rpc<{ body: string }[]>(fahad, "reading_echoes", { p_room_id: reread })).map((e) => e.body);
    expect(fahadsEchoes).toContain("Ahead of you");
    expect(fahadsEchoes).not.toContain("Open me at the wedding");
  });
});
