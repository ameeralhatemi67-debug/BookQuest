// Supabase Storage look-alike: standard uploads, TUS resumable uploads, signed
// URLs and range-capable downloads. Every operation is authorized by running
// the real storage.objects policies as the calling user, and every bucket's
// size / MIME limits are enforced — just like the hosted service.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Claims, EmuDb, PgError } from "./db";
import { readBody, readJson, sendJson, signValue } from "./util";

export interface StorageOptions {
  dir: string;
  log: (message: string) => void;
  /** Test hook: abort this many upcoming TUS PATCH requests mid-flight. */
  chaos: { failNextPatches: number };
}

interface Bucket {
  id: string;
  public: boolean;
  file_size_limit: string | number | null;
  allowed_mime_types: string[] | null;
}

interface TusUpload {
  id: string;
  bucket: string;
  name: string;
  size: number;
  offset: number;
  contentType: string;
  cacheControl: string;
  upsert: boolean;
}

const TUS_VERSION = "1.0.0";

function storageError(res: ServerResponse, status: number, error: string, message: string) {
  sendJson(res, status >= 500 ? 500 : 400, { statusCode: String(status), error, message });
}

const fileKey = (bucket: string, name: string) => createHash("sha1").update(`${bucket}/${name}`).digest("hex");

function mimeAllowed(bucket: Bucket, contentType: string): boolean {
  const allowed = bucket.allowed_mime_types;
  if (!allowed || allowed.length === 0) return true;
  const type = contentType.split(";")[0].trim().toLowerCase();
  return allowed.some((rule) => rule === type || (rule.endsWith("/*") && type.startsWith(rule.slice(0, -1))));
}

