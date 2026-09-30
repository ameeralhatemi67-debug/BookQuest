-- =============================================================================
-- 0300 · Reading progress, annotations and the spoiler lock
-- =============================================================================
-- The spoiler mechanic is an authorization rule, not a UI trick:
--
--   annotation_markers   neutral trace: who left something, and where.
--                        Visible to every active room member.
--   annotation_contents  the protected payload (text, emoji, link, quote).
--   annotation_attachments / _replies / _reactions   also protected.
--   reading_unlocks      the grant. A row exists only once the reader has
--                        actually reached the marker's position. Rows are
--                        written exclusively by security-definer functions and
--                        are never removed by moving backwards.
--
-- Protected rows are readable only by the author or by a member holding an
-- unlock (see private.can_view_annotation). Nothing about a locked note other
-- than its marker ever leaves the database.

-- ----------------------------------------------------------------------------
-- reading_progress: one row per (user, room)
-- ----------------------------------------------------------------------------
create table public.reading_progress (
  user_id                uuid not null references public.profiles (id) on delete cascade,
  room_id                uuid not null references public.rooms (id) on delete cascade,
  book_id                uuid not null references public.books (id) on delete cascade,
  -- Normalized 0..1 "how far the visible page reaches into the book".
  position               numeric(7, 6) not null default 0 check (position between 0 and 1),
  furthest               numeric(7, 6) not null default 0 check (furthest between 0 and 1),
  anchor                 jsonb,          -- format-specific resume point (EPUB CFI / PDF page+offset)
  label                  text,           -- human label: "Chapter 4" / "Page 12 of 300"
  chapter_index          integer,
  chapter_label          text,
  furthest_chapter_index integer,
  furthest_chapter_label text,
  reading_seconds        integer not null default 0 check (reading_seconds >= 0),
  started_at             timestamptz not null default now(),
  last_read_at           timestamptz not null default now(),
  completed_at           timestamptz,
  primary key (user_id, room_id),
  check (furthest >= position)
);

create index reading_progress_room_idx on public.reading_progress (room_id);

