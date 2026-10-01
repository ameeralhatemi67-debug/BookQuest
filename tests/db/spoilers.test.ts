// The defining mechanic, tested where it is enforced: in the database.
//
//   Amir (A) is ahead and leaves notes at 20%, 45% and 70%.
//   Sara (B) starts from the beginning.
//
// Until Sara actually reaches a note she may know only that Amir left
// *something* there. Nothing else — not the text, emoji, link, quote, replies,
// reactions, attachment rows or the media bytes — may be retrievable by her.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denied, World, type TestBook, type TestUser } from "./helpers";

describe("spoiler lock: authorization, not decoration", () => {
  let w: World;
  let amir: TestUser;
  let sara: TestUser;
  let outsider: TestUser;
  let book: TestBook;
  let room: string;
  let note20: string;
  let note45: string;
  let note70: string;
  const mediaPath = () => `${room}/${note45}/photo.jpg`;

  beforeAll(async () => {
    w = await World.create();
    amir = await w.signUp("Amir");
    sara = await w.signUp("Sara");
    outsider = await w.signUp("Outsider");
    book = await w.makeBook(amir);
    room = await w.makeRoom(amir, book, { p_mode: "duo" });

    await w.read(amir, room, 0.5);
    note20 = await w.note(amir, room, 0.2, "I did NOT see that coming", { p_quote: "The butler did it." });

    // The 45% note carries an image, so it is drafted, the media attached, then published.
    note45 = await w.note(amir, room, 0.45, "Look at this map", { p_publish: false });
    await w.putObject(amir, "annotation-images", mediaPath(), 5000, "image/jpeg");
    await w.insert(amir, "annotation_attachments", {
      marker_id: note45, room_id: room, kind: "image", bucket: "annotation-images",
      path: mediaPath(), mime_type: "image/jpeg", size_bytes: 5000,
    });
    await w.rpc(amir, "publish_annotation", { p_marker_id: note45 });

    note70 = await w.note(amir, room, 0.7, null as unknown as string, { p_emoji: "😱", p_link_url: "https://example.com/theory" });
    await w.rpc(amir, "toggle_reaction", { p_marker_id: note20, p_emoji: "🔥" });

    await w.inviteAndJoin(amir, room, sara);
  });
  afterAll(() => w.close());

  const contentsFor = (user: TestUser) => w.rows<{ marker_id: string; body: string }>(user, "annotation_contents", { room_id: `eq.${room}` });

  // ------------------------------------------------------------ before reaching
  describe("before Sara reaches anything", () => {
    it("shows her neutral markers: who and where, nothing else", async () => {
      const markers = await w.rows(sara, "annotation_markers", { room_id: `eq.${room}`, order: "position.asc" });
      expect(markers.map((m) => m.id)).toEqual([note20, note45, note70]);
      expect(markers.every((m) => m.author_id === amir.id)).toBe(true);
      // The marker table structurally cannot leak: it has no payload columns.
      expect(Object.keys(markers[0]).sort()).toEqual(
        ["anchor", "attention", "author_id", "book_id", "created_at", "id", "location_label", "position", "published_at", "recipient_id", "removed_at", "removed_by", "room_id"],
      );
      for (const marker of markers) {
        expect(JSON.stringify(marker)).not.toMatch(/did NOT see|map|😱|example\.com|butler/);
      }
    });

    it("returns no protected rows at all, however she asks", async () => {
      expect(await contentsFor(sara)).toEqual([]);
      expect(await w.rows(sara, "annotation_contents", { marker_id: `eq.${note70}` })).toEqual([]);
      expect(await w.rows(sara, "annotation_contents", { marker_id: `in.(${note20},${note45},${note70})` })).toEqual([]);
      expect(await w.rows(sara, "annotation_attachments", { room_id: `eq.${room}` })).toEqual([]);
      expect(await w.rows(sara, "annotation_reactions", { room_id: `eq.${room}` })).toEqual([]);
      expect(await w.rows(sara, "annotation_replies", { room_id: `eq.${room}` })).toEqual([]);
    });

    it("refuses the media bytes even when she knows the exact storage path", async () => {
      expect(await w.canReadObject(amir, "annotation-images", mediaPath())).toBe(true);
      expect(await w.canReadObject(sara, "annotation-images", mediaPath())).toBe(false);
      expect(await w.canReadObject(outsider, "annotation-images", mediaPath())).toBe(false);
      expect(await w.canReadObject(null, "annotation-images", mediaPath())).toBe(false);
    });

    it("does not let her reply or react her way into a locked note", async () => {
      await denied(w.rpc(sara, "add_reply", { p_marker_id: note20, p_body: "what is it?" }), "note_unavailable");
      await denied(w.rpc(sara, "toggle_reaction", { p_marker_id: note20, p_emoji: "👀" }), "note_unavailable");
    });

    it("keeps search, the Journey and her notifications spoiler-free", async () => {
      expect(await w.rpc(sara, "search_annotations", { p_room_id: room, p_query: "coming" })).toEqual([]);
      expect(await w.rpc(sara, "search_annotations", { p_room_id: room, p_query: "butler" })).toEqual([]);
      const journey = await w.rpc<{ moments: unknown[]; sections: unknown[]; totals: { notes: number } }>(sara, "room_journey", { p_room_id: room });
      expect(journey.moments).toEqual([]);
      expect(journey.sections).toEqual([]);
      expect(journey.totals.notes).toBe(3); // a count is fine; the contents are not
      const notifications = JSON.stringify(await w.rows(sara, "notifications"));
      expect(notifications).not.toMatch(/did NOT see|map|😱|example\.com/);
    });

    it("tells her how many things are waiting, without saying what", async () => {
      const detail = await w.rpc<{ waiting: number; unseen: number }>(sara, "room_detail", { p_room_id: room });
      expect(detail.waiting).toBe(3);
      expect(detail.unseen).toBe(0);
      expect(JSON.stringify(detail)).not.toMatch(/did NOT see|😱/);
    });

    it("cannot forge an unlock or fake her progress by writing tables directly", async () => {
      await denied(
        w.insert(sara, "reading_unlocks", { user_id: sara.id, marker_id: note70, room_id: room }),
        /permission denied/,
      );
      await denied(
        w.insert(sara, "reading_progress", { user_id: sara.id, room_id: room, book_id: book.id, position: 1, furthest: 1 }),
        /permission denied/,
      );
      await denied(w.update(sara, "reading_progress", { room_id: `eq.${room}` }, { furthest: 1 }), /permission denied/);
      await denied(w.update(sara, "annotation_markers", { id: `eq.${note70}` }, { author_id: sara.id }), /permission denied/);
      expect(await contentsFor(sara)).toEqual([]);
    });
  });

  // ------------------------------------------------------------ reaching
  describe("as Sara reads", () => {
    it("unlocks nothing while she is still short of the first note", async () => {
      const result = await w.read(sara, room, 0.1);
      expect(result.unlocked).toEqual([]);
      expect(result.first).toBe(true);
      expect(await contentsFor(sara)).toEqual([]);
    });

    it("unlocks exactly the first note when she reaches 20%", async () => {
      const result = await w.read(sara, room, 0.2);
      expect(result.unlocked).toEqual([note20]);

      const contents = await w.rows<{ marker_id: string; body: string; quote: string }>(sara, "annotation_contents", { room_id: `eq.${room}` });
      expect(contents).toHaveLength(1);
      expect(contents[0]).toMatchObject({ marker_id: note20, body: "I did NOT see that coming", quote: "The butler did it." });
      // Reactions on the unlocked note are now visible too.
      expect(await w.rows(sara, "annotation_reactions", { marker_id: `eq.${note20}` })).toHaveLength(1);
      // The other two stay sealed.
      expect(await w.rows(sara, "annotation_contents", { marker_id: `eq.${note45}` })).toEqual([]);
      expect(await w.canReadObject(sara, "annotation-images", mediaPath())).toBe(false);
    });

    it("tells Amir that Sara reached what he left — once, without noise", async () => {
      const unlocked = await w.rows<{ actor_id: string; data: { count: number } }>(amir, "notifications", { type: "eq.unlocked" });
      expect(unlocked).toHaveLength(1);
      expect(unlocked[0].actor_id).toBe(sara.id);
      expect(unlocked[0].data.count).toBe(1);
    });

    it("keeps the note unlocked when she flips back", async () => {
      const result = await w.read(sara, room, 0.03);
      expect(result.furthest).toBe(0.2);
      expect(result.unlocked).toEqual([]);
      expect(await contentsFor(sara)).toHaveLength(1);
      const [progress] = await w.rows<{ position: number; furthest: number }>(sara, "reading_progress", { room_id: `eq.${room}`, user_id: `eq.${sara.id}` });
      expect(progress).toMatchObject({ position: 0.03, furthest: 0.2 });
    });

    it("lets her reply in context, and Amir sees it", async () => {
      const replyId = await w.rpc<string>(sara, "add_reply", { p_marker_id: note20, p_body: "Neither did I!" });
      expect(replyId).toBeTruthy();
      const replies = await w.rows<{ body: string; author_id: string }>(amir, "annotation_replies", { marker_id: `eq.${note20}` });
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ body: "Neither did I!", author_id: sara.id });
      const notified = await w.rows<{ marker_id: string; data: Record<string, unknown> }>(amir, "notifications", { type: "eq.reply" });
      expect(notified).toHaveLength(1);
      expect(notified[0].marker_id).toBe(note20);
      expect(JSON.stringify(notified[0].data)).not.toContain("Neither"); // notifications never carry content
    });

    it("unlocks the second note — with its image — at 45%", async () => {
      const result = await w.read(sara, room, 0.45);
      expect(result.unlocked).toEqual([note45]);
      expect(await w.rows(sara, "annotation_attachments", { marker_id: `eq.${note45}` })).toHaveLength(1);
      expect(await w.canReadObject(sara, "annotation-images", mediaPath())).toBe(true);
      // Still not for outsiders or anonymous visitors.
      expect(await w.canReadObject(outsider, "annotation-images", mediaPath())).toBe(false);
      expect(await w.canReadObject(null, "annotation-images", mediaPath())).toBe(false);
    });

    it("still guards the 70% note", async () => {
      expect(await w.rows(sara, "annotation_contents", { marker_id: `eq.${note70}` })).toEqual([]);
      const journey = await w.rpc<{ moments: { marker_id: string }[] }>(sara, "room_journey", { p_room_id: room });
      expect(journey.moments.map((m) => m.marker_id)).toEqual([note20, note45]);
      const detail = await w.rpc<{ waiting: number; unseen: number }>(sara, "room_detail", { p_room_id: room });
      expect(detail).toMatchObject({ waiting: 1, unseen: 2 });
    });

    it("records that she opened a note, so 'new for you' can clear", async () => {
      await w.rpc(sara, "mark_annotations_seen", { p_marker_ids: [note20] });
      const detail = await w.rpc<{ unseen: number }>(sara, "room_detail", { p_room_id: room });
      expect(detail.unseen).toBe(1);
    });

    it("survives a 'refresh': unlock state is durable, not session state", async () => {
      const unlocks = await w.rows<{ marker_id: string; via: string }>(sara, "reading_unlocks", { room_id: `eq.${room}`, user_id: `eq.${sara.id}` });
      expect(unlocks.map((u) => u.marker_id).sort()).toEqual([note20, note45].sort());
      expect(unlocks.every((u) => u.via === "reached")).toBe(true);
    });
  });

  // ------------------------------------------------------------ edge cases
  describe("edges", () => {
    it("always lets an author read their own notes, reached or not", async () => {
      const own = await w.note(sara, room, 0.95, "Leaving this for later me");
      expect(await w.rows(sara, "annotation_contents", { marker_id: `eq.${own}` })).toHaveLength(1);
      // Amir (furthest 50%) can see the marker but not the content.
      expect(await w.rows(amir, "annotation_markers", { id: `eq.${own}` })).toHaveLength(1);
      expect(await w.rows(amir, "annotation_contents", { marker_id: `eq.${own}` })).toEqual([]);
    });

    it("hides drafts from everyone but their author until published", async () => {
      const draft = await w.note(amir, room, 0.05, "draft", { p_publish: false });
      expect(await w.rows(sara, "annotation_markers", { id: `eq.${draft}` })).toEqual([]);
      expect(await w.rows(amir, "annotation_markers", { id: `eq.${draft}` })).toHaveLength(1);
      await denied(w.rpc(sara, "publish_annotation", { p_marker_id: draft }), "not_allowed");
      await w.rpc(amir, "publish_annotation", { p_marker_id: draft });
      expect(await w.rows(sara, "annotation_markers", { id: `eq.${draft}` })).toHaveLength(1);
    });

    it("opens a note left *behind* a reader straight away, and tells them", async () => {
      // Sara's furthest is 45%; Amir now leaves something at 10%.
      const behind = await w.note(amir, room, 0.1, "Go back and look at this line");
      const contents = await w.rows(sara, "annotation_contents", { marker_id: `eq.${behind}` });
      expect(contents).toHaveLength(1);
      const [unlock] = await w.rows<{ via: string }>(sara, "reading_unlocks", { marker_id: `eq.${behind}`, user_id: `eq.${sara.id}` });
      expect(unlock.via).toBe("instant");
      const heads = await w.rows<{ marker_id: string }>(sara, "notifications", { type: "eq.note_behind" });
      expect(heads.map((n) => n.marker_id)).toContain(behind);
    });

    it("only the author can attach media, and only while drafting", async () => {
      const draft = await w.note(amir, room, 0.3, "with media", { p_publish: false });
      const path = `${room}/${draft}/clip.mp4`;
      // Someone else cannot upload into the author's draft…
      await denied(w.putObject(sara, "annotation-video", path, 100, "video/mp4"), /row-level security/);
      // …nor can the author upload under a different room's folder.
      await denied(w.putObject(amir, "annotation-video", `${crypto.randomUUID()}/${draft}/clip.mp4`, 100, "video/mp4"), /row-level security/);
      await w.putObject(amir, "annotation-video", path, 100, "video/mp4");
      await denied(
        w.insert(sara, "annotation_attachments", { marker_id: draft, room_id: room, kind: "video", bucket: "annotation-video", path, mime_type: "video/mp4", size_bytes: 100 }),
        /row-level security/,
      );
      await w.rpc(amir, "publish_annotation", { p_marker_id: draft });
      // Published: no more attachments.
      await denied(w.putObject(amir, "annotation-video", `${room}/${draft}/late.mp4`, 100, "video/mp4"), /row-level security/);
    });

    it("refuses an attachment whose kind, bucket or path do not line up", async () => {
      const draft = await w.note(amir, room, 0.31, "mismatch", { p_publish: false });
      await denied(
        w.insert(amir, "annotation_attachments", { marker_id: draft, room_id: room, kind: "image", bucket: "annotation-video", path: `${room}/${draft}/a.jpg`, mime_type: "image/jpeg", size_bytes: 10 }),
        /check constraint/,
      );
      await denied(
        w.insert(amir, "annotation_attachments", { marker_id: draft, room_id: room, kind: "image", bucket: "annotation-images", path: `${room}/${note70}/a.jpg`, mime_type: "image/jpeg", size_bytes: 10 }),
        /check constraint/,
      );
    });

    it("makes a removed note unreadable for everyone, including readers who had unlocked it", async () => {
      expect(await w.rows(sara, "annotation_contents", { marker_id: `eq.${note45}` })).toHaveLength(1);
      await denied(w.rpc(outsider, "remove_annotation", { p_marker_id: note45 }), "not_allowed");
      await w.rpc(amir, "remove_annotation", { p_marker_id: note45 });
      expect(await w.rows(sara, "annotation_contents", { marker_id: `eq.${note45}` })).toEqual([]);
      expect(await w.rows(sara, "annotation_markers", { id: `eq.${note45}` })).toEqual([]);
      expect(await w.canReadObject(sara, "annotation-images", mediaPath())).toBe(false);
      expect(await w.canReadObject(amir, "annotation-images", mediaPath())).toBe(false);
    });

    it("lets room staff remove someone else's note, and logs it", async () => {
      const bad = await w.note(sara, room, 0.4, "something inappropriate");
      await w.rpc(amir, "remove_annotation", { p_marker_id: bad, p_reason: "not ok" });
      expect(await w.rows(sara, "annotation_markers", { id: `eq.${bad}` })).toEqual([]);
      const log = await w.rows<{ target_marker_id: string; reason: string }>(amir, "moderation_actions", { action: "eq.remove_annotation" });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ target_marker_id: bad, reason: "not ok" });
      // A plain member cannot remove the owner's notes.
      await denied(w.rpc(sara, "remove_annotation", { p_marker_id: note70 }), "not_allowed");
    });

    it("takes everything away again when a reader leaves the room", async () => {
      const trio = await w.makeRoom(amir, book, { p_visibility: "open" });
      const leaver = await w.signUp("Leaver");
      await w.rpc(leaver, "join_open_room", { p_room_id: trio });
      const n = await w.note(amir, trio, 0.1, "hello");
      await w.read(leaver, trio, 0.5);
      expect(await w.rows(leaver, "annotation_contents", { marker_id: `eq.${n}` })).toHaveLength(1);
      await w.rpc(leaver, "leave_room", { p_room_id: trio });
      expect(await w.rows(leaver, "annotation_contents", { marker_id: `eq.${n}` })).toEqual([]);
      expect(await w.rows(leaver, "annotation_markers", { room_id: `eq.${trio}` })).toEqual([]);
    });

    it("rejects malformed notes", async () => {
      await denied(w.note(amir, room, 1.5, "out of range"), "invalid_location");
      await denied(w.note(amir, room, 0.5, "   "), "empty_note");
      await denied(w.note(amir, room, 0.5, "x", { p_link_url: "javascript:alert(1)" }), "invalid_link");
      await denied(w.rpc(amir, "add_reply", { p_marker_id: note20, p_body: "  " }), "invalid_reply");
    });

    it("only admits room members to the room's realtime presence channel", async () => {
      const topic = `room:${room}`;
      const canUse = (user: TestUser) =>
        w.db.asUser(
          user.claims,
          async (tx) => {
            await tx.query("insert into realtime.messages (topic, extension) values ($1, 'presence')", [topic]);
            const res = await tx.query("select 1 from realtime.messages where topic = $1", [topic]);
            return res.rows.length > 0;
          },
          { "realtime.topic": topic },
        );
      await expect(canUse(sara)).resolves.toBe(true);
      await denied(canUse(outsider), /row-level security/);
    });
  });
});

