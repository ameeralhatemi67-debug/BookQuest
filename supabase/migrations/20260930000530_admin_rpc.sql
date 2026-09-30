-- =============================================================================
-- 0530 · RPC: alpha admin
-- =============================================================================
-- The admin area is for running a 12-person test, not for reading people's
-- notes: nothing here returns annotation content.

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_admin();
  v_storage jsonb;
begin
  -- Real bytes per bucket straight from Storage's own bookkeeping.
  begin
    select coalesce(jsonb_object_agg(s.bucket_id, jsonb_build_object('objects', s.n, 'bytes', s.bytes)), '{}'::jsonb)
      into v_storage
    from (
      select o.bucket_id, count(*) as n, coalesce(sum((o.metadata ->> 'size')::bigint), 0) as bytes
      from storage.objects o
      group by o.bucket_id
    ) s;
  exception when others then
    v_storage := null;
  end;

  return jsonb_build_object(
    'testers', jsonb_build_object(
      'total', (select count(*) from public.alpha_testers),
      'active', (select count(*) from public.alpha_testers where status = 'active'),
      'pending', (select count(*) from public.alpha_testers where status = 'pending'),
      'disabled', (select count(*) from public.alpha_testers where status = 'disabled')
    ),
    'active_readers_7d', (select count(distinct user_id) from public.reading_progress where last_read_at > now() - interval '7 days'),
    'active_readers_24h', (select count(distinct user_id) from public.reading_progress where last_read_at > now() - interval '24 hours'),
    'books', (select count(*) from public.books where status <> 'deleted'),
    'books_bytes', (select coalesce(sum(size_bytes), 0) from public.books where status <> 'deleted'),
    'rooms', jsonb_build_object(
      'total', (select count(*) from public.rooms),
      'active', (select count(*) from public.rooms where archived_at is null),
      'open', (select count(*) from public.rooms where visibility = 'open' and archived_at is null),
      'unlisted', (select count(*) from public.rooms where visibility = 'unlisted' and archived_at is null),
      'private', (select count(*) from public.rooms where visibility = 'private' and archived_at is null)
    ),
    'annotations', (select count(*) from public.annotation_markers where published_at is not null and removed_at is null),
    'replies', (select count(*) from public.annotation_replies where removed_at is null),
    'reactions', (select count(*) from public.annotation_reactions),
    'unlocks', (select count(*) from public.reading_unlocks where via = 'reached'),
    'attachments', jsonb_build_object(
      'total', (select count(*) from public.annotation_attachments),
      'image', (select count(*) from public.annotation_attachments where kind = 'image'),
      'audio', (select count(*) from public.annotation_attachments where kind = 'audio'),
      'video', (select count(*) from public.annotation_attachments where kind = 'video'),
      'bytes', (select coalesce(sum(size_bytes), 0) from public.annotation_attachments)
    ),
    'storage', v_storage,
    'feedback', jsonb_build_object(
      'total', (select count(*) from public.alpha_feedback),
      'new', (select count(*) from public.alpha_feedback where status = 'new')
    ),
    'errors_7d', (select count(*) from public.client_errors where created_at > now() - interval '7 days'),
    'reading_seconds', (select coalesce(sum(reading_seconds), 0) from public.reading_progress)
  );
end $$;

create function public.admin_list_testers() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.id,
      'display_name', p.display_name,
      'avatar_path', p.avatar_path,
      'email', u.email,
      'email_confirmed', u.email_confirmed_at is not null,
      'status', t.status,
      'is_admin', t.is_admin,
      'access_source', t.access_source,
      'created_at', p.created_at,
      'last_seen_at', t.last_seen_at,
      'rooms', (select count(*) from public.room_members m where m.user_id = p.id and m.status = 'active'),
      'books', (select count(*) from public.books b where b.uploader_id = p.id and b.status <> 'deleted'),
      'notes', (select count(*) from public.annotation_markers k where k.author_id = p.id and k.published_at is not null and k.removed_at is null),
      'last_read_at', (select max(rp.last_read_at) from public.reading_progress rp where rp.user_id = p.id)
    ) order by p.created_at), '[]'::jsonb)
    from public.profiles p
    join public.alpha_testers t on t.user_id = p.id
    join auth.users u on u.id = p.id
  );
end $$;

