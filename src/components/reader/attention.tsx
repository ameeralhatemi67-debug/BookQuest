"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { cn } from "@/lib/format";
import type { NoteAttention } from "@/lib/types";

/**
 * Why attention exists: a note in the margin is a friend saying "look". How
 * hard they say it is part of the message. The performance only ever plays on
 * a page the reader has reached, and it carries intensity, never content: the
 * avatar can be frantic about chapter nine without telling you why.
 */
export const ATTENTION_LEVELS: { id: NoteAttention; short: string; name: string; hint: string; mark: string }[] = [
  { id: "quiet", short: "Whisper", name: "Whisper", hint: "Barely there. Leans toward the line and breathes.", mark: "·" },
  { id: "gentle", short: "Gentle", name: "Gentle", hint: "Floats in the margin, with the odd soft hop.", mark: "~" },
  { id: "playful", short: "Excited", name: "Excited", hint: "Hops twice, then a spinning leap with sparkles.", mark: "+" },
  { id: "knock", short: "Knock", name: "Knock knock", hint: "Leans back and raps on the page until you look.", mark: "••" },
  { id: "shout", short: "Shout", name: "DO NOT IGNORE THIS 😂", hint: "Leaps, spins, lands hard and shivers. They will look.", mark: "!" },
];

export function attentionName(level: NoteAttention | undefined): string {
  return ATTENTION_LEVELS.find((l) => l.id === level)?.name ?? "Gentle";
}

/**
 * A friend's avatar, performing an attention level. `still` stops it (dragging,
 * snoozed, preview open, or the room switched animated notes off).
 */
export function NoteActor({
  person,
  attention,
  still = false,
  arriving = false,
  size = 32,
  className,
}: {
  person: AvatarPerson;
  attention: NoteAttention;
  still?: boolean;
  /** Play the landing once before the performance starts. */
  arriving?: boolean;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const [landing, setLanding] = useState(arriving);
  const [escalated, setEscalated] = useState(false);

  // Loops stop while off screen: twelve friends' notes should not cost a frame they cannot be seen in.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "40px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!landing) return;
    const timer = setTimeout(() => setLanding(false), 760);
    return () => clearTimeout(timer);
  }, [landing]);

  useEffect(() => {
    if (attention !== "shout" || still) return;
    const timer = setTimeout(() => setEscalated(true), 15_000);
    return () => clearTimeout(timer);
  }, [attention, still]);

  const level = ATTENTION_LEVELS.find((l) => l.id === attention) ?? ATTENTION_LEVELS[1];
  const scale = size / 32;
  return (
    <span
      ref={ref}
      className={cn("na", className)}
      data-attention={still ? "still" : attention}
      data-paused={visible ? "false" : "true"}
      data-arriving={landing && !still ? "true" : "false"}
      data-escalated={escalated && !still ? "true" : "false"}
      style={{ "--na-hue": personHue(person.id), ...(scale !== 1 ? { transform: `scale(${scale})` } : null) } as React.CSSProperties}
      aria-hidden
    >
      <span className="na-shadow" />
      <span className="na-ghost" />
      <span className="na-ghost" />
      <span className="na-ghost" />
      <span className="na-jump">
        <span className="na-spin">
          <span className="na-body">
            <span className="na-aura" />
            <Avatar person={person} size={32} className="rounded-full shadow-soft" />
          </span>
        </span>
      </span>
      <span className="na-fx">
        <i />
        <i />
        <i />
        <i />
      </span>
      {level.mark && !still && <span className="na-still-mark">{level.mark}</span>}
    </span>
  );
}

/** The composer's choice of intensity, with the author's own avatar rehearsing it. */
export function AttentionPicker({ value, onChange, me, disabled }: { value: NoteAttention; onChange: (value: NoteAttention) => void; me: AvatarPerson; disabled?: boolean }) {
  const selected = ATTENTION_LEVELS.find((l) => l.id === value) ?? ATTENTION_LEVELS[1];
  const index = ATTENTION_LEVELS.indexOf(selected);
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="text-xs font-medium text-ink-soft">How should it get their attention?</legend>
      <div className="mt-1.5 flex min-h-[104px] items-end gap-4 rounded-2xl bg-sunk/70 px-5 pb-4 pt-10">
        {/* The key restarts the performance from the top whenever the level changes. Headroom above is for the leaps. */}
        <NoteActor key={selected.id} person={me} attention={selected.id} arriving className="mb-1 shrink-0" />
        <div className="min-w-0 self-center">
          <p className="font-display text-lg leading-tight text-ink">{selected.name}</p>
          <p className="text-xs leading-snug text-ink-soft">{selected.hint}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label="Attention level" className="mt-2 grid grid-cols-5 gap-1 rounded-full bg-sunk p-1">
        {ATTENTION_LEVELS.map((level, i) => (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={level.id === value}
            aria-label={level.name}
            onClick={() => onChange(level.id)}
            className={cn(
              "relative flex h-9 min-w-0 items-center justify-center rounded-full px-1 text-xs font-medium transition-colors duration-150",
              level.id === value ? "bg-raised text-ink shadow-soft" : "text-ink-soft hover:text-ink",
            )}
          >
            <span className="truncate">{level.short}</span>
            {/* intensity ticks: a ladder from whisper to shout */}
            <span aria-hidden className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-px">
              {Array.from({ length: i + 1 }, (_, t) => (
                <span key={t} className={cn("h-0.5 w-1 rounded-full", i <= index && level.id === value ? "bg-accent" : "bg-line-strong")} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">They see how eager you are once they reach this spot, never why.</p>
    </fieldset>
  );
}
