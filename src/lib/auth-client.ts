"use client";

import { getSupabase } from "@/lib/supabase/client";

/** Signs out and removes anything this device cached for the session (downloaded books, signed cover URLs). */
export async function signOutAndClean(scope: "local" | "global" = "local"): Promise<void> {
  await getSupabase().auth.signOut({ scope });
  try {
    await caches.delete("marginalia-books-v1");
  } catch {
    // Cache Storage unavailable
  }
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("cover:")) sessionStorage.removeItem(key);
  } catch {
    // sessionStorage unavailable
  }
}
