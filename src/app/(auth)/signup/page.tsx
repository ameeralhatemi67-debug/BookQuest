import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const code = typeof params.code === "string" ? params.code : undefined;
  return (
    <>
      <h1 className="mb-1 text-3xl text-ink">Join the alpha</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {next?.startsWith("/invite/") ? "Create an account to accept your invitation." : "You'll need the alpha code from your invitation."}
      </p>
      <SignupForm next={next} code={code} />
    </>
  );
}
