"use client";

import { Bug, CircleHelp, Heart, Lightbulb, MessageSquareHeart } from "lucide-react";
import { useParams, usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useMe, useReadingContext } from "@/components/app/providers";
import { Button } from "@/components/ui/button";
import { FormError, Textarea } from "@/components/ui/field";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlay";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";

type Category = "bug" | "confusing" | "idea" | "love";

const CATEGORIES: { id: Category; label: string; icon: ReactNode; prompt: string }[] = [
  { id: "bug", label: "Bug", icon: <Bug className="size-4" aria-hidden />, prompt: "What happened, and what did you expect instead?" },
  { id: "confusing", label: "Confusing", icon: <CircleHelp className="size-4" aria-hidden />, prompt: "What were you trying to do? Where did you get lost?" },
  { id: "idea", label: "Idea", icon: <Lightbulb className="size-4" aria-hidden />, prompt: "What would make this better?" },
  { id: "love", label: "Love this", icon: <Heart className="size-4" aria-hidden />, prompt: "What felt good? Tell us so we keep it." },
];

function deviceClass(): string {
  const width = window.innerWidth;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (width < 640) return touch ? "phone" : "narrow";
  if (width < 1024) return touch ? "tablet" : "small-desktop";
  return touch ? "large-touch" : "desktop";
}

/**
 * The always-available feedback entry. Attaches safe context automatically —
 * route, room, book, location label, progress, viewport — and never any text
 * from the book or from anyone's notes.
 */
export function FeedbackDialog({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const params = useParams<{ roomId?: string }>();
  const { reading } = useReadingContext();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("idea");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const context = reading.current;
    const { error: insertError } = await getSupabase().from("alpha_feedback").insert({
      user_id: me.user_id,
      category,
      message: message.trim(),
      route: pathname,
      room_id: context.roomId ?? params.roomId ?? null,
      book_id: context.bookId ?? null,
      context: {
        location: context.label ?? null,
        progress: context.progress ?? null,
        features_off: context.featuresOff ?? null,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        device: deviceClass(),
        user_agent: navigator.userAgent.slice(0, 300),
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        sent_at: new Date().toISOString(),
      },
    });
    setBusy(false);
    if (insertError) return setError(friendlyError(insertError, "Couldn't send that. Please try again."));
    setOpen(false);
    setMessage("");
    toast.success("Thank you — that goes straight to the people building this.");
  }

  const active = CATEGORIES.find((c) => c.id === category)!;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="Tell us what you think" description="This alpha exists to learn from you. Short and honest is perfect.">
        <form onSubmit={submit} className="space-y-4">
          <div role="radiogroup" aria-label="Kind of feedback" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CATEGORIES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={category === option.id}
                onClick={() => setCategory(option.id)}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors",
                  category === option.id ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong text-ink-soft hover:bg-sunk",
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
          <Textarea
            aria-label="Your feedback"
            placeholder={active.prompt}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={5}
            autoFocus
          />
          <p className="text-xs leading-relaxed text-ink-faint">
            We attach where you are in the app (page, room, place in the book, screen size) so we can reproduce things. Never book text or
            anyone&apos;s notes.
          </p>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={message.trim().length < 2}>
              Send feedback
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The floating feedback button shown across the app shell. */
export function FeedbackFab() {
  return (
    <FeedbackDialog>
      <button
        type="button"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-raised px-4 text-sm font-medium text-ink-soft shadow-lift transition-colors hover:text-ink md:bottom-5"
      >
        <MessageSquareHeart className="size-4 text-accent" aria-hidden />
        Feedback
      </button>
    </FeedbackDialog>
  );
}
