-- =============================================================================
-- 0900 · The RPC surface (function EXECUTE grants)
-- =============================================================================
-- One place defines who may call what:
--   * anon can call nothing.
--   * every function in `public` is a deliberate RPC for signed-in users and
--     authorizes its caller internally (alpha access, membership, role, admin).
--   * `private` functions are helpers. Only the ones referenced from RLS
--     policies need EXECUTE for `authenticated` (policies run as the caller).
--
-- When you add functions in a later migration, repeat this pattern for them.

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on all functions in schema public to authenticated;

grant execute on function
  private.is_alpha(),
  private.is_admin(),
  private.safe_uuid(text),
  private.is_room_member(uuid),
  private.is_room_staff(uuid),
  private.is_open_room(uuid),
  private.can_read_book(uuid),
  private.can_see_book(uuid),
  private.can_view_annotation(uuid),
  private.is_annotation_author(uuid),
  private.is_draft_author(uuid),
  private.owns_book_path(text),
  private.topic_room_id(text)
to authenticated;

-- Functions created later by the migration role start without PUBLIC execute.
alter default privileges revoke execute on functions from public;

-- The Data API needs schema usage; table privileges were granted per table.
grant usage on schema public to anon, authenticated;
