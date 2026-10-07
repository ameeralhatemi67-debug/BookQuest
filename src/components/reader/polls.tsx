"use client";

import { BarChart3, Lock, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Avatar, AvatarStack, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger, SheetClose } from "@/components/ui/overlay";
import { friendlyError } from "@/lib/errors";
import { cn, plural, timeAgo } from "@/lib/format";
import type { Anchor } from "@/lib/location";
import { getSupabase } from "@/lib/supabase/client";
import type { Poll } from "@/lib/types";
import type { ViewerMarker } from "./types";

/** Asking the room something at this exact passage. */
export function PollComposer({ roomId, position, anchor, label, onCreated }: { roomId: string; position: number; anchor: Anchor; label: string; onCreated: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = options.filter((o) => o.trim()).length;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || filled < 2 || busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc("create_poll", {
      p_room_id: roomId, p_position: position, p_anchor: anchor, p_location_label: label,
      p_question: question.trim(), p_options: options.map((o) => o.trim()).filter(Boolean),
    });
    setBusy(false);
    if (rpcError) return setError(friendlyError(rpcError));
    toast.success("Poll left here. Friends see it when they arrive.");
    onCreated();
  }

  return (
    <form onSubmit={create} className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <label className="block text-xs font-medium text-ink-soft">
          Question
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Who do you trust?" maxLength={300} autoFocus disabled={busy} className="mt-1.5" />
        </label>
        <fieldset disabled={busy} className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-soft">Answers</legend>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={option}
                onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value : o)))}
                placeholder={index === 0 ? "The butler" : index === 1 ? "The niece" : `Answer ${index + 1}`}
                maxLength={80}
                aria-label={`Answer ${index + 1}`}
              />
              {options.length > 2 && (
                <button type="button" onClick={() => setOptions(options.filter((_, i) => i !== index))} className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label={`Remove answer ${index + 1}`}>
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <Button variant="ghost" size="sm" onClick={() => setOptions([...options, ""])} icon={<Plus className="size-4" aria-hidden />}>
              Add an answer
            </Button>
          )}
        </fieldset>
        <FormError>{error}</FormError>
      </div>
      <footer className="pb-safe border-t border-line px-5 pt-3">
        <p className="mb-2.5 text-xs leading-relaxed text-ink-faint">The question stays hidden until a friend reaches this passage. Results show once they&apos;ve voted, and votes can&apos;t be changed.</p>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!question.trim() || filled < 2}>
          Leave the poll here
        </Button>
      </footer>
    </form>
  );
}

/** One poll: vote, then see how the room voted. */
export function PollSheet({ poll, personOf, meId, onJump, onChanged }: { poll: Poll; personOf: (id: string) => AvatarPerson; meId: string; onJump?: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const author = personOf(poll.author_id);

  async function vote(option: number) {
    setBusy(option);
    const { error } = await getSupabase().rpc("vote_poll", { p_poll_id: poll.id, p_option: option });
    setBusy(null);
    if (error) return void toast.error(friendlyError(error));
    onChanged();
  }

  const results = poll.results ?? [];
  const total = results.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <Avatar person={author} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{poll.author_id === meId ? "You" : author.display_name} asked</p>
          <button type="button" onClick={onJump} className="truncate text-xs text-ink-faint underline-offset-4 hover:underline">
            {poll.label ?? "Here"} · {timeAgo(poll.created_at)}
          </button>
        </div>
        <SheetClose className="flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
          <X className="size-5" aria-hidden />
        </SheetClose>
      </header>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {!poll.reached || !poll.question || !poll.options ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft"><Lock className="size-4" aria-hidden /> This poll opens when you reach it.</p>
        ) : (
          <>
            <h2 className="font-display text-2xl leading-snug text-ink">{poll.question}</h2>
            {poll.my_vote === null ? (
              <>
                <ul className="mt-5 space-y-2">
                  {poll.options.map((option, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void vote(index)}
                        className="flex min-h-12 w-full items-center rounded-2xl border border-line-strong px-4 text-left text-[15px] text-ink transition-[background-color,transform] duration-150 hover:bg-sunk active:scale-[0.98] disabled:opacity-60"
                      >
                        {option}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-ink-faint">
                  {poll.votes > 0 ? `${plural(poll.votes, "friend")} voted. ` : ""}You&apos;ll see the results once you vote. Votes are final.
                </p>
              </>
            ) : (
              <>
                <ul className="mt-5 space-y-3" aria-label="Results">
                  {poll.options.map((option, index) => {
                    const voters = results.filter((r) => r.option === index).map((r) => personOf(r.user_id));
                    const share = total ? voters.length / total : 0;
                    const mine = poll.my_vote === index;
                    return (
                      <li key={index}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className={cn("text-ink", mine && "font-medium")}>{option}{mine && <span className="ml-1.5 text-xs font-normal text-accent-ink">your vote</span>}</span>
                          <span className="tabular-nums text-ink-soft">{Math.round(share * 100)}%</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full">
                            <div className="poll-bar h-full rounded-full" style={{ width: `${Math.max(share * 100, voters.length ? 6 : 0)}%`, background: mine ? "var(--accent)" : "color-mix(in oklab, var(--ink) 22%, transparent)", "--i": index } as React.CSSProperties} />
                          </div>
                          {voters.length > 0 && <AvatarStack people={voters} size={22} max={4} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-xs text-ink-faint">{plural(total, "vote")} so far. Friends who haven&apos;t reached this passage don&apos;t know it exists.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A poll in the margin: a ballot in the asker's colour once reached, neutral before. */
export function PollMarker({ marker, author, voted, onOpen }: { marker: ViewerMarker; author: AvatarPerson; voted: boolean; onOpen: () => void }) {
  const hue = personHue(marker.authorId);
  if (!marker.open) {
    return (
      <Popover>
        <PopoverTrigger className="group flex size-11 items-center justify-center rounded-full" aria-label={`${author.display_name} left a poll here. It opens when you reach it.`}>
          <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--page)] transition-transform group-hover:scale-110" style={{ boxShadow: `inset 0 0 0 1.5px oklch(0.62 0.1 ${hue})`, color: `oklch(0.5 0.1 ${hue})` }}>
            <Lock className="size-3" aria-hidden />
          </span>
        </PopoverTrigger>
        <PopoverContent side="left" className="w-60 p-3.5 text-sm text-ink-soft">
          {author.display_name.split(" ")[0]} asked the room something here. You&apos;ll see the question when you arrive.
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="group relative flex size-11 items-center justify-center rounded-full" aria-label={`${voted ? "" : "New: "}Poll from ${author.display_name}`}>
      <span className={cn("flex size-8 items-center justify-center rounded-xl text-white shadow-soft transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-110", !voted && "animate-marker-in")} style={{ background: `oklch(0.6 0.12 ${hue})` }}>
        <BarChart3 className="size-4" aria-hidden />
      </span>
      {!voted && <span className="absolute right-1 top-1 size-2.5 rounded-full bg-gold ring-2 ring-[var(--page)]" aria-hidden />}
    </button>
  );
}
