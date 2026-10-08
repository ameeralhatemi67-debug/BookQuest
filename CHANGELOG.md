# Changelog

Every feature, change and fix goes here, newest first, under the date the work was done. Noteworthy batches are also added to the in-app **What's new** window (`src/lib/whats-new.ts`). See "Keeping the logs" in README.md.

Each entry says what changed for people using the app; technical notes follow where they matter. "Deployed" means it reached https://book-quest-ecru.vercel.app/.

## 2026-10-08 · Room privacy switch and shareable What's new

Status: released 2026-10-08. No database migration. Listed in the What's new window as "Your room, your doors" (new release id, so it opens once for every reader).

### Switch a room between private and public
- Room settings now opens with **Who can join**: Private, Unlisted or Public (the existing "Open"). It takes effect at once and does not wait for Save changes. Only the room's owner sees it; moderators and members are told only the owner can change how the room works.
- Going public asks first ("The room will appear in Open Rooms and any alpha tester can join it"), going unlisted asks too, and going private happens immediately because it is easy to undo.
- Readers already inside stay when a room goes private. Newcomers can no longer join from Open Rooms or with the room link, and notes stay locked for anyone who has not reached them.
- Going private also retires the room link (it calls the existing `rotate_join_code`), so an old copy cannot come back to life if the room is opened up again later.
- A Private Duo is always private: the other choices are disabled and say why.
- Everyone in the room gets a notification ("… is now public"), and the room's activity reads "Olga made the room public". The Open badge and option description now say "Public".
- "Creator" means the room's owner. If the owner hands the room to someone else (member menu, Make owner), the new owner gets the switch and the old one loses it.
- Technical: no new SQL. `update_room` already refused anyone but the owner and already coerced Duo rooms to private; this adds the dedicated control and tests for it. The old visibility radio is no longer inside the settings form (it is still on New room), so saving the form can no longer overwrite a switch made a moment earlier.

### Share What's new
- The What's new window has a **Share** button. On phones and browsers with a share sheet it opens it with a short message (the release summary and its first few features) plus a link. Elsewhere it copies the same message and link to the clipboard.
- The link opens a new public page, `/whats-new`, readable without an account, with the latest release, earlier updates and Join / Sign in buttons. Chat apps show a preview card (generated image and Open Graph tags).
- Technical: `/whats-new` is added to the proxy's public paths (the preview image lives under it). The feature list component is shared between the window and the page (`whats-new-items.tsx`).
- Tests: 6 new database tests (switching, who may, what newcomers can reach, Duo, ownership transfer), 3 unit tests for the share message, 7 browser cases in `e2e/room-privacy-and-sharing.spec.ts`.

## 2026-10-07 · Phone hotfixes

Not in the What's new window (fixes only).

- Home on phones no longer zooms out or scrolls sideways. On phones, Home's grids had no explicit column, so a long single-line title (such as a long Arabic room name) stretched the column, and with it the whole page, past the screen. The Home, reading-desk, predictions and vault grids now hold their single column to the screen width.
- Room and book titles use automatic text direction, so Arabic titles read right to left and truncate on the correct side. Very long unbreakable room names wrap on the reading desk instead of being clipped.
- Book map on phones, decluttered: the Map/Contents switch, a key button and close share one header row (the repeated "The map" heading is now screen-reader only); a one-line summary; avatar-only friend chips with the chosen friend's name; the key and the footer note move behind the ⓘ button; tighter rows. Books without chapters (like PDFs without an outline) drop the redundant row numbers, say "You're 3% in", and keep reader avatars inside each rail.
- New regression test: `e2e/phone-layout.spec.ts` (Home width with long titles, map, key and contents at 390 px).

## 2026-10-07 · Emotional multiplayer reading

Status: deployed 2026-10-07. Hosted migration `20261007182115_emotional_multiplayer.sql` applied and verified (every function definition matches the repo).

