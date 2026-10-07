"use client";

import { Bell, Compass, Gift, Home, Library, LogOut, Monitor, Moon, Search, ShieldCheck, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { FeedbackFab } from "@/components/app/feedback";
import { NotificationBell, useNotifications } from "@/components/app/notifications";
import { useMe } from "@/components/app/providers";
import { useWhatsNewUnseen, WhatsNewDialog } from "@/components/app/whats-new";
import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/format";
import { signOutAndClean } from "@/lib/auth-client";

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/books", label: "My Books", icon: Library },
  { href: "/discover", label: "Open Rooms", icon: Compass },
];

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// The chosen theme lives in localStorage (so the inline script in the root
// layout can apply it before first paint); React reads it as an external store.
const THEME_EVENT = "marginalia:theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function subscribeTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => readTheme() === "system" && applyTheme("system");
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  media.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
    media.removeEventListener("change", onSystemChange);
  };
}

function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, readTheme, () => "system");
  return [
    theme,
    (next) => {
      try {
        if (next === "system") localStorage.removeItem("theme");
        else localStorage.setItem("theme", next);
      } catch {
        // Not persisted; still applied for this visit.
      }
      applyTheme(next);
      window.dispatchEvent(new Event(THEME_EVENT));
    },
  ];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function UserMenu({ onWhatsNew }: { onWhatsNew: () => void }) {
  const me = useMe();
  const unseen = useWhatsNewUnseen();
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];
  return (
    <Menu>
      <MenuTrigger className="relative rounded-full" aria-label={unseen ? "Account menu (something new)" : "Account menu"}>
        <Avatar person={{ id: me.user_id, display_name: me.display_name, avatar_path: me.avatar_path }} size={36} />
        {unseen && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-gold ring-2 ring-paper" aria-hidden />}
      </MenuTrigger>
      <MenuContent align="end">
        <div className="px-3 pb-2 pt-2">
          <div className="truncate text-sm font-medium text-ink">{me.display_name}</div>
          <div className="text-xs text-ink-faint">Alpha tester{me.is_admin ? " · admin" : ""}</div>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/profile">
            <UserRound className="size-4 text-ink-faint" aria-hidden /> Profile
          </Link>
        </MenuItem>
        <MenuItem onSelect={onWhatsNew}>
          <Gift className="size-4 text-ink-faint" aria-hidden /> What&apos;s new
          {unseen && <span className="ml-auto size-2 rounded-full bg-gold" aria-label="New" />}
        </MenuItem>
        {me.is_admin && (
          <MenuItem asChild>
            <Link href="/admin">
              <ShieldCheck className="size-4 text-ink-faint" aria-hidden /> Alpha admin
            </Link>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuLabel>Appearance</MenuLabel>
        <div className="flex gap-1 px-1.5 pb-1.5" role="radiogroup" aria-label="Appearance">
          {themes.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              onClick={() => setTheme(id)}
              className={cn(
                "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium",
                theme === id ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-sunk",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <MenuSeparator />
        <MenuItem
          onSelect={async () => {
            await signOutAndClean();
            router.replace("/login");
            router.refresh();
          }}
        >
          <LogOut className="size-4 text-ink-faint" aria-hidden /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { unread } = useNotifications();
  const [whatsNew, setWhatsNew] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Logo href="/home" className="mr-4" />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(pathname, href) ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  isActive(pathname, href) ? "bg-sunk text-ink" : "text-ink-soft hover:text-ink",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-0.5">
            <Link href="/search" className="inline-flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink" aria-label="Search">
              <Search className="size-5" aria-hidden />
            </Link>
            <NotificationBell />
            <div className="ml-1.5">
              <UserMenu onWhatsNew={() => setWhatsNew(true)} />
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 sm:pt-10 md:pb-20">
        {children}
      </main>

      {/* Phone navigation */}
      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1">
          {[...NAV, { href: "/notifications", label: "Activity", icon: Bell }].map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium", active ? "text-accent-ink" : "text-ink-faint")}
              >
                <Icon className="size-5" aria-hidden />
                {label}
                {href === "/notifications" && unread > 0 && <span className="absolute right-[calc(50%-16px)] top-1.5 size-2 rounded-full bg-accent" aria-label={`${unread} unread`} />}
              </Link>
            );
          })}
        </div>
      </nav>

      <FeedbackFab />
      <WhatsNewDialog open={whatsNew} onOpenChange={setWhatsNew} />
    </div>
  );
}
