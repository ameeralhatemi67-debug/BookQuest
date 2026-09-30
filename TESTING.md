# BookQuest testing guide

This closed alpha tests whether reading separately still feels shared. Use original/public-domain books or files your group is allowed to share. Share the private alpha code with the group, create accounts, upload a small EPUB or PDF, create a private room and invite each other from that room.

## Friend test session

| Test | What to try | Expected result |
| --- | --- | --- |
| Different devices | Small phone, large phone, tablet, landscape phone and laptop | Readable page, reachable controls, no horizontal page overflow |
| Shared reading | One reader moves ahead while another stays early | Live progress updates; future notes stay neutral and locked |
| Notes | Text selection/long press, emoji, image, voice recording, audio, video and link | Selection stays anchored; content opens at the correct place |
| Soundtrack | Add a track; leave another at a later page | Shared playlist works; future title/audio stay hidden until reached |
| Music controls | Play/pause, seek, volume, next, hide/show and Stop | Pause preserves position; hide keeps music; Stop disarms automatic cues |
| Wi-Fi drop | Disconnect during upload and while reading, then reconnect | Upload reports retry and resumes; reading place saves after reconnection |
| Files | Wrong extension, empty/corrupt file, duplicate book, file over 50 MB | Clear error or duplicate result before an unusable book becomes ready |
| Room lifecycle | Invite, leave/rejoin, close, archive/restore, remove member | Access and progress stay consistent; archived rooms reject new contributions |
| Reader settings | Themes, typeface, width, size, line spacing, focus, PDF zoom | Book position stays usable; settings remain readable |
| Accessibility | Keyboard Tab, visible focus, Escape, reduced motion, zoom | Controls remain usable without hover or animation |
| Errors | Deny microphone, use unsupported audio codec, open expired invite, sign out | Understandable recovery action without a broken page |

Report problems with **Feedback**. Include what you expected, what happened, the file format and steps to reproduce. The app attaches safe page/device context. A screenshot is useful if the problem concerns layout.

The 50 MB hosted ceiling applies to books, audio and video; images cap at 25 MB, avatars at 10 MB. An already-open EPUB can keep reading from its cache during a drop. Full offline startup is not implemented; PDF ranges or uncached audio may still need the network. Audio playback and microphone permissions differ between iOS Safari and Android Chrome, so physical-device checks matter.

## Automated checks

```powershell
npm ci
npm run test:all
npm run typecheck
npm run lint
npm run build
```

For browser acceptance checks, keep `npm run dev:local` running in one terminal, then use another:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:56421'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_local_emulator'
npx playwright install chromium
npx playwright test --project desktop
npx playwright test --project mobile
```

Generated book fixtures, screenshots and traces are ignored by Git. Desktop specs cover Duo, five-reader Group, room visibility/RLS attacks, EPUB/PDF, large interrupted uploads, management, recovery and media. Mobile tests resize through eight viewports and exercise soundtrack cues and network recovery. The local large-upload check uses a generated 64 MB PDF and verifies its full stored SHA-256 hash; local limits intentionally exceed the hosted 50 MB cap.

The reader-tools spec also creates desktop and touch-phone contexts for PDF and EPUB. It checks full-page / two-page PDF bounds, spread navigation, double-click / double-tap notes, drawing color and stroke size, and a saved 800 × 480 PNG reopening from its note link. The PDF regression checks cover selected passages, highlights after zoom, resume and spoiler unlocks. Try these gestures on physical Safari and Android devices too; long press and dragging should still select text rather than open a note.

These suites create disposable local accounts and files. Do not point the acceptance suite at production with the local seed or run a remote database reset. Production checks should use a small number of clearly identified test accounts and remove only their own data afterward.
