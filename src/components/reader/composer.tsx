"use client";

import { FileAudio, Film, ImagePlus, Link2, Mic, Pencil, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { SketchPad } from "./sketch-pad";
import { Button } from "@/components/ui/button";
import { FormError, Input, Textarea } from "@/components/ui/field";
import { SheetClose } from "@/components/ui/overlay";
import { cn, formatBytes } from "@/lib/format";
import { ATTACHMENT_ACCEPT, validateAttachment, type AttachmentKind } from "@/lib/limits";
import { canRecordVoice, VoiceRecorder } from "./media";
import { QUICK_REACTIONS } from "./notes";
import type { ViewerSelection } from "./types";
import type { Annotations, UploadingState } from "./use-annotations";

const MAX_FILES = 4;

/** The "leave something here" panel. Reading stays primary: it is a margin panel, not a page. */
export function NoteComposer({ selection, annotations, onDone }: { selection: ViewerSelection; annotations: Annotations; onDone: (markerId: string) => void }) {
  const [body, setBody] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<UploadingState | null>(null);
  const inputs = useRef<Record<AttachmentKind, HTMLInputElement | null>>({ image: null, audio: null, video: null });

  const addFiles = (list: FileList | File[] | null, kind?: AttachmentKind) => {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        setError(`A note can carry up to ${MAX_FILES} attachments.`);
        break;
      }
      const check = validateAttachment(file, kind);
      if (!check.ok) {
        setError(`${file.name}: ${check.error}`);
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const empty = !body.trim() && !emoji && !link.trim() && files.length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (empty || busy || drawing || recording) return;
    setBusy(true);
    setError(null);
    try {
      const id = await annotations.createNote(
        { anchor: selection.anchor, position: selection.position, label: selection.label, body, emoji: emoji ?? undefined, link: showLink ? link : undefined, quote: selection.quote, files },
        setUploading,
      );
      onDone(id);
    } catch (submitError) {
      setError((submitError as Error).message);
      setBusy(false);
      setUploading(null);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl text-ink">Leave something here</h2>
          <p className="truncate text-xs text-ink-faint">{selection.label}</p>
        </div>
        <SheetClose className="flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close" disabled={busy}>
          <X className="size-5" aria-hidden />
        </SheetClose>
      </header>

      <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {selection.quote && (
          <blockquote className="border-l-2 border-accent/60 pl-3 font-display text-[15px] italic leading-relaxed text-ink-soft">
            “{selection.quote.length > 260 ? `${selection.quote.slice(0, 260)}…` : selection.quote}”
          </blockquote>
        )}

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="A thought, a theory, a question…"
          aria-label="Your note"
          maxLength={10000}
          rows={4}
          autoFocus
          disabled={busy}
        />

        <div role="group" aria-label="Add a reaction" className="flex flex-wrap gap-1">
          {QUICK_REACTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={emoji === option}
              aria-label={`Reaction ${option}`}
              disabled={busy}
              onClick={() => setEmoji(emoji === option ? null : option)}
              className={cn("flex size-10 items-center justify-center rounded-full text-xl transition-all", emoji === option ? "scale-110 bg-accent-soft ring-2 ring-accent" : "hover:bg-sunk")}
            >
              {option}
            </button>
          ))}
        </div>

        {showLink && (
          <Input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="Link" disabled={busy} autoFocus />
        )}

        {recording && (
          <VoiceRecorder
            onRecorded={(file) => {
              setRecording(false);
              addFiles([file], "audio");
            }}
            onCancel={() => setRecording(false)}
          />
        )}

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-xl border border-line bg-sunk/60 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{file.name}</span>
                  <span className="text-xs text-ink-faint">{formatBytes(file.size)}</span>
                </span>
                {uploading && uploading.index === index ? (
                  <span className="text-xs tabular-nums text-accent-ink">{Math.floor(uploading.fraction * 100)}%</span>
                ) : uploading && uploading.index > index ? (
                  <span className="text-xs text-moss">Uploaded</span>
                ) : (
                  !busy && (
                    <button type="button" onClick={() => setFiles(files.filter((_, i) => i !== index))} className="flex size-8 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label={`Remove ${file.name}`}>
                      <X className="size-4" aria-hidden />
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}

        {uploading && (
          <div aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunk" role="progressbar" aria-label={`Uploading ${uploading.fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(uploading.fraction * 100)}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${uploading.fraction * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              Uploading {uploading.count > 1 ? `${uploading.index + 1} of ${uploading.count}: ` : ""}
              {uploading.fileName}. Your note appears once it&apos;s safely stored.
            </p>
          </div>
        )}

        {drawing && <SketchPad onSave={(file) => { addFiles([file], "image"); setDrawing(false); }} onCancel={() => setDrawing(false)} />}
        <FormError>{error}</FormError>

        <div className="flex flex-wrap gap-1.5">
          {(["image", "audio", "video"] as AttachmentKind[]).map((kind) => (
            <input
              key={kind}
              ref={(element) => {
                inputs.current[kind] = element;
              }}
              type="file"
              accept={ATTACHMENT_ACCEPT[kind]}
              multiple={kind === "image"}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                addFiles(event.target.files, kind);
                event.target.value = "";
              }}
            />
          ))}
          <Button variant="secondary" size="sm" disabled={busy || drawing} onClick={() => inputs.current.image?.click()} icon={<ImagePlus className="size-4" aria-hidden />}>
            Photo
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || drawing || recording || files.length >= MAX_FILES} onClick={() => setDrawing(true)} icon={<Pencil className="size-4" aria-hidden />}>Draw</Button>
          {canRecordVoice() && (
            <Button variant="secondary" size="sm" disabled={busy || recording || drawing} onClick={() => setRecording(true)} icon={<Mic className="size-4" aria-hidden />}>
              Record
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={busy || drawing} onClick={() => inputs.current.audio?.click()} icon={<FileAudio className="size-4" aria-hidden />}>
            Audio
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || drawing} onClick={() => inputs.current.video?.click()} icon={<Film className="size-4" aria-hidden />}>
            Video
          </Button>
          <Button variant={showLink ? "quiet" : "secondary"} size="sm" disabled={busy} onClick={() => setShowLink(!showLink)} icon={<Link2 className="size-4" aria-hidden />} aria-pressed={showLink}>
            Link
          </Button>
        </div>
      </div>

      <footer className="pb-safe border-t border-line px-5 pt-3">
        <p className="mb-2.5 text-xs leading-relaxed text-ink-faint">Friends who haven&apos;t read this far will only see that you left something here — not what.</p>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={empty || recording || drawing}>
          {busy ? (uploading ? "Uploading…" : "Leaving it…") : "Leave it here"}
        </Button>
      </footer>
    </form>
  );
}
