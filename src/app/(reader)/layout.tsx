import type { ReactNode } from "react";
import { AppProviders } from "@/components/app/providers";
import { requireAlpha } from "@/lib/supabase/guard";

// The reader is full-screen: no app shell, but the same session + feedback context.
export default async function ReaderLayout({ children }: { children: ReactNode }) {
  const me = await requireAlpha();
  return <AppProviders me={me}>{children}</AppProviders>;
}
