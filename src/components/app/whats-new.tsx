"use client";

import { Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ReleaseItems } from "@/components/app/whats-new-items";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { APP_NAME, siteUrl } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { LATEST_RELEASE, WHATS_NEW, whatsNewShare } from "@/lib/whats-new";

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

/**
 * Sends the latest release to a friend: the device's share sheet when it has
 * one, otherwise the clipboard. The link opens a public page, so the friend
 * does not need an account to see what is new.
 */
async function shareLatest() {
  const message = whatsNewShare(LATEST_RELEASE, APP_NAME, siteUrl());
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(message))) {
    try {
      await navigator.share(message);
      return;
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${message.title}\n\n${message.text}\n\n${message.url}`);
    toast.success("Copied. Paste it to a friend.");
  } catch {
    toast.message("Copy this link to share it", { description: message.url });
  }
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
        <div className="mt-8 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void shareLatest()} icon={<Share2 className="size-4" aria-hidden />}>
            Share
          </Button>
          <Button onClick={close}>Start reading</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
