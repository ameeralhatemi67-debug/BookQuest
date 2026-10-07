// "While you were away": a few sentences about what friends did, in place of a
// pile of notifications. Pure rendering, so Home (server) and the reader
// (client) tell the same story.
import type { ReactNode } from "react";
import { Avatar, type AvatarPerson } from "@/components/ui/avatar";
import { chaptersCrossed, type Chapter } from "@/lib/chapters";
import type { AwaySummary } from "@/lib/types";

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface AwayLine {
  userId: string | null;
  text: string;
}

/** Sentences, most-moved friend first. Empty when nothing worth saying happened. */
export function awayLines(summary: AwaySummary | null, personOf: (id: string) => AvatarPerson, chapters: Chapter[]): AwayLine[] {
  if (!summary) return [];
  const lines: AwayLine[] = [];
  for (const m of summary.members) {
    const name = personOf(m.user_id).display_name.split(" ")[0];
    const parts: string[] = [];
    const crossed = chaptersCrossed(chapters, Number(m.from), Number(m.to));
    const moved = Number(m.to) - Number(m.from);
    if (m.finished) parts.push("finished the book");
    else if (crossed >= 1) parts.push(`read ${crossed === 1 ? "a chapter" : `${crossed} chapters`}`);
    else if (moved >= 0.01) parts.push(`read ${Math.round(moved * 100)}% more`);
    if (Number(m.from) <= summary.me && Number(m.to) > summary.me && summary.me > 0) parts.push("passed you");
    if (m.packages > 0) parts.push(`wrapped ${m.packages === 1 ? "a package" : `${m.packages} packages`} for you`);
    const notes = m.left_ahead - m.packages;
    if (notes > 0) parts.push(`left ${notes === 1 ? "something" : `${notes} things`} ahead`);
    if (m.predictions > 0) parts.push(`sealed ${m.predictions === 1 ? "a prediction" : `${m.predictions} predictions`}`);
    if (m.replies > 0) parts.push(`replied to your note${m.reply_label ? ` in ${m.reply_label}` : ""}`);
    if (parts.length) lines.push({ userId: m.user_id, text: `${name} ${list(parts)}.` });
  }
  const parties = summary.afterparties;
  if (parties.length === 1) lines.push({ userId: null, text: `The ${parties[0].label ?? "chapter"} afterparty opened.` });
  else if (parties.length > 1) lines.push({ userId: null, text: `${parties.length} chapter afterparties opened, up to ${parties[parties.length - 1].label ?? "the latest chapter"}.` });
  return lines;
}

export function AwayStory({ lines, personOf, compact = false }: { lines: AwayLine[]; personOf: (id: string) => AvatarPerson; compact?: boolean }): ReactNode {
  if (!lines.length) return null;
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2.5"}>
      {lines.map((line, index) => (
        <li key={index} className="flex items-start gap-2.5">
          {line.userId ? <Avatar person={personOf(line.userId)} size={compact ? 22 : 26} className="mt-px" /> : <span className={compact ? "size-[22px]" : "size-[26px]"} aria-hidden />}
          <span className={compact ? "text-sm leading-snug text-ink-soft" : "text-[15px] leading-snug text-ink"}>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}
