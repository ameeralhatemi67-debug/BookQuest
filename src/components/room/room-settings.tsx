"use client";

import { Archive, DoorClosed, DoorOpen, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FeatureToggles } from "@/components/room/feature-toggles";
import { Choice, parseMemberLimit, RoomSettingsFields, VISIBILITY_ICON, type RoomSettings } from "@/components/room/room-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { friendlyError } from "@/lib/errors";
import { roomMode, VISIBILITY_INFO } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { RoomDetail, RoomVisibility } from "@/lib/types";

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

// How far a setting opens the room to people who were not invited.
const REACH: Record<RoomVisibility, number> = { private: 0, unlisted: 1, open: 2 };

const VISIBILITY_CHOICES: { id: RoomVisibility; label: string; hint: string }[] = [
  { id: "private", label: "Private", hint: "Invited friends only." },
  { id: "unlisted", label: "Unlisted", hint: "Anyone with the room link." },
  { id: "open", label: "Public", hint: "Listed in Open Rooms for everyone." },
];

const NOW_TEXT: Record<RoomVisibility, string> = {
  private: "This room is now private. It is out of Open Rooms and its link has stopped working.",
  unlisted: "This room is now unlisted. Anyone with its link can join, but it is not listed.",
  open: "This room is now public and appears in Open Rooms.",
};

const WIDEN_TEXT: Record<Exclude<RoomVisibility, "private">, string> = {
  unlisted: "Anyone who has the room link will be able to join. The room stays out of Open Rooms.",
  open: "The room will appear in Open Rooms and any alpha tester can join it.",
};

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
  const [widen, setWiden] = useState<Exclude<RoomVisibility, "private"> | null>(null);
  const allowed = roomMode(room.mode).visibility;

  async function run(key: string, action: () => PromiseLike<{ error: unknown }>, after?: () => void) {
    setBusy(key);
    setError(null);
    const { error: rpcError } = await action();
    setBusy(null);
    if (rpcError) return setError(friendlyError(rpcError));
    after?.();
    onChanged();
  }

  // Takes effect at once, apart from the form below: who can join is not a draft.
  function applyVisibility(next: RoomVisibility) {
    void run(
      "visibility",
      async () => {
        const result = await supabase.rpc("update_room", { p_room_id: room.id, p_visibility: next });
        if (!result.error && next === "private") {
          // Retire the room link, so an old copy cannot come back to life if the room is opened up again.
          await supabase.rpc("rotate_join_code", { p_room_id: room.id });
        }
        return result;
      },
      () => {
        setWiden(null);
        toast.success(NOW_TEXT[next]);
      },
    );
  }

  function pickVisibility(next: RoomVisibility) {
    if (next === room.visibility) return;
    // Opening a room up asks first; closing it down is easy to undo, so it just happens.
    if (next !== "private" && REACH[next] > REACH[room.visibility]) return setWiden(next);
    setWiden(null);
    applyVisibility(next);
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
            <section aria-labelledby="room-privacy-heading" className="space-y-3">
              <div>
                <h3 id="room-privacy-heading" className="font-display text-lg text-ink">Who can join</h3>
                <p className="text-sm text-ink-soft">
                  Only you, as the owner, can change this. It applies straight away. Readers already in the room stay, and notes stay locked for newcomers until they reach them.
                </p>
              </div>
              <div role="radiogroup" aria-label="Room privacy" className="grid gap-2 sm:grid-cols-3">
                {VISIBILITY_CHOICES.map(({ id, label, hint }) => (
                  <Choice
                    key={id}
                    checked={room.visibility === id}
                    disabled={busy === "visibility" || !allowed.includes(id)}
                    onSelect={() => pickVisibility(id)}
                    className="py-3"
                  >
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <span className="text-ink-faint">{VISIBILITY_ICON[id]}</span>
                      {label}
                    </span>
                    <span className="mt-0.5 block pr-6 text-sm leading-snug text-ink-soft">{hint}</span>
                  </Choice>
                ))}
              </div>
              {allowed.length === 1 ? (
                <p className="text-sm text-ink-soft">A Private Duo is always private. Switch the mode below to change that.</p>
              ) : (
                <p className="text-sm text-ink-soft">{VISIBILITY_INFO[room.visibility].description}</p>
              )}
              {widen && (
                <div role="alert" className="rounded-2xl border border-line-strong bg-sunk/60 p-4">
                  <p className="text-sm font-medium text-ink">{widen === "open" ? "Make this room public?" : "Make this room unlisted?"}</p>
                  <p className="mt-1 text-sm text-ink-soft">{WIDEN_TEXT[widen]}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setWiden(null)}>
                      Keep it {room.visibility === "private" ? "private" : "as it is"}
                    </Button>
                    <Button size="sm" loading={busy === "visibility"} onClick={() => applyVisibility(widen)}>
                      {widen === "open" ? "Make public" : "Make unlisted"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          {isOwner && !archived && (
            <form onSubmit={save} className="space-y-6">
              <RoomSettingsFields value={settings} onChange={setSettings} memberCount={room.members.length} showVisibility={false} />
              <div className="flex justify-end">
                <Button type="submit" loading={busy === "save"} disabled={!settings.name.trim()}>
                  Save changes
                </Button>
              </div>
            </form>
          )}

          {isStaff && !archived && (
            <section aria-labelledby="room-features-heading" className="border-t border-line pt-6">
              <h3 id="room-features-heading" className="font-display text-lg text-ink">What this room tests</h3>
              <p className="mb-4 text-sm text-ink-soft">Switch features off to learn what your group actually enjoys. Changes apply to everyone in the room straight away.</p>
              <FeatureToggles roomId={room.id} features={room.features} onSaved={onChanged} compact />
            </section>
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
