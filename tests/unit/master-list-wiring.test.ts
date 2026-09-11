// Standing rules for the master pool's data, read from the source: the public
// surfaces print her four figures and never a rate; the public view exposes
// exactly five columns of lynne_roster; and every old address for the list
// reaches the table.
//
// The PAGE is gone - on 2026-09-11 the Master List and the Grid became one
// table at /grid - so what these rules are checked against moved with it. The
// rules themselves did not move.

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
    for (const f of ["src/lib/master-list.ts", "src/app/grid/page.tsx", "src/components/grid/grid-view.tsx", "src/app/page.tsx"]) {
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

  it("every old address for the list reaches the one table, and the old name is still gone", () => {
    // The tab went with the merge; the addresses did not. All three land on
    // /grid, and nothing in the app carries the runner's own wording.
    const cfg = read("next.config.ts");
    for (const src of ["/master-list", "/lynne", "/official"]) {
      expect(cfg, src).toMatch(new RegExp(`source: "${src}", destination: "/grid"`));
    }
    expect(read("src/components/site-header.tsx")).not.toContain('href: "/master-list"');
    for (const f of walk(path.join(ROOT, "src"))) {
      expect(fs.readFileSync(f, "utf8"), path.relative(ROOT, f)).not.toMatch(/Official Results|Official Board|"\/official"/);
    }
  });

  it("carries no em dash, en dash or emoji", () => {
    // grid-view.tsx is deliberately NOT on this list: the padlock on a locked
    // cell is the Grid's own, it predates the merge, and the legend explains
    // it. The rule here is about her data's copy, not about that one glyph.
    for (const f of [
      "src/lib/master-list.ts",
      "src/app/grid/page.tsx",
      "src/lib/grid-sort.ts",
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
