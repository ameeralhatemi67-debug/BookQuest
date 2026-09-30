-- =============================================================================
-- 0520 · RPC read models: home, room, directory, journey, search, notifications
-- =============================================================================
-- These are security-definer functions that assemble one screen's worth of
-- data in a single round trip. Each one authorizes the caller itself and only
-- ever returns spoiler-safe material (markers, counts, labels — never the
-- contents of notes the caller has not unlocked).

create function private.book_json(p_book_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'title', b.title, 'author', b.author, 'format', b.format,
    'cover_path', b.cover_path, 'status', b.status, 'page_count', b.page_count,
    'uploader_id', b.uploader_id
  )
  from public.books b where b.id = p_book_id;
$$;

-- Active members of a room with where they are in the book.
create function private.room_members_json(p_room_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', p.display_name,
      'avatar_path', p.avatar_path,
      'role', m.role,
      'joined_at', m.joined_at,
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

-- Everything a member needs to render a room card / lobby.
create function private.room_card(p_room public.rooms, p_viewer uuid) returns jsonb
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
        'position', rp.position, 'furthest', rp.furthest, 'label', rp.label, 'anchor', rp.anchor,
        'started_at', rp.started_at, 'last_read_at', rp.last_read_at, 'completed_at', rp.completed_at
      )
      from public.reading_progress rp where rp.room_id = p_room.id and rp.user_id = p_viewer
    ),
    -- Things friends left that the viewer has not reached yet.
    'waiting', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and k.published_at is not null and k.removed_at is null
        and k.author_id <> p_viewer
        and not exists (select 1 from public.reading_unlocks u where u.marker_id = k.id and u.user_id = p_viewer)
    ),
    -- Things the viewer has reached but not opened yet.
    'unseen', (
      select count(*) from public.reading_unlocks u
      join public.annotation_markers k on k.id = u.marker_id
      where u.room_id = p_room.id and u.user_id = p_viewer and u.seen_at is null
        and k.removed_at is null and k.published_at is not null
    ),
    'note_count', (
      select count(*) from public.annotation_markers k
      where k.room_id = p_room.id and k.published_at is not null and k.removed_at is null
    )
  );
$$;

-- What a non-member may know about an Open room.
create function private.room_preview(p_room public.rooms, p_viewer uuid) returns jsonb
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
    'is_member', exists (select 1 from public.room_members m
                          where m.room_id = p_room.id and m.user_id = p_viewer and m.status = 'active'),
    'my_status', (select m.status from public.room_members m where m.room_id = p_room.id and m.user_id = p_viewer),
    'book', private.book_json(p_room.book_id) - 'uploader_id',
    'member_count', private.active_member_count(p_room.id),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'display_name', p.display_name, 'avatar_path', p.avatar_path, 'role', m.role
      ) order by m.joined_at), '[]'::jsonb)
      from public.room_members m join public.profiles p on p.id = m.user_id
      where m.room_id = p_room.id and m.status = 'active'
    ),
    -- Anonymous progress distribution (rounded), for a sense of where the group is.
    'progress', (
      select coalesce(jsonb_agg(round(coalesce(rp.furthest, 0), 2) order by coalesce(rp.furthest, 0)), '[]'::jsonb)
      from public.room_members m
      left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
      where m.room_id = p_room.id and m.status = 'active'
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- Home
-- ----------------------------------------------------------------------------
create function public.my_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
begin
  return jsonb_build_object(
    'rooms', (
      select coalesce(jsonb_agg(t.card order by t.sort_at desc), '[]'::jsonb)
      from (
        select private.room_card(r, v_uid) as card,
               greatest(coalesce(rp.last_read_at, m.joined_at), m.joined_at) as sort_at
        from public.room_members m
        join public.rooms r on r.id = m.room_id
        left join public.reading_progress rp on rp.room_id = r.id and rp.user_id = v_uid
        where m.user_id = v_uid and m.status = 'active'
      ) t
    ),
    'books', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'title', b.title, 'author', b.author, 'format', b.format, 'cover_path', b.cover_path,
        'status', b.status, 'size_bytes', b.size_bytes, 'page_count', b.page_count, 'created_at', b.created_at,
        'uploader_id', b.uploader_id,
        'room_count', (select count(*) from public.rooms r
                        join public.room_members m on m.room_id = r.id and m.user_id = v_uid and m.status = 'active'
                       where r.book_id = b.id)
      ) order by b.created_at desc), '[]'::jsonb)
      from public.books b
      where b.uploader_id = v_uid and b.status <> 'deleted'
    ),
    'unread_notifications', (
      select count(*) from public.notifications n where n.user_id = v_uid and n.read_at is null
    )
  );
