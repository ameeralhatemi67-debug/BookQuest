// EPUB inspection for the upload pipeline (browser only).
import type { Book } from "epubjs";
import { BookParseError } from "@/lib/books/pdf";

/**
 * Characters per epub.js "location". Every reader of a book shares the same
 * locations index (generated once at upload and stored next to the file), so
 * normalized progress means exactly the same place for everyone, on every
 * device and at every font size. Smaller = finer progress but a larger index.
 */
export const EPUB_LOCATION_CHARS = 1000;

export async function loadEpubJs() {
  const mod = await import("epubjs");
  return mod.default;
}

export interface EpubInspection {
  title: string | null;
  author: string | null;
  cover: Blob | null;
  /** JSON produced by book.locations.save() — uploaded as locations.json. */
  locations: string;
  locationCount: number;
  metadata: Record<string, unknown>;
}

const clean = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 300) : null;
};

function withTimeout<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

// Font obfuscation is fine (and common); anything else in encryption.xml is DRM.
const FONT_OBFUSCATION = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];

async function hasDrm(book: Book): Promise<boolean> {
  try {
    const zip = (book as unknown as { archive?: { zip?: { file(name: string): { async(type: "string"): Promise<string> } | null } } }).archive?.zip;
    const entry = zip?.file("META-INF/encryption.xml");
    if (!entry) return false;
    const xml = await entry.async("string");
    const algorithms = [...xml.matchAll(/EncryptionMethod[^>]*Algorithm="([^"]+)"/g)].map((m) => m[1]);
    return algorithms.some((algorithm) => !FONT_OBFUSCATION.includes(algorithm));
  } catch {
    return false;
  }
}

/** Scales an image down to a web-friendly JPEG cover. */
export async function toCoverJpeg(source: Blob, maxWidth = 480): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

/**
 * Opens an EPUB to confirm it is readable, then extracts its metadata, cover
 * and the shared locations index.
 */
export async function inspectEpub(file: Blob, onStage?: (stage: "opening" | "metadata" | "locations") => void): Promise<EpubInspection> {
  const ePub = await loadEpubJs();
  onStage?.("opening");
  const corrupt = new BookParseError("corrupt", "This EPUB couldn't be opened. The file may be damaged or not a valid EPUB.");
  let book: Book;
  const buffer = await file.arrayBuffer();
  // epub.js never settles on an archive it cannot read, so check the container
  // ourselves first: a damaged file is reported in milliseconds, not after a timeout.
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    if (!zip.file("META-INF/container.xml")) throw corrupt;
  } catch {
    throw corrupt;
  }
  try {
    book = ePub(buffer);
    await withTimeout(book.ready, 45_000, corrupt);
  } catch {
    throw corrupt;
  }

  try {
    if (await hasDrm(book)) {
      throw new BookParseError("encrypted", "This EPUB is DRM-protected, so it can't be displayed here. Use a DRM-free copy.");
    }
    onStage?.("metadata");
    const meta = (await book.loaded.metadata) as unknown as Record<string, unknown>;

    let cover: Blob | null = null;
    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) {
        const response = await fetch(coverUrl);
        cover = await toCoverJpeg(await response.blob());
      }
    } catch {
      // No cover art: the app draws a typographic cover instead.
    }

    onStage?.("locations");
    try {
      await withTimeout(book.locations.generate(EPUB_LOCATION_CHARS), 180_000, corrupt);
    } catch {
      throw corrupt;
    }
    const locationCount = book.locations.length();
    if (!locationCount) throw new BookParseError("empty", "This EPUB doesn't seem to contain any readable text.");

    return {
      title: clean(meta.title),
      author: clean(meta.creator),
      cover,
      locations: book.locations.save(),
      locationCount,
      metadata: {
        language: clean(meta.language),
        publisher: clean(meta.publisher),
        published: clean(meta.pubdate),
        identifier: clean(meta.identifier),
      },
    };
  } finally {
    try {
      book.destroy();
    } catch {
      // ignore
    }
  }
}
