import {
  BarChart3, BookOpen, CloudSun, DoorOpen, Eye, Gift, History, Hourglass, Lamp, Map as MapIcon, Megaphone, Music2, PartyPopper,
  PenLine, Rows3, Sparkles, Stamp, Users, Vault, BookOpenText, Pencil, type LucideIcon,
} from "lucide-react";
import type { WhatsNewIcon, WhatsNewRelease } from "@/lib/whats-new";

// Shared by the in-app window and the public /whats-new page, so a friend sees
// exactly what the sender saw.
const ICONS: Record<WhatsNewIcon, LucideIcon> = {
  flip: BookOpenText, attention: Megaphone, prediction: Stamp, poll: BarChart3, package: Gift, map: MapIcon, lens: Eye,
  party: PartyPopper, live: Users, ritual: Hourglass, vault: Vault, away: History, weather: CloudSun, echo: Sparkles,
  desk: Lamp, seats: DoorOpen, note: PenLine, music: Music2, rail: Rows3, draw: Pencil, book: BookOpen,
  room: DoorOpen, share: Gift,
};

export function ReleaseItems({ release }: { release: WhatsNewRelease }) {
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