end $$;

-- ----------------------------------------------------------------------------
-- Room (member view or open-room preview)
-- ----------------------------------------------------------------------------
create function public.room_detail(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_alpha();
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'room_not_found';
  end if;

  if private.is_room_member(p_room_id) then
    return private.room_card(v_room, v_uid) || jsonb_build_object(
      -- Unlisted / open rooms have a shareable link; private rooms do not.
      'join_code', case when v_room.visibility <> 'private' then v_room.join_code end,
      -- Everyone who was ever here, so old notes and activity still have a name.
      'people', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
          'role', m.role, 'status', m.status
        )), '[]'::jsonb)
        from public.room_members m join public.profiles p on p.id = m.user_id
        where m.room_id = p_room_id
      )
    );
  end if;

  if v_room.visibility = 'open' and v_room.archived_at is null then
    return private.room_preview(v_room, v_uid);
  end if;

  -- Private / unlisted rooms do not admit to existing.
  raise exception 'room_not_found';
end $$;

-- The internal alpha directory: Open rooms only, newest activity first.
create function public.list_open_rooms() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
begin
  return (
    select coalesce(jsonb_agg(private.room_preview(r, v_uid) order by r.last_activity_at desc), '[]'::jsonb)
    from public.rooms r
    where r.visibility = 'open' and r.archived_at is null
  );
end $$;

-- ----------------------------------------------------------------------------
-- Notifications
-- ----------------------------------------------------------------------------
create function public.list_notifications(p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.user_id = v_uid and n.read_at is null),
    'items', (
      select coalesce(jsonb_agg(t.item order by t.created_at desc), '[]'::jsonb)
      from (
        select n.created_at, jsonb_build_object(
          'id', n.id, 'type', n.type, 'room_id', n.room_id, 'marker_id', n.marker_id,
          'data', n.data, 'created_at', n.created_at, 'read_at', n.read_at,
          'room_name', r.name,
          'actor', case when p.id is null then null else
            jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_path', p.avatar_path) end
        ) as item
        from public.notifications n
        left join public.rooms r on r.id = n.room_id
        left join public.profiles p on p.id = n.actor_id
        where n.user_id = v_uid
        order by n.created_at desc
        limit least(greatest(coalesce(p_limit, 40), 1), 100)
      ) t
    )
  );
end $$;

