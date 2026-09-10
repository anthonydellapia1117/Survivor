import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellWeek, diffWeekCells } from "../../scripts/lynne/lib/roster-sheet";
import { weekForMessage } from "../../scripts/ops/lib/weeks";

describe("cellWeek", () => {
  it("reads the header shapes she uses", () => {
    expect(cellWeek("Week 1")).toBe(1);
    expect(cellWeek("WEEK 12")).toBe(12);
    expect(cellWeek(" wk 3 ")).toBe(3);
  });

  it("is null for anything that is not a week column", () => {
    expect(cellWeek("NAMES")).toBeNull();
    expect(cellWeek("NO.")).toBeNull();
    expect(cellWeek("Week 1 total")).toBeNull();
    expect(cellWeek("Weeks")).toBeNull();
  });
});

// The pattern lives in three places: this TypeScript copy, lynne_cell_week()
// in 20260910000065, and the inline regex in v_master_list (20260908224500).
// The SQL side is exercised by tests/sql/16_lynne_week_cells.sql; what a SQL
// suite cannot see is whether the TypeScript copy still says the same thing,
// which is the seam this holds shut - the same seam
// tests/unit/lynne-team-names-sql.test.ts holds for her team vocabulary.
describe("the week-key pattern, all three copies", () => {
  const pattern = /\^\\s\*\(\?:week\|wk\)\\s\*\(\\d\{1,2\}\)\\s\*\$/;

  it("matches the SQL function", () => {
    const sql = readFileSync("supabase/migrations/20260910000065_lynne_week_cells.sql", "utf8");
    const m = /regexp_match\(p_key, '([^']+)'/.exec(sql);
    expect(m, "lynne_cell_week must call regexp_match with a literal pattern").not.toBeNull();
    expect(m![1]).toMatch(pattern);
  });

  it("matches the pattern inlined in v_master_list", () => {
    const sql = readFileSync("supabase/migrations/20260908224500_master_list.sql", "utf8");
    const m = /regexp_match\(c\.key, '([^']+)'/.exec(sql);
    expect(m, "v_master_list must carry the week pattern inline").not.toBeNull();
    expect(m![1]).toMatch(pattern);
  });

  it("matches the TypeScript copy", () => {
    const ts = readFileSync("scripts/lynne/lib/roster-sheet.ts", "utf8");
    const m = /cellWeek[\s\S]{0,200}?exec\(header\)/.exec(ts);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/\^\\s\*\(\?:week\|wk\)\\s\*\(\\d\{1,2\}\)\\s\*\$/);
  });
});

describe("diffWeekCells", () => {
  const prev: { no: number; cells: Record<string, string> }[] = [
    { no: 1, cells: { "Week 1": "Seattle", "Week 2": "Dallas" } },
    { no: 2, cells: { "Week 1": "Miami" } },
    { no: 9, cells: { "Week 1": "Denver" } },
  ];

  it("names a week whose value she changed", () => {
    const d = diffWeekCells(prev, [{ no: 1, cells: { "Week 1": "Buffalo", "Week 2": "Dallas" } }]);
    expect(d.changed).toEqual([{ no: 1, week: 1, before: "Seattle", after: "Buffalo" }]);
    expect(d.unchanged).toBe(1);
  });

  it("counts a newly filled week", () => {
    const d = diffWeekCells(prev, [{ no: 2, cells: { "Week 1": "Miami", "Week 3": "Chicago" } }]);
    expect(d.added).toEqual([{ no: 2, week: 3, before: null, after: "Chicago" }]);
  });

  it("reports a week she blanked rather than acting on it", () => {
    const d = diffWeekCells(prev, [{ no: 1, cells: { "Week 2": "Dallas" } }]);
    expect(d.cleared).toEqual([{ no: 1, week: 1, before: "Seattle", after: null }]);
  });

  it("treats her own casing and spacing as no change", () => {
    const d = diffWeekCells(prev, [{ no: 2, cells: { "WEEK 1": " miami " } }]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it("says nothing about a NO. she removed - her sheet shrinking is not an error", () => {
    const d = diffWeekCells(prev, [{ no: 1, cells: { "Week 1": "Seattle", "Week 2": "Dallas" } }]);
    expect([...d.added, ...d.changed, ...d.cleared].some((c) => c.no === 9)).toBe(false);
  });

  it("says nothing about a NO. she has just added", () => {
    const d = diffWeekCells(prev, [{ no: 77, cells: { "Week 1": "Chicago" } }]);
    expect(d.added).toEqual([]);
  });

  it("ignores a column that is not a week", () => {
    const d = diffWeekCells([{ no: 1, cells: { PAID: "y" } }], [{ no: 1, cells: { PAID: "n" } }]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(0);
  });
});

describe("weekForMessage", () => {
  // The real boundaries: every week locks at 2:00 PM ET on its Friday.
  const bounds = (week: number, late: string | null) =>
    ({ week, window_label: "thu_fri", early_deadline_at: late, late_deadline_at: late }) as never;
  const weeks = [
    bounds(1, "2026-09-11T18:00:00Z"),
    bounds(2, "2026-09-18T18:00:00Z"),
    bounds(3, "2026-09-25T18:00:00Z"),
  ];

  it("takes the open week: her Wednesday email is about week 1", () => {
    // Gmail 1a08631cab24c4ce, received 2026-09-09 12:43 UTC.
    expect(weekForMessage(weeks, "2026-09-09T12:43:13Z")).toBe(1);
  });

  it("moves on once a week has locked", () => {
    expect(weekForMessage(weeks, "2026-09-11T18:00:01Z")).toBe(2);
  });

  it("counts a message that lands exactly on the boundary as that week", () => {
    expect(weekForMessage(weeks, "2026-09-11T18:00:00Z")).toBe(1);
  });

  it("is null after the last week locks rather than guessing one", () => {
    expect(weekForMessage(weeks, "2027-02-01T00:00:00Z")).toBeNull();
  });

  it("takes the earliest open boundary however the rows are ordered", () => {
    // The rows come back in whatever order PostgREST hands them over. A
    // first-match-wins reading returns week 3 here and puts her Wednesday
    // picks two weeks out.
    const shuffled = [weeks[2], weeks[0], weeks[1]];
    expect(weekForMessage(shuffled, "2026-09-09T12:43:13Z")).toBe(1);
  });

  it("is week 1 for a message that arrives before the season opens", () => {
    expect(weekForMessage(weeks, "2026-08-01T00:00:00Z")).toBe(1);
  });

  // A week with no stored boundary is skipped by an explicit `continue`. That
  // line is deliberately NOT asserted here: every other reading of a null
  // boundary (0, NaN, Infinity) loses to the initial best just as a skip does,
  // so no input distinguishes them. A test that passes whatever the line says
  // is not coverage, and this project would rather say so than keep one.
});
