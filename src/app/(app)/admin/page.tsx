import type { Metadata } from "next";
import { AdminView } from "@/components/admin/admin-view";
import { requireAdmin } from "@/lib/supabase/guard";

export const metadata: Metadata = { title: "Alpha admin" };

export default async function AdminPage() {
  // Navigation gate only. Every admin RPC and table re-checks admin rights in the database.
  const me = await requireAdmin();
  return <AdminView meId={me.user_id} />;
}
