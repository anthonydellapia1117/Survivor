import { describe, expect, it } from "vitest";
import type { GridCell } from "../../src/lib/data/types";
import {
  filterRows,
  herCell,
  matchPick,
  poolDistribution,
  poolStats,
  poolWeekFilled,
  weekColumns,
  type MasterRow,
} from "../../src/lib/master-list";

const ROWS: MasterRow[] = [
  { no: 1, names: "Lynne P", cells: { "Week 1": "Dallas", "Week 2": "Buffalo" }, entryId: null },
  { no: 674, names: "Ian Lubin 1", cells: { "Week 1": "OUT" }, entryId: null },
  { no: 983, names: "Adriana Flacco ", cells: { "Week 1": "Philadelphia" }, entryId: "e-983" },
  { no: 1005, names: "E.A.T.", cells: { "WEEK 1": "Seattle" }, entryId: "e-1005" },
  { no: 1089, names: "Andrew Dicicco #1", cells: {}, entryId: "e-1089" },
  { no: 1319, names: "Ian Lubin 1", cells: { "Week 1": "  " }, entryId: null },
];

function cell(entryId: string, week: number, team: string): GridCell {
  return { entryId, week, team, result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null };
}

describe("weekColumns", () => {
  it("reads her headers as she wrote them, once per week, in week order", () => {
    expect(weekColumns(ROWS)).toEqual([
      { week: 1, key: "Week 1" },
      { week: 2, key: "Week 2" },
    ]);
    expect(weekColumns([{ cells: { "WEEK 18": "x", "Wk 3": "y", Notes: "z" } }])).toEqual([
      { week: 3, key: "Wk 3" },
      { week: 18, key: "WEEK 18" },
    ]);
  });

  it("treats a blank cell as no cell", () => {
    const col = { week: 1, key: "Week 1" };
    expect(herCell(ROWS[5], col)).toBeUndefined();
    expect(herCell(ROWS[0], col)).toBe("Dallas");
  });
});

describe("matchPick", () => {
  it("compares her team name with our code and reports a variance instead of resolving it", () => {
    expect(matchPick("Philadelphia", cell("e", 1, "PHI"))).toEqual({ kind: "match", team: "PHI" });
    expect(matchPick("Dallas", cell("e", 1, "PHI"))).toEqual({ kind: "variance", hers: "DAL", ours: "PHI" });
    expect(matchPick("dallas ", cell("e", 1, "DAL"))).toEqual({ kind: "match", team: "DAL" });
  });

  it("keeps her non-team text as text beside our pick", () => {
    expect(matchPick("OUT", cell("e", 1, "PHI"))).toEqual({ kind: "text", hers: "OUT", ours: "PHI" });
  });

  it("never reveals a masked pick and handles one side missing", () => {
    expect(matchPick("Dallas", cell("e", 1, "LOCKED"))).toEqual({ kind: "hers" });
    expect(matchPick(undefined, cell("e", 1, "LOCKED"))).toEqual({ kind: "none" });
    expect(matchPick(undefined, cell("e", 1, "PHI"))).toEqual({ kind: "ours", ours: "PHI" });
    expect(matchPick("Dallas", undefined)).toEqual({ kind: "hers" });
    expect(matchPick(undefined, undefined)).toEqual({ kind: "none" });
  });

  it("matches a bye only against her word for it", () => {
    expect(matchPick("Bye", cell("e", 9, "SKIP_WEEK"))).toEqual({ kind: "match", team: "SKIP_WEEK" });
    expect(matchPick("Dallas", cell("e", 9, "SKIP_WEEK"))).toEqual({ kind: "text", hers: "Dallas", ours: "SKIP_WEEK" });
  });
});

describe("filterRows", () => {
  it("matches a NO. by prefix and a name by case-insensitive contains, ours only when asked", () => {
    expect(filterRows(ROWS, "10", false).map((r) => r.no)).toEqual([1005, 1089]);
    expect(filterRows(ROWS, "ian lubin", false).map((r) => r.no)).toEqual([674, 1319]);
    expect(filterRows(ROWS, "", true).map((r) => r.no)).toEqual([983, 1005, 1089]);
    expect(filterRows(ROWS, "flacco", true).map((r) => r.no)).toEqual([983]);
    expect(filterRows(ROWS, "   ", false)).toHaveLength(6);
  });
});

describe("poolDistribution", () => {
  it("counts her team names for the week as shares of the cells that named a team", () => {
    expect(poolDistribution(ROWS, 1)).toEqual({
      rows: [
        { team: "DAL", count: 1, pct: 33 },
        { team: "PHI", count: 1, pct: 33 },
        { team: "SEA", count: 1, pct: 33 },
      ],
      other: 1,
    });
    expect(poolDistribution(ROWS, 2)).toEqual({ rows: [{ team: "BUF", count: 1, pct: 100 }], other: 0 });
    expect(poolDistribution(ROWS, 3)).toBeNull();
    expect(poolWeekFilled(ROWS, 1)).toBe(true);
    expect(poolWeekFilled(ROWS, 3)).toBe(false);
  });
});

describe("poolStats", () => {
  it("prints her four figures as published and never a per-entry rate", () => {
    const stats = poolStats({ poolEntryCount: 1318, poolFreeCount: 46, poolPaidCount: 1272, poolPotCents: 2862000 });
    expect(stats).toEqual([
      { label: "Total in Pool", value: "1,318" },
      { label: "Free", value: "46" },
      { label: "Total", value: "1,272" },
      { label: "Total Pay Out", value: "$28,620" },
    ]);
    expect(JSON.stringify(stats)).not.toMatch(/22\.5/);
  });

  it("leaves off a figure she has not given rather than showing zero", () => {
    expect(poolStats({ poolEntryCount: 1318, poolFreeCount: null, poolPaidCount: null, poolPotCents: null })).toEqual([
      { label: "Total in Pool", value: "1,318" },
    ]);
  });
});