-- ----------------------------------------------------------------------------
-- annotation_markers (neutral, spoiler-safe)
-- ----------------------------------------------------------------------------
create table public.annotation_markers (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  book_id        uuid not null references public.books (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  position       numeric(7, 6) not null check (position between 0 and 1),
  anchor         jsonb not null,        -- location only; never quoted text
  location_label text check (location_label is null or char_length(location_label) <= 200),
  published_at   timestamptz,           -- null = draft (media still uploading), author-only
  removed_at     timestamptz,
  removed_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index annotation_markers_room_pos_idx on public.annotation_markers (room_id, position)
  where removed_at is null;
create index annotation_markers_author_idx on public.annotation_markers (author_id);

-- ----------------------------------------------------------------------------
-- annotation_contents (protected)
-- ----------------------------------------------------------------------------
create table public.annotation_contents (
  marker_id uuid primary key references public.annotation_markers (id) on delete cascade,
  room_id   uuid not null references public.rooms (id) on delete cascade,
  body      text check (body is null or char_length(body) <= 10000),
  emoji     text check (emoji is null or char_length(emoji) <= 16),
  link_url  text check (link_url is null or (char_length(link_url) <= 2000 and link_url ~* '^https?://')),
  quote     text check (quote is null or char_length(quote) <= 1200),
  edited_at timestamptz
);

create index annotation_contents_room_idx on public.annotation_contents (room_id);

-- ----------------------------------------------------------------------------
-- annotation_attachments (protected; binary lives in private Storage)
-- ----------------------------------------------------------------------------
create table public.annotation_attachments (
  id               uuid primary key default gen_random_uuid(),
  marker_id        uuid not null references public.annotation_markers (id) on delete cascade,
  room_id          uuid not null references public.rooms (id) on delete cascade,
  kind             text not null check (kind in ('image', 'audio', 'video')),
  bucket           text not null check (bucket in ('annotation-images', 'annotation-audio', 'annotation-video')),
  path             text not null,
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  duration_seconds numeric(9, 2),
  width            integer,
  height           integer,
  original_name    text check (original_name is null or char_length(original_name) <= 300),
  created_at       timestamptz not null default now(),
  unique (bucket, path),
  -- Objects are always stored as {room_id}/{marker_id}/{file}; Storage policies
  -- authorize on those two path segments.
  check (path like room_id::text || '/' || marker_id::text || '/%'),
  check (
    (kind = 'image' and bucket = 'annotation-images')
    or (kind = 'audio' and bucket = 'annotation-audio')
    or (kind = 'video' and bucket = 'annotation-video')
  )
);

create index annotation_attachments_marker_idx on public.annotation_attachments (marker_id);

-- ----------------------------------------------------------------------------
-- reading_unlocks: the grant that opens a marker for one reader
-- ----------------------------------------------------------------------------
create table public.reading_unlocks (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  marker_id   uuid not null references public.annotation_markers (id) on delete cascade,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  -- reached : the reader arrived at the note
  -- instant : the note was left behind a reader who had already passed it
  via         text not null default 'reached' check (via in ('reached', 'instant')),
  unlocked_at timestamptz not null default now(),
  seen_at     timestamptz,             -- when the reader first opened it
  primary key (user_id, marker_id)
);

create index reading_unlocks_room_user_idx on public.reading_unlocks (room_id, user_id);
create index reading_unlocks_marker_idx on public.reading_unlocks (marker_id);

-- ----------------------------------------------------------------------------
-- annotation_replies / annotation_reactions (protected)
-- ----------------------------------------------------------------------------
create table public.annotation_replies (
  id         uuid primary key default gen_random_uuid(),
  marker_id  uuid not null references public.annotation_markers (id) on delete cascade,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null
);

create index annotation_replies_marker_idx on public.annotation_replies (marker_id, created_at);

-- Surrogate key on purpose: Realtime DELETE events only carry the primary key,
-- and the emoji itself must never travel to readers who have not unlocked.
create table public.annotation_reactions (
  id         uuid primary key default gen_random_uuid(),
  marker_id  uuid not null references public.annotation_markers (id) on delete cascade,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (marker_id, user_id, emoji)
);

create index annotation_reactions_marker_idx on public.annotation_reactions (marker_id);

-- ----------------------------------------------------------------------------
-- The spoiler gate
-- ----------------------------------------------------------------------------
create function private.can_view_annotation(p_marker_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.annotation_markers m
    where m.id = p_marker_id
      and m.removed_at is null
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

create function private.is_annotation_author(p_marker_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.annotation_markers m
    where m.id = p_marker_id
      and m.author_id = (select auth.uid())
      and m.removed_at is null
      and private.is_room_member(m.room_id)
  );
$$;

-- Attachments may only be added by the author while the note is still a draft.
create function private.is_draft_author(p_marker_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.annotation_markers m
    where m.id = p_marker_id
      and m.author_id = (select auth.uid())
      and m.published_at is null
      and m.removed_at is null
      and private.is_room_member(m.room_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.reading_progress enable row level security;
alter table public.annotation_markers enable row level security;
alter table public.annotation_contents enable row level security;
alter table public.annotation_attachments enable row level security;
alter table public.reading_unlocks enable row level security;
alter table public.annotation_replies enable row level security;
alter table public.annotation_reactions enable row level security;

create policy reading_progress_select on public.reading_progress for select to authenticated
  using ((select private.is_room_member(room_id)));

-- Markers: the neutral trail is visible to the room; drafts only to their author.
create policy annotation_markers_select on public.annotation_markers for select to authenticated
  using (
    removed_at is null
    and (select private.is_room_member(room_id))
    and (published_at is not null or author_id = (select auth.uid()))
  );

create policy annotation_contents_select on public.annotation_contents for select to authenticated
  using ((select private.can_view_annotation(marker_id)));

create policy annotation_attachments_select on public.annotation_attachments for select to authenticated
  using ((select private.can_view_annotation(marker_id)));

create policy annotation_attachments_insert on public.annotation_attachments for insert to authenticated
  with check ((select private.is_draft_author(marker_id)));

create policy annotation_attachments_delete on public.annotation_attachments for delete to authenticated
  using ((select private.is_draft_author(marker_id)));

-- A reader sees their own unlocks; an author sees who has reached their notes.
create policy reading_unlocks_select on public.reading_unlocks for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select private.is_room_member(room_id)))
    or (select private.is_annotation_author(marker_id))
  );

create policy annotation_replies_select on public.annotation_replies for select to authenticated
  using (removed_at is null and (select private.can_view_annotation(marker_id)));

create policy annotation_reactions_select on public.annotation_reactions for select to authenticated
  using ((select private.can_view_annotation(marker_id)));

-- All other writes (progress, markers, contents, unlocks, replies, reactions)
-- go through the RPCs in 0500.

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.reading_progress, public.annotation_markers, public.annotation_contents,
  public.annotation_attachments, public.reading_unlocks, public.annotation_replies,
  public.annotation_reactions
  from anon, authenticated;

grant select on public.reading_progress, public.annotation_markers, public.annotation_contents,
  public.annotation_attachments, public.reading_unlocks, public.annotation_replies,
  public.annotation_reactions
  to authenticated;
grant insert, delete on public.annotation_attachments to authenticated;
