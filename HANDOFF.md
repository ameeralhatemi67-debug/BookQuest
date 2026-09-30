# Handoff — Shared Reading closed alpha ("Marginalia")

> Historical handoff. Work continued on 2026-09-30: see STATUS.md, SETUP.md and TESTING.md for the current implementation and hosted state.

Written 2026-09-30 at a deliberate stopping point. Everything below is the state of the
`alpha-build` branch at the commit that adds this file. `main` is untouched (initial commit only).
Nothing has been pushed.

The brief for this work is the long "Full Closed Alpha Build" prompt (64 sections) plus
`idea_seed.md`. The product name **Marginalia** is a working title I chose; it is one constant in
`src/lib/config.ts`.

---

## 1. Where things stand

**Built and working end to end (verified against a real local Supabase stack):**
auth + alpha gate, book upload pipeline, rooms (private / unlisted / open), invitations, roles,
the EPUB and PDF readers, progress saving, the shared progress track, spoiler-locked notes with
media, unlock/reveal, replies, reactions, realtime + presence, notifications, activity.

**Built but never opened in a browser:** Journey page, Search, Profile (incl. avatar upload),
Alpha admin, the Feedback dialog. They typecheck and lint; treat them as untested.

**Not started:** all documentation files, a production build check, the final report.

### Check results at this commit

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` | clean |
| `npm test` (unit, 57 tests) | pass |
| `npm run test:db` (PGlite, real migrations, 93 tests) | pass |
| `npm run test:integration` (18 tests) | passed on the emulator **and** on real local Supabase — but last run *before* a later change to `src/lib/storage/upload.ts` (standard uploads now re-wrap the Blob with the validated content type). Re-run it. |
| e2e `duo.spec.ts` (13) | pass |
| e2e `rooms.spec.ts` (13) | pass |
| e2e `group.spec.ts` (8) | pass |
| e2e `upload.spec.ts` (8, 64 MB file, throttled, pause/resume, offline cut) | pass |
| e2e `pdf.spec.ts` (9) | **4 pass, test 5 fails, 6–9 did not run** — see §3 |
| `next build` | **never run** |

All e2e runs were on the `desktop` Playwright project against `npm run dev` + the Docker Supabase
stack. The `mobile` project has no spec yet.

---

## 2. Environment you are inheriting

- **Local Supabase (Docker), still running:** project id `marginalia`, API `http://127.0.0.1:56321`,
  Postgres `56322`, Mailpit `http://127.0.0.1:56324`. Ports were moved off the defaults because two
  other Supabase stacks on this machine (`P6S_wave3_…`, `P6_accept_disposable`) use 54321–54327.
  **Those belong to other projects — do not stop or reset them.**
  - start: `npx supabase start -x studio,logflare,vector,imgproxy,edge-runtime,postgres-meta,supavisor`
  - stop: `npx supabase stop` (keeps data)
  - wipe + re-apply migrations + seed: `npx supabase db reset`
- **`.env.local`** (git-ignored) points the app at that local stack with the standard local
  publishable key. Replace its three values to use a hosted project.
- **Dev server:** `npm run dev` on port 3000. It does not survive a session restart; start it again.
- **Seed:** alpha code `LOCAL-ALPHA` (1000 uses) and allowlisted admin email `admin@local.test`
  (`supabase/seed.sql`, local only).
- **Migrations have been edited in place** (nothing is deployed anywhere yet). After changing a
  migration run `npx supabase db reset`. Once a hosted project exists, switch to additive migrations.
- e2e runs leave users/rooms/books in the local database; `db reset` cleans them.
- Docker Desktop on this machine failed to start on its own earlier in the session (its backend
  crashed on an internal socket). The user started it manually; if it is down again, ask them.

### Tooling gotchas hit in this session

- Bash heredocs / `node -e` containing apostrophes or backticks break. Use the Write/Edit tools, or
  write a small `.mjs` patch file and run it.
- The in-app browser pane cannot screenshot or click while its window is hidden. Playwright
  (headless) was the reliable way to drive the app; failure screenshots land in `test-results/`.
- Next.js is 16.3: `proxy.ts` (not `middleware.ts`), async `params` / `searchParams` / `cookies()`.
  Bundled docs are in `node_modules/next/dist/docs/`.
