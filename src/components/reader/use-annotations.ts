"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "@/lib/errors";
import { validateAttachment, type AttachmentKind } from "@/lib/limits";
import type { Anchor } from "@/lib/location";
import type { RoomChange } from "@/lib/realtime/use-room-channel";
import { startUpload } from "@/lib/storage/upload";
import { getSupabase } from "@/lib/supabase/client";
import type { Attachment, Marker, NoteContent, Reaction, Reply, Unlock } from "@/lib/types";

/** Everything behind one marker — only ever loaded for notes this reader may open. */
export interface NoteBundle {
  content: NoteContent | null;
  attachments: Attachment[];
  replies: Reply[];
  reactions: Reaction[];
  status: "loading" | "ready" | "unavailable";
}

export interface NewNote {
  anchor: Anchor;
  position: number;
  label: string;
  body?: string;
  emoji?: string;
  link?: string;
  quote?: string | null;
  files?: File[];
}

export interface UploadingState {
  fileName: string;
  index: number;
  count: number;
  fraction: number;
}

const MARKER_COLUMNS = "id, room_id, book_id, author_id, position, anchor, location_label, published_at, created_at";

/** Reads duration / dimensions locally so the note can show them without downloading the media. */
async function probeMedia(file: File, kind: AttachmentKind): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  type Probe = { duration: number | null; width: number | null; height: number | null };
  const empty: Probe = { duration: null, width: null, height: null };
  try {
    if (kind === "image") {
      const bitmap = await createImageBitmap(file);
      const size = { duration: null, width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }
    return await new Promise((resolve) => {
      const element = document.createElement(kind === "audio" ? "audio" : "video");
      const url = URL.createObjectURL(file);
      const done = (value: Probe) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timeout = setTimeout(() => done(empty), 5000);
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        clearTimeout(timeout);
        const duration = Number.isFinite(element.duration) ? Math.round(element.duration * 100) / 100 : null;
        const video = element as HTMLVideoElement;
        done({ duration, width: kind === "video" ? video.videoWidth || null : null, height: kind === "video" ? video.videoHeight || null : null });
      };
      element.onerror = () => {
        clearTimeout(timeout);
        done(empty);
      };
      element.src = url;
    });
  } catch {
    return empty;
  }
}

