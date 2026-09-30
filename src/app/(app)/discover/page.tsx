import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JoinButton } from "@/components/room/join-button";
import { OpenRoomCard } from "@/components/room/room-card";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { RoomPreview } from "@/lib/types";

export const metadata: Metadata = { title: "Open rooms" };

export default async function DiscoverPage() {
  await requireAlpha();
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("list_open_rooms");
  const rooms = (data ?? []) as RoomPreview[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl text-ink">Open rooms</h1>
        <p className="mt-2 max-w-xl text-ink-soft">
          Reading groups any alpha tester can join. Private and unlisted rooms never appear here — those you join by invitation or link.
        </p>
      </div>

      {error ? (
        <EmptyState title="We couldn't load the open rooms">Check your connection and refresh the page.</EmptyState>
      ) : rooms.length === 0 ? (
        <EmptyState icon={<Compass className="size-5" aria-hidden />} title="No open rooms yet" action={<ButtonLink href="/rooms/new">Open the first one</ButtonLink>}>
          When someone opens a room to everyone in the alpha, it shows up here. You could start one.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rooms.map((room) => {
            const full = room.member_count >= room.capacity;
            return (
              <li key={room.id}>
                <OpenRoomCard
                  room={room}
                  action={
                    room.is_member ? (
                      <Link href={`/rooms/${room.id}`} className={buttonClass("secondary", "sm")}>
                        You&apos;re in — open
                      </Link>
                    ) : room.my_status === "removed" ? (
                      <span className="text-xs text-ink-faint">Removed</span>
                    ) : room.is_closed || full ? (
                      <Link href={`/rooms/${room.id}`} className={buttonClass("ghost", "sm")}>
                        Details
                      </Link>
                    ) : (
                      <JoinButton roomId={room.id} size="sm">
                        {room.my_status === "left" ? "Rejoin" : "Join"}
                      </JoinButton>
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
