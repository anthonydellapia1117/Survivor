import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSXStyle from "xlsx-js-style";
import { classifyFill, parseLynneGrid } from "../../src/lib/lynne/parse-grid";
import { matchGridRows } from "../../src/lib/lynne/plan-grid";
import {
  compareMarksToScores,
  derivedStandingOf,
  herMarkOf,
  markComparisonLines,
  type MarkPick,
  type MarkRow,
} from "../../src/lib/lynne/mark-variance";
import type { GameRow } from "../../src/lib/data/types";

// Her Week 1 Final Sheet (2026-09-15) carried a standing per row in the
// NAMES fill and no per-week result. This is the reader of that fill and the
// comparison against our scores, set by Anthony that morning: both values,
// never resolved.

/** A NO./NAMES grid with a fill per row: an rgb string, a theme index, or none. */
function makeGrid(rows: { no: number; name: string; rgb?: string; theme?: number; w1?: string }[]): Buffer {
  const aoa: (string | number)[][] = [["NO.", "NAMES", "Week 1", "Week 2"]];
  for (const r of rows) aoa.push([r.no, r.name, r.w1 ?? "", ""]);
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  rows.forEach((r, i) => {
    const addr = XLSXStyle.utils.encode_cell({ r: i + 1, c: 1 });
    if (r.rgb) ws[addr].s = { fill: { patternType: "solid", fgColor: { rgb: r.rgb } } };
    else if (r.theme !== undefined) ws[addr].s = { fill: { patternType: "solid", fgColor: { theme: r.theme } } };
  });
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

describe("her fill as a standing", () => {
  it("reads red or the word OUT as out, yellow as her 1 loss/bye bucket, no fill as clean", () => {
    expect(herMarkOf("red", "LA Chargers")).toBe("out");
    expect(herMarkOf("none", "OUT")).toBe("out");
    expect(herMarkOf("none", " out ")).toBe("out");
    expect(herMarkOf("yellow", "LA Chargers")).toBe("loss");
    expect(herMarkOf("none", "Jacksonville")).toBe("clean");
    expect(herMarkOf("none", null)).toBe("clean");
    expect(herMarkOf("other", "Jacksonville")).toBe("unknown");
  });

  it("on the season-end sheet yellow is the winner, not a loss, and is set aside", () => {
    expect(herMarkOf("yellow", "Detroit", true)).toBe("unknown");
    expect(herMarkOf("red", "Detroit", true)).toBe("out");
    expect(herMarkOf("none", "Detroit", true)).toBe("clean");
  });

  it("reads the white theme fill she paints clean rows with as no mark, and any other theme as unknown", () => {
    // The theme branch, on the style object itself: xlsx-js-style does not
    // round-trip a theme fill, so a written fixture cannot reach it.
    expect(classifyFill({ patternType: "solid", fgColor: { theme: 0 } })).toEqual({ fill: "none", raw: "theme:0" });
    expect(classifyFill({ patternType: "solid", fgColor: { theme: 4 } })).toEqual({ fill: "other", raw: "theme:4" });
    expect(classifyFill({ patternType: "solid", fgColor: { rgb: "FFFFFF00" } })).toEqual({ fill: "yellow", raw: "FFFFFF00" });
    expect(classifyFill({ patternType: "solid", fgColor: { rgb: "FFFF0000" } })).toEqual({ fill: "red", raw: "FFFF0000" });
    expect(classifyFill(undefined)).toEqual({ fill: "none", raw: null });
    // And through a written workbook, the rgb and bare cases.
    const parsed = parseLynneGrid(
      makeGrid([
        { no: 2, name: "Yellow", rgb: "FFFF00", w1: "LA Chargers" },
        { no: 4, name: "Bare", w1: "Detroit" },
      ]),
    )!;
    expect(parsed.rows.map((r) => [r.no, r.fill, r.fillRaw])).toEqual([
      [2, "yellow", "FFFF00"],
      [4, "none", null],
    ]);
  });
});

describe("a number match survives her edge whitespace", () => {
  const target = (id: string, entryName: string, lynneLabel: string | null, lynneNumber: number | null) => ({
    id, entryName, lynneLabel, lynneNumber, status: "active",
  });

  it("agrees when the label we hold carries a trailing space the parser trimmed off her cell", () => {
    // 2026-09-15: her NO. 986 "Waggs 3 " on file, "Waggs 3" parsed, and the
    // first real grid import filed Waggs #3 as absent from her sheet.
    const parsed = parseLynneGrid(makeGrid([{ no: 986, name: "Waggs 3", w1: "LA Chargers" }]))!;
    const res = matchGridRows(parsed.rows, [target("w3", "Waggs #3", "Waggs 3 ", 986)]);
    expect(res.conflicts).toEqual([]);
    expect(res.matched.map((m) => [m.entryId, m.matchedBy])).toEqual([["w3", "lynne_number"]]);
    // And her row keeps its own wording.
    expect(res.matched[0].row.name).toBe("Waggs 3");
  });

  it("matches on the no-number path with edge whitespace set aside, and keeps a collision ambiguous", () => {
    // No lynne_number on file: the label path has to read "Waggs 3 " against
    // her parsed "Waggs 3" too (Codex, #101).
    const parsed = parseLynneGrid(makeGrid([{ no: 4001, name: "Waggs 3", w1: "LA Chargers" }]))!;
    const res = matchGridRows(parsed.rows, [target("w3", "Waggs #3", "Waggs 3 ", null)]);
    expect(res.matched.map((m) => [m.entryId, m.matchedBy])).toEqual([["w3", "lynne_label"]]);
    expect(res.otherPoolCount).toBe(0);
    // Two labels that collapse to one key after the trim are still ambiguous.
    const dup = matchGridRows(parsed.rows, [
      target("a", "Waggs #3", "Waggs 3 ", null),
      target("b", "Waggs #5", " Waggs 3", null),
    ]);
    expect(dup.matched).toEqual([]);
    expect(dup.otherPoolCount).toBe(1);
  });

  it("still refuses a different name on the same number - whitespace is not a licence to fuzz", () => {
    const parsed = parseLynneGrid(makeGrid([{ no: 986, name: "Waggs  3", w1: "LA Chargers" }]))!;
    const res = matchGridRows(parsed.rows, [target("w3", "Waggs #3", "Waggs 3 ", 986)]);
    expect(res.matched).toEqual([]);
    expect(res.conflicts.map((c) => c.reason)).toEqual(["number_name_disagree"]);
  });
});

type G = Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">;
const GAMES: G[] = [
  { week: 1, homeTeam: "PHI", awayTeam: "DAL", homeScore: 24, awayScore: 17, status: "final" },
  { week: 1, homeTeam: "ARI", awayTeam: "LAC", homeScore: 27, awayScore: 14, status: "final" },
  { week: 1, homeTeam: "CHI", awayTeam: "GB", homeScore: 20, awayScore: 20, status: "final" },
  { week: 2, homeTeam: "BAL", awayTeam: "NO", homeScore: 31, awayScore: 10, status: "final" },
  { week: 2, homeTeam: "TEN", awayTeam: "PHI", homeScore: null, awayScore: null, status: "in_progress" },
];
const results = new Map<string, "win" | "loss" | "tie">([
  ["1:PHI", "win"], ["1:DAL", "loss"], ["1:ARI", "win"], ["1:LAC", "loss"], ["1:CHI", "tie"], ["1:GB", "tie"],
  ["2:BAL", "win"], ["2:NO", "loss"],
]);

describe("our standing from picks and finals", () => {
  it("a win is clean, a loss or a tie is her middle bucket, two losses is out", () => {
    expect(derivedStandingOf([{ week: 1, team: "PHI" }], results, 1)).toBe("clean");
    expect(derivedStandingOf([{ week: 1, team: "LAC" }], results, 1)).toBe("loss");
    expect(derivedStandingOf([{ week: 1, team: "GB" }], results, 1)).toBe("loss");
    expect(derivedStandingOf([{ week: 1, team: "LAC" }, { week: 2, team: "NO" }], results, 2)).toBe("out");
  });

  it("a burned bye lands in the middle bucket with no loss, and a missed week is a loss", () => {
    expect(derivedStandingOf([{ week: 1, team: "PHI" }, { week: 2, team: "SKIP_WEEK" }], results, 2)).toBe("loss");
    expect(derivedStandingOf([{ week: 1, team: "MISSED" }], results, 1)).toBe("loss");
  });

  it("a first loss or a missed week past the double-elimination boundary is out, and the boundary is a parameter", () => {
    // Week 8 is the first single-elimination week with the default boundary
    // of 7 (v_entry_standing, poolBucketOf); through Week 8 it is a first
    // loss. Codex caught this on #101.
    const late = new Map<string, "win" | "loss" | "tie">([["8:SEA", "loss"], ["7:SEA", "loss"]]);
    expect(derivedStandingOf([{ week: 8, team: "SEA" }], late, 8)).toBe("out");
    expect(derivedStandingOf([{ week: 8, team: "MISSED" }], late, 8)).toBe("out");
    expect(derivedStandingOf([{ week: 7, team: "SEA" }], late, 7)).toBe("loss");
    expect(derivedStandingOf([{ week: 8, team: "SEA" }], late, 8, 8)).toBe("loss");
  });

  it("reads only picks through the import week, and a game with no final is unscored", () => {
    // Week 2's loss is not counted when comparing through Week 1.
    expect(derivedStandingOf([{ week: 1, team: "PHI" }, { week: 2, team: "NO" }], results, 1)).toBe("clean");
    expect(derivedStandingOf([{ week: 1, team: "PHI" }, { week: 2, team: "TEN" }], results, 2)).toBe("unscored");
    expect(derivedStandingOf([], results, 1)).toBe("no pick");
  });
});

describe("her marks against the scores", () => {
  const row = (no: number, entryId: string, fill: MarkRow["fill"], text: string | null = "x"): MarkRow => ({
    entryId, no, entryName: entryId, fill, weekCellText: text,
  });
  const pick = (entryId: string, week: number, team: string): MarkPick => ({ entryId, week, team });

  it("counts agreement and names every row where her mark and our standing differ, in her numbering", () => {
    const c = compareMarksToScores(
      [row(980, "b", "yellow"), row(977, "a", "none"), row(1016, "c", "yellow"), row(990, "d", "none")],
      [pick("a", 1, "LAC"), pick("b", 1, "LAC"), pick("c", 1, "PHI"), pick("d", 1, "PHI")],
      GAMES,
      1,
    );
    expect(c.agree).toBe(2);
    expect(c.differ.map((d) => [d.no, d.hers, d.ours])).toEqual([
      [977, "clean", "loss"],
      [1016, "loss", "clean"],
    ]);
    expect(markComparisonLines(c, 1)).toEqual([
      "Her marks and the scores DIFFER on 2 of ours through Week 1; 2 agree. Neither side is corrected here:",
      "NO. 977 a (W1 LAC) - her sheet: no losses, scores: 1 loss/bye",
      "NO. 1016 c (W1 PHI) - her sheet: 1 loss/bye, scores: no losses",
    ]);
  });

  it("is one line when every row agrees", () => {
    const c = compareMarksToScores([row(977, "a", "yellow"), row(978, "b", "none")], [pick("a", 1, "LAC"), pick("b", 1, "PHI")], GAMES, 1);
    expect(markComparisonLines(c, 1)).toEqual(["Her marks and the scores agree on every one of our rows through Week 1: 2 rows."]);
  });

  it("sets aside an unknown fill and an unscored game rather than calling either a difference, and says so", () => {
    const c = compareMarksToScores(
      [row(977, "a", "other"), row(978, "b", "none")],
      [pick("a", 1, "LAC"), pick("b", 1, "PHI"), pick("b", 2, "TEN")],
      GAMES,
      2,
    );
    expect(c).toEqual({ agree: 0, differ: [], unknown: 1, unscored: 1 });
    // A partial comparison never claims "every one of our rows".
    expect(markComparisonLines(c, 2)).toEqual([
      "Her marks and the scores agree on every row compared through Week 2: 0 rows (1 with a game not yet final, 1 with a fill this reader does not know).",
    ]);
  });

  it("on a Week 18 import a yellow row is set aside as her winner colour rather than read as a loss", () => {
    const w18 = [{ week: 18, homeTeam: "DET", awayTeam: "CHI", homeScore: 30, awayScore: 10, status: "final" as const }];
    const c = compareMarksToScores([row(977, "a", "yellow")], [pick("a", 18, "DET")], w18, 18);
    expect(c).toEqual({ agree: 0, differ: [], unknown: 1, unscored: 0 });
    // Through Week 17 the same yellow is still her 1 loss/bye bucket.
    const w17 = [{ week: 17, homeTeam: "DET", awayTeam: "CHI", homeScore: 30, awayScore: 10, status: "final" as const }];
    expect(compareMarksToScores([row(977, "a", "yellow")], [pick("a", 17, "DET")], w17, 17).differ).toHaveLength(1);
  });

  it("is computed before the plan is printed, so the count the operator approves carries it", () => {
    // The results command pushes mark conflicts into plan.variances; that has
    // to happen before planSummaryLines and varianceTable print them.
    const src = readFileSync("scripts/results/cli.ts", "utf8");
    const compute = src.indexOf("markCheck = compareMarksToScores(");
    const summary = src.indexOf("planSummaryLines(plan)");
    const table = src.indexOf("varianceTable(plan.variances)");
    expect(compute).toBeGreaterThan(0);
    expect(compute).toBeLessThan(summary);
    expect(compute).toBeLessThan(table);
  });

  it("her OUT written as text beats a clean fill", () => {
    const c = compareMarksToScores([row(977, "a", "none", "OUT")], [pick("a", 1, "PHI")], GAMES, 1);
    expect(c.differ.map((d) => [d.hers, d.ours])).toEqual([["out", "clean"]]);
  });
});
