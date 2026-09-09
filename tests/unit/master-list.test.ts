import { describe, expect, it } from "vitest";
import type { GridCell } from "../../src/lib/data/types";
import {
  defaultTeamsSource,
  filterRows,
  herCell,
  herOut,
  matchPick,
  mergeWeekColumns,
  poolAsEntries,
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
      revealed: 4,
    });
    expect(poolDistribution(ROWS, 2)).toEqual({ rows: [{ team: "BUF", count: 1, pct: 100 }], other: 0, revealed: 1 });
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
      { label: "Total Paid", value: "1,272" },
      { label: "Total Payout", value: "$28,620" },
    ]);
    expect(JSON.stringify(stats)).not.toMatch(/22\.5/);
  });

  it("leaves off a figure she has not given rather than showing zero", () => {
    expect(poolStats({ poolEntryCount: 1318, poolFreeCount: null, poolPaidCount: null, poolPotCents: null })).toEqual([
      { label: "Total in Pool", value: "1,318" },
    ]);
  });
});

describe("poolAsEntries", () => {
  it("turns her rows into the Teams shapes: OUT eliminates, team names become picks, other text is left alone", () => {
    const { entries, cells } = poolAsEntries({ loadedAt: "2026-09-08T21:53:00Z", rows: ROWS });
    expect(entries).toHaveLength(6);
    const one = entries.find((e) => e.id === "pool-1")!;
    expect(one.entryName).toBe("1 Lynne P");
    expect(one.status).toBe("active");
    expect(one.teamsUsed).toEqual(["DAL", "BUF"]);
    expect(cells.filter((c) => c.entryId === "pool-1").map((c) => [c.week, c.team])).toEqual([[1, "DAL"], [2, "BUF"]]);
    expect(entries.find((e) => e.id === "pool-674")!.status).toBe("eliminated");
    expect(cells.some((c) => c.entryId === "pool-674")).toBe(false);
    expect(cells.some((c) => c.entryId === "pool-1319")).toBe(false);
    expect(entries.find((e) => e.id === "pool-983")!.isAdminEntry).toBe(true);
    expect(entries.find((e) => e.id === "pool-1")!.isAdminEntry).toBe(false);
    expect(cells[0].submittedAt).toBe("2026-09-08T21:53:00Z");
    expect(herOut(ROWS[1])).toBe(true);
    expect(herOut(ROWS[0])).toBe(false);
  });
});

describe("mergeWeekColumns and defaultTeamsSource", () => {
  it("adds a plain column only for a week she has not published, keeping her key for one she has", () => {
    expect(mergeWeekColumns([{ week: 1, key: "WEEK 1" }], [1, 3])).toEqual([
      { week: 1, key: "WEEK 1" },
      { week: 3, key: "Week 3" },
    ]);
  });

  it("opens the Teams page on the pool only once a sheet is loaded and carries a pick", () => {
    expect(defaultTeamsSource(true, true)).toBe("pool");
    expect(defaultTeamsSource(true, false)).toBe("ours");
    expect(defaultTeamsSource(false, false)).toBe("ours");
  });
});
