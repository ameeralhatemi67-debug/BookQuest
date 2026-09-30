import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const LARGE_PDF_MB = 64;

/** Generates the test books (never committed) before the first test runs. */
export default function globalSetup() {
  const dir = join(__dirname, ".fixtures");
  const large = join(dir, "large.pdf");
  const fresh = existsSync(join(dir, "the-lighthouse.epub")) && existsSync(join(dir, "field-notes.pdf")) && existsSync(join(dir, "cancel-me.pdf")) && existsSync(large) && statSync(large).size > LARGE_PDF_MB * 1024 * 1024 * 0.9;
  if (fresh) return;
  execFileSync(process.execPath, [join(__dirname, "..", "scripts", "make-fixtures.mjs"), "--large", String(LARGE_PDF_MB)], { stdio: "inherit" });
}
