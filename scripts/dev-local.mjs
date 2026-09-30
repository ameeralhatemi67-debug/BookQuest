import { spawn, execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56421",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_emulator", NEXT_PUBLIC_SITE_URL: "http://localhost:3000", NEXT_PUBLIC_UPLOAD_LIMIT_MB: "500" };
const children = [];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
    } else child.kill("SIGTERM");
  }
  process.exitCode = code;
}
function run(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], { env, stdio: "inherit", windowsHide: true });
  children.push(child);
  child.on("error", (error) => { console.error(error.message); close(1); });
  child.on("exit", (code) => close(code ?? 0));
  return child;
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
run("node_modules/tsx/dist/cli.mjs", ["dev/emulator/server.ts"]);
let ready = false;
for (let attempt = 0; attempt < 120 && !closing; attempt++) {
  try { ready = (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/emu/health`)).ok; } catch {}
  if (ready) break;
  await setTimeout(500);
}
if (!ready) { console.error("The local backend did not start."); close(1); }
else run("node_modules/next/dist/bin/next", ["dev"]);
