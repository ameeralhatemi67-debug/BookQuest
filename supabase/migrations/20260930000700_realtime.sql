-- =============================================================================
-- 0700 · Realtime
-- =============================================================================
-- Realtime is delivery; Postgres is truth. The app works with Realtime down —
-- it just refreshes less eagerly.
--
-- 1. Postgres Changes: the tables below are published. Realtime evaluates each
--    table's SELECT policy per subscriber, so a change to protected content is
--    only delivered to readers who have unlocked it.
-- 2. Presence ("who is reading right now") runs on private channels named
--    `room:{room_id}`. The policies on realtime.messages restrict those
--    channels to active members of that room.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'reading_progress', 'annotation_markers', 'annotation_contents', 'annotation_replies',
    'annotation_reactions', 'reading_unlocks', 'room_members', 'room_activity',
    'notifications', 'rooms'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Private channel authorization (Presence + Broadcast)
-- ----------------------------------------------------------------------------
create function private.topic_room_id(p_topic text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_topic like 'room:%' then private.safe_uuid(split_part(p_topic, ':', 2)) end;
$$;

create policy "room members can listen on their room channel"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select private.is_room_member(private.topic_room_id((select realtime.topic()))))
  );

create policy "room members can send on their room channel"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select private.is_room_member(private.topic_room_id((select realtime.topic()))))
  );
