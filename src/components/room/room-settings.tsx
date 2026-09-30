"use client";

import { Archive, DoorClosed, DoorOpen, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { parseMemberLimit, RoomSettingsFields, type RoomSettings } from "@/components/room/room-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { friendlyError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import type { RoomDetail } from "@/lib/types";

function settingsOf(room: RoomDetail): RoomSettings {
  return {
    name: room.name,
    description: room.description ?? "",
    mode: room.mode,
    visibility: room.visibility,
    memberLimit: room.member_limit ? String(room.member_limit) : "",
  };
}

export function RoomSettingsDialog({ room, open, onOpenChange, onChanged }: { room: RoomDetail; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Room settings" description={room.my_role === "owner" ? undefined : "Only the owner can change how this room works."}>
        {/* Mounted only while open: the form starts from the room's current settings each time. */}
        <SettingsBody room={room} onClose={() => onOpenChange(false)} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody({ room, onClose, onChanged }: { room: RoomDetail; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const supabase = getSupabase();
  const isOwner = room.my_role === "owner";
  const isStaff = isOwner || room.my_role === "moderator";
  const archived = Boolean(room.archived_at);
  const [settings, setSettings] = useState<RoomSettings>(() => settingsOf(room));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"leave" | "archive" | null>(null);

  async function run(key: string, action: () => PromiseLike<{ error: unknown }>, after?: () => void) {
    setBusy(key);
    setError(null);
    const { error: rpcError } = await action();
    setBusy(null);
    if (rpcError) return setError(friendlyError(rpcError));
    after?.();
    onChanged();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const limit = parseMemberLimit(settings.memberLimit);
    await run(
      "save",
      () =>
        supabase.rpc("update_room", {
          p_room_id: room.id,
          p_name: settings.name.trim(),
          p_description: settings.description.trim(),
          p_visibility: settings.visibility,
          p_mode: settings.mode,
          p_member_limit: settings.mode === "duo" ? 2 : limit,
          p_clear_member_limit: settings.mode !== "duo" && limit === null,
        }),
      () => {
        toast.success("Room updated.");
        onClose();
      },
    );
  }

  return (
        <div className="space-y-8">
          <FormError>{error}</FormError>

          {isOwner && !archived && (
            <form onSubmit={save} className="space-y-6">
              <RoomSettingsFields value={settings} onChange={setSettings} memberCount={room.members.length} />
              <div className="flex justify-end">
                <Button type="submit" loading={busy === "save"} disabled={!settings.name.trim()}>
                  Save changes
                </Button>
              </div>
            </form>
          )}

          <div className="space-y-3 border-t border-line pt-6">
            {isStaff && !archived && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-ink">{room.is_closed ? "Closed to new members" : "Accepting new members"}</p>
                  <p className="text-sm text-ink-soft">{room.is_closed ? "Nobody can join, even with a link or invitation." : "Close the room when the group is complete."}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === "close"}
                  onClick={() => run("close", () => supabase.rpc("update_room", { p_room_id: room.id, p_is_closed: !room.is_closed }))}
                  icon={room.is_closed ? <DoorOpen className="size-4" aria-hidden /> : <DoorClosed className="size-4" aria-hidden />}
                >
                  {room.is_closed ? "Re-open room" : "Close room"}
                </Button>
              </div>
            )}

            {isOwner && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-ink">{archived ? "This room is archived" : "Archive this room"}</p>
                  <p className="text-sm text-ink-soft">{archived ? "It is kept as a journey. You can bring it back." : "Ends the room: no new members or notes. It stays as a journey."}</p>
                </div>
                {confirm === "archive" ? (
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy === "archive"}
                      onClick={() => run("archive", () => supabase.rpc("set_room_archived", { p_room_id: room.id, p_archived: true }), () => setConfirm(null))}
                    >
                      Archive
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === "archive"}
                    onClick={() => (archived ? run("archive", () => supabase.rpc("set_room_archived", { p_room_id: room.id, p_archived: false })) : setConfirm("archive"))}
                    icon={<Archive className="size-4" aria-hidden />}
                  >
                    {archived ? "Restore" : "Archive"}
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-ink">Leave this room</p>
                <p className="text-sm text-ink-soft">
                  {isOwner && room.members.length > 1
                    ? "Hand the room to someone else first (member menu → Make owner)."
                    : isOwner
                      ? "You're the only one here, so leaving archives the room."
                      : "Your place in the book is kept if you come back."}
                </p>
              </div>
              {confirm === "leave" ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                    Stay
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy === "leave"}
                    onClick={() =>
                      run("leave", () => supabase.rpc("leave_room", { p_room_id: room.id }), () => {
                        toast.success(`You left ${room.name}.`);
                        router.push("/home");
                        router.refresh();
                      })
                    }
                  >
                    Leave
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" disabled={isOwner && room.members.length > 1} onClick={() => setConfirm("leave")} icon={<LogOut className="size-4" aria-hidden />}>
                  Leave
                </Button>
              )}
            </div>
          </div>
        </div>
  );
}
