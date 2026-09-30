-- =============================================================================
-- 0400 · Notifications, room activity, alpha feedback, moderation log
-- =============================================================================

-- Attachments always belong to their marker's room (the path check then holds
-- the uploader to {room_id}/{marker_id}/…).
create function private.attachments_set_room() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select m.room_id into new.room_id from public.annotation_markers m where m.id = new.marker_id;
  if new.room_id is null then
    raise exception 'marker_not_found';
  end if;
  return new;
end $$;

create trigger annotation_attachments_set_room before insert on public.annotation_attachments
  for each row execute function private.attachments_set_room();

-- ----------------------------------------------------------------------------
-- notifications (restrained: replies, reactions, discoveries, joins, invites)
-- ----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in (
               'reply',          -- someone replied to your note / a thread you are in
               'reaction',       -- someone reacted to your note
               'unlocked',       -- someone reached something you left
               'note_behind',    -- someone left a note at a place you already passed
               'member_joined',  -- someone joined a room you run
               'invited',        -- you were invited to a room
               'finished',       -- a room-mate finished the book
               'role_changed',   -- your role in a room changed
               'removed',        -- you were removed from a room
               'room_changed'    -- a room you are in was closed / archived / reshaped
             )),
  room_id    uuid references public.rooms (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  marker_id  uuid references public.annotation_markers (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,   -- never contains note content
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ----------------------------------------------------------------------------
-- room_activity (spoiler-free; never every page turn)
-- ----------------------------------------------------------------------------
create table public.room_activity (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  type       text not null check (type in (
               'room_created', 'joined', 'left', 'removed', 'started_reading',
               'chapter_completed', 'milestone', 'finished', 'passed',
               'note_left', 'replied', 'room_updated', 'room_archived'
             )),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index room_activity_room_idx on public.room_activity (room_id, created_at desc);

create function private.bump_room_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.rooms set last_activity_at = new.created_at where id = new.room_id;
  return new;
end $$;

create trigger room_activity_bump after insert on public.room_activity
  for each row execute function private.bump_room_activity();

-- ----------------------------------------------------------------------------
-- alpha_feedback
-- ----------------------------------------------------------------------------
create table public.alpha_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  category   text not null check (category in ('bug', 'confusing', 'idea', 'love')),
  message    text not null check (char_length(btrim(message)) between 1 and 5000),
  route      text check (route is null or char_length(route) <= 500),
  room_id    uuid references public.rooms (id) on delete set null,
  book_id    uuid references public.books (id) on delete set null,
  -- location label, normalized progress, viewport, device class, user agent.
  -- Never book text.
  context    jsonb not null default '{}'::jsonb,
  status     text not null default 'new' check (status in ('new', 'seen', 'done')),
  admin_note text,
  created_at timestamptz not null default now()
);

create index alpha_feedback_created_idx on public.alpha_feedback (created_at desc);

-- ----------------------------------------------------------------------------
-- client_errors: a tiny error log so the alpha admin can see what broke
-- ----------------------------------------------------------------------------
create table public.client_errors (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete cascade,
  route      text check (route is null or char_length(route) <= 500),
  message    text not null check (char_length(message) <= 2000),
  stack      text check (stack is null or char_length(stack) <= 6000),
  context    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index client_errors_created_idx on public.client_errors (created_at desc);

-- ----------------------------------------------------------------------------
-- moderation_actions
-- ----------------------------------------------------------------------------
create table public.moderation_actions (
  id               bigint generated always as identity primary key,
  room_id          uuid references public.rooms (id) on delete cascade,
  actor_id         uuid references public.profiles (id) on delete set null,
  action           text not null check (action in (
                     'remove_member', 'remove_annotation', 'remove_reply', 'revoke_invite',
                     'close_room', 'reopen_room', 'archive_room', 'set_role', 'transfer_ownership',
                     'rotate_link', 'admin_disable_user', 'admin_enable_user', 'admin_archive_room',
                     'admin_disable_book', 'admin_enable_book', 'admin_remove_annotation'
                   )),
  target_user_id   uuid references public.profiles (id) on delete set null,
  target_marker_id uuid references public.annotation_markers (id) on delete set null,
  target_id        text,
  reason           text check (reason is null or char_length(reason) <= 500),
  created_at       timestamptz not null default now()
);

create index moderation_actions_room_idx on public.moderation_actions (room_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.room_activity enable row level security;
alter table public.alpha_feedback enable row level security;
alter table public.client_errors enable row level security;
alter table public.moderation_actions enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy room_activity_select on public.room_activity for select to authenticated
  using ((select private.is_room_member(room_id)));

create policy alpha_feedback_insert on public.alpha_feedback for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy alpha_feedback_select on public.alpha_feedback for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy alpha_feedback_admin_update on public.alpha_feedback for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy client_errors_insert on public.client_errors for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy client_errors_select on public.client_errors for select to authenticated
  using ((select private.is_admin()));

create policy moderation_actions_select on public.moderation_actions for select to authenticated
  using ((select private.is_admin()) or (room_id is not null and (select private.is_room_staff(room_id))));

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.notifications, public.room_activity, public.alpha_feedback,
  public.client_errors, public.moderation_actions
  from anon, authenticated;

grant select on public.notifications, public.room_activity, public.alpha_feedback,
  public.client_errors, public.moderation_actions
  to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (user_id, category, message, route, room_id, book_id, context) on public.alpha_feedback to authenticated;
grant update (status, admin_note) on public.alpha_feedback to authenticated;
grant insert (user_id, route, message, stack, context) on public.client_errors to authenticated;
