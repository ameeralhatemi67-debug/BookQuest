-- =============================================================================
-- 0500 · RPC: books, rooms, membership, invitations, moderation
-- =============================================================================
-- Every write to rooms / room_members / room_invites happens here, so
-- visibility, capacity, roles and invitation rules are enforced in exactly one
-- place — never in the browser.

-- ----------------------------------------------------------------------------
-- Shared internals
-- ----------------------------------------------------------------------------
create function private.require_alpha() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_alpha() then
    raise exception 'alpha_access_required' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create function private.log_activity(p_room_id uuid, p_actor_id uuid, p_type text, p_data jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.room_activity (room_id, actor_id, type, data)
  values (p_room_id, p_actor_id, p_type, coalesce(p_data, '{}'::jsonb));
$$;

-- Never notifies the actor themself, nor testers without active access.
create function private.notify(
  p_user_id uuid, p_type text, p_room_id uuid, p_actor_id uuid,
  p_marker_id uuid default null, p_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;
  if not exists (select 1 from public.alpha_testers t where t.user_id = p_user_id and t.status = 'active') then
    return;
  end if;
  insert into public.notifications (user_id, type, room_id, actor_id, marker_id, data)
  values (p_user_id, p_type, p_room_id, p_actor_id, p_marker_id, coalesce(p_data, '{}'::jsonb));
end $$;

create function private.log_moderation(
  p_room_id uuid, p_actor_id uuid, p_action text,
  p_target_user_id uuid default null, p_target_marker_id uuid default null,
  p_target_id text default null, p_reason text default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.moderation_actions (room_id, actor_id, action, target_user_id, target_marker_id, target_id, reason)
  values (p_room_id, p_actor_id, p_action, p_target_user_id, p_target_marker_id, p_target_id, left(p_reason, 500));
$$;

create function private.active_member_count(p_room_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.room_members m where m.room_id = p_room_id and m.status = 'active';
$$;

-- ----------------------------------------------------------------------------
-- Books
-- ----------------------------------------------------------------------------

-- Called by the uploader once the browser → Storage upload has finished.
-- Trusts Storage (not the browser) for the stored size and type.
create function public.finalize_book_upload(p_book_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_book public.books%rowtype;
  v_size bigint;
  v_mime text;
begin
  select * into v_book from public.books b where b.id = p_book_id and b.uploader_id = v_uid for update;
  if not found then
    raise exception 'book_not_found';
  end if;
  if v_book.storage_path is null then
    raise exception 'upload_missing';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_mime
  from storage.objects o
  where o.bucket_id = 'books' and o.name = v_book.storage_path;

  if v_size is null or v_size <= 0 then
    raise exception 'upload_missing';
  end if;
  -- Format ceilings (mirrors src/lib/limits.ts): EPUB 250 MB, PDF 500 MB.
  if (v_book.format = 'epub' and v_size > 262144000) or v_size > 524288000 then
    raise exception 'file_too_large';
  end if;

  update public.books
     set size_bytes = v_size,
         mime_type = coalesce(v_mime, mime_type),
         status = case when status in ('uploading', 'failed') then 'processing' else status end,
         error = null
   where id = p_book_id;

  return jsonb_build_object('size_bytes', v_size, 'mime_type', v_mime);
end $$;

-- Soft-deletes a book. Refused while other people are still reading it.
create function public.delete_book(p_book_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
begin
  if not exists (select 1 from public.books b where b.id = p_book_id and b.uploader_id = v_uid) then
    raise exception 'book_not_found';
  end if;

  if exists (
    select 1
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.status = 'active' and m.user_id <> v_uid
    where r.book_id = p_book_id and r.archived_at is null
  ) then
    raise exception 'book_in_use';
  end if;

  update public.books set status = 'deleted' where id = p_book_id and status <> 'disabled';
end $$;

-- ----------------------------------------------------------------------------
-- Rooms
-- ----------------------------------------------------------------------------
create function public.create_room(
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
     or (v_limit is not null and v_limit not between 2 and 50) then
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

-- Owner: everything. Moderator: only open/close the room to new members.
-- A null argument means "leave unchanged"; pass '' to clear the description
-- and p_clear_member_limit to remove the limit.
create function public.update_room(
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
     or (v_limit is not null and v_limit not between 2 and 50) then
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
    -- Leaving Duo mode lifts the two-reader cap unless a new limit was given.
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

  -- Only changes that alter how the room feels are worth a notification.
  if v_changes && array['visibility', 'mode'] then
    for r in select m.user_id from public.room_members m where m.room_id = p_room_id and m.status = 'active' loop
      perform private.notify(r.user_id, 'room_changed', p_room_id, v_uid, null, jsonb_build_object(
        'changes', to_jsonb(v_changes), 'visibility', v_vis, 'mode', v_mode));
    end loop;
  end if;
end $$;

-- Archiving ends a room: no new members or notes; it remains as a Journey.
create function public.set_room_archived(p_room_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
  r      record;
begin
  if coalesce(private.room_role(p_room_id), '') <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if (v_room.archived_at is not null) = p_archived then
    return;
  end if;

  update public.rooms set archived_at = case when p_archived then now() end where id = p_room_id;

  if p_archived then
    perform private.log_activity(p_room_id, v_uid, 'room_archived');
    perform private.log_moderation(p_room_id, v_uid, 'archive_room');
    for r in select m.user_id from public.room_members m where m.room_id = p_room_id and m.status = 'active' loop
      perform private.notify(r.user_id, 'room_changed', p_room_id, v_uid, null, jsonb_build_object('changes', jsonb_build_array('archived')));
    end loop;
  else
    perform private.log_activity(p_room_id, v_uid, 'room_updated', jsonb_build_object('changes', jsonb_build_array('reopened')));
  end if;
end $$;

-- New room link: every previously shared link stops working.
create function public.rotate_join_code(p_room_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_code text := private.gen_token();
begin
  if coalesce(private.room_role(p_room_id), '') <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.rooms set join_code = v_code where id = p_room_id;
  perform private.log_moderation(p_room_id, v_uid, 'rotate_link');
  return v_code;
end $$;

-- ----------------------------------------------------------------------------
-- Invitations
-- ----------------------------------------------------------------------------
create function public.create_invite(
  p_room_id uuid,
  p_invited_user_id uuid default null,
  p_max_uses integer default 1,
  p_expires_in_days integer default 14
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
  v_inv  public.room_invites%rowtype;
  v_max  integer := p_max_uses;
begin
  if not private.is_room_staff(p_room_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  if v_room.archived_at is not null then
    raise exception 'room_archived';
  end if;

  if (v_max is not null and v_max not between 1 and 50)
     or (p_expires_in_days is not null and p_expires_in_days not between 1 and 90) then
    raise exception 'invalid_invite_settings';
  end if;

  if p_invited_user_id is not null then
    if not exists (select 1 from public.alpha_testers t where t.user_id = p_invited_user_id and t.status = 'active') then
      raise exception 'user_not_found';
    end if;
    if private.is_member_user(p_room_id, p_invited_user_id) then
      raise exception 'already_member';
    end if;
    v_max := 1;
  end if;

  insert into public.room_invites (room_id, created_by, invited_user_id, max_uses, expires_at)
  values (
    p_room_id, v_uid, p_invited_user_id, v_max,
    case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end
  )
  returning * into v_inv;

  if p_invited_user_id is not null then
    perform private.notify(p_invited_user_id, 'invited', p_room_id, v_uid, null,
      jsonb_build_object('invite_id', v_inv.id, 'token', v_inv.token));
  end if;

  return jsonb_build_object('id', v_inv.id, 'token', v_inv.token, 'expires_at', v_inv.expires_at, 'max_uses', v_inv.max_uses);
end $$;

create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_inv public.room_invites%rowtype;
begin
  select * into v_inv from public.room_invites where id = p_invite_id for update;
  if not found or not private.is_room_staff(v_inv.room_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_inv.revoked_at is not null then
    return;
  end if;
  update public.room_invites set revoked_at = now(), revoked_by = v_uid where id = p_invite_id;
  perform private.log_moderation(v_inv.room_id, v_uid, 'revoke_invite', v_inv.invited_user_id, null, v_inv.id::text);
end $$;

-- ----------------------------------------------------------------------------
-- Joining
-- ----------------------------------------------------------------------------

-- The single place membership is granted. The caller must already hold the
-- room row FOR UPDATE, which serializes concurrent joins (capacity is exact).
create function private.join_room(
  p_room public.rooms, p_uid uuid, p_via text, p_invite_id uuid, p_allow_removed boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.room_members%rowtype;
  v_found  boolean;
begin
  select * into v_member from public.room_members m where m.room_id = p_room.id and m.user_id = p_uid;
  v_found := found;

  if v_found and v_member.status = 'active' then
    return jsonb_build_object('room_id', p_room.id, 'status', 'already_member');
  end if;
  if p_room.archived_at is not null then
    raise exception 'room_archived';
  end if;
  if p_room.is_closed then
    raise exception 'room_closed';
  end if;
  if v_found and v_member.status = 'removed' and not p_allow_removed then
    raise exception 'removed_from_room';
  end if;
  if private.active_member_count(p_room.id) >= private.room_capacity(p_room.member_limit) then
    raise exception 'room_full';
  end if;

  if v_found then
    update public.room_members
       set status = 'active', left_at = null, joined_via = p_via, invite_id = p_invite_id,
           role = case when role = 'owner' then 'owner' else 'member' end
     where room_id = p_room.id and user_id = p_uid;
  else
    insert into public.room_members (room_id, user_id, role, joined_via, invite_id)
    values (p_room.id, p_uid, 'member', p_via, p_invite_id);
  end if;

  perform private.log_activity(p_room.id, p_uid, 'joined', jsonb_build_object('rejoined', v_found, 'via', p_via));
  perform private.notify(p_room.owner_id, 'member_joined', p_room.id, p_uid, null, jsonb_build_object('rejoined', v_found));

  return jsonb_build_object('room_id', p_room.id, 'status', 'joined');
end $$;

-- Join with either a personal invitation token or a room link code.
create function public.join_with_token(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_alpha();
  v_inv     public.room_invites%rowtype;
  v_room    public.rooms%rowtype;
  v_member  public.room_members%rowtype;
  v_result  jsonb;
  v_allow   boolean := false;
begin
  select * into v_inv from public.room_invites i where i.token = p_token for update;

  if found then
    select * into v_room from public.rooms r where r.id = v_inv.room_id for update;

    select * into v_member from public.room_members m where m.room_id = v_room.id and m.user_id = v_uid;
    if found and v_member.status = 'active' then
      return jsonb_build_object('room_id', v_room.id, 'status', 'already_member');
    end if;

    if v_inv.revoked_at is not null then
      raise exception 'invite_revoked';
    end if;
    if v_inv.expires_at is not null and v_inv.expires_at <= now() then
      raise exception 'invite_expired';
    end if;
    if v_inv.invited_user_id is not null and v_inv.invited_user_id <> v_uid then
      raise exception 'invite_not_for_you';
    end if;
    if v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then
      raise exception 'invite_used_up';
    end if;

    -- A fresh invitation from room staff can bring back someone who was removed.
    v_allow := v_member.status = 'removed' and v_member.left_at is not null and v_inv.created_at > v_member.left_at;

    v_result := private.join_room(v_room, v_uid, 'invite', v_inv.id, coalesce(v_allow, false));
    if v_result ->> 'status' = 'joined' then
      update public.room_invites set use_count = use_count + 1 where id = v_inv.id;
    end if;
    return v_result;
  end if;

  -- Not an invitation: maybe a room link. Private rooms have no usable link.
  select * into v_room from public.rooms r where r.join_code = p_token for update;
  if not found or (v_room.visibility = 'private' and not private.is_member_user(v_room.id, v_uid)) then
    raise exception 'invite_not_found';
  end if;

  return private.join_room(v_room, v_uid, 'link', null, false);
end $$;

-- Join straight from the alpha directory. Only ever works for Open rooms.
create function public.join_open_room(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found or (v_room.visibility <> 'open' and not private.is_member_user(p_room_id, v_uid)) then
    raise exception 'room_not_open';
  end if;
  return private.join_room(v_room, v_uid, 'open', null, false);
end $$;

-- What an invitation / room link leads to, before joining. Details of the
-- room are only revealed while the link is actually usable.
create function public.preview_join(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_alpha();
  v_inv     public.room_invites%rowtype;
  v_room    public.rooms%rowtype;
  v_member  public.room_members%rowtype;
  v_kind    text;
  v_state   text := 'ok';
  v_inviter uuid;
  v_count   integer;
begin
  select * into v_inv from public.room_invites i where i.token = p_token;
  if found then
    v_kind := 'invite';
    v_inviter := v_inv.created_by;
    select * into v_room from public.rooms r where r.id = v_inv.room_id;
  else
    select * into v_room from public.rooms r where r.join_code = p_token;
    if not found then
      return jsonb_build_object('state', 'not_found');
    end if;
    v_kind := 'link';
    v_inviter := v_room.owner_id;
  end if;

  select * into v_member from public.room_members m where m.room_id = v_room.id and m.user_id = v_uid;
  v_count := private.active_member_count(v_room.id);

  if v_member.status = 'active' then
    v_state := 'already_member';
  elsif v_kind = 'link' and v_room.visibility = 'private' then
    return jsonb_build_object('state', 'not_found');
  elsif v_kind = 'invite' and v_inv.revoked_at is not null then
    return jsonb_build_object('state', 'revoked');
  elsif v_kind = 'invite' and v_inv.expires_at is not null and v_inv.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  elsif v_kind = 'invite' and v_inv.invited_user_id is not null and v_inv.invited_user_id <> v_uid then
    return jsonb_build_object('state', 'not_for_you');
  elsif v_kind = 'invite' and v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then
    return jsonb_build_object('state', 'used_up');
  elsif v_room.archived_at is not null then
    v_state := 'archived';
  elsif v_room.is_closed then
    v_state := 'closed';
  elsif v_member.status = 'removed'
        and not (v_kind = 'invite' and v_member.left_at is not null and v_inv.created_at > v_member.left_at) then
    v_state := 'removed';
  elsif v_count >= private.room_capacity(v_room.member_limit) then
    v_state := 'full';
  end if;

  return jsonb_build_object(
    'state', v_state,
    'kind', v_kind,
    'room', jsonb_build_object(
      'id', v_room.id, 'name', v_room.name, 'description', v_room.description,
      'mode', v_room.mode, 'visibility', v_room.visibility,
      'member_count', v_count, 'capacity', private.room_capacity(v_room.member_limit)
    ),
    'book', (select jsonb_build_object('id', b.id, 'title', b.title, 'author', b.author, 'format', b.format)
               from public.books b where b.id = v_room.book_id),
    'inviter', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_path', p.avatar_path)
                  from public.profiles p where p.id = v_inviter),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_path', p.avatar_path)
                                          order by m.joined_at), '[]'::jsonb)
                  from public.room_members m join public.profiles p on p.id = m.user_id
                 where m.room_id = v_room.id and m.status = 'active')
  );
end $$;

-- ----------------------------------------------------------------------------
-- Leaving, removing, roles
-- ----------------------------------------------------------------------------
create function public.leave_room(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_room   public.rooms%rowtype;
  v_member public.room_members%rowtype;
begin
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  select * into v_member from public.room_members m where m.room_id = p_room_id and m.user_id = v_uid;
  if not found or v_member.status <> 'active' then
    raise exception 'not_a_member';
  end if;

  if v_member.role = 'owner' then
    if private.active_member_count(p_room_id) > 1 then
      raise exception 'owner_must_transfer';
    end if;
    -- Last person out: the room is archived rather than left ownerless.
    update public.room_members set status = 'left', left_at = now() where room_id = p_room_id and user_id = v_uid;
    update public.rooms set archived_at = coalesce(archived_at, now()) where id = p_room_id;
    perform private.log_activity(p_room_id, v_uid, 'room_archived');
    return jsonb_build_object('status', 'left', 'archived', true);
  end if;

  update public.room_members
     set status = 'left', left_at = now(), role = 'member'
   where room_id = p_room_id and user_id = v_uid;
  perform private.log_activity(p_room_id, v_uid, 'left');
  return jsonb_build_object('status', 'left', 'archived', false);
end $$;

create function public.remove_member(p_room_id uuid, p_user_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_role   text := private.room_role(p_room_id);
  v_target public.room_members%rowtype;
begin
  if v_role is null or v_role not in ('owner', 'moderator') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform 1 from public.rooms r where r.id = p_room_id for update;
  select * into v_target from public.room_members m where m.room_id = p_room_id and m.user_id = p_user_id;
  if not found or v_target.status <> 'active' then
    raise exception 'not_a_member';
  end if;
  -- Nobody removes the owner; only the owner removes a moderator; use leave_room for yourself.
  if p_user_id = v_uid or v_target.role = 'owner' or (v_target.role = 'moderator' and v_role <> 'owner') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.room_members
     set status = 'removed', left_at = now(), role = 'member'
   where room_id = p_room_id and user_id = p_user_id;

  perform private.log_moderation(p_room_id, v_uid, 'remove_member', p_user_id, null, null, p_reason);
  perform private.log_activity(p_room_id, p_user_id, 'removed');
  perform private.notify(p_user_id, 'removed', p_room_id, v_uid);
end $$;

create function public.set_member_role(p_room_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_alpha();
  v_target public.room_members%rowtype;
begin
  if coalesce(private.room_role(p_room_id), '') <> 'owner' or p_role not in ('moderator', 'member') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_target from public.room_members m where m.room_id = p_room_id and m.user_id = p_user_id for update;
  if not found or v_target.status <> 'active' or v_target.role = 'owner' then
    raise exception 'not_a_member';
  end if;
  if v_target.role = p_role then
    return;
  end if;

  update public.room_members set role = p_role where room_id = p_room_id and user_id = p_user_id;
  perform private.log_moderation(p_room_id, v_uid, 'set_role', p_user_id, null, p_role);
  perform private.notify(p_user_id, 'role_changed', p_room_id, v_uid, null, jsonb_build_object('role', p_role));
end $$;

create function public.transfer_ownership(p_room_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
begin
  if coalesce(private.room_role(p_room_id), '') <> 'owner' or p_user_id = v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform 1 from public.rooms r where r.id = p_room_id for update;
  if not private.is_member_user(p_room_id, p_user_id) then
    raise exception 'not_a_member';
  end if;

  -- Demote first: the partial unique index allows only one owner per room.
  update public.room_members set role = 'moderator' where room_id = p_room_id and user_id = v_uid;
  update public.room_members set role = 'owner' where room_id = p_room_id and user_id = p_user_id;
  update public.rooms set owner_id = p_user_id where id = p_room_id;

  perform private.log_moderation(p_room_id, v_uid, 'transfer_ownership', p_user_id);
  perform private.notify(p_user_id, 'role_changed', p_room_id, v_uid, null, jsonb_build_object('role', 'owner'));
end $$;
