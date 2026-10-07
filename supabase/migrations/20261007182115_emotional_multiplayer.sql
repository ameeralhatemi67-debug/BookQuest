-- =============================================================================
-- Emotional multiplayer reading
-- =============================================================================
-- Open alpha (75 seats, no code), 75-reader rooms, per-room feature toggles,
-- sealed predictions, spoiler-safe polls, "open when you get here" packages,
-- five note attention levels, room rituals, chapter afterparties, progress
-- history, the return summary, reading echoes, ratings and the ending vault.
--
-- Every new table is closed to clients (no grants). Reads go through
-- security-definer read models that strip anything the caller has not reached,
-- and writes go through checked RPCs. Live freshness comes from Broadcast hints
-- on the room channel plus room_activity, never from publishing these tables.

-- ----------------------------------------------------------------------------
-- 1. Open alpha with a seat limit
-- ----------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
insert into public.app_settings (key, value) values ('alpha_seats', '75'::jsonb);

create function private.alpha_capacity() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'alpha_seats'), 75);
$$;

create function private.alpha_seats_used() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.alpha_testers t where t.status = 'active';
$$;

-- Sign-up no longer needs a code: the first readers up to the seat limit are
-- let in, everyone after waits for a seat (or an admin).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
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
    -- Serialize seat claims so simultaneous sign-ups cannot overfill the alpha.
    perform pg_advisory_xact_lock(7531);
    if private.alpha_seats_used() < private.alpha_capacity() then
      v_status := 'active';
      v_source := 'open';
    end if;
  end if;

  insert into public.alpha_testers (user_id, status, is_admin, access_source, activated_at)
  values (new.id, v_status, v_admin, v_source, case when v_status = 'active' then now() end);
  return new;
end $$;

create function public.alpha_seats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('used', private.alpha_seats_used(), 'capacity', private.alpha_capacity());
$$;

-- A waiting reader takes a seat the moment one is free.
create function public.claim_alpha_seat() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(7531);
  select t.status into v_status from public.alpha_testers t where t.user_id = v_uid for update;
  if v_status is null then
    raise exception 'profile_missing';
  elsif v_status = 'disabled' then
    raise exception 'access_disabled';
  elsif v_status = 'active' then
    return jsonb_build_object('status', 'active');
  end if;
  if private.alpha_seats_used() >= private.alpha_capacity() then
    return jsonb_build_object('status', 'pending', 'used', private.alpha_seats_used(), 'capacity', private.alpha_capacity());
  end if;
  update public.alpha_testers set status = 'active', access_source = 'open', activated_at = now() where user_id = v_uid;
  return jsonb_build_object('status', 'active');
end $$;

