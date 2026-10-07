import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClaimSeatButton, SignOutButton } from "@/components/auth/forms";
import { FormError } from "@/components/ui/field";
import { createSupabaseServer, getAccess } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Waiting for a seat" };

export default async function AlphaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : undefined;
  const access = await getAccess();
  if (!access) redirect("/login");
  if (access.status === "active") redirect(next ?? "/home");

  // A seat may have opened since this reader signed up: take it straight away.
  let seats: { used: number; capacity: number } | null = null;
  if (access.status === "pending") {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.rpc("claim_alpha_seat");
    if ((data as { status?: string } | null)?.status === "active") redirect(next ?? "/home");
    seats = data as { used: number; capacity: number } | null;
  }

  return (
    <>
      <h1 className="mb-1 text-3xl text-ink">{access.status === "disabled" ? "Access is switched off" : "The alpha is full for now"}</h1>
      {access.status === "disabled" ? (
        <div className="mt-4">
          <FormError>
            Access for this account has been switched off. If that seems wrong, contact the person running the alpha.
          </FormError>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm leading-relaxed text-ink-soft">
            {seats ? `All ${seats.capacity} seats are taken, ${access.display_name.split(" ")[0]}. ` : ""}
            Your account is saved. You&apos;ll get in as soon as a seat opens, or when the person running the alpha lets you in.
          </p>
          <ClaimSeatButton next={next} />
        </>
      )}
      <div className="mt-6 text-center">
        <SignOutButton className="text-sm text-ink-soft underline-offset-4 hover:underline">Sign out</SignOutButton>
      </div>
    </>
  );
}
