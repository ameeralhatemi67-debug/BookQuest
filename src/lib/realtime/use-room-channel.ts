"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/** Ephemeral "who is here right now" state. Never persisted — durable progress lives in Postgres. */
export interface PresenceMeta {
  user_id: string;
  /** true while the person has the book open. */
  reading: boolean;
  /** Rough progress (rounded), only sent occasionally. */
  progress?: number;
  label?: string;
}

export type RoomTable =
  | "reading_progress" | "room_members" | "room_activity" | "annotation_markers" | "annotation_contents"
  | "annotation_replies" | "annotation_reactions" | "reading_unlocks" | "rooms";

export type ChannelStatus = "connecting" | "live" | "offline";

export interface RoomChange {
  table: RoomTable;
  type: "INSERT" | "UPDATE" | "DELETE";
  row: Record<string, unknown>;
  old: Record<string, unknown>;
}

interface Options {
  roomId: string;
  userId: string;
  tables: RoomTable[];
  /** A row changed. Treat it as a hint to refetch — Postgres is the source of truth. */
  onChange: (change: RoomChange) => void;
  /** The connection came back (or we are polling while it is down): re-read everything. */
  onResync: () => void;
  presence: PresenceMeta;
}

const PRESENCE_MIN_INTERVAL = 15_000;
const OFFLINE_POLL_INTERVAL = 30_000;

/**
 * One private Realtime channel per room (`room:{id}`), carrying row-change
 * hints for the room's tables and live presence.
 *
 * Realtime only ever *improves* freshness. If the socket drops, the app keeps
 * working from Postgres: we poll gently while offline and do a full resync the
 * moment the channel is back.
 */
export function useRoomChannel({ roomId, userId, tables, onChange, onResync, presence }: Options) {
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const [live, setLive] = useState<Map<string, PresenceMeta>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlers = useRef({ onChange, onResync });
  const latestPresence = useRef(presence);
  const lastTracked = useRef<{ at: number; key: string }>({ at: 0, key: "" });
  const tableKey = tables.join(",");

  useEffect(() => {
    handlers.current = { onChange, onResync };
  }, [onChange, onResync]);

  useEffect(() => {
    const supabase = getSupabase();
    let disposed = false;
    let wasOffline = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const track = (channel: RealtimeChannel) => {
      const meta = latestPresence.current;
      lastTracked.current = { at: Date.now(), key: JSON.stringify(meta) };
      void channel.track(meta).catch(() => {});
    };

    let channel = supabase.channel(`room:${roomId}`, { config: { private: true, presence: { key: userId } } });

    // Row filters differ: `rooms` is keyed by id, everything else by room_id.
    for (const table of tableKey.split(",").filter(Boolean) as RoomTable[]) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: table === "rooms" ? `id=eq.${roomId}` : `room_id=eq.${roomId}` },
        (payload) => {
          handlers.current.onChange({
            table,
            type: payload.eventType,
            row: (payload.new ?? {}) as Record<string, unknown>,
            old: (payload.old ?? {}) as Record<string, unknown>,
          });
        },
      );
    }

    channel = channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const next = new Map<string, PresenceMeta>();
      for (const [key, metas] of Object.entries(state)) {
        // Several tabs / devices for one person: "reading" wins.
        const meta = metas.find((m) => m.reading) ?? metas[0];
        if (meta) next.set(key, { user_id: key, reading: Boolean(meta.reading), progress: meta.progress, label: meta.label });
      }
      setLive(next);
    });

    channelRef.current = channel;

    // Private channels authorize with the user's access token.
    void supabase.realtime.setAuth().then(() => {
      if (disposed) return;
      channel.subscribe((state) => {
        if (disposed) return;
        if (state === "SUBSCRIBED") {
          stopPolling();
          setStatus("live");
          track(channel);
          if (wasOffline) {
            wasOffline = false;
            handlers.current.onResync();
          }
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          wasOffline = true;
          setStatus("offline");
          setLive(new Map());
          // While the socket is down, keep durable state fresh by polling.
          pollTimer ??= setInterval(() => handlers.current.onResync(), OFFLINE_POLL_INTERVAL);
        }
      });
    });

    // Coming back to the tab: make sure we are current even if events were missed.
    const onVisible = () => {
      if (document.visibilityState === "visible") handlers.current.onResync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      disposed = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId, userId, tableKey]);

  // Presence updates are throttled: a change of state is sent at most every 15 s
  // (reading ↔ not reading goes out immediately).
  const presenceKey = JSON.stringify(presence);
  useEffect(() => {
    latestPresence.current = presence;
    const channel = channelRef.current;
    if (!channel || status !== "live" || presenceKey === lastTracked.current.key) return;

    const previous = lastTracked.current.key ? (JSON.parse(lastTracked.current.key) as PresenceMeta) : null;
    const urgent = !previous || previous.reading !== presence.reading;
    const wait = urgent ? 0 : Math.max(0, PRESENCE_MIN_INTERVAL - (Date.now() - lastTracked.current.at));
    const timer = setTimeout(() => {
      lastTracked.current = { at: Date.now(), key: presenceKey };
      void channel.track(latestPresence.current).catch(() => {});
    }, wait);
    return () => clearTimeout(timer);
    // `presence` is fully captured by presenceKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceKey, status]);

  return { status, live };
}
