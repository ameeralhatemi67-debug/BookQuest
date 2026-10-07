"use client";

import { Lock, Stamp } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Avatar, type AvatarPerson } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormError, Textarea } from "@/components/ui/field";
import { chapterAt, nextChapter, type Chapter } from "@/lib/chapters";
import { friendlyError } from "@/lib/errors";
import { cn, plural, timeAgo } from "@/lib/format";
import { formatPercent } from "@/lib/location";
import { getSupabase } from "@/lib/supabase/client";
import type { Prediction, PredictionVerdict } from "@/lib/types";

/** A wax seal in the author's colour: the mark of something nobody can change. */
export function WaxSeal({ hue, size = "md", className, stamping, breaking }: { hue?: number; size?: "sm" | "md"; className?: string; stamping?: boolean; breaking?: boolean }) {
  return (
    <span
      aria-hidden
      data-size={size}
      className={cn("wax-seal", stamping && "wax-seal-stamp", breaking && "wax-seal-break", className)}
      style={hue === undefined ? undefined : ({ "--seal": `oklch(0.5 0.15 ${hue})` } as React.CSSProperties)}
    >
      <Stamp className={size === "sm" ? "size-3" : "size-5"} strokeWidth={2.2} />
    </span>
  );
}

const VERDICTS: { id: PredictionVerdict; label: string }[] = [
  { id: "called_it", label: "Called it" },
  { id: "close", label: "Close" },
  { id: "way_off", label: "Way off" },
];

type OpensKind = Prediction["opens_kind"];

