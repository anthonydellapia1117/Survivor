import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizeResult,
  normalizeTeam,
  parseLynneFile,
} from "@/lib/lynne/parse";
import { matchRows } from "@/lib/lynne/match";
import { computeImportPlan } from "@/lib/lynne/compare";

function xlsxBuffer(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Week");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

describe("parseLynneFile", () => {
  it("detects a header row and maps columns loosely, ignoring unknowns", () => {
    const buf = xlsxBuffer([
      ["2026 Survivor — Week 3", "", "", ""],
      ["Entry Name", "Notes", "Team", "Result"],
      ["ReRe #1", "paid", "Kansas City Chiefs", "W"],
      ["tommybrads2", "", "BUF", "L"],
      ["", "", "", ""],
    ]);
    const parsed = parseLynneFile(buf, "week3.xlsx");
    expect(parsed.headerRowIndex).toBe(1);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      entry: "ReRe #1",
      team: "KC",
      result: "win",
    });
    expect(parsed.rows[1]).toMatchObject({
      entry: "tommybrads2",
      team: "BUF",
      result: "loss",
    });
  });

  it("parses CSV with different header names", () => {
    const buf = csvBuffer("Player,Pick,W/L\nMass1,Eagles,w\nWaggs2,dal,t\n");
    const parsed = parseLynneFile(buf, "week.csv");
    expect(parsed.rows).toEqual([
      expect.objectContaining({ entry: "Mass1", team: "PHI", result: "win" }),
      expect.objectContaining({
        entry: "Waggs2",
        team: "DAL",
        result: "tie_loss",
      }),
    ]);
  });

  it("handles headerless files positionally", () => {
    const buf = csvBuffer("Pumpy321,SF\nBepeSant 1,Ravens\n");
    const parsed = parseLynneFile(buf, "raw.csv");
    expect(parsed.headerRowIndex).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ entry: "Pumpy321", team: "SF" });
    expect(parsed.rows[1]).toMatchObject({ entry: "BepeSant 1", team: "BAL" });
  });

  it("hashes identical content identically and different content differently", () => {
    const a = csvBuffer("Entry,Team\nX,KC\n");
    const b = csvBuffer("Entry,Team\nX,KC\n");
    const c = csvBuffer("Entry,Team\nX,BUF\n");
    expect(parseLynneFile(a, "a.csv").sha256).toBe(
      parseLynneFile(b, "b.csv").sha256,
    );
    expect(parseLynneFile(a, "a.csv").sha256).not.toBe(
      parseLynneFile(c, "c.csv").sha256,
    );
  });

  it("keeps unknown teams raw instead of guessing", () => {
    const buf = csvBuffer("Entry,Team\nMass1,XYZ\n");
    expect(parseLynneFile(buf, "x.csv").rows[0].team).toBe("XYZ");
  });
});

describe("normalizers", () => {
  it("team names, nicknames, and alternate abbreviations", () => {
    expect(normalizeTeam("Jacksonville Jaguars")).toBe("JAX");
    expect(normalizeTeam("jags")).toBe("JAX");
    expect(normalizeTeam("JAC")).toBe("JAX");
    expect(normalizeTeam("Niners")).toBe("SF");
    expect(normalizeTeam("gb")).toBe("GB");
    expect(normalizeTeam("bye")).toBe("SKIP_WEEK");
    expect(normalizeTeam("Not A Team")).toBeNull();
  });

  it("results: tie is a loss category of its own, unknowns are null", () => {
    expect(normalizeResult("W")).toBe("win");
    expect(normalizeResult("lost")).toBe("loss");
    expect(normalizeResult("TIE")).toBe("tie_loss");
    expect(normalizeResult("???")).toBeNull();
  });
});

