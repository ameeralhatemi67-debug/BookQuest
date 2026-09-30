"use client";

import { AlertCircle, Mic, Pause, Play, Square, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { cn, formatBytes, formatClock } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";

const SIGN_SECONDS = 3600;

/**
 * Annotation media lives in private buckets. A signed URL is requested only
 * when the person actually opens / plays the attachment — never just because a
 * note exists — and Storage refuses to sign for anyone who has not unlocked it.
 */
function useSignedUrl(attachment: Attachment, eager: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const requested = useRef(false);

  const sign = useCallback(async (): Promise<string | null> => {
    if (url) return url;
    setBusy(true);
    setError(false);
    const { data, error: signError } = await getSupabase().storage.from(attachment.bucket).createSignedUrl(attachment.path, SIGN_SECONDS);
    setBusy(false);
    if (signError || !data?.signedUrl) {
      setError(true);
      return null;
    }
    setUrl(data.signedUrl);
    return data.signedUrl;
  }, [attachment.bucket, attachment.path, url]);

  useEffect(() => {
    if (eager && !requested.current) {
      requested.current = true;
      void sign();
    }
  }, [eager, sign]);

  return { url, error, busy, sign };
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-line bg-sunk px-3 py-2.5 text-sm text-ink-soft">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      This {what} couldn&apos;t be loaded. It may have been removed.
    </p>
  );
}

export function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const { url, error } = useSignedUrl(attachment, true);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (error || failed) return <Unavailable what="image" />;
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;
  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        className="relative block w-full overflow-hidden rounded-xl bg-sunk"
        style={{ aspectRatio: String(Math.min(2.2, Math.max(0.6, ratio))) }}
        aria-label={`Open image${attachment.original_name ? ` ${attachment.original_name}` : ""}`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private Storage
          <img src={url} alt={attachment.original_name ?? "Attached image"} loading="lazy" decoding="async" className="size-full animate-fade-in object-cover" onError={() => setFailed(true)} />
        ) : (
          <span className="skeleton absolute inset-0" />
        )}
      </button>
      {url && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title={attachment.original_name ?? "Image"} className="max-w-4xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={attachment.original_name ?? "Attached image"} className="mx-auto max-h-[70dvh] w-auto rounded-lg object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A compact audio player. Nothing is fetched until play is pressed; nothing ever autoplays. */
export function AudioAttachment({ attachment }: { attachment: Attachment }) {
  const { url, error, busy, sign } = useSignedUrl(attachment, false);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(attachment.duration_seconds ?? 0);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    const element = audio.current;
    if (!element) return;
    if (playing) return element.pause();
    if (!url) {
      const signed = await sign();
      if (!signed) return;
      element.src = signed;
    }
    try {
      await element.play();
    } catch {
      setFailed(true);
    }
  };

  if (error || failed) return <Unavailable what="recording" />;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-sunk/60 px-3 py-2.5">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-transform active:scale-95 disabled:opacity-60"
        aria-label={playing ? "Pause" : "Play voice note"}
      >
        {busy ? <Spinner className="size-4 text-on-accent" label="Loading audio" /> : playing ? <Pause className="size-4" aria-hidden /> : <Play className="ml-0.5 size-4" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={Math.min(time, duration || time)}
          onChange={(event) => {
            const value = Number(event.target.value);
            setTime(value);
            if (audio.current && url) audio.current.currentTime = value;
          }}
          disabled={!url}
          aria-label="Seek"
          className="h-1.5 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-default"
        />
        <div className="mt-0.5 flex justify-between text-xs tabular-nums text-ink-faint">
          <span className="flex items-center gap-1">
            <Mic className="size-3" aria-hidden />
            {formatClock(time)}
          </span>
          <span>{duration ? formatClock(duration) : formatBytes(attachment.size_bytes)}</span>
        </div>
      </div>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && setDuration(event.currentTarget.duration)}
        onError={() => url && setFailed(true)}
      />
    </div>
  );
}

