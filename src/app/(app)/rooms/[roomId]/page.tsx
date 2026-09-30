import { ArrowLeft, DoorClosed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JoinButton } from "@/components/room/join-button";
import { OpenRoomCard } from "@/components/room/room-card";
import { RoomLobby } from "@/components/room/room-lobby";
import type { TrackMarker } from "@/components/room/progress-track";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Activity, RoomDetail, RoomPreview } from "@/lib/types";

export const metadata: Metadata = { title: "Room" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <EmptyState
      className="mx-auto max-w-xl"
      icon={<DoorClosed className="size-5" aria-hidden />}
      title="This room isn't available"
      action={<ButtonLink href="/home">Back to Home</ButtonLink>}
    >
      It may be private, it may have been closed, or the link might be wrong. If a friend invited you, ask them for an invitation link.
    </EmptyState>
  );
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireAlpha();
  const { roomId } = await params;
  const query = await searchParams;
  if (!UUID.test(roomId)) return <NotFound />;

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("room_detail", { p_room_id: roomId });
  if (error || !data) return <NotFound />;

  const room = data as RoomDetail | RoomPreview;

  // ---------------------------------------------------------------- open room, not a member
  if (!room.is_member) {
    const preview = room as RoomPreview;
    const full = preview.member_count >= preview.capacity;
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/discover" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Open rooms
        </Link>
        <div>
          <h1 className="text-4xl text-ink">{preview.name}</h1>
          <p className="mt-2 text-ink-soft">An open room. Join to read along, see where everyone is, and find what they&apos;ve left in the book.</p>
        </div>
        <OpenRoomCard
          room={preview}
          action={
            preview.my_status === "removed" ? (
              <span className="text-sm text-ink-faint">You were removed from this room.</span>
            ) : preview.is_closed ? (
              <span className="text-sm text-ink-faint">Not accepting new members</span>
            ) : full ? (
              <span className="text-sm text-ink-faint">Full</span>
            ) : (
              <JoinButton roomId={preview.id}>{preview.my_status === "left" ? "Rejoin" : "Join this room"}</JoinButton>
            )
          }
        />
      </div>
    );
  }

  // ---------------------------------------------------------------- member
  const detail = room as RoomDetail;
  const [activity, markers, unlocks] = await Promise.all([
    supabase.from("room_activity").select("id, room_id, actor_id, type, data, created_at").eq("room_id", roomId).order("created_at", { ascending: false }).limit(30),
    supabase.from("annotation_markers").select("id, author_id, position, published_at").eq("room_id", roomId),
    supabase.from("reading_unlocks").select("marker_id").eq("room_id", roomId).eq("user_id", me.user_id),
  ]);
  const open = new Set((unlocks.data ?? []).map((u) => u.marker_id as string));
  const trackMarkers: TrackMarker[] = ((markers.data ?? []) as { id: string; author_id: string; position: number; published_at: string | null }[])
    .filter((m) => m.published_at)
    .map((m) => ({ id: m.id, position: m.position, authorId: m.author_id, open: m.author_id === me.user_id || open.has(m.id) }));

  return <RoomLobby initial={detail} initialExtras={{ activity: (activity.data ?? []) as Activity[], markers: trackMarkers }} welcome={query.welcome === "1"} />;
}
