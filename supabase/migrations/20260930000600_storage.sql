-- =============================================================================
-- 0600 · Storage buckets and object policies
-- =============================================================================
-- Size limits mirror src/lib/limits.ts (keep the two in sync). Bucket limits
-- are enforced by Storage itself, so the browser cannot bypass them.
-- NOTE: the project-wide "Global file size limit" (Dashboard → Storage →
-- Settings) must also be raised to at least 500 MB — see SETUP.md.
--
-- Object naming:
--   books              {uploader_id}/{book_id}/book.epub|pdf, …/locations.json
--   covers             {uploader_id}/{book_id}/cover.jpg
--   avatars            {user_id}/{file}                       (public read)
--   annotation-images  {room_id}/{marker_id}/{file}
--   annotation-audio   {room_id}/{marker_id}/{file}
--   annotation-video   {room_id}/{marker_id}/{file}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('books', 'books', false, 524288000,            -- 500 MB (PDF ceiling; the 250 MB EPUB cap is enforced in finalize_book_upload)
     array['application/epub+zip', 'application/pdf', 'application/json']),
  ('covers', 'covers', false, 5242880,            -- 5 MB
     array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 10485760,          -- 10 MB
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('annotation-images', 'annotation-images', false, 26214400,   -- 25 MB
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  ('annotation-audio', 'annotation-audio', false, 104857600,    -- 100 MB
     array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/flac']),
  ('annotation-video', 'annotation-video', false, 524288000,    -- 500 MB
     array['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- Path helpers
-- ----------------------------------------------------------------------------

-- books / covers: {uploader_id}/{book_id}/… where the caller is that uploader
-- and the book row exists.
create function private.owns_book_path(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_alpha()
     and (storage.foldername(p_name))[1] = (select auth.uid())::text
     and exists (
       select 1 from public.books b
       where b.id = private.safe_uuid((storage.foldername(p_name))[2])
         and b.uploader_id = (select auth.uid())
     );
$$;

-- ----------------------------------------------------------------------------
-- Policies on storage.objects
-- ----------------------------------------------------------------------------

-- books: private. Readable only by people authorized for that book.
create policy "books: readers can read" on storage.objects for select to authenticated
  using (bucket_id = 'books' and (
    (select private.can_read_book(private.safe_uuid((storage.foldername(name))[2])))
    or (select private.owns_book_path(name))
  ));

create policy "books: uploader can add" on storage.objects for insert to authenticated
  with check (bucket_id = 'books' and (select private.owns_book_path(name)));

create policy "books: uploader can overwrite" on storage.objects for update to authenticated
  using (bucket_id = 'books' and (select private.owns_book_path(name)))
  with check (bucket_id = 'books' and (select private.owns_book_path(name)));

create policy "books: uploader can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'books' and (select private.owns_book_path(name)));

-- covers: private, but visible wherever the book's metadata is (incl. open rooms).
create policy "covers: visible with the book" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (
    (select private.can_see_book(private.safe_uuid((storage.foldername(name))[2])))
    or (select private.owns_book_path(name))
  ));

create policy "covers: uploader can add" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (select private.owns_book_path(name)));

create policy "covers: uploader can overwrite" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (select private.owns_book_path(name)))
  with check (bucket_id = 'covers' and (select private.owns_book_path(name)));

create policy "covers: uploader can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (select private.owns_book_path(name)));

-- avatars: public bucket (read needs no policy); people manage their own folder.
create policy "avatars: own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: own folder select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: own folder update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Annotation media: the spoiler gate applies to the bytes too. A reader who
-- has not unlocked a note cannot fetch (or sign a URL for) its media, even if
-- they guess the path.
create policy "annotation media: unlocked readers can read" on storage.objects for select to authenticated
  using (
    bucket_id in ('annotation-images', 'annotation-audio', 'annotation-video')
    and (select private.can_view_annotation(private.safe_uuid((storage.foldername(name))[2])))
  );

create policy "annotation media: author adds while drafting" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('annotation-images', 'annotation-audio', 'annotation-video')
    and (select private.is_draft_author(private.safe_uuid((storage.foldername(name))[2])))
    and exists (
      select 1 from public.annotation_markers m
      where m.id = private.safe_uuid((storage.foldername(name))[2])
        and m.room_id = private.safe_uuid((storage.foldername(name))[1])
    )
  );

create policy "annotation media: author can overwrite draft" on storage.objects for update to authenticated
  using (
    bucket_id in ('annotation-images', 'annotation-audio', 'annotation-video')
    and (select private.is_draft_author(private.safe_uuid((storage.foldername(name))[2])))
  )
  with check (
    bucket_id in ('annotation-images', 'annotation-audio', 'annotation-video')
    and (select private.is_draft_author(private.safe_uuid((storage.foldername(name))[2])))
  );

create policy "annotation media: author can delete" on storage.objects for delete to authenticated
  using (
    bucket_id in ('annotation-images', 'annotation-audio', 'annotation-video')
    and (select private.is_annotation_author(private.safe_uuid((storage.foldername(name))[2])))
  );
