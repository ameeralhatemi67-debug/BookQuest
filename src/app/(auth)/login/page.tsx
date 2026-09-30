import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/forms";
import { FormError } from "@/components/ui/field";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <>
      <h1 className="mb-1 text-3xl text-ink">Welcome back</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {next?.startsWith("/invite/") ? "Sign in to open your invitation." : "Your books are where you left them."}
      </p>
      {params.error === "link" && (
        <div className="mb-4">
          <FormError>That link has expired or was already used. Sign in, or request a new one.</FormError>
        </div>
      )}
      <LoginForm next={next} />
    </>
  );
}
