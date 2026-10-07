"use client";

import {
  BarChart3, BookOpen, CloudSun, DoorOpen, Eye, Gift, History, Hourglass, Lamp, Map as MapIcon, Megaphone, Music2, PartyPopper,
  PenLine, Rows3, Sparkles, Stamp, Users, Vault, BookOpenText, Pencil, type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDate } from "@/lib/format";
import { LATEST_RELEASE, WHATS_NEW, type WhatsNewIcon, type WhatsNewRelease } from "@/lib/whats-new";

const ICONS: Record<WhatsNewIcon, LucideIcon> = {
  flip: BookOpenText, attention: Megaphone, prediction: Stamp, poll: BarChart3, package: Gift, map: MapIcon, lens: Eye,
  party: PartyPopper, live: Users, ritual: Hourglass, vault: Vault, away: History, weather: CloudSun, echo: Sparkles,
  desk: Lamp, seats: DoorOpen, note: PenLine, music: Music2, rail: Rows3, draw: Pencil, book: BookOpen,
};

// Which release this browser has already been shown (a per-device convenience).
const SEEN_KEY = "marginalia:whats-new-seen";
const SEEN_EVENT = "marginalia:whats-new";

function readSeen(): string | null {
  // Automated browsers (acceptance tests) are never interrupted by the window.
  if (navigator.webdriver) return LATEST_RELEASE.id;
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    // Storage unavailable: behave as if seen, so the dialog never nags.
    return LATEST_RELEASE.id;
  }
}

function subscribeSeen(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SEEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SEEN_EVENT, onChange);
  };
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, LATEST_RELEASE.id);
  } catch {
    // not persisted
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

/** True when this browser has not yet been shown the latest release. */
export function useWhatsNewUnseen(): boolean {
  // The server snapshot counts as seen, so nothing flashes before hydration.
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => LATEST_RELEASE.id);
  return seen !== LATEST_RELEASE.id;
}

function ReleaseItems({ release }: { release: WhatsNewRelease }) {
  return (
    <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {release.items.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <li key={item.title} className="flex gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{item.title}</span>
              <span className="block text-sm leading-snug text-ink-soft">{item.body}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The "What's new" window. Opens by itself once per new release; afterwards it
 * is reopened from the account menu (`open` / `onOpenChange`).
 */
export function WhatsNewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const unseen = useWhatsNewUnseen();
  const [dismissed, setDismissed] = useState(false);
  const shown = open || (unseen && !dismissed);
  const earlier = WHATS_NEW.slice(1);

  const close = () => {
    markSeen();
    setDismissed(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={shown} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={<>What&apos;s new: {LATEST_RELEASE.title}</>}
        description={<>{formatDate(LATEST_RELEASE.date)}. {LATEST_RELEASE.summary}</>}
        className="max-w-2xl"
      >
        <ReleaseItems release={LATEST_RELEASE} />
        {earlier.length > 0 && (
          <details className="group mt-8 border-t border-line pt-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-ink-soft hover:text-ink">
              Earlier updates
              <span className="ml-auto text-xs text-ink-faint group-open:hidden">{earlier.length}</span>
            </summary>
            <div className="mt-4 space-y-8">
              {earlier.map((release) => (
                <section key={release.id} aria-label={release.title}>
                  <h3 className="font-display text-lg text-ink">{release.title}</h3>
                  <p className="mb-4 text-xs text-ink-faint">{formatDate(release.date)}. {release.summary}</p>
                  <ReleaseItems release={release} />
                </section>
              ))}
            </div>
          </details>
        )}
        <div className="mt-8 flex justify-end">
          <Button onClick={close}>Start reading</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
