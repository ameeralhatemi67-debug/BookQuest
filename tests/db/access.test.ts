import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denied, World, type TestUser } from "./helpers";

describe("open alpha access", () => {
  let w: World;
  let amir: TestUser;
  let pending: TestUser;

  beforeAll(async () => {
    w = await World.create();
    amir = await w.signUp("Amir", { code: null });
    // Fill every seat, so the next person waits.
    await w.owner("update public.app_settings set value = to_jsonb((select count(*) from public.alpha_testers where status = 'active')) where key = 'alpha_seats'");
    pending = await w.signUp("Late", { code: null });
  });
  afterAll(() => w.close());

  it("lets people in without any code while seats remain", async () => {
    const access = await w.rpc<{ status: string; is_admin: boolean; display_name: string }>(amir, "my_access");
    expect(access).toMatchObject({ status: "active", is_admin: false, display_name: "Amir" });
    const seats = await w.rpc<{ used: number; capacity: number }>(amir, "alpha_seats");
    expect(seats.used).toBe(seats.capacity);
  });

  it("starts with 75 seats", async () => {
    const fresh = await World.create();
    try {
      const reader = await fresh.signUp("First", { code: null });
      expect(await fresh.rpc(reader, "alpha_seats")).toEqual({ used: 1, capacity: 75 });
    } finally {
      await fresh.close();
    }
  });

  it("leaves a reader who arrives when the alpha is full waiting, with no access to anything", async () => {
    const access = await w.rpc<{ status: string }>(pending, "my_access");
    expect(access.status).toBe("pending");

    await denied(w.rpc(pending, "my_home"), "alpha_access_required");
    await denied(w.rpc(pending, "list_open_rooms"), "alpha_access_required");
    const profiles = await w.rows(pending, "profiles");
    expect(profiles.map((p) => p.id)).toEqual([pending.id]);
    await denied(w.insert(pending, "books", { uploader_id: pending.id, title: "x", format: "epub" }), /row-level security/);
    expect(await w.rpc(pending, "claim_alpha_seat")).toMatchObject({ status: "pending" });
  });

  it("gives a waiting reader the next free seat", async () => {
    await w.owner("update public.app_settings set value = to_jsonb(((value #>> '{}')::int) + 1) where key = 'alpha_seats'");
    expect(await w.rpc(pending, "claim_alpha_seat")).toEqual({ status: "active" });
    await expect(w.rpc(pending, "my_home")).resolves.toBeTruthy();
  });

  it("lets only an admin change the seat count, never above 75", async () => {
    const admin = await w.signUp("Seat Admin", { code: null, email: "admin@local.test" });
    await denied(w.rpc(amir, "admin_set_alpha_seats", { p_capacity: 10 }), "admin_required");
    await denied(w.rpc(admin, "admin_set_alpha_seats", { p_capacity: 76 }), "invalid_capacity");
    expect(await w.rpc(admin, "admin_set_alpha_seats", { p_capacity: 75 })).toMatchObject({ capacity: 75 });
  });

  it("makes an allowlisted email an admin", async () => {
    const [row] = await w.owner<{ id: string }>("select id from auth.users where email = 'admin@local.test'");
    const admin: TestUser = { id: row.id, name: "Admin", email: "admin@local.test", claims: { sub: row.id, role: "authenticated" } };
    expect(await w.rpc(admin, "my_access")).toMatchObject({ status: "active", is_admin: true });
    await expect(w.rpc(admin, "admin_overview")).resolves.toBeTruthy();
  });

  it("keeps admin functions and admin tables away from ordinary testers", async () => {
    await denied(w.rpc(amir, "admin_overview"), "admin_required");
    await denied(w.rpc(amir, "admin_list_testers"), "admin_required");
    await denied(w.rpc(amir, "admin_set_tester", { p_user_id: amir.id, p_is_admin: true }), "admin_required");
    expect(await w.rows(amir, "alpha_invite_codes")).toEqual([]);
    expect(await w.rows(amir, "alpha_allowlist")).toEqual([]);
    // Testers can see only their own access row, and cannot change it.
    const testers = await w.rows(amir, "alpha_testers");
    expect(testers.map((t) => t.user_id)).toEqual([amir.id]);
    await denied(w.update(amir, "alpha_testers", { user_id: `eq.${amir.id}` }, { is_admin: true }), /permission denied/);
  });

  it("gives anonymous visitors nothing at all", async () => {
    await denied(w.rpc(null, "my_home"), /permission denied/);
    await denied(w.rpc(null, "list_open_rooms"), /permission denied/);
    await denied(w.rpc(null, "preview_join", { p_token: "anything" }), /permission denied/);
    for (const table of ["profiles", "books", "rooms", "room_members", "annotation_markers", "annotation_contents", "notifications", "alpha_feedback"]) {
      await denied(w.rows(null, table), /permission denied/);
    }
  });

  it("cuts a disabled tester off immediately", async () => {
    const admin = (await w.owner<{ id: string }>("select id from auth.users where email = 'admin@local.test'"))[0];
    const adminUser: TestUser = { id: admin.id, name: "Admin", email: "admin@local.test", claims: { sub: admin.id, role: "authenticated" } };
    const victim = await w.signUp("Victim");
    await expect(w.rpc(victim, "my_home")).resolves.toBeTruthy();

    await w.rpc(adminUser, "admin_set_tester", { p_user_id: victim.id, p_status: "disabled" });
    await denied(w.rpc(victim, "my_home"), "alpha_access_required");
    await denied(w.rpc(victim, "claim_alpha_seat"), "access_disabled");

    // An admin cannot lock themself out.
    await denied(w.rpc(adminUser, "admin_set_tester", { p_user_id: adminUser.id, p_status: "disabled" }), "cannot_change_self");
  });

  it("lets a person edit only their own profile", async () => {
    const updated = await w.update(amir, "profiles", { id: `eq.${amir.id}` }, { display_name: "Amir K." });
    expect(updated[0].display_name).toBe("Amir K.");
    const other = await w.update(amir, "profiles", { id: `eq.${pending.id}` }, { display_name: "Hacked" });
    expect(other).toEqual([]);
  });
});
