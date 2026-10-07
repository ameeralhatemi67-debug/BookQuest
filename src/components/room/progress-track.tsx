"use client";

// The shared progress track — everyone in the room, placed along the book.
//
//   START ━━━ Amir ━━━ Sara ━━━━━ Fahad ━━━ END
//
// Avatars glide when someone makes progress, stack when they would overlap
// (fanning out on hover / focus, listing everyone on tap), and the little
// marks under the line are things people have left along the way.
import { Check, Eye } from "lucide-react";
import { GiftBox } from "@/components/reader/package";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, personHue } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { cn, timeAgo } from "@/lib/format";
import { clamp01, formatPercent } from "@/lib/location";
import { layoutTrack, type TrackCluster } from "@/lib/progress-track";
import type { RoomMode } from "@/lib/room-modes";
import type { RoomMember } from "@/lib/types";

export interface TrackMarker {
  id: string;
  position: number;
  authorId: string;
  /** Can the viewer open it (their own, or already reached)? */
  open: boolean;
  /** What kind of thing it is. Ahead of the viewer only packages addressed to them say so. */
  kind?: "note" | "package" | "prediction" | "poll" | "cue";
}

/** One mark on the rail. Shape says what it is; colour says who; hollow means still ahead. */
function RailMark({ marker }: { marker: TrackMarker }) {
  const hue = personHue(marker.authorId);
  const ink = `oklch(0.62 0.12 ${hue})`;
  if (marker.kind === "package") return <GiftBox hue={hue} size={11} wiggle={!marker.open} />;
  const shape = marker.open && marker.kind === "prediction" ? "rotate-45 rounded-[1.5px]" : marker.open && (marker.kind === "poll") ? "rounded-[1.5px]" : "rounded-full";
  return (
    <span
      className={cn("block size-1.5 animate-marker-in", shape)}
      style={marker.open ? { background: ink } : { boxShadow: `inset 0 0 0 1.5px oklch(0.62 0.1 ${hue})` }}
    />
  );
}

interface TrackMember extends RoomMember {
  id: string;
  progress: number;
}

function useElementLength<T extends HTMLElement>(vertical: boolean): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(vertical ? entry.contentRect.height : entry.contentRect.width));
    observer.observe(element);
    setWidth(vertical ? element.getBoundingClientRect().height : element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [vertical]);
  return [ref, width];
}

function describe(member: RoomMember, mode: RoomMode, isMe: boolean, live: boolean): string {
  const parts = [isMe ? `${member.display_name} (you)` : member.display_name];
  if (Boolean(member.completed_at)) parts.push("finished the book");
  else if (member.furthest <= 0) parts.push("hasn't started yet");
  else {
    if (mode.progress.showPercent) parts.push(`${formatPercent(member.furthest)} through`);
    if (member.label) parts.push(member.label);
  }
  if (live) parts.push("reading now");
  return parts.join(", ");
}

