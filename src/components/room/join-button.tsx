"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";

/** Joins a room either from the open directory (roomId) or with an invitation / room link (token). */
export function JoinButton({
  roomId,
  token,
  children = "Join this room",
  size = "md",
  className,
}: {
  roomId?: string;
  token?: string;
  children?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    const supabase = getSupabase();
    const { data, error } = token
      ? await supabase.rpc("join_with_token", { p_token: token })
      : await supabase.rpc("join_open_room", { p_room_id: roomId });
    if (error) {
      setBusy(false);
      toast.error(friendlyError(error));
      // The room may have filled up or closed in the meantime: show its current state.
      router.refresh();
      return;
    }
    const result = data as { room_id: string; status: string };
    router.push(`/rooms/${result.room_id}`);
    router.refresh();
  }

  return (
    <Button size={size} className={className} loading={busy} onClick={join}>
      {children}
    </Button>
  );
}
