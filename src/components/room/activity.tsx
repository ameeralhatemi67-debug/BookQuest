import { BarChart3, BookOpenCheck, DoorOpen, Flag, Footprints, MessageCircle, PartyPopper, PenLine, Settings2, Sparkles, Stamp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn, timeAgo } from "@/lib/format";
import type { Activity } from "@/lib/types";

export interface ActivityPerson {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
}

const Name = ({ children }: { children: ReactNode }) => <span className="font-medium text-ink">{children}</span>;

/**
 * One line of room activity. Everything here is spoiler-free by construction:
 * the activity table never stores note content, only that something happened.
 */
export function describeActivity(activity: Activity, people: Map<string, ActivityPerson>, meId: string): { icon: ReactNode; text: ReactNode } | null {
  const actor = activity.actor_id ? people.get(activity.actor_id) : undefined;
  const isMe = activity.actor_id === meId;
  const who = <Name>{isMe ? "You" : (actor?.display_name ?? "Someone")}</Name>;
  const label = typeof activity.data.label === "string" && activity.data.label ? ` at ${activity.data.label}` : "";
  const icon = "size-3.5";

  switch (activity.type) {
    case "room_created":
      return { icon: <Sparkles className={icon} aria-hidden />, text: <>{who} opened this room.</> };
    case "joined":
      return { icon: <DoorOpen className={icon} aria-hidden />, text: <>{who} {activity.data.rejoined ? "came back" : "joined"}.</> };
    case "left":
      return { icon: <DoorOpen className={icon} aria-hidden />, text: <>{who} left the room.</> };
    case "removed":
      return { icon: <DoorOpen className={icon} aria-hidden />, text: <>{who} {isMe ? "are" : "is"} no longer in this room.</> };
    case "started_reading":
      return { icon: <Footprints className={icon} aria-hidden />, text: <>{who} started reading.</> };
    case "chapter_completed":
      return { icon: <Flag className={icon} aria-hidden />, text: <>{who} finished {String(activity.data.chapter ?? "a chapter")}.</> };
    case "milestone": {
      const percent = Number(activity.data.percent);
      const place = percent === 25 ? "a quarter of the way in" : percent === 50 ? "halfway through" : percent === 75 ? "three-quarters through" : `${percent}% through`;
      return { icon: <Flag className={icon} aria-hidden />, text: <>{who} {isMe ? "are" : "is"} {place}.</> };
    }
    case "finished":
      return { icon: <BookOpenCheck className={icon} aria-hidden />, text: <>{who} finished the book.</> };
    case "passed": {
      const passedId = String(activity.data.passed_user_id ?? "");
      const passed = passedId === meId ? "you" : (people.get(passedId)?.display_name ?? "someone");
      return { icon: <Zap className={icon} aria-hidden />, text: <>{who} passed <Name>{passed}</Name>.</> };
    }
    case "note_left":
      return { icon: <PenLine className={icon} aria-hidden />, text: <>{who} left something{label}.</> };
    case "replied":
      return { icon: <MessageCircle className={icon} aria-hidden />, text: <>{who} replied to a note{label}.</> };
    case "room_updated": {
      const changes = Array.isArray(activity.data.changes) ? (activity.data.changes as string[]) : [];
      if (changes.includes("is_closed")) return { icon: <Settings2 className={icon} aria-hidden />, text: <>{who} {activity.data.is_closed ? "closed the room to new members" : "re-opened the room to new members"}.</> };
      if (changes.includes("reopened")) return { icon: <Settings2 className={icon} aria-hidden />, text: <>{who} re-opened this room.</> };
      if (changes.includes("visibility")) {
        const now = activity.data.visibility;
        const what = now === "open" ? "made the room public" : now === "unlisted" ? "made the room unlisted" : "made the room private";
        return { icon: <Settings2 className={icon} aria-hidden />, text: <>{who} {what}.</> };
      }
      return { icon: <Settings2 className={icon} aria-hidden />, text: <>{who} updated the room.</> };
    }
    case "prediction_sealed":
      return { icon: <Stamp className={icon} aria-hidden />, text: <>{who} sealed a prediction{typeof activity.data.label === "string" ? ` that opens at ${activity.data.label}` : ""}.</> };
    case "poll_added":
      return { icon: <BarChart3 className={icon} aria-hidden />, text: <>{who} left a poll{label}.</> };
    case "ritual_started":
      return { icon: <Sparkles className={icon} aria-hidden />, text: <>{who} started a ritual: {String(activity.data.title ?? "")}</> };
    case "afterparty": {
      const count = Number(activity.data.count ?? 1);
      return { icon: <PartyPopper className={icon} aria-hidden />, text: count > 1 ? <>Everyone is through {count} more chapters. Their afterparties are open.</> : <>Everyone finished {String(activity.data.label ?? "a chapter")}. Its afterparty is open.</> };
    }
    case "room_archived":
      return { icon: <Settings2 className={icon} aria-hidden />, text: activity.data.by_admin ? <>This room was archived.</> : <>{who} archived this room.</> };
    default:
      return null;
  }
}

export function ActivityList({
  activities,
  people,
  meId,
  roomNames,
  className,
  empty = "Nothing yet. It gets livelier once people start reading.",
}: {
  activities: Activity[];
  people: Map<string, ActivityPerson>;
  meId: string;
  /** When listing across rooms (Home), show which room each line belongs to. */
  roomNames?: Map<string, string>;
  className?: string;
  empty?: string;
}) {
  const lines = activities
    .map((activity) => ({ activity, described: describeActivity(activity, people, meId) }))
    .filter((line): line is { activity: Activity; described: { icon: ReactNode; text: ReactNode } } => line.described !== null);

  if (lines.length === 0) return <p className="py-6 text-center text-sm text-ink-faint">{empty}</p>;

  return (
    <ol className={cn("space-y-0.5", className)}>
      {lines.map(({ activity, described }) => {
        const actor = activity.actor_id ? people.get(activity.actor_id) : undefined;
        return (
          <li key={activity.id} className="flex items-start gap-3 rounded-xl px-1 py-2">
            <span className="relative mt-0.5 shrink-0">
              {actor ? (
                <Avatar person={{ id: actor.user_id, display_name: actor.display_name, avatar_path: actor.avatar_path }} size={28} />
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-sunk text-ink-faint">{described.icon}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-ink-soft">{described.text}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {roomNames?.get(activity.room_id) ? `${roomNames.get(activity.room_id)} · ` : ""}
                {timeAgo(activity.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
