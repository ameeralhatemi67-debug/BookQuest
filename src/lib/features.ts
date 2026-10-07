// Per-room experiment switches.
//
// The alpha is a product study: Room A tests predictions, Room B tests music,
// Room C tests everything. Every room starts with everything on; owners,
// moderators and alpha admins switch features off. A missing key means "on".
// The same keys are validated by public.set_room_features in SQL; features that
// create something (predictions, polls, packages, rituals, soundtrack) are also
// refused server-side when off.
import type { RoomFeatures } from "@/lib/types";

export type FeatureKey =
  | "predictions" | "polls" | "packages" | "soundtrack" | "animated_notes" | "afterparty" | "book_map"
  | "friend_lens" | "reaction_weather" | "live_ghosts" | "echoes" | "rituals" | "vault" | "away_summary" | "race";

export interface FeatureInfo {
  key: FeatureKey;
  name: string;
  /** What a tester will notice when it is on. */
  description: string;
  group: "Leave things" | "See the room" | "Moments";
}

export const FEATURES: FeatureInfo[] = [
  { key: "predictions", name: "Sealed predictions", description: "Seal a guess that opens at a later chapter or the end.", group: "Leave things" },
  { key: "polls", name: "Passage polls", description: "Questions pinned to a passage, hidden until reached.", group: "Leave things" },
  { key: "packages", name: "Packages", description: "A bundle for one friend that opens when they get there.", group: "Leave things" },
  { key: "soundtrack", name: "Soundtrack", description: "Shared music and page-cued songs.", group: "Leave things" },
  { key: "rituals", name: "Rituals", description: "Small room challenges tied to the book.", group: "Leave things" },
  { key: "animated_notes", name: "Animated notes", description: "Note avatars perform their attention level.", group: "See the room" },
  { key: "book_map", name: "Book map", description: "A zoomed-out map of the journey, mysterious ahead.", group: "See the room" },
  { key: "friend_lens", name: "Friend lens", description: "Show the book through one friend's trail.", group: "See the room" },
  { key: "reaction_weather", name: "Reaction weather", description: "Reactions on a page, revealed once you reach it.", group: "See the room" },
  { key: "live_ghosts", name: "Live reading", description: "See who is reading now, knock, read together.", group: "See the room" },
  { key: "race", name: "Race standings", description: "Standings and overtakes in Race rooms.", group: "See the room" },
  { key: "afterparty", name: "Chapter afterparties", description: "A chapter's scrapbook opens once everyone clears it.", group: "Moments" },
  { key: "away_summary", name: "While you were away", description: "A return summary instead of a notification pile.", group: "Moments" },
  { key: "echoes", name: "Reread echoes", description: "Your notes from an earlier reading come back.", group: "Moments" },
  { key: "vault", name: "Ending vault", description: "The room's memory, unlocked at the last page.", group: "Moments" },
];

export function featureOn(features: RoomFeatures | null | undefined, key: FeatureKey): boolean {
  return features?.[key] !== false;
}

/** The switches that are off, for feedback context and admin summaries. */
export function featuresOff(features: RoomFeatures | null | undefined): FeatureKey[] {
  return FEATURES.filter((f) => !featureOn(features, f.key)).map((f) => f.key);
}
