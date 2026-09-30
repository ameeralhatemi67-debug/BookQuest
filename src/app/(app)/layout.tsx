import type { ReactNode } from "react";
import { NotificationsProvider } from "@/components/app/notifications";
import { AppProviders } from "@/components/app/providers";
import { AppShell } from "@/components/app/shell";
import { requireAlpha } from "@/lib/supabase/guard";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireAlpha();
  return (
    <AppProviders me={me}>
      <NotificationsProvider initialUnread={0}>
        <AppShell>{children}</AppShell>
      </NotificationsProvider>
    </AppProviders>
  );
}
