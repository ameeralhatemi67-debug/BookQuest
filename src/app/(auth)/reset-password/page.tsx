import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/forms";
import { getUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reached through the emailed link, which signs the person in first.
  if (!(await getUserId())) redirect("/forgot-password");
  return (
    <>
      <h1 className="mb-1 text-3xl text-ink">Choose a new password</h1>
      <p className="mb-6 text-sm text-ink-soft">You&apos;ll stay signed in on this device.</p>
      <ResetPasswordForm />
    </>
  );
}
