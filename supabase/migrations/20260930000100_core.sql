-- =============================================================================
-- 0100 · Core: profiles, closed-alpha access, shared helpers
-- =============================================================================
-- Conventions used by every migration in this project:
--   * `public`  : tables + the RPC surface exposed through the Data API.
--   * `private` : security-definer helpers used by RLS policies and triggers.
--                 Not an exposed API schema, so nothing here is callable by RPC.
--   * Grants are explicit. We never rely on Supabase's default privileges.
--   * RPC errors are raised with short machine-readable messages
--     (e.g. 'room_full'); the app maps them to friendly copy.

create schema if not exists private;
grant usage on schema private to authenticated;

-- 64 hex chars / ~244 bits of randomness, no extension needed.
create function private.gen_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Casts text to uuid without throwing (used for storage paths / realtime topics).
create function private.safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ----------------------------------------------------------------------------
-- profiles: what other readers may see about a person
-- ----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  avatar_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- alpha_testers: closed-alpha access state (kept apart from the public profile)
-- ----------------------------------------------------------------------------
create table public.alpha_testers (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  is_admin      boolean not null default false,
  access_source text,
  activated_at  timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table public.alpha_invite_codes (
  code        text primary key check (code = upper(code) and char_length(code) between 6 and 40),
  note        text,
  max_uses    integer not null default 1 check (max_uses > 0),
  use_count   integer not null default 0 check (use_count >= 0),
  expires_at  timestamptz,
  disabled_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.alpha_allowlist (
  email      text primary key check (email = lower(email)),
  make_admin boolean not null default false,
  note       text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Access helpers (security definer so policies can consult alpha_testers
-- without exposing the table itself).
-- ----------------------------------------------------------------------------
create function private.is_alpha() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.alpha_testers t
    where t.user_id = (select auth.uid()) and t.status = 'active'
  );
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.alpha_testers t
    where t.user_id = (select auth.uid()) and t.status = 'active' and t.is_admin
  );
$$;

-- Atomically consumes one use of an alpha code. Returns false when the code is
-- unknown, disabled, expired or exhausted.
create function private.consume_alpha_code(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean := false;
begin
  update public.alpha_invite_codes c
     set use_count = c.use_count + 1
   where c.code = upper(btrim(p_code))
     and c.disabled_at is null
     and (c.expires_at is null or c.expires_at > now())
     and c.use_count < c.max_uses
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Creates the profile + alpha record for every new auth user.
-- Access is granted when the email is allowlisted or a valid alpha code was
-- supplied at sign-up (options.data.alpha_code); otherwise the tester is
-- 'pending' and sees the "enter your code" screen.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
  v_code   text;
  v_allow  public.alpha_allowlist%rowtype;
  v_status text := 'pending';
  v_admin  boolean := false;
  v_source text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), '');
  end if;
  v_name := left(coalesce(v_name, 'Reader'), 60);

  insert into public.profiles (id, display_name) values (new.id, v_name);

  select * into v_allow from public.alpha_allowlist a where a.email = lower(new.email);
  if found then
    v_status := 'active';
    v_admin := v_allow.make_admin;
    v_source := 'allowlist';
  else
    v_code := upper(btrim(coalesce(new.raw_user_meta_data ->> 'alpha_code', '')));
    if v_code <> '' and private.consume_alpha_code(v_code) then
      v_status := 'active';
      v_source := 'code:' || v_code;
    end if;
  end if;

  insert into public.alpha_testers (user_id, status, is_admin, access_source, activated_at)
  values (new.id, v_status, v_admin, v_source, case when v_status = 'active' then now() end);

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ----------------------------------------------------------------------------
-- RPC: alpha access
-- ----------------------------------------------------------------------------

-- The caller's own access state. Safe for pending users.
create function public.my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'avatar_path', p.avatar_path,
    'status', t.status,
    'is_admin', t.is_admin
  )
  from public.profiles p
  join public.alpha_testers t on t.user_id = p.id
  where p.id = (select auth.uid());
$$;

-- Lets a pending tester redeem an alpha code after sign-up.
create function public.redeem_alpha_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_code   text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select t.status into v_status from public.alpha_testers t where t.user_id = v_uid for update;
  if v_status is null then
    raise exception 'profile_missing';
  elsif v_status = 'active' then
    return jsonb_build_object('status', 'active');
  elsif v_status = 'disabled' then
    raise exception 'access_disabled';
  end if;

  if v_code = '' or not private.consume_alpha_code(v_code) then
    raise exception 'invalid_alpha_code';
  end if;

  update public.alpha_testers
     set status = 'active', access_source = 'code:' || v_code, activated_at = now()
   where user_id = v_uid;

  return jsonb_build_object('status', 'active');
end $$;

-- Lightweight "last seen" heartbeat (called at most once per session load).
create function public.touch_last_seen() returns void
language sql security definer set search_path = '' as $$
  update public.alpha_testers set last_seen_at = now()
   where user_id = (select auth.uid())
     and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.alpha_testers enable row level security;
alter table public.alpha_invite_codes enable row level security;
alter table public.alpha_allowlist enable row level security;

-- Testers can see each other's public profile (name + avatar). This is the
-- closed alpha's whole directory; there is no public exposure.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_alpha()));

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy alpha_testers_select on public.alpha_testers for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy alpha_codes_admin on public.alpha_invite_codes for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy alpha_allowlist_admin on public.alpha_allowlist for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.profiles, public.alpha_testers, public.alpha_invite_codes, public.alpha_allowlist
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_path) on public.profiles to authenticated;
grant select on public.alpha_testers to authenticated;
grant select, insert, update, delete on public.alpha_invite_codes, public.alpha_allowlist to authenticated;

-- Function EXECUTE grants for the whole project live in the final migration
-- (…0900_api_grants.sql) so there is exactly one place that defines the RPC surface.
