import { expect, it } from "vitest";
import { pageCue, type SoundtrackTrack } from "../../src/lib/soundtrack";
it("plays a cue on this page once, without firing skipped cues or playlist music", () => {
  const tracks = [null, 0.1, 0.5, 0.9].map((starts_at, i) => ({ id: String(i), ready: true, starts_at }) as SoundtrackTrack);
  expect(pageCue(tracks, 0.4, 0.6, new Set())?.id).toBe("2");
  expect(pageCue(tracks, 0.4, 0.6, new Set(["2"]))).toBeUndefined();
  expect(pageCue(tracks, 0.7, 0.8, new Set())).toBeUndefined();
});
