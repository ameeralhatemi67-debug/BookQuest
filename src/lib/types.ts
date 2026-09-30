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

export interface RoomMember {
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

export interface MyProgress {
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
  | "milestone" | "finished" | "passed" | "note_left" | "replied" | "room_updated" | "room_archived";

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
  | "finished" | "role_changed" | "removed" | "room_changed";

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
