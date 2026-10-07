# BookQuest alpha status

> 2026-10-07: the emotional multiplayer update is deployed (open signup with 75 seats, per-room feature toggles, predictions, polls, packages, five attention levels, page flip, book map, friend lens, live reading, rituals, afterparties, echoes, the vault, Home as a reading desk and the What's new window). See CHANGELOG.md for the full list; this file's older sections describe the state before it. Verified: 188 unit/database/integration tests, the full desktop and mobile browser suites, TypeScript, ESLint and the production build. Hosted migration `20261007182115_emotional_multiplayer.sql` is applied.

Updated 2026-10-01. This file supersedes the implementation-status sections of the original HANDOFF.md.

## Implemented

Auth and alpha access; EPUB/PDF upload and reading; room privacy, invitations and roles; saved progress and shared tracks; spoiler-gated notes and media; replies/reactions; Realtime and presence; notifications/activity; journey/search/profile/admin/feedback; shared soundtracks and page-cued music.

The reader now has an adaptive paper/desk layout, warmer editorial typography, focus mode, light/sepia/dark settings, 44 px controls, responsive overlays and restrained interaction states. Fixed mobile EPUB resize clipping and offscreen PDF selection controls. The local launcher now exists and the emulator recovers partial upload offsets correctly.

PDFs use the owner-confirmed 20–120% book-view range. The default 100% fits one complete page; + enlarges the book toward 20%, while − adds margins until 120%, which fits two pages. Both fitted views use the available reading height without an extra spread shrink. Horizontal panning is available only at 80% and below. Fractional viewport measurement prevents unwanted scrollbars at browser zoom levels, and old saved preferences are converted to the new range. Zoom buttons sit immediately before the note button in the header; Full page / Two pages presets remain in Reading settings. The bottom bar is removed, and avatars, shared progress and reading status now sit in a vertical rail on the left. Page-turn buttons stay outside fitted pages; phone music controls float above navigation. Desktop double-click and phone double-tap open a note at the tapped passage. Draw in the note composer offers color and stroke-size controls, then saves the sketch as a PNG through the existing private attachment and spoiler-lock flow.

## Hosted state

Note avatars now have Quiet, Gentle and Playful attention levels. A single click/tap opens an anchored speech bubble; double-click/tap opens the reply thread. Dragging stays within the note’s original page, and wiggling or the accessible snooze button rests the avatar for five minutes. Reduced-motion settings suppress animation. Exact pins identify selections and page taps, including while composing; paired PDF pages reserve a 44 px note gutter. Desktop progress avatars morph into a drop pointing toward their actual rail position, with a stable hover target; phones keep the tap interaction.

New notes default to the whole room, with Only me and individual-reader choices. Database checks enforce the audience across markers, content, attachment downloads, unlocks, notifications, room counts and Journey summaries. Spoiler locks still apply to the chosen reader.

Reading coverage now uses timed visible passages, word counts, an adaptive pace estimate, scan detection, backtracking and cumulative revisit credit. It pauses for hidden/unfocused tabs, overlays and inactivity based on passage length. Browsing position, note unlocks and historical completion records are preserved separately. New completion requires at least 90% earned coverage and credit for the final section; reaching the last page alone cannot finish. Offline samples survive reload and retry, with receipts preventing duplicate credit and server wall-clock limits bounding accepted time. Reading credit estimates attention, not comprehension.

Supabase is connected with committed migrations and private buckets. Vercel public variables and auth URLs/templates are configured. Direct signup is enabled with owner approval for this code-gated alpha. Two owner-designated admin accounts are active; private one-use setup links are kept outside Git. The friend code is limited to 20 uses and 30 days. The effective hosted file cap is 50 MB.

## Verification

- Unit, database/RLS and emulator integration: **173 passing**.
- The animated-note and reading-coverage update passes **176 unit/database/integration checks** (61/97/18). Hosted migration `20261001090807_note_attention_and_reading_coverage.sql` is applied; anonymous callers cannot create notes or claim reading credit, and clients cannot read the private coverage ledger.
- **53 distinct reader browser cases** passed across the final successful runs: Duo, Group, PDF, both responsive projects, drawing/page fit, animated notes on desktop and touch in both formats, and reading coverage with an interrupted connection. The new note tests also exercise the five-minute timer and desktop-only drop hover.
- TypeScript, ESLint and production build: clean.
- **62 desktop browser cases and 7 mobile cases** passed across the local Chromium runs: Duo, Group, room visibility/authorization, PDF, upload, management, recovery, voice/video, responsive and soundtrack checks. See TESTING.md for reproducible commands.
- The 64 MB local upload passes pause/resume, connection interruption, cancellation and full stored-file hash verification.
- Mobile automation covers eight viewports from 320 px phones through 1440 px laptops, theme/focus controls, page cues, hide/show playback and reconnecting progress.
- The subsequent reader-tools update passed 40 relevant browser cases: PDF zoom/highlights/resume, desktop and phone double-tap/drawing flows in both formats, Duo, and both responsive projects. No new library or database migration was needed.
- The corrected 20–120% range passed all 13 reader browser cases and 60 unit tests, including both zoom limits, the 80% panning threshold, and conversion / persistence of old preferences.
- The 2026-10-01 reader layout passed 48 relevant browser cases across the final runs and 60 unit tests: full-height PDF views, eight screen sizes, vertical avatar stacks, keyboard controls, notes/highlights, music-player clearance and reconnection. TypeScript and ESLint are clean.

GitHub `main` and `alpha-build` feed the Vercel production pipeline at https://book-quest-ecru.vercel.app/. The initial hosted alpha was implementation commit `46c29b5`; the reader-tools update continues that deployment flow.

The hosted smoke passed on 2026-09-30: two temporary readers signed up, uploaded an EPUB, created/joined a private room, opened the reader, played shared audio and used a 390 px phone layout without overflow. Realtime connected live. Temporary test accounts, rooms, books and Storage files were removed. A fresh friend code preserves all 20 signup places.

Physical iOS/Android checks and actual SMTP delivery remain outside automated local verification. Production password-reset delivery requires configured SMTP; the two admins receive private generated setup links instead.

## Remaining validation

Run the friend-device matrix in TESTING.md and record findings through Feedback. Full offline startup, guaranteed codec support, instant revocation of issued signed URLs, public signup, per-account quotas and abandoned-upload cleanup are not delivered in this alpha. PUBLIC_RELEASE_GATES.md distinguishes those boundaries from the current friend test.
