import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denied, World, type TestBook, type TestUser } from "./helpers";

interface Preview {
  id: string;
  is_member: boolean;
  member_count: number;
  join_code?: string;
  my?: unknown;
  book: Record<string, unknown>;
}

describe("rooms: visibility, joining, invitations, roles", () => {
  let w: World;
  let owner: TestUser;
  let sara: TestUser;
  let fahad: TestUser;
  let outsider: TestUser;
  let book: TestBook;

  beforeAll(async () => {
    w = await World.create();
    owner = await w.signUp("Owner");
    sara = await w.signUp("Sara");
    fahad = await w.signUp("Fahad");
    outsider = await w.signUp("Outsider");
    book = await w.makeBook(owner);
  });
  afterAll(() => w.close());

  const memberRow = async (roomId: string, user: TestUser) =>
    (await w.owner<{ status: string; role: string }>(
      "select status, role from public.room_members where room_id = $1 and user_id = $2",
      [roomId, user.id],
    ))[0];

  // ---------------------------------------------------------------- creation
  describe("creation", () => {
    it("creates a room with its owner as the first member", async () => {
      const roomId = await w.makeRoom(owner, book, { p_name: "Dune, slowly" });
      expect(await memberRow(roomId, owner)).toEqual({ status: "active", role: "owner" });
      const detail = await w.rpc<{ name: string; my_role: string; members: unknown[] }>(owner, "room_detail", { p_room_id: roomId });
      expect(detail).toMatchObject({ name: "Dune, slowly", my_role: "owner" });
      expect(detail.members).toHaveLength(1);
    });

    it("forces a Private Duo to be private and capped at two", async () => {
      const roomId = await w.makeRoom(owner, book, { p_mode: "duo", p_visibility: "open", p_member_limit: 10 });
      const [room] = await w.owner("select visibility, member_limit, mode from public.rooms where id = $1", [roomId]);
      expect(room).toEqual({ visibility: "private", member_limit: 2, mode: "duo" });
    });

    it("refuses a book the creator cannot read, and invalid settings", async () => {
      await denied(w.makeRoom(outsider, book), "book_unavailable");
      await denied(w.makeRoom(owner, book, { p_visibility: "public" }), "invalid_room_settings");
      await denied(w.makeRoom(owner, book, { p_mode: "live" }), "invalid_room_settings");
      await denied(w.makeRoom(owner, book, { p_member_limit: 500 }), "invalid_room_settings");
    });

    it("does not allow rooms or memberships to be written directly", async () => {
      await denied(w.insert(sara, "rooms", { name: "x", book_id: book.id, owner_id: sara.id }), /permission denied/);
      const roomId = await w.makeRoom(owner, book);
      await denied(w.insert(sara, "room_members", { room_id: roomId, user_id: sara.id }), /permission denied/);
      await denied(w.insert(sara, "room_invites", { room_id: roomId, created_by: sara.id }), /permission denied/);
      await denied(w.update(owner, "rooms", { id: `eq.${roomId}` }, { visibility: "open" }), /permission denied/);
    });
  });

  // ---------------------------------------------------------------- visibility
  describe("visibility really changes discovery and authorization", () => {
    let privateRoom: string;
    let unlistedRoom: string;
    let openRoom: string;

    beforeAll(async () => {
      privateRoom = await w.makeRoom(owner, book, { p_name: "Private", p_visibility: "private" });
      unlistedRoom = await w.makeRoom(owner, book, { p_name: "Unlisted", p_visibility: "unlisted" });
      openRoom = await w.makeRoom(owner, book, { p_name: "Open", p_visibility: "open", p_description: "Everyone welcome" });
    });

    it("lists only Open rooms in the directory", async () => {
      const listed = await w.rpc<Preview[]>(outsider, "list_open_rooms");
      const ids = listed.map((r) => r.id);
      expect(ids).toContain(openRoom);
      expect(ids).not.toContain(privateRoom);
      expect(ids).not.toContain(unlistedRoom);
    });

    it("exposes only Open rooms through the rooms table to non-members", async () => {
      const visible = (await w.rows(outsider, "rooms")).map((r) => r.id);
      expect(visible).toContain(openRoom);
      expect(visible).not.toContain(privateRoom);
      expect(visible).not.toContain(unlistedRoom);
    });

    it("gives a non-member a preview of an Open room but no member-only data", async () => {
      const preview = await w.rpc<Preview>(outsider, "room_detail", { p_room_id: openRoom });
      expect(preview.is_member).toBe(false);
      expect(preview.member_count).toBe(1);
      expect(preview.book.title).toBe("Test Book");
      expect(preview).not.toHaveProperty("join_code");
      expect(preview).not.toHaveProperty("my");
      expect(preview).not.toHaveProperty("waiting");
      // No progress rows, activity or markers for a non-member.
      expect(await w.rows(outsider, "reading_progress", { room_id: `eq.${openRoom}` })).toEqual([]);
      expect(await w.rows(outsider, "room_activity", { room_id: `eq.${openRoom}` })).toEqual([]);
      expect(await w.rows(outsider, "annotation_markers", { room_id: `eq.${openRoom}` })).toEqual([]);
    });

    it("does not admit that private or unlisted rooms exist", async () => {
      await denied(w.rpc(outsider, "room_detail", { p_room_id: privateRoom }), "room_not_found");
      await denied(w.rpc(outsider, "room_detail", { p_room_id: unlistedRoom }), "room_not_found");
      expect(await w.rows(outsider, "room_members", { room_id: `eq.${privateRoom}` })).toEqual([]);
      expect(await w.rows(outsider, "room_members", { room_id: `eq.${unlistedRoom}` })).toEqual([]);
      await denied(w.rpc(outsider, "room_journey", { p_room_id: privateRoom }), "room_not_found");
    });

    it("lets any tester join an Open room from the directory", async () => {
      const result = await w.rpc<{ status: string }>(sara, "join_open_room", { p_room_id: openRoom });
      expect(result.status).toBe("joined");
      expect(await memberRow(openRoom, sara)).toEqual({ status: "active", role: "member" });
    });

    it("refuses directory-joins for private and unlisted rooms", async () => {
      await denied(w.rpc(outsider, "join_open_room", { p_room_id: privateRoom }), "room_not_open");
      await denied(w.rpc(outsider, "join_open_room", { p_room_id: unlistedRoom }), "room_not_open");
    });

    it("lets a tester holding the room link join an Unlisted room — but never a Private one", async () => {
      const codes = await w.owner<{ id: string; join_code: string }>(
        "select id, join_code from public.rooms where id in ($1, $2)",
        [privateRoom, unlistedRoom],
      );
      const privateCode = codes.find((c) => c.id === privateRoom)!.join_code;
      const unlistedCode = codes.find((c) => c.id === unlistedRoom)!.join_code;

      await denied(w.rpc(fahad, "join_with_token", { p_token: privateCode }), "invite_not_found");
      expect((await w.rpc<{ state: string }>(fahad, "preview_join", { p_token: privateCode })).state).toBe("not_found");

      const preview = await w.rpc<{ state: string; room: { name: string } }>(fahad, "preview_join", { p_token: unlistedCode });
      expect(preview).toMatchObject({ state: "ok", room: { name: "Unlisted" } });
      expect((await w.rpc<{ status: string }>(fahad, "join_with_token", { p_token: unlistedCode })).status).toBe("joined");
    });

    it("only shows the room link to members, and only for non-private rooms", async () => {
      const unlisted = await w.rpc<Preview>(fahad, "room_detail", { p_room_id: unlistedRoom });
      expect(unlisted.join_code).toBeTruthy();
      const priv = await w.rpc<Preview>(owner, "room_detail", { p_room_id: privateRoom });
      expect(priv.join_code ?? null).toBeNull();
    });

    it("kills old links when the owner rotates the room link", async () => {
      const [{ join_code: before }] = await w.owner<{ join_code: string }>("select join_code from public.rooms where id = $1", [unlistedRoom]);
      await denied(w.rpc(fahad, "rotate_join_code", { p_room_id: unlistedRoom }), "not_allowed");
      const after = await w.rpc<string>(owner, "rotate_join_code", { p_room_id: unlistedRoom });
      expect(after).not.toBe(before);
      await denied(w.rpc(outsider, "join_with_token", { p_token: before }), "invite_not_found");
    });
  });

  // ---------------------------------------------------------------- invitations
  describe("invitations", () => {
    let roomId: string;
    beforeAll(async () => {
      roomId = await w.makeRoom(owner, book, { p_name: "Invite only" });
    });

    it("joins with a valid invitation and consumes it", async () => {
      const invite = await w.rpc<{ id: string; token: string }>(owner, "create_invite", { p_room_id: roomId });
      const preview = await w.rpc<{ state: string; inviter: { display_name: string } }>(sara, "preview_join", { p_token: invite.token });
      expect(preview).toMatchObject({ state: "ok", inviter: { display_name: "Owner" } });

      expect((await w.rpc<{ status: string }>(sara, "join_with_token", { p_token: invite.token })).status).toBe("joined");
      await denied(w.rpc(fahad, "join_with_token", { p_token: invite.token }), "invite_used_up");
      expect((await w.rpc<{ state: string }>(fahad, "preview_join", { p_token: invite.token })).state).toBe("used_up");
    });

    it("never creates a duplicate membership or burns an invite when already a member", async () => {
      const invite = await w.rpc<{ id: string; token: string }>(owner, "create_invite", { p_room_id: roomId, p_max_uses: 5 });
      const again = await w.rpc<{ status: string }>(sara, "join_with_token", { p_token: invite.token });
      expect(again.status).toBe("already_member");
      const [{ n }] = await w.owner<{ n: number }>(
        "select count(*)::int as n from public.room_members where room_id = $1 and user_id = $2",
        [roomId, sara.id],
      );
      expect(n).toBe(1);
      const [{ use_count }] = await w.owner<{ use_count: number }>("select use_count from public.room_invites where id = $1", [invite.id]);
      expect(use_count).toBe(0);
    });

    it("rejects unknown, revoked and expired invitations with distinct errors", async () => {
      await denied(w.rpc(fahad, "join_with_token", { p_token: "no-such-token" }), "invite_not_found");

      const revoked = await w.rpc<{ id: string; token: string }>(owner, "create_invite", { p_room_id: roomId });
      await w.rpc(owner, "revoke_invite", { p_invite_id: revoked.id });
      await denied(w.rpc(fahad, "join_with_token", { p_token: revoked.token }), "invite_revoked");
      expect((await w.rpc<{ state: string }>(fahad, "preview_join", { p_token: revoked.token })).state).toBe("revoked");

      const expired = await w.rpc<{ id: string; token: string }>(owner, "create_invite", { p_room_id: roomId });
      await w.owner("update public.room_invites set expires_at = now() - interval '1 minute' where id = $1", [expired.id]);
      await denied(w.rpc(fahad, "join_with_token", { p_token: expired.token }), "invite_expired");
      const preview = await w.rpc<Record<string, unknown>>(fahad, "preview_join", { p_token: expired.token });
      expect(preview.state).toBe("expired");
      expect(preview).not.toHaveProperty("room"); // an unusable link reveals nothing about the room
    });

    it("honours an invitation addressed to one specific tester", async () => {
      const invite = await w.rpc<{ token: string }>(owner, "create_invite", { p_room_id: roomId, p_invited_user_id: fahad.id });
      await denied(w.rpc(outsider, "join_with_token", { p_token: invite.token }), "invite_not_for_you");
      expect((await w.rpc<{ status: string }>(fahad, "join_with_token", { p_token: invite.token })).status).toBe("joined");

      const invited = await w.rows(fahad, "notifications", { type: "eq.invited" });
      expect(invited).toHaveLength(1);
      expect(invited[0].room_id).toBe(roomId);
    });

    it("only lets room staff create, see and revoke invitations", async () => {
      await denied(w.rpc(sara, "create_invite", { p_room_id: roomId }), "not_allowed");
      await denied(w.rpc(outsider, "create_invite", { p_room_id: roomId }), "not_allowed");
      const invite = await w.rpc<{ id: string }>(owner, "create_invite", { p_room_id: roomId });
      await denied(w.rpc(sara, "revoke_invite", { p_invite_id: invite.id }), "not_allowed");
      expect(await w.rows(sara, "room_invites", { room_id: `eq.${roomId}` })).toEqual([]);
      expect((await w.rows(owner, "room_invites", { room_id: `eq.${roomId}` })).length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------- capacity & closing
  describe("capacity and closing", () => {
    it("never lets a Duo have a third reader", async () => {
      const duo = await w.makeRoom(owner, book, { p_mode: "duo" });
      await w.inviteAndJoin(owner, duo, sara);
      const invite = await w.rpc<{ token: string }>(owner, "create_invite", { p_room_id: duo });
      expect((await w.rpc<{ state: string }>(fahad, "preview_join", { p_token: invite.token })).state).toBe("full");
      await denied(w.rpc(fahad, "join_with_token", { p_token: invite.token }), "room_full");
    });

    it("enforces a configured member limit on open rooms", async () => {
      const room = await w.makeRoom(owner, book, { p_visibility: "open", p_member_limit: 2 });
      await w.rpc(sara, "join_open_room", { p_room_id: room });
      await denied(w.rpc(fahad, "join_open_room", { p_room_id: room }), "room_full");
      // The owner cannot shrink the limit below the people already there.
      await w.rpc(owner, "update_room", { p_room_id: room, p_member_limit: 3 });
      await w.rpc(fahad, "join_open_room", { p_room_id: room });
      await denied(w.rpc(owner, "update_room", { p_room_id: room, p_member_limit: 2 }), "limit_below_member_count");
    });

    it("blocks every way in once a room is closed to new members", async () => {
      const room = await w.makeRoom(owner, book, { p_visibility: "open" });
      const invite = await w.rpc<{ token: string }>(owner, "create_invite", { p_room_id: room });
      await w.rpc(owner, "update_room", { p_room_id: room, p_is_closed: true });
      await denied(w.rpc(sara, "join_open_room", { p_room_id: room }), "room_closed");
      await denied(w.rpc(sara, "join_with_token", { p_token: invite.token }), "room_closed");
      await w.rpc(owner, "update_room", { p_room_id: room, p_is_closed: false });
      expect((await w.rpc<{ status: string }>(sara, "join_open_room", { p_room_id: room })).status).toBe("joined");
    });

    it("blocks joining and new notes in an archived room", async () => {
      const room = await w.makeRoom(owner, book, { p_visibility: "open" });
      await w.rpc(owner, "set_room_archived", { p_room_id: room, p_archived: true });
      await denied(w.rpc(sara, "join_open_room", { p_room_id: room }), /room_archived|room_not_open/);
      await denied(w.note(owner, room, 0.1, "too late"), "room_archived");
      const listed = await w.rpc<Preview[]>(sara, "list_open_rooms");
      expect(listed.map((r) => r.id)).not.toContain(room);
    });
  });

  // ---------------------------------------------------------------- leaving & removal
  describe("leaving, re-joining and removal", () => {
    it("keeps one membership row and the reading history across leave / re-join", async () => {
      const room = await w.makeRoom(owner, book, { p_visibility: "open" });
      await w.rpc(sara, "join_open_room", { p_room_id: room });
      await w.read(sara, room, 0.4);

      await w.rpc(sara, "leave_room", { p_room_id: room });
      expect((await memberRow(room, sara)).status).toBe("left");
      // Gone means gone: no more room data.
      expect(await w.rows(sara, "reading_progress", { room_id: `eq.${room}` })).toEqual([]);
      await denied(w.read(sara, room, 0.5), "not_a_member");

      const again = await w.rpc<{ status: string }>(sara, "join_open_room", { p_room_id: room });
      expect(again.status).toBe("joined");
      const [{ n }] = await w.owner<{ n: number }>(
        "select count(*)::int as n from public.room_members where room_id = $1 and user_id = $2",
        [room, sara.id],
      );
      expect(n).toBe(1);
      const progress = await w.rows<{ furthest: number }>(sara, "reading_progress", { room_id: `eq.${room}`, user_id: `eq.${sara.id}` });
      expect(progress[0].furthest).toBe(0.4);
    });

    it("keeps a removed member out of link/open joins until staff invite them back", async () => {
      const room = await w.makeRoom(owner, book, { p_visibility: "open" });
      await w.rpc(sara, "join_open_room", { p_room_id: room });
      const staleInvite = await w.rpc<{ token: string }>(owner, "create_invite", { p_room_id: room, p_max_uses: 5 });

      await w.rpc(owner, "remove_member", { p_room_id: room, p_user_id: sara.id, p_reason: "testing" });
      expect((await memberRow(room, sara)).status).toBe("removed");
      await denied(w.rpc(sara, "join_open_room", { p_room_id: room }), "removed_from_room");
      // An invitation minted *before* the removal does not bring them back…
      await denied(w.rpc(sara, "join_with_token", { p_token: staleInvite.token }), "removed_from_room");
      // …a fresh one does.
      const fresh = await w.rpc<{ token: string }>(owner, "create_invite", { p_room_id: room });
      expect((await w.rpc<{ status: string }>(sara, "join_with_token", { p_token: fresh.token })).status).toBe("joined");

      const log = await w.rows(owner, "moderation_actions", { room_id: `eq.${room}`, action: "eq.remove_member" });
      expect(log).toHaveLength(1);
      expect(log[0].target_user_id).toBe(sara.id);
      expect((await w.rows(sara, "notifications", { type: "eq.removed", room_id: `eq.${room}` }))).toHaveLength(1);
    });

    it("does not let the owner walk out on a room with people in it", async () => {
      const room = await w.makeRoom(owner, book, { p_visibility: "open" });
      await w.rpc(sara, "join_open_room", { p_room_id: room });
      await denied(w.rpc(owner, "leave_room", { p_room_id: room }), "owner_must_transfer");

      await w.rpc(owner, "transfer_ownership", { p_room_id: room, p_user_id: sara.id });
      expect((await memberRow(room, sara)).role).toBe("owner");
      expect((await memberRow(room, owner)).role).toBe("moderator");
      await w.rpc(owner, "leave_room", { p_room_id: room });
      expect((await memberRow(room, owner)).status).toBe("left");
    });

    it("archives a room when its last member leaves", async () => {
      const room = await w.makeRoom(owner, book);
      const result = await w.rpc<{ archived: boolean }>(owner, "leave_room", { p_room_id: room });
      expect(result.archived).toBe(true);
      const [{ archived }] = await w.owner<{ archived: boolean }>("select archived_at is not null as archived from public.rooms where id = $1", [room]);
      expect(archived).toBe(true);
    });
  });

  // ---------------------------------------------------------------- roles
  describe("roles", () => {
    let room: string;
    let mod: TestUser;
    let member: TestUser;

    beforeAll(async () => {
      mod = await w.signUp("Mod");
      member = await w.signUp("Member");
      room = await w.makeRoom(owner, book, { p_visibility: "open" });
      await w.rpc(mod, "join_open_room", { p_room_id: room });
      await w.rpc(member, "join_open_room", { p_room_id: room });
      await w.rpc(owner, "set_member_role", { p_room_id: room, p_user_id: mod.id, p_role: "moderator" });
    });

    it("lets only the owner assign moderators", async () => {
      await denied(w.rpc(mod, "set_member_role", { p_room_id: room, p_user_id: member.id, p_role: "moderator" }), "not_allowed");
      await denied(w.rpc(member, "set_member_role", { p_room_id: room, p_user_id: member.id, p_role: "moderator" }), "not_allowed");
      await denied(w.rpc(owner, "set_member_role", { p_room_id: room, p_user_id: member.id, p_role: "owner" }), "not_allowed");
      expect((await w.rows(mod, "notifications", { type: "eq.role_changed" }))).toHaveLength(1);
    });

    it("lets a moderator handle members and invitations, but not room settings", async () => {
      await expect(w.rpc(mod, "create_invite", { p_room_id: room })).resolves.toBeTruthy();
      await expect(w.rpc(mod, "update_room", { p_room_id: room, p_is_closed: true })).resolves.toBeNull();
      await w.rpc(mod, "update_room", { p_room_id: room, p_is_closed: false });
      await denied(w.rpc(mod, "update_room", { p_room_id: room, p_visibility: "private" }), "not_allowed");
      await denied(w.rpc(mod, "update_room", { p_room_id: room, p_name: "Mine now" }), "not_allowed");
      await denied(w.rpc(mod, "set_room_archived", { p_room_id: room, p_archived: true }), "not_allowed");
    });

    it("protects staff from each other and members from members", async () => {
      await denied(w.rpc(mod, "remove_member", { p_room_id: room, p_user_id: owner.id }), "not_allowed");
      await denied(w.rpc(member, "remove_member", { p_room_id: room, p_user_id: mod.id }), "not_allowed");
      const mod2 = await w.signUp("Mod2");
      await w.rpc(mod2, "join_open_room", { p_room_id: room });
      await w.rpc(owner, "set_member_role", { p_room_id: room, p_user_id: mod2.id, p_role: "moderator" });
      await denied(w.rpc(mod, "remove_member", { p_room_id: room, p_user_id: mod2.id }), "not_allowed");
      // A moderator can remove an ordinary member.
      await expect(w.rpc(mod, "remove_member", { p_room_id: room, p_user_id: member.id })).resolves.toBeNull();
    });

    it("keeps outsiders from touching a room by guessing its id", async () => {
      for (const [fn, args] of [
        ["update_room", { p_room_id: room, p_name: "pwned" }],
        ["set_room_archived", { p_room_id: room, p_archived: true }],
        ["remove_member", { p_room_id: room, p_user_id: mod.id }],
        ["create_invite", { p_room_id: room }],
        ["rotate_join_code", { p_room_id: room }],
        ["transfer_ownership", { p_room_id: room, p_user_id: outsider.id }],
      ] as const) {
        await denied(w.rpc(outsider, fn, args), "not_allowed");
      }
      await denied(w.read(outsider, room, 0.5), "not_a_member");
      await denied(w.note(outsider, room, 0.5, "hi"), "not_a_member");
    });
  });

  // ---------------------------------------------------------------- home
  it("shows each tester exactly their own rooms on Home", async () => {
    const stranger = await w.signUp("Stranger");
    const home = await w.rpc<{ rooms: unknown[]; books: unknown[] }>(stranger, "my_home");
    expect(home.rooms).toEqual([]);
    expect(home.books).toEqual([]);
    const mine = await w.rpc<{ rooms: { id: string }[]; books: { id: string }[] }>(owner, "my_home");
    expect(mine.rooms.length).toBeGreaterThan(3);
    expect(mine.books.map((b) => b.id)).toEqual([book.id]);
  });
});
