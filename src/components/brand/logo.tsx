import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/format";

/** An open book whose margin holds a small mark — someone left something here. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 9 C13 7 9.5 6.5 6 7 V23 C9.5 22.5 13 23 16 25" />
        <path d="M16 9 C19 7 22.5 6.5 26 7 V23 C22.5 22.5 19 23 16 25" />
        <path d="M16 9 V25" />
      </g>
      <circle cx="21.2" cy="13.4" r="2.2" className="fill-accent" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 text-ink", className)} aria-label={`${APP_NAME} home`}>
      <LogoMark />
      <span className="font-display text-xl font-medium tracking-tight">{APP_NAME}</span>
    </Link>
  );
}