- The React lint rules are strict (`react-hooks/set-state-in-effect`, `purity`, `immutability`).
  Patterns used to satisfy them: mount dialog bodies only while open instead of resetting state in
  an effect; `useSyncExternalStore` for localStorage; fetch-then-set with a `cancelled` flag.

---

## 3. Known failure to fix first

`e2e/pdf.spec.ts` → "a note can be anchored to a selected passage". The test selects text
programmatically on the page *after* the current one, which can be below the viewport, so the
floating selection toolbar is positioned off-screen and Playwright cannot click "Note".

- Probably a test problem (a real reader selects visible text): scroll the target page into view
  before selecting, or select on the current page.
- Still worth hardening `SelectionToolbar` in `src/components/reader/reader-app.tsx` so its `top`
  is always clamped inside the viewport.
- Tests 6–9 in that file (highlight survives zoom, resume after reload, second reader unlocks,
  console clean) have never run.

---

## 4. Remaining work, in the order I would do it

1. Fix §3 and get `pdf.spec.ts` green.
2. `npm run build` — never attempted. Expect to find issues (e.g. `next/font` needs network;
   `pdfjs-dist` legacy import under Turbopack in production mode).
3. **`scripts/dev-local.mjs` does not exist** but `package.json` has `"dev:local"` pointing at it,
   and the landing page's "connect Supabase" screen tells people to run it. Write it (start
   `dev/emulator/server.ts`, then `next dev` with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56421`
   and any publishable key) or remove the references. The emulator has only been exercised by
   `tests/integration`, never by the Next app or by e2e.
4. Open the untested screens in a browser and fix what breaks: Journey, Search, Profile + avatar,
   Admin (all tabs), Feedback dialog, room settings (save / archive / restore), invite-by-name,
   book edit / delete, disabled-book and deleted-book reader states.
5. Reader features with no browser coverage yet: EPUB text selection → toolbar → quick reaction;
   EPUB highlights; sepia and dark themes; font size / line height / width / typeface; voice
   recording (MediaRecorder); video attachments; the "finished the book" dialog; chapter trail dots
   in Contents; note search in the ✦ panel; the offline / reconnecting indicators; deep links
   `/read/{room}?note={marker}` from notifications.
6. Responsive + touch: add `e2e/responsive.spec.ts` (the `mobile` project in `playwright.config.ts`
   already matches that filename). Check no horizontal overflow, tap zones, swipe, bottom nav,
   44px touch targets. Keyboard pass: tab order, visible focus, Escape closes panels.
7. Auth flows not exercised: password reset, email-confirmation-on sign-up, `/auth/confirm`
   (token-hash links) and `/auth/callback` (code exchange). Add `supabase/templates/*.html` with the
   token-hash links and wire them in `supabase/config.toml` so local Mailpit matches what SETUP.md
   will tell the user to paste into the dashboard.
8. Look at the screens. Only the landing page, the books page and the EPUB reader have been seen
   (in failure screenshots). Visual polish has not had a pass.
9. Write the docs the brief requires: `README.md`, `SETUP.md` (exact dashboard steps for Supabase
   and Vercel, first admin, inviting 12 testers), `ARCHITECTURE.md`, `STATUS.md` (from reality),
   `TESTING.md`, `PUBLIC_RELEASE_GATES.md`, and `dev/emulator/README.md`.
10. Move `jszip` from `devDependencies` to `dependencies` (it is imported by
    `src/lib/books/epub.ts`).
11. Re-run everything, then the final report (brief §64).

---

## 5. Map of the code

```
supabase/migrations/      11 SQL files: schema, RLS, RPCs, storage buckets+policies, realtime, grants
supabase/seed.sql         local-only alpha code + admin allowlist
dev/emulator/             PGlite-backed Supabase look-alike (auth, REST, storage+TUS, realtime)
  compat.sql              stubs of Supabase's auth/storage/realtime schemas so real migrations apply
  db.ts                   also used by tests/db to boot an in-memory database
src/proxy.ts              session refresh + signed-out redirect
src/lib/
  config.ts limits.ts location.ts progress-track.ts room-modes.ts errors.ts format.ts types.ts
  supabase/{client,server,proxy,guard}.ts
  storage/upload.ts       standard + TUS uploads (progress, retry, pause/resume, cancel)
  books/{epub,pdf,hash}.ts  inspect a book before upload; PDF.js loader
  realtime/use-room-channel.ts  one private channel per room: row-change hints + presence
src/components/
  app/        providers, shell, notifications, feedback, search, profile
  books/      upload state machine + library
  room/       progress track, lobby, cards, invite dialog, settings, activity
  reader/     reader-app (orchestrator), epub-viewer, pdf-viewer, notes, composer, media,
              use-progress, use-annotations
  admin/      admin-view
src/app/      (auth) login/signup/forgot/reset/alpha/invite · (app) home/books/rooms/discover/
              notifications/search/profile/admin · (reader) read/[roomId] · auth/confirm, auth/callback
tests/unit  tests/db  tests/integration  e2e/
scripts/copy-pdf-assets.mjs   copies the PDF.js worker to public/pdfjs (postinstall, predev, prebuild)
scripts/make-fixtures.mjs     generates original test books into e2e/.fixtures (git-ignored)
```

## 6. Decisions worth knowing before changing things

- **Spoiler lock is authorization.** `annotation_markers` holds only who/where. Text, emoji, link,
  quote, attachments, replies and reactions are readable only by the author or a member with a
  `reading_unlocks` row, which only security-definer functions write. Storage policies apply the
  same rule to the media bytes. Tested in `tests/db/spoilers.test.ts` and `e2e/duo.spec.ts`.
- **Progress is self-reported.** The client says where it is; the server cannot know whether the
  pages were read. To avoid accidental unlocks, a position only counts after the reader settles on
  it (2.5 s dwell, 1.1 s when a locked note is on the page) — see `use-progress.ts`. Leaving a note
  saves progress immediately.
- **One number for social features:** normalized progress 0..1, measured at the *end* of the visible
  page. EPUB uses a locations index generated once at upload and stored next to the book
  (`locations.json`) so every reader shares the same positions.
- **All room / membership / invite / progress / note writes go through RPCs**; tables have select
  policies only. Function EXECUTE grants live in one migration (`…0900_api_grants.sql`).
- **No service-role key anywhere.** The app uses the publishable key plus the user's session.
- **Large files never touch the app server**: TUS straight to Storage above 6 MB.
- **Visibility:** private = invitation tokens only; unlisted = a room link (`rooms.join_code`) works;
  open = listed and joinable. A Private Duo is forced to private with a limit of 2.
- **Avatars bucket is public-read**; every other bucket is private.
- **Book dedupe is per uploader** (unique `uploader_id + sha256`), not global, so nobody can learn
  that someone else holds the same file.
- **EPUB scripts never run** (`allowScriptedContent: false`). Chrome logs "Blocked script execution
  in 'about:srcdoc'" for this; the e2e console check ignores that one message on purpose.
- **Race mode "passed" activity** is limited to once per pair per 12 hours (found by the group test).
- The reader is client-only (`reader-loader.tsx`, `ssr: false`).

## 7. Things I would watch or question

- The dwell-based unlock is a judgement call; real testers may find it too slow or too eager.
- Downloaded EPUBs are kept in the browser's Cache Storage and cleared on sign-out; signed book
  URLs last 6 hours. A member removed from a room keeps access until those expire.
- The emulator re-reads rows at delivery time, so its Postgres Changes are not byte-identical to
  Supabase Realtime. It is a development convenience, not a reference.
- Hosted Supabase has not been tried at all. The Storage "global file size limit", email
  confirmation settings and SMTP will need dashboard steps that SETUP.md must spell out.

## 8. Commands

```bash
npm run dev                 # app against whatever .env.local points to
npm run typecheck && npm run lint
npm test                    # unit
npm run test:db             # RLS / RPC tests on PGlite
npm run test:integration    # emulator; or set TEST_SUPABASE_URL + TEST_SUPABASE_KEY for a real backend
npx playwright test --project desktop            # all e2e (needs dev server + backend with LOCAL-ALPHA)
npx playwright test e2e/pdf.spec.ts --project desktop
node scripts/make-fixtures.mjs --large 64        # regenerate test books
```
