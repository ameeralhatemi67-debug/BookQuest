-- Room soundtracks. Page cues protect both the title and the audio bytes until
-- the reader reaches the cue. Uncued tracks are available throughout the room.
create table public.soundtrack_tracks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 160),
  storage_path text not null unique,
  starts_at numeric check (starts_at between 0 and 1),
  location_label text,
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
create index soundtrack_room on public.soundtrack_tracks(room_id, created_at);
alter table public.soundtrack_tracks enable row level security;
revoke all on public.soundtrack_tracks from public, anon, authenticated;
grant select on public.soundtrack_tracks to authenticated;

create function private.can_hear_track(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.soundtrack_tracks t
    where t.id = p_id and private.is_room_member(t.room_id)
      and (t.author_id = auth.uid() or (t.ready and (
        t.starts_at is null or coalesce((select p.furthest from public.reading_progress p
          where p.room_id = t.room_id and p.user_id = auth.uid()), 0) >= t.starts_at
      )))
  );
$$;
create function private.can_manage_track(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.soundtrack_tracks t
    where t.id = p_id and private.is_room_member(t.room_id)
      and (t.author_id = auth.uid() or private.is_room_staff(t.room_id)));
$$;
create policy "soundtrack: reached cues" on public.soundtrack_tracks for select to authenticated
  using (private.can_hear_track(id));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('soundtracks', 'soundtracks', false, 104857600,
  array['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/webm','audio/wav','audio/flac']);

create policy "soundtrack: authorized audio" on storage.objects for select to authenticated
  using (bucket_id = 'soundtracks' and exists (select 1 from public.soundtrack_tracks t
    where t.storage_path = name and private.can_hear_track(t.id)));
create policy "soundtrack: author upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'soundtracks' and exists (select 1 from public.soundtrack_tracks t
    where t.storage_path = name and t.author_id = auth.uid() and not t.ready
      and private.is_room_member(t.room_id)
      and exists (select 1 from public.rooms r where r.id = t.room_id and r.archived_at is null)));
create policy "soundtrack: author retry" on storage.objects for update to authenticated
  using (bucket_id = 'soundtracks' and exists (select 1 from public.soundtrack_tracks t
    where t.storage_path = name and t.author_id = auth.uid() and not t.ready and private.is_room_member(t.room_id)))
  with check (bucket_id = 'soundtracks' and exists (select 1 from public.soundtrack_tracks t
    where t.storage_path = name and t.author_id = auth.uid() and not t.ready and private.is_room_member(t.room_id)));
create policy "soundtrack: remove audio" on storage.objects for delete to authenticated
  using (bucket_id = 'soundtracks' and private.can_manage_track(private.safe_uuid((storage.foldername(name))[2])));

create function public.create_soundtrack_track(p_room_id uuid, p_title text,
  p_extension text, p_starts_at numeric default null, p_location_label text default null)
returns public.soundtrack_tracks language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_alpha();
  v_id uuid := gen_random_uuid();
  v_track public.soundtrack_tracks;
begin
  if not private.is_room_member(p_room_id) then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and archived_at is null) then raise exception 'room_archived'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160 then raise exception 'invalid_title'; end if;
  if p_extension is null or p_extension not in ('mp3','m4a','aac','ogg','oga','opus','webm','wav','flac') then raise exception 'invalid_audio_type'; end if;
  if p_starts_at is not null and (p_starts_at < 0 or p_starts_at > 1 or p_starts_at = 'NaN'::numeric) then raise exception 'invalid_position'; end if;
  -- Serialize the room cap so simultaneous uploads cannot bypass it.
  perform 1 from public.rooms where id = p_room_id for update;
  if (select count(*) from public.soundtrack_tracks where room_id = p_room_id) >= 100 then raise exception 'playlist_full'; end if;
  insert into public.soundtrack_tracks(id, room_id, author_id, title, storage_path, starts_at, location_label)
  values (v_id, p_room_id, v_uid, btrim(p_title), p_room_id::text || '/' || v_id::text || '/audio.' || p_extension,
    p_starts_at, left(p_location_label, 200)) returning * into v_track;
  return v_track;
end;
$$;

create function public.finalize_soundtrack_track(p_track_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_track public.soundtrack_tracks; v_meta jsonb;
begin
  perform private.require_alpha();
  select * into v_track from public.soundtrack_tracks where id = p_track_id and author_id = auth.uid() for update;
  if not found or not private.is_room_member(v_track.room_id) then raise exception 'track_not_found'; end if;
  if not exists (select 1 from public.rooms where id = v_track.room_id and archived_at is null) then raise exception 'room_archived'; end if;
  select metadata into v_meta from storage.objects where bucket_id = 'soundtracks' and name = v_track.storage_path;
  if v_meta is null then raise exception 'upload_missing'; end if;
  if coalesce((v_meta->>'size')::bigint, 0) not between 1 and 104857600 then raise exception 'file_too_large'; end if;
  if coalesce(v_meta->>'mimetype', '') not in ('audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/webm','audio/wav','audio/flac') then raise exception 'invalid_audio_type'; end if;
  update public.soundtrack_tracks set ready = true where id = p_track_id;
end;
$$;

create function public.delete_soundtrack_track(p_track_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_alpha();
  if not private.can_manage_track(p_track_id) then raise exception 'track_not_found' using errcode = '42501'; end if;
  -- Remove Storage bytes through its API first, so failed deletion is retryable.
  if exists (select 1 from storage.objects o join public.soundtrack_tracks t on t.storage_path = o.name
    where t.id = p_track_id and o.bucket_id = 'soundtracks') then raise exception 'remove_audio_first'; end if;
  delete from public.soundtrack_tracks where id = p_track_id;
end;
$$;

revoke all on function private.can_hear_track(uuid), private.can_manage_track(uuid) from public, anon;
grant execute on function private.can_hear_track(uuid), private.can_manage_track(uuid) to authenticated;
revoke all on function public.create_soundtrack_track(uuid,text,text,numeric,text), public.finalize_soundtrack_track(uuid), public.delete_soundtrack_track(uuid) from public, anon;
grant execute on function public.create_soundtrack_track(uuid,text,text,numeric,text), public.finalize_soundtrack_track(uuid), public.delete_soundtrack_track(uuid) to authenticated;
alter publication supabase_realtime add table public.soundtrack_tracks;
