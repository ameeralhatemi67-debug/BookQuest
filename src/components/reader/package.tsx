"use client";

import { useState, type ReactNode } from "react";
import { Avatar, personHue, type AvatarPerson } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/format";

/**
 * A wrapped package in the friend's colour: box, lid, ribbon and bow. Drawn
 * with plain shapes so it scales from a 12px rail mark to the unwrapping stage.
 */
export function GiftBox({ hue, size = 26, className, wiggle = false, open = false }: { hue: number; size?: number; className?: string; wiggle?: boolean; open?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("gift", wiggle && "package-ahead", open && "package-open", className)}
      style={{ "--gift-hue": hue, "--gift-size": `${size}px`, width: size, height: size } as React.CSSProperties}
    >
      <span className="gift-body package-body">
        <span className="gift-ribbon package-ribbon" />
      </span>
      <span className="gift-lid package-lid">
        <span className="gift-ribbon package-ribbon" />
        <span className="gift-bow" />
      </span>
    </span>
  );
}

/**
 * The first time a recipient opens a package: the wrapping comes off, then
 * the contents arrive one by one. After that it opens like any note.
 */
export function PackageReveal({ author, title, children, opened, onOpen }: { author: AvatarPerson; title: string | null | undefined; children: ReactNode; opened: boolean; onOpen: () => void }) {
  const [unwrapping, setUnwrapping] = useState(false);
  const [ceremony] = useState(!opened);
  const [done, setDone] = useState(opened);
  const hue = personHue(author.id);
  if (!ceremony) return <>{children}</>;
  if (done) return <div className="package-contents space-y-4">{children}</div>;
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="relative grid h-36 w-36 place-items-center" style={{ perspective: 600 }}>
        <span className="absolute inset-x-6 bottom-3 h-3 rounded-full bg-[rgb(var(--shadow-color)/0.16)] blur-[3px]" aria-hidden />
        <GiftBox
          hue={hue}
          size={104}
          open={unwrapping}
          wiggle={!unwrapping}
          className={cn(unwrapping && "pointer-events-none")}
        />
      </div>
      <p className="mt-4 font-display text-xl text-ink">{title || `From ${author.display_name.split(" ")[0]}`}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
        <Avatar person={author} size={20} />
        {author.display_name.split(" ")[0]} wrapped this for you, for this exact spot.
      </p>
      <Button
        className="mt-5"
        size="lg"
        disabled={unwrapping}
        onClick={() => {
          setUnwrapping(true);
          onOpen();
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          setTimeout(() => setDone(true), reduce ? 0 : 720);
        }}
      >
        Unwrap it
      </Button>
    </div>
  );
}
