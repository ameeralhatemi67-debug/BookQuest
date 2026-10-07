"use client";

import { Check, Hourglass, Music2, PartyPopper, Plus, Sparkles, Stamp, Vote } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar, type AvatarPerson } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { chaptersFrom, type Chapter } from "@/lib/chapters";
import { friendlyError } from "@/lib/errors";
import { cn, timeAgo } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import type { Ritual, RitualKind, RoomLayer } from "@/lib/types";

const TEMPLATES: { kind: RitualKind; icon: ReactNode; name: string; title: (chapter?: string, date?: string) => string; needs: ("chapter" | "date" | "poll" | "title")[] }[] = [
  { kind: "predict_before", icon: <Stamp className="size-4" aria-hidden />, name: "Everyone predicts", title: (c) => `Everyone seal one prediction before ${c ?? "…"}`, needs: ["chapter"] },
  { kind: "vote_before", icon: <Vote className="size-4" aria-hidden />, name: "Choose before continuing", title: () => "Everyone vote before continuing", needs: ["poll"] },
  { kind: "song_within", icon: <Music2 className="size-4" aria-hidden />, name: "Leave a song", title: (c) => `Leave one song somewhere before ${c ?? "…"}`, needs: ["chapter"] },
  { kind: "hold_until", icon: <Hourglass className="size-4" aria-hidden />, name: "Wait for each other", title: (c, d) => `Nobody reads past ${c ?? "…"} until ${d ?? "…"}`, needs: ["chapter", "date"] },
  { kind: "custom", icon: <Sparkles className="size-4" aria-hidden />, name: "Something else", title: () => "", needs: ["title"] },
];

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function NewRitual({ roomId, layer, myFurthest, onCreated }: { roomId: string; layer: RoomLayer; myFurthest: number; onCreated: () => void }) {
  const chapters = chaptersFrom(layer.outline);
  const ahead = chapters.filter((c) => c.start > myFurthest + 0.001);
  const polls = layer.polls.filter((p) => p.reached && p.question);
  const [kind, setKind] = useState<RitualKind>("predict_before");
  const [chapter, setChapter] = useState<Chapter | null>(ahead[0] ?? chapters.at(-1) ?? null);
  const [date, setDate] = useState("");
  const [pollId, setPollId] = useState(polls[0]?.id ?? "");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [minDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const template = TEMPLATES.find((t) => t.kind === kind)!;
  const title = kind === "custom" ? custom : template.title(chapter?.label, date ? dayLabel(date) : undefined);
  const missing = (template.needs.includes("chapter") && !chapter) || (template.needs.includes("date") && !date) || (template.needs.includes("poll") && !pollId) || !title.trim();

  async function create(event: FormEvent) {
    event.preventDefault();
    if (missing) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc("create_ritual", {
      p_room_id: roomId, p_kind: kind, p_title: title.trim(),
      p_starts_at: kind === "song_within" ? myFurthest : null,
      p_target_at: chapter && template.needs.includes("chapter") ? chapter.start : null,
      p_target_label: chapter && template.needs.includes("chapter") ? chapter.label : null,
      p_until_at: kind === "hold_until" && date ? new Date(`${date}T09:00:00`).toISOString() : null,
      p_poll_id: kind === "vote_before" ? pollId : null,
    });
    setBusy(false);
    if (rpcError) return setError(friendlyError(rpcError));
    toast.success("Ritual started. Everyone sees it in the book.");
    onCreated();
  }

  return (
    <form onSubmit={create} className="space-y-5">
      <div role="radiogroup" aria-label="Kind of ritual" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button key={t.kind} type="button" role="radio" aria-checked={kind === t.kind} onClick={() => setKind(t.kind)} className={cn("flex min-h-12 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition-colors", kind === t.kind ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-ink-soft hover:bg-sunk")}>
            <span className={kind === t.kind ? "text-accent-ink" : "text-ink-faint"}>{t.icon}</span>
            {t.name}
          </button>
        ))}
      </div>
      {template.needs.includes("chapter") && (
        <label className="block text-sm font-medium text-ink">
          {kind === "hold_until" ? "The line nobody crosses" : "Before"}
          <select value={chapter?.index ?? ""} onChange={(e) => setChapter(chapters.find((c) => c.index === Number(e.target.value)) ?? null)} className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-raised px-2 text-sm text-ink">
            {(ahead.length ? ahead : chapters).map((c) => <option key={c.index} value={c.index}>{c.label}</option>)}
          </select>
        </label>
      )}
      {template.needs.includes("date") && (
        <Field label="Until">
          {(props) => <Input {...props} type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} />}
        </Field>
      )}
      {template.needs.includes("poll") && (
        polls.length ? (
          <label className="block text-sm font-medium text-ink">
            The poll everyone answers
            <select value={pollId} onChange={(e) => setPollId(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-raised px-2 text-sm text-ink">
              {polls.map((p) => <option key={p.id} value={p.id}>{p.question}{p.label ? ` (${p.label})` : ""}</option>)}
            </select>
          </label>
        ) : (
          <p className="rounded-2xl bg-sunk px-4 py-3 text-sm text-ink-soft">Leave a poll in the book first (Leave something → Poll), then ask everyone to answer it before moving on.</p>
        )
      )}
      {kind === "custom" && (
        <Field label="The challenge">
          {(props) => <Input {...props} value={custom} maxLength={140} onChange={(e) => setCustom(e.target.value)} placeholder="Choose your favourite character before Chapter 5" />}
        </Field>
      )}
      {kind !== "custom" && title && (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-3 font-display text-lg leading-snug text-ink">{title}</p>
      )}
      <FormError>{error}</FormError>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={missing}>Start the ritual</Button>
      </div>
    </form>
  );
}

function RitualRow({ ritual, personOf, meId, canEnd, onChanged }: { ritual: Ritual; personOf: (id: string) => AvatarPerson; meId: string; canEnd: boolean; onChanged: () => void }) {
  const done = ritual.members.filter((m) => m.done).length;
  const mine = ritual.members.find((m) => m.user_id === meId)?.done;
  const template = TEMPLATES.find((t) => t.kind === ritual.kind);
  async function run(fn: "end_ritual" | "checkin_ritual") {
    const { error } = await getSupabase().rpc(fn, { p_ritual_id: ritual.id });
    if (error) return void toast.error(friendlyError(error));
    onChanged();
  }
  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">{template?.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug text-ink">{ritual.title}</p>
          <p className="mt-0.5 text-xs text-ink-faint">Started by {ritual.created_by === meId ? "you" : personOf(ritual.created_by).display_name.split(" ")[0]} {timeAgo(ritual.created_at)}{ritual.ended_at ? " · ended" : ""}</p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label={`${done} of ${ritual.members.length} done`}>
            {ritual.members.map((m) => (
              <li key={m.user_id} className={cn("relative rounded-full", !m.done && "opacity-40 grayscale")} title={`${personOf(m.user_id).display_name}${m.done ? ": done" : ""}`}>
                <Avatar person={personOf(m.user_id)} size={26} />
                {m.done && <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-moss text-white ring-2 ring-paper"><Check className="size-2.5" strokeWidth={3} aria-hidden /></span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-sm tabular-nums text-ink-soft">{done}/{ritual.members.length}</span>
          {ritual.kind === "custom" && !mine && !ritual.ended_at && <Button size="sm" variant="secondary" onClick={() => void run("checkin_ritual")}>I did it</Button>}
          {canEnd && !ritual.ended_at && <button type="button" onClick={() => void run("end_ritual")} className="min-h-9 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline">End</button>}
        </div>
      </div>
    </li>
  );
}

/** Rituals, afterparties and the vault: the room's shared moments, on the room page. */
export function RoomMoments({ roomId, layer, meId, isStaff, myFurthest, finished, personOf, onChanged, archived }: {
  roomId: string;
  layer: RoomLayer | null;
  meId: string;
  isStaff: boolean;
  myFurthest: number;
  finished: boolean;
  personOf: (id: string) => AvatarPerson;
  onChanged: () => void;
  archived: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const features = layer?.features ?? {};
  const rituals = useMemo(() => layer?.rituals ?? [], [layer?.rituals]);
  const parties = layer?.afterparties ?? [];
  const ritualsOn = features.rituals !== false;
  const partiesOn = features.afterparty !== false;
  const vaultOn = features.vault !== false;
  if (!layer || (!ritualsOn && !(partiesOn && parties.length) && !vaultOn)) return null;

  return (
    <section aria-labelledby="moments-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="moments-heading" className="font-display text-2xl text-ink">Room rituals</h2>
          <p className="text-sm text-ink-soft">Small challenges tied to the book, instead of streaks.</p>
        </div>
        {ritualsOn && !archived && (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>New ritual</Button>
        )}
      </div>

      {ritualsOn && (rituals.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {rituals.map((r) => <RitualRow key={r.id} ritual={r} personOf={personOf} meId={meId} canEnd={isStaff || r.created_by === meId} onChanged={onChanged} />)}
        </ul>
      ) : (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-sm leading-relaxed text-ink-soft">
          No rituals yet. Try &ldquo;everyone seals a prediction before Chapter 8&rdquo;, or &ldquo;nobody reads past Chapter 12 until Saturday&rdquo;.
        </p>
      ))}

      {(partiesOn && parties.length > 0) || (vaultOn && finished) ? (
        <div className="flex flex-wrap gap-2">
          {partiesOn && parties.map((p) => (
            <Link key={p.chapter_index} href={`/read/${roomId}?party=${p.chapter_index}`} className="inline-flex h-10 items-center gap-2 rounded-full bg-gold-soft px-4 text-sm text-ink transition-transform hover:scale-[1.03] active:scale-95">
              <PartyPopper className="size-4 text-gold" aria-hidden /> {p.label ?? `Chapter ${p.chapter_index + 1}`} afterparty
            </Link>
          ))}
          {vaultOn && finished && (
            <Link href={`/rooms/${roomId}/vault`} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm text-paper transition-transform hover:scale-[1.03] active:scale-95">
              <Stamp className="size-4" aria-hidden /> Open the vault
            </Link>
          )}
        </div>
      ) : null}
      {partiesOn && parties.length === 0 && <p className="text-xs text-ink-faint">A chapter&apos;s afterparty opens once everyone in the room has finished it.</p>}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Start a ritual" description="Everyone sees it in the book, with who has done it.">
          {creating && <NewRitual roomId={roomId} layer={layer} myFurthest={myFurthest} onCreated={() => { setCreating(false); onChanged(); }} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
