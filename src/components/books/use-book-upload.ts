"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { inspectEpub, type EpubInspection } from "@/lib/books/epub";
import { sha256File, titleFromFilename } from "@/lib/books/hash";
import { BookParseError, inspectPdf, type PdfInspection } from "@/lib/books/pdf";
import { friendlyError } from "@/lib/errors";
import { BOOK_RULES, sniffBookFormat, validateBookFile } from "@/lib/limits";
import { startUpload, UploadError, type UploadHandle, type UploadProgress } from "@/lib/storage/upload";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Every state a book upload can be in. The UI names each of them, so the
 * reader is never left looking at a frozen button.
 */
export type UploadStage =
  | "idle"
  | "validating"     // type, size and magic-byte checks
  | "hashing"        // fingerprinting, to recognise an exact duplicate
  | "parsing"        // opening the book: metadata, cover, (EPUB) locations index
  | "uploading"      // bytes are moving — real progress
  | "paused"
  | "retrying"       // connection hiccup, backing off before the next attempt
  | "finalizing"     // Storage confirmed; saving cover + details
  | "ready"
  | "duplicate"      // this exact file is already in the library
  | "cancelled"
  | "failed";

export interface BookUploadState {
  stage: UploadStage;
  fileName: string | null;
  fileSize: number;
  /** 0..1 while hashing. */
  hashProgress: number;
  /** Real upload progress in bytes. Does not include hashing or parsing. */
  upload: UploadProgress | null;
  resumable: boolean;
  retry: { attempt: number; delayMs: number } | null;
  detail: string | null;
  error: string | null;
  bookId: string | null;
  title: string | null;
}

const INITIAL: BookUploadState = {
  stage: "idle", fileName: null, fileSize: 0, hashProgress: 0, upload: null, resumable: false,
  retry: null, detail: null, error: null, bookId: null, title: null,
};

const ACTIVE: UploadStage[] = ["validating", "hashing", "parsing", "uploading", "paused", "retrying", "finalizing"];

class Cancelled extends Error {}

