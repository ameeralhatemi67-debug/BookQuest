# BookQuest shared reading alpha

BookQuest, currently titled **Marginalia** in the app, lets friends read one EPUB or PDF at their own pace. Notes, reactions and media open only when a reader reaches their place in the book. Private rooms, progress, presence and a shared soundtrack make the book the meeting place.

Production: https://book-quest-ecru.vercel.app/. Open alpha for the first 75 readers, no code needed.

## Run locally

```powershell
npm ci
npm run dev:local
```

Open http://localhost:3000 and sign up; no code is needed (the local emulator has no seat limit). The local backend runs at `127.0.0.1:56421`, requires no Docker, and keeps its database and uploads in `.local/emulator`. `admin@local.test` becomes a local admin when registered. These are local credentials only.

For hosted development, copy `.env.example` to `.env.local`, fill in the public Supabase values, and run `npm run dev`. Never put a secret or service-role key in this app.

## Keeping the logs

This is a standing rule for every change, whoever makes it. Nobody needs to ask for it.

1. **CHANGELOG.md gets every change.** Each feature, change or fix, however small, is added under the date the work was done (newest first), written as what changed for people using the app, with technical notes where they matter. Mark whether it is deployed.
2. **The in-app What's new window gets noteworthy releases.** When a batch of work adds several important or noteworthy features, add a release at the top of `WHATS_NEW` in `src/lib/whats-new.ts` with a new `id`. A new id makes the window open once for every reader; it is always reachable from the account menu. Write one plain line per feature, for readers rather than developers.

Update both logs in the same commit as the work.

## Use the soundtrack

Open the headphones button inside a book, choose an audio file and give it a name. Add it to the room playlist, or select **Start when a friend reaches this page** to leave a page cue. A friend opts in with **Play music when I reach a page cue**. Future cue titles and audio stay hidden until reached.

Play, pause, seek, volume, next and stop are available in the panel. Close the panel to keep a compact player; hide that player to keep listening without covering the page. Stop also turns off automatic cues. Browser audio permissions can require another tap.

## Checks and project notes

```powershell
npm run typecheck
npm run lint
npm run test:all
npm run build
```

- [Setup and deployment](SETUP.md)
- [Architecture and access rules](ARCHITECTURE.md)
- [Current status](STATUS.md)
- [Friend testing guide](TESTING.md)
- [Public release gates](PUBLIC_RELEASE_GATES.md)
- [Local backend](dev/emulator/README.md)

The hosted project currently caps files at 50 MB. This is a web alpha: an already-open cached EPUB can survive a connection drop, but opening the app offline is not a supported flow.
