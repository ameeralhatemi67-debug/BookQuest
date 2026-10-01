"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { supabasePublishableKey, supabaseUrl } from "@/lib/config";
import type { ReadingStats } from "@/lib/types";
import type { ViewerLocation } from "./types";

export type ReadingState = "reading" | "scanning" | "revisiting" | "paused";
export interface ReadingSample { id: string; start: number; end: number; words: number; seconds: number; kind: ReadingState; wpm?: number }

/** Repeated visits add time, never multiply passage coverage. Fast flips do not set the pace. */
export function readingPace(words: number, seconds: number, previous: number): number {
  const observed = words * 60 / seconds;
  return seconds >= 8 && observed >= 80 && observed <= 600 ? Math.round(previous * 0.8 + observed * 0.2) : previous;
}
export function readingIdleLimit(words: number, wpm: number): number {
  return Math.max(45, Math.min(600, words / Math.max(100, wpm) * 120 + 15));
}

interface Result extends ReadingStats { completed: boolean; accepted: { id: string; seconds: number }[] }

export function useReadingCoverage({ roomId, userId, location, paused, initial, onCompleted }: {
  roomId: string; userId: string; location: ViewerLocation | null; paused: boolean; initial: ReadingStats | null; onCompleted: () => void;
}) {
  const [stats, setStats] = useState<ReadingStats>(initial ?? {});
  const [state, setState] = useState<ReadingState>("paused");
  const [pending, setPending] = useState(false);
  const callback = useRef(onCompleted);
  const flags = useRef({ paused, location });
  const session = useRef({ view: null as ViewerLocation | null, seconds: 0, spent: 0, settled: 0, input: 0, highWater: 0, lastTick: 0, wpm: initial?.estimated_wpm ?? 240, calibrated: false, kind: "reading" as ReadingState });
  const queue = useRef<ReadingSample[]>([]);
  const sending = useRef(false);
  const storageKey = `marginalia:reading:${userId}:${roomId}`;
  useEffect(() => { callback.current = onCompleted; flags.current = { paused, location }; });

  useEffect(() => {
    let alive = true;
    const s = session.current;
    s.lastTick = s.input = s.settled = Date.now();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved?.savedAt > Date.now() - 24 * 60 * 60_000 && Array.isArray(saved.samples)) {
        queue.current = saved.samples.filter((v: ReadingSample) => typeof v.id === "string" && Number.isFinite(v.seconds) && v.seconds > 0 && v.start >= 0 && v.end <= 1 && v.end > v.start).slice(0, 100);
      }
    } catch { /* no usable offline copy */ }
    const persist = () => {
      try { localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), samples: queue.current })); } catch { /* server remains authoritative */ }
    };
    const collect = () => {
      if (!s.view || s.seconds < 0.1 || s.view.reach <= s.view.progress) return;
      const sample: ReadingSample = { id: crypto.randomUUID(), start: s.view.progress, end: s.view.reach, words: Math.max(1, Math.min(5000, s.view.visibleWords ?? 250)), seconds: Math.min(300, s.seconds), kind: s.kind };
      if (s.calibrated) sample.wpm = s.wpm;
      const last = queue.current.at(-1);
      if (last && last.start === sample.start && last.end === sample.end && last.kind === sample.kind && last.seconds + sample.seconds <= 300) last.seconds += sample.seconds;
      else if (queue.current.length < 100) queue.current.push(sample);
      else return; // retain unsent credit; stop adding time until the queue can drain
      s.seconds = 0;
      persist();
    };
    const send = async (leaving = false) => {
      collect();
      if (sending.current || !navigator.onLine) { if (alive) setPending(queue.current.length > 0); return; }
      const batch = queue.current.slice(0, 40).map(v => ({ ...v }));
      sending.current = true;
      try {
        let data: Result;
        if (leaving) {
          const { data: auth } = await getSupabase().auth.getSession();
          if (!auth.session) return;
          const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/record_reading_session`, { method: "POST", keepalive: true,
            headers: { "Content-Type": "application/json", apikey: supabasePublishableKey(), Authorization: `Bearer ${auth.session.access_token}` },
            body: JSON.stringify({ p_room_id: roomId, p_samples: batch }) });
          if (!response.ok) throw Error("reading_not_saved");
          data = await response.json();
        } else {
          const result = await getSupabase().rpc("record_reading_session", { p_room_id: roomId, p_samples: batch });
          if (result.error) throw result.error;
          data = result.data as Result;
        }
        const accepted = new Map(data.accepted.map(v => [v.id, v.seconds]));
        queue.current = queue.current.flatMap(v => {
          const credited = accepted.get(v.id);
          if (credited === undefined) return [v];
          const remaining = v.seconds - credited;
          return remaining > 0.1 ? [{ ...v, id: crypto.randomUUID(), seconds: remaining }] : [];
        });
        persist();
        if (alive) { setStats(data); setPending(queue.current.length > 0); if (data.completed) callback.current(); }
      } catch { if (alive) setPending(queue.current.length > 0); }
      finally { sending.current = false; }
    };
    const activity = () => { s.input = Date.now(); };
    const tick = () => {
      const now = Date.now();
      const elapsed = Math.min(2, (now - s.lastTick) / 1000);
      s.lastTick = now;
      const next = flags.current.location;
      if (next && (!s.view || Math.abs(next.progress - s.view.progress) > 0.00001 || Math.abs(next.reach - s.view.reach) > 0.00001)) {
        const old = s.view;
        collect();
        if (old && s.kind === "reading" && next.progress > old.progress && next.progress <= old.reach + 0.02 && s.spent >= 8 && (old.visibleWords ?? 0) > 0) {
          const pace = readingPace(old.visibleWords!, s.spent, s.wpm);
          if (pace !== s.wpm) { s.wpm = pace; s.calibrated = true; }
        }
        const jump = !old || Math.abs(next.progress - old.progress) > Math.max(0.0001, (old.reach - old.progress) * 0.25);
        if (jump) s.settled = now;
        s.input = now; s.spent = 0;
        s.kind = next.progress + 0.00001 < s.highWater ? "revisiting" : "reading";
        s.view = next;
        if (!old && !flags.current.paused) void send();
      } else if (next) s.view = next; // text-layer word counts can arrive after the initial geometry
      const inactive = !s.view || flags.current.paused || Boolean(document.querySelector('[role="dialog"][data-state="open"]')) || document.visibilityState !== "visible" || !document.hasFocus() || now - s.input > readingIdleLimit(s.view.visibleWords ?? 250, s.wpm) * 1000;
      const scanning = now - s.settled < 1500;
      const phase = inactive ? "paused" : scanning ? "scanning" : s.kind;
      if (!inactive && !scanning && s.view) {
        s.seconds += elapsed; s.spent += elapsed;
        if (s.spent >= 3) s.highWater = Math.max(s.highWater, s.view.progress);
      }
      if (alive) setState(phase);
    };
    const visibility = () => { s.lastTick = Date.now(); if (document.visibilityState === "hidden") void send(true); else s.settled = Date.now(); };
    const leave = () => { void send(true); };
    const reconnect = () => { void send(); };
    const clock = setInterval(tick, 1000);
    const heartbeat = setInterval(() => void send(), 15_000);
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", reconnect);
    if (queue.current.length > 0 || flags.current.location) void send();
    return () => {
      alive = false; clearInterval(clock); clearInterval(heartbeat);
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", leave); window.removeEventListener("online", reconnect);
      collect(); void send(true);
    };
  }, [roomId, userId, storageKey]);
  return { stats, state, pending };
}
