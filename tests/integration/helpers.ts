// Integration tests talk to a running backend through the *real* client
// libraries (supabase-js, tus-js-client) — the same code paths the app uses.
//
// Target selection:
//   TEST_SUPABASE_URL + TEST_SUPABASE_KEY set → that backend (e.g. `supabase start`)
//   otherwise                                  → an in-memory local emulator
//
// Either way the backend must have the seed alpha code LOCAL-ALPHA.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { startEmulator } from "../../dev/emulator/server";

export interface Backend {
  url: string;
  key: string;
  kind: "emulator" | "supabase";
  /** Emulator-only test hooks (no-ops against a real backend). */
  chaos(body: { failNextPatches?: number; disconnectRealtime?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function startBackend(): Promise<Backend> {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_KEY;
  if (url && key) {
    return { url, key, kind: "supabase", chaos: async () => {}, close: async () => {} };
  }
  const port = 56500 + Math.floor(Math.random() * 400);
  const emulator = await startEmulator({ port, dataDir: null, quiet: true });
  return {
    url: emulator.url,
    key: "sb_publishable_local_emulator",
    kind: "emulator",
    async chaos(body) {
      await fetch(`${emulator.url}/emu/chaos`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-emu-control": "1" },
        body: JSON.stringify(body),
      });
    },
    close: () => emulator.close(),
  };
}

export interface Tester {
  client: SupabaseClient;
  id: string;
  email: string;
  name: string;
}

const run = Math.random().toString(36).slice(2, 8);

export function anonClient(backend: Backend): SupabaseClient {
  return createClient(backend.url, backend.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signUp(backend: Backend, name: string, code: string | null = "LOCAL-ALPHA"): Promise<Tester> {
  const client = anonClient(backend);
  const email = `${name.toLowerCase()}-${run}@example.test`;
  const { data, error } = await client.auth.signUp({
    email,
    password: "correct horse battery",
    options: { data: { display_name: name, ...(code ? { alpha_code: code } : {}) } },
  });
  if (error || !data.session) throw new Error(`sign-up failed for ${name}: ${error?.message ?? "no session (is email confirmation on?)"}`);
  return { client, id: data.user!.id, email, name };
}

/** Throws on RPC error so tests read naturally. */
export async function rpc<T = unknown>(tester: Tester, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await tester.client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Deterministic pseudo-random bytes (incompressible, reproducible, never committed). */
export function syntheticBytes(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** A minimal but structurally valid PDF header followed by filler, of exactly `size` bytes. */
export function syntheticPdf(size: number): Blob {
  const head = new TextEncoder().encode("%PDF-1.7\n% synthetic upload fixture\n");
  const body = syntheticBytes(size - head.length, 7);
  return new Blob([head, body], { type: "application/pdf" });
}

export async function waitFor<T>(check: () => T | undefined | null | false, timeoutMs = 10_000, label = "condition"): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
