"use client";

import { AlertTriangle, CheckCircle2, FileUp, Pause, Play, RotateCcw, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { useBookUpload, type BookUploadState, type UploadStage } from "@/components/books/use-book-upload";
import { Button, buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn, formatBytes } from "@/lib/format";
import { BOOK_ACCEPT, BOOK_RULES, formatLimit } from "@/lib/limits";

const STAGE_LABEL: Record<UploadStage, string> = {
  idle: "",
  validating: "Checking the file…",
  hashing: "Fingerprinting the file…",
  parsing: "Opening the book…",
  uploading: "Uploading",
  paused: "Paused",
  retrying: "Connection interrupted — retrying…",
  finalizing: "Finishing up…",
  ready: "Ready to read",
  duplicate: "Already in your library",
  cancelled: "Upload cancelled",
  failed: "Upload failed",
};

function UploadStatus({
  state,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
}: {
  state: BookUploadState;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { stage, upload } = state;
  const uploading = stage === "uploading" || stage === "paused" || stage === "retrying";
  const working = stage === "validating" || stage === "hashing" || stage === "parsing" || stage === "finalizing";
  const percent = upload ? Math.floor(upload.fraction * 100) : 0;

  return (
    <div className="rounded-3xl border border-line bg-raised p-5 shadow-soft" aria-live="polite">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full",
            stage === "failed" ? "bg-danger-soft text-danger" : stage === "ready" || stage === "duplicate" ? "bg-moss-soft text-moss" : "bg-accent-soft text-accent-ink",
          )}
        >
          {stage === "failed" ? (
            <AlertTriangle className="size-5" aria-hidden />
          ) : stage === "ready" || stage === "duplicate" ? (
            <CheckCircle2 className="size-5" aria-hidden />
          ) : working ? (
            <Spinner className="size-5 text-accent-ink" label={STAGE_LABEL[stage]} />
          ) : (
            <Upload className="size-5" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{state.title ?? state.fileName}</p>
          <p className="text-sm text-ink-soft">
            {stage === "uploading" ? (
              <>
                Uploading <span className="font-mono text-[13px]">{state.fileName}</span>
              </>
            ) : (
              (state.detail ?? STAGE_LABEL[stage])
            )}
          </p>

          {stage === "hashing" && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-sunk" role="progressbar" aria-label="Fingerprinting" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.hashProgress * 100)}>
                <div className="h-full rounded-full bg-ink-faint transition-[width] duration-200" style={{ width: `${state.hashProgress * 100}%` }} />
              </div>
            </div>
          )}

          {uploading && upload && (
            <div className="mt-3">
              <div
                className="h-2 overflow-hidden rounded-full bg-sunk"
                role="progressbar"
                aria-label={`Upload progress for ${state.fileName}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${formatBytes(upload.bytesSent)} of ${formatBytes(upload.bytesTotal)} uploaded`}
              >
                <div
                  className={cn("h-full rounded-full transition-[width] duration-300 ease-out", stage === "paused" ? "bg-ink-faint" : stage === "retrying" ? "bg-gold" : "bg-accent")}
                  style={{ width: `${upload.fraction * 100}%` }}
                />
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 text-sm tabular-nums">
                <span className="text-ink-soft">
                  {formatBytes(upload.bytesSent)} / {formatBytes(upload.bytesTotal)}
                </span>
                <span className="font-medium text-ink">{percent}%</span>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                {stage === "paused"
                  ? "Paused. Nothing is lost — resume whenever you like."
                  : stage === "retrying"
                    ? `The connection dropped. Trying again${state.retry && state.retry.delayMs > 0 ? ` in ${Math.ceil(state.retry.delayMs / 1000)}s` : ""}; the upload continues from where it stopped.`
                    : "Upload progress. Keep this tab open — it goes straight from your device to storage."}
              </p>
            </div>
          )}

          {stage === "failed" && state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
          {stage === "cancelled" && <p className="mt-2 text-sm text-ink-soft">Nothing was added to your library.</p>}
          {stage === "duplicate" && <p className="mt-2 text-sm text-ink-soft">This exact file is already here, so it wasn&apos;t uploaded again.</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            {stage === "uploading" && state.resumable && (
              <Button variant="secondary" size="sm" onClick={onPause} icon={<Pause className="size-4" aria-hidden />}>
                Pause
              </Button>
            )}
            {stage === "paused" && (
              <Button size="sm" onClick={onResume} icon={<Play className="size-4" aria-hidden />}>
                Resume
              </Button>
            )}
            {(uploading || working) && stage !== "finalizing" && (
              <Button variant="ghost" size="sm" onClick={onCancel} icon={<X className="size-4" aria-hidden />}>
                Cancel
              </Button>
            )}
            {stage === "failed" && (
              <Button size="sm" onClick={onRetry} icon={<RotateCcw className="size-4" aria-hidden />}>
                Try again
              </Button>
            )}
            {(stage === "ready" || stage === "duplicate") && state.bookId && (
              <Link href={`/rooms/new?book=${state.bookId}`} className={buttonClass("primary", "sm")}>
                Open a room with this book
              </Link>
            )}
            {(stage === "ready" || stage === "duplicate" || stage === "failed" || stage === "cancelled") && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                {stage === "failed" ? "Dismiss" : "Add another"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BookUploader({ userId, onReady, autoOpen }: { userId: string; onReady?: (bookId: string) => void; autoOpen?: boolean }) {
  const { state, busy, start, pause, resume, cancel, retry, reset } = useBookUpload(userId, onReady);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !busy) void start(file);
    if (input.current) input.current.value = "";
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files);
  };

  if (state.stage !== "idle") {
    return <UploadStatus state={state} onPause={pause} onResume={resume} onCancel={() => void cancel()} onRetry={retry} onDismiss={reset} />;
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        dragging ? "border-accent bg-accent-soft/50" : "border-line-strong bg-raised/60",
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <FileUp className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 font-display text-xl text-ink">Add a book</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-soft">
        Drop an EPUB or PDF here, or choose a file. EPUB up to {formatLimit(BOOK_RULES.epub.maxBytes)}, PDF up to {formatLimit(BOOK_RULES.pdf.maxBytes)}.
      </p>
      <input ref={input} id="book-file" type="file" accept={BOOK_ACCEPT} className="sr-only" onChange={(event) => choose(event.target.files)} />
      <Button className="mt-5" autoFocus={autoOpen} onClick={() => input.current?.click()} icon={<Upload className="size-4" aria-hidden />}>
        Choose a file
      </Button>
      <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-faint">
        Only upload books you have the right to share with the people you read with. Files stay private to you and your rooms.
      </p>
    </div>
  );
}
