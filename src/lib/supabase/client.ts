"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "@/lib/config";

let browserClient: SupabaseClient | undefined;

/** The one Supabase client for this browser tab (publishable key + the user's session cookie). */
export function getSupabase(): SupabaseClient {
  browserClient ??= createBrowserClient(supabaseUrl(), supabasePublishableKey());
  return browserClient;
}
