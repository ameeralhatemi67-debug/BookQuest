import type { CSSProperties } from "react";
import { cn, hashString, initials } from "@/lib/format";

// Muted "book cloth" hues; each person keeps the same one everywhere.
const HUES = [14, 32, 48, 96, 150, 176, 204, 232, 268, 318, 342];

export function personHue(id: string): number {
  return HUES[hashString(id) % HUES.length];
}

export function avatarUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/avatars/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export interface AvatarPerson {
  id: string;
  display_name: string;
  avatar_path?: string | null;
}

export function Avatar({
  person,
  size = 32,
  className,
  ring,
  live,
  style,
}: {
  person: AvatarPerson;
  size?: number;
  className?: string;
  /** Draw a paper-coloured ring (for overlapping stacks and the progress track). */
  ring?: boolean;
  /** Show the "reading right now" dot. */
  live?: boolean;
  style?: CSSProperties;
}) {
  const url = avatarUrl(person.avatar_path);
  const hue = personHue(person.id);
  return (
    <span
      className={cn("relative inline-flex shrink-0 select-none", className)}
      style={{ width: size, height: size, ...style }}
      title={person.display_name}
    >
      <span
        className={cn(
          "inline-flex size-full items-center justify-center overflow-hidden rounded-full font-medium",
          ring && "ring-2 ring-paper",
        )}
        style={{
          background: `oklch(0.86 0.06 ${hue})`,
          color: `oklch(0.34 0.08 ${hue})`,
          fontSize: Math.max(10, Math.round(size * 0.38)),
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny avatars straight from Storage
          <img src={url} alt="" width={size} height={size} className="size-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <span aria-hidden>{initials(person.display_name)}</span>
        )}
      </span>
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-paper" aria-hidden>
          <span className="size-2 animate-breathe rounded-full bg-moss" />
        </span>
      )}
      <span className="sr-only">{person.display_name}{live ? " (reading now)" : ""}</span>
    </span>
  );
}

/** A compact overlapping row of avatars with a "+N" overflow. */
export function AvatarStack({ people, size = 28, max = 5, className }: { people: AvatarPerson[]; size?: number; max?: number; className?: string }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((person, index) => (
        <Avatar key={person.id} person={person} size={size} ring style={{ marginLeft: index === 0 ? 0 : -size * 0.3 }} />
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-sunk text-xs font-medium text-ink-soft ring-2 ring-paper"
          style={{ width: size, height: size, marginLeft: -size * 0.3 }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