export function useBookUpload(userId: string, onReady?: (bookId: string) => void) {
  const [state, setState] = useState<BookUploadState>(INITIAL);
  const handle = useRef<UploadHandle | null>(null);
  const cancelled = useRef(false);
  const lastFile = useRef<File | null>(null);
  const patch = useCallback((next: Partial<BookUploadState>) => setState((s) => ({ ...s, ...next })), []);

  const busy = ACTIVE.includes(state.stage);

  // Warn before closing the tab in the middle of an upload.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const start = useCallback(
    async (file: File) => {
      const supabase = getSupabase();
      cancelled.current = false;
      lastFile.current = file;
      let bookId: string | null = null;
      const checkCancel = () => {
        if (cancelled.current) throw new Cancelled();
      };

      setState({ ...INITIAL, stage: "validating", fileName: file.name, fileSize: file.size });

      try {
        // 1 — validate: extension + MIME + size, then the actual first bytes.
        const validation = validateBookFile(file);
        if (!validation.ok) throw new Error(validation.error);
        const { format, contentType, extension } = validation.value;
        const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        if (sniffBookFormat(head) !== format) {
          throw new Error(`This file is named .${extension} but doesn't look like a real ${BOOK_RULES[format].label}. It may be damaged, or a different kind of file.`);
        }
        checkCancel();

        // 2 — fingerprint.
        patch({ stage: "hashing" });
        const sha256 = await sha256File(file, (fraction) => patch({ hashProgress: fraction }));
        checkCancel();

        const existing = await supabase
          .from("books")
          .select("id, status, title")
          .eq("uploader_id", userId)
          .eq("sha256", sha256)
          .in("status", ["uploading", "processing", "ready", "failed"])
          .order("created_at", { ascending: false })
          .limit(1);
        if (existing.error) throw existing.error;
        const previous = existing.data?.[0] as { id: string; status: string; title: string } | undefined;
        if (previous?.status === "ready") {
          patch({ stage: "duplicate", bookId: previous.id, title: previous.title });
          return;
        }

        // 3 — open the book before spending anyone's bandwidth on a broken file.
        patch({ stage: "parsing", detail: "Opening the book…" });
        let inspection: EpubInspection | PdfInspection;
        if (format === "epub") {
          inspection = await inspectEpub(file, (stage) =>
            patch({ detail: stage === "opening" ? "Opening the book…" : stage === "metadata" ? "Reading title, author and cover…" : "Mapping the book so everyone shares the same page positions…" }),
          );
        } else {
          patch({ detail: "Reading pages and cover…" });
          inspection = await inspectPdf(file);
        }
        checkCancel();

        const title = inspection.title ?? titleFromFilename(file.name);
        const details = {
          title,
          author: inspection.author,
          original_filename: file.name.slice(0, 300),
          mime_type: contentType,
          sha256,
          page_count: "pageCount" in inspection ? inspection.pageCount : null,
          metadata: inspection.metadata,
          error: null,
        };

        // 4 — the library row (re-used when resuming an earlier attempt at this exact file).
        if (previous) {
          bookId = previous.id;
          const { error } = await supabase.from("books").update({ ...details, status: "uploading" }).eq("id", bookId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("books")
            .insert({ ...details, uploader_id: userId, format })
            .select("id")
            .single();
          if (error) throw error;
          bookId = data.id as string;
        }
        const base = `${userId}/${bookId}`;
        const storagePath = `${base}/book.${format}`;
        {
          const { error } = await supabase.from("books").update({ storage_path: storagePath }).eq("id", bookId);
          if (error) throw error;
        }
        patch({ bookId, title });
        checkCancel();

        // 5 — upload straight from this browser to Storage.
        const upload = startUpload({
          client: supabase,
          bucket: "books",
          path: storagePath,
          file,
          contentType,
          upsert: true,
          onProgress: (progress) => patch({ upload: progress }),
          onStateChange: (uploadState, info) => {
            if (uploadState === "uploading") patch({ stage: "uploading", retry: null });
            else if (uploadState === "paused") patch({ stage: "paused" });
            else if (uploadState === "retrying") patch({ stage: "retrying", retry: { attempt: info?.attempt ?? 1, delayMs: info?.delayMs ?? 0 } });
          },
        });
        handle.current = upload;
        patch({ stage: "uploading", resumable: upload.resumable, detail: null, upload: { bytesSent: 0, bytesTotal: file.size, fraction: 0 } });
        await upload.done;
        handle.current = null;

        // 6 — confirm with the server, then store the cover and the locations index.
        patch({ stage: "finalizing", detail: "Saving the cover and details…" });
        {
          const { error } = await supabase.rpc("finalize_book_upload", { p_book_id: bookId });
          if (error) throw error;
        }

        let coverPath: string | null = null;
        if (inspection.cover) {
          const path = `${base}/cover.jpg`;
          const { error } = await supabase.storage.from("covers").upload(path, inspection.cover, { contentType: "image/jpeg", upsert: true });
          if (!error) coverPath = path; // a missing cover is not worth failing the book for
        }

        let hasLocations = false;
        if ("locations" in inspection) {
          const { error } = await supabase.storage
            .from("books")
            .upload(`${base}/locations.json`, new Blob([inspection.locations], { type: "application/json" }), { contentType: "application/json", upsert: true });
          hasLocations = !error;
        }

        {
          const { error } = await supabase.from("books").update({ status: "ready", cover_path: coverPath, has_locations: hasLocations }).eq("id", bookId);
          if (error) throw error;
        }

        patch({ stage: "ready", detail: null });
        onReady?.(bookId);
      } catch (error) {
        handle.current = null;
        if (error instanceof Cancelled || (error instanceof UploadError && error.code === "cancelled")) {
          if (bookId) await supabase.from("books").update({ status: "failed", error: "Upload cancelled" }).eq("id", bookId);
          patch({ stage: "cancelled", detail: null, retry: null });
          return;
        }
        const message =
          error instanceof BookParseError || error instanceof UploadError
            ? error.message
            : error instanceof Error && !("code" in error) && !/^[a-z_]+$/.test(error.message)
              ? error.message
              : friendlyError(error, "The upload didn't finish. Please try again.");
        if (bookId) await supabase.from("books").update({ status: "failed", error: message.slice(0, 500) }).eq("id", bookId);
        patch({ stage: "failed", error: message, detail: null, retry: null });
      }
    },
    [onReady, patch, userId],
  );

  const pause = useCallback(() => handle.current?.pause(), []);
  const resume = useCallback(() => handle.current?.resume(), []);
  const cancel = useCallback(async () => {
    cancelled.current = true;
    await handle.current?.cancel();
  }, []);
  /** Re-runs the pipeline for the same file; a resumable upload continues from where it stopped. */
  const retry = useCallback(() => {
    if (lastFile.current) void start(lastFile.current);
  }, [start]);
  const reset = useCallback(() => setState(INITIAL), []);

  return { state, busy, start, pause, resume, cancel, retry, reset };
}
