import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlphaCodeForm, SignOutButton } from "@/components/auth/forms";
import { FormError } from "@/components/ui/field";
import { getAccess } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alpha access" };

export default async function AlphaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : undefined;
  const access = await getAccess();
  if (!access) redirect("/login");
  if (access.status === "active") redirect(next ?? "/home");

  return (
    <>
      <h1 className="mb-1 text-3xl text-ink">One more step, {access.display_name.split(" ")[0]}</h1>
      {access.status === "disabled" ? (
        <div className="mt-4">
          <FormError>
            Access for this account has been switched off. If that seems wrong, contact the person running the alpha.
          </FormError>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm leading-relaxed text-ink-soft">
            This is a closed alpha. Enter the code from your invitation to come in — it only needs doing once.
          </p>
          <AlphaCodeForm next={next} />
        </>
      )}
      <div className="mt-6 text-center">
        <SignOutButton className="text-sm text-ink-soft underline-offset-4 hover:underline">Sign out</SignOutButton>
      </div>
    </>
  );
}
