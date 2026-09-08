// Her team vocabulary lives in src/lib/lynne/names.ts and, lower-cased, in
// the v_master_list view (migration 20260908224500), where the reveal gate
// maps her cell text to a team code. Two copies drift; this holds them
// together.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LYNNE_TEAM_NAME } from "../../src/lib/lynne/names";

const ROOT = path.resolve(__dirname, "../..");

describe("her team names in SQL", () => {
  it("v_master_list carries exactly the names.ts vocabulary, lower-cased", () => {
    const m = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260908224500_master_list.sql"), "utf8");
    const block = /lynne_team_names\(abbr, lname\) as \(\s*values([\s\S]*?)\)\s*select/i.exec(m)?.[1] ?? "";
    const sql = Object.fromEntries([...block.matchAll(/\('([A-Z]{2,3})', '([^']+)'\)/g)].map((x) => [x[1], x[2]]));
    const ts = Object.fromEntries(Object.entries(LYNNE_TEAM_NAME).map(([k, v]) => [k, v.toLowerCase()]));
    expect(Object.keys(sql)).toHaveLength(32);
    expect(sql).toEqual(ts);
  });
});
