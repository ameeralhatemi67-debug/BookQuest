// Local Supabase emulator.
//
// Serves the slices of Supabase this app uses — Auth, the Data API, Storage
// (incl. TUS resumable uploads) and Realtime — on top of PGlite running the
// project's real migrations. It exists so the app can be developed, driven in
// a browser and end-to-end tested with no Supabase project and no Docker.
//
// It is a development tool, not a Supabase replacement: see dev/emulator/README.md
// for what is and is not emulated.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { claimsFromRequest, handleAuth, type Mail } from "./auth";
import { createDb, projectRoot } from "./db";
import { createRealtime } from "./realtime";
import { handleRest } from "./rest";
import { createStorage } from "./storage";
import { readJson, sendJson } from "./util";

export interface EmulatorOptions {
  port?: number;
  /** Directory for the database and uploaded files. `null` = in-memory database + temp files. */
  dataDir?: string | null;
  siteUrl?: string;
  confirmEmail?: boolean;
  quiet?: boolean;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, prefer, range, accept, accept-profile, content-profile, x-client-info, " +
    "x-supabase-api-version, x-upsert, cache-control, tus-resumable, upload-length, upload-metadata, upload-offset, " +
    "upload-defer-length, upload-concat, x-http-method-override",
  "Access-Control-Expose-Headers":
    "content-range, content-length, accept-ranges, location, upload-offset, upload-length, tus-resumable, tus-version, tus-extension, tus-max-size",
  "Access-Control-Max-Age": "86400",
};

export async function startEmulator(options: EmulatorOptions = {}) {
  const port = options.port ?? Number(process.env.EMU_PORT ?? 56421);
  const dataDir = options.dataDir === undefined ? join(projectRoot, ".local", "emulator") : options.dataDir;
  const siteUrl = options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const log = options.quiet ? () => {} : (message: string) => console.log(`[emulator] ${message}`);

  const db = await createDb({
    dataDir: dataDir ? join(dataDir, "pgdata") : undefined,
    seed: true,
    changeFeed: true,
    log,
  });

  const inbox: Mail[] = [];
  const chaos = { failNextPatches: 0 };
  const authOptions = { siteUrl, confirmEmail: options.confirmEmail ?? process.env.EMU_CONFIRM_EMAIL === "1", inbox, log };
  const storageDir = dataDir
    ? join(dataDir, "storage")
    : join(process.env.TEMP ?? process.env.TMPDIR ?? "/tmp", `marginalia-emulator-${process.pid}-${Date.now()}`);
  const storage = createStorage(db, { dir: storageDir, log, chaos });
  const realtime = createRealtime(db, log);

  async function route(req: IncomingMessage, res: ServerResponse) {
    for (const [key, value] of Object.entries(CORS)) res.setHeader(key, value);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${port}`}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Tus-Resumable": "1.0.0", "Tus-Version": "1.0.0", "Tus-Extension": "creation,creation-with-upload,termination" }).end();
      return;
    }

    if (url.pathname.startsWith("/auth/v1")) return handleAuth(req, res, url, db, authOptions);

    const claims = claimsFromRequest(req);
    if (url.pathname.startsWith("/rest/v1")) return handleRest(req, res, url, db, claims);
    if (url.pathname.startsWith("/storage/v1")) return storage.handle(req, res, url, claims);

    // ---- emulator-only helpers (used by e2e tests and local development)
    if (url.pathname === "/emu/health") return sendJson(res, 200, { ok: true });
    if (url.pathname === "/emu/inbox") {
      const to = url.searchParams.get("to");
      return sendJson(res, 200, to ? inbox.filter((m) => m.to === to.toLowerCase()) : inbox);
    }
    // Control endpoints require a custom header that is deliberately absent from the
    // CORS allow-list, so no web page can reach them from a browser.
    if (url.pathname.startsWith("/emu/") && req.headers["x-emu-control"] !== "1") {
      return sendJson(res, 403, { message: "x-emu-control header required" });
    }
    if (url.pathname === "/emu/chaos" && req.method === "POST") {
      const body = ((await readJson(req)) ?? {}) as { failNextPatches?: number; disconnectRealtime?: boolean };
      if (typeof body.failNextPatches === "number") chaos.failNextPatches = body.failNextPatches;
      if (body.disconnectRealtime) realtime.disconnectAll();
      return sendJson(res, 200, { ok: true, chaos });
    }
    if (url.pathname === "/emu/sql" && req.method === "POST") {
      // Owner-level SQL for test set-up (e.g. expiring an invite). Local only.
      const body = ((await readJson(req)) ?? {}) as { query?: string; params?: unknown[] };
      try {
        const result = await db.pg.query(String(body.query ?? ""), body.params ?? []);
        return sendJson(res, 200, { rows: result.rows });
      } catch (error) {
        return sendJson(res, 400, { error: (error as Error).message });
      }
    }

    sendJson(res, 404, { message: `not emulated: ${req.method} ${url.pathname}` });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      log(`unhandled error for ${req.method} ${req.url}: ${(error as Error).stack ?? error}`);
      if (!res.headersSent) sendJson(res, 500, { message: (error as Error).message });
      else res.end();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").startsWith("/realtime/v1/websocket")) realtime.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  log(`Supabase emulator listening on http://127.0.0.1:${port}  (data: ${dataDir ?? "in-memory"})`);

  return {
    url: `http://127.0.0.1:${port}`,
    db,
    inbox,
    async close() {
      await realtime.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}

// Run directly: `tsx dev/emulator/server.ts`
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  startEmulator({ dataDir: process.env.EMU_MEMORY === "1" ? null : undefined }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
