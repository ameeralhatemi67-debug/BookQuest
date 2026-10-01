-- Private note audiences and timed, revisitable reading coverage.
alter table public.annotation_markers
  add column recipient_id uuid references public.profiles(id) on delete cascade,
  add column attention text not null default 'gentle' check (attention in ('quiet', 'gentle', 'playful'));
create index annotation_markers_recipient_idx on public.annotation_markers(recipient_id) where recipient_id is not null;

alter policy annotation_markers_select on public.annotation_markers using (
  removed_at is null and private.is_room_member(room_id)
  and (published_at is not null or author_id = auth.uid())
  and (recipient_id is null or recipient_id = auth.uid() or author_id = auth.uid())
);

alter table public.reading_progress
  add column read_coverage numeric(7,6) not null default 0 check (read_coverage between 0 and 1),
  add column active_reading_seconds numeric not null default 0,
  add column estimated_wpm numeric not null default 240,
  add column pace_samples integer not null default 0,
  add column coverage_sampled_at timestamptz not null default now();

-- No client table access: samples and receipts are written only by the checked RPC.
create table private.reading_coverage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  bin smallint not null check (bin between 0 and 999),
  credit numeric not null check (credit between 0 and 1),
  seconds numeric not null,
  primary key(user_id, room_id, bin)
);
create table private.reading_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  sample_id uuid not null,
  accepted_seconds numeric not null,
  created_at timestamptz not null default now(),
  primary key(user_id, room_id, sample_id)
);
alter table private.reading_coverage enable row level security;
alter table private.reading_receipts enable row level security;
revoke all on private.reading_coverage, private.reading_receipts from public, anon, authenticated;

create or replace function private.can_view_annotation(p_marker_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.annotation_markers m
    where m.id = p_marker_id
      and m.removed_at is null
      and (m.recipient_id is null or m.recipient_id = auth.uid() or m.author_id = auth.uid())
      and private.is_room_member(m.room_id)
      and (
        m.author_id = (select auth.uid())
        or (
          m.published_at is not null
          and exists (
            select 1 from public.reading_unlocks u
            where u.marker_id = m.id and u.user_id = (select auth.uid())
          )
        )
      )
  );