export function createStorage(db: EmuDb, options: StorageOptions) {
  const objectsDir = join(options.dir, "objects");
  const tusDir = join(options.dir, "tus");
  const ready = Promise.all([mkdir(objectsDir, { recursive: true }), mkdir(tusDir, { recursive: true })]);

  const objectFile = (bucket: string, name: string) => join(objectsDir, fileKey(bucket, name));
  const tusFile = (id: string) => join(tusDir, id);
  const tusMeta = (id: string) => join(tusDir, `${id}.json`);

  async function getBucket(id: string): Promise<Bucket | null> {
    const res = await db.pg.query<Bucket>("select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1", [id]);
    return res.rows[0] ?? null;
  }

  async function canRead(claims: Claims | null, bucket: string, name: string): Promise<boolean> {
    return db.asUser(claims, async (tx) => {
      const res = await tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]);
      return res.rows.length === 1;
    });
  }

  /** Inserts (or upserts) the object row as the user, so INSERT/UPDATE policies decide. */
  async function writeRow(claims: Claims | null, bucket: string, name: string, metadata: Record<string, unknown>, upsert: boolean, dryRun = false) {
    const DRY = Symbol("dry-run");
    try {
      await db.asUser(claims, async (tx) => {
        const conflict = upsert
          ? "on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()"
          : "";
        await tx.query(
          `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
           values ($1, $2, $3::text::uuid, $3, $4::text::jsonb) ${conflict}`,
          [bucket, name, claims?.sub ?? null, JSON.stringify(metadata)],
        );
        if (dryRun) throw DRY;
      });
    } catch (error) {
      if (error !== DRY) throw error;
    }
  }

  function rowErrorResponse(res: ServerResponse, error: unknown) {
    const pg = error as PgError;
    if (pg.code === "42501") return storageError(res, 403, "Unauthorized", "new row violates row-level security policy");
    if (pg.code === "23505") return storageError(res, 409, "Duplicate", "The resource already exists");
    options.log(`storage error: ${pg.message}`);
    return storageError(res, 500, "InternalError", pg.message);
  }

  function checkLimits(res: ServerResponse, bucket: Bucket, size: number, contentType: string): boolean {
    const limit = bucket.file_size_limit === null ? null : Number(bucket.file_size_limit);
    if (limit !== null && size > limit) {
      storageError(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
      return false;
    }
    if (!mimeAllowed(bucket, contentType)) {
      storageError(res, 415, "invalid_mime_type", `mime type ${contentType} is not supported`);
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------ downloads
  async function serveObject(req: IncomingMessage, res: ServerResponse, bucket: string, name: string) {
    const meta = await db.pg.query<{ metadata: { mimetype?: string; size?: number } }>(
      "select metadata from storage.objects where bucket_id = $1 and name = $2",
      [bucket, name],
    );
    const file = objectFile(bucket, name);
    if (meta.rows.length === 0 || !existsSync(file)) {
      return storageError(res, 404, "not_found", "Object not found");
    }
    const size = (await stat(file)).size;
    const contentType = meta.rows[0].metadata?.mimetype ?? "application/octet-stream";
    const headers: Record<string, string | number> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      ETag: `"${fileKey(bucket, name)}-${size}"`,
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return void res.end();
      await pipeline(createReadStream(file, { start, end }), res).catch(() => {});
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": size });
    if (req.method === "HEAD") return void res.end();
    await pipeline(createReadStream(file), res).catch(() => {});
  }

  function signPath(bucket: string, name: string, expiresIn: number): string {
    const payload = Buffer.from(JSON.stringify({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + expiresIn })).toString("base64url");
    const token = `${payload}.${signValue(payload)}`;
    return `/object/sign/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}?token=${token}`;
  }

  function verifySignedToken(token: string, bucket: string, name: string): boolean {
    const [payload, signature] = token.split(".");
    if (!payload || signature !== signValue(payload)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { url: string; exp: number };
      return data.url === `${bucket}/${name}` && data.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ TUS
  async function loadTus(id: string): Promise<TusUpload | null> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !existsSync(tusMeta(id))) return null;
    return JSON.parse(await readFile(tusMeta(id), "utf8")) as TusUpload;
  }

  const saveTus = (upload: TusUpload) => writeFile(tusMeta(upload.id), JSON.stringify(upload));

  async function appendChunk(req: IncomingMessage, upload: TusUpload, abortMidway: boolean): Promise<void> {
    const out = createWriteStream(tusFile(upload.id), { flags: "a" });
    let received = 0;
    try {
      for await (const chunk of req) {
        const buf = chunk as Buffer;
        if (abortMidway && received > 0) {
          // Simulate the connection dropping partway through a chunk.
          req.socket.destroy();
          break;
        }
        if (!out.write(buf)) await new Promise((resolve) => out.once("drain", resolve));
        received += buf.length;
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    // Whatever made it to disk counts, exactly like a real interrupted PATCH.
    upload.offset = (await stat(tusFile(upload.id))).size;
    await saveTus(upload);
  }

  async function finishTus(claims: Claims | null, upload: TusUpload) {
    await writeRow(claims, upload.bucket, upload.name, {
      size: upload.size,
      mimetype: upload.contentType,
      cacheControl: upload.cacheControl,
      eTag: `"${randomUUID()}"`,
    }, upload.upsert);
    await rename(tusFile(upload.id), objectFile(upload.bucket, upload.name));
    await rm(tusMeta(upload.id), { force: true });
  }

  function tusHeaders(res: ServerResponse) {
    res.setHeader("Tus-Resumable", TUS_VERSION);
    res.setHeader("Cache-Control", "no-store");
  }

  async function handleTus(req: IncomingMessage, res: ServerResponse, url: URL, claims: Claims | null, rest: string) {
    tusHeaders(res);
    const method = req.method ?? "GET";
    const id = rest.replace(/^\//, "");

    if (method === "POST" && id === "") {
      const size = Number(req.headers["upload-length"]);
      const metadata = Object.fromEntries(
        String(req.headers["upload-metadata"] ?? "")
          .split(",")
          .map((pair) => pair.trim().split(" "))
          .filter((pair) => pair[0])
          .map(([key, value]) => [key, Buffer.from(value ?? "", "base64").toString("utf8")]),
      ) as Record<string, string>;
      const bucketId = metadata.bucketName;
      const name = metadata.objectName;
      if (!bucketId || !name || !Number.isFinite(size) || size < 0) {
        return storageError(res, 400, "invalid_request", "Upload-Length and bucketName/objectName metadata are required");
      }
      const bucket = await getBucket(bucketId);
      if (!bucket) return storageError(res, 404, "Bucket not found", "Bucket not found");
      const contentType = metadata.contentType || "application/octet-stream";
      if (!checkLimits(res, bucket, size, contentType)) return;

      const upsert = String(req.headers["x-upsert"] ?? "") === "true";
      try {
        // Same as hosted Storage: refuse up front if the policies would reject the final object.
        await writeRow(claims, bucketId, name, { size, mimetype: contentType }, upsert, true);
      } catch (error) {
        return rowErrorResponse(res, error);
      }

      const upload: TusUpload = {
        id: randomUUID(), bucket: bucketId, name, size, offset: 0, contentType,
        cacheControl: metadata.cacheControl || "3600", upsert,
      };
      await writeFile(tusFile(upload.id), "");
      await saveTus(upload);

      if (String(req.headers["content-type"] ?? "").includes("application/offset+octet-stream")) {
        await appendChunk(req, upload, false);
      }
      if (upload.offset === upload.size) {
        try {
          await finishTus(claims, upload);
        } catch (error) {
          return rowErrorResponse(res, error);
        }
      }
      res.writeHead(201, {
        Location: `${url.origin}/storage/v1/upload/resumable/${upload.id}`,
        "Upload-Offset": upload.offset,
      }).end();
      return;
    }

    const upload = await loadTus(id);
    if (!upload) {
      res.writeHead(404).end();
      return;
    }

    if (method === "HEAD") {
      res.writeHead(200, { "Upload-Offset": upload.offset, "Upload-Length": upload.size }).end();
      return;
    }

    if (method === "PATCH") {
      if (Number(req.headers["upload-offset"]) !== upload.offset) {
        res.writeHead(409, { "Upload-Offset": upload.offset }).end();
        return;
      }
      const abort = options.chaos.failNextPatches > 0;
      if (abort) options.chaos.failNextPatches -= 1;
      await appendChunk(req, upload, abort);
      if (abort) return; // socket already destroyed
      if (upload.offset > upload.size) {
        await rm(tusFile(upload.id), { force: true });
        await rm(tusMeta(upload.id), { force: true });
        return storageError(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
      }
      if (upload.offset === upload.size) {
        try {
          await finishTus(claims, upload);
        } catch (error) {
          return rowErrorResponse(res, error);
        }
      }
      res.writeHead(204, { "Upload-Offset": upload.offset }).end();
      return;
    }

    if (method === "DELETE") {
      await rm(tusFile(upload.id), { force: true });
      await rm(tusMeta(upload.id), { force: true });
      res.writeHead(204).end();
      return;
    }

    res.writeHead(405).end();
  }

  // ------------------------------------------------------------ router
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, claims: Claims | null): Promise<void> {
    await ready;
    const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
    const method = req.method ?? "GET";

    if (path.startsWith("/upload/resumable")) {
      return handleTus(req, res, url, claims, path.slice("/upload/resumable".length));
    }

    // POST /object/sign/{bucket}[/{path}]  → signed URL(s)
    if (method === "POST" && path.startsWith("/object/sign/")) {
      const [bucket, ...parts] = path.slice("/object/sign/".length).split("/");
      const body = ((await readJson(req)) ?? {}) as { expiresIn?: number; paths?: string[] };
      const expiresIn = Number(body.expiresIn ?? 60);
      if (parts.length === 0) {
        const out = [];
        for (const p of body.paths ?? []) {
          const ok = await canRead(claims, bucket, p);
          out.push(ok ? { error: null, path: p, signedURL: signPath(bucket, p, expiresIn) } : { error: "Either the object does not exist or you do not have access to it", path: p, signedURL: null });
        }
        return sendJson(res, 200, out);
      }
      const name = parts.join("/");
      if (!(await canRead(claims, bucket, name))) return storageError(res, 404, "not_found", "Object not found");
      return sendJson(res, 200, { signedURL: signPath(bucket, name, expiresIn) });
    }

    if ((method === "GET" || method === "HEAD") && path.startsWith("/object/")) {
      const segments = path.slice("/object/".length).split("/");
      const mode = ["sign", "public", "authenticated"].includes(segments[0]) ? segments.shift()! : "authenticated";
      const [bucket, ...parts] = segments;
      const name = parts.join("/");
      if (mode === "sign") {
        if (!verifySignedToken(url.searchParams.get("token") ?? "", bucket, name)) {
          return storageError(res, 400, "InvalidJWT", "The signed URL is invalid or has expired");
        }
      } else if (mode === "public") {
        const b = await getBucket(bucket);
        if (!b?.public) return storageError(res, 404, "Bucket not found", "Bucket not found");
      } else if (!(await canRead(claims, bucket, name))) {
        return storageError(res, 404, "not_found", "Object not found");
      }
      return serveObject(req, res, bucket, name);
    }

    // Standard (non-resumable) upload.
    if ((method === "POST" || method === "PUT") && path.startsWith("/object/")) {
      const [bucketId, ...parts] = path.slice("/object/".length).split("/");
      const name = parts.join("/");
      const bucket = await getBucket(bucketId);
      if (!bucket) return storageError(res, 404, "Bucket not found", "Bucket not found");

      let data: Buffer;
      let contentType = String(req.headers["content-type"] ?? "application/octet-stream");
      let cacheControl = String(req.headers["cache-control"] ?? "3600");
      if (contentType.startsWith("multipart/form-data")) {
        const request = new Request("http://emulator.local/", {
          method: "POST",
          headers: { "content-type": contentType },
          body: Readable.toWeb(req) as ReadableStream,
          // @ts-expect-error — required by Node for streaming request bodies
          duplex: "half",
        });
        const form = await request.formData();
        const file = [...form.values()].find((value): value is File => typeof value !== "string");
        if (!file) return storageError(res, 400, "invalid_request", "No file in form data");
        data = Buffer.from(await file.arrayBuffer());
        contentType = file.type || "application/octet-stream";
        cacheControl = String(form.get("cacheControl") ?? cacheControl);
      } else {
        data = await readBody(req);
      }

      if (!checkLimits(res, bucket, data.length, contentType)) return;
      const upsert = method === "PUT" || String(req.headers["x-upsert"] ?? "") === "true";
      try {
        await writeRow(claims, bucketId, name, { size: data.length, mimetype: contentType, cacheControl, eTag: `"${randomUUID()}"` }, upsert);
      } catch (error) {
        return rowErrorResponse(res, error);
      }
      await writeFile(objectFile(bucketId, name), data);
      return sendJson(res, 200, { Id: randomUUID(), Key: `${bucketId}/${name}` });
    }

    // DELETE /object/{bucket}  { prefixes: [...] }
    if (method === "DELETE" && path.startsWith("/object/")) {
      const [bucketId, ...parts] = path.slice("/object/".length).split("/");
      const body = ((await readJson(req)) ?? {}) as { prefixes?: string[] };
      const names = parts.length ? [parts.join("/")] : (body.prefixes ?? []);
      const removed = await db.asUser(claims, async (tx) => {
        const out: { name: string; bucket_id: string }[] = [];
        for (const name of names) {
          const r = await tx.query<{ name: string; bucket_id: string }>(
            "delete from storage.objects where bucket_id = $1 and name = $2 returning name, bucket_id",
            [bucketId, name],
          );
          out.push(...r.rows);
        }
        return out;
      });
      for (const row of removed) await rm(objectFile(row.bucket_id, row.name), { force: true });
      return sendJson(res, 200, removed);
    }

    storageError(res, 404, "not_found", `storage route not emulated: ${method} ${path}`);
  }

  return { handle };
}
