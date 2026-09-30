# Local Supabase emulator

This development backend runs the project's real SQL migrations and RLS in PGlite. Small HTTP/WebSocket adapters provide the parts of Supabase used by BookQuest: Auth, REST queries/RPCs, private Storage, signed URLs, TUS uploads and Realtime/presence.

```powershell
npm run dev:local
```

The launcher starts the backend at `127.0.0.1:56421`, waits for `/emu/health`, then starts Next at `localhost:3000`. It supplies local public configuration and a 500 MB global upload ceiling. Stop the launcher with Ctrl+C to stop its children. Persistent data lives in `.local/emulator`; the parent directory is created on first use. Only one process should open that PGlite database at a time.

`npm run emulator` starts the backend alone. `EMU_PORT`, `EMU_CONFIRM_EMAIL=1` and `NEXT_PUBLIC_SITE_URL` customize its port and auth-email behavior. The local seed supplies `LOCAL-ALPHA` and makes `admin@local.test` an admin on signup. Do not use that seed remotely.

`GET /emu/inbox?to=…` returns local signup/recovery links; no real email is sent. SQL and failure-injection endpoints require `x-emu-control: 1` and exist only for tests. Do not host this server: its permissive CORS, development tokens, inbox and control endpoints are not production controls.

Storage keeps real files and metadata, supports byte ranges and resumable upload retries, and records the actual partial offset even when a request disconnects. Realtime rechecks row access before delivering hints. These adapters are not complete emulations of Supabase Auth, PostgREST, distributed Realtime or object storage.

`npm run test:all` uses isolated test instances. Browser tests use the running persistent instance. Stop the launcher before clearing its local data. Leave other projects' Docker/Supabase stacks untouched; this emulator does not need them.