$$;
create or replace function private.log_activity(p_room_id uuid, p_actor_id uuid, p_type text, p_data jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.room_activity (room_id, actor_id, type, data)
  select p_room_id, p_actor_id, p_type, coalesce(p_data, '{}'::jsonb)
  where not exists (select 1 from public.annotation_markers k
    where k.id::text = p_data ->> 'marker_id' and k.recipient_id is not null);
$$;
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

  perform private.log_activity(v_marker.room_id, v_marker.author_id, 'note_left',
    jsonb_build_object('marker_id', v_marker.id, 'label', v_marker.location_label));
end $$;
drop function public.create_annotation(uuid,numeric,jsonb,text,text,text,text,text,boolean);
create or replace function public.create_annotation(
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
  p_recipient_id uuid default null
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
  if p_attention is null or p_attention not in ('quiet', 'gentle', 'playful') then
    raise exception 'invalid_attention';
  end if;
  if p_recipient_id is not null and not private.is_member_user(p_room_id, p_recipient_id) then
    raise exception 'invalid_recipient' using errcode = '42501';
  end if;
  if p_publish and v_body is null and v_emoji is null and v_link is null then
    raise exception 'empty_note';
  end if;

  insert into public.annotation_markers (room_id, book_id, author_id, position, anchor, location_label, attention, recipient_id)
  values (p_room_id, v_room.book_id, v_uid, round(p_position, 6), p_anchor, nullif(left(p_location_label, 200), ''), p_attention, p_recipient_id)
  returning id into v_id;

  insert into public.annotation_contents (marker_id, room_id, body, emoji, link_url, quote)
  values (v_id, p_room_id, v_body, v_emoji, v_link, v_quote);

  if p_publish then
    perform private.publish_marker(v_id);
  end if;
  return v_id;
end $$;
revoke all on function public.create_annotation(uuid,numeric,jsonb,text,text,text,text,text,boolean,text,uuid) from public, anon;
grant execute on function public.create_annotation(uuid,numeric,jsonb,text,text,text,text,text,boolean,text,uuid) to authenticated;

create or replace function public.save_progress(
  p_room_id uuid,
  p_position numeric,
  p_anchor jsonb default null,
  p_label text default null,
  p_chapter_index integer default null,
  p_chapter_label text default null,
  p_seconds integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_alpha();
  v_room      public.rooms%rowtype;
  v_prev      public.reading_progress%rowtype;
  v_pos       numeric := round(least(greatest(coalesce(p_position, 0), 0), 1), 6);
  v_secs      integer := least(greatest(coalesce(p_seconds, 0), 0), 300);
  v_first     boolean := false;
  v_old       numeric := 0;
  v_new       numeric;
  v_completed boolean := false;
  v_unlocked  uuid[] := '{}';
  v_pct       integer;
  r           record;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select * into v_room from public.rooms where id = p_room_id;

  insert into public.reading_progress (user_id, room_id, book_id)
  values (v_uid, p_room_id, v_room.book_id)
  on conflict (user_id, room_id) do nothing;
  v_first := found;

  select * into v_prev from public.reading_progress
   where user_id = v_uid and room_id = p_room_id for update;

  v_old := v_prev.furthest;
  v_new := greatest(v_old, v_pos);
  -- Browsing alone never completes the book. record_reading_session earns completion.

  update public.reading_progress
     set position = v_pos,
         furthest = v_new,
         anchor = coalesce(p_anchor, anchor),
         label = coalesce(nullif(left(p_label, 200), ''), label),
         chapter_index = coalesce(p_chapter_index, chapter_index),
         chapter_label = coalesce(nullif(left(p_chapter_label, 200), ''), chapter_label),
         furthest_chapter_index = case
           when p_chapter_index is not null and v_pos >= v_old
             then greatest(coalesce(furthest_chapter_index, p_chapter_index), p_chapter_index)
           else furthest_chapter_index end,
         furthest_chapter_label = case
           when p_chapter_index is not null and v_pos >= v_old
                and p_chapter_index >= coalesce(furthest_chapter_index, p_chapter_index)
             then coalesce(nullif(left(p_chapter_label, 200), ''), furthest_chapter_label)
           else furthest_chapter_label end,
         reading_seconds = reading_seconds + v_secs,
         last_read_at = now(),
         completed_at = case when v_completed then now() else completed_at end
   where user_id = v_uid and room_id = p_room_id;

  -- Unlock everything this reader has now reached. Authors never need a grant.
  if v_new > v_old or v_first then
    with granted as (
      insert into public.reading_unlocks (user_id, marker_id, room_id, via)
      select v_uid, m.id, m.room_id, 'reached'
      from public.annotation_markers m
      where m.room_id = p_room_id
        and m.published_at is not null
        and m.removed_at is null
        and m.author_id <> v_uid
        and (m.recipient_id is null or m.recipient_id = v_uid)
        and m.position <= v_new
      on conflict do nothing
      returning marker_id
    )
    select coalesce(array_agg(marker_id), '{}') into v_unlocked from granted;

    -- One quiet notification per author, however many notes were reached.
    if cardinality(v_unlocked) > 0 then
      for r in
        select m.author_id, count(*)::integer as n, (array_agg(m.id order by m.position))[1] as first_marker,
               (array_agg(m.location_label order by m.position))[1] as first_label
        from public.annotation_markers m
        where m.id = any (v_unlocked) and private.is_member_user(p_room_id, m.author_id)
        group by m.author_id
      loop
        perform private.notify(r.author_id, 'unlocked', p_room_id, v_uid, r.first_marker,
          jsonb_build_object('count', r.n, 'label', r.first_label));
      end loop;
    end if;
  end if;

  -- Activity: meaningful moments only.
  if v_first then
    perform private.log_activity(p_room_id, v_uid, 'started_reading');
  end if;

  if p_chapter_index is not null and v_prev.furthest_chapter_index is not null
     and p_chapter_index = v_prev.furthest_chapter_index + 1
     and v_pos >= v_old
     and v_prev.furthest_chapter_label is not null then
    perform private.log_activity(p_room_id, v_uid, 'chapter_completed',
      jsonb_build_object('chapter', v_prev.furthest_chapter_label, 'chapter_index', v_prev.furthest_chapter_index));
  end if;

  foreach v_pct in array array[25, 50, 75] loop
    if v_old < v_pct / 100.0 and v_new >= v_pct / 100.0 and v_new < 0.995 then
      perform private.log_activity(p_room_id, v_uid, 'milestone', jsonb_build_object('percent', v_pct));
    end if;
  end loop;

  if v_room.mode = 'race' and v_new > v_old then
    for r in
      select rp.user_id
      from public.reading_progress rp
      where rp.room_id = p_room_id and rp.user_id <> v_uid
        and rp.furthest > v_old and rp.furthest < v_new and rp.furthest > 0
        and private.is_member_user(p_room_id, rp.user_id)
        -- Two readers leap-frogging each other is one story, not twenty:
        -- the same overtake is recorded at most once per half day.
        and not exists (
          select 1 from public.room_activity a
          where a.room_id = p_room_id and a.actor_id = v_uid and a.type = 'passed'
            and a.data ->> 'passed_user_id' = rp.user_id::text
            and a.created_at > now() - interval '12 hours'
        )
    loop
      perform private.log_activity(p_room_id, v_uid, 'passed', jsonb_build_object('passed_user_id', r.user_id));
    end loop;
  end if;

  if v_completed then
    perform private.log_activity(p_room_id, v_uid, 'finished');
    for r in select m.user_id from public.room_members m where m.room_id = p_room_id and m.status = 'active' loop
      perform private.notify(r.user_id, 'finished', p_room_id, v_uid);
    end loop;
  end if;

  return jsonb_build_object(
    'position', v_pos,
    'furthest', v_new,
    'first', v_first,
    'completed', v_completed,
    'unlocked', to_jsonb(v_unlocked)
  );
end $$;
create or replace function public.remove_annotation(p_marker_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_marker public.annotation_markers%rowtype;
begin
  select * into v_marker from public.annotation_markers m where m.id = p_marker_id for update;
  if not found or not private.is_room_member(v_marker.room_id)
     or (v_marker.recipient_id is not null and v_marker.recipient_id <> v_uid and v_marker.author_id <> v_uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_marker.removed_at is not null then
    return;
  end if;
  if v_marker.author_id <> v_uid and not private.is_room_staff(v_marker.room_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.annotation_markers set removed_at = now(), removed_by = v_uid where id = p_marker_id;

  if v_marker.author_id <> v_uid then
    perform private.log_moderation(v_marker.room_id, v_uid, 'remove_annotation', v_marker.author_id, p_marker_id, null, p_reason);
  end if;
end $$;
create or replace function private.room_members_json(p_room_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', p.display_name,
      'avatar_path', p.avatar_path,
      'role', m.role,
      'joined_at', m.joined_at,
      'read_coverage', coalesce(rp.read_coverage, 0), 'estimated_wpm', coalesce(rp.estimated_wpm, 240), 'pace_samples', coalesce(rp.pace_samples, 0), 'active_reading_seconds', coalesce(rp.active_reading_seconds, 0),
      'position', coalesce(rp.position, 0),
      'furthest', coalesce(rp.furthest, 0),
      'label', rp.label,
      'started_at', rp.started_at,
      'last_read_at', rp.last_read_at,
      'completed_at', rp.completed_at
    ) order by coalesce(rp.furthest, 0) desc, m.joined_at), '[]'::jsonb)
  from public.room_members m
  join public.profiles p on p.id = m.user_id
  left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
  where m.room_id = p_room_id and m.status = 'active';
$$;
create or replace function private.room_card(p_room public.rooms, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_room.id,
    'name', p_room.name,
    'description', p_room.description,
    'visibility', p_room.visibility,
    'mode', p_room.mode,
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
    -- Things friends left that the viewer has not reached yet.
    'waiting', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and (k.recipient_id is null or k.recipient_id = p_viewer or k.author_id = p_viewer) and k.published_at is not null and k.removed_at is null
        and k.author_id <> p_viewer
        and not exists (select 1 from public.reading_unlocks u where u.marker_id = k.id and u.user_id = p_viewer)
    ),
    -- Things the viewer has reached but not opened yet.
    'unseen', (
      select count(*) from public.reading_unlocks u
      join public.annotation_markers k on k.id = u.marker_id
      where u.room_id = p_room.id and u.user_id = p_viewer and u.seen_at is null
        and k.removed_at is null and (k.recipient_id is null or k.recipient_id = p_viewer or k.author_id = p_viewer) and k.published_at is not null
    ),
    'note_count', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and (k.recipient_id is null or k.recipient_id = p_viewer or k.author_id = p_viewer) and k.published_at is not null and k.removed_at is null
    )
  );
$$;
create or replace function public.room_journey(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_alpha();
  v_room     public.rooms%rowtype;
  v_furthest numeric;
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  select * into v_room from public.rooms r where r.id = p_room_id;
  select coalesce(max(rp.furthest), 0) into v_furthest
    from public.reading_progress rp where rp.room_id = p_room_id and rp.user_id = v_uid;

  return jsonb_build_object(
    'room', jsonb_build_object('id', v_room.id, 'name', v_room.name, 'mode', v_room.mode,
                               'created_at', v_room.created_at, 'archived_at', v_room.archived_at),
    'book', private.book_json(v_room.book_id),
    'viewer_furthest', v_furthest,
    'readers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
        'status', m.status, 'role', m.role, 'joined_at', m.joined_at,
        'furthest', coalesce(rp.furthest, 0),
        'started_at', rp.started_at, 'completed_at', rp.completed_at, 'last_read_at', rp.last_read_at,
        'reading_seconds', coalesce(rp.reading_seconds, 0),
        'notes', (select count(*) from public.annotation_markers k
                   where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and k.room_id = p_room_id and k.author_id = m.user_id
                     and k.published_at is not null and k.removed_at is null),
        'replies', (select count(*) from public.annotation_replies y join public.annotation_markers k on k.id = y.marker_id
                     where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and y.room_id = p_room_id and y.author_id = m.user_id and y.removed_at is null),
        'discoveries', (select count(*) from public.reading_unlocks u join public.annotation_markers k on k.id = u.marker_id
                         where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and u.room_id = p_room_id and u.user_id = m.user_id and u.via = 'reached')
      ) order by rp.completed_at nulls last, coalesce(rp.furthest, 0) desc), '[]'::jsonb)
      from public.room_members m
      join public.profiles p on p.id = m.user_id
      left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
      where m.room_id = p_room_id and (m.status = 'active' or rp.user_id is not null)
    ),
    'totals', jsonb_build_object(
      'notes', (select count(*) from public.annotation_markers k
                 where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and k.room_id = p_room_id and k.published_at is not null and k.removed_at is null),
      'replies', (select count(*) from public.annotation_replies y
                   join public.annotation_markers k on k.id = y.marker_id
                  where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and y.room_id = p_room_id and y.removed_at is null and k.removed_at is null),
      'reactions', (select count(*) from public.annotation_reactions x
                     join public.annotation_markers k on k.id = x.marker_id
                    where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and x.room_id = p_room_id and k.removed_at is null),
      'images', (select count(*) from public.annotation_attachments a
                  join public.annotation_markers k on k.id = a.marker_id
                 where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and a.room_id = p_room_id and a.kind = 'image' and k.removed_at is null and k.published_at is not null),
      'audio', (select count(*) from public.annotation_attachments a
                 join public.annotation_markers k on k.id = a.marker_id
                where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and a.room_id = p_room_id and a.kind = 'audio' and k.removed_at is null and k.published_at is not null),
      'video', (select count(*) from public.annotation_attachments a
                 join public.annotation_markers k on k.id = a.marker_id
                where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and a.room_id = p_room_id and a.kind = 'video' and k.removed_at is null and k.published_at is not null),
      'discoveries', (select count(*) from public.reading_unlocks u
                       join public.annotation_markers k on k.id = u.marker_id
                      where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and u.room_id = p_room_id and u.via = 'reached' and k.removed_at is null),
      'reading_seconds', (select coalesce(sum(rp.reading_seconds), 0) from public.reading_progress rp where rp.room_id = p_room_id)
    ),
    'first_started_at', (select min(rp.started_at) from public.reading_progress rp where rp.room_id = p_room_id),
    'last_read_at', (select max(rp.last_read_at) from public.reading_progress rp where rp.room_id = p_room_id),
    -- Conversation density per 5% of the book, only for the part the viewer has read.
    'sections', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', s.bucket, 'notes', s.notes, 'replies', s.replies, 'label', s.label)
                                order by s.bucket), '[]'::jsonb)
      from (
        select least(floor(k.position * 20)::integer, 19) as bucket,
               count(distinct k.id) as notes,
               count(y.id) as replies,
               min(k.location_label) as label
        from public.annotation_markers k
        left join public.annotation_replies y on y.marker_id = k.id and y.removed_at is null
        where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and k.room_id = p_room_id and k.published_at is not null and k.removed_at is null
          and k.position <= v_furthest
        group by 1
      ) s
    ),
    -- Notes the viewer can open, in book order (content is fetched through RLS).
    'moments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'marker_id', k.id, 'author_id', k.author_id, 'position', k.position,
        'label', k.location_label, 'created_at', k.published_at,
        'replies', (select count(*) from public.annotation_replies y where y.marker_id = k.id and y.removed_at is null),
        'reactions', (select count(*) from public.annotation_reactions x where x.marker_id = k.id),
        'media', (select coalesce(jsonb_agg(distinct a.kind), '[]'::jsonb) from public.annotation_attachments a where a.marker_id = k.id)
      ) order by k.position, k.published_at), '[]'::jsonb)
      from public.annotation_markers k
      where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and k.room_id = p_room_id and k.published_at is not null and k.removed_at is null
        and private.can_view_annotation(k.id)
    ),
    -- "Amir discovered a note Sara had left nine days earlier."
    'discoveries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'marker_id', k.id, 'reader_id', u.user_id, 'author_id', k.author_id,
        'position', k.position, 'label', k.location_label,
        'left_at', k.published_at, 'discovered_at', u.unlocked_at
      ) order by u.unlocked_at), '[]'::jsonb)
      from public.reading_unlocks u
      join public.annotation_markers k on k.id = u.marker_id
      where (k.recipient_id is null or k.recipient_id = v_uid or k.author_id = v_uid) and u.room_id = p_room_id and u.via = 'reached'
        and k.removed_at is null and k.published_at is not null
        and private.can_view_annotation(k.id)
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'type', a.type, 'actor_id', a.actor_id, 'data', a.data, 'created_at', a.created_at
      ) order by a.created_at), '[]'::jsonb)
      from public.room_activity a
      where a.room_id = p_room_id
        and a.type in ('room_created', 'joined', 'started_reading', 'milestone', 'finished', 'passed')
    )
  );
