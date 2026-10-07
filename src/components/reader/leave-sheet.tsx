"use client";

import { X } from "lucide-react";
import { SheetClose } from "@/components/ui/overlay";
import type { Chapter } from "@/lib/chapters";
import { cn } from "@/lib/format";
import type { RoomFeatures, RoomMember } from "@/lib/types";
import { NoteComposer } from "./composer";
import { PollComposer } from "./polls";
import { PredictionComposer } from "./predictions";
import type { ViewerSelection } from "./types";
import type { Annotations } from "./use-annotations";

export type LeaveKind = "note" | "package" | "prediction" | "poll";

const KINDS: { id: LeaveKind; label: string; title: string }[] = [
  { id: "note", label: "Note", title: "Leave something here" },
  { id: "package", label: "Package", title: "Wrap a package" },
  { id: "prediction", label: "Prediction", title: "Seal a prediction" },
  { id: "poll", label: "Poll", title: "Ask the room" },
];

/**
 * One place to leave anything at this spot. The kinds a room has switched
 * off simply are not offered.
 */
export function LeaveSheet({ kind, kinds, onKind, selection, roomId, chapters, annotations, members, meId, features, onDone }: {
  kind: LeaveKind;
  kinds: LeaveKind[];
  onKind: (kind: LeaveKind) => void;
  selection: ViewerSelection;
  roomId: string;
  chapters: Chapter[];
  annotations: Annotations;
  members: RoomMember[];
  meId: string;
  features?: RoomFeatures;
  onDone: (what: LeaveKind, detail?: string) => void;
}) {
  const current = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-5 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-ink">{current.title}</h2>
            <p className="truncate text-xs text-ink-faint">{selection.label}</p>
          </div>
          <SheetClose className="-mr-2 flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
            <X className="size-5" aria-hidden />
          </SheetClose>
        </div>
        {kinds.length > 1 && (
          <div role="radiogroup" aria-label="What are you leaving?" className="mt-3 grid gap-1 rounded-full bg-sunk p-1" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
            {KINDS.filter((k) => kinds.includes(k.id)).map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={kind === option.id}
                onClick={() => onKind(option.id)}
                className={cn("flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-1.5 text-sm font-medium transition-colors duration-150", kind === option.id ? "bg-raised text-ink shadow-soft" : "text-ink-soft hover:text-ink")}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </header>
      {kind === "prediction" ? (
        <PredictionComposer roomId={roomId} position={selection.position} label={selection.label} chapters={chapters} onSealed={(label) => onDone("prediction", label)} />
      ) : kind === "poll" ? (
        <PollComposer roomId={roomId} position={selection.position} anchor={selection.anchor} label={selection.label} onCreated={() => onDone("poll")} />
      ) : (
        <NoteComposer selection={selection} annotations={annotations} members={members} meId={meId} features={features} kind={kind} onDone={() => onDone(kind)} />
      )}
    </div>
  );
}
