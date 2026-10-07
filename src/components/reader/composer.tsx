"use client";

import { FileAudio, Film, ImagePlus, Link2, Mic, Music2, Pencil, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { SketchPad } from "./sketch-pad";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormError, Input, Textarea } from "@/components/ui/field";
import { useMe } from "@/components/app/providers";
import { featureOn } from "@/lib/features";
import { cn, formatBytes } from "@/lib/format";
import { ATTACHMENT_ACCEPT, validateAttachment, type AttachmentKind } from "@/lib/limits";
import { canRecordVoice, VoiceRecorder } from "./media";
import type { NoteAttention, RoomFeatures, RoomMember } from "@/lib/types";
import { AttentionPicker } from "./attention";
import { QUICK_REACTIONS } from "./notes";
import type { ViewerSelection } from "./types";
import type { Annotations, UploadingState } from "./use-annotations";

const MAX_FILES = 4;
const MAX_PACKAGE_FILES = 8;

export type ComposerKind = "note" | "package";

/**
 * The "leave something here" panel. Reading stays primary: it is a margin
 * panel, not a page. A package is the same thing addressed to one friend and
 * wrapped: a message, voice, photos, a drawing and a song that open together
 * when they reach this spot.
 */
export function NoteComposer({ selection, annotations, members, meId, features, kind, onDone }: {
  selection: ViewerSelection;
  annotations: Annotations;
  members: RoomMember[];
  meId: string;
  features?: RoomFeatures;
  kind: ComposerKind;
  onDone: (markerId: string) => void;
}) {
  const me = useMe();
  const others = members.filter((m) => m.user_id !== meId);
  const animated = featureOn(features, "animated_notes");
  const [recipient, setRecipient] = useState(kind === "package" && others[0] ? others[0].user_id : "room");
  const [title, setTitle] = useState("");
  const [attention, setAttention] = useState<NoteAttention>("gentle");
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
  const isPackage = kind === "package";
  const maxFiles = isPackage ? MAX_PACKAGE_FILES : MAX_FILES;
  // A package always has exactly one friend to open it.
  const friend = others.find((m) => m.user_id === recipient) ?? (isPackage ? others[0] : undefined);

  const addFiles = (list: FileList | File[] | null, fileKind?: AttachmentKind) => {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= maxFiles) {
        setError(isPackage ? `A package can hold up to ${MAX_PACKAGE_FILES} things.` : `A note can carry up to ${MAX_FILES} attachments.`);
        break;
      }
      const check = validateAttachment(file, fileKind);
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
    if (isPackage && !friend) return setError("Choose who the package is for.");
    setBusy(true);
    setError(null);
    try {
      const id = await annotations.createNote(
        {
          anchor: selection.anchor, position: selection.position, label: selection.label, body, emoji: emoji ?? undefined,
          link: showLink ? link : undefined, quote: selection.quote, files, attention,
          recipientId: isPackage ? friend!.user_id : recipient === "room" ? null : recipient,
          kind, title: isPackage ? title.trim() || `For ${friend!.display_name.split(" ")[0]}` : undefined,
        },
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
      <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {selection.quote && (
          <blockquote className="border-l-2 border-accent/60 pl-3 font-display text-[15px] italic leading-relaxed text-ink-soft">
            “{selection.quote.length > 260 ? `${selection.quote.slice(0, 260)}…` : selection.quote}”
          </blockquote>
        )}

        {isPackage ? (
          <div className="space-y-3 rounded-2xl border border-line bg-sunk/40 p-3.5">
            <label className="block text-xs font-medium text-ink-soft">
              For
              <select aria-label="Who the package is for" value={friend?.user_id ?? ""} disabled={busy} onChange={(e) => setRecipient(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-raised px-2 text-sm text-ink">
                {others.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-ink-soft">
              Label on the wrapping <span className="font-normal text-ink-faint">(they see this before it opens)</span>
              <Input value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder={friend ? `For ${friend.display_name.split(" ")[0]}` : "For…"} className="mt-1.5" />
            </label>
            {friend && (
              <p className="flex items-center gap-2 text-xs leading-snug text-ink-soft">
                <Avatar person={{ id: friend.user_id, display_name: friend.display_name, avatar_path: friend.avatar_path }} size={20} />
                {friend.display_name.split(" ")[0]} will see it sitting sealed on their trail and can open it when they reach {selection.label}.
              </p>
            )}
          </div>
        ) : (
          <label className="block text-xs font-medium text-ink-soft">
            Who can see it
            <select aria-label="Who can see this note" value={recipient} disabled={busy} onChange={(e) => setRecipient(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-raised px-2 text-sm text-ink">
              <option value="room">Everyone in the room</option>
              <option value={meId}>Only me</option>
              {others.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </label>
        )}

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isPackage ? "What would you tell them when they get here?" : "A thought, a theory, a question…"}
          aria-label={isPackage ? "Your message" : "Your note"}
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

        {animated && <AttentionPicker value={attention} onChange={setAttention} me={{ id: me.user_id, display_name: me.display_name, avatar_path: me.avatar_path }} disabled={busy} />}

        {showLink && (
          <Input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder={isPackage ? "A song link: Spotify, YouTube, Apple Music…" : "https://…"} aria-label="Link" disabled={busy} autoFocus />
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
              {uploading.fileName}. {isPackage ? "The package is wrapped once everything is safely stored." : "Your note appears once it's safely stored."}
            </p>
          </div>
        )}

        {drawing && <SketchPad onSave={(file) => { addFiles([file], "image"); setDrawing(false); }} onCancel={() => setDrawing(false)} />}
        <FormError>{error}</FormError>

        <div className="flex flex-wrap gap-1.5">
          {(["image", "audio", "video"] as AttachmentKind[]).map((fileKind) => (
            <input
              key={fileKind}
              ref={(element) => {
                inputs.current[fileKind] = element;
              }}
              type="file"
              accept={ATTACHMENT_ACCEPT[fileKind]}
              multiple={fileKind === "image"}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                addFiles(event.target.files, fileKind);
                event.target.value = "";
              }}
            />
          ))}
          <Button variant="secondary" size="sm" disabled={busy || drawing} onClick={() => inputs.current.image?.click()} icon={<ImagePlus className="size-4" aria-hidden />}>
            {isPackage ? "Photos" : "Photo"}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || drawing || recording || files.length >= maxFiles} onClick={() => setDrawing(true)} icon={<Pencil className="size-4" aria-hidden />}>Draw</Button>
          {canRecordVoice() && (
            <Button variant="secondary" size="sm" disabled={busy || recording || drawing} onClick={() => setRecording(true)} icon={<Mic className="size-4" aria-hidden />}>
              {isPackage ? "Voice note" : "Record"}
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={busy || drawing} onClick={() => inputs.current.audio?.click()} icon={isPackage ? <Music2 className="size-4" aria-hidden /> : <FileAudio className="size-4" aria-hidden />}>
            {isPackage ? "Song file" : "Audio"}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || drawing} onClick={() => inputs.current.video?.click()} icon={<Film className="size-4" aria-hidden />}>
            Video
          </Button>
          <Button variant={showLink ? "quiet" : "secondary"} size="sm" disabled={busy} onClick={() => setShowLink(!showLink)} icon={<Link2 className="size-4" aria-hidden />} aria-pressed={showLink}>
            {isPackage ? "Song link" : "Link"}
          </Button>
        </div>
      </div>

      <footer className="pb-safe border-t border-line px-5 pt-3">
        <p className="mb-2.5 text-xs leading-relaxed text-ink-faint">
          {isPackage
            ? `Only ${friend?.display_name.split(" ")[0] ?? "they"} can open it, and only once they've read this far.`
            : "Friends who haven't read this far will only see that you left something here, not what."}
        </p>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={empty || recording || drawing}>
          {busy ? (uploading ? "Uploading…" : isPackage ? "Wrapping…" : "Leaving it…") : isPackage ? "Wrap it and leave it here" : "Leave it here"}
        </Button>
      </footer>
    </form>
  );
}