/** A restrained inline video: a poster-less tile until the person chooses to load it. */
export function VideoAttachment({ attachment }: { attachment: Attachment }) {
  const { url, error, busy, sign } = useSignedUrl(attachment, false);
  const [failed, setFailed] = useState(false);
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 16 / 9;
  if (error || failed) return <Unavailable what="video" />;

  if (!url) {
    return (
      <button
        type="button"
        onClick={() => void sign()}
        disabled={busy}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-sunk/60 px-3 py-3 text-left transition-colors hover:bg-sunk"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
          {busy ? <Spinner className="size-4 text-on-accent" label="Loading video" /> : <Play className="ml-0.5 size-4" aria-hidden />}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Video className="size-4 text-ink-faint" aria-hidden />
            Play video
          </span>
          <span className="block truncate text-xs text-ink-faint">
            {attachment.duration_seconds ? `${formatClock(attachment.duration_seconds)} · ` : ""}
            {formatBytes(attachment.size_bytes)}
          </span>
        </span>
      </button>
    );
  }

  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className="w-full rounded-xl bg-black"
      style={{ aspectRatio: String(Math.min(2.4, Math.max(0.56, ratio))), maxHeight: "60dvh" }}
      onError={() => setFailed(true)}
    >
      <track kind="captions" />
    </video>
  );
}

export function AttachmentView({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === "image") return <ImageAttachment attachment={attachment} />;
  if (attachment.kind === "audio") return <AudioAttachment attachment={attachment} />;
  return <VideoAttachment attachment={attachment} />;
}

// ---------------------------------------------------------------- voice recorder
const MAX_RECORDING_SECONDS = 10 * 60;

function pickRecordingType(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

export function canRecordVoice(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && pickRecordingType() !== null;
}

/** Records a voice note with the browser's MediaRecorder and hands back a File. */
export function VoiceRecorder({ onRecorded, onCancel }: { onRecorded: (file: File) => void; onCancel: () => void }) {
  const [state, setState] = useState<"starting" | "recording" | "denied" | "error">("starting");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const keep = useRef(false);

  useEffect(() => {
    let disposed = false;
    let ticker: ReturnType<typeof setInterval> | null = null;
    const type = pickRecordingType();

    (async () => {
      if (!type) return setState("error");
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposed) return media.getTracks().forEach((track) => track.stop());
        stream.current = media;
        const mediaRecorder = new MediaRecorder(media, { mimeType: type.mimeType });
        recorder.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => event.data.size > 0 && chunks.current.push(event.data);
        mediaRecorder.onstop = () => {
          media.getTracks().forEach((track) => track.stop());
          if (!keep.current || chunks.current.length === 0) return;
          const blob = new Blob(chunks.current, { type: type.mimeType.split(";")[0] });
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          onRecorded(new File([blob], `voice-note-${stamp}.${type.extension}`, { type: blob.type }));
        };
        mediaRecorder.start(1000);
        setState("recording");
        const started = Date.now();
        ticker = setInterval(() => {
          const elapsed = Math.floor((Date.now() - started) / 1000);
          setSeconds(elapsed);
          if (elapsed >= MAX_RECORDING_SECONDS) {
            keep.current = true;
            mediaRecorder.stop();
          }
        }, 250);
      } catch (error) {
        if (disposed) return;
        const name = (error as { name?: string }).name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      }
    })();

    return () => {
      disposed = true;
      if (ticker) clearInterval(ticker);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
    // Start once when the recorder is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "denied" || state === "error") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-sunk px-3 py-2.5 text-sm text-ink-soft" role="alert">
        <span>{state === "denied" ? "Microphone access was blocked. Allow it in your browser to record a voice note." : "Recording isn't available in this browser. You can attach an audio file instead."}</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          OK
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft/60 px-3 py-2.5" role="status" aria-live="polite">
      <span className={cn("size-3 rounded-full bg-danger", state === "recording" && "animate-breathe")} aria-hidden />
      <span className="flex-1 text-sm font-medium tabular-nums text-ink">{state === "starting" ? "Waiting for the microphone…" : `Recording ${formatClock(seconds)}`}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Discard recording"
        onClick={() => {
          keep.current = false;
          onCancel();
        }}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <Button
        size="sm"
        disabled={state !== "recording" || seconds < 1}
        onClick={() => {
          keep.current = true;
          recorder.current?.stop();
        }}
        icon={<Square className="size-3.5 fill-current" aria-hidden />}
      >
        Done
      </Button>
    </div>
  );
}