### Fixes from the full test run
- Room page: Room rituals now sit below Readers and activity. Loading them a moment after the page used to push the member list down while its menu was opening.
- Reader on phones: moment pills (just opened, predictions ready, afterparty) float above the music player instead of covering it.
- Tests: updated for open signup, the Map and contents button, and own notes staying still.

### Logs
- Added this changelog and the in-app **What's new** window. It opens once per new release (never in automated test browsers) and stays in the account menu, with a gold dot on the avatar while unseen.
- README now says that both logs are always kept up to date.

### Access
- Removed the alpha code. Anyone can sign up; the first 75 accounts are let in automatically.
- Readers who arrive when all seats are taken see "The alpha is full for now" and can check for a free seat. Admins can let them in from the Testers tab.
- Admin Access tab: the code generator is replaced by a seat meter and a seat-count setting (1 to 75). The email allowlist still always gets in.
- Rooms now hold up to 75 readers (was 50).
- The local emulator lifts the seat limit for itself, because test runs accumulate accounts.

### Per-room feature toggles
- Fifteen switches per room: predictions, polls, packages, soundtrack, rituals, animated notes, book map, friend lens, reaction weather, live reading, race standings, chapter afterparties, "while you were away", reread echoes and the vault. Missing means on, so every room starts with everything.
- Owners and moderators change them in Room settings ("What this room tests"); admins change them for any room from the Rooms tab.
- Features that create something are also refused by the database when switched off.
- Feedback now records which features were off, and the admin feedback list shows it.

### Reader
- **Flip or Scroll** setting. Flip turns pages like a book: the sheet lifts on its spine, bends slightly, darkens as it turns and reveals the next page coming out of its shadow. Two-page PDF spreads turn as one continuous sheet. Scroll keeps the continuous PDF and adds a continuous EPUB flow.
- Flip works from the arrows, edge taps, swipes, the keyboard and (for PDFs) the mouse wheel. Enlarged PDF pages still scroll within themselves.
- Reduced motion turns pages instantly.
- One **Leave something here** sheet for all four kinds: Note, Package, Prediction, Poll.
- The Contents button became **Map and contents**; the trail panel gained a **Predictions** tab.
- Technical: turns are View Transitions. epub.js schedules navigation on animation frames, which never run while a transition waits, so turns drive its view manager directly and report the location after landing.

### Note attention, five levels
- Whisper (leans in and breathes, three hush dots), Gentle (floats, one soft hop), Excited (two hops and a spinning leap with sparkles), Knock knock (leans back and raps on the page) and DO NOT IGNORE THIS (leaps, spins, lands hard, shockwave, shivers, and gets more insistent after 15 seconds).
- Built from layered motion: arc, spin, squash and stretch, a lagging aura for follow-through, blurred ghost copies for motion blur, and per-level effects.
- A note performs only on a page the reader has reached, and only until it is opened. Your own notes stay still.
- The composer shows your own avatar rehearsing the level you pick.
- Off-screen avatars pause. Reduced motion shows a small still mark instead.
- Hover or focus stops the performance and the avatar perks up.

### New things to leave
- **Sealed predictions.** They open at the next chapter, a point you choose or the end, optionally sealed from the author too, and can never be edited. Readers get "N predictions are ready to open", open them in a small ceremony and judge them: Called it, Close or Way off.
- **Polls at a passage.** The question stays hidden until a reader arrives, results show only after voting, and votes are final.
- **Packages.** A note for one friend that can hold up to eight things (message, voice, photos, drawing, song file or link) under a label they see in advance. The friend gets a heads-up, sees a wrapped box on their trail, and unwraps it on first opening.

### Seeing the room
- **Book map.** Chapters drawn as short rails. Behind you: kinds of things and the top reactions. Ahead: only a gold glow sized by how much is waiting. Shows readers' positions, opens afterparties and jumps to any chapter.
- **Friend lens.** See only one friend's trail, from the map or the eye button on the progress rail. A banner returns to everyone.
- **Live reading.** "Sara is reading too", knocks that shake their rail avatar, and Read together (finer, faster live positions while each reader keeps their own pages). No notifications.
- **Reaction weather.** Reach a page and see its reactions for a few seconds; the map shows each chapter's mood.
- The progress rail shows packages as gift boxes, polls as squares and predictions as diamonds; ahead of you they stay neutral.