/** Writing a prediction and choosing when it opens. Once sealed it cannot be edited. */
export function PredictionComposer({ roomId, position, label, chapters, onSealed }: { roomId: string; position: number; label: string; chapters: Chapter[]; onSealed: (opensLabel: string) => void }) {
  const next = nextChapter(chapters, position);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<OpensKind>(next ? "chapter" : "end");
  const [point, setPoint] = useState(() => Math.min(0.98, Math.max(position + 0.05, next?.start ?? position + 0.1)));
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pointChapter = chapterAt(chapters, point);
  const pointLabel = pointChapter && pointChapter.start <= point ? `${pointChapter.label} · ${formatPercent(point)}` : formatPercent(point);
  const opens = kind === "chapter" && next ? { at: next.start, label: next.label } : kind === "point" ? { at: point, label: pointLabel } : { at: 0.99, label: "The end" };

  async function seal(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc("seal_prediction", {
      p_room_id: roomId, p_body: body.trim(), p_made_at: position, p_made_label: label,
      p_opens_at: opens.at, p_opens_label: opens.label, p_opens_kind: kind, p_hide_from_author: hide,
    });
    if (rpcError) {
      setBusy(false);
      return setError(friendlyError(rpcError));
    }
    setStamped(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => onSealed(opens.label), reduce ? 200 : 1100);
  }

  return (
    <form onSubmit={seal} className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-slim relative min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What do you think happens next?" aria-label="Your prediction" maxLength={2000} rows={5} autoFocus disabled={busy} />

        <fieldset disabled={busy}>
          <legend className="mb-2 text-xs font-medium text-ink-soft">Open it at</legend>
          <div role="radiogroup" aria-label="When it opens" className="space-y-1.5">
            {next && (
              <OpensOption checked={kind === "chapter"} onSelect={() => setKind("chapter")} title="The next chapter" detail={next.label} />
            )}
            <OpensOption checked={kind === "point"} onSelect={() => setKind("point")} title="A point I choose" detail={pointLabel} />
            {kind === "point" && (
              <div className="px-3 pb-1">
                <input
                  type="range"
                  min={Math.min(0.99, position + 0.01)}
                  max={0.99}
                  step={0.005}
                  value={point}
                  onChange={(e) => setPoint(Number(e.target.value))}
                  aria-label="Where it opens"
                  aria-valuetext={pointLabel}
                  className="w-full accent-[var(--accent)]"
                />
              </div>
            )}
            <OpensOption checked={kind === "end"} onSelect={() => setKind("end")} title="The end of the book" detail="Revealed together at the last page" />
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3">
          <input type="checkbox" checked={hide} disabled={busy} onChange={(e) => setHide(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span className="text-sm">
            <span className="block text-ink">Keep it sealed from me too</span>
            <span className="text-xs text-ink-soft">You&apos;ll find out what you guessed along with everyone else.</span>
          </span>
        </label>
        <FormError>{error}</FormError>

        {stamped && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-raised/90 backdrop-blur-[2px]" role="status">
            <WaxSeal stamping />
            <p className="font-display text-xl text-ink">Sealed</p>
            <p className="text-sm text-ink-soft">Opens at {opens.label}</p>
          </div>
        )}
      </div>
      <footer className="pb-safe border-t border-line px-5 pt-3">
        <p className="mb-2.5 flex items-center gap-1.5 text-xs text-ink-faint">
          <Lock className="size-3" aria-hidden /> Once it&apos;s sealed, nobody can change it. Not even you.
        </p>
        <Button type="submit" size="lg" className="w-full" loading={busy && !stamped} disabled={!body.trim() || stamped}>
          Seal it
        </Button>
      </footer>
    </form>
  );
}

function OpensOption({ checked, onSelect, title, detail }: { checked: boolean; onSelect: () => void; title: string; detail: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn("flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors", checked ? "border-accent bg-accent-soft/50" : "border-line hover:bg-sunk")}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border-2", checked ? "border-accent" : "border-line-strong")}>
        {checked && <span className="size-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{title}</span>
        <span className="block truncate text-xs text-ink-soft">{detail}</span>
      </span>
    </button>
  );
}

/**
 * Every prediction in the room. Sealed ones show only who and when they open;
 * ready ones open in a small ceremony, side by side, and can be judged.
 */
export function PredictionsPanel({ predictions, personOf, meId, hueOf, onChanged }: { predictions: Prediction[]; personOf: (id: string) => AvatarPerson; meId: string; hueOf: (id: string) => number; onChanged: () => void }) {
  const ready = useMemo(() => predictions.filter((p) => p.reached && !p.revealed_at), [predictions]);
  const opened = useMemo(() => predictions.filter((p) => p.reached && p.revealed_at), [predictions]);
  const sealed = useMemo(() => predictions.filter((p) => !p.reached), [predictions]);
  const [breaking, setBreaking] = useState<Set<string>>(new Set());

  async function reveal(ids: string[]) {
    setBreaking(new Set(ids));
    const supabase = getSupabase();
    const results = await Promise.all(ids.map((id) => supabase.rpc("reveal_prediction", { p_prediction_id: id })));
    const failed = results.find((r) => r.error);
    if (failed?.error) toast.error(friendlyError(failed.error));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => {
      setBreaking(new Set());
      onChanged();
    }, reduce ? 0 : 620);
  }

  async function judge(id: string, verdict: PredictionVerdict) {
    const { error } = await getSupabase().rpc("reveal_prediction", { p_prediction_id: id, p_verdict: verdict });
    if (error) return void toast.error(friendlyError(error));
    onChanged();
  }

  if (predictions.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <WaxSeal />
        <p className="mt-4 font-display text-xl text-ink">No predictions yet</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-ink-soft">Seal a guess from the + menu. It opens at the chapter you choose, for everyone who gets there.</p>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {ready.length > 0 && (
        <section aria-labelledby="ready-heading" className="rounded-3xl bg-gold-soft/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id="ready-heading" className="font-display text-lg text-ink">{plural(ready.length, "prediction")} ready to open</h3>
            <Button size="sm" onClick={() => void reveal(ready.map((p) => p.id))} disabled={breaking.size > 0}>Open {ready.length === 1 ? "it" : "them"}</Button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-3">
            {ready.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm text-ink-soft">
                <WaxSeal size="sm" hue={hueOf(p.author_id)} breaking={breaking.has(p.id)} />
                {p.author_id === meId ? "Yours" : personOf(p.author_id).display_name.split(" ")[0]}
              </li>
            ))}
          </ul>
        </section>
      )}

      {opened.length > 0 && (
        <section aria-labelledby="opened-heading">
          <h3 id="opened-heading" className="mb-3 font-display text-lg text-ink">Opened</h3>
          <ol className="grid gap-3">
            {opened.map((p, i) => {
              const author = personOf(p.author_id);
              return (
                <li key={p.id} className="prediction-reveal rounded-2xl border border-line bg-raised p-4 shadow-soft" style={{ animationDelay: `${i * 90}ms` }}>
                  <div className="flex items-center gap-2.5">
                    <Avatar person={author} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{p.author_id === meId ? "You" : author.display_name}</p>
                      <p className="truncate text-xs text-ink-faint">Sealed at {p.made_label ?? formatPercent(p.made_at)} · opened at {p.opens_label ?? formatPercent(p.opens_at)}</p>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words font-display text-[17px] italic leading-relaxed text-ink">“{p.body}”</p>
                  <div role="group" aria-label="How close was it?" className="mt-3 flex flex-wrap gap-1.5">
                    {VERDICTS.map((v) => {
                      const count = p.verdicts?.[v.id] ?? 0;
                      const mine = p.my_verdict === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          aria-pressed={mine}
                          onClick={() => void judge(p.id, v.id)}
                          className={cn("flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors", mine ? "border-accent/50 bg-accent-soft text-accent-ink" : "border-line-strong text-ink-soft hover:bg-sunk")}
                        >
                          {v.label}
                          {count > 0 && <span className="tabular-nums text-xs">{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {sealed.length > 0 && (
        <section aria-labelledby="sealed-heading">
          <h3 id="sealed-heading" className="mb-1 font-display text-lg text-ink">Still sealed</h3>
          <p className="mb-3 text-xs text-ink-faint">Each one opens when you reach its point.</p>
          <ul className="divide-y divide-line">
            {sealed.map((p) => {
              const author = personOf(p.author_id);
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <WaxSeal size="sm" hue={hueOf(p.author_id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {p.author_id === meId ? (p.hide_from_author ? "Yours, sealed from you too" : "Yours") : author.display_name.split(" ")[0]}
                    </p>
                    <p className="truncate text-xs text-ink-faint">Opens at {p.opens_label ?? formatPercent(p.opens_at)} · sealed {timeAgo(p.created_at)}</p>
                    {p.open && p.body && <p className="mt-1 line-clamp-2 font-display text-sm italic text-ink-soft">“{p.body}”</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
