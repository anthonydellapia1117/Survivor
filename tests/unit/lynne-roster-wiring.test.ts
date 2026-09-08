// The roster loader cannot be run against the database in CI, so its two
// standing rules are guarded by reading the source: the only write it makes
// is the audited RPC admin_load_lynne_roster, and it never touches owners or
// entries (it is a reference, not an intake).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CLI = fs.readFileSync(path.join(ROOT, "scripts/lynne/roster.ts"), "utf8");
const LIB = fs.readFileSync(path.join(ROOT, "scripts/lynne/lib/roster-sheet.ts"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260908214000_lynne_roster.sql"), "utf8");

/** Source with comments removed, so a guard matches code and never the comment describing it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("lynne:roster wiring", () => {
  it("writes only through admin_load_lynne_roster, exactly once", () => {
    const c = code(CLI);
    const rpcs = [...c.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(rpcs).toEqual(["admin_load_lynne_roster"]);
    expect(c).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("never creates or changes an owner or an entry", () => {
    for (const src of [code(CLI), code(LIB)]) {
      expect(src).not.toMatch(/admin_create_owner|admin_add_entries|admin_update_entry|admin_merge_owner|admin_void/);
      expect(src).not.toMatch(/from\(\s*"(owners|entries)"/);
      expect(src).not.toMatch(/lynne_number/);
    }
  });

  it("reads lynne_roster only, and only to report what is loaded and to diff", () => {
    const c = code(CLI);
    const tables = [...c.matchAll(/\.from\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["lynne_roster"]));
  });

  it("the table has no write policy and the RPC is the only write path", () => {
    const m = MIGRATION.toLowerCase();
    expect(m).toContain("enable row level security");
    expect(m).toMatch(/create policy admin_read_lynne_roster on lynne_roster\s+for select using \(is_admin\(\)\)/);
    expect(m).not.toMatch(/create policy [a-z_]+ on lynne_roster\s+for (insert|update|delete|all)/);
    expect(m).not.toMatch(/insert into (owners|entries)/);
    expect(m).not.toMatch(/update (owners|entries)/);
  });

  it("carries no em dash, en dash or emoji", () => {
    for (const src of [CLI, LIB, MIGRATION]) {
      expect(src).not.toMatch(/[–—]/);
      expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
