import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        // Runs the real migrations on PGlite (real Postgres in WASM) and checks
        // authorization at the database layer. No Docker, no network.
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        // Drives the local emulator with the real supabase-js / tus-js-client
        // libraries: auth, Data API, Storage (incl. resumable uploads), Realtime.
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
