import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { parseLynneGrid } from "@/lib/lynne/parse-grid";
import {
  computeGridPlan,
  matchGridRows,
  normalizeGridTeam,
  type GridTarget,
} from "@/lib/lynne/plan-grid";

// ---------------------------------------------------------------------------
// Gold fixture: her real final 2025 sheet, the file the archive was built
// from. If the parser reads this correctly, it reads her format.
// ---------------------------------------------------------------------------

const REAL_FILE = join(__dirname, "../../Football_2025-54.xlsx");

describe("parseLynneGrid on her real 2025 file", () => {
  const parsed = parseLynneGrid(readFileSync(REAL_FILE));

  it("detects the grid format", () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.format).toBe("grid");
  });

  it("finds exactly the 56 entry rows among 1,265 physical rows", () => {
    expect(parsed!.rows).toHaveLength(56);
  });

  it("reads status from fill colors: 27 yellow winners, 29 red out", () => {
    const yellow = parsed!.rows.filter((r) => r.fill === "yellow");
    const red = parsed!.rows.filter((r) => r.fill === "red");
    expect(yellow).toHaveLength(27);
    expect(red).toHaveLength(29);
  });

  it("parses her mixed-case week headers as weeks 1..18", () => {
    expect(parsed!.weeks).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("finds my three surviving entries by her numbers", () => {
    const byNo = new Map(parsed!.rows.map((r) => [r.no, r]));
    expect(byNo.get(980)?.name).toBe("Anthony DellaPia 5");
    expect(byNo.get(1006)?.name).toBe("Alexc 1");
    expect(byNo.get(1037)?.name).toBe("Nolan Lawrence 1");
    expect(byNo.get(980)?.fill).toBe("red");
  });

  it("reads BYE and OUT as literal cell values", () => {
    const all = parsed!.rows.flatMap((r) => Object.values(r.cells));
    expect(all).toContain("BYE");
    expect(all).toContain("OUT");
  });

  it("captures her stats block — the weekly bucket counts", () => {
    // Week 1 of 2025: 1206 clean, 42 loss/bye, 0 out (verified in archive).
    expect(parsed!.herCounts[1]).toEqual({ noLosses: 1206, lossBye: 42, out: 0 });
    expect(parsed!.herCounts[18]?.out ?? null).toBeNull(); // her dash, not a number
  });

  it("computes the latest filled week", () => {
    expect(parsed!.latestFilledWeek).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// Synthetic fixtures for matching and the plan.
// ---------------------------------------------------------------------------

function makeGrid(
  rows: {
    no: number | string;
    name: string;
    fill?: string;
    cells?: Record<number, string>;
  }[],
  opts: { weekHeaders?: string[] } = {},
): Buffer {
  const headers = ["NO.", "NAMES", ...(opts.weekHeaders ?? ["Week 1", "WEEK 2", "week 3"])];
  const aoa: unknown[][] = [headers];
  for (const r of rows) {
    const line: unknown[] = [r.no, r.name];
    for (let w = 1; w <= headers.length - 2; w++) line.push(r.cells?.[w] ?? "");
    aoa.push(line);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let i = 0; i < rows.length; i++) {
    const fill = rows[i].fill;
    if (!fill) continue;
    const addr = XLSX.utils.encode_cell({ r: i + 1, c: 1 });
    ws[addr].s = { fill: { patternType: "solid", fgColor: { rgb: fill } } };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

const target = (
  id: string,
  entryName: string,
  lynneNumber: number | null,
  status = "active",
  lynneLabel: string | null = null,
): GridTarget => ({ id, entryName, lynneLabel, lynneNumber, status });

describe("grid fill round-trip through xlsx-js-style write", () => {
  it("reads back red and yellow fills it wrote", () => {
    const buf = makeGrid([
      { no: 1, name: "Dead Guy", fill: "FF0000" },
      { no: 2, name: "Winner", fill: "FFFF00" },
      { no: 3, name: "Alive" },
    ]);
    const parsed = parseLynneGrid(buf)!;
    expect(parsed.rows.map((r) => r.fill)).toEqual(["red", "yellow", "none"]);
  });
});

describe("matchGridRows", () => {
  it("matches by her number when the name agrees, ignores the rest of her pool", () => {
    const parsed = parseLynneGrid(
      makeGrid([
        { no: 977, name: "Anthony DellaPia 2" },
        { no: 12, name: "Somebody Else 1" },
        { no: 13, name: "Another Stranger" },
      ]),
    )!;
    const res = matchGridRows(parsed.rows, [
      target("a", "Anthony DellaPia 2", 977),
    ]);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].matchedBy).toBe("lynne_number");
    expect(res.otherPoolCount).toBe(2);
    expect(res.conflicts).toHaveLength(0);
  });

  it("case-insensitive name agreement on a number match, verbatim names kept", () => {
    const parsed = parseLynneGrid(
      makeGrid([{ no: 984, name: "TOMMYBRADS2" }]),
    )!;
    const res = matchGridRows(parsed.rows, [target("t", "tommybrads2", 984)]);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].row.name).toBe("TOMMYBRADS2"); // hers, verbatim
  });

  it("flags number/name disagreement as a conflict, never a guess", () => {
    const parsed = parseLynneGrid(
      makeGrid([{ no: 977, name: "Totally Different Person" }]),
    )!;
    const res = matchGridRows(parsed.rows, [
      target("a", "Anthony DellaPia 2", 977),
    ]);
    expect(res.matched).toHaveLength(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].reason).toBe("number_name_disagree");
  });

  it("falls back to exact then case-insensitive name when we have no number", () => {
    const parsed = parseLynneGrid(
      makeGrid([
        { no: 500, name: "thedrick's picks" },
        { no: 501, name: "CHEEKY 2K" },
      ]),
    )!;
    const res = matchGridRows(parsed.rows, [
      target("d", "thedrick's picks", null),
      target("c", "Cheeky 2k", null),
    ]);
    expect(res.matched).toHaveLength(2);
    const byId = new Map(res.matched.map((m) => [m.entryId, m]));
    expect(byId.get("d")!.matchedBy).toBe("entry_name");
    expect(byId.get("c")!.matchedBy).toBe("entry_name_ci");
    // Sheet numbers we don't have on file are suggested, never applied.
    expect(byId.get("d")!.numberOnSheetNotOnFile).toBe(500);
  });

  it("a missing entry is not an error — it lands in missing, not conflicts", () => {
    const parsed = parseLynneGrid(makeGrid([{ no: 1, name: "Someone" }]))!;
    const res = matchGridRows(parsed.rows, [
      target("gone", "Deleted By Lynne", 999, "eliminated"),
    ]);
    expect(res.conflicts).toHaveLength(0);
    expect(res.missing.map((t) => t.id)).toEqual(["gone"]);
  });
});

describe("computeGridPlan", () => {
  it("her BYE compares as SKIP_WEEK; agreement counts, no variance", () => {
    const parsed = parseLynneGrid(
      makeGrid([{ no: 1, name: "E1", cells: { 2: "BYE" } }]),
    )!;
    const targets = [target("e1", "E1", 1)];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(
      matched,
      missing,
      2,
      [{ entryId: "e1", team: "SKIP_WEEK", result: null }],
      targets,
    );
    expect(plan.variances).toEqual([]);
    expect(plan.teamAgreements).toBe(1);
  });

  it("team read through her vocabulary; mismatch is a variance, never applied", () => {
    const parsed = parseLynneGrid(
      makeGrid([{ no: 1, name: "E1", cells: { 1: "San Francisco" } }]),
    )!;
    const targets = [target("e1", "E1", 1)];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(
      matched,
      missing,
      1,
      [{ entryId: "e1", team: "KC", result: null }],
      targets,
    );
    expect(plan.variances).toHaveLength(1);
    expect(plan.variances[0].type).toBe("team_mismatch");
    expect(plan.variances[0].lynne.team).toBe("SF");
  });

  it("OUT cell + eliminated locally = agreement; OUT vs alive = status conflict", () => {
    const parsed = parseLynneGrid(
      makeGrid([
        { no: 1, name: "Dead", cells: { 1: "OUT" } },
        { no: 2, name: "Disputed", cells: { 1: "OUT" } },
      ]),
    )!;
    const targets = [
      target("d", "Dead", 1, "eliminated"),
      target("x", "Disputed", 2, "active"),
    ];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(matched, missing, 1, [], targets);
    expect(plan.statusAgreements).toBe(1);
    const conflict = plan.variances.find((v) => v.entryName === "Disputed");
    expect(conflict?.type).toBe("status_conflict");
  });

  it("red fill means OUT even without an OUT cell", () => {
    const parsed = parseLynneGrid(
      makeGrid([{ no: 1, name: "Reddy", fill: "FF0000" }]),
    )!;
    const targets = [target("r", "Reddy", 1, "active")];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(matched, missing, 1, [], targets);
    expect(plan.variances[0]?.type).toBe("status_conflict");
  });

  it("she deleted an entry we still have alive → absent_but_alive variance", () => {
    const parsed = parseLynneGrid(makeGrid([{ no: 9, name: "Stranger" }]))!;
    const targets = [
      target("gone-dead", "Confirmed Gone", 998, "eliminated"),
      target("gone-alive", "Should Be There", 999, "active"),
    ];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(matched, missing, 1, [], targets);
    expect(plan.confirmedRemovals).toBe(1);
    const v = plan.variances.find((x) => x.entryName === "Should Be There");
    expect(v?.type).toBe("absent_but_alive");
  });

  it("she has a pick we don't → no_local_pick; unreadable text → unreadable_team", () => {
    const parsed = parseLynneGrid(
      makeGrid([
        { no: 1, name: "E1", cells: { 1: "LV Raiders" } },
        { no: 2, name: "E2", cells: { 1: "Mystery Squad" } },
      ]),
    )!;
    const targets = [target("e1", "E1", 1), target("e2", "E2", 2)];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(matched, missing, 1, [], targets);
    const types = plan.variances.map((v) => [v.entryName, v.type]);
    expect(types).toContainEqual(["E1", "no_local_pick"]);
    expect(types).toContainEqual(["E2", "unreadable_team"]);
  });

  it("empty week cell while we hold a pick → missing_on_sheet", () => {
    const parsed = parseLynneGrid(makeGrid([{ no: 1, name: "E1" }]))!;
    const targets = [target("e1", "E1", 1)];
    const { matched, missing } = matchGridRows(parsed.rows, targets);
    const plan = computeGridPlan(
      matched,
      missing,
      1,
      [{ entryId: "e1", team: "PHI", result: null }],
      targets,
    );
    expect(plan.variances[0]?.type).toBe("missing_on_sheet");
  });
});

describe("normalizeGridTeam", () => {
  it("reads her vocabulary first, generic names second, never guesses", () => {
    expect(normalizeGridTeam("San Francisco")).toBe("SF");
    expect(normalizeGridTeam("LV Raiders")).toBe("LV");
    expect(normalizeGridTeam("bye")).toBe("SKIP_WEEK");
    expect(normalizeGridTeam("Jaguars")).toBe("JAX");
    expect(normalizeGridTeam("Mystery Squad")).toBeNull();
  });
});
