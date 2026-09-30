// Direct browser → Supabase Storage uploads.
//
// Nothing here ever passes through a Vercel function: small files use the
// standard Storage endpoint, anything over ~6 MB uses the resumable TUS
// protocol against the dedicated Storage hostname, with real byte progress,
// automatic retry with back-off, pause / resume, cancel, and resumption of an
// interrupted upload (even after a page reload, via tus-js-client's
// fingerprint store).
import type { SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";
import { storageBaseUrl, supabasePublishableKey, supabaseUrl } from "@/lib/config";
import { RESUMABLE_THRESHOLD_BYTES, TUS_CHUNK_BYTES } from "@/lib/limits";

export type UploadState = "uploading" | "paused" | "retrying" | "done" | "failed" | "cancelled";

export interface UploadProgress {
  bytesSent: number;
  bytesTotal: number;
  /** 0..1 — upload progress only; never pretends to include later processing. */
  fraction: number;
}

export interface UploadOptions {
  client: SupabaseClient;
  bucket: string;
  path: string;
  file: Blob;
  contentType: string;
  /** Overwrite an existing object at this path (used when retrying a book upload). */
  upsert?: boolean;
  cacheControl?: string;
  /** Force the resumable protocol regardless of size (used by tests). */
  forceResumable?: boolean;
  onProgress?: (progress: UploadProgress) => void;
  onStateChange?: (state: UploadState, detail?: { attempt?: number; delayMs?: number; error?: UploadError }) => void;
  /** Overrides for non-browser environments (tests). */
  projectUrl?: string;
  apiKey?: string;
}

export interface UploadHandle {
  /** Resolves when the object is stored; rejects with UploadError on failure or cancel. */
  done: Promise<void>;
  /** True when pause/resume are meaningful (resumable uploads only). */
  resumable: boolean;
  pause(): void;
  resume(): void;
  /** Stops the upload and asks Storage to discard the partial object. */
  cancel(): Promise<void>;
}

export type UploadErrorCode = "too_large" | "bad_type" | "unauthorized" | "network" | "cancelled" | "conflict" | "unknown";

export class UploadError extends Error {
  constructor(
    public code: UploadErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

const RETRY_DELAYS = [0, 1500, 4000, 8000, 15000, 30000];

function classify(status: number | undefined, body: string): UploadError {
  const text = body.toLowerCase();
  if (status === 413 || text.includes("maximum allowed size") || text.includes("payload too large")) {
    return new UploadError("too_large", "This file is larger than the server allows.");
  }
  if (status === 415 || text.includes("mime type") || text.includes("invalid_mime_type")) {
    return new UploadError("bad_type", "The server does not accept this type of file.");
  }
  if (status === 401 || status === 403 || text.includes("row-level security") || text.includes("unauthorized")) {
    return new UploadError("unauthorized", "You don't have permission to upload here. Try signing in again.");
  }
  if (status === 409 || text.includes("already exists")) {
    return new UploadError("conflict", "A file already exists at this location.");
  }
  if (status === undefined || status === 0 || status >= 500) {
    return new UploadError("network", "The connection dropped before the upload finished.");
  }
  return new UploadError("unknown", body ? `Upload failed: ${body.slice(0, 200)}` : "Upload failed.");
}

async function accessToken(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UploadError("unauthorized", "Your session has expired. Sign in again to upload.");
  return token;
}

export function startUpload(options: UploadOptions): UploadHandle {
  const size = options.file.size;
  const emit = (bytesSent: number) =>
    options.onProgress?.({ bytesSent, bytesTotal: size, fraction: size === 0 ? 1 : Math.min(1, bytesSent / size) });
  const useResumable = options.forceResumable || size > RESUMABLE_THRESHOLD_BYTES;
  return useResumable ? resumableUpload(options, emit) : standardUpload(options, emit);
}

// ---------------------------------------------------------------- small files
function standardUpload(options: UploadOptions, emit: (bytes: number) => void): UploadHandle {
  let cancelled = false;
  const run = async () => {
    options.onStateChange?.("uploading");
    emit(0);
    let lastError: UploadError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (cancelled) throw new UploadError("cancelled", "Upload cancelled.");
      if (attempt > 0) {
        const delayMs = RETRY_DELAYS[attempt];
        options.onStateChange?.("retrying", { attempt, delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      // Storage takes the type of a Blob body from the Blob itself, and browsers label
      // files unreliably — so send the bytes under the content type we validated.
      const body = options.file.type === options.contentType ? options.file : new Blob([options.file], { type: options.contentType });
      const { error } = await options.client.storage.from(options.bucket).upload(options.path, body, {
        contentType: options.contentType,
        cacheControl: options.cacheControl ?? "3600",
        upsert: options.upsert ?? false,
      });
      if (!error) {
        emit(options.file.size);
        options.onStateChange?.("done");
        return;
      }
      const status = Number((error as { statusCode?: string | number; status?: number }).statusCode ?? (error as { status?: number }).status);
      lastError = classify(Number.isFinite(status) ? status : undefined, error.message);
      // Only transient failures are worth retrying.
      if (lastError.code !== "network") break;
    }
    options.onStateChange?.("failed", { error: lastError! });
    throw lastError!;
  };
  return {
    done: run(),
    resumable: false,
    pause() {},
    resume() {},
    async cancel() {
      cancelled = true;
      options.onStateChange?.("cancelled");
    },
  };
}

// ---------------------------------------------------------------- large files
function resumableUpload(options: UploadOptions, emit: (bytes: number) => void): UploadHandle {
  const projectUrl = options.projectUrl ?? supabaseUrl();
  const apiKey = options.apiKey ?? supabasePublishableKey();
  let settled = false;
  let paused = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: UploadError) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const createUpload = (source: Blob | Buffer) => new tus.Upload(source as Blob, {
    endpoint: `${storageBaseUrl(projectUrl)}/storage/v1/upload/resumable`,
    retryDelays: RETRY_DELAYS,
    chunkSize: TUS_CHUNK_BYTES, // Supabase requires exactly 6 MB chunks
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: {
      apikey: apiKey,
      "x-upsert": options.upsert ? "true" : "false",
    },
    metadata: {
      bucketName: options.bucket,
      objectName: options.path,
      contentType: options.contentType,
      cacheControl: options.cacheControl ?? "3600",
    },
    // A long upload can outlive the access token: fetch a fresh one per request.
    async onBeforeRequest(req) {
      req.setHeader("Authorization", `Bearer ${await accessToken(options.client)}`);
    },
    onProgress(bytesSent) {
      emit(bytesSent);
    },
    onShouldRetry(error, retryAttempt) {
      const status = (error as tus.DetailedError).originalResponse?.getStatus();
      // Client errors will not fix themselves — except a 409/423 offset conflict, which a resume resolves.
      const retryable = status === undefined || status === 0 || status >= 500 || status === 409 || status === 423;
      if (retryable && !paused) {
        options.onStateChange?.("retrying", { attempt: retryAttempt + 1, delayMs: RETRY_DELAYS[retryAttempt] ?? 0 });
      }
      return retryable;
    },
    onChunkComplete() {
      if (!paused && !settled) options.onStateChange?.("uploading");
    },
    onSuccess() {
      settled = true;
      emit(options.file.size);
      options.onStateChange?.("done");
      resolveDone();
    },
    onError(error) {
      if (settled) return;
      const detailed = error as tus.DetailedError;
      const failure = classify(detailed.originalResponse?.getStatus(), detailed.originalResponse?.getBody() ?? "");
      failure.cause = error;
      settled = true;
      options.onStateChange?.("failed", { error: failure });
      rejectDone(failure);
    },
  });

  let upload: tus.Upload | null = null;

  const begin = async () => {
    // tus-js-client reads Blobs in browsers; under Node (tests) it needs a Buffer.
    const source = typeof window === "undefined" ? Buffer.from(await options.file.arrayBuffer()) : options.file;
    if (settled) return;
    upload = createUpload(source);
    try {
      // Pick up where a previous attempt at this exact file left off.
      const previous = await upload.findPreviousUploads();
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
    } catch {
      // Fingerprint storage unavailable (private mode, Node): just start fresh.
    }
    options.onStateChange?.("uploading");
    upload.start();
  };
  void begin();

  return {
    done,
    resumable: true,
    pause() {
      if (settled || paused) return;
      paused = true;
      void upload?.abort();
      options.onStateChange?.("paused");
    },
    resume() {
      if (settled || !paused) return;
      paused = false;
      options.onStateChange?.("uploading");
      upload?.start();
    },
    async cancel() {
      if (settled) return;
      settled = true;
      try {
        await upload?.abort(true); // also DELETEs the partial upload server-side
      } catch {
        // The partial upload expires on its own if the terminate request fails.
      }
      options.onStateChange?.("cancelled");
      rejectDone(new UploadError("cancelled", "Upload cancelled."));
    },
  };
}
