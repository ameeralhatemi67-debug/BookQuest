export interface SoundtrackTrack {
  id: string;
  room_id: string;
  author_id: string;
  title: string;
  storage_path: string;
  starts_at: number | null;
  location_label: string | null;
  ready: boolean;
  created_at: string;
}

/** Only cue tracks on the visible page; a jump never plays every skipped cue. */
export function pageCue(tracks: SoundtrackTrack[], start: number, end: number, played: Set<string>) {
  return tracks.find((t) => t.ready && t.starts_at !== null && Number(t.starts_at) >= start - 0.000001 && Number(t.starts_at) <= end + 0.000001 && !played.has(t.id));
}
