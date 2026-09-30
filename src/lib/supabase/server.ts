import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { supabasePublishableKey, supabaseUrl } from "@/lib/config";
import type { Access } from "@/lib/types";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * It carries the signed-in user's session from cookies and the publishable
 * key only — every query still goes through RLS as that user. No secret /
 * service-role key exists anywhere in this application.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** The signed-in user's id, verified by Supabase Auth (deduplicated per request). */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

/** Profile + alpha access state of the signed-in user (deduplicated per request). */
export const getAccess = cache(async (): Promise<Access | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return null;
  return data as Access;
});