describe("progress and the group", () => {
  let w: World;
  let owner: TestUser;
  let readers: TestUser[];
  let book: TestBook;
  let room: string;

  beforeAll(async () => {
    w = await World.create();
    owner = await w.signUp("Owner");
    readers = [];
    for (const name of ["Sara", "Fahad", "Khalid", "Noor"]) readers.push(await w.signUp(name));
    book = await w.makeBook(owner);
    room = await w.makeRoom(owner, book, { p_visibility: "open", p_mode: "race" });
    for (const r of readers) await w.rpc(r, "join_open_room", { p_room_id: room });
  });
  afterAll(() => w.close());

  const activity = (type: string) => w.rows<{ actor_id: string; data: Record<string, unknown> }>(owner, "room_activity", { room_id: `eq.${room}`, type: `eq.${type}` });

  it("clamps positions into 0..1 and never moves furthest backwards", async () => {
    const [sara] = readers;
    expect((await w.read(sara, room, -3)).furthest).toBe(0);
    expect((await w.read(sara, room, 0.31)).furthest).toBe(0.31);
    expect((await w.read(sara, room, 0.1)).furthest).toBe(0.31);
    const over = await w.read(readers[3], room, 7);
    expect(over.furthest).toBe(1);
    expect(over.completed).toBe(false);
  });

  it("records meaningful activity only: start, milestones, finish — not page turns", async () => {
    const fahad = readers[1];
    for (const p of [0.01, 0.02, 0.03, 0.04, 0.05]) await w.read(fahad, room, p);
    await w.read(fahad, room, 0.26);
    await w.read(fahad, room, 0.27);
    const started = (await activity("started_reading")).filter((a) => a.actor_id === fahad.id);
    const milestones = (await activity("milestone")).filter((a) => a.actor_id === fahad.id);
    expect(started).toHaveLength(1);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].data.percent).toBe(25);
    // Seven saves, two activity rows.
    const all = (await w.rows<{ actor_id: string }>(owner, "room_activity", { room_id: `eq.${room}` })).filter((a) => a.actor_id === fahad.id && !["joined"].includes((a as { type?: string }).type ?? ""));
    expect(all).toHaveLength(2);
  });

  it("notes a completed chapter once, and ignores big table-of-contents jumps", async () => {
    const khalid = readers[2];
    await w.read(khalid, room, 0.02, { p_chapter_index: 0, p_chapter_label: "Chapter 1" });
    await w.read(khalid, room, 0.08, { p_chapter_index: 1, p_chapter_label: "Chapter 2" });
    await w.read(khalid, room, 0.09, { p_chapter_index: 1, p_chapter_label: "Chapter 2" });
    await w.read(khalid, room, 0.6, { p_chapter_index: 9, p_chapter_label: "Chapter 10" });
    const chapters = (await activity("chapter_completed")).filter((a) => a.actor_id === khalid.id);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].data.chapter).toBe("Chapter 1");
  });

  it("records a pass in Race mode", async () => {
    // Sara is at 0.31, Fahad at 0.27 → Fahad moves to 0.4 and passes Sara.
    const [sara, fahad] = readers;
    await w.read(fahad, room, 0.4);
    const passes = (await activity("passed")).filter((a) => a.actor_id === fahad.id);
    expect(passes.map((p) => p.data.passed_user_id)).toContain(sara.id);
  });

  it("does not turn two readers leap-frogging each other into a stream of events", async () => {
    const [sara, fahad] = readers; // Fahad 0.40, Sara 0.31
    for (const step of [0.41, 0.43, 0.45, 0.47]) {
      await w.read(sara, room, step);          // Sara overtakes Fahad…
      await w.read(fahad, room, step + 0.01);  // …and Fahad overtakes her back
    }
    const all = await activity("passed");
    expect(all.filter((a) => a.actor_id === sara.id && a.data.passed_user_id === fahad.id)).toHaveLength(1);
    expect(all.filter((a) => a.actor_id === fahad.id && a.data.passed_user_id === sara.id)).toHaveLength(1);
  });

  it("announces a finish to the room exactly once", async () => {
    const noor = readers[3];
    await w.owner("update public.reading_progress set coverage_sampled_at = now()-interval '300 seconds' where user_id=$1 and room_id=$2", [noor.id, room]);
    await w.rpc(noor, "record_reading_session", { p_room_id: room, p_samples: [{ id: crypto.randomUUID(), start: 0, end: 1, words: 600, seconds: 300, kind: "reading" }] });
    await w.read(noor, room, 1);
    await w.read(noor, room, 1);
    expect((await activity("finished")).filter((a) => a.actor_id === noor.id)).toHaveLength(1);
    const notified = await w.rows<{ actor_id: string }>(owner, "notifications", { type: "eq.finished" });
    expect(notified.filter((n) => n.actor_id === noor.id)).toHaveLength(1);
    // Nobody is notified about their own finish.
    expect(await w.rows(noor, "notifications", { type: "eq.finished" })).toEqual([]);
  });

  it("caps the reading time a single save can claim", async () => {
    const [sara] = readers;
    await w.read(sara, room, 0.32, { p_seconds: 999999 });
    const [row] = await w.owner<{ reading_seconds: number }>(
      "select reading_seconds from public.reading_progress where user_id = $1 and room_id = $2",
      [sara.id, room],
    );
    expect(row.reading_seconds).toBeLessThanOrEqual(300);
  });

  it("gives every member the whole group's positions, ordered by progress", async () => {
    const detail = await w.rpc<{ members: { user_id: string; furthest: number }[] }>(readers[0], "room_detail", { p_room_id: room });
    expect(detail.members).toHaveLength(5);
    const furthest = detail.members.map((m) => m.furthest);
    expect([...furthest].sort((a, b) => b - a)).toEqual(furthest);
  });

  it("aggregates many reached notes into one notification per author", async () => {
    const [sara, fahad] = readers;
    for (const p of [0.5, 0.52, 0.54, 0.56]) await w.note(owner, room, p, `note at ${p}`);
    // owner's furthest is 0, so notes are ahead of everyone but nobody is "behind" them yet
    const result = await w.read(sara, room, 0.6);
    expect(result.unlocked).toHaveLength(4);
    const forOwner = (await w.rows<{ actor_id: string; data: { count: number } }>(owner, "notifications", { type: "eq.unlocked" }))
      .filter((n) => n.actor_id === sara.id);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0].data.count).toBe(4);
    expect(fahad).toBeTruthy();
  });

  it("notifies the thread, not the whole room, about replies — and dedupes reactions", async () => {
    const [sara, fahad, khalid] = readers;
    const [first] = await w.rows<{ id: string }>(sara, "annotation_markers", { room_id: `eq.${room}`, order: "position.asc", limit: "1" });
    await w.read(fahad, room, 0.6);
    const before = (await w.rows(khalid, "notifications", { type: "eq.reply" })).length;

    await w.rpc(sara, "add_reply", { p_marker_id: first.id, p_body: "first reply" });
    await w.rpc(fahad, "add_reply", { p_marker_id: first.id, p_body: "second reply" });

    // Sara (in the thread) hears about Fahad's reply; Khalid (not in it) hears nothing.
    const saraReplies = await w.rows<{ actor_id: string }>(sara, "notifications", { type: "eq.reply" });
    expect(saraReplies.filter((n) => n.actor_id === fahad.id)).toHaveLength(1);
    expect((await w.rows(khalid, "notifications", { type: "eq.reply" })).length).toBe(before);
    // The author hears about both.
    const ownerReplies = await w.rows<{ marker_id: string }>(owner, "notifications", { type: "eq.reply" });
    expect(ownerReplies.filter((n) => n.marker_id === first.id)).toHaveLength(2);

    // Toggling a reaction on and off and on again yields a single unread notification.
    expect(await w.rpc(sara, "toggle_reaction", { p_marker_id: first.id, p_emoji: "❤️" })).toBe(true);
    expect(await w.rpc(sara, "toggle_reaction", { p_marker_id: first.id, p_emoji: "❤️" })).toBe(false);
    expect(await w.rpc(sara, "toggle_reaction", { p_marker_id: first.id, p_emoji: "❤️" })).toBe(true);
    const reactions = (await w.rows<{ actor_id: string; marker_id: string }>(owner, "notifications", { type: "eq.reaction" }))
      .filter((n) => n.actor_id === sara.id && n.marker_id === first.id);
    expect(reactions).toHaveLength(1);
  });

  it("persists notification read state and only ever for their owner", async () => {
    const list = await w.rpc<{ unread: number; items: { id: string }[] }>(owner, "list_notifications");
    expect(list.unread).toBeGreaterThan(0);
    expect(list.items.length).toBe(list.unread);

    // Someone else cannot read or mark the owner's notifications.
    expect(await w.rows(readers[0], "notifications", { user_id: `eq.${owner.id}` })).toEqual([]);
    await w.rpc(readers[0], "mark_notifications_read", { p_ids: [list.items[0].id] });
    expect((await w.rpc<{ unread: number }>(owner, "list_notifications")).unread).toBe(list.unread);

    await w.rpc(owner, "mark_notifications_read", { p_ids: [list.items[0].id] });
    expect((await w.rpc<{ unread: number }>(owner, "list_notifications")).unread).toBe(list.unread - 1);
    await w.rpc(owner, "mark_notifications_read");
    expect((await w.rpc<{ unread: number }>(owner, "list_notifications")).unread).toBe(0);
  });

  it("tells the owner when someone joins, and never notifies people about themselves", async () => {
    const joins = await w.rows<{ actor_id: string }>(owner, "notifications", { type: "eq.member_joined" });
    expect(joins.length).toBe(4);
    const self = await w.owner<{ n: number }>("select count(*)::int as n from public.notifications where user_id = actor_id");
    expect(self[0].n).toBe(0);
  });

  it("limits the Journey heat-map to the part of the book the viewer has read", async () => {
    const khalid = readers[2]; // furthest 0.6
    await w.note(owner, room, 0.9, "very late note");
    const journey = await w.rpc<{ sections: { bucket: number }[]; viewer_furthest: number }>(khalid, "room_journey", { p_room_id: room });
    expect(journey.viewer_furthest).toBe(0.6);
    expect(journey.sections.every((s) => s.bucket <= 12)).toBe(true);
    expect(journey.sections.length).toBeGreaterThan(0);
  });
});