create function public.admin_set_alpha_seats(p_capacity integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  if p_capacity is null or p_capacity not between 1 and 75 then
    raise exception 'invalid_capacity';
  end if;
  insert into public.app_settings (key, value, updated_at) values ('alpha_seats', to_jsonb(p_capacity), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return public.alpha_seats();
end $$;

-- ----------------------------------------------------------------------------
-- 2. Rooms hold up to 75 readers; per-room feature toggles
-- ----------------------------------------------------------------------------
alter table public.rooms drop constraint rooms_member_limit_check;
alter table public.rooms add constraint rooms_member_limit_check check (member_limit is null or member_limit between 2 and 75);

create or replace function private.room_capacity(p_limit integer) returns integer
language sql immutable set search_path = '' as $$
  select coalesce(p_limit, 75);
$$;

-- Missing keys mean "on": every room starts with everything.
alter table public.rooms add column features jsonb not null default '{}'::jsonb
  check (jsonb_typeof(features) = 'object');

create function private.room_feature(p_room_id uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (r.features ->> p_key)::boolean from public.rooms r where r.id = p_room_id), true);
$$;

create function private.require_feature(p_room_id uuid, p_key text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.room_feature(p_room_id, p_key) then
    raise exception 'feature_off';
  end if;
end $$;

create function public.set_room_features(p_room_id uuid, p_features jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_keys text[] := array['predictions', 'polls', 'packages', 'soundtrack', 'animated_notes', 'afterparty', 'book_map',
                         'friend_lens', 'reaction_weather', 'live_ghosts', 'echoes', 'rituals', 'vault', 'away_summary', 'race'];
  v_next jsonb;
  k      text;
begin
  if not (coalesce(private.room_role(p_room_id) in ('owner', 'moderator'), false) or private.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'object' then
    raise exception 'invalid_features';
  end if;
  for k in select jsonb_object_keys(p_features) loop
    if not (k = any (v_keys)) or jsonb_typeof(p_features -> k) <> 'boolean' then
      raise exception 'invalid_features';
    end if;
  end loop;
  update public.rooms set features = features || p_features where id = p_room_id returning features into v_next;
  if not found then
    raise exception 'room_not_found';
  end if;
  perform private.log_activity(p_room_id, v_uid, 'room_updated', jsonb_build_object('changes', jsonb_build_array('features')));
  return v_next;
end $$;

create or replace function public.create_room(
  p_name text,
  p_book_id uuid,
  p_description text default null,
  p_visibility text default 'private',
  p_mode text default 'chill',
  p_member_limit integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := private.require_alpha();
  v_room_id    uuid;
  v_visibility text := coalesce(p_visibility, 'private');
  v_mode       text := coalesce(p_mode, 'chill');
  v_limit      integer := p_member_limit;
begin
  if v_visibility not in ('private', 'unlisted', 'open')
     or v_mode not in ('chill', 'race', 'duo')
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or (v_limit is not null and v_limit not between 2 and 75) then
    raise exception 'invalid_room_settings';
  end if;

  if not exists (select 1 from public.books b where b.id = p_book_id and b.status = 'ready')
     or not private.can_read_book(p_book_id) then
    raise exception 'book_unavailable';
  end if;

  if v_mode = 'duo' then
    v_visibility := 'private';
    v_limit := 2;
  end if;

  insert into public.rooms (name, description, book_id, owner_id, visibility, mode, member_limit)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_book_id, v_uid, v_visibility, v_mode, v_limit)
  returning id into v_room_id;

  insert into public.room_members (room_id, user_id, role, joined_via)
  values (v_room_id, v_uid, 'owner', 'created');

  perform private.log_activity(v_room_id, v_uid, 'room_created');
  return v_room_id;
end $$;

create or replace function public.update_room(
  p_room_id uuid,
  p_name text default null,
  p_description text default null,
  p_visibility text default null,
  p_mode text default null,
  p_member_limit integer default null,
  p_clear_member_limit boolean default false,
  p_is_closed boolean default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_alpha();
  v_role    text := private.room_role(p_room_id);
  v_room    public.rooms%rowtype;
  v_count   integer;
  v_name    text;
  v_desc    text;
  v_vis     text;
  v_mode    text;
  v_limit   integer;
  v_closed  boolean;
  v_changes text[] := '{}';
  r         record;
begin
  if v_role is null or v_role not in ('owner', 'moderator') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.archived_at is not null then
    raise exception 'room_archived';
  end if;

  if v_role <> 'owner' and (
       p_name is not null or p_description is not null or p_visibility is not null
       or p_mode is not null or p_member_limit is not null or p_clear_member_limit
     ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_name   := coalesce(nullif(btrim(p_name), ''), v_room.name);
  v_desc   := case when p_description is null then v_room.description else nullif(btrim(p_description), '') end;
  v_vis    := coalesce(p_visibility, v_room.visibility);
  v_mode   := coalesce(p_mode, v_room.mode);
  v_limit  := case when p_clear_member_limit then null else coalesce(p_member_limit, v_room.member_limit) end;
  v_closed := coalesce(p_is_closed, v_room.is_closed);

  if v_vis not in ('private', 'unlisted', 'open')
     or v_mode not in ('chill', 'race', 'duo')
     or char_length(v_name) > 80
     or (v_desc is not null and char_length(v_desc) > 500)
     or (v_limit is not null and v_limit not between 2 and 75) then
    raise exception 'invalid_room_settings';
  end if;

  v_count := private.active_member_count(p_room_id);

  if v_mode = 'duo' then
    if v_count > 2 then
      raise exception 'too_many_members_for_duo';
    end if;
    v_vis := 'private';
    v_limit := 2;
  elsif v_room.mode = 'duo' and p_member_limit is null and not p_clear_member_limit then
    v_limit := null;
  end if;

  if v_limit is not null and v_limit < v_count then
    raise exception 'limit_below_member_count';
  end if;

  if v_name is distinct from v_room.name then v_changes := array_append(v_changes, 'name'); end if;
  if v_desc is distinct from v_room.description then v_changes := array_append(v_changes, 'description'); end if;
  if v_vis is distinct from v_room.visibility then v_changes := array_append(v_changes, 'visibility'); end if;
  if v_mode is distinct from v_room.mode then v_changes := array_append(v_changes, 'mode'); end if;
  if v_limit is distinct from v_room.member_limit then v_changes := array_append(v_changes, 'member_limit'); end if;
  if v_closed is distinct from v_room.is_closed then v_changes := array_append(v_changes, 'is_closed'); end if;

  if cardinality(v_changes) = 0 then
    return;
  end if;

  update public.rooms
     set name = v_name, description = v_desc, visibility = v_vis, mode = v_mode,
         member_limit = v_limit, is_closed = v_closed
   where id = p_room_id;

  perform private.log_activity(p_room_id, v_uid, 'room_updated', jsonb_build_object(
    'changes', to_jsonb(v_changes), 'visibility', v_vis, 'mode', v_mode, 'is_closed', v_closed));

  if 'is_closed' = any (v_changes) then
    perform private.log_moderation(p_room_id, v_uid, case when v_closed then 'close_room' else 'reopen_room' end);
  end if;

  if v_changes && array['visibility', 'mode'] then
    for r in select m.user_id from public.room_members m where m.room_id = p_room_id and m.status = 'active' loop
      perform private.notify(r.user_id, 'room_changed', p_room_id, v_uid, null, jsonb_build_object(
        'changes', to_jsonb(v_changes), 'visibility', v_vis, 'mode', v_mode));
    end loop;
  end if;
end $$;

-- Soundtrack respects the room's toggle.
create or replace function public.create_soundtrack_track(p_room_id uuid, p_title text,
  p_extension text, p_starts_at numeric default null, p_location_label text default null)
returns public.soundtrack_tracks language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_id uuid := gen_random_uuid();
  v_track public.soundtrack_tracks;
begin
  if not private.is_room_member(p_room_id) then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and archived_at is null) then raise exception 'room_archived'; end if;
  perform private.require_feature(p_room_id, 'soundtrack');
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160 then raise exception 'invalid_title'; end if;
  if p_extension is null or p_extension not in ('mp3','m4a','aac','ogg','oga','opus','webm','wav','flac') then raise exception 'invalid_audio_type'; end if;
  if p_starts_at is not null and (p_starts_at < 0 or p_starts_at > 1 or p_starts_at = 'NaN'::numeric) then raise exception 'invalid_position'; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if (select count(*) from public.soundtrack_tracks where room_id = p_room_id) >= 100 then raise exception 'playlist_full'; end if;
  insert into public.soundtrack_tracks(id, room_id, author_id, title, storage_path, starts_at, location_label)
  values (v_id, p_room_id, v_uid, btrim(p_title), p_room_id::text || '/' || v_id::text || '/audio.' || p_extension,
    p_starts_at, left(p_location_label, 200)) returning * into v_track;
  return v_track;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. The book's outline (shared chapter starts), set by the first reader
-- ----------------------------------------------------------------------------
alter table public.books add column outline jsonb check (outline is null or jsonb_typeof(outline) = 'array');

create function private.book_chapters(p_book_id uuid)
returns table (idx integer, label text, start_at numeric, end_at numeric)
language sql stable security definer set search_path = '' as $$
  with entries as (
    select distinct on (round((e ->> 'start')::numeric, 4))
           e ->> 'label' as label, (e ->> 'start')::numeric as s
    from public.books b, jsonb_array_elements(coalesce(b.outline, '[]'::jsonb)) e
    where b.id = p_book_id and coalesce((e ->> 'depth')::integer, 0) = 0 and e ? 'start'
    order by round((e ->> 'start')::numeric, 4), (e ->> 'start')::numeric
  )
  select (row_number() over (order by s))::integer - 1, label, s, coalesce(lead(s) over (order by s), 1)
  from entries;
$$;

-- ----------------------------------------------------------------------------
-- 4. Progress history, visits and afterparties
-- ----------------------------------------------------------------------------
create table private.progress_snapshots (
  id       bigint generated always as identity primary key,
  room_id  uuid not null references public.rooms (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  furthest numeric(7, 6) not null,
  label    text,
  at       timestamptz not null default now()
);
create index progress_snapshots_room_idx on private.progress_snapshots (room_id, user_id, at);

create table private.room_visits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

create table public.room_afterparties (
  room_id       uuid not null references public.rooms (id) on delete cascade,
  chapter_index integer not null,
  label         text,
  start_at      numeric(7, 6) not null,
  end_at        numeric(7, 6) not null,
  opened_at     timestamptz not null default now(),
  primary key (room_id, chapter_index)
);

alter table private.progress_snapshots enable row level security;
alter table private.room_visits enable row level security;
alter table public.room_afterparties enable row level security;
revoke all on private.progress_snapshots, private.room_visits, public.room_afterparties from public, anon, authenticated;

-- Today's readers start the history where they are now.
insert into private.progress_snapshots (room_id, user_id, furthest, label, at)
select rp.room_id, rp.user_id, rp.furthest, coalesce(rp.furthest_chapter_label, rp.label), rp.last_read_at
from public.reading_progress rp;

alter table public.room_activity drop constraint room_activity_type_check;
alter table public.room_activity add constraint room_activity_type_check check (type in (
  'room_created', 'joined', 'left', 'removed', 'started_reading',
  'chapter_completed', 'milestone', 'finished', 'passed',
  'note_left', 'replied', 'room_updated', 'room_archived',
  'prediction_sealed', 'poll_added', 'ritual_started', 'afterparty'
));

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'reply', 'reaction', 'unlocked', 'note_behind', 'member_joined', 'invited',
  'finished', 'role_changed', 'removed', 'room_changed', 'afterparty', 'package'
));

-- When the slowest reader in the room clears a chapter, everyone's things from
-- that chapter come out together.
create function private.check_afterparties(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_book   uuid;
  v_count  integer;
  v_min    numeric;
  v_opened integer := 0;
  v_label  text;
  v_index  integer;
  r        record;
begin
  if not private.room_feature(p_room_id, 'afterparty') then
    return;
  end if;
  select book_id into v_book from public.rooms where id = p_room_id and archived_at is null;
  if v_book is null then
    return;
  end if;
  select count(*), min(coalesce(rp.furthest, 0)) into v_count, v_min
  from public.room_members m
  left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
  where m.room_id = p_room_id and m.status = 'active';
  -- An afterparty needs company.
  if v_count < 2 or v_min is null or v_min <= 0 then
    return;
  end if;

  for r in
    select c.* from private.book_chapters(v_book) c
    where c.end_at > c.start_at and c.end_at <= v_min + 0.000001
      and not exists (select 1 from public.room_afterparties a where a.room_id = p_room_id and a.chapter_index = c.idx)
    order by c.idx
  loop
    insert into public.room_afterparties (room_id, chapter_index, label, start_at, end_at)
    values (p_room_id, r.idx, left(r.label, 200), round(r.start_at, 6), round(r.end_at, 6))
    on conflict do nothing;
    if found then
      v_opened := v_opened + 1;
      v_label := r.label;
      v_index := r.idx;
    end if;
  end loop;

  if v_opened > 0 then
    -- Several chapters at once (a late outline, a long night) are one moment.
    perform private.log_activity(p_room_id, null, 'afterparty',
      jsonb_build_object('label', v_label, 'chapter_index', v_index, 'count', v_opened));
    for r in select m.user_id from public.room_members m where m.room_id = p_room_id and m.status = 'active' loop
      perform private.notify(r.user_id, 'afterparty', p_room_id, null, null,
        jsonb_build_object('label', v_label, 'chapter_index', v_index, 'count', v_opened));
    end loop;
  end if;
end $$;

create function private.progress_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or floor(new.furthest * 100) > floor(old.furthest * 100) then
    insert into private.progress_snapshots (room_id, user_id, furthest, label)
    values (new.room_id, new.user_id, new.furthest, coalesce(new.furthest_chapter_label, new.label));
  end if;
  if tg_op = 'INSERT' or new.furthest > old.furthest then
    perform private.check_afterparties(new.room_id);
  end if;
  return null;
end $$;

create trigger reading_progress_after_change
  after insert or update of furthest on public.reading_progress
  for each row execute function private.progress_after_change();

create function public.set_book_outline(p_book_id uuid, p_outline jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_alpha();
  v_clean jsonb;
  r       record;
begin
  if not private.can_read_book(p_book_id) then
    raise exception 'book_unavailable';
  end if;
  if p_outline is null or jsonb_typeof(p_outline) <> 'array' or jsonb_array_length(p_outline) not between 1 and 500 then
    raise exception 'invalid_outline';
  end if;
  select jsonb_agg(jsonb_build_object(
           'label', left(coalesce(e ->> 'label', ''), 200),
           'start', round((e ->> 'start')::numeric, 6),
           'depth', least(6, greatest(0, coalesce((e ->> 'depth')::integer, 0))))
         order by (e ->> 'start')::numeric)
    into v_clean
  from jsonb_array_elements(p_outline) e
  where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'start') = 'number'
    and (e ->> 'start')::numeric between 0 and 1;
  if v_clean is null then
    raise exception 'invalid_outline';
  end if;
  -- Every reader derives the same outline from the same file: the first one wins.
  update public.books set outline = v_clean where id = p_book_id and outline is null;
  if found then
    for r in select id from public.rooms where book_id = p_book_id and archived_at is null loop
      perform private.check_afterparties(r.id);
    end loop;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Sealed predictions
-- ----------------------------------------------------------------------------
create table public.predictions (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms (id) on delete cascade,
  author_id        uuid not null references public.profiles (id) on delete cascade,
  body             text not null check (char_length(btrim(body)) between 1 and 2000),
  made_at          numeric(7, 6) not null check (made_at between 0 and 1),
  made_label       text check (made_label is null or char_length(made_label) <= 200),
  opens_at         numeric(7, 6) not null check (opens_at between 0 and 1),
  opens_label      text check (opens_label is null or char_length(opens_label) <= 200),
  opens_kind       text not null check (opens_kind in ('chapter', 'point', 'end')),
  hide_from_author boolean not null default false,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       uuid references public.profiles (id) on delete set null,
  check (opens_at > made_at)
);
create index predictions_room_idx on public.predictions (room_id, opens_at) where removed_at is null;

create table public.prediction_reveals (
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  revealed_at   timestamptz not null default now(),
  verdict       text check (verdict in ('called_it', 'close', 'way_off')),
  primary key (prediction_id, user_id)
);

alter table public.predictions enable row level security;
alter table public.prediction_reveals enable row level security;
revoke all on public.predictions, public.prediction_reveals from public, anon, authenticated;

create function private.viewer_progress(p_room_id uuid, out furthest numeric, out completed boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(max(rp.furthest), 0), coalesce(bool_or(rp.completed_at is not null), false)
  from public.reading_progress rp where rp.room_id = p_room_id and rp.user_id = (select auth.uid());
$$;

create function public.seal_prediction(
  p_room_id uuid,
  p_body text,
  p_made_at numeric,
  p_made_label text,
  p_opens_at numeric,
  p_opens_label text,
  p_opens_kind text,
  p_hide_from_author boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_alpha();
  v_body  text := btrim(coalesce(p_body, ''));
  v_made  numeric := round(least(greatest(coalesce(p_made_at, 0), 0), 1), 6);
  v_opens numeric := round(least(greatest(coalesce(p_opens_at, 0), 0), 1), 6);
  v_id    uuid;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if exists (select 1 from public.rooms r where r.id = p_room_id and r.archived_at is not null) then
    raise exception 'room_archived';
  end if;
  perform private.require_feature(p_room_id, 'predictions');
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'invalid_prediction';
  end if;
  if p_opens_kind is null or p_opens_kind not in ('chapter', 'point', 'end') then
    raise exception 'invalid_unlock';
  end if;
  if p_opens_kind = 'end' then
    v_opens := 0.99;
  end if;
  if v_opens <= v_made then
    raise exception 'invalid_unlock';
  end if;
  if (select count(*) from public.predictions p where p.room_id = p_room_id and p.author_id = v_uid and p.removed_at is null) >= 60 then
    raise exception 'too_many_predictions';
  end if;

  insert into public.predictions (room_id, author_id, body, made_at, made_label, opens_at, opens_label, opens_kind, hide_from_author)
  values (p_room_id, v_uid, v_body, v_made, nullif(left(p_made_label, 200), ''), v_opens,
          nullif(left(case when p_opens_kind = 'end' then 'The end' else p_opens_label end, 200), ''),
          p_opens_kind, coalesce(p_hide_from_author, false))
  returning id into v_id;

  perform private.log_activity(p_room_id, v_uid, 'prediction_sealed',
    jsonb_build_object('label', (select opens_label from public.predictions where id = v_id), 'kind', p_opens_kind));
  return v_id;
end $$;

-- Opening is a moment: it records when, and lets each reader judge how close it came.
create function public.reveal_prediction(p_prediction_id uuid, p_verdict text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_p   public.predictions%rowtype;
  v_me  record;
begin
  select * into v_p from public.predictions where id = p_prediction_id and removed_at is null;
  if not found or not private.is_room_member(v_p.room_id) then
    raise exception 'prediction_unavailable';
  end if;
  select * into v_me from private.viewer_progress(v_p.room_id);
  if not ((v_p.author_id = v_uid and not v_p.hide_from_author) or v_me.furthest >= v_p.opens_at
          or (v_p.opens_kind = 'end' and v_me.completed)) then
    raise exception 'prediction_sealed';
  end if;
  if p_verdict is not null and p_verdict not in ('called_it', 'close', 'way_off') then
    raise exception 'invalid_verdict';
  end if;
  insert into public.prediction_reveals (prediction_id, user_id, verdict)
  values (p_prediction_id, v_uid, p_verdict)
  on conflict (prediction_id, user_id) do update set verdict = coalesce(excluded.verdict, public.prediction_reveals.verdict);
end $$;

-- Sealed means sealed: only room staff can take one down (for moderation).
create function public.remove_prediction(p_prediction_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room uuid;
begin
  select room_id into v_room from public.predictions where id = p_prediction_id and removed_at is null;
  if v_room is null or not private.is_room_staff(v_room) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.predictions set removed_at = now(), removed_by = v_uid where id = p_prediction_id;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Spoiler-safe polls
-- ----------------------------------------------------------------------------
create table public.polls (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  position       numeric(7, 6) not null check (position between 0 and 1),
  anchor         jsonb not null check (jsonb_typeof(anchor) = 'object'),
  location_label text check (location_label is null or char_length(location_label) <= 200),
  question       text not null check (char_length(btrim(question)) between 1 and 300),
  options        jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  removed_by     uuid references public.profiles (id) on delete set null
);
create index polls_room_idx on public.polls (room_id, position) where removed_at is null;

create table public.poll_votes (
  poll_id      uuid not null references public.polls (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  option_index smallint not null check (option_index between 0 and 5),
  created_at   timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.polls, public.poll_votes from public, anon, authenticated;

create function public.create_poll(
  p_room_id uuid, p_position numeric, p_anchor jsonb, p_location_label text, p_question text, p_options jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_alpha();
  v_options jsonb;
  v_id      uuid;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if exists (select 1 from public.rooms r where r.id = p_room_id and r.archived_at is not null) then
    raise exception 'room_archived';
  end if;
  perform private.require_feature(p_room_id, 'polls');
  if p_position is null or p_position < 0 or p_position > 1 or p_anchor is null or jsonb_typeof(p_anchor) <> 'object' then
    raise exception 'invalid_location';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'invalid_poll';
  end if;
  select jsonb_agg(left(btrim(e #>> '{}'), 80) order by ord) into v_options
  from jsonb_array_elements(p_options) with ordinality as t(e, ord)
  where jsonb_typeof(e) = 'string' and btrim(e #>> '{}') <> '';
  if char_length(btrim(coalesce(p_question, ''))) not between 1 and 300
     or v_options is null or jsonb_array_length(v_options) not between 2 and 6 then
    raise exception 'invalid_poll';
  end if;

  insert into public.polls (room_id, author_id, position, anchor, location_label, question, options)
  values (p_room_id, v_uid, round(p_position, 6), p_anchor, nullif(left(p_location_label, 200), ''), btrim(p_question), v_options)
  returning id into v_id;
  perform private.log_activity(p_room_id, v_uid, 'poll_added', jsonb_build_object('label', nullif(left(p_location_label, 200), '')));
  return v_id;
end $$;

-- One vote, sealed: the ending can show how everyone really felt at the time.
create function public.vote_poll(p_poll_id uuid, p_option integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_poll public.polls%rowtype;
  v_me   record;
begin
  select * into v_poll from public.polls where id = p_poll_id and removed_at is null;
  if not found or not private.is_room_member(v_poll.room_id) then
    raise exception 'poll_unavailable';
  end if;
  select * into v_me from private.viewer_progress(v_poll.room_id);
  if v_poll.author_id <> v_uid and v_me.furthest < v_poll.position then
    raise exception 'poll_ahead';
  end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(v_poll.options) then
    raise exception 'invalid_option';
  end if;
  insert into public.poll_votes (poll_id, user_id, option_index) values (p_poll_id, v_uid, p_option)
  on conflict do nothing;
  if not found then
    raise exception 'already_voted';
  end if;
end $$;

create function public.remove_poll(p_poll_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_poll public.polls%rowtype;
begin
  select * into v_poll from public.polls where id = p_poll_id and removed_at is null;
  if not found or not private.is_room_member(v_poll.room_id)
     or (v_poll.author_id <> v_uid and not private.is_room_staff(v_poll.room_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.polls set removed_at = now(), removed_by = v_uid where id = p_poll_id;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Packages and five attention levels
-- ----------------------------------------------------------------------------
alter table public.annotation_markers drop constraint annotation_markers_attention_check;
alter table public.annotation_markers add constraint annotation_markers_attention_check
  check (attention in ('quiet', 'gentle', 'playful', 'knock', 'shout'));
alter table public.annotation_markers
  add column kind text not null default 'note' check (kind in ('note', 'package')),
  add column package_title text check (package_title is null or char_length(package_title) <= 120),
  add constraint annotation_markers_package_recipient check (kind <> 'package' or recipient_id is not null);

create or replace function private.publish_marker(p_marker_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_marker public.annotation_markers%rowtype;
  r        record;
begin
  update public.annotation_markers set published_at = now()
   where id = p_marker_id and published_at is null
  returning * into v_marker;
  if not found then
    return;
  end if;

  for r in
    insert into public.reading_unlocks (user_id, marker_id, room_id, via)
    select rp.user_id, v_marker.id, v_marker.room_id, 'instant'
    from public.reading_progress rp
    where rp.room_id = v_marker.room_id
      and rp.user_id <> v_marker.author_id
      and (v_marker.recipient_id is null or v_marker.recipient_id = rp.user_id)
      and rp.furthest >= v_marker.position
      and private.is_member_user(v_marker.room_id, rp.user_id)
    on conflict do nothing
    returning user_id
  loop
    perform private.notify(r.user_id, 'note_behind', v_marker.room_id, v_marker.author_id, v_marker.id,
      jsonb_build_object('label', v_marker.location_label));
  end loop;

  -- A package waiting ahead is worth knowing about; what is inside is not.
  if v_marker.kind = 'package' and v_marker.recipient_id <> v_marker.author_id
     and not exists (select 1 from public.reading_unlocks u where u.marker_id = v_marker.id and u.user_id = v_marker.recipient_id) then
    perform private.notify(v_marker.recipient_id, 'package', v_marker.room_id, v_marker.author_id, v_marker.id,
      jsonb_build_object('label', v_marker.location_label, 'title', v_marker.package_title));
  end if;

  perform private.log_activity(v_marker.room_id, v_marker.author_id, 'note_left',
    jsonb_build_object('marker_id', v_marker.id, 'label', v_marker.location_label));
end $$;

drop function public.create_annotation(uuid, numeric, jsonb, text, text, text, text, text, boolean, text, uuid);
create function public.create_annotation(
  p_room_id uuid,
  p_position numeric,
  p_anchor jsonb,
  p_location_label text default null,
  p_body text default null,
  p_emoji text default null,
  p_link_url text default null,
  p_quote text default null,
  p_publish boolean default true,
  p_attention text default 'gentle',
  p_recipient_id uuid default null,
  p_kind text default 'note',
  p_title text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_room   public.rooms%rowtype;
  v_id     uuid;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_emoji  text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_link   text := private.clean_link(p_link_url);
  v_quote  text := nullif(left(btrim(coalesce(p_quote, '')), 1200), '');
  v_kind   text := coalesce(p_kind, 'note');
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.archived_at is not null then
    raise exception 'room_archived';
  end if;
  if p_position is null or p_position < 0 or p_position > 1 or p_anchor is null or jsonb_typeof(p_anchor) <> 'object' then
    raise exception 'invalid_location';
  end if;
  if char_length(coalesce(v_body, '')) > 10000 or char_length(coalesce(v_emoji, '')) > 16 then
    raise exception 'note_too_long';
  end if;
  if p_attention is null or p_attention not in ('quiet', 'gentle', 'playful', 'knock', 'shout') then
    raise exception 'invalid_attention';
  end if;
  if v_kind not in ('note', 'package') then
    raise exception 'invalid_kind';
  end if;
  if p_recipient_id is not null and not private.is_member_user(p_room_id, p_recipient_id) then
    raise exception 'invalid_recipient' using errcode = '42501';
  end if;
  if v_kind = 'package' then
    perform private.require_feature(p_room_id, 'packages');
    if p_recipient_id is null or p_recipient_id = v_uid then
      raise exception 'invalid_recipient' using errcode = '42501';
    end if;
  end if;
  if p_publish and v_body is null and v_emoji is null and v_link is null then
    raise exception 'empty_note';
  end if;

  insert into public.annotation_markers (room_id, book_id, author_id, position, anchor, location_label, attention, recipient_id, kind, package_title)
  values (p_room_id, v_room.book_id, v_uid, round(p_position, 6), p_anchor, nullif(left(p_location_label, 200), ''),
          p_attention, p_recipient_id, v_kind, case when v_kind = 'package' then nullif(left(btrim(coalesce(p_title, '')), 120), '') end)
  returning id into v_id;

  insert into public.annotation_contents (marker_id, room_id, body, emoji, link_url, quote)
  values (v_id, p_room_id, v_body, v_emoji, v_link, v_quote);

  if p_publish then
    perform private.publish_marker(v_id);
  end if;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- 8. Room rituals
-- ----------------------------------------------------------------------------
create table public.room_rituals (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('predict_before', 'vote_before', 'song_within', 'hold_until', 'custom')),
  title        text not null check (char_length(btrim(title)) between 1 and 140),
  detail       text check (detail is null or char_length(detail) <= 400),
  starts_at    numeric(7, 6) check (starts_at is null or starts_at between 0 and 1),
  target_at    numeric(7, 6) check (target_at is null or target_at between 0 and 1),
  target_label text check (target_label is null or char_length(target_label) <= 200),
  until_at     timestamptz,
  poll_id      uuid references public.polls (id) on delete set null,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index room_rituals_room_idx on public.room_rituals (room_id, created_at desc);

create table public.ritual_checkins (
  ritual_id uuid not null references public.room_rituals (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  done_at   timestamptz not null default now(),
  primary key (ritual_id, user_id)
);

alter table public.room_rituals enable row level security;
alter table public.ritual_checkins enable row level security;
revoke all on public.room_rituals, public.ritual_checkins from public, anon, authenticated;

create function public.create_ritual(
  p_room_id uuid,
  p_kind text,
  p_title text,
  p_detail text default null,
  p_starts_at numeric default null,
  p_target_at numeric default null,
  p_target_label text default null,
  p_until_at timestamptz default null,
  p_poll_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_id  uuid;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if exists (select 1 from public.rooms r where r.id = p_room_id and r.archived_at is not null) then
    raise exception 'room_archived';
  end if;
  perform private.require_feature(p_room_id, 'rituals');
  if p_kind is null or p_kind not in ('predict_before', 'vote_before', 'song_within', 'hold_until', 'custom')
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 140
     or char_length(coalesce(p_detail, '')) > 400 then
    raise exception 'invalid_ritual';
  end if;
  if p_kind in ('predict_before', 'song_within', 'hold_until') and (p_target_at is null or p_target_at <= 0 or p_target_at > 1) then
    raise exception 'invalid_ritual';
  end if;
  if p_kind = 'song_within' and p_starts_at is not null and p_starts_at >= p_target_at then
    raise exception 'invalid_ritual';
  end if;
  if p_kind = 'hold_until' and (p_until_at is null or p_until_at <= now() or p_until_at > now() + interval '60 days') then
    raise exception 'invalid_ritual';
  end if;
  if p_kind = 'vote_before' and not exists (
       select 1 from public.polls p where p.id = p_poll_id and p.room_id = p_room_id and p.removed_at is null) then
    raise exception 'invalid_ritual';
  end if;
  if (select count(*) from public.room_rituals t where t.room_id = p_room_id and t.ended_at is null) >= 20 then
    raise exception 'too_many_rituals';
  end if;

  insert into public.room_rituals (room_id, created_by, kind, title, detail, starts_at, target_at, target_label, until_at, poll_id)
  values (p_room_id, v_uid, p_kind, btrim(p_title), nullif(btrim(coalesce(p_detail, '')), ''),
          case when p_kind = 'song_within' then round(coalesce(p_starts_at, 0), 6) end,
          case when p_kind in ('predict_before', 'song_within', 'hold_until') then round(p_target_at, 6)
               when p_kind = 'vote_before' then (select position from public.polls where id = p_poll_id) end,
          nullif(left(coalesce(p_target_label, (select location_label from public.polls where id = p_poll_id)), 200), ''),
          case when p_kind = 'hold_until' then p_until_at end,
          case when p_kind = 'vote_before' then p_poll_id end)
  returning id into v_id;
  perform private.log_activity(p_room_id, v_uid, 'ritual_started', jsonb_build_object('title', btrim(p_title)));
  return v_id;
end $$;

create function public.end_ritual(p_ritual_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_r   public.room_rituals%rowtype;
begin
  select * into v_r from public.room_rituals where id = p_ritual_id and ended_at is null;
  if not found or not private.is_room_member(v_r.room_id)
     or (v_r.created_by <> v_uid and not private.is_room_staff(v_r.room_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.room_rituals set ended_at = now() where id = p_ritual_id;
end $$;

create function public.checkin_ritual(p_ritual_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_r   public.room_rituals%rowtype;
begin
  select * into v_r from public.room_rituals where id = p_ritual_id and ended_at is null;
  if not found or not private.is_room_member(v_r.room_id) or v_r.kind <> 'custom' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.ritual_checkins (ritual_id, user_id) values (p_ritual_id, v_uid) on conflict do nothing;
end $$;

-- ----------------------------------------------------------------------------
-- 9. Ratings
-- ----------------------------------------------------------------------------
create table public.room_ratings (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  line       text check (line is null or char_length(line) <= 240),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_ratings enable row level security;
revoke all on public.room_ratings from public, anon, authenticated;

create function public.rate_book(p_room_id uuid, p_stars integer, p_line text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_me  record;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select * into v_me from private.viewer_progress(p_room_id);
  if not (v_me.furthest >= 0.98 or v_me.completed) then
    raise exception 'finish_first';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'invalid_rating';
  end if;
  insert into public.room_ratings (room_id, user_id, stars, line)
  values (p_room_id, v_uid, p_stars, nullif(left(btrim(coalesce(p_line, '')), 240), ''))
  on conflict (room_id, user_id) do update set stars = excluded.stars, line = excluded.line, updated_at = now();
end $$;

-- ----------------------------------------------------------------------------
-- 10. Read models
-- ----------------------------------------------------------------------------
create or replace function private.room_card(p_room public.rooms, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_room.id,
    'name', p_room.name,
    'description', p_room.description,
    'visibility', p_room.visibility,
    'mode', p_room.mode,
    'features', p_room.features,
    'member_limit', p_room.member_limit,
    'capacity', private.room_capacity(p_room.member_limit),
    'is_closed', p_room.is_closed,
    'archived_at', p_room.archived_at,
    'owner_id', p_room.owner_id,
    'created_at', p_room.created_at,
    'last_activity_at', p_room.last_activity_at,
    'is_member', true,
    'my_role', (select m.role from public.room_members m where m.room_id = p_room.id and m.user_id = p_viewer),
    'book', private.book_json(p_room.book_id),
    'members', private.room_members_json(p_room.id),
    'my', (
      select jsonb_build_object(
        'read_coverage', coalesce(rp.read_coverage, 0), 'estimated_wpm', coalesce(rp.estimated_wpm, 240), 'pace_samples', coalesce(rp.pace_samples, 0), 'active_reading_seconds', coalesce(rp.active_reading_seconds, 0),
        'position', rp.position, 'furthest', rp.furthest, 'label', rp.label, 'anchor', rp.anchor,
        'started_at', rp.started_at, 'last_read_at', rp.last_read_at, 'completed_at', rp.completed_at
      )
      from public.reading_progress rp where rp.room_id = p_room.id and rp.user_id = p_viewer
    ),
    'waiting', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and (k.recipient_id is null or k.recipient_id = p_viewer or k.author_id = p_viewer) and k.published_at is not null and k.removed_at is null
        and k.author_id <> p_viewer
        and not exists (select 1 from public.reading_unlocks u where u.marker_id = k.id and u.user_id = p_viewer)
    ),
    'packages_waiting', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and k.kind = 'package' and k.recipient_id = p_viewer and k.published_at is not null and k.removed_at is null
        and not exists (select 1 from public.reading_unlocks u where u.marker_id = k.id and u.user_id = p_viewer)
    ),
    'unseen', (
      select count(*) from public.reading_unlocks u
      join public.annotation_markers k on k.id = u.marker_id
      where u.room_id = p_room.id and u.user_id = p_viewer and u.seen_at is null
        and k.removed_at is null and (k.recipient_id is null or k.recipient_id = p_viewer or k.author_id = p_viewer) and k.published_at is not null
    ),
    'note_count', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and (k.recipient_id is null or k.recipient_id = p_viewer or k.author_id = p_viewer) and k.published_at is not null and k.removed_at is null
    ),
    'predictions_ready', (
      select count(*) from public.predictions p
      left join public.reading_progress rp on rp.room_id = p.room_id and rp.user_id = p_viewer
      where p.room_id = p_room.id and p.removed_at is null
        and (coalesce(rp.furthest, 0) >= p.opens_at or (p.opens_kind = 'end' and rp.completed_at is not null))
        and not exists (select 1 from public.prediction_reveals v where v.prediction_id = p.id and v.user_id = p_viewer)
    )
  );
$$;

-- Everything the reader's social layer needs, in one spoiler-safe round trip.
create function public.room_layer(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
  v_me   numeric;
  v_done boolean;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  select furthest, completed into v_me, v_done from private.viewer_progress(p_room_id);

  return jsonb_build_object(
    'features', v_room.features,
    'outline', (select b.outline from public.books b where b.id = v_room.book_id),
    'furthest', v_me,
    'predictions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'author_id', p.author_id, 'made_at', p.made_at, 'made_label', p.made_label,
        'opens_at', p.opens_at, 'opens_label', p.opens_label, 'opens_kind', p.opens_kind,
        'hide_from_author', p.hide_from_author, 'created_at', p.created_at,
        'open', o.open,
        'reached', v_me >= p.opens_at or (p.opens_kind = 'end' and v_done),
        'body', case when o.open then p.body end,
        'revealed_at', rv.revealed_at,
        'my_verdict', rv.verdict,
        'verdicts', case when o.open then (
          select jsonb_object_agg(v.verdict, v.n) from (
            select x.verdict, count(*) as n from public.prediction_reveals x
            where x.prediction_id = p.id and x.verdict is not null group by x.verdict) v) end
      ) order by p.opens_at, p.created_at), '[]'::jsonb)
      from public.predictions p
      cross join lateral (select ((p.author_id = v_uid and not p.hide_from_author) or v_me >= p.opens_at
                                  or (p.opens_kind = 'end' and v_done)) as open) o
      left join public.prediction_reveals rv on rv.prediction_id = p.id and rv.user_id = v_uid
      where p.room_id = p_room_id and p.removed_at is null
    ),
    'polls', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pl.id, 'author_id', pl.author_id, 'position', pl.position, 'anchor', pl.anchor,
        'label', pl.location_label, 'created_at', pl.created_at,
        'reached', r.reached,
        'question', case when r.reached then pl.question end,
        'options', case when r.reached then pl.options end,
        'my_vote', mv.option_index,
        'votes', (select count(*) from public.poll_votes x where x.poll_id = pl.id),
        'results', case when mv.option_index is not null then (
          select coalesce(jsonb_agg(jsonb_build_object('option', x.option_index, 'user_id', x.user_id) order by x.created_at), '[]'::jsonb)
          from public.poll_votes x where x.poll_id = pl.id) end
      ) order by pl.position, pl.created_at), '[]'::jsonb)
      from public.polls pl
      cross join lateral (select (pl.author_id = v_uid or v_me >= pl.position) as reached) r
      left join public.poll_votes mv on mv.poll_id = pl.id and mv.user_id = v_uid
      where pl.room_id = p_room_id and pl.removed_at is null
    ),
    'rituals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'title', t.title, 'detail', t.detail, 'created_by', t.created_by,
        'starts_at', t.starts_at, 'target_at', t.target_at, 'target_label', t.target_label,
        'until_at', t.until_at, 'poll_id', t.poll_id, 'created_at', t.created_at, 'ended_at', t.ended_at,
        'members', (
          select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'done', case t.kind
              when 'predict_before' then exists (select 1 from public.predictions p where p.room_id = t.room_id and p.author_id = m.user_id
                                                 and p.removed_at is null and p.made_at <= t.target_at)
              when 'vote_before' then exists (select 1 from public.poll_votes v where v.poll_id = t.poll_id and v.user_id = m.user_id)
              when 'song_within' then exists (select 1 from public.soundtrack_tracks s where s.room_id = t.room_id and s.author_id = m.user_id
                                              and s.ready and s.starts_at between coalesce(t.starts_at, 0) and t.target_at)
              when 'hold_until' then coalesce(rp.furthest, 0) <= t.target_at + 0.002
              else exists (select 1 from public.ritual_checkins c where c.ritual_id = t.id and c.user_id = m.user_id)
            end)), '[]'::jsonb)
          from public.room_members m
          left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
          where m.room_id = t.room_id and m.status = 'active'
        )
      ) order by t.created_at desc), '[]'::jsonb)
      from public.room_rituals t
      where t.room_id = p_room_id and (t.ended_at is null or t.ended_at > now() - interval '3 days')
    ),
    'afterparties', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'chapter_index', a.chapter_index, 'label', a.label, 'start_at', a.start_at, 'end_at', a.end_at, 'opened_at', a.opened_at
      ) order by a.chapter_index), '[]'::jsonb)
      from public.room_afterparties a where a.room_id = p_room_id
    ),
    -- Emotion is progress-gated too: only what the viewer has already reached.
    'weather', (
      select coalesce(jsonb_agg(jsonb_build_object('p', w.p, 'e', w.e, 'n', w.n)), '[]'::jsonb)
      from (
        select round(k.position, 3) as p, x.e, count(*) as n
        from public.annotation_markers k
        cross join lateral (
          select c.emoji as e from public.annotation_contents c where c.marker_id = k.id and c.emoji is not null
          union all
          select r.emoji from public.annotation_reactions r where r.marker_id = k.id
        ) x
        where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null
          and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid)
          and k.position <= v_me
        group by 1, 2
      ) w
    ),
    'cues', (
      select coalesce(jsonb_agg(jsonb_build_object('position', t.starts_at, 'author_id', t.author_id,
                                                   'open', t.author_id = v_uid or v_me >= t.starts_at) order by t.starts_at), '[]'::jsonb)
      from public.soundtrack_tracks t where t.room_id = p_room_id and t.ready and t.starts_at is not null
    ),
    'my_rating', (select jsonb_build_object('stars', x.stars, 'line', x.line) from public.room_ratings x
                  where x.room_id = p_room_id and x.user_id = v_uid)
  );
end $$;

-- "While you were away": what friends did since the viewer was last here.
create function public.room_away(p_room_id uuid, p_mark boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_alpha();
  v_since timestamptz;
  v_me    numeric;
  v_out   jsonb;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  select greatest(
           (select v.seen_at from private.room_visits v where v.user_id = v_uid and v.room_id = p_room_id),
           (select rp.last_read_at from public.reading_progress rp where rp.user_id = v_uid and rp.room_id = p_room_id))
    into v_since;
  select furthest into v_me from private.viewer_progress(p_room_id);
  if p_mark then
    insert into private.room_visits (user_id, room_id, seen_at) values (v_uid, p_room_id, now())
    on conflict (user_id, room_id) do update set seen_at = now();
  end if;
  if v_since is null or not private.room_feature(p_room_id, 'away_summary') then
    return jsonb_build_object('since', v_since, 'me', v_me, 'members', '[]'::jsonb, 'afterparties', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'since', v_since,
    'me', v_me,
    'members', coalesce((
      select jsonb_agg(x order by (x ->> 'to')::numeric desc)
      from (
        select jsonb_build_object(
          'user_id', m.user_id,
          'from', coalesce((select s.furthest from private.progress_snapshots s
                            where s.room_id = p_room_id and s.user_id = m.user_id and s.at <= v_since
                            order by s.at desc limit 1), 0),
          'to', coalesce(rp.furthest, 0),
          'finished', rp.completed_at is not null and rp.completed_at > v_since,
          'left_ahead', (select count(*) from public.annotation_markers k
                          where k.room_id = p_room_id and k.author_id = m.user_id and k.published_at > v_since and k.removed_at is null
                            and (k.recipient_id is null or k.recipient_id = v_uid) and k.position > v_me),
          'packages', (select count(*) from public.annotation_markers k
                        where k.room_id = p_room_id and k.author_id = m.user_id and k.kind = 'package' and k.recipient_id = v_uid
                          and k.published_at > v_since and k.removed_at is null),
          'replies', (select count(*) from public.annotation_replies y join public.annotation_markers k on k.id = y.marker_id
                       where y.room_id = p_room_id and y.author_id = m.user_id and k.author_id = v_uid
                         and y.created_at > v_since and y.removed_at is null and k.removed_at is null),
          'reply_label', (select k.location_label from public.annotation_replies y join public.annotation_markers k on k.id = y.marker_id
                           where y.room_id = p_room_id and y.author_id = m.user_id and k.author_id = v_uid
                             and y.created_at > v_since and y.removed_at is null and k.removed_at is null
                           order by y.created_at desc limit 1),
          'reply_marker', (select k.id from public.annotation_replies y join public.annotation_markers k on k.id = y.marker_id
                            where y.room_id = p_room_id and y.author_id = m.user_id and k.author_id = v_uid
                              and y.created_at > v_since and y.removed_at is null and k.removed_at is null
                            order by y.created_at desc limit 1),
          'predictions', (select count(*) from public.predictions p
                           where p.room_id = p_room_id and p.author_id = m.user_id and p.created_at > v_since and p.removed_at is null)
        ) as x
        from public.room_members m
        left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
        where m.room_id = p_room_id and m.status = 'active' and m.user_id <> v_uid
      ) t
      where (x ->> 'to')::numeric > (x ->> 'from')::numeric + 0.004
         or (x ->> 'left_ahead')::integer > 0 or (x ->> 'replies')::integer > 0
         or (x ->> 'predictions')::integer > 0 or (x ->> 'finished')::boolean
    ), '[]'::jsonb),
    'afterparties', coalesce((
      select jsonb_agg(jsonb_build_object('chapter_index', a.chapter_index, 'label', a.label) order by a.chapter_index)
      from public.room_afterparties a where a.room_id = p_room_id and a.opened_at > v_since
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- Your own notes (and friends' notes you had opened) from earlier readings of the same book.
create function public.reading_echoes(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
  v_book public.books%rowtype;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not private.room_feature(p_room_id, 'echoes') then
    return '[]'::jsonb;
  end if;
  select * into v_book from public.books where id = v_room.book_id;

  return (
    select coalesce(jsonb_agg(e order by (e ->> 'position')::numeric), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', k.id, 'room_id', k.room_id, 'room_name', r.name,
        'author_id', k.author_id, 'author_name', p.display_name, 'author_avatar', p.avatar_path,
        'mine', k.author_id = v_uid,
        'position', k.position, 'anchor', k.anchor, 'label', k.location_label, 'created_at', k.published_at,
        'body', c.body, 'emoji', c.emoji, 'quote', c.quote, 'link_url', c.link_url,
        'media', (select coalesce(jsonb_agg(distinct a.kind), '[]'::jsonb) from public.annotation_attachments a where a.marker_id = k.id)
      ) as e
      from public.annotation_markers k
      join public.rooms r on r.id = k.room_id
      join public.books b on b.id = r.book_id
      join public.profiles p on p.id = k.author_id
      join public.annotation_contents c on c.marker_id = k.id
      where k.room_id <> p_room_id
        and r.created_at < v_room.created_at
        and (b.id = v_book.id or (v_book.sha256 is not null and b.sha256 = v_book.sha256 and b.format = v_book.format))
        and exists (select 1 from public.room_members m where m.room_id = k.room_id and m.user_id = v_uid)
        and k.published_at is not null and k.removed_at is null
        and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid)
        and (k.author_id = v_uid or exists (select 1 from public.reading_unlocks u where u.marker_id = k.id and u.user_id = v_uid))
      order by k.published_at desc
      limit 300
    ) t
  );
end $$;

-- The Ending Vault: opens only once the viewer has reached the end.
create function public.room_vault(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
  v_me   numeric;
  v_done boolean;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not private.room_feature(p_room_id, 'vault') then
    raise exception 'feature_off';
  end if;
  select furthest, completed into v_me, v_done from private.viewer_progress(p_room_id);
  if not (v_me >= 0.98 or v_done) then
    raise exception 'vault_locked';
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object('id', v_room.id, 'name', v_room.name, 'mode', v_room.mode, 'created_at', v_room.created_at),
    'book', private.book_json(v_room.book_id),
    'readers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'display_name', p.display_name, 'avatar_path', p.avatar_path, 'status', m.status,
        'furthest', coalesce(rp.furthest, 0), 'started_at', rp.started_at, 'completed_at', rp.completed_at,
        'active_reading_seconds', coalesce(rp.active_reading_seconds, 0)
      ) order by rp.completed_at nulls last, coalesce(rp.furthest, 0) desc), '[]'::jsonb)
      from public.room_members m
      join public.profiles p on p.id = m.user_id
      left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
      where m.room_id = p_room_id and (m.status = 'active' or rp.user_id is not null)
    ),
    'predictions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'author_id', p.author_id, 'body', p.body, 'made_at', p.made_at, 'made_label', p.made_label,
        'opens_label', p.opens_label, 'opens_kind', p.opens_kind, 'created_at', p.created_at,
        'my_verdict', (select v.verdict from public.prediction_reveals v where v.prediction_id = p.id and v.user_id = v_uid),
        'verdicts', (select jsonb_object_agg(v.verdict, v.n) from (
                      select x.verdict, count(*) as n from public.prediction_reveals x
                      where x.prediction_id = p.id and x.verdict is not null group by x.verdict) v)
      ) order by p.made_at, p.created_at), '[]'::jsonb)
      from public.predictions p where p.room_id = p_room_id and p.removed_at is null
    ),
    'first_note', (
      select jsonb_build_object('marker_id', k.id, 'author_id', k.author_id, 'label', k.location_label,
                                'created_at', k.published_at, 'body', c.body, 'emoji', c.emoji, 'quote', c.quote)
      from public.annotation_markers k join public.annotation_contents c on c.marker_id = k.id
      where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null and private.can_view_annotation(k.id)
      order by k.published_at limit 1
    ),
    'most_reacted', (
      select jsonb_build_object('marker_id', k.id, 'author_id', k.author_id, 'label', k.location_label,
                                'body', c.body, 'emoji', c.emoji, 'quote', c.quote, 'reactions', s.reactions, 'replies', s.replies)
      from public.annotation_markers k
      join public.annotation_contents c on c.marker_id = k.id
      cross join lateral (select (select count(*) from public.annotation_reactions x where x.marker_id = k.id) as reactions,
                                 (select count(*) from public.annotation_replies y where y.marker_id = k.id and y.removed_at is null) as replies) s
      where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null and private.can_view_annotation(k.id)
        and s.reactions + s.replies > 0
      order by s.reactions + s.replies desc, k.published_at limit 1
    ),
    'funniest', (
      select jsonb_build_object('marker_id', k.id, 'author_id', k.author_id, 'label', k.location_label,
                                'body', c.body, 'emoji', c.emoji, 'quote', c.quote, 'laughs', s.laughs)
      from public.annotation_markers k
      join public.annotation_contents c on c.marker_id = k.id
      cross join lateral (select (select count(*) from public.annotation_reactions x where x.marker_id = k.id and x.emoji = '😂')
                                 + case when c.emoji = '😂' then 1 else 0 end as laughs) s
      where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null and private.can_view_annotation(k.id)
        and s.laughs > 0
      order by s.laughs desc, k.published_at limit 1
    ),
    'polls', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pl.id, 'author_id', pl.author_id, 'question', pl.question, 'options', pl.options, 'label', pl.location_label,
        'position', pl.position,
        'results', (select coalesce(jsonb_agg(jsonb_build_object('option', x.option_index, 'user_id', x.user_id)), '[]'::jsonb)
                    from public.poll_votes x where x.poll_id = pl.id)
      ) order by pl.position), '[]'::jsonb)
      from public.polls pl where pl.room_id = p_room_id and pl.removed_at is null
    ),
    'ratings', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'stars', x.stars, 'line', x.line) order by x.updated_at), '[]'::jsonb)
      from public.room_ratings x where x.room_id = p_room_id
    ),
    'soundtrack', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'author_id', t.author_id,
                                                   'starts_at', t.starts_at, 'label', t.location_label)
                                order by t.starts_at nulls last, t.created_at), '[]'::jsonb)
      from public.soundtrack_tracks t where t.room_id = p_room_id and t.ready
    ),
    'chapters', (
      select coalesce(jsonb_agg(jsonb_build_object('index', ch.idx, 'label', ch.label, 'start_at', ch.start_at, 'end_at', ch.end_at,
        'notes', (select count(*) from public.annotation_markers k where k.room_id = p_room_id and k.published_at is not null
                    and k.removed_at is null and k.position >= ch.start_at and k.position < ch.end_at
                    and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid)),
        'replies', (select count(*) from public.annotation_replies y join public.annotation_markers k on k.id = y.marker_id
                      where k.room_id = p_room_id and y.removed_at is null and k.removed_at is null
                        and k.position >= ch.start_at and k.position < ch.end_at
                        and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid))
      ) order by ch.idx), '[]'::jsonb)
      from private.book_chapters(v_room.book_id) ch
    ),
    'images', (
      select coalesce(jsonb_agg(i), '[]'::jsonb) from (
        select jsonb_build_object('id', a.id, 'bucket', a.bucket, 'path', a.path, 'marker_id', a.marker_id,
                                  'author_id', k.author_id, 'width', a.width, 'height', a.height, 'label', k.location_label) as i
        from public.annotation_attachments a join public.annotation_markers k on k.id = a.marker_id
        where a.room_id = p_room_id and a.kind = 'image' and k.published_at is not null and k.removed_at is null
          and private.can_view_annotation(k.id)
        order by k.position limit 24
      ) t
    ),
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'furthest', s.furthest, 'at', s.at) order by s.at), '[]'::jsonb)
      from private.progress_snapshots s where s.room_id = p_room_id
    ),
    'totals', jsonb_build_object(
      'notes', (select count(*) from public.annotation_markers k where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null
                  and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid)),
      'replies', (select count(*) from public.annotation_replies y join public.annotation_markers k on k.id = y.marker_id
                    where y.room_id = p_room_id and y.removed_at is null and k.removed_at is null
                      and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid)),
      'reactions', (select count(*) from public.annotation_reactions x join public.annotation_markers k on k.id = x.marker_id
                      where x.room_id = p_room_id and k.removed_at is null
                        and (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid)),
      'predictions', (select count(*) from public.predictions p where p.room_id = p_room_id and p.removed_at is null),
      'polls', (select count(*) from public.polls pl where pl.room_id = p_room_id and pl.removed_at is null),
      'songs', (select count(*) from public.soundtrack_tracks t where t.room_id = p_room_id and t.ready)
    )
  );
