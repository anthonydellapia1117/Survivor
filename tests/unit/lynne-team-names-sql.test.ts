// Her team vocabulary lives in src/lib/lynne/names.ts and, lower-cased, in
// the v_master_list view (migration 20260908224500), where the reveal gate
// maps her cell text to a team code. Two copies drift; this holds them
// together.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LYNNE_TEAM_NAME } from "../../src/lib/lynne/names";

const ROOT = path.resolve(__dirname, "../..");

// Three copies now: v_master_list (20260908224500), and v_team_pick_counts
// (20260913000072), which maps her cells to a team the same way to count them.
const COPIES = [
  "supabase/migrations/20260908224500_master_list.sql",
  "supabase/migrations/20260913000072_team_pick_counts.sql",
];

describe("her team names in SQL", () => {
  for (const file of COPIES) {
    it(`${path.basename(file)} carries exactly the names.ts vocabulary, lower-cased`, () => {
      const m = fs.readFileSync(path.join(ROOT, file), "utf8");
      const block = /lynne_team_names\(abbr, lname\) as \(\s*values([\s\S]*?)\)\s*,?\s*(?:select|[a-z_]+ as \()/i.exec(m)?.[1] ?? "";
      const sql = Object.fromEntries([...block.matchAll(/\('([A-Z]{2,3})', '([^']+)'\)/g)].map((x) => [x[1], x[2]]));
      const ts = Object.fromEntries(Object.entries(LYNNE_TEAM_NAME).map(([k, v]) => [k, v.toLowerCase()]));
      expect(Object.keys(sql)).toHaveLength(32);
      expect(sql).toEqual(ts);
    });
  }
});
