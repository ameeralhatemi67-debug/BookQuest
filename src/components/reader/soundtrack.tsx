"use client";

import { Headphones, Music2, Pause, Play, Plus, SkipForward, Square, Trash2, Volume2, X } from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PortalContainerContext, Sheet, SheetClose, SheetContent, Tooltip } from "@/components/ui/overlay";
import { cn } from "@/lib/format";
import { ATTACHMENT_ACCEPT, ATTACHMENT_RULES, formatLimit, validateAttachment } from "@/lib/limits";
import { pageCue, type SoundtrackTrack } from "@/lib/soundtrack";
import { startUpload, type UploadHandle, type UploadState } from "@/lib/storage/upload";
import { getSupabase } from "@/lib/supabase/client";
import type { ViewerLocation } from "./types";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function Soundtrack({ roomId, meId, location, furthest, revision, archived, canModerate }: {
  roomId: string; meId: string; location: ViewerLocation | null; furthest: number;
  revision: number; archived: boolean; canModerate: boolean;
}) {
  const supabase = getSupabase();
  const audio = useRef<HTMLAudioElement>(null);
  const upload = useRef<UploadHandle | null>(null);
  const [draft, setDraft] = useState<SoundtrackTrack | null>(null);
  const portal = useContext(PortalContainerContext);
  const request = useRef(0);
  const played = useRef(new Set<string>());
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<SoundtrackTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SoundtrackTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [auto, setAuto] = useState(false);
  const [volume, setVolume] = useState(0.35);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [cue, setCue] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [fraction, setFraction] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const activeUpload = uploadState === "uploading" || uploadState === "retrying" || uploadState === "paused";

  const refresh = useCallback(async () => {
    const { data, error: failure } = await supabase.from("soundtrack_tracks").select("*").eq("room_id", roomId).order("created_at");
    if (failure) { setError("The soundtrack couldn't load. Check your connection and retry."); setLoading(false); return; }
    setTracks((data ?? []) as SoundtrackTrack[]);
    setError(""); setLoading(false);
  }, [roomId, supabase]);

  useEffect(() => {
    let cancelled = false;
    // Re-fetch on saved progress: RLS may now reveal another page cue.
    void supabase.from("soundtrack_tracks").select("*").eq("room_id", roomId).order("created_at").then(({ data, error: failure }) => {
      if (cancelled) return;
      setLoading(false);
      if (failure) setError("The soundtrack couldn't load. Check your connection and retry.");
      else { setTracks((data ?? []) as SoundtrackTrack[]); setError(""); }
    });
    return () => { cancelled = true; };
  }, [roomId, furthest, revision, supabase]);

  useEffect(() => {
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [refresh]);
  useEffect(() => () => { request.current++; void upload.current?.cancel(); }, []);

  const play = useCallback(async (track: SoundtrackTrack) => {
    const id = ++request.current;
    audio.current?.pause();
    setBuffering(true); setError("");
    const { data, error: failure } = await supabase.storage.from("soundtracks").createSignedUrl(track.storage_path, 3600);
    if (request.current !== id) return;
    if (failure || !data?.signedUrl || !audio.current) {
      setBuffering(false); setError("This track couldn't open. Check your connection and tap Play to retry."); return;
    }
    setSelected(track); setTime(0); setDuration(0); setHidden(false);
    audio.current.src = data.signedUrl;
    audio.current.volume = volume;
    try { await audio.current.play(); }
    catch (failure) {
      if (request.current !== id) return;
      setBuffering(false);
      setError((failure as Error).name === "NotAllowedError" ? "Your browser needs a tap. Press Play to start this track." : "Audio couldn't play. Retry, or choose a format your browser supports.");
    }
  }, [supabase, volume]);

  useEffect(() => {
    if (!auto || !location) return;
    const track = pageCue(tracks, location.progress, Math.min(location.reach, furthest), played.current);
    if (track) { played.current.add(track.id); void play(track); }
  }, [auto, location, furthest, tracks, play]);

  // A removed track or revoked membership must stop playback too.
  useEffect(() => {
    if (selected && !loading && !error && !tracks.some((t) => t.id === selected.id)) {
      request.current++;
      audio.current?.pause();
      audio.current?.removeAttribute("src");
    }
  }, [tracks, selected, loading, error]);

  const stop = () => {
    request.current++;
    audio.current?.pause();
    if (audio.current?.src) audio.current.currentTime = 0;
    setBuffering(false); setTime(0);
    // Stop also disarms future cues; hiding leaves playback alone.
    setAuto(false);
  };
  const toggle = () => {
    if (playing) { audio.current?.pause(); return; }
    const track = selected ?? tracks.find((t) => t.ready);
    if (track && selected && audio.current?.getAttribute("src") && !error) {
      void audio.current.play().catch(() => setError("Tap Play to retry this track."));
    } else if (track) void play(track);
  };
  const next = () => {
    const playlist = tracks.filter((t) => t.ready && (t.starts_at === null || t.id === selected?.id));
    const index = playlist.findIndex((t) => t.id === selected?.id);
    const track = playlist[index + 1];
    if (track) void play(track);
    else stop();
  };

  const remove = async (track: SoundtrackTrack) => {
    setRemoving(track.id);
    const { error: storageError } = await supabase.storage.from("soundtracks").remove([track.storage_path]);
    if (storageError) { toast.error("Audio couldn't be removed. Reconnect and try again."); setRemoving(null); return; }
    const { error: failure } = await supabase.rpc("delete_soundtrack_track", { p_track_id: track.id });
    if (failure) toast.error("The track couldn't be removed. Try again.");
    else {
      if (selected?.id === track.id) { stop(); setSelected(null); }
      if (draft?.id === track.id) { setDraft(null); setFile(null); setUploadState(null); setUploadError(""); }
      await refresh();
    }
    setRemoving(null);
  };

  const add = async () => {
    if (!file || !title.trim() || activeUpload) return;
    const valid = validateAttachment(file, "audio");
    if (!valid.ok) { setUploadError(valid.error); return; }
    setUploadError(""); setUploadState("uploading");
    try {
      let track = draft;
      if (!track) {
        const { data, error: failure } = await supabase.rpc("create_soundtrack_track", {
          p_room_id: roomId, p_title: title.trim(), p_extension: valid.value.extension,
          p_starts_at: cue && location ? location.progress : null,
          p_location_label: cue ? location?.label : null,
        });
        if (failure) throw failure;
        track = data as SoundtrackTrack;
        setDraft(track);
      }
      upload.current = startUpload({ client: supabase, bucket: "soundtracks", path: track.storage_path,
        file, contentType: valid.value.contentType, upsert: true,
        onProgress: (p) => setFraction(p.fraction), onStateChange: (state) => { if (state !== "done") setUploadState(state); } });
      await upload.current.done;
      const { error: failure } = await supabase.rpc("finalize_soundtrack_track", { p_track_id: track.id });
      if (failure) throw failure;
      setDraft(null); upload.current = null;
      setFile(null); setTitle(""); setUploadState(null); setFraction(0);
      await refresh(); toast.success(cue ? "Music left on this page" : "Added to the soundtrack");
    } catch (failure) {
      setUploadState("failed");
      setUploadError((failure as Error).message || "Upload failed. Your file is ready to retry.");
      await refresh();
    }
  };

  return <>
    <Tooltip label="Soundtrack" side="bottom">
      <button type="button" aria-label="Soundtrack" aria-pressed={open} className={cn("reader-tool relative", (open || playing) && "bg-accent-soft text-accent-ink")}
        onClick={() => { setOpen(true); setHidden(false); }}>
        <Headphones className="size-5" aria-hidden />
        {playing && <span className="sound-wave absolute -bottom-0.5" aria-hidden><i /><i /><i /></span>}
      </button>
    </Tooltip>
    <audio ref={audio} preload="none" onPlay={() => { setPlaying(true); setBuffering(false); }}
      onPause={() => setPlaying(false)} onEnded={next} onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)}
      onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
      onError={() => { setPlaying(false); setBuffering(false); setError("Audio interrupted. Reconnect and tap Play to retry, or try a different audio format."); }} />

    {portal && selected && !hidden && !open && createPortal(<div className="soundtrack-dock animate-fade-up" aria-label="Music player" data-testid="music-player">
      <button type="button" className="reader-tool bg-accent text-on-accent hover:bg-accent-hover" aria-label={playing ? "Pause music" : "Play music"} onClick={toggle} disabled={buffering}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(true)} aria-label="Open soundtrack">
        <span className="block truncate text-sm font-medium">{selected.title}</span>
        <span className="block text-xs text-ink-soft">{buffering ? "Loading audio…" : error ? "Tap to retry" : playing ? "Now playing" : "Paused"}</span>
      </button>
      <button type="button" className="reader-tool" onClick={stop} aria-label="Stop music"><Square className="size-4" /></button>
      <button type="button" className="reader-tool" onClick={() => setHidden(true)} aria-label="Hide music player"><X className="size-4" /></button>
    </div>, portal)}

    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent title="Soundtrack">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-2xl">Soundtrack</h2>
          <SheetClose className="reader-tool" aria-label="Close soundtrack"><X className="size-5" /></SheetClose>
        </header>
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-5">
          <p className="text-sm leading-relaxed text-ink-soft">A little atmosphere, shared. Add a track for the whole book, or leave music on this page for a friend to find.</p>
          <label className="my-5 flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl bg-sunk px-3 py-2">
            <span className="text-sm font-medium">Play music when I reach a page cue</span>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-5 shrink-0 accent-accent" />
          </label>
          {selected && <div className="mb-5 space-y-3" data-testid="soundtrack-controls">
            <p className="truncate font-display text-xl">{selected.title}</p>
            <div className="flex items-center gap-2">
              <Button onClick={toggle} loading={buffering} icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}>{playing ? "Pause" : "Play"}</Button>
              <Button variant="secondary" onClick={stop} icon={<Square className="size-4" />}>Stop</Button>
              <Button variant="ghost" size="icon" onClick={next} aria-label="Next track"><SkipForward className="size-5" /></Button>
              <span className="ml-auto text-xs tabular-nums text-ink-soft">{clock(time)} / {clock(duration)}</span>
            </div>
            <input type="range" aria-label="Track position" min={0} max={duration || 1} step={1} value={Math.min(time, duration || 1)} disabled={!duration}
              onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} className="h-11 w-full accent-accent" />
            <label className="flex items-center gap-3 text-sm text-ink-soft"><Volume2 className="size-4" aria-hidden />Volume
              <input type="range" aria-label="Music volume" min={0} max={1} step={0.05} value={volume} className="h-11 min-w-0 flex-1 accent-accent"
                onChange={(e) => { const value = Number(e.target.value); setVolume(value); if (audio.current) audio.current.volume = value; }} />
            </label>
          </div>}
          {error && <div role="alert" className="mb-4 text-sm text-danger"><p>{error}</p><Button variant="ghost" onClick={() => { void refresh(); if (selected) void play(selected); }}>Retry</Button></div>}
          {loading ? <p role="status" className="py-8 text-sm text-ink-soft">Loading the soundtrack…</p> : tracks.length === 0 ?
            <div className="py-8 text-center"><Music2 className="mx-auto size-7 text-accent" aria-hidden /><h3 className="mt-3 text-xl">Every book has a mood</h3><p className="mt-2 text-sm text-ink-soft">Add its first track below. Page surprises appear as you reach them.</p></div> :
            <ol className="divide-y divide-line" aria-label="Room playlist">{tracks.map((track, i) => <li key={track.id} className="group flex items-center gap-2 py-3">
              <button type="button" disabled={!track.ready || buffering} onClick={() => void play(track)} aria-label={`Play ${track.title}`}
                className={cn("reader-tool shrink-0", selected?.id === track.id && "bg-accent-soft text-accent-ink")}>
                {selected?.id === track.id && playing ? <span className="sound-wave" aria-hidden><i /><i /><i /></span> : <Play className="size-4" />}
              </button>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{!track.ready ? "Unfinished upload. Retry or remove." : track.starts_at !== null ? `Page cue · ${track.location_label ?? `${Math.round(Number(track.starts_at) * 100)}%`}` : `Track ${i + 1} · Whole book`}</p></div>
              {(track.author_id === meId || canModerate) && <button type="button" disabled={removing === track.id || activeUpload} onClick={() => void remove(track)} aria-label={`Remove ${track.title}`} className="reader-tool shrink-0 text-ink-soft hover:text-danger"><Trash2 className="size-4" /></button>}
            </li>)}</ol>}
          {!archived && <section className="mt-6 border-t border-line pt-5" aria-label="Add music">
            <h3 className="text-xl">Leave a little music</h3>
            <div className="mt-4 space-y-4">
              <Field label="Audio file">{(props) => <input {...props} type="file" accept={ATTACHMENT_ACCEPT.audio} disabled={activeUpload || !!draft}
                className="w-full text-sm file:mr-3 file:min-h-11 file:rounded-full file:border file:border-line-strong file:bg-raised file:px-4 file:text-ink hover:file:bg-sunk"
                onChange={(e) => { const picked = e.target.files?.[0]; if (!picked) return; const valid = validateAttachment(picked, "audio"); if (!valid.ok) { setUploadError(valid.error); return; } setFile(picked); setTitle(picked.name.replace(/\.[^.]+$/, "")); setUploadError(""); }} />}</Field>
              <Field label="Track name">{(props) => <Input {...props} maxLength={160} value={title} disabled={activeUpload || !!draft} onChange={(e) => setTitle(e.target.value)} placeholder="Something to read by" />}</Field>
              <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={cue} disabled={activeUpload || !!draft || !location} onChange={(e) => setCue(e.target.checked)} className="size-5 accent-accent" />Start when a friend reaches this page</label>
              {cue && location && <p className="text-xs text-ink-soft">{location.label}. Hidden from friends until they get here.</p>}
              <p className="text-xs text-ink-soft">MP3, M4A, WAV, OGG and other audio, up to {formatLimit(ATTACHMENT_RULES.audio.maxBytes)}. MP3 works on the widest range of phones.</p>
              {activeUpload && <div role="status" aria-live="polite"><progress max={1} value={fraction} className="h-2 w-full accent-accent" /><p className="mt-2 text-sm text-ink-soft">{uploadState === "paused" ? "Paused" : uploadState === "retrying" ? "Connection dropped. Retrying…" : "Uploading…"} {Math.floor(fraction * 100)}%</p>
                <div className="mt-2 flex gap-2">{file && file.size > 6 * 1024 * 1024 && <Button variant="secondary" onClick={() => uploadState === "paused" ? upload.current?.resume() : upload.current?.pause()}>{uploadState === "paused" ? "Resume upload" : "Pause upload"}</Button>}
                  <Button variant="ghost" onClick={() => void upload.current?.cancel()}>Cancel upload</Button></div></div>}
              {uploadError && <p role="alert" className="text-sm text-danger">{uploadError}</p>}
              <Button onClick={() => void add()} disabled={!file || !title.trim() || activeUpload} icon={<Plus className="size-4" />}>{uploadState === "failed" ? "Retry audio upload" : cue ? "Leave music here" : "Add to soundtrack"}</Button>
            </div>
          </section>}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}
