import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { APP_TAGLINE } from "@/lib/config";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo />
          <p className="mt-2 font-display text-lg italic text-ink-soft">{APP_TAGLINE}</p>
        </div>
        <div className="rounded-3xl border border-line bg-raised p-6 shadow-soft sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-ink-faint">A private alpha for a small circle of readers.</p>
      </div>
    </main>
  );
}