-- ----------------------------------------------------------------------------
-- The Journey: a room's shared memory, built only from stored data.
-- Spoiler-safe: totals are counts; every per-note detail is limited to notes
-- the viewer can already open, and the heat map stops at the viewer's furthest
-- point.
-- ----------------------------------------------------------------------------
create function public.room_journey(p_room_id uuid) returns jsonb
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
                   where k.room_id = p_room_id and k.author_id = m.user_id
                     and k.published_at is not null and k.removed_at is null),
        'replies', (select count(*) from public.annotation_replies y
                     where y.room_id = p_room_id and y.author_id = m.user_id and y.removed_at is null),
        'discoveries', (select count(*) from public.reading_unlocks u
                         where u.room_id = p_room_id and u.user_id = m.user_id and u.via = 'reached')
      ) order by rp.completed_at nulls last, coalesce(rp.furthest, 0) desc), '[]'::jsonb)
      from public.room_members m
      join public.profiles p on p.id = m.user_id
      left join public.reading_progress rp on rp.room_id = m.room_id and rp.user_id = m.user_id
      where m.room_id = p_room_id and (m.status = 'active' or rp.user_id is not null)
    ),
    'totals', jsonb_build_object(
      'notes', (select count(*) from public.annotation_markers k
                 where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null),
      'replies', (select count(*) from public.annotation_replies y
                   join public.annotation_markers k on k.id = y.marker_id
                  where y.room_id = p_room_id and y.removed_at is null and k.removed_at is null),
      'reactions', (select count(*) from public.annotation_reactions x
                     join public.annotation_markers k on k.id = x.marker_id
                    where x.room_id = p_room_id and k.removed_at is null),
      'images', (select count(*) from public.annotation_attachments a
                  join public.annotation_markers k on k.id = a.marker_id
                 where a.room_id = p_room_id and a.kind = 'image' and k.removed_at is null and k.published_at is not null),
      'audio', (select count(*) from public.annotation_attachments a
                 join public.annotation_markers k on k.id = a.marker_id
                where a.room_id = p_room_id and a.kind = 'audio' and k.removed_at is null and k.published_at is not null),
      'video', (select count(*) from public.annotation_attachments a
                 join public.annotation_markers k on k.id = a.marker_id
                where a.room_id = p_room_id and a.kind = 'video' and k.removed_at is null and k.published_at is not null),
      'discoveries', (select count(*) from public.reading_unlocks u
                       join public.annotation_markers k on k.id = u.marker_id
                      where u.room_id = p_room_id and u.via = 'reached' and k.removed_at is null),
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
        where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null
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
      where k.room_id = p_room_id and k.published_at is not null and k.removed_at is null
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
      where u.room_id = p_room_id and u.via = 'reached'
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

-- ----------------------------------------------------------------------------
-- Search: books, rooms and people the caller is already allowed to see.
-- Book *text* is never indexed or searched.
-- ----------------------------------------------------------------------------
create function private.like_pattern(p_query text) returns text
language sql immutable set search_path = '' as $$
  select '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create function public.search_all(p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_q   text := private.like_pattern(p_query);
begin
  if char_length(btrim(coalesce(p_query, ''))) < 2 then
    return jsonb_build_object('books', '[]'::jsonb, 'rooms', '[]'::jsonb, 'people', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'books', (
      select coalesce(jsonb_agg(t.j), '[]'::jsonb) from (
        select jsonb_build_object('id', b.id, 'title', b.title, 'author', b.author, 'format', b.format,
                                  'cover_path', b.cover_path, 'status', b.status, 'mine', b.uploader_id = v_uid) as j
        from public.books b
        where b.status = 'ready' and (b.title ilike v_q or b.author ilike v_q)
          and (b.uploader_id = v_uid or private.can_read_book(b.id))
        order by b.created_at desc
        limit 8
      ) t
    ),
    'rooms', (
      select coalesce(jsonb_agg(t.j), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', r.id, 'name', r.name, 'description', r.description, 'visibility', r.visibility, 'mode', r.mode,
          'is_member', private.is_member_user(r.id, v_uid),
          'book', private.book_json(r.book_id) - 'uploader_id',
          'member_count', private.active_member_count(r.id)
        ) as j
        from public.rooms r
        join public.books b on b.id = r.book_id
        where (r.name ilike v_q or r.description ilike v_q or b.title ilike v_q or b.author ilike v_q)
          and (private.is_member_user(r.id, v_uid) or (r.visibility = 'open' and r.archived_at is null))
        order by r.last_activity_at desc
        limit 8
      ) t
    ),
    'people', (
      select coalesce(jsonb_agg(t.j), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
          'shared_rooms', (
            select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb)
            from public.room_members a
            join public.room_members b2 on b2.room_id = a.room_id and b2.user_id = p.id and b2.status = 'active'
            join public.rooms r on r.id = a.room_id
            where a.user_id = v_uid and a.status = 'active'
          )
        ) as j
        from public.profiles p
        join public.alpha_testers t2 on t2.user_id = p.id and t2.status = 'active'
        where p.display_name ilike v_q and p.id <> v_uid
        order by p.display_name
        limit 8
      ) t
    )
  );
end $$;

-- Search inside a room's conversation: only notes and replies the caller has
-- already unlocked are ever matched.
create function public.search_annotations(p_room_id uuid, p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_q   text := private.like_pattern(p_query);
begin
  if not private.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 2 then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(t.j order by t.position), '[]'::jsonb)
    from (
      select k.position, jsonb_build_object(
        'marker_id', k.id, 'author_id', k.author_id, 'position', k.position, 'label', k.location_label,
        'body', left(c.body, 240),
        'matched_reply', (
          select left(y.body, 240) from public.annotation_replies y
          where y.marker_id = k.id and y.removed_at is null and y.body ilike v_q
          order by y.created_at limit 1
        )
      ) as j
      from public.annotation_markers k
      join public.annotation_contents c on c.marker_id = k.id
      where k.room_id = p_room_id and k.removed_at is null
        and private.can_view_annotation(k.id)
        and (
          c.body ilike v_q or c.quote ilike v_q or c.link_url ilike v_q
          or exists (select 1 from public.annotation_replies y
                      where y.marker_id = k.id and y.removed_at is null and y.body ilike v_q)
        )
      order by k.position
      limit 40
    ) t
  );
end $$;
