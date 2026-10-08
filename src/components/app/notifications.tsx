"use client";

import { Bell, BookOpenCheck, DoorOpen, Heart, KeyRound, Mail, MessageCircle, Settings2, ShieldCheck, Sparkles, UserMinus, UserPlus, Gift, PartyPopper } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMe } from "@/components/app/providers";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { cn, timeAgo } from "@/lib/format";
import { roomMode, VISIBILITY_INFO } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { NotificationItem, NotificationList, RoomVisibility } from "@/lib/types";

interface NotificationsValue {
  unread: number;
  items: NotificationItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return value;
}

/**
 * Loads the tester's notifications and keeps them fresh. Realtime delivers new
 * rows instantly; if the socket is down we simply refetch when the tab regains
 * focus — Postgres is the source of truth either way.
 */
export function NotificationsProvider({ initialUnread, children }: { initialUnread: number; children: ReactNode }) {
  const me = useMe();
  const [state, setState] = useState<{ unread: number; items: NotificationItem[]; loading: boolean }>({ unread: initialUnread, items: [], loading: true });
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      const { data, error } = await getSupabase().rpc("list_notifications", { p_limit: 40 });
      if (!error && data) {
        const list = data as NotificationList;
        setState({ unread: list.unread, items: list.items, loading: false });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    })().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, []);

  const markRead = useCallback(async (ids?: string[]) => {
    const now = new Date().toISOString();
    setState((s) => {
      const items = s.items.map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n));
      return { ...s, items, unread: ids ? Math.max(0, s.unread - s.items.filter((n) => !n.read_at && ids.includes(n.id)).length) : 0 };
    });
    await getSupabase().rpc("mark_notifications_read", ids ? { p_ids: ids } : {});
  }, []);

  useEffect(() => {
    void refresh();
    const supabase = getSupabase();
    const channel = supabase
      .channel(`notifications:${me.user_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.user_id}` }, () => void refresh())
      .subscribe();
    const onFocus = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [me.user_id, refresh]);

  const value = useMemo(() => ({ ...state, refresh, markRead }), [state, refresh, markRead]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

// ---------------------------------------------------------------- presentation

interface Described {
  icon: ReactNode;
  text: ReactNode;
  href: string;
}

const Strong = ({ children }: { children: ReactNode }) => <span className="font-medium text-ink">{children}</span>;

/** Turns a notification into a sentence. By design there is never note content in here. */
export function describeNotification(n: NotificationItem): Described {
  const who = <Strong>{n.actor?.display_name ?? "Someone"}</Strong>;
  const room = n.room_name ? <Strong>{n.room_name}</Strong> : "a room";
  const label = typeof n.data.label === "string" && n.data.label ? ` at ${n.data.label}` : "";
  const readerHref = n.room_id ? `/read/${n.room_id}${n.marker_id ? `?note=${n.marker_id}` : ""}` : "/home";
  const roomHref = n.room_id ? `/rooms/${n.room_id}` : "/home";
  const iconClass = "size-4";

  switch (n.type) {
    case "reply":
      return {
        icon: <MessageCircle className={iconClass} aria-hidden />,
        text: <>{who} replied {n.data.own_note === false ? "in a thread you're part of" : "to something you left"}{label}.</>,
        href: readerHref,
      };
    case "reaction":
      return { icon: <Heart className={iconClass} aria-hidden />, text: <>{who} reacted to something you left{label}.</>, href: readerHref };
    case "unlocked": {
      const count = Number(n.data.count ?? 1);
      return {
        icon: <KeyRound className={iconClass} aria-hidden />,
        text: <>{who} reached {count > 1 ? `${count} things` : "something"} you left{count > 1 ? "" : label} in {room}.</>,
        href: readerHref,
      };
    }
    case "note_behind":
      return { icon: <Sparkles className={iconClass} aria-hidden />, text: <>{who} left something{label} — a place you&apos;ve already passed.</>, href: readerHref };
    case "member_joined":
      return { icon: <UserPlus className={iconClass} aria-hidden />, text: <>{who} {n.data.rejoined ? "came back to" : "joined"} {room}.</>, href: roomHref };
    case "invited":
      return {
        icon: <Mail className={iconClass} aria-hidden />,
        text: <>{who} invited you to read in {room}.</>,
        href: typeof n.data.token === "string" ? `/invite/${n.data.token}` : roomHref,
      };
    case "finished":
      return { icon: <BookOpenCheck className={iconClass} aria-hidden />, text: <>{who} finished the book in {room}.</>, href: roomHref };
    case "role_changed": {
      const role = String(n.data.role ?? "member");
      return {
        icon: <ShieldCheck className={iconClass} aria-hidden />,
        text: role === "owner" ? <>{who} handed {room} over to you.</> : role === "moderator" ? <>{who} made you a moderator of {room}.</> : <>You&apos;re no longer a moderator of {room}.</>,
        href: roomHref,
      };
    }
    case "removed":
      return { icon: <UserMinus className={iconClass} aria-hidden />, text: <>You were removed from {room}.</>, href: "/home" };
    case "room_changed": {
      const changes = Array.isArray(n.data.changes) ? (n.data.changes as string[]) : [];
      let what: ReactNode = "was updated";
      if (changes.includes("archived")) what = "was archived";
      else if (changes.includes("mode")) what = <>is now a {roomMode(String(n.data.mode)).name} room</>;
      else if (changes.includes("visibility")) what = <>is now {n.data.visibility === "open" ? "public" : VISIBILITY_INFO[String(n.data.visibility) as RoomVisibility]?.name.toLowerCase() ?? "different"}</>;
      return { icon: <Settings2 className={iconClass} aria-hidden />, text: <>{room} {what}.</>, href: roomHref };
    }
    case "afterparty": {
      const count = Number(n.data.count ?? 1);
      const chapter = typeof n.data.label === "string" && n.data.label ? n.data.label : "A chapter";
      return {
        icon: <PartyPopper className={iconClass} aria-hidden />,
        text: count > 1 ? <>Everyone in {room} is through {count} chapters. Their afterparties are open.</> : <>Everyone in {room} finished <Strong>{chapter}</Strong>. Its afterparty is open.</>,
        href: n.room_id ? `/read/${n.room_id}?party=${Number(n.data.chapter_index ?? 0)}` : "/home",
      };
    }
    case "package":
      return {
        icon: <Gift className={iconClass} aria-hidden />,
        text: <>{who} wrapped a package for you{label} in {room}. It opens when you get there.</>,
        href: n.room_id ? `/read/${n.room_id}` : "/home",
      };
    default:
      return { icon: <DoorOpen className={iconClass} aria-hidden />, text: <>Something happened in {room}.</>, href: roomHref };
  }
}

export function NotificationRow({ notification, onNavigate }: { notification: NotificationItem; onNavigate?: () => void }) {
  const { markRead } = useNotifications();
  const described = describeNotification(notification);
  const unread = !notification.read_at;
  return (
    <Link
      href={described.href}
      onClick={() => {
        if (unread) void markRead([notification.id]);
        onNavigate?.();
      }}
      className={cn("flex gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-sunk", unread && "bg-accent-soft/50")}
    >
      <span className="relative mt-0.5 shrink-0">
        {notification.actor ? (
          <Avatar person={notification.actor} size={32} />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-sunk text-ink-soft">{described.icon}</span>
        )}
        {notification.actor && (
          <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-raised text-accent ring-1 ring-line [&_svg]:size-3">
            {described.icon}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug text-ink-soft">{described.text}</span>
        <span className="mt-0.5 block text-xs text-ink-faint">{timeAgo(notification.created_at)}</span>
      </span>
      {unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
    </Link>
  );
}

export function NotificationBell() {
  const { unread, items, loading, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative inline-flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-sunk hover:text-ink"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex min-w-[18px] animate-pop-in items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-[18px] text-on-accent" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-1.5rem))] p-2">
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h2 className="font-display text-lg">Notifications</h2>
          {unread > 0 && (
            <button type="button" className="text-sm text-accent-ink underline-offset-4 hover:underline" onClick={() => void markRead()}>
              Mark all read
            </button>
          )}
        </div>
        <div className="scroll-slim max-h-[60dvh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">{loading ? "Loading…" : "Nothing yet. When friends reply or reach what you left, it shows up here."}</p>
          ) : (
            items.slice(0, 8).map((n) => <NotificationRow key={n.id} notification={n} onNavigate={() => setOpen(false)} />)
          )}
        </div>
        {items.length > 0 && (
          <Link href="/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-xl px-3 py-2 text-center text-sm font-medium text-accent-ink hover:bg-sunk">
            See all
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
