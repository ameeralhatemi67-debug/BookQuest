"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/overlay";
import { getSupabase } from "@/lib/supabase/client";
import type { Access } from "@/lib/types";

// ---------------------------------------------------------------- session
const MeContext = createContext<Access | null>(null);

/** The signed-in tester. Only used inside the authenticated app, where it always exists. */
export function useMe(): Access {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside <AppProviders>");
  return me;
}

// ---------------------------------------------------------------- feedback context
/** Safe, non-content context the reader shares so feedback can say *where* something happened. */
export interface ReadingContext {
  roomId?: string;
  bookId?: string;
  label?: string;
  progress?: number;
  /** Which room experiments were switched off when this feedback was written. */
  featuresOff?: string[];
}

interface FeedbackContextValue {
  reading: React.RefObject<ReadingContext>;
  setReading: (context: ReadingContext) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useReadingContext(): FeedbackContextValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useReadingContext must be used inside <AppProviders>");
  return value;
}

// ---------------------------------------------------------------- error log
const MAX_ERRORS_PER_SESSION = 8;

/** Sends uncaught client errors to the alpha error log (rate-limited, no book text, best effort). */
function ErrorReporter({ userId }: { userId: string }) {
  const pathname = usePathname();
  const route = useRef(pathname);
  const sent = useRef(0);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    route.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const report = (message: string, stack?: string) => {
      if (!message || sent.current >= MAX_ERRORS_PER_SESSION || seen.current.has(message)) return;
      // Browser noise that is not actionable.
      if (/ResizeObserver loop|Script error\.?$/i.test(message)) return;
      seen.current.add(message);
      sent.current += 1;
      void getSupabase()
        .from("client_errors")
        .insert({
          user_id: userId,
          route: route.current,
          message: message.slice(0, 2000),
          stack: stack?.slice(0, 6000) ?? null,
          context: { viewport: `${window.innerWidth}x${window.innerHeight}`, ua: navigator.userAgent.slice(0, 300) },
        })
        .then(() => {});
    };
    const onError = (event: ErrorEvent) => report(event.message, event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string; stack?: string } | string | undefined;
      report(typeof reason === "string" ? reason : (reason?.message ?? "Unhandled promise rejection"), typeof reason === "string" ? undefined : reason?.stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [userId]);

  return null;
}

// ---------------------------------------------------------------- providers
export function AppProviders({ me, children }: { me: Access; children: ReactNode }) {
  // A ref, not state: the reader updates this on every page turn and nothing
  // needs to re-render — the feedback dialog reads it when it opens.
  const reading = useRef<ReadingContext>({});
  const setReading = useCallback((context: ReadingContext) => {
    reading.current = context;
  }, []);
  const feedback = useMemo(() => ({ reading, setReading }), [setReading]);

  // A light "last seen" heartbeat for the alpha admin's overview.
  useEffect(() => {
    void getSupabase().rpc("touch_last_seen").then(() => {});
  }, []);

  return (
    <MeContext.Provider value={me}>
      <FeedbackContext.Provider value={feedback}>
        <TooltipProvider>
          <ErrorReporter userId={me.user_id} />
          {children}
        </TooltipProvider>
      </FeedbackContext.Provider>
    </MeContext.Provider>
  );
}
