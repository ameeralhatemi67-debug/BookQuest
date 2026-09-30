"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabasePublishableKey, supabaseUrl } from "@/lib/config";
import { parseAnchor, roundProgress, type Anchor } from "@/lib/location";
import type { BookFormat } from "@/lib/limits";
import { getSupabase } from "@/lib/supabase/client";
import type { ViewerLocation } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SaveResult {
  position: number;
  furthest: number;
  first: boolean;
  completed: boolean;
  unlocked: string[];
}

interface Options {
  roomId: string;
  initialFurthest: number;
  /** Positions of notes this reader cannot open yet — reaching one saves sooner, for a quick reveal. */
  lockedPositions: number[];
  onUnlocked: (markerIds: string[]) => void;
  onCompleted: () => void;
}

// A reader has to *settle* on a page before it counts. This keeps rapid
// flipping (or a slip of the table of contents) from racing progress ahead and
// unlocking notes they never actually reached.
const DWELL_MS = 2500;
const DWELL_WITH_UNLOCK_MS = 1100;
// During long continuous scrolling, still save now and then.
const MAX_WAIT_MS = 20_000;
const RETRY_DELAYS = [4000, 10_000, 30_000];
const MAX_SECONDS_PER_SAVE = 120;

const localKey = (roomId: string) => `marginalia:place:${roomId}`;

interface LocalPlace {
  anchor: Anchor;
  progress: number;
  savedAt: number;
}

/**
 * Where to open the book: the server's saved place, unless this device holds a
 * newer one that never made it to the server (closed the tab while offline).
 */
export function resumeAnchor(roomId: string, format: BookFormat, server: { anchor: unknown; last_read_at: string } | null): Anchor | null {
  const fromServer = server ? parseAnchor(server.anchor, format) : null;
  try {
    const raw = localStorage.getItem(localKey(roomId));
    if (raw) {
      const local = JSON.parse(raw) as LocalPlace;
      const anchor = parseAnchor(local.anchor, format);
      const serverTime = server ? new Date(server.last_read_at).getTime() : 0;
      if (anchor && local.savedAt > serverTime + 2000) return anchor;
    }
  } catch {
    // no usable local copy
  }
  return fromServer;
}

/**
 * Persists reading progress: debounced, never per scroll pixel, retried on
 * failure, flushed when the tab is hidden or closed.
 */
export function useProgressSaver({ roomId, initialFurthest, lockedPositions, onUnlocked, onCompleted }: Options) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [furthest, setFurthest] = useState(initialFurthest);
  const pending = useRef<ViewerLocation | null>(null);
  const lastSaved = useRef<{ reach: number; anchorKey: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingAt = useRef<number | null>(null);
  const saving = useRef(false);
  const retries = useRef(0);
  const activeSince = useRef(0);
  const callbacks = useRef({ onUnlocked, onCompleted });
  const locked = useRef(lockedPositions);
  const furthestRef = useRef(initialFurthest);
  // `save` re-schedules itself (retry / follow-up); it does so through this ref.
  const saveAgain = useRef<() => void>(() => {});

  useEffect(() => {
    callbacks.current = { onUnlocked, onCompleted };
    locked.current = lockedPositions;
  });

  useEffect(() => {
    activeSince.current = Date.now();
  }, []);

  /** Seconds of attention since the last save (only counted while the tab is visible). */
  const takeSeconds = useCallback(() => {
    const now = Date.now();
    const seconds = document.visibilityState === "visible" ? Math.round((now - activeSince.current) / 1000) : 0;
    activeSince.current = now;
    return Math.min(MAX_SECONDS_PER_SAVE, Math.max(0, seconds));
  }, []);

  const buildArgs = useCallback(
    (location: ViewerLocation) => ({
      p_room_id: roomId,
      p_position: roundProgress(location.reach),
      p_anchor: location.anchor,
      p_label: location.label,
      p_chapter_index: location.chapterIndex,
      p_chapter_label: location.chapterLabel,
      p_seconds: takeSeconds(),
    }),
    [roomId, takeSeconds],
  );

  const save = useCallback(async () => {
    if (saving.current || !pending.current) return;
    const location = pending.current;
    const anchorKey = JSON.stringify(location.anchor);
    if (lastSaved.current && lastSaved.current.reach === location.reach && lastSaved.current.anchorKey === anchorKey) {
      pending.current = null;
      return;
    }
    saving.current = true;
    pending.current = null;
    firstPendingAt.current = null;
    setStatus("saving");

    const { data, error } = await getSupabase().rpc("save_progress", buildArgs(location));
    saving.current = false;

    if (error) {
      // Keep the newest place queued and try again shortly; the local copy protects a reload meanwhile.
      pending.current ??= location;
      setStatus("error");
      const delay = RETRY_DELAYS[Math.min(retries.current, RETRY_DELAYS.length - 1)];
      retries.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => saveAgain.current(), delay);
      return;
    }

    retries.current = 0;
    lastSaved.current = { reach: location.reach, anchorKey };
    const result = data as SaveResult;
    furthestRef.current = result.furthest;
    setFurthest(result.furthest);
    setStatus("saved");
    if (result.unlocked.length > 0) callbacks.current.onUnlocked(result.unlocked);
    if (result.completed) callbacks.current.onCompleted();
    // Something newer arrived while we were saving.
    if (pending.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => saveAgain.current(), DWELL_MS);
    }
  }, [buildArgs]);

  useEffect(() => {
    saveAgain.current = () => void save();
  }, [save]);

  /** Called by the viewer on every page change / scroll stop. */
  const report = useCallback(
    (location: ViewerLocation) => {
      pending.current = location;
      try {
        const place: LocalPlace = { anchor: location.anchor, progress: location.progress, savedAt: Date.now() };
        localStorage.setItem(localKey(roomId), JSON.stringify(place));
      } catch {
        // storage full / unavailable: the server copy is the one that matters
      }

      const now = Date.now();
      firstPendingAt.current ??= now;
      // A locked note within reach → settle faster so the reveal feels immediate.
      const reveals = locked.current.some((position) => position <= location.reach && position > furthestRef.current - 1e-9);
      const dwell = reveals ? DWELL_WITH_UNLOCK_MS : DWELL_MS;
      const waited = now - firstPendingAt.current;
      const delay = waited >= MAX_WAIT_MS ? 0 : Math.min(dwell, MAX_WAIT_MS - waited);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), delay);
    },
    [roomId, save],
  );

  // Leaving the page: send whatever is queued with a request that survives the unload.
  const flush = useCallback(() => {
    const location = pending.current;
    if (!location) return;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        if (!token) return;
        void fetch(`${supabaseUrl()}/rest/v1/rpc/save_progress`, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", apikey: supabasePublishableKey(), Authorization: `Bearer ${token}` },
          body: JSON.stringify(buildArgs(location)),
        }).catch(() => {});
      });
  }, [buildArgs]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else activeSince.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  /** Saves the current place right away (leaving a note somewhere means you have been there). */
  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void save();
  }, [save]);

  return { report, saveNow, status, furthest };
}
