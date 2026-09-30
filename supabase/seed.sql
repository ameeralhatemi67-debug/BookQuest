-- Local development seed (applied by `supabase db reset` and by the local
-- emulator). NEVER run this against the hosted alpha project.
--
--   * Anyone signing up locally with the code LOCAL-ALPHA gets alpha access.
--   * admin@local.test becomes an alpha admin on sign-up.

insert into public.alpha_invite_codes (code, note, max_uses)
values ('LOCAL-ALPHA', 'Local development code', 1000)
on conflict (code) do nothing;

insert into public.alpha_allowlist (email, make_admin, note)
values ('admin@local.test', true, 'Local development admin')
on conflict (email) do nothing;