### Moments
- **Chapter afterparties.** When every reader has cleared a chapter, its notes, polls, predictions, songs and reactions open as one scrapbook. Everyone gets notified, and the room page links to each one.
- **While you were away.** A short story when you return ("Sara read 3 chapters, passed you, left 2 things ahead and replied to your note in Chapter 4"), on Home and when opening the book.
- **Room rituals.** Templates for "everyone predicts before…", "vote before continuing", "leave a song before…" and "nobody reads past… until…" (a soft curtain with Go back or Read on anyway), plus free-form challenges. Each shows who has done it.
- **Reread echoes.** Your notes, and notes you had opened, from an earlier room reading the same file come back as faded memories as you reach them.
- **Ratings and the vault.** Rate the book at the end. The vault opens at the last page: a replay of everyone's progress along the rail, every prediction with its verdicts, the first note, the most-reacted and funniest moments, ratings, the soundtrack in reading order, the most-discussed chapter, poll results and the room's pictures.
- New activity and notification copy for predictions, polls, rituals, afterparties and packages.

### Home
- Home opens on a **reading desk**: the current book large, your place, everyone's progress, packages and things waiting, ready predictions, the away story and one Continue reading button. Rooms, discovery, activity and books sit below as supporting material.

### Technical
- One additive migration (`20261007182115_emotional_multiplayer.sql`): `app_settings`, `rooms.features`, `books.outline`, predictions, polls, rituals, ratings, afterparties, progress snapshots and visits, read models `room_layer`, `room_away`, `reading_echoes` and `room_vault`, and an updated `create_annotation`.
- New tables have no client grants; reads go through spoiler-stripping read models. Freshness comes from room activity plus Broadcast hints on the room channel. The emulator now relays Broadcast.
- Tests: 11 new database tests (each spoiler gate, seats, features, afterparties, rituals, away summary, vault, echoes), rewritten access tests, a two-reader showcase browser spec (`e2e/multiplayer.spec.ts`) and a motion-capture probe (`MOTION_CAPTURE=1`).

## 2026-10-01 · Living notes and earned reading

Deployed.

- Note avatars with Quiet, Gentle and Playful attention: tap for a speech bubble, double tap to reply, drag within the page, wiggle or tap to snooze for five minutes.
- Exact pins for selections and page taps; paired PDF pages reserve a note gutter.
- Notes for everyone, only me, or one chosen reader, enforced by the database across content, downloads, unlocks, notifications and summaries.
- Reading coverage: credit comes from time on visible passages, adapting to reading pace, with scan detection and revisit credit. Finishing needs 90% coverage plus the final section.
- Full-height pages and a vertical progress rail on the left; avatars on the rail morph into a drop pointing at their place.

## 2026-09-30 · The alpha opens

Deployed (production smoke check passed the same day).

- Accounts with closed-alpha access (since replaced by open seats), password reset, email confirmation.
- Book uploads (EPUB and PDF) with resumable uploads for large files, cover and metadata from the file, per-uploader dedupe.
- Rooms: private, unlisted or open; Chill, Race and Private Duo modes; invitations, roles, closing, archiving.
- EPUB and PDF readers with saved progress, themes (light, sepia, dark), type settings, focus mode and PDF zoom (20–120%, two-page view).
- Spoiler-locked notes with text, emoji, links, photos, voice, video and drawings; replies and reactions; double click or double tap to leave a note at a passage.
- Shared progress track, realtime presence, notifications and activity.
- Journey, search, profile, alpha admin and feedback.
- Shared soundtracks with page-cued songs.
- Local Supabase emulator, database and integration test suites, and browser acceptance tests.
