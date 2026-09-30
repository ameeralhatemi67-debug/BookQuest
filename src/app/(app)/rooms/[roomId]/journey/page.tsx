import { ArrowLeft, BookOpenCheck, Camera, Clock, Film, Heart, KeyRound, MessageCircle, Mic, PenLine, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BookCover } from "@/components/book-cover";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, Meter, SectionHeading } from "@/components/ui/misc";
import { daysBetween, formatDate, formatDuration, plural, timeAgo } from "@/lib/format";
import { formatPercent, isComplete } from "@/lib/location";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Journey, JourneyMoment, JourneyReader, NoteContent } from "@/lib/types";

export const metadata: Metadata = { title: "Journey" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Stat({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-raised px-4 py-3.5">
      <div className="flex items-center gap-2 text-ink-faint">{icon}</div>
      <div className="mt-1.5 font-display text-3xl leading-none text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-soft">{label}</div>
    </div>
  );
}

function excerpt(moment: JourneyMoment, content: NoteContent | undefined): string {
  const body = content?.body?.trim();
  if (body) return body.length > 220 ? `${body.slice(0, 220)}…` : body;
  if (content?.emoji) return content.emoji;
  if (moment.media.length > 0) return moment.media.map((kind) => (kind === "image" ? "a photo" : kind === "audio" ? "a voice note" : "a video")).join(" and ");
  if (content?.link_url) return content.link_url;
  return "a note";
}

export default async function JourneyPage({ params }: { params: Promise<{ roomId: string }> }) {
  const me = await requireAlpha();
  const { roomId } = await params;
  if (!UUID.test(roomId)) redirect("/home");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("room_journey", { p_room_id: roomId });
  if (error || !data) redirect(`/rooms/${roomId}`);
  const journey = data as Journey;

  // Text for the moments the viewer may read. RLS returns nothing for the rest.
  const momentIds = journey.moments.map((m) => m.marker_id).slice(0, 200);
  const contents = new Map<string, NoteContent>();
  if (momentIds.length > 0) {
    const { data: rows } = await supabase.from("annotation_contents").select("marker_id, body, emoji, link_url, quote, edited_at").in("marker_id", momentIds);
    for (const row of (rows ?? []) as NoteContent[]) contents.set(row.marker_id, row);
  }

  const readers = new Map(journey.readers.map((r) => [r.user_id, r]));
  const person = (id: string) => {
    const reader = readers.get(id);
    return { id, display_name: reader?.display_name ?? "A former member", avatar_path: reader?.avatar_path ?? null };
  };
  const firstName = (id: string) => (id === me.user_id ? "You" : person(id).display_name.split(" ")[0]);

  const active = journey.readers.filter((r) => r.status === "active");
  const finishers = journey.readers.filter((r) => r.completed_at).sort((a, b) => new Date(a.completed_at!).getTime() - new Date(b.completed_at!).getTime());
  const everyoneDone = active.length > 0 && active.every((r) => isComplete(r.furthest));
  const viewerDone = isComplete(journey.viewer_furthest);
  const started = journey.first_started_at;
  const ended = everyoneDone && finishers.length > 0 ? finishers[finishers.length - 1].completed_at! : (journey.last_read_at ?? new Date().toISOString());
  const days = started ? Math.max(1, daysBetween(started, ended) + 1) : 0;
  const hidden = journey.totals.notes - journey.moments.length;

  // Highlights picked from real data.
  const firstNote = [...journey.moments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const mostDiscussed = [...journey.moments].filter((m) => m.replies > 0).sort((a, b) => b.replies - a.replies)[0];
  const busiest = [...journey.sections].sort((a, b) => b.notes + b.replies - (a.notes + a.replies))[0];
  const maxSection = Math.max(1, ...journey.sections.map((s) => s.notes + s.replies));
  const discoveriesByMarker = new Map<string, typeof journey.discoveries>();
  for (const discovery of journey.discoveries) discoveriesByMarker.set(discovery.marker_id, [...(discoveriesByMarker.get(discovery.marker_id) ?? []), discovery]);

  // Group the moments by where they happened, in book order.
  const chapters: { label: string; moments: JourneyMoment[] }[] = [];
  for (const moment of journey.moments) {
    const label = moment.label ?? `${Math.round(moment.position * 100)}% in`;
    const last = chapters[chapters.length - 1];
    if (last && last.label === label) last.moments.push(moment);
    else chapters.push({ label, moments: [moment] });
  }

  const readerLine = (reader: JourneyReader) => {
    const parts: string[] = [];
    if (reader.notes) parts.push(plural(reader.notes, "note"));
    if (reader.replies) parts.push(plural(reader.replies, "reply", "replies"));
    if (reader.discoveries) parts.push(plural(reader.discoveries, "discovery", "discoveries"));
    if (reader.reading_seconds >= 60) parts.push(`${formatDuration(reader.reading_seconds)} reading`);
    return parts.join(" · ") || "Just getting started";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <Link href={`/rooms/${roomId}`} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {journey.room.name}
      </Link>

      {/* ------------------------------------------------------------ title page */}
      <header className="flex animate-fade-up flex-col items-center text-center">
        <BookCover book={journey.book} width={140} priority />
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-accent-ink">{everyoneDone ? "The journey" : "The journey so far"}</p>
        <h1 className="mt-2 text-4xl leading-tight text-ink sm:text-5xl">
          {active.length === 1 ? "Your" : "Our"} journey through <em>{journey.book.title}</em>
        </h1>
        <p className="mt-3 text-ink-soft">
          {started ? (
            <>
              <span className="font-medium text-ink">{plural(days, "day")}</span> {active.length > 1 ? "reading together" : "of reading"} · since {formatDate(started)}
            </>
          ) : (
            "Nobody has started reading yet. This page fills in as you go."
          )}
        </p>
      </header>

      {/* ------------------------------------------------------------ readers */}
      <section aria-labelledby="readers-heading">
        <SectionHeading id="readers-heading" title="The readers" hint={finishers.length > 0 ? `${firstName(finishers[0].user_id)} finished first${finishers[0].completed_at ? `, on ${formatDate(finishers[0].completed_at)}` : ""}.` : undefined} />
        <Card className="divide-y divide-line px-5">
          {journey.readers.map((reader) => {
            const done = isComplete(reader.furthest);
            const place = finishers.findIndex((f) => f.user_id === reader.user_id);
            return (
              <div key={reader.user_id} className="py-4">
                <div className="flex items-center gap-3">
                  <Avatar person={person(reader.user_id)} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {reader.display_name}
                        {reader.user_id === me.user_id && <span className="ml-1 font-normal text-ink-faint">(you)</span>}
                      </span>
                      {done && (
                        <Badge tone="moss">
                          <BookOpenCheck className="size-3" aria-hidden />
                          {place === 0 ? "First to finish" : "Finished"}
                        </Badge>
                      )}
                      {reader.status !== "active" && <Badge>Left the room</Badge>}
                    </div>
                    <p className="truncate text-xs text-ink-soft">{readerLine(reader)}</p>
                  </div>
                  <span className="text-sm tabular-nums text-ink-soft">{formatPercent(reader.furthest)}</span>
                </div>
                <Meter value={reader.furthest} label={`${reader.display_name}'s progress`} tone={done ? "moss" : "accent"} className="mt-3" />
              </div>
            );
          })}
        </Card>
      </section>

      {/* ------------------------------------------------------------ numbers */}
      <section aria-labelledby="numbers-heading">
        <SectionHeading id="numbers-heading" title="In numbers" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<PenLine className="size-4" aria-hidden />} value={journey.totals.notes} label="things left in the book" />
          <Stat icon={<MessageCircle className="size-4" aria-hidden />} value={journey.totals.replies} label="replies" />
          <Stat icon={<Heart className="size-4" aria-hidden />} value={journey.totals.reactions} label="reactions" />
          <Stat icon={<KeyRound className="size-4" aria-hidden />} value={journey.totals.discoveries} label="discoveries" />
          <Stat icon={<Camera className="size-4" aria-hidden />} value={journey.totals.images} label="photos" />
          <Stat icon={<Mic className="size-4" aria-hidden />} value={journey.totals.audio} label="voice notes" />
          <Stat icon={<Film className="size-4" aria-hidden />} value={journey.totals.video} label="videos" />
          <Stat icon={<Clock className="size-4" aria-hidden />} value={journey.totals.reading_seconds >= 60 ? formatDuration(journey.totals.reading_seconds) : "—"} label="spent reading" />
        </div>
      </section>

      {/* ------------------------------------------------------------ where the conversation happened */}
      {journey.sections.length > 0 && (
        <section aria-labelledby="sections-heading">
          <SectionHeading
            id="sections-heading"
            title="Where the conversation happened"
            hint={busiest ? `The busiest stretch was around ${busiest.label ?? `${busiest.bucket * 5}%`}.` : undefined}
          />
          <Card className="p-5">
            <div className="flex h-28 items-end gap-1" role="img" aria-label="Notes and replies across the book">
              {Array.from({ length: 20 }, (_, bucket) => {
                const section = journey.sections.find((s) => s.bucket === bucket);
                const amount = section ? section.notes + section.replies : 0;
                const reached = bucket / 20 < journey.viewer_furthest || viewerDone;
                return (
                  <div key={bucket} className="flex h-full flex-1 flex-col justify-end" title={section ? `${section.label ?? `${bucket * 5}%`}: ${plural(section.notes, "note")}, ${plural(section.replies, "reply", "replies")}` : undefined}>
                    <div
                      className={amount > 0 ? "rounded-t-md bg-accent/70" : reached ? "rounded-t-sm bg-line" : "rounded-t-sm bg-line/40"}
                      style={{ height: amount > 0 ? `${Math.max(12, (amount / maxSection) * 100)}%` : 3 }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              <span>Start</span>
              <span>End</span>
            </div>
            {!viewerDone && <p className="mt-3 text-xs text-ink-faint">Only the part of the book you&apos;ve read is shown, so nothing ahead is given away.</p>}
          </Card>
        </section>
      )}

      {/* ------------------------------------------------------------ through the book */}
      <section aria-labelledby="timeline-heading">
        <SectionHeading id="timeline-heading" title="Through the book" hint="What was left along the way, in the order the story tells it." />
        {chapters.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong px-6 py-10 text-center text-sm leading-relaxed text-ink-soft">
            {journey.totals.notes === 0 ? "Nothing has been left in this book yet. Select a passage while reading to leave the first thing." : "There are things waiting further on. They appear here as you reach them."}
          </p>
        ) : (
          <ol className="relative space-y-8 border-l border-line pl-6">
            {chapters.map((chapter) => (
              <li key={`${chapter.label}-${chapter.moments[0].marker_id}`} className="relative">
                <span className="absolute -left-[29px] top-1.5 size-2.5 rounded-full bg-accent ring-4 ring-paper" aria-hidden />
                <h3 className="font-display text-xl text-ink">{chapter.label}</h3>
                <ul className="mt-3 space-y-3">
                  {chapter.moments.map((moment) => {
                    const content = contents.get(moment.marker_id);
                    const found = discoveriesByMarker.get(moment.marker_id) ?? [];
                    return (
                      <li key={moment.marker_id} className="rounded-2xl border border-line bg-raised p-4">
                        <div className="flex items-start gap-3">
                          <Avatar person={person(moment.author_id)} size={30} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-ink-faint">
                              <span className="font-medium text-ink-soft">{firstName(moment.author_id)}</span> left this {timeAgo(moment.created_at)}
                              {firstNote?.marker_id === moment.marker_id && journey.moments.length > 1 && (
                                <Badge tone="gold" className="ml-2">
                                  <Sparkles className="size-3" aria-hidden />
                                  The first note
                                </Badge>
                              )}
                              {mostDiscussed?.marker_id === moment.marker_id && mostDiscussed.replies > 1 && (
                                <Badge tone="accent" className="ml-2">
                                  Most discussed
                                </Badge>
                              )}
                            </p>
                            {content?.quote && <p className="mt-1.5 border-l-2 border-line-strong pl-2.5 font-display text-sm italic leading-relaxed text-ink-faint">“{content.quote.length > 160 ? `${content.quote.slice(0, 160)}…` : content.quote}”</p>}
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{excerpt(moment, content)}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                              {moment.replies > 0 && <span>{plural(moment.replies, "reply", "replies")}</span>}
                              {moment.reactions > 0 && <span>{plural(moment.reactions, "reaction")}</span>}
                              {moment.media.includes("image") && content?.body && <span>with a photo</span>}
                              {moment.media.includes("audio") && content?.body && <span>with a voice note</span>}
                              {moment.media.includes("video") && content?.body && <span>with a video</span>}
                              <Link href={`/read/${roomId}?note=${moment.marker_id}`} className="font-medium text-accent-ink underline-offset-4 hover:underline">
                                Open in the book
                              </Link>
                            </div>
                            {found.map((discovery) => {
                              const wait = daysBetween(discovery.left_at, discovery.discovered_at);
                              return (
                                <p key={discovery.reader_id} className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
                                  <KeyRound className="size-3 text-gold" aria-hidden />
                                  {firstName(discovery.reader_id)} discovered it {wait >= 1 ? `${plural(wait, "day")} after it was left` : "the same day"}.
                                </p>
                              );
                            })}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {hidden > 0 && chapters.length > 0 && (
          <p className="mt-6 rounded-2xl border border-accent/25 bg-accent-soft/50 px-4 py-3 text-sm text-ink-soft">
            {plural(hidden, "more thing")} {hidden === 1 ? "is" : "are"} waiting further on in the book. {hidden === 1 ? "It appears" : "They appear"} here once you reach {hidden === 1 ? "it" : "them"}.
          </p>
        )}
      </section>

      <div className="flex justify-center">
        <ButtonLink href={`/read/${roomId}`} variant="secondary">
          {viewerDone ? "Open the book again" : "Back to the book"}
        </ButtonLink>
      </div>
    </div>
  );
}