create function public.admin_set_tester(p_user_id uuid, p_status text default null, p_is_admin boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  if p_status is not null and p_status not in ('pending', 'active', 'disabled') then
    raise exception 'invalid_status';
  end if;
  -- An admin cannot lock themself out by accident.
  if p_user_id = v_uid and (p_status in ('pending', 'disabled') or p_is_admin = false) then
    raise exception 'cannot_change_self';
  end if;

  update public.alpha_testers
     set status = coalesce(p_status, status),
         is_admin = coalesce(p_is_admin, is_admin),
         activated_at = case when p_status = 'active' and activated_at is null then now() else activated_at end,
         access_source = case when p_status = 'active' and status <> 'active' then 'admin' else access_source end
   where user_id = p_user_id;
  if not found then
    raise exception 'user_not_found';
  end if;

  if p_status = 'disabled' then
    perform private.log_moderation(null, v_uid, 'admin_disable_user', p_user_id);
  elsif p_status = 'active' then
    perform private.log_moderation(null, v_uid, 'admin_enable_user', p_user_id);
  end if;
end $$;

create function public.admin_create_alpha_code(
  p_note text default null, p_max_uses integer default 1, p_expires_in_days integer default 30
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_admin();
  v_raw  text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_code text := substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5);
begin
  if p_max_uses is null or p_max_uses not between 1 and 100 then
    raise exception 'invalid_code_settings';
  end if;
  insert into public.alpha_invite_codes (code, note, max_uses, expires_at, created_by)
  values (v_code, nullif(btrim(coalesce(p_note, '')), ''), p_max_uses,
          case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end,
          v_uid);
  return v_code;
end $$;

create function public.admin_list_rooms() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'visibility', r.visibility, 'mode', r.mode,
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
      'replies', (select count(*) from public.annotation_replies y where y.room_id = r.id and y.removed_at is null)
    ) order by r.last_activity_at desc), '[]'::jsonb)
    from public.rooms r
    join public.books b on b.id = r.book_id
  );
end $$;

create function public.admin_list_books() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'title', b.title, 'author', b.author, 'format', b.format, 'status', b.status,
      'size_bytes', b.size_bytes, 'mime_type', b.mime_type, 'original_filename', b.original_filename,
      'sha256', b.sha256, 'page_count', b.page_count, 'created_at', b.created_at, 'error', b.error,
      'uploader', (select p.display_name from public.profiles p where p.id = b.uploader_id),
      'storage_path', b.storage_path,
      'rooms', (select count(*) from public.rooms r where r.book_id = b.id)
    ) order by b.created_at desc), '[]'::jsonb)
    from public.books b
  );
end $$;

create function public.admin_set_room_archived(p_room_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  update public.rooms set archived_at = case when p_archived then coalesce(archived_at, now()) end where id = p_room_id;
  if not found then
    raise exception 'room_not_found';
  end if;
  if p_archived then
    perform private.log_moderation(p_room_id, v_uid, 'admin_archive_room');
    perform private.log_activity(p_room_id, null, 'room_archived', jsonb_build_object('by_admin', true));
  end if;
end $$;

-- Disabling a book makes its file unreadable for everyone (rooms stay intact).
create function public.admin_set_book_disabled(p_book_id uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  perform set_config('app.bypass_book_guard', 'on', true);
  update public.books
     set status = case when p_disabled then 'disabled' when status = 'disabled' then 'ready' else status end
   where id = p_book_id;
  if not found then
    perform set_config('app.bypass_book_guard', 'off', true);
    raise exception 'book_not_found';
  end if;
  perform set_config('app.bypass_book_guard', 'off', true);
  perform private.log_moderation(null, v_uid,
    case when p_disabled then 'admin_disable_book' else 'admin_enable_book' end, null, null, p_book_id::text);
end $$;

-- Takes a note down without ever exposing its contents to the admin.
create function public.admin_remove_annotation(p_marker_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_admin();
  v_marker public.annotation_markers%rowtype;
begin
  update public.annotation_markers set removed_at = coalesce(removed_at, now()), removed_by = v_uid
   where id = p_marker_id
  returning * into v_marker;
  if not found then
    raise exception 'note_unavailable';
  end if;
  perform private.log_moderation(v_marker.room_id, v_uid, 'admin_remove_annotation', v_marker.author_id, p_marker_id, null, p_reason);
end $$;

-- Note markers for the admin's "disable broken content" tool: location and
-- author only, never the payload.
create function public.admin_list_markers(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'author', p.display_name, 'position', k.position, 'label', k.location_label,
      'created_at', k.created_at, 'published', k.published_at is not null, 'removed', k.removed_at is not null,
      'attachments', (select coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'size_bytes', a.size_bytes, 'mime_type', a.mime_type)), '[]'::jsonb)
                        from public.annotation_attachments a where a.marker_id = k.id)
    ) order by k.position), '[]'::jsonb)
    from public.annotation_markers k
    join public.profiles p on p.id = k.author_id
    where k.room_id = p_room_id
  );
end $$;
