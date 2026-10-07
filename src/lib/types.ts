// Domain types. These mirror the JSON returned by the RPC read models in
// supabase/migrations/…_read_models.sql and the columns of the tables the
// client reads directly.
import type { BookFormat } from "@/lib/limits";
import type { Anchor } from "@/lib/location";

export type AlphaStatus = "pending" | "active" | "disabled";
export type RoomVisibility = "private" | "unlisted" | "open";
export type RoomModeId = "chill" | "race" | "duo";
export type MemberRole = "owner" | "moderator" | "member";
export type MemberStatus = "active" | "left" | "removed";
export type BookStatus = "uploading" | "processing" | "ready" | "failed" | "deleted" | "disabled";

export interface Access {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
  status: AlphaStatus;
  is_admin: boolean;
}

export interface Person {
  id: string;
  display_name: string;
  avatar_path: string | null;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  cover_path: string | null;
  status: BookStatus;
  page_count: number | null;
  uploader_id?: string;
}

export interface LibraryBook extends BookSummary {
  size_bytes: number | null;
  created_at: string;
  room_count: number;
}

export interface BookRow extends BookSummary {
  uploader_id: string;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  has_locations: boolean;
  metadata: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

export interface ReadingStats {
  read_coverage?: number;
  estimated_wpm?: number;
  pace_samples?: number;
  active_reading_seconds?: number;
}

/** How a note asks for attention once the reader reaches it: whisper → shout. */
export type NoteAttention = "quiet" | "gentle" | "playful" | "knock" | "shout";

/** Per-room experiment switches. A missing key means the feature is on. */
export type RoomFeatures = Partial<Record<import("@/lib/features").FeatureKey, boolean>>;

export interface RoomMember extends ReadingStats {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
  role: MemberRole;
  joined_at: string;
  position: number;
  furthest: number;
  label: string | null;
  started_at: string | null;
  last_read_at: string | null;
  completed_at: string | null;
}

export interface MyProgress extends ReadingStats {
  position: number;
  furthest: number;
  label: string | null;
  anchor: Anchor | null;
  started_at: string;
  last_read_at: string;
  completed_at: string | null;
}

interface RoomBase {
  id: string;
  name: string;
  description: string | null;
  visibility: RoomVisibility;
  mode: RoomModeId;
  features?: RoomFeatures;
  member_limit: number | null;
  capacity: number;
  is_closed: boolean;
  archived_at: string | null;
  owner_id: string;
  created_at: string;
  last_activity_at: string;
  book: BookSummary;
}

/** A room as seen by one of its members. */
export interface RoomCard extends RoomBase {
  is_member: true;
  my_role: MemberRole;
  members: RoomMember[];
  my: MyProgress | null;
  /** Notes friends left that this reader has not reached yet. */
  waiting: number;
  /** Notes this reader has reached but not opened yet. */
  unseen: number;
  note_count: number;
  /** Packages addressed to this reader that are still ahead of them. */
  packages_waiting?: number;
  /** Sealed predictions this reader has reached but not opened. */
  predictions_ready?: number;
}

export interface RoomDetail extends RoomCard {
  join_code: string | null;
  people: { user_id: string; display_name: string; avatar_path: string | null; role: MemberRole; status: MemberStatus }[];
}

/** What a non-member may know about an Open room. */
export interface RoomPreview extends RoomBase {
  is_member: boolean;
  my_status: MemberStatus | null;
  member_count: number;
  members: { user_id: string; display_name: string; avatar_path: string | null; role: MemberRole }[];
  progress: number[];
}

export interface HomeData {
  rooms: RoomCard[];
  books: LibraryBook[];
  unread_notifications: number;
}

export type JoinState =
  | "ok" | "already_member" | "not_found" | "revoked" | "expired" | "used_up"
  | "not_for_you" | "full" | "closed" | "archived" | "removed";

export interface JoinPreview {
  state: JoinState;
  kind?: "invite" | "link";
  room?: { id: string; name: string; description: string | null; mode: RoomModeId; visibility: RoomVisibility; member_count: number; capacity: number };
  book?: { id: string; title: string; author: string | null; format: BookFormat };
  inviter?: Person;
  members?: Person[];
}

export interface RoomInvite {
  id: string;
  room_id: string;
  token: string;
  created_by: string;
  invited_user_id: string | null;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- annotations
export interface Marker {
  attention: NoteAttention;
  recipient_id: string | null;
  kind?: "note" | "package";
  package_title?: string | null;
  id: string;
  room_id: string;
  book_id: string;
  author_id: string;
  position: number;
  anchor: Anchor;
  location_label: string | null;
  published_at: string | null;
  created_at: string;
}

export interface NoteContent {
  marker_id: string;
  body: string | null;
  emoji: string | null;
  link_url: string | null;
  quote: string | null;
  edited_at: string | null;
}

export interface Attachment {
  id: string;
  marker_id: string;
  kind: "image" | "audio" | "video";
  bucket: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  original_name: string | null;
}

export interface Reply {
  id: string;
  marker_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface Reaction {
  id: string;
  marker_id: string;
  user_id: string;
  emoji: string;
}

export interface Unlock {
  marker_id: string;
  via: "reached" | "instant";
  unlocked_at: string;
  seen_at: string | null;
}

export type ActivityType =
  | "room_created" | "joined" | "left" | "removed" | "started_reading" | "chapter_completed"
  | "milestone" | "finished" | "passed" | "note_left" | "replied" | "room_updated" | "room_archived"
  | "prediction_sealed" | "poll_added" | "ritual_started" | "afterparty";

export interface Activity {
  id: number;
  room_id: string;
  actor_id: string | null;
  type: ActivityType;
  data: Record<string, unknown>;
  created_at: string;
}

export type NotificationType =
  | "reply" | "reaction" | "unlocked" | "note_behind" | "member_joined" | "invited"
  | "finished" | "role_changed" | "removed" | "room_changed" | "afterparty" | "package";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  room_id: string | null;
  room_name: string | null;
  marker_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  actor: Person | null;
}

export interface NotificationList {
  unread: number;
  items: NotificationItem[];
}

// ---------------------------------------------------------------- journey
export interface JourneyReader {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
  status: MemberStatus;
  role: MemberRole;
  joined_at: string;
  furthest: number;
  started_at: string | null;
  completed_at: string | null;
  last_read_at: string | null;
  reading_seconds: number;
  notes: number;
  replies: number;
  discoveries: number;
}

export interface JourneyMoment {
  marker_id: string;
  author_id: string;
  position: number;
  label: string | null;
  created_at: string;
  replies: number;
  reactions: number;
  media: ("image" | "audio" | "video")[];
}

export interface JourneyDiscovery {
  marker_id: string;
  reader_id: string;
  author_id: string;
  position: number;
  label: string | null;
  left_at: string;
  discovered_at: string;
}

export interface Journey {
  room: { id: string; name: string; mode: RoomModeId; created_at: string; archived_at: string | null };
  book: BookSummary;
  viewer_furthest: number;
  readers: JourneyReader[];
  totals: { notes: number; replies: number; reactions: number; images: number; audio: number; video: number; discoveries: number; reading_seconds: number };
  first_started_at: string | null;
  last_read_at: string | null;
  sections: { bucket: number; notes: number; replies: number; label: string | null }[];
  moments: JourneyMoment[];
  discoveries: JourneyDiscovery[];
  events: { id: number; type: ActivityType; actor_id: string | null; data: Record<string, unknown>; created_at: string }[];
}

export interface SearchResults {
  books: (BookSummary & { mine: boolean })[];
  rooms: { id: string; name: string; description: string | null; visibility: RoomVisibility; mode: RoomModeId; is_member: boolean; book: BookSummary; member_count: number }[];
  people: (Person & { shared_rooms: { id: string; name: string }[] })[];
}

// ---------------------------------------------------------------- the social layer
export interface OutlineEntry {
  label: string;
  start: number;
  depth: number;
}

export type PredictionVerdict = "called_it" | "close" | "way_off";

export interface Prediction {
  id: string;
  author_id: string;
  made_at: number;
  made_label: string | null;
  opens_at: number;
  opens_label: string | null;
  opens_kind: "chapter" | "point" | "end";
  hide_from_author: boolean;
  created_at: string;
  /** Readable by this viewer right now (always, for an author who did not hide it). */
  open: boolean;
  /** The viewer has reached its opening point: it can be revealed. */
  reached: boolean;
  body: string | null;
  revealed_at: string | null;
  my_verdict: PredictionVerdict | null;
  verdicts: Partial<Record<PredictionVerdict, number>> | null;
}

export interface Poll {
  id: string;
  author_id: string;
  position: number;
  anchor: Anchor;
  label: string | null;
  created_at: string;
  reached: boolean;
  question: string | null;
  options: string[] | null;
  my_vote: number | null;
  votes: number;
  /** Only after this viewer has voted. */
  results: { option: number; user_id: string }[] | null;
}

export type RitualKind = "predict_before" | "vote_before" | "song_within" | "hold_until" | "custom";

export interface Ritual {
  id: string;
  kind: RitualKind;
  title: string;
  detail: string | null;
  created_by: string;
  starts_at: number | null;
  target_at: number | null;
  target_label: string | null;
  until_at: string | null;
  poll_id: string | null;
  created_at: string;
  ended_at: string | null;
  members: { user_id: string; done: boolean }[];
}

export interface Afterparty {
  chapter_index: number;
  label: string | null;
  start_at: number;
  end_at: number;
  opened_at: string;
}

export interface WeatherPoint {
  /** position, rounded to 0.001 */
  p: number;
  e: string;
  n: number;
}

export interface RoomLayer {
  features: RoomFeatures;
  outline: OutlineEntry[] | null;
  furthest: number;
  predictions: Prediction[];
  polls: Poll[];
  rituals: Ritual[];
  afterparties: Afterparty[];
  weather: WeatherPoint[];
  cues: { position: number; author_id: string; open: boolean }[];
  my_rating: { stars: number; line: string | null } | null;
}

export interface Echo {
  id: string;
  room_id: string;
  room_name: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  mine: boolean;
  position: number;
  anchor: Anchor;
  label: string | null;
  created_at: string;
  body: string | null;
  emoji: string | null;
  quote: string | null;
  link_url: string | null;
  media: ("image" | "audio" | "video")[];
}

export interface AwayMember {
  user_id: string;
  from: number;
  to: number;
  finished: boolean;
  left_ahead: number;
  packages: number;
  replies: number;
  reply_label: string | null;
  reply_marker: string | null;
  predictions: number;
}

export interface AwaySummary {
  since: string | null;
  me: number;
  members: AwayMember[];
  afterparties: { chapter_index: number; label: string | null }[];
}

export interface VaultNote {
  marker_id: string;
  author_id: string;
  label: string | null;
  body: string | null;
  emoji: string | null;
  quote: string | null;
  created_at?: string;
  reactions?: number;
  replies?: number;
  laughs?: number;
}

export interface Vault {
  room: { id: string; name: string; mode: RoomModeId; created_at: string };
  book: BookSummary;
  readers: { user_id: string; display_name: string; avatar_path: string | null; status: MemberStatus; furthest: number; started_at: string | null; completed_at: string | null; active_reading_seconds: number }[];
  predictions: { id: string; author_id: string; body: string; made_at: number; made_label: string | null; opens_label: string | null; opens_kind: Prediction["opens_kind"]; created_at: string; my_verdict: PredictionVerdict | null; verdicts: Partial<Record<PredictionVerdict, number>> | null }[];
  first_note: VaultNote | null;
  most_reacted: VaultNote | null;
  funniest: VaultNote | null;
  polls: { id: string; author_id: string; question: string; options: string[]; label: string | null; position: number; results: { option: number; user_id: string }[] }[];
  ratings: { user_id: string; stars: number; line: string | null }[];
  soundtrack: { id: string; title: string; author_id: string; starts_at: number | null; label: string | null }[];
  chapters: { index: number; label: string; start_at: number; end_at: number; notes: number; replies: number }[];
  images: { id: string; bucket: string; path: string; marker_id: string; author_id: string; width: number | null; height: number | null; label: string | null }[];
  timeline: { user_id: string; furthest: number; at: string }[];
  totals: { notes: number; replies: number; reactions: number; predictions: number; polls: number; songs: number };
}
