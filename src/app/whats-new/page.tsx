import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { ReleaseItems } from "@/components/app/whats-new-items";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { APP_NAME, siteUrl } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { LATEST_RELEASE, WHATS_NEW, WHATS_NEW_PATH } from "@/lib/whats-new";

// The page a reader's shared link opens. It needs no account (the proxy lists
// it as public) and carries Open Graph tags, so chat apps show a preview card.
const title = `What's new in ${APP_NAME}: ${LATEST_RELEASE.title}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: `What's new`,
  description: LATEST_RELEASE.summary,
  alternates: { canonical: WHATS_NEW_PATH },
  openGraph: { title, description: LATEST_RELEASE.summary, url: WHATS_NEW_PATH, siteName: APP_NAME, type: "website" },
  twitter: { card: "summary_large_image", title, description: LATEST_RELEASE.summary },
};

export default function WhatsNewPage() {
  const earlier = WHATS_NEW.slice(1);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Logo />
        <ButtonLink href="/login" variant="ghost" size="sm">
          Sign in
        </ButtonLink>
      </header>

      <section className="py-14">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-accent-ink">
          <Sparkles className="size-3.5" aria-hidden /> What&apos;s new · {formatDate(LATEST_RELEASE.date)}
        </p>
        <h1 className="mt-4 text-4xl leading-[1.08] text-ink sm:text-6xl">{LATEST_RELEASE.title}</h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">{LATEST_RELEASE.summary}</p>

        <div className="mt-10">
          <ReleaseItems release={LATEST_RELEASE} />
        </div>

        <div className="mt-12 rounded-3xl border border-line bg-raised p-6 sm:p-8">
          <h2 className="font-display text-2xl text-ink">Read a book with friends, and find what they left for you</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
            {APP_NAME} turns one EPUB or PDF into a shared place. Everyone reads at their own pace, and what friends leave in the pages opens only when you reach them.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/signup" size="lg">
              Join the alpha
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">
              Sign in
            </ButtonLink>
          </div>
        </div>

        {earlier.length > 0 && (
          <div className="mt-14 space-y-10 border-t border-line pt-8">
            <h2 className="text-sm font-medium text-ink-soft">Earlier updates</h2>
            {earlier.map((release) => (
              <section key={release.id} aria-label={release.title}>
                <h3 className="font-display text-xl text-ink">{release.title}</h3>
                <p className="mb-4 text-xs text-ink-faint">
                  {formatDate(release.date)}. {release.summary}
                </p>
                <ReleaseItems release={release} />
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
