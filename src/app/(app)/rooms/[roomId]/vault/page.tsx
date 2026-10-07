import { ArrowLeft, BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WaxSeal } from "@/components/reader/predictions";
import { VaultView } from "@/components/room/vault-view";
import { buttonClass } from "@/components/ui/button";
import { formatPercent } from "@/lib/location";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { RoomDetail, Vault } from "@/lib/types";

export const metadata: Metadata = { title: "The vault" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VaultPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  await requireAlpha(`/rooms/${roomId}/vault`);
  if (!UUID.test(roomId)) notFound();
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("room_vault", { p_room_id: roomId });

  if (error) {
    if (error.message === "room_not_found") notFound();
    if (error.message === "feature_off") redirect(`/rooms/${roomId}/journey`);
    // Locked: say how far there is to go, and nothing about what is inside.
    const { data: room } = await supabase.rpc("room_detail", { p_room_id: roomId });
    const detail = room as RoomDetail | null;
    const furthest = detail?.my?.furthest ?? 0;
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <Link href={`/rooms/${roomId}`} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> {detail?.name ?? "Back to the room"}
        </Link>
        <div className="mt-10 flex justify-center"><WaxSeal className="scale-150" /></div>
        <h1 className="mt-8 text-4xl text-ink">The vault is sealed</h1>
        <p className="mx-auto mt-3 max-w-md leading-relaxed text-ink-soft">
          It opens when you reach the last page. Everyone&apos;s predictions, ratings, the soundtrack and the whole journey are waiting inside.
        </p>
        <p className="mt-4 text-sm text-ink-faint">You&apos;re {formatPercent(furthest)} of the way there.</p>
        <Link href={`/read/${roomId}`} className={buttonClass("primary", "lg", "mt-6")}>
          <BookOpen className="size-5" aria-hidden /> Keep reading
        </Link>
      </div>
    );
  }

  return <VaultView vault={data as Vault} />;
}