export function useAnnotations({ roomId, meId }: { roomId: string; meId: string }) {
  const supabase = getSupabase();
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [unlocks, setUnlocks] = useState<Map<string, Unlock>>(new Map());
  const [notes, setNotes] = useState<Map<string, NoteBundle>>(new Map());
  /** Unlocked during this session — drives the reveal animation. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedIds = useRef(new Set<string>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Reads the neutral markers of the room and this reader's unlocks. */
  const fetchTrail = useCallback(async () => {
    const [markerResult, unlockResult] = await Promise.all([
      supabase.from("annotation_markers").select(MARKER_COLUMNS).eq("room_id", roomId).order("position", { ascending: true }),
      supabase.from("reading_unlocks").select("marker_id, via, unlocked_at, seen_at").eq("room_id", roomId).eq("user_id", meId),
    ]);
    const failure = markerResult.error ?? unlockResult.error;
    if (failure) return { error: friendlyError(failure, "Couldn't load the notes in this book.") } as const;
    return {
      error: null,
      // Drafts (a note whose media is still uploading) are not shown as markers.
      markers: ((markerResult.data ?? []) as Marker[]).filter((m) => m.published_at),
      unlocks: new Map(((unlockResult.data ?? []) as Unlock[]).map((u) => [u.marker_id, u])),
    } as const;
  }, [meId, roomId, supabase]);

  const applyTrail = useCallback((trail: Awaited<ReturnType<typeof fetchTrail>>) => {
    setError(trail.error);
    if (trail.error !== null) return;
    setMarkers(trail.markers);
    setUnlocks(trail.unlocks);
    setLoaded(true);
  }, []);

  const refreshMarkers = useCallback(async () => applyTrail(await fetchTrail()), [applyTrail, fetchTrail]);

  useEffect(() => {
    let cancelled = false;
    void fetchTrail().then((trail) => {
      if (!cancelled) applyTrail(trail);
    });
    return () => {
      cancelled = true;
    };
  }, [applyTrail, fetchTrail]);

  const isOpen = useCallback((marker: Marker) => marker.author_id === meId || unlocks.has(marker.id), [meId, unlocks]);

  /** Loads the protected payload for notes. The database only returns rows this reader may see. */
  const loadNotes = useCallback(
    async (ids: string[], force = false) => {
      const wanted = ids.filter((id) => force || !loadedIds.current.has(id));
      if (wanted.length === 0) return;
      wanted.forEach((id) => loadedIds.current.add(id));
      setNotes((current) => {
        const next = new Map(current);
        for (const id of wanted) if (!next.has(id)) next.set(id, { content: null, attachments: [], replies: [], reactions: [], status: "loading" });
        return next;
      });

      const [contents, attachments, replies, reactions] = await Promise.all([
        supabase.from("annotation_contents").select("marker_id, body, emoji, link_url, quote, edited_at").in("marker_id", wanted),
        supabase.from("annotation_attachments").select("id, marker_id, kind, bucket, path, mime_type, size_bytes, duration_seconds, width, height, original_name").in("marker_id", wanted),
        supabase.from("annotation_replies").select("id, marker_id, author_id, body, created_at").in("marker_id", wanted).order("created_at", { ascending: true }),
        supabase.from("annotation_reactions").select("id, marker_id, user_id, emoji").in("marker_id", wanted),
      ]);

      if (contents.error) {
        // Let a later attempt retry instead of caching the failure.
        wanted.forEach((id) => loadedIds.current.delete(id));
      }

      setNotes((current) => {
        const next = new Map(current);
        for (const id of wanted) {
          const content = ((contents.data ?? []) as NoteContent[]).find((c) => c.marker_id === id) ?? null;
          next.set(id, {
            content,
            attachments: ((attachments.data ?? []) as Attachment[]).filter((a) => a.marker_id === id),
            replies: ((replies.data ?? []) as Reply[]).filter((r) => r.marker_id === id),
            reactions: ((reactions.data ?? []) as Reaction[]).filter((r) => r.marker_id === id),
            status: content ? "ready" : "unavailable",
          });
        }
        return next;
      });
    },
    [supabase],
  );

  /** Called with the ids save_progress just unlocked: make them readable immediately and play the reveal. */
  const markUnlocked = useCallback(
    (ids: string[]) => {
      const now = new Date().toISOString();
      setUnlocks((current) => {
        const next = new Map(current);
        for (const id of ids) if (!next.has(id)) next.set(id, { marker_id: id, via: "reached", unlocked_at: now, seen_at: null });
        return next;
      });
      setFresh((current) => new Set([...current, ...ids]));
      // A note may have been created moments ago: make sure its marker is known.
      void refreshMarkers();
      void loadNotes(ids, true);
    },
    [loadNotes, refreshMarkers],
  );

  const markSeen = useCallback(
    async (ids: string[]) => {
      const unseen = ids.filter((id) => unlocks.get(id) && !unlocks.get(id)!.seen_at);
      setFresh((current) => {
        if (!ids.some((id) => current.has(id))) return current;
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      if (unseen.length === 0) return;
      const now = new Date().toISOString();
      setUnlocks((current) => {
        const next = new Map(current);
        for (const id of unseen) next.set(id, { ...next.get(id)!, seen_at: now });
        return next;
      });
      await supabase.rpc("mark_annotations_seen", { p_marker_ids: unseen });
    },
    [supabase, unlocks],
  );

  // ------------------------------------------------------------ writing
  const createNote = useCallback(
    async (note: NewNote, onUpload?: (state: UploadingState | null) => void): Promise<string> => {
      const files = note.files ?? [];
      const validated = files.map((file) => ({ file, check: validateAttachment(file) }));
      const invalid = validated.find((v) => !v.check.ok);
      if (invalid && !invalid.check.ok) throw new Error(`${invalid.file.name}: ${invalid.check.error}`);

      const { data, error: createError } = await supabase.rpc("create_annotation", {
        p_room_id: roomId,
        p_position: note.position,
        p_anchor: note.anchor,
        p_location_label: note.label,
        p_body: note.body?.trim() || null,
        p_emoji: note.emoji || null,
        p_link_url: note.link?.trim() || null,
        p_quote: note.quote ?? null,
        // With media, the note stays a private draft until every file is safely stored.
        p_publish: files.length === 0,
      });
      if (createError) throw new Error(friendlyError(createError));
      const markerId = data as string;

      if (files.length > 0) {
        try {
          for (let index = 0; index < validated.length; index++) {
            const { file, check } = validated[index];
            if (!check.ok) continue;
            const { kind, bucket, contentType, extension } = check.value;
            const path = `${roomId}/${markerId}/${crypto.randomUUID()}.${extension}`;
            onUpload?.({ fileName: file.name, index, count: files.length, fraction: 0 });
            const upload = startUpload({
              client: supabase, bucket, path, file, contentType,
              onProgress: (p) => onUpload?.({ fileName: file.name, index, count: files.length, fraction: p.fraction }),
            });
            await upload.done;
            const meta = await probeMedia(file, kind);
            const { error: rowError } = await supabase.from("annotation_attachments").insert({
              marker_id: markerId, room_id: roomId, kind, bucket, path, mime_type: contentType, size_bytes: file.size,
              duration_seconds: meta.duration, width: meta.width, height: meta.height, original_name: file.name.slice(0, 300),
            });
            if (rowError) throw rowError;
          }
          const { error: publishError } = await supabase.rpc("publish_annotation", { p_marker_id: markerId });
          if (publishError) throw publishError;
        } catch (uploadError) {
          // Don't leave a half-built note behind.
          await supabase.rpc("remove_annotation", { p_marker_id: markerId });
          onUpload?.(null);
          throw new Error(uploadError instanceof Error && uploadError.name === "UploadError" ? uploadError.message : friendlyError(uploadError, "The attachment couldn't be uploaded. Your note wasn't posted."));
        }
        onUpload?.(null);
      }

      await refreshMarkers();
      void loadNotes([markerId], true);
      return markerId;
    },
    [loadNotes, refreshMarkers, roomId, supabase],
  );

  const addReply = useCallback(
    async (markerId: string, body: string) => {
      const { error: rpcError } = await supabase.rpc("add_reply", { p_marker_id: markerId, p_body: body });
      if (rpcError) throw new Error(friendlyError(rpcError));
      await loadNotes([markerId], true);
    },
    [loadNotes, supabase],
  );

  const toggleReaction = useCallback(
    async (markerId: string, emoji: string) => {
      // Optimistic: reactions should feel instant.
      setNotes((current) => {
        const bundle = current.get(markerId);
        if (!bundle) return current;
        const mine = bundle.reactions.find((r) => r.user_id === meId && r.emoji === emoji);
        const reactions = mine ? bundle.reactions.filter((r) => r !== mine) : [...bundle.reactions, { id: `temp-${emoji}`, marker_id: markerId, user_id: meId, emoji }];
        return new Map(current).set(markerId, { ...bundle, reactions });
      });
      const { error: rpcError } = await supabase.rpc("toggle_reaction", { p_marker_id: markerId, p_emoji: emoji });
      await loadNotes([markerId], true);
      if (rpcError) throw new Error(friendlyError(rpcError));
    },
    [loadNotes, meId, supabase],
  );

  const removeNote = useCallback(
    async (markerId: string) => {
      const { error: rpcError } = await supabase.rpc("remove_annotation", { p_marker_id: markerId });
      if (rpcError) throw new Error(friendlyError(rpcError));
      setMarkers((current) => current.filter((m) => m.id !== markerId));
    },
    [supabase],
  );

  const removeReply = useCallback(
    async (markerId: string, replyId: string) => {
      const { error: rpcError } = await supabase.rpc("remove_reply", { p_reply_id: replyId });
      if (rpcError) throw new Error(friendlyError(rpcError));
      await loadNotes([markerId], true);
    },
    [loadNotes, supabase],
  );

  // ------------------------------------------------------------ live updates
  const onChange = useCallback(
    (change: RoomChange) => {
      if (change.table === "annotation_markers" || change.table === "reading_unlocks") {
        // A marker appeared / was removed, or something behind us became readable.
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void refreshMarkers(), 200);
        return;
      }
      if (change.table === "annotation_replies" || change.table === "annotation_reactions" || change.table === "annotation_contents") {
        const markerId = String(change.row.marker_id ?? "");
        if (markerId && loadedIds.current.has(markerId)) void loadNotes([markerId], true);
        else if (change.type === "DELETE") {
          // DELETE events only carry the primary key: refresh whatever is open.
          const open = [...loadedIds.current];
          if (open.length > 0 && open.length <= 20) void loadNotes(open, true);
        }
      }
    },
    [loadNotes, refreshMarkers],
  );

  const resync = useCallback(() => {
    void refreshMarkers();
    const open = [...loadedIds.current];
    if (open.length > 0) void loadNotes(open.slice(-30), true);
  }, [loadNotes, refreshMarkers]);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const lockedPositions = useMemo(() => markers.filter((m) => !isOpen(m)).map((m) => m.position), [markers, isOpen]);

  return {
    markers, unlocks, notes, fresh, loaded, error, lockedPositions,
    isOpen, refreshMarkers, loadNotes, markUnlocked, markSeen,
    createNote, addReply, toggleReaction, removeNote, removeReply,
    onChange, resync,
  };
}

export type Annotations = ReturnType<typeof useAnnotations>;
