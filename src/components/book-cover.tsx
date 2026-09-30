"use client";

import { useEffect, useState } from "react";
import { cn, hashString } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";

// Covers live in a private bucket, so they are shown through short-lived signed
// URLs. A URL is reused for as long as it is valid so the browser can cache the
// image instead of re-downloading it on every page.
const SIGN_SECONDS = 6 * 3600;
const memory = new Map<string, { url: string; expires: number }>();

function readCache(path: string): string | null {
  const now = Date.now();
  const hit = memory.get(path);
  if (hit && hit.expires > now) return hit.url;
  try {
    const raw = sessionStorage.getItem(`cover:${path}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { url: string; expires: number };
      if (parsed.expires > now) {
        memory.set(path, parsed);
        return parsed.url;
      }
    }
  } catch {
    // sessionStorage unavailable — memory cache only.
  }
  return null;
}

async function signCover(path: string): Promise<string | null> {
  const cached = readCache(path);
  if (cached) return cached;
  const { data, error } = await getSupabase().storage.from("covers").createSignedUrl(path, SIGN_SECONDS);
  if (error || !data?.signedUrl) return null;
  const entry = { url: data.signedUrl, expires: Date.now() + (SIGN_SECONDS - 300) * 1000 };
  memory.set(path, entry);
  try {
    sessionStorage.setItem(`cover:${path}`, JSON.stringify(entry));
  } catch {
    // ignore
  }
  return entry.url;
}

// Cloth-bound colours for books without cover art.
const CLOTH = [
  ["#7a3b2e", "#f3dcc8"], ["#2f4a3f", "#e3ecd9"], ["#2d3f5c", "#dfe6f2"], ["#5b3a55", "#f0dfea"],
  ["#6b5326", "#f5e9c8"], ["#274b52", "#d9eceb"], ["#4a3728", "#efe2d0"], ["#5a2a35", "#f4dbe0"],
];

export interface CoverBook {
  id: string;
  title: string;
  author?: string | null;
  cover_path?: string | null;
}

/**
 * A book cover. Always renders a typographic "cloth" cover first (so there is
 * never an empty box or a layout jump), then fades the real cover art in over
 * it once it has loaded — if the viewer is allowed to see it.
 */
export function BookCover({ book, className, width = 120, priority }: { book: CoverBook; className?: string; width?: number; priority?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bg, fg] = CLOTH[hashString(book.id) % CLOTH.length];

  useEffect(() => {
    let cancelled = false;
    if (!book.cover_path) return;
    signCover(book.cover_path).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [book.cover_path]);

  const titleSize = Math.max(11, Math.min(18, Math.round(width * 0.13)));

  return (
    <div
      className={cn("relative aspect-[2/3] shrink-0 overflow-hidden rounded-[6px] shadow-book", className)}
      style={{ width, background: bg, color: fg }}
      role="img"
      aria-label={book.author ? `Cover of ${book.title} by ${book.author}` : `Cover of ${book.title}`}
    >
      {/* spine shading */}
      <div className="absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/30 to-transparent" aria-hidden />
      <div className="absolute inset-0 flex flex-col justify-between p-[11%] pl-[15%]" aria-hidden>
        <div className="font-display font-medium leading-[1.12]" style={{ fontSize: titleSize, display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {book.title}
        </div>
        {book.author && (
          <div className="truncate opacity-75" style={{ fontSize: Math.max(9, Math.round(titleSize * 0.68)) }}>
            {book.author}
          </div>
        )}
      </div>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- signed, private Storage URL
        <img
          src={url}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setUrl(null)}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}
