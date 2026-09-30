import { Loader2 } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn("size-5 animate-spin text-ink-faint", className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-3xl border border-line bg-raised shadow-soft", className)} {...props} />;
}

type Tone = "neutral" | "accent" | "moss" | "gold" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-sunk text-ink-soft",
  accent: "bg-accent-soft text-accent-ink",
  moss: "bg-moss-soft text-moss",
  gold: "bg-gold-soft text-gold",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      {icon && <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-sunk text-ink-soft">{icon}</div>}
      <h3 className="font-display text-xl text-ink">{title}</h3>
      {children && <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionHeading({ title, hint, action, id }: { title: string; hint?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-2xl text-ink">
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** A linear meter with proper progressbar semantics. */
export function Meter({ value, label, className, tone = "accent" }: { value: number; label: string; className?: string; tone?: "accent" | "moss" }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunk", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone === "accent" ? "bg-accent" : "bg-moss")}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
