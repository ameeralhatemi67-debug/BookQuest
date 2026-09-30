// Central, typed access to public configuration. Nothing secret lives here:
// the browser only ever receives the project URL and the *publishable* key.

/** Product name. Working title — change it here and it changes everywhere. */
export const APP_NAME = "Marginalia";
export const APP_TAGLINE = "Read together, at your own pace.";

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in ` +
        `(or run \`npm run dev:local\` to use the local emulator).`,
    );
  }
  return value;
}

// NEXT_PUBLIC_* variables must be referenced literally so Next.js can inline them.
export const supabaseUrl = () => required(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
export const supabasePublishableKey = () =>
  required(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

export const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/** Canonical origin of this deployment, used in auth emails and invite links. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Base URL for large uploads. Hosted projects get much better throughput on the
 * dedicated Storage hostname (`<ref>.storage.supabase.co`); anything else
 * (local stack, custom domains) uploads to the project URL itself.
 */
export function storageBaseUrl(projectUrl: string = supabaseUrl()): string {
  const override = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_URL;
  if (override) return override.replace(/\/$/, "");
  try {
    const url = new URL(projectUrl);
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname);
    if (match) return `https://${match[1]}.storage.supabase.co`;
  } catch {
    // fall through
  }
  return projectUrl.replace(/\/$/, "");
}
