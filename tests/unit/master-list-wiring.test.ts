// Standing rules for the Master List, read from the source: the public
// surfaces print her four figures and never a rate; the public view
// exposes exactly five columns of lynne_roster; the tab is the Master List
// everywhere and the old name is gone.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("Master List wiring", () => {
  it("the per-entry rate is an admin-only check: nothing public divides the pot", () => {
    const src = walk(path.join(ROOT, "src"));
    const mention = src.filter((f) => /\bperEntry\b|Implied .* per/.test(fs.readFileSync(f, "utf8")));
    expect(mention.map((f) => path.relative(ROOT, f))).toEqual(["src/components/admin/pool-pot-form.tsx"]);
    for (const f of ["src/lib/master-list.ts", "src/app/master-list/page.tsx", "src/components/master-list/master-list-table.tsx", "src/app/page.tsx"]) {
      expect(read(f), f).not.toMatch(/22\.5|\/\s*(?:[\w$.]+\.)?pool(Paid|Entry)Count\b|poolPotCents\s*\/|per (paying )?entry/i);
    }
  });

  it("v_master_list exposes exactly row_no, names, cells, sheet_loaded_at and entry_id", () => {
    const m = read("supabase/migrations/20260908224500_master_list.sql");
    const body = /create view v_master_list as([\s\S]*?);/.exec(m)?.[1] ?? "";
    const selectList = /\)\s*select\s+([\s\S]*?)\bfrom lynne_roster r\b/i.exec(body)?.[1] ?? "";
    // Fold every parenthesised expression (the gated cells subquery) to a
    // placeholder so the split on commas sees only the output columns.
    let flat = selectList;
    for (let i = 0; i < 20 && /\([^()]*\)/.test(flat); i++) flat = flat.replace(/\([^()]*\)/g, "@");
    const cols = flat
      .split(",")
      .map((c) => c.trim().split(/\s+as\s+/i).pop()?.replace(/^.*\./, "").trim())
      .filter(Boolean);
    expect(cols).toEqual(["row_no", "names", "cells", "sheet_loaded_at", "entry_id"]);
    expect(body).not.toMatch(/source_file|gmail_message_id|loaded_by/);
    expect(m).toMatch(/grant select on v_master_list to anon, authenticated/);
  });

  it("the Teams page opens on the pool only once she has published a week, through the shared default", () => {
    expect(read("src/components/teams/teams-source.tsx")).toMatch(/useState<Source>\(defaultTeamsSource\(poolLoaded, poolHasPicks\)\)/);
  });

  it("the tab reads Master List and the old name is gone from the app", () => {
    expect(read("src/lib/site-copy.ts")).toMatch(/tab: "Master List"/);
    expect(read("src/components/site-header.tsx")).toContain('href: "/master-list"');
    expect(read("next.config.ts")).toMatch(/source: "\/official", destination: "\/master-list"/);
    for (const f of walk(path.join(ROOT, "src"))) {
      expect(fs.readFileSync(f, "utf8"), path.relative(ROOT, f)).not.toMatch(/Official Results|Official Board|"\/official"/);
    }
  });

  it("carries no em dash, en dash or emoji", () => {
    for (const f of [
      "src/lib/master-list.ts",
      "src/app/master-list/page.tsx",
      "src/components/master-list/master-list-table.tsx",
      "src/components/master-list/weekly-result-files.tsx",
      "src/components/teams/teams-source.tsx",
      "src/components/admin/pool-pot-form.tsx",
      "supabase/migrations/20260908224500_master_list.sql",
    ]) {
      expect(read(f), f).not.toMatch(/[–—]/);
      expect(read(f), f).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
