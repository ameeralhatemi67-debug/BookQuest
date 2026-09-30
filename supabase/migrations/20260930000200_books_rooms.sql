-- =============================================================================
-- 0200 · Books, rooms, membership, invitations
-- =============================================================================
-- Books are independent from rooms: one uploaded file can back many rooms.
-- Who may read a book is decided by authorization (uploader, or active member
-- of a room reading it), never by knowing its storage path.

-- ----------------------------------------------------------------------------
-- books
-- ----------------------------------------------------------------------------
create table public.books (
  id                uuid primary key default gen_random_uuid(),
  uploader_id       uuid not null references public.profiles (id) on delete restrict,
  title             text not null check (char_length(btrim(title)) between 1 and 300),
  author            text check (author is null or char_length(author) <= 300),
  format            text not null check (format in ('epub', 'pdf')),
  -- uploading → processing → ready; failed / deleted / disabled are terminal-ish.
  status            text not null default 'uploading'
                    check (status in ('uploading', 'processing', 'ready', 'failed', 'deleted', 'disabled')),
  storage_path      text,                 -- object name inside the private `books` bucket
  cover_path        text,                 -- object name inside the private `covers` bucket
  original_filename text check (original_filename is null or char_length(original_filename) <= 300),
  mime_type         text,
  size_bytes        bigint check (size_bytes is null or size_bytes >= 0),
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  page_count        integer check (page_count is null or page_count > 0),   -- PDF
  has_locations     boolean not null default false,                         -- EPUB locations.json stored
  metadata          jsonb not null default '{}'::jsonb,                     -- optional edition metadata
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index books_uploader_idx on public.books (uploader_id, created_at desc);

-- The same exact file is only stored once per uploader.
create unique index books_uploader_sha_uidx on public.books (uploader_id, sha256)
  where sha256 is not null and status in ('uploading', 'processing', 'ready');

create trigger books_touch before update on public.books
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- rooms
-- ----------------------------------------------------------------------------
create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  description      text check (description is null or char_length(description) <= 500),
  book_id          uuid not null references public.books (id) on delete restrict,
  owner_id         uuid not null references public.profiles (id) on delete restrict,
  -- private  : invitation only, never listed
  -- unlisted : never listed; any alpha tester holding the room link may join
  -- open     : listed in the alpha directory; any alpha tester may join
  visibility       text not null default 'private' check (visibility in ('private', 'unlisted', 'open')),
  -- Modes change emphasis, not the reader. New modes = new value here + an
  -- entry in src/lib/room-modes.ts.
  mode             text not null default 'chill' check (mode in ('chill', 'race', 'duo')),
  member_limit     integer check (member_limit is null or member_limit between 2 and 50),
  join_code        text not null unique default private.gen_token(),
  is_closed        boolean not null default false,      -- closed to new members
  archived_at      timestamptz,                         -- room ended; kept as a memory
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A Private Duo is exactly that: two readers, invitation only.
  constraint rooms_duo_shape check (mode <> 'duo' or (member_limit = 2 and visibility = 'private'))
);

create index rooms_book_idx on public.rooms (book_id);
create index rooms_open_idx on public.rooms (last_activity_at desc) where visibility = 'open' and archived_at is null;

create trigger rooms_touch before update on public.rooms
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- room_members: one row per (room, person), ever. Leaving and re-joining flips
-- `status`, so membership can never be duplicated or orphan reading history.
-- ----------------------------------------------------------------------------
create table public.room_members (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  status     text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_via text not null default 'invite' check (joined_via in ('created', 'invite', 'link', 'open')),
  invite_id  uuid,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  primary key (room_id, user_id)
);

create index room_members_user_idx on public.room_members (user_id) where status = 'active';
create unique index room_members_one_owner on public.room_members (room_id) where role = 'owner';

