import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denied, World, type TestUser } from "./helpers";

describe("closed-alpha access", () => {
  let w: World;
  let amir: TestUser;
  let pending: TestUser;

  beforeAll(async () => {
    w = await World.create();
    amir = await w.signUp("Amir");
    pending = await w.signUp("Nocode", { code: null });
  });
  afterAll(() => w.close());

  it("grants access when a valid alpha code is supplied at sign-up", async () => {
    const access = await w.rpc<{ status: string; is_admin: boolean; display_name: string }>(amir, "my_access");
    expect(access).toMatchObject({ status: "active", is_admin: false, display_name: "Amir" });
  });

  it("leaves a tester without a code pending, with no access to anything", async () => {
    const access = await w.rpc<{ status: string }>(pending, "my_access");
    expect(access.status).toBe("pending");

    await denied(w.rpc(pending, "my_home"), "alpha_access_required");
    await denied(w.rpc(pending, "list_open_rooms"), "alpha_access_required");
    // A pending tester sees only their own profile, not the tester directory.
    const profiles = await w.rows(pending, "profiles");
    expect(profiles.map((p) => p.id)).toEqual([pending.id]);
    await denied(w.insert(pending, "books", { uploader_id: pending.id, title: "x", format: "epub" }), /row-level security/);
  });

  it("rejects an invalid code and accepts a valid one later", async () => {
    await denied(w.rpc(pending, "redeem_alpha_code", { p_code: "WRONG-CODE" }), "invalid_alpha_code");
    const result = await w.rpc<{ status: string }>(pending, "redeem_alpha_code", { p_code: " local-alpha " });
    expect(result.status).toBe("active");
    await expect(w.rpc(pending, "my_home")).resolves.toBeTruthy();
  });

  it("stops accepting a code once its uses are exhausted, expired or disabled", async () => {
    await w.owner("insert into public.alpha_invite_codes (code, max_uses) values ('ONCE-ONLY', 1)");
    const first = await w.signUp("First", { code: "ONCE-ONLY" });
    const second = await w.signUp("Second", { code: "ONCE-ONLY" });
    expect((await w.rpc<{ status: string }>(first, "my_access")).status).toBe("active");
    expect((await w.rpc<{ status: string }>(second, "my_access")).status).toBe("pending");

    await w.owner("insert into public.alpha_invite_codes (code, expires_at) values ('EXPIRED-1', now() - interval '1 day')");
    await w.owner("insert into public.alpha_invite_codes (code, disabled_at) values ('DISABLED-1', now())");
    await denied(w.rpc(second, "redeem_alpha_code", { p_code: "EXPIRED-1" }), "invalid_alpha_code");
    await denied(w.rpc(second, "redeem_alpha_code", { p_code: "DISABLED-1" }), "invalid_alpha_code");
  });

  it("makes an allowlisted email an admin without a code", async () => {
    const admin = await w.signUp("Admin", { code: null, email: "admin@local.test" });
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
    await denied(w.rpc(victim, "redeem_alpha_code", { p_code: "LOCAL-ALPHA" }), "access_disabled");

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
