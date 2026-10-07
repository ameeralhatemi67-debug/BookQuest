"use client";

import { ArrowLeft, BookOpen, Crown, MoreHorizontal, ScrollText, Settings2, Shield, ShieldOff, Stamp, UserMinus, UserPlus, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useMe } from "@/components/app/providers";
import { BookCover } from "@/components/book-cover";
import { ActivityList, type ActivityPerson } from "@/components/room/activity";
import { InviteDialog } from "@/components/room/invite-dialog";
import { ProgressTrack, type TrackMarker } from "@/components/room/progress-track";
import { duoSentence, VisibilityBadge, WaitingChips } from "@/components/room/room-card";
import { RoomSettingsDialog } from "@/components/room/room-settings";
import { RoomMoments } from "@/components/room/rituals-panel";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, SectionHeading } from "@/components/ui/misc";
import { Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { friendlyError } from "@/lib/errors";
import { cn, plural, timeAgo } from "@/lib/format";
import { formatPercent } from "@/lib/location";
import { standings } from "@/lib/progress-track";
import { useRoomChannel, type RoomTable } from "@/lib/realtime/use-room-channel";
import { roomModeFor } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { Activity, RoomDetail, RoomLayer, RoomMember } from "@/lib/types";

const TABLES: RoomTable[] = ["reading_progress", "room_members", "room_activity", "annotation_markers", "rooms"];

interface LobbyExtras {
  activity: Activity[];
  markers: TrackMarker[];
}

function RoleBadge({ role }: { role: RoomMember["role"] }) {
  if (role === "owner") {
    return (
      <Badge tone="gold">
        <Crown className="size-3" aria-hidden /> Owner
      </Badge>
    );
  }
  if (role === "moderator") {
    return (
      <Badge>
        <Shield className="size-3" aria-hidden /> Moderator
      </Badge>
    );
  }
  return null;
}

export function RoomLobby({ initial, initialExtras, welcome }: { initial: RoomDetail; initialExtras: LobbyExtras; welcome?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const supabase = getSupabase();
  const [room, setRoom] = useState(initial);
  const [extras, setExtras] = useState(initialExtras);
  const [inviteOpen, setInviteOpen] = useState(Boolean(welcome));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removing, setRemoving] = useState<RoomMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [layer, setLayer] = useState<RoomLayer | null>(null);
  const refreshing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mode = roomModeFor(room);
  const isOwner = room.my_role === "owner";
  const isStaff = isOwner || room.my_role === "moderator";
  const archived = Boolean(room.archived_at);
  const unavailable = room.book.status !== "ready";

  const refresh = useCallback(async () => {
    const [detail, activity, markers, unlocks, layerResult] = await Promise.all([
      supabase.rpc("room_detail", { p_room_id: initial.id }),
      supabase.from("room_activity").select("id, room_id, actor_id, type, data, created_at").eq("room_id", initial.id).order("created_at", { ascending: false }).limit(30),
      supabase.from("annotation_markers").select("id, author_id, position, published_at").eq("room_id", initial.id),
      supabase.from("reading_unlocks").select("marker_id").eq("room_id", initial.id).eq("user_id", me.user_id),
      supabase.rpc("room_layer", { p_room_id: initial.id }),
    ]);
    if (layerResult.data) setLayer(layerResult.data as RoomLayer);
    if (detail.error) {
      // Removed, left, or the room is gone: there is nothing to show here any more.
      if (detail.error.message === "room_not_found") router.replace("/home");
      return;
    }
    const next = detail.data as RoomDetail;
    if (!next.is_member) {
      router.refresh();
      return;
    }
    setRoom(next);
    const open = new Set((unlocks.data ?? []).map((u) => u.marker_id as string));
    setExtras({
      activity: (activity.data ?? []) as Activity[],
      markers: ((markers.data ?? []) as { id: string; author_id: string; position: number; published_at: string | null }[])
        .filter((m) => m.published_at)
        .map((m) => ({ id: m.id, position: m.position, authorId: m.author_id, open: m.author_id === me.user_id || open.has(m.id) })),
    });
  }, [initial.id, me.user_id, router, supabase]);

  // Several rows usually change together (progress + activity + unlocks): coalesce into one refetch.
  const scheduleRefresh = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = setTimeout(() => {
      refreshing.current = null;
      void refresh();
    }, 250);
  }, [refresh]);

  useEffect(() => () => {
    if (refreshing.current) clearTimeout(refreshing.current);
  }, []);

  // The social layer (rituals, afterparties, features) is read once on arrival, then on every change.
  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("room_layer", { p_room_id: initial.id }).then(({ data }) => {
      if (!cancelled && data) setLayer(data as RoomLayer);
    });
    return () => {
      cancelled = true;
    };
  }, [initial.id, supabase]);

  const { status, live } = useRoomChannel({
    roomId: room.id,
    userId: me.user_id,
    tables: TABLES,
    onChange: scheduleRefresh,
    onResync: scheduleRefresh,
    presence: { user_id: me.user_id, reading: false },
  });

  const readingNow = useMemo(() => new Set([...live.values()].filter((p) => p.reading).map((p) => p.user_id)), [live]);
  const online = useMemo(() => new Set(live.keys()), [live]);
  const people = useMemo(() => new Map<string, ActivityPerson>(room.people.map((p) => [p.user_id, p])), [room.people]);
  const ranked = useMemo(() => standings(room.members.map((m) => ({ ...m, id: m.user_id, progress: m.furthest }))), [room.members]);
  const started = Boolean(room.my && room.my.furthest > 0);
  const finished = Boolean(room.my?.completed_at);
  const everyoneFinished = room.members.length > 0 && room.members.every((m) => Boolean(m.completed_at));

  async function act(action: () => PromiseLike<{ error: unknown }>, success?: string) {
    setBusy(true);
    const { error } = await action();
    setBusy(false);
    if (error) return void toast.error(friendlyError(error));
    if (success) toast.success(success);
    void refresh();
  }

  return (
    <div className="space-y-10">
      <Link href="/home" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Home
      </Link>

      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <BookCover book={room.book} width={128} priority className="mx-auto sm:mx-0" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
            <Badge tone="accent">{mode.name}</Badge>
            <VisibilityBadge visibility={room.visibility} />
            {room.is_closed && !archived && <Badge tone="gold">Closed to new members</Badge>}
            {archived && <Badge tone="gold">Archived</Badge>}
          </div>
          <h1 className="mt-2 text-4xl leading-tight text-ink sm:text-5xl">{room.name}</h1>
          <p className="mt-1 text-ink-soft">
            <span className="font-display italic">{room.book.title}</span>
            {room.book.author ? ` · ${room.book.author}` : ""}
          </p>
          {room.description && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">{room.description}</p>}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {unavailable ? (
              <span className="rounded-full bg-danger-soft px-4 py-2 text-sm text-danger">
                {room.book.status === "disabled" ? "This book was disabled by an admin." : "This book was removed by the person who uploaded it."}
              </span>
            ) : (
              <Link href={`/read/${room.id}`} className={buttonClass("primary", "lg")}>
                <BookOpen className="size-5" aria-hidden />
                {finished ? "Open the book" : started ? "Continue reading" : "Start reading"}
              </Link>
            )}
            {!archived && (
              <Button variant="secondary" size="lg" onClick={() => setInviteOpen(true)} icon={<UserPlus className="size-5" aria-hidden />}>
                Invite
              </Button>
            )}
            {(room.my?.furthest ?? 0) >= 0.98 && room.features?.vault !== false && (
              <Link href={`/rooms/${room.id}/vault`} className={buttonClass("secondary", "lg")}>
                <Stamp className="size-5" aria-hidden />
                Vault
              </Link>
            )}
            <Link href={`/rooms/${room.id}/journey`} className={buttonClass("ghost", "lg")}>
              <ScrollText className="size-5" aria-hidden />
              Journey
            </Link>
            <Button variant="ghost" size="icon" aria-label="Room settings" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-5" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {status === "offline" && (
        <p role="status" className="flex items-center gap-2 rounded-2xl border border-line bg-sunk px-4 py-2.5 text-sm text-ink-soft">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Live updates are reconnecting. Everything here is still current as of a moment ago and refreshes on its own.
        </p>
      )}

      {/* ------------------------------------------------------------ the shared track */}
      <Card className="p-5 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="font-display text-2xl text-ink">{mode.id === "duo" ? "The two of you" : mode.id === "race" ? "The race" : "Where everyone is"}</h2>
          <p className="text-sm text-ink-soft">
            {mode.id === "duo"
              ? duoSentence(room, me.user_id)
              : everyoneFinished
                ? "Everyone has finished. "
                : readingNow.size > 0
                  ? `${plural(readingNow.size, "person", "people")} reading right now`
                  : started
                    ? `You're at ${room.my?.label ?? formatPercent(room.my?.furthest ?? 0)}`
                    : "Nobody's moved yet — be the first"}
          </p>
        </div>

        <ProgressTrack members={room.members} meId={me.user_id} mode={mode} markers={extras.markers} liveIds={readingNow} className="mt-6" />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <WaitingChips room={room} />
          {room.note_count > 0 && (
            <p className="text-xs text-ink-faint">
              {plural(room.note_count, "thing")} left in this book so far. Hollow marks are still ahead of you.
            </p>
          )}
        </div>

        {/* Race mode makes the comparison explicit. Chill deliberately does not. */}
        {mode.progress.showStandings && (
          <ol className="mt-6 divide-y divide-line border-t border-line">
            {ranked.map(({ reader, rank, behindLeader }) => (
              <li key={reader.id} className="flex items-center gap-3 py-2.5">
                <span className={cn("w-6 text-center font-display text-lg tabular-nums", rank === 1 ? "text-gold" : "text-ink-faint")}>{rank}</span>
                <Avatar person={{ id: reader.id, display_name: reader.display_name, avatar_path: reader.avatar_path }} size={30} live={readingNow.has(reader.id)} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {reader.display_name}
                  {reader.id === me.user_id && <span className="ml-1 font-normal text-ink-faint">(you)</span>}
                </span>
                <span className="text-sm tabular-nums text-ink-soft">{Boolean(reader.completed_at) ? "Finished" : formatPercent(reader.furthest)}</span>
                <span className="w-20 text-right text-xs tabular-nums text-ink-faint">{rank === 1 || behindLeader === 0 ? "in front" : `${behindLeader}% back`}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <RoomMoments
        roomId={room.id}
        layer={layer}
        meId={me.user_id}
        isStaff={isStaff}
        myFurthest={room.my?.furthest ?? 0}
        finished={(room.my?.furthest ?? 0) >= 0.98}
        personOf={(id) => { const p = people.get(id); return { id, display_name: p?.display_name ?? "A former member", avatar_path: p?.avatar_path ?? null }; }}
        onChanged={() => void refresh()}
        archived={archived}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------------------ members */}
        <section aria-labelledby="members-heading">
          <SectionHeading
            id="members-heading"
            title="Readers"
            hint={`${plural(room.members.length, "reader")}${room.member_limit ? ` of ${room.capacity}` : ""}`}
          />
          <Card className="divide-y divide-line px-4">
            {room.members.map((member) => {
              const isMe = member.user_id === me.user_id;
              const canManage = !isMe && member.role !== "owner" && (isOwner || (isStaff && member.role === "member"));
              const done = Boolean(member.completed_at);
              return (
                <div key={member.user_id} className="flex items-center gap-3 py-3">
                  <Avatar person={{ id: member.user_id, display_name: member.display_name, avatar_path: member.avatar_path }} size={40} live={readingNow.has(member.user_id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-ink">
                        {member.display_name}
                        {isMe && <span className="ml-1 font-normal text-ink-faint">(you)</span>}
                      </span>
                      <RoleBadge role={member.role} />
                    </div>
                    <p className="truncate text-xs text-ink-soft">
                      {readingNow.has(member.user_id)
                        ? "Reading now"
                        : done
                          ? `Finished${member.completed_at ? ` ${timeAgo(member.completed_at)}` : ""}`
                          : member.furthest > 0
                            ? `${member.label ?? formatPercent(member.furthest)} · last read ${timeAgo(member.last_read_at)}`
                            : online.has(member.user_id)
                              ? "Here now, hasn't started"
                              : "Hasn't started yet"}
                    </p>
                  </div>
                  {mode.progress.showPercent && !done && member.furthest > 0 && <span className="text-sm tabular-nums text-ink-soft">{formatPercent(member.furthest)}</span>}
                  {canManage && (
                    <Menu>
                      <MenuTrigger className="inline-flex size-10 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label={`Manage ${member.display_name}`}>
                        <MoreHorizontal className="size-5" aria-hidden />
                      </MenuTrigger>
                      <MenuContent align="end">
                        {isOwner && member.role === "member" && (
                          <MenuItem onSelect={() => act(() => supabase.rpc("set_member_role", { p_room_id: room.id, p_user_id: member.user_id, p_role: "moderator" }), `${member.display_name} is now a moderator.`)}>
                            <Shield className="size-4 text-ink-faint" aria-hidden /> Make moderator
                          </MenuItem>
                        )}
                        {isOwner && member.role === "moderator" && (
                          <MenuItem onSelect={() => act(() => supabase.rpc("set_member_role", { p_room_id: room.id, p_user_id: member.user_id, p_role: "member" }))}>
                            <ShieldOff className="size-4 text-ink-faint" aria-hidden /> Remove as moderator
                          </MenuItem>
                        )}
                        {isOwner && (
                          <MenuItem onSelect={() => act(() => supabase.rpc("transfer_ownership", { p_room_id: room.id, p_user_id: member.user_id }), `${member.display_name} now owns this room.`)}>
                            <Crown className="size-4 text-ink-faint" aria-hidden /> Make owner
                          </MenuItem>
                        )}
                        <MenuItem danger onSelect={() => setRemoving(member)}>
                          <UserMinus className="size-4" aria-hidden /> Remove from room
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                </div>
              );
            })}
          </Card>
          <p className="mt-3 text-sm leading-relaxed text-ink-faint">{mode.description}</p>
        </section>

        {/* ------------------------------------------------------------ activity */}
        <section aria-labelledby="room-activity-heading">
          <SectionHeading id="room-activity-heading" title="In this room" hint="Moments worth knowing about. Never what a note says." />
          <Card className="scroll-slim max-h-[28rem] overflow-y-auto px-4 py-2">
            <ActivityList activities={extras.activity} people={people} meId={me.user_id} />
          </Card>
        </section>
      </div>

      <InviteDialog room={room} open={inviteOpen} onOpenChange={setInviteOpen} onChanged={refresh} />
      <RoomSettingsDialog room={room} open={settingsOpen} onOpenChange={setSettingsOpen} onChanged={refresh} />

      {removing && (
        <Dialog open onOpenChange={(open) => !open && setRemoving(null)}>
          <DialogContent title={`Remove ${removing.display_name}?`} description="They lose access to this room and its notes. They can only come back with a new invitation from you.">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={async () => {
                  await act(() => supabase.rpc("remove_member", { p_room_id: room.id, p_user_id: removing.user_id }), `${removing.display_name} was removed.`);
                  setRemoving(null);
                }}
              >
                Remove
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
