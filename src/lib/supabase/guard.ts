import "server-only";

import { redirect } from "next/navigation";
import { getAccess } from "@/lib/supabase/server";
import type { Access } from "@/lib/types";

/**
 * Server-side gate for every page inside the alpha: signed in AND holding
 * active alpha access. (Navigation convenience — the database enforces the
 * same rule on every query.)
 */
export async function requireAlpha(next?: string): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  if (access.status !== "active") redirect(next ? `/alpha?next=${encodeURIComponent(next)}` : "/alpha");
  return access;
}

export async function requireAdmin(): Promise<Access> {
  const access = await requireAlpha();
  if (!access.is_admin) redirect("/home");
  return access;
}