end $$;

create or replace function public.admin_list_rooms() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'visibility', r.visibility, 'mode', r.mode, 'features', r.features,
      'member_limit', r.member_limit, 'is_closed', r.is_closed, 'archived_at', r.archived_at,
      'created_at', r.created_at, 'last_activity_at', r.last_activity_at,
      'owner', (select p.display_name from public.profiles p where p.id = r.owner_id),
      'book_title', b.title, 'book_id', b.id,
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'display_name', p.display_name, 'role', m.role, 'status', m.status,
          'furthest', coalesce(rp.furthest, 0), 'last_read_at', rp.last_read_at
        ) order by m.joined_at), '[]'::jsonb)
        from public.room_members m
        join public.profiles p on p.id = m.user_id
        left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
        where m.room_id = r.id
      ),
      'notes', (select count(*) from public.annotation_markers k where k.room_id = r.id and k.published_at is not null and k.removed_at is null),
      'replies', (select count(*) from public.annotation_replies y where y.room_id = r.id and y.removed_at is null),
      'predictions', (select count(*) from public.predictions p where p.room_id = r.id and p.removed_at is null),
      'polls', (select count(*) from public.polls p where p.room_id = r.id and p.removed_at is null)
    ) order by r.last_activity_at desc), '[]'::jsonb)
    from public.rooms r
    join public.books b on b.id = r.book_id
  );
