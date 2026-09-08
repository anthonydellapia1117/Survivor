import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as XLSXStyle from "xlsx-js-style";
import * as XLSX from "xlsx";
import type { CurrentPickRow, EntryRow, StandingRow } from "../../scripts/lib/db";
import { buildResultsPlan, sha256Of } from "../../scripts/results/lib/plan";

// Her grid format, the same synthetic shape tests/unit/lynne-grid.test.ts uses.
function makeGrid(
  rows: { no: number | string; name: string; fill?: string; cells?: Record<number, string> }[],
  weekHeaders = ["Week 1", "WEEK 2", "week 3"],
): Buffer {
  const headers = ["NO.", "NAMES", ...weekHeaders];
  const aoa: unknown[][] = [headers];
  for (const r of rows) {
    const line: unknown[] = [r.no, r.name];
    for (let w = 1; w <= weekHeaders.length; w++) line.push(r.cells?.[w] ?? "");
    aoa.push(line);
  }
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  for (let i = 0; i < rows.length; i++) {
    const fill = rows[i].fill;
    if (!fill) continue;
    const addr = XLSXStyle.utils.encode_cell({ r: i + 1, c: 1 });
    ws[addr].s = { fill: { patternType: "solid", fgColor: { rgb: fill } } };
  }
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

// A legacy per-week file: entry / team / result columns.
function makeLegacy(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([["Entry", "Team", "Result"], ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Week");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function entry(id: string, name: string, extra: Partial<EntryRow> = {}): EntryRow {
  return {
    id,
    owner_id: "o1",
    entry_name: name,
    player_email: null,
    is_gifted: false,
    is_free_entry: false,
    lynne_number: null,
    lynne_label: null,
    voided_at: null,
    ...extra,
  };
}

function pick(entryId: string, team: string, result: string | null = null): CurrentPickRow {
  return { entry_id: entryId, team, late: false, submitted_at: "2026-09-10T12:00:00Z", result };
}

function standing(entryId: string, status: string): StandingRow {
  return { entry_id: entryId, status, losses: status === "eliminated" ? 1 : 0, bye_used: false };
}

const ENTRIES: EntryRow[] = [
  entry("e1", "Anthony DellaPia #5", { lynne_number: 980, lynne_label: "Anthony DellaPia 5" }),
  entry("e2", "Alexc 1", { lynne_number: 1006 }),
  entry("e3", "Nolan Lawrence 1"),
  entry("e4", "Pumpy321", { lynne_number: 777 }),
  entry("e5", "Gone Guy", { lynne_number: 999 }),
  entry("e6", "Still Here", { lynne_number: 998 }),
  // Voided: must never be a target, even though her sheet has this name.
  entry("e7", "Somebody Else", { voided_at: "2026-09-04T00:00:00Z" }),
];

const STANDINGS: StandingRow[] = [
  standing("e1", "active"),
  standing("e2", "active"),
  standing("e3", "active"),
  standing("e4", "active"),
  standing("e5", "eliminated"),
  standing("e6", "active"),
];

const GRID = makeGrid([
  { no: 980, name: "Anthony DellaPia 5", cells: { 1: "Philadelphia", 2: "Dallas" } },
  { no: 1006, name: "Alexc 1", fill: "FF0000", cells: { 1: "Buffalo", 2: "OUT" } },
  { no: 1037, name: "Nolan Lawrence 1", cells: { 2: "Green Bay" } },
  { no: 500, name: "Somebody Else", cells: { 2: "Miami" } },
  { no: 777, name: "Not Our Name", cells: { 2: "Denver" } },
]);

const WEEK2_PICKS: CurrentPickRow[] = [pick("e1", "DAL"), pick("e2", "BUF"), pick("e3", "KC"), pick("e6", "NE")];

describe("buildResultsPlan on her grid", () => {
  const plan = buildResultsPlan({
    buf: GRID,
    filename: "Football_2026-2.xlsx",
    week: 2,
    entries: ENTRIES,
    standings: STANDINGS,
    localPicks: WEEK2_PICKS,
  });
  if (plan.format !== "grid") throw new Error("expected the grid path");

  it("takes the grid path and its sha256 is the file's", () => {
    expect(plan.sha256).toBe(createHash("sha256").update(GRID).digest("hex"));
    expect(sha256Of(GRID)).toBe(plan.sha256);
    expect(plan.weeksInFile).toEqual([1, 2, 3]);
    expect(plan.latestFilledWeek).toBe(2);
  });

  it("applies nothing, even where her sheet says OUT", () => {
    expect(plan.applies).toEqual([]);
    const alexc = plan.rows.find((r) => r.entry === "Alexc 1");
    expect(alexc?.result).toBe("out");
  });

  it("matches by number then exact name, never the voided entry, and counts the rest of her pool", () => {
    expect(plan.matchedCount).toBe(3);
    expect(plan.matchedBy).toEqual({ lynne_number: 2, entry_name: 1 });
    expect(plan.otherPoolCount).toBe(1);
  });

  it("stores only our rows and records her true sheet size", () => {
    expect(plan.rows.map((r) => r.entry)).toEqual(["Anthony DellaPia 5", "Alexc 1", "Nolan Lawrence 1", "Not Our Name"]);
    expect(plan.rowCount).toBe(5);
    expect(plan.rows.find((r) => r.entry === "Nolan Lawrence 1")).toMatchObject({ team: "GB", result: null, no: 1037 });
  });

  it("carries a number/name disagreement as a conflict and as unmatched, never a guess", () => {
    expect(plan.conflicts).toEqual([
      { no: 777, name: "Not Our Name", reason: "number_name_disagree", entryName: "Pumpy321" },
    ]);
    expect(plan.unmatched.map((u) => u.entry)).toEqual(["Not Our Name"]);
  });

  it("suggests her number for an entry we hold none for, without setting it", () => {
    expect(plan.numberSuggestions).toEqual([{ entryName: "Nolan Lawrence 1", sheetNo: 1037 }]);
  });

  it("splits missing into confirmed removals and absent but alive", () => {
    expect(plan.missingCount).toBe(3);
    expect(plan.confirmedRemovals).toBe(1);
    expect(plan.absentButAlive).toBe(2);
  });

  it("records every variance with both sides and decides none", () => {
    const byType = new Map(plan.variances.map((v) => [`${v.type}:${v.entryName}`, v]));
    expect(byType.get("team_mismatch:Nolan Lawrence 1")).toMatchObject({
      lynne: { team: "GB" },
      local: { team: "KC" },
    });
    expect(byType.get("status_conflict:Alexc 1")).toMatchObject({
      lynne: { result: "out" },
      local: { team: "BUF", result: "alive" },
    });
    expect(byType.get("absent_but_alive:Still Here")).toMatchObject({ local: { team: "NE", result: "active" } });
    expect(byType.get("absent_but_alive:Pumpy321")).toBeDefined();
    expect(plan.variances).toHaveLength(4);
    expect(plan.teamAgreements).toBe(1);
    expect(plan.statusAgreements).toBe(0);
  });

  it("reports her counts as absent when the file has no stats block", () => {
    expect(plan.herCounts).toBeNull();
  });

  it("refuses a week her sheet has no column for, in the app's words", () => {
    expect(() =>
      buildResultsPlan({ buf: GRID, filename: "f.xlsx", week: 4, entries: ENTRIES, standings: STANDINGS, localPicks: [] }),
    ).toThrow("Her sheet has no Week 4 column (it has Week 1, Week 2, Week 3).");
  });
});

describe("buildResultsPlan on a legacy file", () => {
  const LEGACY = makeLegacy([
    ["Pumpy321", "PHI", "W"],
    ["Anthony DellaPia #5", "DAL", "L"],
    ["Nolan Lawrence 1", "GB", "W"],
    ["Still Here", "NE", ""],
    ["Unknown Person", "SF", "W"],
  ]);
  const plan = buildResultsPlan({
    buf: LEGACY,
    filename: "week2.xlsx",
    week: 2,
    entries: ENTRIES,
    standings: STANDINGS,
    localPicks: [pick("e4", "PHI"), pick("e1", "DAL", "loss"), pick("e3", "KC"), pick("e6", "NE")],
  });
  if (plan.format !== "legacy") throw new Error("expected the legacy path");

  it("takes the legacy path with the file's sha256", () => {
    expect(plan.sha256).toBe(sha256Of(LEGACY));
    expect(plan.rowCount).toBe(5);
    expect(plan.matchedCount).toBe(4);
    expect(plan.matchedBy).toEqual({ entry_name: 4 });
  });

  it("applies only the row that agrees with the local pick and carries a result", () => {
    expect(plan.applies).toEqual([{ entry_id: "e4", result: "win" }]);
    expect(plan.alreadyApplied).toBe(1);
    expect(plan.noResultYet).toBe(1);
  });

  it("makes a team disagreement a variance with both sides, not an apply", () => {
    expect(plan.variances).toHaveLength(1);
    expect(plan.variances[0]).toMatchObject({
      type: "team_mismatch",
      entryName: "Nolan Lawrence 1",
      lynne: { team: "GB", result: "win" },
      local: { team: "KC", result: null },
    });
  });

  it("leaves an unknown name unmatched for review", () => {
    expect(plan.unmatched.map((u) => u.entry)).toEqual(["Unknown Person"]);
  });
});
