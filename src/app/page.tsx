import { BookOpen, Gift, Lock, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { APP_NAME, isSupabaseConfigured } from "@/lib/config";

function SetupNeeded() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <Logo />
      <h1 className="mt-8 text-4xl text-ink">Almost there — connect Supabase</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        {APP_NAME} needs a Supabase project for accounts, books and rooms. Copy <code className="rounded bg-sunk px-1.5 py-0.5 text-sm">.env.example</code> to{" "}
        <code className="rounded bg-sunk px-1.5 py-0.5 text-sm">.env.local</code>, fill in the project URL and publishable key, and restart the server.
      </p>
      <p className="mt-3 leading-relaxed text-ink-soft">
        The exact steps are in <code className="rounded bg-sunk px-1.5 py-0.5 text-sm">SETUP.md</code>. To try the app right now without a Supabase project, run{" "}
        <code className="rounded bg-sunk px-1.5 py-0.5 text-sm">npm run dev:local</code>.
      </p>
    </main>
  );
}

const POINTS = [
  { icon: Users, title: "A room is a book and its readers", body: "Read with one friend or a small group. Everyone moves at their own pace; you can see where each other are." },
  { icon: Gift, title: "Leave something in the pages", body: "A thought, a photo, a voice note — pinned to the exact place in the book that made you want to say it." },
  { icon: Lock, title: "Nothing is spoiled", body: "Friends see that you left something ahead. What it is stays sealed until they reach that page themselves." },
];

// Signed-in visitors never see this page: the proxy sends them to /home.
export default function LandingPage() {
  if (!isSupabaseConfigured()) return <SetupNeeded />;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Logo />
        <ButtonLink href="/login" variant="ghost" size="sm">
          Sign in
        </ButtonLink>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.2em] text-accent-ink">Closed alpha</p>
        <h1 className="mt-4 max-w-3xl animate-fade-up text-5xl leading-[1.05] text-ink sm:text-7xl">
          Your friends are <em className="text-accent">inside the book</em> with you.
        </h1>
        <p className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-ink-soft">
          {APP_NAME} turns a book into a shared place. Read at your own pace, see where your friends are, and discover what they left for you — only when you
          get there.
        </p>
        <div className="mt-9 flex animate-fade-up flex-wrap gap-3">
          <ButtonLink href="/signup" size="lg" icon={<BookOpen className="size-5" aria-hidden />}>
            I have an invitation
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="lg">
            Sign in
          </ButtonLink>
        </div>

        <ul className="mt-16 grid gap-4 sm:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-3xl border border-line bg-raised p-6">
              <Icon className="size-5 text-accent" aria-hidden />
              <h2 className="mt-3 font-display text-xl text-ink">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-xs text-ink-faint">A private test for a small circle of readers. Not open to the public yet.</footer>
    </main>
  );
}
