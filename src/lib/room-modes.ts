// Room modes change the *social emphasis* of a room — never the reader itself.
//
// To add a mode later (Book Club, Study, Live Read…): add its id to the
// `rooms.mode` check constraint in a migration, add an entry here, and teach
// the components that read `progress.*` anything genuinely new. Modes that do
// not yet change the experience are deliberately absent.
import type { RoomModeId, RoomVisibility } from "@/lib/types";

export interface RoomMode {
  id: RoomModeId;
  name: string;
  /** One line shown when choosing a mode. */
  tagline: string;
  description: string;
  progress: {
    /** How loudly progress is compared. */
    emphasis: "subtle" | "prominent" | "intimate";
    /** Show exact percentages next to every reader. */
    showPercent: boolean;
    /** Show standings (1st, 2nd…) and gaps between readers. */
    showStandings: boolean;
    /** Record and show "X passed Y" moments. */
    showPassing: boolean;
  };
  /** A fixed room size, when the mode is built around an exact number of readers. */
  fixedSize?: number;
  /** Visibility options this mode permits. */
  visibility: RoomVisibility[];
}

export const ROOM_MODES: Record<RoomModeId, RoomMode> = {
  chill: {
    id: "chill",
    name: "Chill",
    tagline: "Read at your own pace.",
    description: "Everyone moves through the book in their own time. You can see where friends are, but nobody is keeping score.",
    progress: { emphasis: "subtle", showPercent: false, showStandings: false, showPassing: false },
    visibility: ["private", "unlisted", "open"],
  },
  race: {
    id: "race",
    name: "Race",
    tagline: "A friendly chase to the last page.",
    description: "Progress is front and centre: standings, gaps, and a note in the room when someone overtakes someone else.",
    progress: { emphasis: "prominent", showPercent: true, showStandings: true, showPassing: true },
    visibility: ["private", "unlisted", "open"],
  },
  duo: {
    id: "duo",
    name: "Private Duo",
    tagline: "Just the two of you.",
    description: "A room for exactly two readers. It shows the distance between you and what is waiting in the pages between.",
    progress: { emphasis: "intimate", showPercent: true, showStandings: false, showPassing: false },
    fixedSize: 2,
    visibility: ["private"],
  },
};

export const ROOM_MODE_LIST: RoomMode[] = [ROOM_MODES.chill, ROOM_MODES.race, ROOM_MODES.duo];

export function roomMode(id: string | null | undefined): RoomMode {
  return ROOM_MODES[id as RoomModeId] ?? ROOM_MODES.chill;
}

export const VISIBILITY_INFO: Record<RoomVisibility, { name: string; description: string }> = {
  private: { name: "Private", description: "Invitation only. Never listed; only people you invite can join." },
  unlisted: { name: "Unlisted", description: "Not listed anywhere. Any alpha tester with the room link can join." },
  open: { name: "Open", description: "Listed in Open Rooms. Any alpha tester can join." },
};

/** Default cap for any room in this alpha (mirrors private.room_capacity in SQL). */
export const MAX_ROOM_SIZE = 75;

/**
 * The mode as this room experiences it: a Race room with the "race" feature
 * switched off keeps its percentages but drops standings and overtakes.
 */
export function roomModeFor(room: { mode: string; features?: import("@/lib/types").RoomFeatures | null }): RoomMode {
  const mode = roomMode(room.mode);
  if (mode.id !== "race" || room.features?.race !== false) return mode;
  return { ...mode, progress: { ...mode.progress, emphasis: "subtle", showStandings: false, showPassing: false } };
}
