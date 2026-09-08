// Read .env.local and .env.production into process.env without overriding
// anything already set. The public Supabase values live in .env.production
// on purpose (see that file's header); the admin password never does.

import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env.production"]) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function requireEnv(name: string, hint: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. ${hint}`);
  return v;
}
