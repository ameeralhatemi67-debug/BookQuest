# BookQuest alpha status

Updated 2026-09-30. This file supersedes the implementation-status sections of the original HANDOFF.md.

## Implemented

Auth and alpha access; EPUB/PDF upload and reading; room privacy, invitations and roles; saved progress and shared tracks; spoiler-gated notes and media; replies/reactions; Realtime and presence; notifications/activity; journey/search/profile/admin/feedback; shared soundtracks and page-cued music.

The reader now has an adaptive paper/desk layout, warmer editorial typography, focus mode, light/sepia/dark settings, 44 px controls, responsive overlays and restrained interaction states. Fixed mobile EPUB resize clipping and offscreen PDF selection controls. The local launcher now exists and the emulator recovers partial upload offsets correctly.

## Hosted state

Supabase is connected with committed migrations and private buckets. Vercel public variables and auth URLs/templates are configured. Direct signup is enabled with owner approval for this code-gated alpha. Two owner-designated admin accounts are active; private one-use setup links are kept outside Git. The friend code is limited to 20 uses and 30 days. The effective hosted file cap is 50 MB.

## Verification

- Unit, database/RLS and emulator integration: **172 passing**.
- TypeScript, ESLint and production build: clean.
- **62 desktop browser cases and 7 mobile cases** passed across the local Chromium runs: Duo, Group, room visibility/authorization, PDF, upload, management, recovery, voice/video, responsive and soundtrack checks. See TESTING.md for reproducible commands.
- The 64 MB local upload passes pause/resume, connection interruption, cancellation and full stored-file hash verification.
- Mobile automation covers eight viewports from 320 px phones through 1440 px laptops, theme/focus controls, page cues, hide/show playback and reconnecting progress.

GitHub `main` and `alpha-build` were pushed with implementation commit `46c29b5`. Vercel production deployment `dpl_GS3ptdV4pvPfxpCnmVc1z7ZCP7Sw` is Ready and serves https://book-quest-ecru.vercel.app/.

The hosted smoke passed on 2026-09-30: two temporary readers signed up, uploaded an EPUB, created/joined a private room, opened the reader, played shared audio and used a 390 px phone layout without overflow. Realtime connected live. Temporary test accounts, rooms, books and Storage files were removed. A fresh friend code preserves all 20 signup places.

Physical iOS/Android checks and actual SMTP delivery remain outside automated local verification. Production password-reset delivery requires configured SMTP; the two admins receive private generated setup links instead.

## Remaining validation

Run the friend-device matrix in TESTING.md and record findings through Feedback. Full offline startup, guaranteed codec support, instant revocation of issued signed URLs, public signup, per-account quotas and abandoned-upload cleanup are not delivered in this alpha. PUBLIC_RELEASE_GATES.md distinguishes those boundaries from the current friend test.
