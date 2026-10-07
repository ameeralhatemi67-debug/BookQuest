"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Echo, RoomLayer } from "@/lib/types";
import type { TocItem } from "./types";

/**
 * The reader's social layer: predictions, polls, rituals, afterparties,
 * reaction weather and music cues, already stripped by the database of
 * anything this reader has not reached. Refetched on hints (Broadcast and
 * room activity) and whenever the reader moves past a new 1%.
 */
export function useRoomLayer({ roomId, bookId, toc, ready }: { roomId: string; bookId: string; toc: TocItem[]; ready: boolean }) {
  const supabase = getSupabase();
  const [layer, setLayer] = useState<RoomLayer | null>(null);
  const [echoes, setEchoes] = useState<Echo[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outlineSent = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("room_layer", { p_room_id: roomId });
    if (!error && data) setLayer(data as RoomLayer);
  }, [roomId, supabase]);

  /** Coalesces bursts of hints into one read. */
  const refresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void load();
    }, 300);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("room_layer", { p_room_id: roomId }).then(({ data, error }) => {
      if (!cancelled && !error && data) setLayer(data as RoomLayer);
    });
    void supabase.rpc("reading_echoes", { p_room_id: roomId }).then(({ data }) => {
      if (!cancelled && Array.isArray(data)) setEchoes(data as Echo[]);
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [roomId, supabase]);

  // The first reader to open the book shares its chapter starts with everyone.
  useEffect(() => {
    if (!ready || !layer || layer.outline || outlineSent.current) return;
    const outline = toc.filter((item) => item.progress !== null).map((item) => ({ label: item.label, start: item.progress, depth: item.depth }));
    if (outline.length < 2) return;
    outlineSent.current = true;
    void supabase.rpc("set_book_outline", { p_book_id: bookId, p_outline: outline }).then(({ error }) => {
      if (!error) refresh();
    });
  }, [ready, layer, toc, bookId, supabase, refresh]);

  return { layer, echoes, refresh, reload: load };
}

export type RoomLayerState = ReturnType<typeof useRoomLayer>;
