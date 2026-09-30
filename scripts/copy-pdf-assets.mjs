// Copies the PDF.js worker and its supporting assets into /public/pdfjs so the
// reader can load them from our own origin (no CDN, no bundler worker quirks).
// Runs on postinstall, so it also runs during the Vercel build.
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

if (!existsSync(src)) {
  console.warn("[pdf-assets] pdfjs-dist is not installed yet; skipping.");
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

// The legacy build keeps older Safari / Android WebViews working.
await cp(join(src, "legacy", "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  if (existsSync(join(src, dir))) {
    await cp(join(src, dir), join(dest, dir), { recursive: true });
  }
}
console.log("[pdf-assets] copied PDF.js worker and assets to public/pdfjs");
