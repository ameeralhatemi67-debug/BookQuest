-- =============================================================================
-- 0510 · RPC: progress, unlocking, annotations, replies, reactions
-- =============================================================================

-- ----------------------------------------------------------------------------
-- save_progress: the heart of the loop.
--   Read → Progress → Discover → Unlock
-- Records where the reader is, advances their furthest point (never backwards)
-- and — in the same transaction — grants unlocks for every note they have now
-- reached. Returns the ids that were unlocked by this very call so the reader
-- can play the reveal.
-- ----------------------------------------------------------------------------
create function public.save_progress(
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
  v_completed := v_prev.completed_at is null and v_new >= 0.995;

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

-- ----------------------------------------------------------------------------
-- Annotations
-- ----------------------------------------------------------------------------

-- Makes a draft visible to the room as a neutral marker. Readers who already
-- passed this point get access immediately (and a gentle heads-up); everyone
-- else discovers it when they arrive.
create function private.publish_marker(p_marker_id uuid) returns void
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

create function private.clean_link(p_url text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v is null then
    return null;
  end if;
  if v !~* '^https?://[^\s]+$' or char_length(v) > 2000 then
    raise exception 'invalid_link';
  end if;
  return v;
end $$;

-- Creates a note at a place in the book. With p_publish = false the note stays
-- a private draft while its media uploads; publish_annotation then releases it.
create function public.create_annotation(
  p_room_id uuid,
  p_position numeric,
  p_anchor jsonb,
  p_location_label text default null,
  p_body text default null,
  p_emoji text default null,
  p_link_url text default null,
  p_quote text default null,
  p_publish boolean default true
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
  if p_publish and v_body is null and v_emoji is null and v_link is null then
    raise exception 'empty_note';
  end if;

  insert into public.annotation_markers (room_id, book_id, author_id, position, anchor, location_label)
  values (p_room_id, v_room.book_id, v_uid, round(p_position, 6), p_anchor, nullif(left(p_location_label, 200), ''))
  returning id into v_id;

  insert into public.annotation_contents (marker_id, room_id, body, emoji, link_url, quote)
  values (v_id, p_room_id, v_body, v_emoji, v_link, v_quote);

  if p_publish then
    perform private.publish_marker(v_id);
  end if;
  return v_id;
end $$;

create function public.publish_annotation(p_marker_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_c   public.annotation_contents%rowtype;
begin
  if not private.is_draft_author(p_marker_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_c from public.annotation_contents c where c.marker_id = p_marker_id;
  if v_c.body is null and v_c.emoji is null and v_c.link_url is null
     and not exists (select 1 from public.annotation_attachments a where a.marker_id = p_marker_id) then
    raise exception 'empty_note';
  end if;
  perform private.publish_marker(p_marker_id);
end $$;

create function public.update_annotation(
  p_marker_id uuid, p_body text default null, p_emoji text default null, p_link_url text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_alpha();
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_link  text := private.clean_link(p_link_url);
begin
  if not private.is_annotation_author(p_marker_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(coalesce(v_body, '')) > 10000 or char_length(coalesce(v_emoji, '')) > 16 then
    raise exception 'note_too_long';
  end if;
  if v_body is null and v_emoji is null and v_link is null
     and not exists (select 1 from public.annotation_attachments a where a.marker_id = p_marker_id) then
    raise exception 'empty_note';
  end if;
  update public.annotation_contents
     set body = v_body, emoji = v_emoji, link_url = v_link, edited_at = now()
   where marker_id = p_marker_id;
end $$;

-- Author may take their own note down; room staff may remove an inappropriate
-- one (logged). Removal is soft: the payload simply stops being readable.
create function public.remove_annotation(p_marker_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_marker public.annotation_markers%rowtype;
begin
  select * into v_marker from public.annotation_markers m where m.id = p_marker_id for update;
  if not found or not private.is_room_member(v_marker.room_id) then
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

-- Records that the reader actually opened notes they had unlocked.
create function public.mark_annotations_seen(p_marker_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.reading_unlocks
     set seen_at = now()
   where user_id = (select auth.uid())
     and marker_id = any (p_marker_ids)
     and seen_at is null;
$$;

-- ----------------------------------------------------------------------------
-- Replies & reactions (only ever on notes the caller can already see)
-- ----------------------------------------------------------------------------
create function public.add_reply(p_marker_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_marker public.annotation_markers%rowtype;
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     uuid;
  r        record;
begin
  if not private.can_view_annotation(p_marker_id) then
    raise exception 'note_unavailable' using errcode = '42501';
  end if;
  select * into v_marker from public.annotation_markers m where m.id = p_marker_id;
  if v_marker.published_at is null then
    raise exception 'note_unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from public.rooms r2 where r2.id = v_marker.room_id and r2.archived_at is not null) then
    raise exception 'room_archived';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_reply';
  end if;

  insert into public.annotation_replies (marker_id, room_id, author_id, body)
  values (p_marker_id, v_marker.room_id, v_uid, v_body)
  returning id into v_id;

  -- The note's author, plus anyone already in the thread.
  for r in
    select distinct x.user_id
    from (
      select v_marker.author_id as user_id
      union
      select rp.author_id from public.annotation_replies rp
       where rp.marker_id = p_marker_id and rp.removed_at is null
    ) x
    where x.user_id <> v_uid and private.is_member_user(v_marker.room_id, x.user_id)
  loop
    perform private.notify(r.user_id, 'reply', v_marker.room_id, v_uid, p_marker_id,
      jsonb_build_object('reply_id', v_id, 'label', v_marker.location_label, 'own_note', r.user_id = v_marker.author_id));
  end loop;

  -- Activity is spoiler-free and rate-limited per person per thread.
  if not exists (
    select 1 from public.room_activity a
    where a.room_id = v_marker.room_id and a.actor_id = v_uid and a.type = 'replied'
      and a.data ->> 'marker_id' = p_marker_id::text
      and a.created_at > now() - interval '30 minutes'
  ) then
    perform private.log_activity(v_marker.room_id, v_uid, 'replied',
      jsonb_build_object('marker_id', p_marker_id, 'label', v_marker.location_label));
  end if;

  return v_id;
end $$;

create function public.remove_reply(p_reply_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_alpha();
  v_reply public.annotation_replies%rowtype;
begin
  select * into v_reply from public.annotation_replies rp where rp.id = p_reply_id for update;
  if not found or not private.is_room_member(v_reply.room_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_reply.removed_at is not null then
    return;
  end if;
  if v_reply.author_id <> v_uid and not private.is_room_staff(v_reply.room_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.annotation_replies set removed_at = now(), removed_by = v_uid where id = p_reply_id;

  if v_reply.author_id <> v_uid then
    perform private.log_moderation(v_reply.room_id, v_uid, 'remove_reply', v_reply.author_id, v_reply.marker_id, p_reply_id::text, p_reason);
  end if;
end $$;

-- Returns true when the reaction is now present, false when it was taken back.
create function public.toggle_reaction(p_marker_id uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_marker public.annotation_markers%rowtype;
  v_emoji  text := btrim(coalesce(p_emoji, ''));
begin
  if not private.can_view_annotation(p_marker_id) then
    raise exception 'note_unavailable' using errcode = '42501';
  end if;
  if char_length(v_emoji) not between 1 and 16 then
    raise exception 'invalid_reaction';
  end if;
  select * into v_marker from public.annotation_markers m where m.id = p_marker_id;

  delete from public.annotation_reactions
   where marker_id = p_marker_id and user_id = v_uid and emoji = v_emoji;
  if found then
    return false;
  end if;

  insert into public.annotation_reactions (marker_id, room_id, user_id, emoji)
  values (p_marker_id, v_marker.room_id, v_uid, v_emoji);

  -- At most one unread reaction notification per person per note.
  if private.is_member_user(v_marker.room_id, v_marker.author_id) and not exists (
    select 1 from public.notifications n
    where n.user_id = v_marker.author_id and n.type = 'reaction' and n.actor_id = v_uid
      and n.marker_id = p_marker_id and n.read_at is null
  ) then
    perform private.notify(v_marker.author_id, 'reaction', v_marker.room_id, v_uid, p_marker_id,
      jsonb_build_object('label', v_marker.location_label));
  end if;
  return true;
end $$;

-- ----------------------------------------------------------------------------
-- Notifications
-- ----------------------------------------------------------------------------
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.notifications
     set read_at = now()
   where user_id = (select auth.uid())
     and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
