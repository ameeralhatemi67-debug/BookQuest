// Pure layout logic for the shared progress track:
//
//   START ━━━ Amir ━━━ Sara ━━━━━ Fahad ━━━ END
//
// Readers are placed by progress. When several would overlap they are gathered
// into a stack that can be fanned out, so a 12-person room stays readable.
import { clamp01 } from "@/lib/location";

export interface TrackReader {
  id: string;
  progress: number;
}

export interface TrackCluster<T extends TrackReader> {
  /** Where the cluster sits on the track, 0..1. */
  center: number;
  /** Members ordered from furthest-behind to furthest-ahead. */
  readers: T[];
}

export interface TrackLayoutOptions {
  /** Drawable width of the track in px. */
  width: number;
  /** Avatar diameter in px. */
  avatarSize: number;
  /** Fraction of an avatar two neighbours may overlap before they are stacked. */
  overlap?: number;
}

/**
 * Groups readers whose avatars would collide. Greedy single pass over readers
 * sorted by progress: a reader joins the current cluster when their avatar
 * would overlap the cluster's last member by more than `overlap`.
 */
export function layoutTrack<T extends TrackReader>(readers: T[], options: TrackLayoutOptions): TrackCluster<T>[] {
  const { width, avatarSize, overlap = 0.35 } = options;
  if (readers.length === 0) return [];
  const usable = Math.max(1, width);
  // Two avatars collide when their centers are closer than this many px.
  const minDistance = avatarSize * (1 - overlap);

  const sorted = [...readers].sort((a, b) => clamp01(a.progress) - clamp01(b.progress) || a.id.localeCompare(b.id));
  const clusters: TrackCluster<T>[] = [];
  let current: T[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const center = current.reduce((sum, r) => sum + clamp01(r.progress), 0) / current.length;
    clusters.push({ center, readers: current });
    current = [];
  };

  for (const reader of sorted) {
    const last = current[current.length - 1];
    if (last && (clamp01(reader.progress) - clamp01(last.progress)) * usable >= minDistance) flush();
    current.push(reader);
  }
  flush();
  return clusters;
}

/** Percentage gap between two readers, rounded for display ("12% ahead"). */
export function gapPercent(from: number, to: number): number {
  return Math.round((clamp01(to) - clamp01(from)) * 100);
}

export interface Standing<T extends TrackReader> {
  reader: T;
  /** 1 = furthest ahead. Readers at the same progress share a rank. */
  rank: number;
  /** Percentage points behind the leader. */
  behindLeader: number;
}

/** Race-mode standings. Ties share a rank ("1, 1, 3"). */
export function standings<T extends TrackReader>(readers: T[]): Standing<T>[] {
  const sorted = [...readers].sort((a, b) => clamp01(b.progress) - clamp01(a.progress) || a.id.localeCompare(b.id));
  const leader = sorted[0] ? clamp01(sorted[0].progress) : 0;
  let rank = 0;
  let previous = Number.NaN;
  return sorted.map((reader, index) => {
    const progress = Math.round(clamp01(reader.progress) * 1000);
    if (progress !== previous) {
      rank = index + 1;
      previous = progress;
    }
    return { reader, rank, behindLeader: Math.round((leader - clamp01(reader.progress)) * 100) };
  });
}

/**
 * Bins marker positions into `buckets` equal slices of the book, for the
 * little "things left along the way" ticks under the track.
 */
export function markerDensity(positions: number[], buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (const position of positions) {
    out[Math.min(buckets - 1, Math.floor(clamp01(position) * buckets))] += 1;
  }
  return out;
}
