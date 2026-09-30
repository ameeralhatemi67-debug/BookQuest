-- =============================================================================
-- Supabase compatibility layer for the local emulator and the database tests.
-- =============================================================================
-- This recreates just enough of what a hosted Supabase project provides *before*
-- our migrations run (roles, the auth/storage/realtime schemas and helpers), so
-- that the real files in supabase/migrations apply unchanged to PGlite.
-- It is never applied to a real Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema storage;
create schema realtime;
create schema extensions;
create schema emu;

grant usage on schema public, auth, storage, realtime to anon, authenticated, service_role;

-- Mirror Supabase's permissive default privileges, so our explicit REVOKE /
-- GRANT statements are exercised against the most permissive starting point.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  aud                 text not null default 'authenticated',
  role                text not null default 'authenticated',
  email               text unique,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_app_meta_data   jsonb not null default '{"provider": "email", "providers": ["email"]}'::jsonb,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  last_sign_in_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table auth.refresh_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  revoked    boolean not null default false,
  created_at timestamptz not null default now()
);

create table auth.one_time_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;

create function auth.email() returns text language sql stable as $$
  select auth.jwt() ->> 'email';
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;

-- ---------------------------------------------------------------- storage
create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text not null,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  user_metadata    jsonb,
  version          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)];
$$;

create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)];
$$;

create function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(storage.filename(name)), '.', 1));
$$;

grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------- realtime
create table realtime.messages (
  id          uuid not null default gen_random_uuid(),
  topic       text not null,
  extension   text not null,
  payload     jsonb,
  event       text,
  private     boolean default false,
  inserted_at timestamp not null default now(),
  updated_at  timestamp not null default now()
);

alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated, service_role;

create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

grant execute on function realtime.topic() to anon, authenticated, service_role;

create publication supabase_realtime;

-- ---------------------------------------------------------------- emulator
create table emu.schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- Row-change feed for the emulated "Postgres Changes". Only primary keys are
-- sent; the emulator re-reads each row under every subscriber's RLS, exactly
-- like Supabase Realtime authorizes changes per subscriber.
create function emu.notify_change() returns trigger language plpgsql security definer as $$
declare
  v_row  jsonb;
  v_pk   jsonb := '{}'::jsonb;
  v_col  text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  foreach v_col in array tg_argv loop
    v_pk := v_pk || jsonb_build_object(v_col, v_row -> v_col);
  end loop;
  perform pg_notify('emu_changes', jsonb_build_object('table', tg_table_name, 'type', tg_op, 'pk', v_pk)::text);
  return null;
end $$;
