"use client";

import { ArrowLeft, BarChart3, Music2, Pause, Play, Quote, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { WaxSeal } from "@/components/reader/predictions";
import { Avatar, AvatarStack, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { cn, formatDate, plural } from "@/lib/format";
import { clamp01, formatPercent } from "@/lib/location";
import { getSupabase } from "@/lib/supabase/client";
import type { PredictionVerdict, Vault } from "@/lib/types";

const VERDICT_LABEL: Record<PredictionVerdict, string> = { called_it: "Called it", close: "Close", way_off: "Way off" };

// ---------------------------------------------------------------- the race, replayed
/**
 * Everyone's progress through time, as the rail they read on: avatars move
 * along the book while a clock runs from the first page anyone turned to the
 * last. Identity is the avatar itself, so nothing depends on telling colours apart.
 */
function RailReplay({ vault, personOf }: { vault: Vault; personOf: (id: string) => AvatarPerson }) {
  const { start, end, series } = useMemo(() => {
    const byUser = new Map<string, { at: number; furthest: number }[]>();
    for (const point of vault.timeline) {
      const list = byUser.get(point.user_id) ?? [];
      list.push({ at: new Date(point.at).getTime(), furthest: Number(point.furthest) });
      byUser.set(point.user_id, list);
    }
    const times = vault.timeline.map((p) => new Date(p.at).getTime());
    const first = times.length ? Math.min(...times) : 0;
    const last = times.length ? Math.max(...times) : 1;
    return { start: first, end: Math.max(last, first + 1), series: [...byUser.entries()].map(([id, points]) => ({ id, points: points.sort((a, b) => a.at - b.at) })) };
  }, [vault.timeline]);
  const [t, setT] = useState(1);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const began = performance.now();
    const from = t >= 1 ? 0 : t;
    const duration = 6000 * (1 - from);
    const tick = (now: number) => {
      const next = Math.min(1, from + ((now - began) / Math.max(1, duration)) * (1 - from));
      setT(next);
      if (next < 1) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // `t` is read once as the starting point of a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const now = start + (end - start) * t;
  const positions = series.map((s) => {
    let value = 0;
    for (const p of s.points) if (p.at <= now) value = p.furthest;
    return { id: s.id, value };
  }).sort((a, b) => a.value - b.value);

  return (
    <figure className="rounded-3xl border border-line bg-raised p-5 sm:p-7">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-2xl text-ink">How everyone moved through it</span>
        <span className="text-sm tabular-nums text-ink-soft">{formatDate(new Date(now).toISOString())}</span>
      </figcaption>
      <div className="relative mt-8 h-16" role="img" aria-label={`Reading progress on ${formatDate(new Date(now).toISOString())}: ${positions.map((p) => `${personOf(p.id).display_name} ${formatPercent(p.value)}`).join(", ")}`}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        <span className="absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 pr-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint max-sm:hidden">Start</span>
        <span className="absolute -right-1 top-1/2 translate-x-full -translate-y-1/2 pl-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint max-sm:hidden">End</span>
        {positions.map((p, index) => (
          <span key={p.id} className="absolute top-1/2 -translate-x-1/2 transition-[left] duration-200 ease-linear" style={{ left: `${clamp01(p.value) * 100}%`, translate: `0 calc(-50% + ${(index % 2 ? 1 : -1) * Math.min(index, 3) * 3}px)`, zIndex: index }}>
            <Avatar person={personOf(p.id)} size={34} ring className="shadow-soft" />
          </span>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!playing && t >= 1) setT(0);
            setPlaying(!playing);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-transform hover:bg-accent-hover active:scale-95"
          aria-label={playing ? "Pause the replay" : "Replay the reading"}
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
        </button>
        <input type="range" min={0} max={1} step={0.001} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-label="Point in time" aria-valuetext={formatDate(new Date(now).toISOString())} className="min-w-0 flex-1 accent-[var(--accent)]" />
      </div>
      <ul className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {vault.readers.map((r) => (
          <li key={r.user_id} className="flex items-center gap-2.5 text-sm">
            <Avatar person={personOf(r.user_id)} size={24} />
            <span className="min-w-0 flex-1 truncate text-ink">{r.display_name}</span>
            <span className="tabular-nums text-ink-soft">{r.completed_at ? `finished ${formatDate(r.completed_at)}` : formatPercent(r.furthest)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ---------------------------------------------------------------- chapters by conversation
function ChapterBars({ chapters }: { chapters: Vault["chapters"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...chapters.map((c) => c.notes + c.replies));
  const top = chapters.reduce<Vault["chapters"][number] | null>((best, c) => (!best || c.notes + c.replies > best.notes + best.replies ? c : best), null);
  const shown = hover !== null ? chapters.find((c) => c.index === hover) : top;
  if (!chapters.length || !top || top.notes + top.replies === 0) return null;
  return (
    <figure className="rounded-3xl border border-line bg-raised p-5 sm:p-7">
      <figcaption>
        <span className="block font-display text-2xl text-ink">The most talked-about chapter</span>
        <span className="mt-1 block text-sm text-ink-soft" aria-live="polite">
          {shown ? <><span className="text-ink">{shown.label}</span>: {plural(shown.notes, "note")}, {plural(shown.replies, "reply", "replies")}</> : null}
        </span>
      </figcaption>
      <div className="mt-6 flex h-36 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {chapters.map((c) => {
          const value = c.notes + c.replies;
          const isTop = c.index === top.index;
          return (
            <button
              key={c.index}
              type="button"
              onMouseEnter={() => setHover(c.index)}
              onFocus={() => setHover(c.index)}
              onBlur={() => setHover(null)}
              aria-label={`${c.label}: ${plural(c.notes, "note")}, ${plural(c.replies, "reply", "replies")}`}
              className="group flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className={cn("block w-full rounded-t-[4px] transition-[background-color,opacity] duration-150", isTop ? "bg-accent" : "bg-ink/20 group-hover:bg-ink/35", hover !== null && hover !== c.index && "opacity-60")}
                style={{ height: `${Math.max(value ? 4 : 1, (value / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-faint"><span>Beginning</span><span>End</span></div>
    </figure>
  );
}

// ---------------------------------------------------------------- pictures
function Pictures({ images }: { images: Vault["images"] }) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const byBucket = new Map<string, string[]>();
    for (const image of images) byBucket.set(image.bucket, [...(byBucket.get(image.bucket) ?? []), image.path]);
    void Promise.all([...byBucket.entries()].map(([bucket, paths]) => getSupabase().storage.from(bucket).createSignedUrls(paths, 3600))).then((results) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const result of results) for (const item of result.data ?? []) if (item.path && item.signedUrl) next.set(item.path, item.signedUrl);
      setUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [images]);
  if (!images.length) return null;
  return (
    <section aria-labelledby="pictures-heading">
      <h2 id="pictures-heading" className="font-display text-2xl text-ink">Drawings and pictures</h2>
      <ul className="mt-4 columns-2 gap-3 sm:columns-3 [&>li]:mb-3 [&>li]:break-inside-avoid">
        {images.map((image, i) => (
          <li key={image.id} className="overflow-hidden rounded-2xl bg-sunk" style={{ rotate: `${((i % 3) - 1) * 0.6}deg` }}>
            {urls.get(image.path) ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs
              <img src={urls.get(image.path)} alt={image.label ? `Left at ${image.label}` : "A picture from the book"} width={image.width ?? undefined} height={image.height ?? undefined} className="block h-auto w-full" loading="lazy" />
            ) : (
              <div className="skeleton aspect-[4/3] w-full" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MomentQuote({ title, note, personOf, large }: { title: string; note: NonNullable<Vault["first_note"]>; personOf: (id: string) => AvatarPerson; large?: boolean }) {
  const author = personOf(note.author_id);
  const text = note.body || note.emoji || note.quote || "";
  return (
    <figure className={cn("flex h-full flex-col rounded-3xl p-5 sm:p-7", large ? "bg-accent-soft/55" : "border border-line bg-raised")}>
      <p className="flex items-center gap-1.5 text-sm text-ink-soft"><Quote className="size-4" aria-hidden />{title}</p>
      <blockquote className={cn("mt-3 flex-1 whitespace-pre-wrap break-words font-display leading-snug text-ink", large ? "text-3xl sm:text-4xl" : "text-xl")}>
        {text.length > 280 ? `${text.slice(0, 280)}…` : text}
      </blockquote>
      <figcaption className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
        <Avatar person={author} size={26} />
        {author.display_name}
        {note.label ? <span className="text-ink-faint">· {note.label}</span> : null}
        {note.reactions !== undefined ? <span className="ml-auto text-xs text-ink-faint">{plural(note.reactions, "reaction")} · {plural(note.replies ?? 0, "reply", "replies")}</span> : null}
        {note.laughs !== undefined ? <span className="ml-auto text-xs text-ink-faint">😂 ×{note.laughs}</span> : null}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- the vault
export function VaultView({ vault }: { vault: Vault }) {
  const people = useMemo(() => new Map(vault.readers.map((r) => [r.user_id, { id: r.user_id, display_name: r.display_name, avatar_path: r.avatar_path }])), [vault.readers]);
  const personOf = (id: string): AvatarPerson => people.get(id) ?? { id, display_name: "A former member", avatar_path: null };
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setOpened(true), reduce ? 0 : 1050);
    return () => clearTimeout(timer);
  }, []);
  const rating = vault.ratings.length ? vault.ratings.reduce((sum, r) => sum + r.stars, 0) / vault.ratings.length : null;
  let section = 0;
  const rise = () => ({ "--i": section++ }) as React.CSSProperties;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/rooms/${vault.room.id}`} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {vault.room.name}
      </Link>

      {/* the door */}
      <header className="relative mt-6 overflow-hidden rounded-[2rem] bg-ink px-6 py-10 text-paper sm:px-12 sm:py-14">
        <div className="relative z-10 flex flex-col items-center gap-8 sm:flex-row sm:items-end">
          <BookCover book={vault.book} width={120} className="shrink-0 rotate-[-2deg] shadow-lift" />
          <div className="text-center sm:text-left">
            <h1 className="font-display text-4xl leading-tight sm:text-6xl">The vault</h1>
            <p className="mt-2 text-lg text-paper/75">
              <span className="font-display italic">{vault.book.title}</span>, read together in {vault.room.name}
            </p>
            <div className="mt-4 flex items-center justify-center gap-3 sm:justify-start">
              <AvatarStack people={vault.readers.map((r) => personOf(r.user_id))} size={30} max={8} />
              <span className="text-sm text-paper/70">{plural(vault.totals.notes, "note")} · {plural(vault.totals.predictions, "prediction")} · {plural(vault.totals.songs, "song")}</span>
            </div>
          </div>
        </div>
        {!opened && (
          <div className="vault-door absolute inset-0 z-20 grid place-items-center bg-ink" aria-hidden>
            <div className="relative grid size-56 place-items-center rounded-full border-[10px] border-paper/15">
              <div className="grid size-40 place-items-center rounded-full border-4 border-paper/20">
                <WaxSeal className="scale-150" />
              </div>
              {vault.readers.slice(0, 12).map((r, i, all) => {
                const angle = (i / all.length) * Math.PI * 2 - Math.PI / 2;
                return (
                  <span key={r.user_id} className="absolute" style={{ left: `calc(50% + ${Math.cos(angle) * 112}px - 14px)`, top: `calc(50% + ${Math.sin(angle) * 112}px - 14px)` }}>
                    <Avatar person={personOf(r.user_id)} size={28} ring />
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </header>

      <div className="vault-rise mt-10 space-y-12">
        <div style={rise()}>
          <RailReplay vault={vault} personOf={personOf} />
        </div>

        {vault.predictions.length > 0 && (
          <section aria-labelledby="predictions-heading" style={rise()}>
            <h2 id="predictions-heading" className="font-display text-3xl text-ink">Every prediction, opened</h2>
            <p className="mt-1 text-sm text-ink-soft">What everyone guessed, and when they guessed it.</p>
            <ul className="mt-5 columns-1 gap-4 sm:columns-2 [&>li]:mb-4 [&>li]:break-inside-avoid">
              {vault.predictions.map((p) => {
                const tally = Object.entries(p.verdicts ?? {}) as [PredictionVerdict, number][];
                const verdict = tally.sort((a, b) => b[1] - a[1])[0];
                return (
                  <li key={p.id} className={cn("rounded-2xl border p-4", verdict?.[0] === "called_it" ? "border-gold/60 bg-gold-soft/40" : "border-line bg-raised")}>
                    <div className="flex items-center gap-2.5">
                      <WaxSeal size="sm" hue={personHue(p.author_id)} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{personOf(p.author_id).display_name}</span>
                      {verdict && <span className="text-xs font-medium text-ink-soft">{VERDICT_LABEL[verdict[0]]} · {verdict[1]}</span>}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words font-display text-lg italic leading-snug text-ink">“{p.body}”</p>
                    <p className="mt-2 text-xs text-ink-faint">Sealed at {p.made_label ?? formatPercent(p.made_at)}, opened at {p.opens_label ?? "the end"}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {(vault.first_note || vault.most_reacted || vault.funniest) && (
          <section aria-label="Moments" className="grid gap-4 lg:grid-cols-5" style={rise()}>
            {vault.first_note && <div className="lg:col-span-3"><MomentQuote title="The first thing anyone left" note={vault.first_note} personOf={personOf} large /></div>}
            <div className="grid grid-cols-1 gap-4 lg:col-span-2">
              {vault.most_reacted && <MomentQuote title="The moment everyone reacted to" note={vault.most_reacted} personOf={personOf} />}
              {vault.funniest && vault.funniest.marker_id !== vault.most_reacted?.marker_id && <MomentQuote title="The one that made you laugh" note={vault.funniest} personOf={personOf} />}
            </div>
          </section>
        )}

        {vault.ratings.length > 0 && (
          <section aria-labelledby="ratings-heading" className="grid gap-6 rounded-3xl bg-sunk/70 p-5 sm:grid-cols-[auto_1fr] sm:p-7" style={rise()}>
            <div>
              <h2 id="ratings-heading" className="font-display text-2xl text-ink">Final ratings</h2>
              <p className="mt-2 font-display text-6xl leading-none text-ink tabular-nums">{rating?.toFixed(1)}</p>
              <p className="mt-1 text-sm text-ink-soft">from {plural(vault.ratings.length, "reader")}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {vault.ratings.map((r) => (
                <li key={r.user_id} className="flex gap-3">
                  <Avatar person={personOf(r.user_id)} size={32} />
                  <div className="min-w-0">
                    <p className="flex gap-0.5" aria-label={`${r.stars} out of 5`}>
                      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn("size-4", n <= r.stars ? "fill-gold text-gold" : "text-line-strong")} aria-hidden />)}
                    </p>
                    {r.line && <p className="mt-1 text-sm leading-snug text-ink">{r.line}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2" style={rise()}>
          <ChapterBars chapters={vault.chapters} />
          {vault.soundtrack.length > 0 && (
            <section aria-labelledby="soundtrack-heading" className="rounded-3xl border border-line bg-raised p-5 sm:p-7">
              <h2 id="soundtrack-heading" className="flex items-center gap-2 font-display text-2xl text-ink"><Music2 className="size-5 text-accent" aria-hidden />The soundtrack</h2>
              <p className="mt-1 text-sm text-ink-soft">In the order the book played it.</p>
              <ol className="mt-4 space-y-2.5">
                {vault.soundtrack.map((track, i) => (
                  <li key={track.id} className="flex items-baseline gap-3">
                    <span className="w-5 shrink-0 text-right text-sm tabular-nums text-ink-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{track.title}</span>
                      <span className="block truncate text-xs text-ink-faint">{personOf(track.author_id).display_name.split(" ")[0]}{track.label ? ` · ${track.label}` : track.starts_at === null ? " · throughout" : ""}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {vault.polls.length > 0 && (
          <section aria-labelledby="polls-heading" style={rise()}>
            <h2 id="polls-heading" className="flex items-center gap-2 font-display text-3xl text-ink"><BarChart3 className="size-6 text-accent" aria-hidden />The polls, in hindsight</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {vault.polls.map((poll) => {
                const total = poll.results.length;
                return (
                  <figure key={poll.id} className="rounded-2xl border border-line bg-raised p-4">
                    <figcaption className="font-display text-lg leading-snug text-ink">{poll.question}</figcaption>
                    <p className="text-xs text-ink-faint">{poll.label ?? formatPercent(poll.position)} · {plural(total, "vote")}</p>
                    <ul className="mt-3 space-y-2.5">
                      {poll.options.map((option, index) => {
                        const voters = poll.results.filter((r) => r.option === index);
                        const share = total ? voters.length / total : 0;
                        return (
                          <li key={index}>
                            <div className="flex items-baseline justify-between gap-2 text-sm"><span className="text-ink">{option}</span><span className="tabular-nums text-ink-soft">{Math.round(share * 100)}%</span></div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-2 flex-1"><div className="poll-bar h-full rounded-[4px] bg-ink/25" style={{ width: `${share * 100}%`, "--i": index } as React.CSSProperties} /></div>
                              {voters.length > 0 && <AvatarStack people={voters.map((v) => personOf(v.user_id))} size={20} max={4} />}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        <div style={rise()}>
          <Pictures images={vault.images} />
        </div>

        <p className="pb-6 text-center text-sm text-ink-faint" style={rise()}>
          {plural(vault.totals.notes, "note")}, {plural(vault.totals.replies, "reply", "replies")} and {plural(vault.totals.reactions, "reaction")}, kept here for as long as the room exists.
        </p>
      </div>
    </div>
  );
}