end $$;

-- ----------------------------------------------------------------------------
-- 11. The RPC surface for this migration
-- ----------------------------------------------------------------------------
revoke all on function
  private.alpha_capacity(), private.alpha_seats_used(), private.room_feature(uuid, text),
  private.require_feature(uuid, text), private.book_chapters(uuid), private.check_afterparties(uuid),
  private.progress_after_change(), private.viewer_progress(uuid)
from public, anon, authenticated;

revoke all on function
  public.alpha_seats(), public.claim_alpha_seat(), public.admin_set_alpha_seats(integer),
  public.set_room_features(uuid, jsonb), public.set_book_outline(uuid, jsonb),
  public.seal_prediction(uuid, text, numeric, text, numeric, text, text, boolean),
  public.reveal_prediction(uuid, text), public.remove_prediction(uuid),
  public.create_poll(uuid, numeric, jsonb, text, text, jsonb), public.vote_poll(uuid, integer), public.remove_poll(uuid),
  public.create_annotation(uuid, numeric, jsonb, text, text, text, text, text, boolean, text, uuid, text, text),
  public.create_ritual(uuid, text, text, text, numeric, numeric, text, timestamptz, uuid),
  public.end_ritual(uuid), public.checkin_ritual(uuid), public.rate_book(uuid, integer, text),
  public.room_layer(uuid), public.room_away(uuid, boolean), public.reading_echoes(uuid), public.room_vault(uuid)
from public, anon;

grant execute on function
  public.alpha_seats(), public.claim_alpha_seat(), public.admin_set_alpha_seats(integer),
  public.set_room_features(uuid, jsonb), public.set_book_outline(uuid, jsonb),
  public.seal_prediction(uuid, text, numeric, text, numeric, text, text, boolean),
  public.reveal_prediction(uuid, text), public.remove_prediction(uuid),
  public.create_poll(uuid, numeric, jsonb, text, text, jsonb), public.vote_poll(uuid, integer), public.remove_poll(uuid),
  public.create_annotation(uuid, numeric, jsonb, text, text, text, text, text, boolean, text, uuid, text, text),
  public.create_ritual(uuid, text, text, text, numeric, numeric, text, timestamptz, uuid),
  public.end_ritual(uuid), public.checkin_ritual(uuid), public.rate_book(uuid, integer, text),
  public.room_layer(uuid), public.room_away(uuid, boolean), public.reading_echoes(uuid), public.room_vault(uuid)
to authenticated;
