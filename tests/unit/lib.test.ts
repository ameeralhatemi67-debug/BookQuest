import { describe, expect, it, vi } from "vitest";
import { storageBaseUrl } from "@/lib/config";
import { errorCode, friendlyError } from "@/lib/errors";
import { formatBytes, formatClock, formatDuration, initials, isEmojiOnly, plural, timeAgo } from "@/lib/format";
import {
  attachmentKindOf, MB, sniffBookFormat, validateAttachment, validateAvatar, validateBookFile,
} from "@/lib/limits";
import { gapPercent, layoutTrack, markerDensity, standings } from "@/lib/progress-track";
import { ROOM_MODE_LIST, roomMode } from "@/lib/room-modes";

describe("upload validation", () => {
  it("honours a hosted Storage ceiling without increasing smaller limits", async () => {
    vi.stubEnv("NEXT_PUBLIC_UPLOAD_LIMIT_MB", "50");
    vi.resetModules();
    try {
      const rules = await import("@/lib/limits");
      expect(rules.BOOK_RULES.pdf.maxBytes).toBe(50 * MB);
      expect(rules.ATTACHMENT_RULES.image.maxBytes).toBe(25 * MB);
      expect(rules.validateBookFile({ name: "large.pdf", size: 51 * MB, type: "application/pdf" }).ok).toBe(false);
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
  it("accepts EPUB and PDF up to their own ceilings", () => {
    expect(validateBookFile({ name: "Dune.epub", size: 249 * MB, type: "application/epub+zip" })).toMatchObject({ ok: true, value: { format: "epub", contentType: "application/epub+zip" } });
    expect(validateBookFile({ name: "Scan.PDF", size: 499 * MB, type: "application/pdf" })).toMatchObject({ ok: true, value: { format: "pdf" } });
    // Windows often reports no type at all for .epub — the extension decides.
    expect(validateBookFile({ name: "a.epub", size: 1000, type: "" }).ok).toBe(true);
    expect(validateBookFile({ name: "a.epub", size: 1000, type: "application/octet-stream" }).ok).toBe(true);
  });

  it("rejects oversized books with a message that names the limit", () => {
    const epub = validateBookFile({ name: "big.epub", size: 251 * MB, type: "application/epub+zip" });
    expect(epub).toMatchObject({ ok: false });
    expect(!epub.ok && epub.error).toMatch(/250 MB/);
    const pdf = validateBookFile({ name: "big.pdf", size: 501 * MB, type: "application/pdf" });
    expect(!pdf.ok && pdf.error).toMatch(/500 MB/);
  });

  it("rejects other formats and empty files", () => {
    expect(validateBookFile({ name: "book.mobi", size: 10, type: "" }).ok).toBe(false);
    expect(validateBookFile({ name: "setup.exe", size: 10, type: "application/x-msdownload" }).ok).toBe(false);
    expect(validateBookFile({ name: "empty.pdf", size: 0, type: "application/pdf" }).ok).toBe(false);
    expect(validateBookFile({ name: "noextension", size: 10, type: "application/pdf" }).ok).toBe(false);
  });

  it("does not trust the browser's label for books — the bytes decide", () => {
    // Browsers report all sorts of things for .epub; that must not block a real book…
    expect(validateBookFile({ name: "a.epub", size: 1000, type: "application/epub" }).ok).toBe(true);
    // …and a web page renamed to .pdf passes the name check but fails the byte check.
    expect(validateBookFile({ name: "fake.pdf", size: 10, type: "text/html" }).ok).toBe(true);
    expect(sniffBookFormat(new TextEncoder().encode("<!doctype html><html><script>alert(1)</script>"))).toBeNull();
  });

  it("recognises real books by their first bytes, whatever they are named", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n...");
    expect(sniffBookFormat(pdf)).toBe("pdf");

    const epub = new Uint8Array(64);
    epub.set([0x50, 0x4b, 0x03, 0x04]);
    epub.set(new TextEncoder().encode("mimetype"), 30);
    epub.set(new TextEncoder().encode("application/epub+zip"), 38);
    expect(sniffBookFormat(epub)).toBe("epub");

    const exe = new Uint8Array(64);
    exe.set([0x4d, 0x5a, 0x90, 0x00]); // "MZ" — a Windows executable
    expect(sniffBookFormat(exe)).toBeNull();
    const plainZip = new Uint8Array(64);
    plainZip.set([0x50, 0x4b, 0x03, 0x04]);
    expect(sniffBookFormat(plainZip)).toBeNull();
    expect(sniffBookFormat(new Uint8Array(0))).toBeNull();
  });

  it("routes attachments to the right bucket with the right ceiling", () => {
    expect(validateAttachment({ name: "map.PNG", size: 24 * MB, type: "image/png" })).toMatchObject({ ok: true, value: { kind: "image", bucket: "annotation-images", contentType: "image/png" } });
    expect(validateAttachment({ name: "voice.m4a", size: 99 * MB, type: "audio/x-m4a" })).toMatchObject({ ok: true, value: { kind: "audio", bucket: "annotation-audio", contentType: "audio/mp4" } });
    expect(validateAttachment({ name: "clip.mp4", size: 499 * MB, type: "video/mp4" })).toMatchObject({ ok: true, value: { kind: "video", bucket: "annotation-video" } });

    expect(validateAttachment({ name: "map.png", size: 26 * MB, type: "image/png" }).ok).toBe(false);
    expect(validateAttachment({ name: "voice.mp3", size: 101 * MB, type: "audio/mpeg" }).ok).toBe(false);
    expect(validateAttachment({ name: "clip.mp4", size: 501 * MB, type: "video/mp4" }).ok).toBe(false);
  });

  it("refuses executables and documents as attachments", () => {
    for (const name of ["run.exe", "script.js", "page.html", "macro.docm", "archive.zip", "vector.svg"]) {
      expect(validateAttachment({ name, size: 100, type: "" }).ok).toBe(false);
    }
    // An image extension with a non-image MIME type is refused too.
    expect(validateAttachment({ name: "photo.png", size: 100, type: "text/html" }).ok).toBe(false);
  });

  it("tells a recorded voice note (audio/webm) from a video (video/webm)", () => {
    expect(attachmentKindOf({ name: "note.webm", size: 1, type: "audio/webm;codecs=opus" })).toBe("audio");
    expect(attachmentKindOf({ name: "clip.webm", size: 1, type: "video/webm" })).toBe("video");
    expect(validateAttachment({ name: "note.webm", size: 5000, type: "audio/webm;codecs=opus" })).toMatchObject({ ok: true, value: { kind: "audio", contentType: "audio/webm" } });
  });

  it("limits avatars to 10 MB images", () => {
    expect(validateAvatar({ name: "me.jpg", size: 9 * MB, type: "image/jpeg" }).ok).toBe(true);
    expect(validateAvatar({ name: "me.jpg", size: 11 * MB, type: "image/jpeg" }).ok).toBe(false);
    expect(validateAvatar({ name: "me.pdf", size: 100, type: "application/pdf" }).ok).toBe(false);
  });
});

describe("storage host", () => {
  it("sends large uploads to the dedicated Storage hostname on hosted projects", () => {
    expect(storageBaseUrl("https://abcdefghijklmnop.supabase.co")).toBe("https://abcdefghijklmnop.storage.supabase.co");
    expect(storageBaseUrl("https://abcdefghijklmnop.supabase.co/")).toBe("https://abcdefghijklmnop.storage.supabase.co");
  });

  it("leaves local stacks and custom domains alone", () => {
    expect(storageBaseUrl("http://127.0.0.1:56321")).toBe("http://127.0.0.1:56321");
    expect(storageBaseUrl("https://api.example.com")).toBe("https://api.example.com");
  });
});

describe("progress track layout", () => {
  const reader = (id: string, progress: number) => ({ id, progress });

  it("places well-separated readers on their own", () => {
    const clusters = layoutTrack([reader("a", 0.1), reader("b", 0.5), reader("c", 0.9)], { width: 600, avatarSize: 32 });
    expect(clusters.map((c) => c.readers.map((r) => r.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(clusters.map((c) => c.center)).toEqual([0.1, 0.5, 0.9]);
  });

  it("stacks readers whose avatars would overlap", () => {
    const clusters = layoutTrack([reader("a", 0.5), reader("b", 0.51), reader("c", 0.515), reader("d", 0.9)], { width: 600, avatarSize: 32 });
    expect(clusters).toHaveLength(2);
    expect(clusters[0].readers.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(clusters[0].center).toBeCloseTo(0.5083, 3);
  });

  it("depends on the available width: a phone stacks what a desktop spreads out", () => {
    const readers = [reader("a", 0.4), reader("b", 0.45), reader("c", 0.5)];
    expect(layoutTrack(readers, { width: 1000, avatarSize: 32 })).toHaveLength(3);
    expect(layoutTrack(readers, { width: 280, avatarSize: 32 })).toHaveLength(1);
  });

  it("keeps a whole 12-person room readable when everyone is at the start", () => {
    const readers = Array.from({ length: 12 }, (_, i) => reader(`r${i}`, 0));
    const clusters = layoutTrack(readers, { width: 320, avatarSize: 28 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].readers).toHaveLength(12);
  });

  it("is stable for identical progress and tolerates out-of-range values", () => {
    const a = layoutTrack([reader("b", 0.5), reader("a", 0.5)], { width: 500, avatarSize: 30 });
    expect(a[0].readers.map((r) => r.id)).toEqual(["a", "b"]);
    const b = layoutTrack([reader("x", -2), reader("y", 9)], { width: 500, avatarSize: 30 });
    expect(b.map((c) => c.center)).toEqual([0, 1]);
    expect(layoutTrack([], { width: 500, avatarSize: 30 })).toEqual([]);
  });

  it("ranks a race, sharing ranks on ties", () => {
    const result = standings([reader("a", 0.3), reader("b", 0.7), reader("c", 0.7), reader("d", 0.1)]);
    expect(result.map((s) => [s.reader.id, s.rank, s.behindLeader])).toEqual([["b", 1, 0], ["c", 1, 0], ["a", 3, 40], ["d", 4, 60]]);
  });

  it("measures the gap between two readers", () => {
    expect(gapPercent(0.2, 0.34)).toBe(14);
    expect(gapPercent(0.5, 0.2)).toBe(-30);
  });

  it("bins notes along the book", () => {
    expect(markerDensity([0, 0.05, 0.5, 0.99, 1], 10)).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 2]);
  });
});

describe("room modes", () => {
  it("only offers modes that really change the experience", () => {
    expect(ROOM_MODE_LIST.map((m) => m.id)).toEqual(["chill", "race", "duo"]);
  });

  it("keeps competition out of Chill and in Race", () => {
    expect(roomMode("chill").progress).toMatchObject({ showStandings: false, showPassing: false });
    expect(roomMode("race").progress).toMatchObject({ showStandings: true, showPassing: true, emphasis: "prominent" });
  });

  it("makes a Duo exactly two, private", () => {
    expect(roomMode("duo")).toMatchObject({ fixedSize: 2, visibility: ["private"] });
  });

  it("falls back to Chill for an unknown mode", () => {
    expect(roomMode("live-read").id).toBe("chill");
    expect(roomMode(null).id).toBe("chill");
  });
});

describe("formatting", () => {
  it("formats bytes the way the upload UI shows them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(12.34 * MB)).toBe("12.3 MB");
    expect(formatBytes(312 * MB)).toBe("312 MB");
    expect(formatBytes(487.4 * MB)).toBe("487 MB");
    expect(formatBytes(1.5 * 1024 * MB)).toBe("1.50 GB");
    expect(formatBytes(null)).toBe("—");
  });

  it("formats relative time", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(timeAgo("2026-09-30T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-09-30T11:30:00Z", now)).toBe("30 minutes ago");
    expect(timeAgo("2026-09-27T12:00:00Z", now)).toBe("3 days ago");
    expect(timeAgo("2026-09-29T12:00:00Z", now)).toBe("yesterday");
    expect(timeAgo(null, now)).toBe("");
  });

  it("formats durations and clocks", () => {
    expect(formatDuration(20)).toBe("under a minute");
    expect(formatDuration(38 * 60)).toBe("38 min");
    expect(formatDuration(2 * 3600 + 14 * 60)).toBe("2h 14m");
    expect(formatDuration(3 * 3600)).toBe("3h");
    expect(formatClock(36)).toBe("0:36");
    expect(formatClock(125)).toBe("2:05");
  });

  it("builds initials and plurals", () => {
    expect(initials("Sara Ahmed")).toBe("SA");
    expect(initials("  fahad ")).toBe("F");
    expect(initials("")).toBe("?");
    expect(plural(1, "note")).toBe("1 note");
    expect(plural(3, "reply", "replies")).toBe("3 replies");
  });

  it("spots emoji-only notes", () => {
    expect(isEmojiOnly("😱")).toBe(true);
    expect(isEmojiOnly("❤️🔥")).toBe(true);
    expect(isEmojiOnly("wow 😱")).toBe(false);
    expect(isEmojiOnly("123")).toBe(false);
    expect(isEmojiOnly("")).toBe(false);
  });
});

describe("error messages", () => {
  it("translates our database codes", () => {
    expect(friendlyError({ message: "room_full" })).toBe("This room is full.");
    expect(friendlyError({ message: "invite_expired" })).toBe("This invitation has expired.");
    expect(errorCode({ message: "invite_revoked" })).toBe("invite_revoked");
    expect(errorCode({ message: "Something else happened" })).toBeNull();
  });

  it("explains network, permission and session failures", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/connection/);
    expect(friendlyError({ message: 'new row violates row-level security policy for table "books"' })).toMatch(/permission/);
    expect(friendlyError({ message: "JWT expired" })).toMatch(/session/);
    expect(friendlyError({ code: "invalid_credentials", message: "Invalid login credentials", name: "AuthApiError" })).toBe("That email and password don't match.");
  });

  it("never shows a raw internal error", () => {
    expect(friendlyError({ message: "relation \"foo\" does not exist" })).toBe("Something went wrong. Please try again.");
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
  });
});
