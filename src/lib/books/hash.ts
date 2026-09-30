import { createSHA256 } from "hash-wasm";

const CHUNK = 8 * 1024 * 1024;

/**
 * SHA-256 of a file, streamed in 8 MB slices so a 500 MB book never has to sit
 * in memory at once. Used to recognise the exact same file being uploaded twice.
 */
export async function sha256File(file: Blob, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    if (signal?.aborted) throw new DOMException("Hashing cancelled", "AbortError");
    const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
    hasher.update(chunk);
    onProgress?.(Math.min(1, (offset + chunk.length) / file.size));
    // Yield so the progress UI can paint between chunks.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return hasher.digest("hex");
}

/** A cleaned-up title guess from a filename ("dune_frank-herbert.epub" → "dune frank herbert"). */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled book").slice(0, 300);
}