function ReaderLine({ member, mode, isMe, live, onLens, lensed }: { member: RoomMember; mode: RoomMode; isMe: boolean; live: boolean; onLens?: (id: string | null) => void; lensed?: boolean }) {
  const finished = Boolean(member.completed_at);
  return (
    <li className="flex items-center gap-3 py-1.5">
      <Avatar person={{ id: member.user_id, display_name: member.display_name, avatar_path: member.avatar_path }} size={32} live={live} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">
          {member.display_name}
          {isMe && <span className="ml-1 font-normal text-ink-faint">(you)</span>}
        </div>
        <div className="truncate text-xs text-ink-soft">
          {finished ? "Finished the book" : member.furthest <= 0 ? "Hasn't started yet" : (member.label ?? "Reading")}
          {live ? " · reading now" : member.last_read_at && member.furthest > 0 ? ` · ${timeAgo(member.last_read_at)}` : ""}
        </div>
      </div>
      {finished ? (
        <Check className="size-4 text-moss" aria-label="Finished" />
      ) : (
        mode.progress.showPercent && member.furthest > 0 && <span className="flex flex-col items-end text-sm tabular-nums text-ink-soft">
          <span>{formatPercent(member.position)}</span><span className="text-[10px]">{formatPercent(member.read_coverage ?? 0)} read</span>
        </span>
      )}
      {onLens && (
        <button
          type="button"
          onClick={() => onLens(lensed ? null : member.user_id)}
          aria-pressed={lensed}
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-full transition-colors", lensed ? "bg-ink text-paper" : "text-ink-faint hover:bg-sunk hover:text-ink")}
          aria-label={lensed ? "Show everyone again" : isMe ? "Show only your trail" : `See the book through ${member.display_name.split(" ")[0]}'s trail`}
        >
          <Eye className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function Cluster({
  cluster,
  meId,
  mode,
  liveIds,
  avatarSize,
  vertical,
  railLength,
  lens,
  onLens,
  knocks,
}: {
  cluster: TrackCluster<TrackMember>;
  meId: string;
  mode: RoomMode;
  liveIds: Set<string>;
  avatarSize: number;
  vertical: boolean;
  railLength: number;
  lens?: string | null;
  onLens?: (id: string | null) => void;
  knocks?: Map<string, number>;
}) {
  // Draw the viewer last so they sit on top of a stack; cap what is drawn.
  const ordered = [...cluster.readers].sort((a, b) => Number(a.id === meId) - Number(b.id === meId));
  const visible = ordered.slice(-4);
  const hidden = ordered.length - visible.length;
  const label =
    cluster.readers.length === 1
      ? describe(cluster.readers[0], mode, cluster.readers[0].id === meId, liveIds.has(cluster.readers[0].id))
      : `${cluster.readers.length} readers here: ${cluster.readers.map((r) => `${r.display_name}${liveIds.has(r.id) ? " (reading now)" : ""}`).join(", ")}`;

  return (
    <div
      role="listitem"
      className={cn("absolute -translate-x-1/2 -translate-y-1/2 duration-700 ease-out", vertical ? "left-1/2 transition-[top,opacity]" : "top-1/2 transition-[left,opacity]", lens && !cluster.readers.some((r) => r.id === lens) && "opacity-30")}
      style={vertical ? { top: `${clamp01(cluster.center) * 100}%` } : { left: `${clamp01(cluster.center) * 100}%` }}
    >
      <Popover>
        <PopoverTrigger
          aria-label={label}
          className={cn("group/cluster flex items-center rounded-full p-1 focus-visible:outline-offset-0", vertical && "flex-col")}
          // Generous touch target even for a single small avatar.
          style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
        >
          {hidden > 0 && (
            <span
              className="z-0 inline-flex items-center justify-center rounded-full bg-sunk text-[10px] font-semibold text-ink-soft ring-2 ring-paper"
              style={{ width: avatarSize, height: avatarSize }}
            >
              +{hidden}
            </span>
          )}
          {visible.map((member, index) => {
            const isMe = member.id === meId;
            return (
              <span
                key={member.id}
                style={{ "--reader-hue": personHue(member.user_id), "--reader-y": `${(member.progress - cluster.center) * railLength - (index - (visible.length - 1) / 2) * (avatarSize - 12)}px` } as React.CSSProperties}
                className={cn(
                  "relative rounded-full transition-[margin] duration-300 ease-out",
                  vertical && "progress-avatar-drop",
                  // Overlap when stacked; fan out on hover / keyboard focus.
                  (index > 0 || hidden > 0) && (vertical ? "-mt-5 group-hover/cluster:-mt-3 group-focus-visible/cluster:-mt-3" : "-ml-3 group-hover/cluster:-ml-0.5 group-focus-visible/cluster:-ml-0.5"),
                  isMe && "z-10",
                )}
              >
                <span key={knocks?.get(member.id) ?? 0} className={cn("progress-avatar-figure relative inline-flex", knocks?.has(member.id) && "knock-shake")}>
                {knocks?.has(member.id) && <><span className="knock-ripple" aria-hidden /><span className="knock-ripple" aria-hidden /></>}
                <Avatar
                  person={{ id: member.user_id, display_name: member.display_name, avatar_path: member.avatar_path }}
                  size={avatarSize}
                  ring
                  live={liveIds.has(member.id)}
                  className={cn("shadow-soft", isMe && "rounded-full outline outline-2 outline-offset-2 outline-accent")}
                />
                </span>
              </span>
            );
          })}
        </PopoverTrigger>
        <PopoverContent side={vertical ? "right" : "top"} className="w-72 p-3">
          <ul>
            {[...cluster.readers].reverse().map((member) => (
              <ReaderLine key={member.id} member={member} mode={mode} isMe={member.id === meId} live={liveIds.has(member.id)} onLens={onLens} lensed={lens === member.id} />
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ProgressTrack({
  members,
  meId,
  mode,
  markers = [],
  liveIds,
  size = "lg",
  orientation = "horizontal",
  className,
  lens,
  onLens,
  knocks,
}: {
  members: RoomMember[];
  meId: string;
  mode: RoomMode;
  markers?: TrackMarker[];
  liveIds?: Set<string>;
  size?: "sm" | "lg";
  orientation?: "horizontal" | "vertical";
  className?: string;
  /** Friend lens: whose trail is in focus. Everyone else dims. */
  lens?: string | null;
  onLens?: (id: string | null) => void;
  /** Recent knocks by user id → time, to play on their avatar. */
  knocks?: Map<string, number>;
}) {
  const vertical = orientation === "vertical";
  const [railRef, width] = useElementLength<HTMLDivElement>(vertical);
  const avatarSize = size === "lg" ? 36 : 26;
  const live = useMemo(() => liveIds ?? new Set<string>(), [liveIds]);

  const readers = useMemo<TrackMember[]>(() => members.map((m) => ({ ...m, id: m.user_id, progress: vertical ? m.position : m.furthest })), [members, vertical]);
  // Before the first measurement assume a phone-sized rail so nothing overlaps on first paint.
  const clusters = useMemo(() => layoutTrack(readers, { width: width || 280, avatarSize }), [readers, width, avatarSize]);
  const me = members.find((m) => m.user_id === meId);
  const mine = clamp01(vertical ? me?.position ?? 0 : me?.furthest ?? 0);

  return (
    <div data-orientation={orientation} className={cn("w-full select-none", vertical && "h-full min-h-0", className)}>
      <div className={cn("flex items-center", vertical && "h-full flex-col", size === "lg" ? "gap-3" : "gap-2")}>
        {size === "lg" && <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Start</span>}

        {/* End padding keeps avatars at 0% and 100% inside the component. */}
        <div className="relative min-h-0 flex-1" style={vertical ? { width: avatarSize + 20, paddingBlock: 22 } : { height: avatarSize + 20, paddingInline: avatarSize / 2 }}>
          <div ref={railRef} role="list" aria-label="Where everyone is in the book" className="relative h-full w-full">
            {/* rail */}
            <div className={cn("absolute rounded-full bg-line", vertical ? "inset-y-0 left-1/2 w-1 -translate-x-1/2" : "inset-x-0 top-1/2 -translate-y-1/2", !vertical && (size === "lg" ? "h-1.5" : "h-1"))} aria-hidden />
            {/* the part of the book the viewer has read */}
            <div
              className={cn("absolute rounded-full bg-accent/70 duration-700 ease-out", vertical ? "left-1/2 top-0 w-1 -translate-x-1/2 transition-[height]" : "left-0 top-1/2 -translate-y-1/2 transition-[width]", !vertical && (size === "lg" ? "h-1.5" : "h-1"))}
              style={vertical ? { height: `${mine * 100}%` } : { width: `${mine * 100}%` }}
              aria-hidden
            />
            {/* things left along the way — neutral marks, never content */}
            {markers.map((marker) => (
              <span
                key={marker.id}
                aria-hidden
                className={cn("absolute transition-opacity duration-300", vertical ? "left-[calc(50%+7px)] -translate-y-1/2" : "-translate-x-1/2", !vertical && (size === "lg" ? "top-[calc(50%+11px)]" : "top-[calc(50%+7px)]"), lens && marker.authorId !== lens && "opacity-20")}
                style={vertical ? { top: `${clamp01(marker.position) * 100}%` } : { left: `${clamp01(marker.position) * 100}%` }}
              >
                <RailMark marker={marker} />
              </span>
            ))}
            {clusters.map((cluster) => (
              <Cluster key={cluster.readers.map((r) => r.id).join("+")} cluster={cluster} meId={meId} mode={mode} liveIds={live} avatarSize={avatarSize} vertical={vertical} railLength={width || 280} lens={lens} onLens={onLens} knocks={knocks} />
            ))}
          </div>
        </div>

        {size === "lg" && <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">End</span>}
      </div>
    </div>
  );
}