describe("matchRows — never fuzzy", () => {
  const entries = [
    { id: "a", entryName: "ReRe #1", lynneLabel: null },
    { id: "b", entryName: "tommybrads2", lynneLabel: "T Brads 2" },
    { id: "c", entryName: "Mass1", lynneLabel: null },
    { id: "d", entryName: "mass1", lynneLabel: null }, // ci duplicate of c
  ];
  const row = (entry: string) => ({
    entry,
    team: "KC",
    result: null,
    rowIndex: 0,
  });

  it("prefers exact lynne_label", () => {
    const r = matchRows([row("T Brads 2")], entries);
    expect(r.matched[0]).toMatchObject({ entryId: "b", matchedBy: "lynne_label" });
  });

  it("then exact entry_name, then case-insensitive", () => {
    expect(matchRows([row("ReRe #1")], entries).matched[0]).toMatchObject({
      entryId: "a",
      matchedBy: "entry_name",
    });
    expect(matchRows([row("RERE #1")], entries).matched[0]).toMatchObject({
      entryId: "a",
      matchedBy: "entry_name_ci",
    });
  });

  it("exact match wins even when a case-insensitive set is ambiguous", () => {
    expect(matchRows([row("Mass1")], entries).matched[0]).toMatchObject({
      entryId: "c",
      matchedBy: "entry_name",
    });
  });

  it("ambiguous case-insensitive goes to unmatched, and near-misses never match", () => {
    expect(matchRows([row("MASS1")], entries).unmatched).toHaveLength(1);
    expect(matchRows([row("ReRe#1")], entries).unmatched).toHaveLength(1);
    expect(matchRows([row("ReRe #5")], entries).unmatched).toHaveLength(1);
  });
});

describe("computeImportPlan — variances reported, never applied", () => {
  const names = new Map([
    ["a", "ReRe #1"],
    ["b", "Mass1"],
    ["c", "Waggs1"],
    ["d", "Pumpy321"],
  ]);
  const m = (entryId: string, team: string | null, result: string | null) => ({
    row: { entry: names.get(entryId)!, team, result, rowIndex: 0 },
    entryId,
    matchedBy: "entry_name" as const,
  });

  it("applies her result when teams agree and local is pending", () => {
    const plan = computeImportPlan(
      [m("a", "KC", "win")],
      [{ entryId: "a", team: "KC", result: "pending" }],
      names,
    );
    expect(plan.applies).toEqual([{ entry_id: "a", result: "win" }]);
    expect(plan.variances).toHaveLength(0);
  });

  it("team mismatch is a variance — nothing applies", () => {
    const plan = computeImportPlan(
      [m("a", "BUF", "win")],
      [{ entryId: "a", team: "KC", result: "pending" }],
      names,
    );
    expect(plan.applies).toHaveLength(0);
    expect(plan.variances[0]).toMatchObject({
      type: "team_mismatch",
      lynne: { team: "BUF" },
      local: { team: "KC" },
    });
  });

  it("her row with no local pick is a variance (the D10 authority split)", () => {
    const plan = computeImportPlan([m("b", "PHI", "loss")], [], names);
    expect(plan.variances[0].type).toBe("no_local_pick");
  });

  it("conflicting final results are variances, agreeing ones are no-ops", () => {
    const plan = computeImportPlan(
      [m("c", "DAL", "loss"), m("d", "SF", "win")],
      [
        { entryId: "c", team: "DAL", result: "win" },
        { entryId: "d", team: "SF", result: "win" },
      ],
      names,
    );
    expect(plan.variances[0]).toMatchObject({ type: "result_conflict" });
    expect(plan.alreadyApplied).toBe(1);
    expect(plan.applies).toHaveLength(0);
  });

  it("rows without results count as noResultYet and apply nothing", () => {
    const plan = computeImportPlan(
      [m("a", "KC", null)],
      [{ entryId: "a", team: "KC", result: "pending" }],
      names,
    );
    expect(plan.noResultYet).toBe(1);
    expect(plan.applies).toHaveLength(0);
  });
});
