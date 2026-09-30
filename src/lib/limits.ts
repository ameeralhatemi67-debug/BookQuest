// Upload limits and accepted file types — the single source of truth for the
// app. The same ceilings are enforced server-side by the Storage buckets and
// by finalize_book_upload (supabase/migrations/…_storage.sql, …_room_rpc.sql);
// keep the two in sync when changing a number here.

export const MB = 1024 * 1024;

/** Files larger than this use the resumable (TUS) protocol. Supabase requires 6 MB chunks. */
export const RESUMABLE_THRESHOLD_BYTES = 6 * MB;
export const TUS_CHUNK_BYTES = 6 * MB;

export type BookFormat = "epub" | "pdf";
export type AttachmentKind = "image" | "audio" | "video";

interface FileRule {
  label: string;
  maxBytes: number;
  /** extension (lowercase, no dot) → canonical MIME type stored with the object */
  types: Record<string, string>;
  /** extra MIME types browsers report for the extensions above */
  mimeAliases?: Record<string, string>;
}

export const BOOK_RULES: Record<BookFormat, FileRule> = {
  epub: { label: "EPUB", maxBytes: 250 * MB, types: { epub: "application/epub+zip" } },
  pdf: { label: "PDF", maxBytes: 500 * MB, types: { pdf: "application/pdf" } },
};

export const ATTACHMENT_RULES: Record<AttachmentKind, FileRule & { bucket: string }> = {
  image: {
    label: "Image",
    bucket: "annotation-images",
    maxBytes: 25 * MB,
    types: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" },
  },
  audio: {
    label: "Audio",
    bucket: "annotation-audio",
    maxBytes: 100 * MB,
    types: {
      mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg",
      opus: "audio/ogg", webm: "audio/webm", wav: "audio/wav", flac: "audio/flac",
    },
    mimeAliases: { "audio/x-m4a": "audio/mp4", "audio/x-wav": "audio/wav", "audio/mp3": "audio/mpeg", "audio/x-flac": "audio/flac" },
  },
  video: {
    label: "Video",
    bucket: "annotation-video",
    maxBytes: 500 * MB,
    types: { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" },
  },
};

export const AVATAR_RULE: FileRule = {
  label: "Avatar",
  maxBytes: 10 * MB,
  types: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" },
};

export const BOOK_ACCEPT = ".epub,.pdf,application/epub+zip,application/pdf";
export const ATTACHMENT_ACCEPT: Record<AttachmentKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif,image/avif",
  audio: "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.webm",
  video: "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov",
};

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function formatLimit(bytes: number): string {
  return bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

interface FileLike {
  name: string;
  size: number;
  type: string;
}

function baseMime(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

function checkAgainst(rule: FileRule, file: FileLike): Validation<{ contentType: string; extension: string }> {
  const extension = extensionOf(file.name);
  const contentType = rule.types[extension];
  if (!contentType) {
    return { ok: false, error: `That file type isn't supported here. Use ${Object.keys(rule.types).map((e) => `.${e}`).join(", ")}.` };
  }
  // The browser-reported MIME type must agree with the extension when present.
  const reported = baseMime(file.type);
  if (reported && reported !== "application/octet-stream") {
    const normalized = rule.mimeAliases?.[reported] ?? reported;
    if (!Object.values(rule.types).includes(normalized)) {
      return { ok: false, error: `This file says it is "${reported}", which doesn't match a ${rule.label.toLowerCase()} file.` };
    }
  }
  if (file.size <= 0) return { ok: false, error: "This file is empty." };
  if (file.size > rule.maxBytes) {
    return { ok: false, error: `${rule.label} files can be up to ${formatLimit(rule.maxBytes)}. This one is ${formatLimit(file.size)}.` };
  }
  return { ok: true, value: { contentType, extension } };
}

export function validateBookFile(file: FileLike): Validation<{ format: BookFormat; contentType: string; extension: string }> {
  const extension = extensionOf(file.name);
  if (extension !== "epub" && extension !== "pdf") {
    return { ok: false, error: "Only EPUB and PDF books are supported." };
  }
  const result = checkAgainst(BOOK_RULES[extension], file);
  return result.ok ? { ok: true, value: { format: extension, ...result.value } } : result;
}

/** Which kind of annotation attachment is this file, judging by its extension? */
export function attachmentKindOf(file: FileLike): AttachmentKind | null {
  const extension = extensionOf(file.name);
  const reported = baseMime(file.type);
  // .webm and .ogg can be audio or video: trust the browser's MIME family.
  if (extension === "webm" || extension === "ogg") {
    if (reported.startsWith("video/")) return "video";
    if (reported.startsWith("audio/")) return "audio";
  }
  for (const kind of ["image", "audio", "video"] as const) {
    if (ATTACHMENT_RULES[kind].types[extension]) return kind;
  }
  return null;
}

export function validateAttachment(
  file: FileLike,
  kind: AttachmentKind | null = attachmentKindOf(file),
): Validation<{ kind: AttachmentKind; bucket: string; contentType: string; extension: string }> {
  if (!kind) return { ok: false, error: "Attach an image, an audio file or a video." };
  const rule = ATTACHMENT_RULES[kind];
  const result = checkAgainst(rule, file);
  return result.ok ? { ok: true, value: { kind, bucket: rule.bucket, ...result.value } } : result;
}

export function validateAvatar(file: FileLike): Validation<{ contentType: string; extension: string }> {
  return checkAgainst(AVATAR_RULE, file);
}

/**
 * Looks at the first bytes of a file to confirm it really is what its name
 * claims. A renamed executable is rejected before a single byte is uploaded.
 */
export function sniffBookFormat(head: Uint8Array): BookFormat | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...head.subarray(start, start + length));
  // "%PDF-" may be preceded by a few junk bytes in the wild.
  if (ascii(0, 1024).includes("%PDF-")) return "pdf";
  // EPUB = ZIP whose first entry is an uncompressed file named "mimetype".
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (ascii(30, 8) === "mimetype" && ascii(38, 20) === "application/epub+zip") return "epub";
    // Some producers order the archive differently; accept a ZIP that declares the EPUB type anywhere early on.
    if (ascii(0, Math.min(head.length, 4096)).includes("application/epub+zip")) return "epub";
  }
  return null;
}
