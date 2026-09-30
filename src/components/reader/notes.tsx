"use client";

import { ExternalLink, Lock, MessageCircle, MoreHorizontal, Send, SmilePlus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger, SheetClose } from "@/components/ui/overlay";
import { cn, isEmojiOnly, plural, timeAgo } from "@/lib/format";
import type { Marker } from "@/lib/types";
import { AttachmentView } from "./media";
import type { ViewerMarker } from "./types";
import type { Annotations, NoteBundle } from "./use-annotations";

export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "🤔", "👏"];

export type People = Map<string, AvatarPerson>;

const unknownPerson = (id: string): AvatarPerson => ({ id, display_name: "A former member", avatar_path: null });

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------- margin marker
/**
 * The mark a note leaves in the margin.
 *   locked → a quiet outlined dot with a lock: "Sara left something here" and nothing more.
 *   open   → the author's avatar; a gold ring while it is new to you.
 * At least 44px of touch target either way.
 */
export function MarkerButton({
  marker,
  author,
  onOpen,
}: {
  marker: ViewerMarker;
  author: AvatarPerson;
  onOpen: () => void;
}) {
  const hue = personHue(marker.authorId);
  const first = author.display_name.split(" ")[0];

  if (!marker.open) {
    return (
      <Popover>
        <PopoverTrigger className="group flex size-11 items-center justify-center rounded-full" aria-label={`${author.display_name} left something here. It opens when you reach it.`}>
          <span
            className="flex size-7 animate-marker-in items-center justify-center rounded-full bg-[var(--page)] transition-transform group-hover:scale-110"
            style={{ boxShadow: `inset 0 0 0 1.5px oklch(0.62 0.1 ${hue})`, color: `oklch(0.5 0.1 ${hue})` }}
          >
            <Lock className="size-3" aria-hidden />
          </span>
        </PopoverTrigger>
        <PopoverContent side="left" className="w-64 p-3.5">
          <div className="flex items-center gap-2.5">
            <Avatar person={author} size={28} />
            <p className="text-sm font-medium text-ink">{first} left something here.</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">It opens by itself once you&apos;ve read up to this spot.</p>
        </PopoverContent>
      </Popover>
    );
  }

  const isNew = marker.fresh || !marker.seen;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex size-11 items-center justify-center rounded-full"
      aria-label={`${isNew ? "New: " : ""}Open what ${author.display_name} left here`}
    >
      <span className={cn("relative rounded-full transition-transform group-hover:scale-110", marker.fresh ? "animate-unlock" : "animate-marker-in")}>
        <Avatar person={author} size={28} className={cn("rounded-full shadow-soft", isNew && "outline outline-2 outline-offset-1 outline-gold")} />
        {isNew && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-gold ring-2 ring-[var(--page)]" aria-hidden />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- reactions
function ReactionBar({ markerId, bundle, meId, annotations, people }: { markerId: string; bundle: NoteBundle; meId: string; annotations: Annotations; people: People }) {
  const grouped = new Map<string, string[]>();
  for (const reaction of bundle.reactions) grouped.set(reaction.emoji, [...(grouped.get(reaction.emoji) ?? []), reaction.user_id]);

  const toggle = (emoji: string) => annotations.toggleReaction(markerId, emoji).catch((error: Error) => toast.error(error.message));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[...grouped.entries()].map(([emoji, users]) => {
        const mine = users.includes(meId);
        const names = users.map((id) => (id === meId ? "You" : (people.get(id)?.display_name ?? "Someone"))).join(", ");
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle(emoji)}
            aria-pressed={mine}
            aria-label={`${emoji} ${users.length}, from ${names}`}
            title={names}
            className={cn(
              "flex h-9 animate-pop-in items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors",
              mine ? "border-accent/50 bg-accent-soft text-accent-ink" : "border-line-strong text-ink-soft hover:bg-sunk",
            )}
          >
            <span className="text-base leading-none">{emoji}</span>
            <span className="tabular-nums">{users.length}</span>
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger className="flex size-9 items-center justify-center rounded-full border border-line-strong text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Add a reaction">
          <SmilePlus className="size-4" aria-hidden />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-auto p-1.5">
          <div className="flex gap-0.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => toggle(emoji)} className="flex size-10 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 hover:bg-sunk" aria-label={`React with ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------- the note thread
/** A note and the conversation attached to that exact place in the book. */
export function NoteThread({
  marker,
  bundle,
  meId,
  people,
  annotations,
  canModerate,
  archived,
  onJump,
  onRemoved,
}: {
  marker: Marker;
  bundle: NoteBundle | undefined;
  meId: string;
  people: People;
  annotations: Annotations;
  canModerate: boolean;
  archived: boolean;
  onJump?: () => void;
  onRemoved: () => void;
}) {
  const author = people.get(marker.author_id) ?? unknownPerson(marker.author_id);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const replyCount = bundle?.replies.length ?? 0;

  useEffect(() => {
    // Keep the newest reply in view when the thread grows.
    if (replyCount > 0) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [replyCount]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await annotations.addReply(marker.id, reply.trim());
      setReply("");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    try {
      await annotations.removeNote(marker.id);
      toast.success(marker.author_id === meId ? "Your note was removed." : "The note was removed.");
      onRemoved();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const content = bundle?.content;
  const body = content?.body ?? "";
  const bigEmoji = content?.emoji && !body && !content.link_url && (bundle?.attachments.length ?? 0) === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <Avatar person={author} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{marker.author_id === meId ? "You" : author.display_name}</p>
          <p className="truncate text-xs text-ink-faint">
            left this {timeAgo(marker.published_at ?? marker.created_at)}
            {marker.location_label ? ` · ${marker.location_label}` : ""}
          </p>
        </div>
        {(marker.author_id === meId || canModerate) && (
          <Menu>
            <MenuTrigger className="flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Note options">
              <MoreHorizontal className="size-5" aria-hidden />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem danger onSelect={remove}>
                <Trash2 className="size-4" aria-hidden />
                {marker.author_id === meId ? "Delete my note" : "Remove this note"}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        <SheetClose className="flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
          <X className="size-5" aria-hidden />
        </SheetClose>
      </header>

      <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!bundle || bundle.status === "loading" ? (
          <div className="flex justify-center py-10">
            <Spinner label="Opening the note" />
          </div>
        ) : bundle.status === "unavailable" || !content ? (
          <p className="rounded-2xl border border-line bg-sunk px-4 py-6 text-center text-sm text-ink-soft" role="alert">
            This note isn&apos;t available. It may have been removed — or you haven&apos;t reached it yet.
          </p>
        ) : (
          <>
            {content.quote && (
              <button
                type="button"
                onClick={onJump}
                className="block w-full border-l-2 pl-3 text-left font-display text-[15px] italic leading-relaxed text-ink-soft hover:text-ink"
                style={{ borderColor: `oklch(0.62 0.12 ${personHue(marker.author_id)})` }}
                aria-label="Go to this passage"
              >
                “{content.quote.length > 320 ? `${content.quote.slice(0, 320)}…` : content.quote}”
              </button>
            )}

            {bigEmoji ? (
              <p className="animate-pop-in text-5xl leading-none" aria-label={`Reaction: ${content.emoji}`}>
                {content.emoji}
              </p>
            ) : (
              <>
                {content.emoji && <p className="text-3xl leading-none">{content.emoji}</p>}
                {body && <p className={cn("whitespace-pre-wrap break-words text-ink", isEmojiOnly(body) ? "text-4xl" : "text-[15px] leading-relaxed")}>{body}</p>}
              </>
            )}

            {bundle.attachments.length > 0 && (
              <div className="space-y-2.5">
                {bundle.attachments.map((attachment) => (
                  <AttachmentView key={attachment.id} attachment={attachment} />
                ))}
              </div>
            )}

            {content.link_url && (
              <a
                href={content.link_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center gap-2.5 rounded-2xl border border-line bg-sunk/60 px-3.5 py-3 text-sm transition-colors hover:bg-sunk"
              >
                <ExternalLink className="size-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{hostOf(content.link_url)}</span>
                  <span className="block truncate text-xs text-ink-faint">{content.link_url}</span>
                </span>
              </a>
            )}

            <ReactionBar markerId={marker.id} bundle={bundle} meId={meId} annotations={annotations} people={people} />

            {bundle.replies.length > 0 && (
              <ol className="space-y-3 border-t border-line pt-4" aria-label={plural(bundle.replies.length, "reply", "replies")}>
                {bundle.replies.map((item) => {
                  const who = people.get(item.author_id) ?? unknownPerson(item.author_id);
                  const mine = item.author_id === meId;
                  return (
                    <li key={item.id} className="group flex animate-fade-up gap-2.5">
                      <Avatar person={who} size={28} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-ink-faint">
                          <span className="font-medium text-ink-soft">{mine ? "You" : who.display_name}</span> · {timeAgo(item.created_at)}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{item.body}</p>
                      </div>
                      {(mine || canModerate) && (
                        <button
                          type="button"
                          onClick={() => annotations.removeReply(marker.id, item.id).catch((error: Error) => toast.error(error.message))}
                          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-faint opacity-60 hover:bg-sunk hover:text-danger focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label={mine ? "Delete my reply" : "Remove this reply"}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <div ref={end} />
          </>
        )}
      </div>

      {bundle?.status === "ready" && !archived && (
        <form onSubmit={send} className="pb-safe flex items-end gap-2 border-t border-line px-4 pt-3">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply…"
            aria-label="Reply to this note"
            rows={1}
            maxLength={4000}
            className="max-h-32 min-h-11 resize-none py-2.5"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(event);
            }}
          />
          <Button type="submit" size="icon" loading={sending} disabled={!reply.trim()} aria-label="Send reply">
            {!sending && <Send className="size-4" aria-hidden />}
          </Button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the trail
/**
 * Everything left in this book, in book order. Notes the reader can open show
 * a preview; the rest are shown only as "someone left something" — no text, no
 * emoji, no hint of media or replies.
 */
export function TrailList({
  markers,
  annotations,
  people,
  meId,
  furthest,
  onOpen,
  header,
}: {
  markers: Marker[];
  annotations: Annotations;
  people: People;
  meId: string;
  furthest: number;
  onOpen: (marker: Marker) => void;
  header?: ReactNode;
}) {
  const open = markers.filter((m) => annotations.isOpen(m));
  const ahead = markers.filter((m) => !annotations.isOpen(m));
  const openIds = open.map((m) => m.id).join(",");

  useEffect(() => {
    if (openIds) void annotations.loadNotes(openIds.split(","));
    // Loading is keyed by the set of readable ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIds]);

  // "Reading trails": who left something ahead, without saying what.
  const aheadByAuthor = new Map<string, number>();
  for (const marker of ahead) aheadByAuthor.set(marker.author_id, (aheadByAuthor.get(marker.author_id) ?? 0) + 1);
  const next = ahead[0];

  return (
    <div className="space-y-5">
      {header}
      {ahead.length > 0 && (
        <section aria-label="Waiting ahead" className="rounded-2xl border border-accent/25 bg-accent-soft/50 p-4">
          <p className="text-sm font-medium text-ink">
            {plural(ahead.length, "thing")} waiting ahead of you
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {[...aheadByAuthor.entries()].map(([authorId, count]) => {
              const author = people.get(authorId) ?? unknownPerson(authorId);
              return (
                <li key={authorId} className="flex items-center gap-2 text-sm text-ink-soft">
                  <Avatar person={author} size={22} />
                  <span>
                    <span className="font-medium text-ink">{author.display_name.split(" ")[0]}</span> left {count === 1 ? "something" : `${count} things`}
                  </span>
                </li>
              );
            })}
          </ul>
          {next && (
            <p className="mt-2.5 text-xs text-ink-faint">
              The nearest is {Math.max(1, Math.round((next.position - furthest) * 100))}% further on. It opens when you get there.
            </p>
          )}
        </section>
      )}

      {open.length === 0 ? (
        <p className="py-6 text-center text-sm leading-relaxed text-ink-faint">
          {markers.length === 0 ? "Nobody has left anything in this book yet. Select a passage to be the first." : "Nothing to open yet — keep reading."}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {open.map((marker) => {
            const author = people.get(marker.author_id) ?? unknownPerson(marker.author_id);
            const bundle = annotations.notes.get(marker.id);
            const unlock = annotations.unlocks.get(marker.id);
            const isNew = marker.author_id !== meId && unlock && !unlock.seen_at;
            const content = bundle?.content;
            const kinds = [...new Set(bundle?.attachments.map((a) => a.kind) ?? [])];
            const preview = content?.body?.trim() || content?.emoji || (kinds.length ? kinds.map((k) => (k === "image" ? "Photo" : k === "audio" ? "Voice note" : "Video")).join(", ") : content?.link_url ? hostOf(content.link_url) : "");
            return (
              <li key={marker.id}>
                <button type="button" onClick={() => onOpen(marker)} className={cn("flex w-full gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sunk", isNew && "bg-gold-soft/60")}>
                  <Avatar person={author} size={30} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{marker.author_id === meId ? "You" : author.display_name}</span>
                      <span className="shrink-0 text-xs text-ink-faint">{marker.location_label ?? `${Math.round(marker.position * 100)}%`}</span>
                    </span>
                    <span className="line-clamp-2 text-sm leading-snug text-ink-soft">{bundle?.status === "loading" || !bundle ? "…" : preview || "Note"}</span>
                    {(bundle?.replies.length ?? 0) > 0 && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-ink-faint">
                        <MessageCircle className="size-3" aria-hidden />
                        {plural(bundle!.replies.length, "reply", "replies")}
                      </span>
                    )}
                  </span>
                  {isNew && <span className="mt-2 size-2 shrink-0 rounded-full bg-gold" aria-label="New" />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
