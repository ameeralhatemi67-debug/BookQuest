import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <>
      <h1 className="mb-1 text-3xl text-ink">Join the alpha</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {next?.startsWith("/invite/") ? "Create an account to accept your invitation." : "Open to the first 75 readers. No code needed."}
      </p>
      <SignupForm next={next} />
    </>
  );
}