end $$;
-- Equal location bins accumulate fractional credit across visits and devices.
-- Wall-clock budgets and receipts prevent rapid submissions or retries earning extra time.
create function public.record_reading_session(p_room_id uuid, p_samples jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_room public.rooms%rowtype;
  v_prev public.reading_progress%rowtype;
  v_budget numeric;
  v_total numeric := 0;
  v_coverage numeric;
  v_last numeric;
  v_completed boolean := false;
  v_start numeric;
  v_end numeric;
  v_seconds numeric;
  v_words numeric;
  v_pace numeric;
  v_count integer;
  v_first integer;
  v_final integer;
  v_cost numeric;
  v_pages integer;
  v_id uuid;
  v_accepted jsonb := '[]'::jsonb;
  s jsonb;
  r record;
begin
  if not private.is_room_member(p_room_id) then raise exception 'not_a_member' using errcode = '42501'; end if;
  if jsonb_typeof(p_samples) <> 'array' or jsonb_array_length(p_samples) > 100 then raise exception 'invalid_samples'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  insert into public.reading_progress(user_id,room_id,book_id) values(v_uid,p_room_id,v_room.book_id) on conflict do nothing;
  if found then perform private.log_activity(p_room_id,v_uid,'started_reading'); end if;
  select * into v_prev from public.reading_progress where user_id = v_uid and room_id = p_room_id for update;
  select page_count into v_pages from public.books where id = v_room.book_id;
  v_budget := least(300, greatest(0, extract(epoch from (clock_timestamp() - v_prev.coverage_sampled_at))));
  for s in select value from jsonb_array_elements(p_samples) loop
    v_start := (s->>'start')::numeric; v_end := (s->>'end')::numeric;
    v_seconds := (s->>'seconds')::numeric; v_words := (s->>'words')::numeric;
    if v_start is null or v_end is null or v_seconds is null or v_words is null
       or not (v_start >= 0 and v_start < v_end and v_end <= 1 and v_seconds between 0 and 300 and v_words between 1 and 5000)
       or v_end - v_start > (case when v_pages is null then 1 else greatest(0.15, 2.0 / greatest(v_pages, 1)) end)
       or coalesce(s->>'kind','') not in ('reading','revisiting','scanning') then raise exception 'invalid_sample'; end if;
    v_id := (s->>'id')::uuid;
    if v_id is null then raise exception 'invalid_sample'; end if;
    select accepted_seconds into v_cost from private.reading_receipts where user_id=v_uid and room_id=p_room_id and sample_id=v_id;
    if found then
      v_accepted := v_accepted || jsonb_build_array(jsonb_build_object('id',v_id,'seconds',v_cost));
      continue;
    end if;
    if s->>'kind' = 'scanning' then v_seconds := 0; end if;
    v_seconds := least(v_seconds, v_budget);
    if v_seconds <= 0 then continue; end if;
    insert into private.reading_receipts(user_id,room_id,sample_id,accepted_seconds) values(v_uid,p_room_id,v_id,v_seconds);
    v_accepted := v_accepted || jsonb_build_array(jsonb_build_object('id',v_id,'seconds',v_seconds));
    v_budget := v_budget - v_seconds; v_total := v_total + v_seconds;
    -- Only a settled forward passage calibrates pace; scan/revisit outliers do not.
    v_pace := (s->>'wpm')::numeric;
    if s->>'kind' = 'reading' and v_seconds >= 8 and v_pace between 80 and 600 then
      v_prev.estimated_wpm := least(500, greatest(100, v_prev.estimated_wpm * 0.85 + v_pace * 0.15));
      v_prev.pace_samples := v_prev.pace_samples + 1;
    end if;
    v_first := greatest(0, floor(v_start * 1000)::integer);
    v_final := least(999, ceil(v_end * 1000)::integer - 1);
    v_count := v_final - v_first + 1;
    -- A short or image-only page still needs attention, but has no invented word count.
    v_cost := greatest(0.05, 5.0 * greatest(coalesce(v_pages,20),1) / 1000,
                      v_words * 60.0 / v_prev.estimated_wpm / v_count);
    insert into private.reading_coverage(user_id,room_id,bin,credit,seconds)
      select v_uid,p_room_id,i,least(1,v_seconds/v_count/v_cost),v_seconds/v_count from generate_series(v_first,v_final) i
    on conflict(user_id,room_id,bin) do update set
      credit = least(1,private.reading_coverage.credit + excluded.credit),
      seconds = private.reading_coverage.seconds + excluded.seconds;
  end loop;
  select coalesce(sum(credit),0)/1000, coalesce(avg(credit) filter (where bin >= 990),0)
    into v_coverage,v_last from private.reading_coverage where user_id = v_uid and room_id = p_room_id;
  -- Missing bins at the end must not disappear from the denominator.
  select coalesce(sum(credit),0)/10 into v_last from private.reading_coverage where user_id=v_uid and room_id=p_room_id and bin>=990;
  v_completed := v_prev.completed_at is null and v_coverage >= 0.9 and v_last >= 0.8;
  update public.reading_progress set read_coverage=round(v_coverage,6),
    active_reading_seconds=active_reading_seconds+v_total, estimated_wpm=round(v_prev.estimated_wpm), pace_samples=v_prev.pace_samples,
    coverage_sampled_at=clock_timestamp(), completed_at=case when v_completed then now() else completed_at end
    where user_id=v_uid and room_id=p_room_id;
  if v_completed then
    perform private.log_activity(p_room_id,v_uid,'finished');
    for r in select user_id from public.room_members where room_id=p_room_id and status='active' loop
      perform private.notify(r.user_id,'finished',p_room_id,v_uid);
    end loop;
  end if;
  delete from private.reading_receipts where user_id=v_uid and room_id=p_room_id and created_at < now()-interval '30 days';
  return jsonb_build_object('read_coverage',round(v_coverage,6),'estimated_wpm',round(v_prev.estimated_wpm),
    'pace_samples',v_prev.pace_samples,'active_reading_seconds',v_prev.active_reading_seconds+v_total,'completed',v_completed,'accepted',v_accepted);
end $$;
revoke all on function public.record_reading_session(uuid,jsonb) from public,anon;
grant execute on function public.record_reading_session(uuid,jsonb) to authenticated;