-- ----------------------------------------------------------------------------
-- room_invites
-- ----------------------------------------------------------------------------
create table public.room_invites (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  token           text not null unique default private.gen_token(),
  created_by      uuid not null references public.profiles (id) on delete cascade,
  invited_user_id uuid references public.profiles (id) on delete cascade,  -- null = anyone holding the link
  max_uses        integer check (max_uses is null or max_uses > 0),        -- null = unlimited
  use_count       integer not null default 0 check (use_count >= 0),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index room_invites_room_idx on public.room_invites (room_id, created_at desc);

alter table public.room_members
  add constraint room_members_invite_fk foreign key (invite_id)
  references public.room_invites (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Authorization helpers
-- ----------------------------------------------------------------------------

-- Hard ceiling for any room in this alpha ("small groups first").
create function private.room_capacity(p_limit integer) returns integer
language sql immutable set search_path = '' as $$
  select coalesce(p_limit, 50);
$$;

create function private.is_room_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.room_members m
    where m.room_id = p_room_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  ) and private.is_alpha();
$$;

create function private.is_member_user(p_room_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = p_user_id and m.status = 'active'
  );
$$;

create function private.room_role(p_room_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.room_members m
  where m.room_id = p_room_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and private.is_alpha();
$$;

create function private.is_room_staff(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.room_role(p_room_id) in ('owner', 'moderator'), false);
$$;

create function private.is_open_room(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.visibility = 'open' and r.archived_at is null
  );
$$;

-- May the caller open the actual book file?
create function private.can_read_book(p_book_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_alpha() and exists (
    select 1
    from public.books b
    where b.id = p_book_id
      and b.status not in ('deleted', 'disabled')
      and (
        b.uploader_id = (select auth.uid())
        or exists (
          select 1
          from public.rooms r
          join public.room_members m on m.room_id = r.id
          where r.book_id = b.id
            and m.user_id = (select auth.uid())
            and m.status = 'active'
        )
      )
  );
$$;

-- May the caller see the book's metadata and cover (title, author, cover)?
-- Wider than can_read_book: open rooms show their book in the directory.
create function private.can_see_book(p_book_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_alpha() and (
    private.is_admin()
    or exists (select 1 from public.books b where b.id = p_book_id and b.uploader_id = (select auth.uid()))
    or exists (
      select 1
      from public.rooms r
      left join public.room_members m
        on m.room_id = r.id and m.user_id = (select auth.uid()) and m.status = 'active'
      where r.book_id = p_book_id
        and (m.user_id is not null or (r.visibility = 'open' and r.archived_at is null))
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.books enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;

-- The uploader clause is checked on the row itself (not via a helper) so that
-- INSERT … RETURNING works: a helper query cannot yet see the row being inserted.
create policy books_select on public.books for select to authenticated
  using (
    (uploader_id = (select auth.uid()) and (select private.is_alpha()))
    or (select private.can_see_book(id))
  );

create policy books_insert on public.books for insert to authenticated
  with check (uploader_id = (select auth.uid()) and (select private.is_alpha()));

create policy books_update on public.books for update to authenticated
  using (uploader_id = (select auth.uid()) and (select private.is_alpha()))
  with check (uploader_id = (select auth.uid()));

-- Rooms: members see their rooms; every alpha tester sees open rooms; admins
-- see room metadata (never annotation content) for support.
create policy rooms_select on public.rooms for select to authenticated
  using (
    (select private.is_room_member(id))
    or (visibility = 'open' and archived_at is null and (select private.is_alpha()))
    or (select private.is_admin())
  );

create policy room_members_select on public.room_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_room_member(room_id))
    or (status = 'active' and (select private.is_open_room(room_id)) and (select private.is_alpha()))
    or (select private.is_admin())
  );

create policy room_invites_select on public.room_invites for select to authenticated
  using (
    (select private.is_room_staff(room_id))
    or (created_by = (select auth.uid()) and (select private.is_room_member(room_id)))
    or (invited_user_id = (select auth.uid()) and (select private.is_alpha()))
  );

-- No insert/update/delete policies on rooms, room_members or room_invites:
-- every write goes through the RPCs in 0500 so the rules live in one place.

-- A book's identity is fixed once created; only its descriptive fields move.
create function private.books_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.uploader_id <> old.uploader_id or new.format <> old.format or new.id <> old.id then
    raise exception 'immutable_book_field';
  end if;
  -- Only an admin may disable / re-enable a book; the uploader cannot undo it.
  if (old.status = 'disabled' or new.status = 'disabled')
     and new.status is distinct from old.status
     and coalesce(current_setting('app.bypass_book_guard', true), '') <> 'on' then
    raise exception 'book_status_locked';
  end if;
  return new;
end $$;

create trigger books_guard before update on public.books
  for each row execute function private.books_guard();

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.books, public.rooms, public.room_members, public.room_invites from anon, authenticated;

grant select, insert on public.books to authenticated;
grant update (title, author, status, storage_path, cover_path, original_filename, mime_type,
              sha256, page_count, has_locations, metadata, error)
  on public.books to authenticated;
grant select on public.rooms, public.room_members, public.room_invites to authenticated;
