import { describe, expect, it } from "vitest";
import type { Variance } from "@/lib/lynne/compare";
import type { MarkResultsPlan } from "@/lib/lynne/mark-results";
import {
  conflictLine,
  derivedConflictLines,
  derivedSummaryLine,
  herCountsLine,
  lossesByTeamText,
  matchedByText,
  numberSuggestionLine,
  planSummaryLines,
  side,
  varianceLines,
  varianceTable,
} from "../../scripts/results/lib/format";
import type { GridResultsPlan, LegacyResultsPlan } from "../../scripts/results/lib/plan";

const DASHES = /[–—]/;

// One of every variance type both paths can produce, each with a different
// entry so a dropped line is a dropped name.
const VARIANCES: Variance[] = [
  { type: "team_mismatch", entryId: "e1", entryName: "Nolan Lawrence 1", lynne: { team: "GB", result: null }, local: { team: "KC", result: null } },
  { type: "no_local_pick", entryId: "e2", entryName: "Pumpy321", lynne: { team: "PHI", result: null }, local: { team: null, result: null } },
  { type: "result_conflict", entryId: "e3", entryName: "Nicco E", lynne: { team: "DAL", result: "loss" }, local: { team: "DAL", result: "win" } },
  { type: "status_conflict", entryId: "e4", entryName: "Alexc 1", lynne: { team: "OUT", result: "out" }, local: { team: "BUF", result: "alive" } },
  { type: "missing_on_sheet", entryId: "e5", entryName: "TNat", lynne: { team: null, result: null }, local: { team: "SEA", result: "pending" } },
  { type: "unreadable_team", entryId: "e6", entryName: "E.A.T.", lynne: { team: "Philly??", result: null }, local: { team: "PHI", result: null } },
  { type: "absent_but_alive", entryId: "e7", entryName: "Still Here", lynne: { team: null, result: "not in her sheet" }, local: { team: "NE", result: "active" } },
  { type: "mark_conflict", entryId: "e8", entryName: "Rydo 2", lynne: { team: null, result: "no losses" }, local: { team: "W1 TEN", result: "loss" } },
  { type: "derived_conflict", entryId: "e9", entryName: "Waggs 3", lynne: { team: "Baltimore", result: "OUT" }, local: { team: "BAL", result: "0 losses and no bye before week 2; win reads no losses, loss reads 1 loss/bye" } },
];

describe("side", () => {
  it("shows a null as a hyphen and never fills it in", () => {
    expect(side("PHI", "win")).toBe("PHI / win");
    expect(side("SKIP_WEEK", null)).toBe("SKIP_WEEK / -");
    expect(side(null, null)).toBe("- / -");
  });
});

describe("varianceLines", () => {
  it("prints exactly one line per variance, in order, and never drops one", () => {
    const lines = varianceLines(VARIANCES);
    expect(lines).toHaveLength(VARIANCES.length);
    VARIANCES.forEach((v, i) => {
      expect(lines[i]).toContain(v.entryName);
      expect(lines[i]).toContain(v.type);
    });
  });

  it("carries both sides of every variance", () => {
    const lines = varianceLines(VARIANCES);
    VARIANCES.forEach((v, i) => {
      expect(lines[i]).toContain(side(v.lynne.team, v.lynne.result));
      expect(lines[i]).toContain(side(v.local.team, v.local.result));
    });
    // The mismatch line names both teams: hers and ours, neither chosen.
    expect(lines[0]).toContain("GB / -");
    expect(lines[0]).toContain("KC / -");
    // The result conflict carries both results.
    expect(lines[2]).toContain("DAL / loss");
    expect(lines[2]).toContain("DAL / win");
  });

  it("keeps the four columns in order: entry | type | Lynne | local", () => {
    const cols = varianceLines([VARIANCES[0]])[0].split("|").map((c) => c.trim());
    expect(cols).toEqual(["Nolan Lawrence 1", "team_mismatch", "GB / -", "KC / -"]);
  });
});

describe("varianceTable", () => {
  it("says none when there are none", () => {
    expect(varianceTable([])).toEqual(["Variances: none."]);
  });

  it("is a title, a header, a rule, then every variance", () => {
    const t = varianceTable(VARIANCES);
    expect(t).toHaveLength(3 + VARIANCES.length);
    expect(t[0]).toContain(`Variances (${VARIANCES.length})`);
    expect(t[0]).toContain("never resolved");
    expect(t[1]).toContain("Lynne team / result");
    expect(t[1]).toContain("local team / result");
    expect(t.slice(3)).toEqual(varianceLines(VARIANCES));
  });
});

describe("conflictLine", () => {
  it("carries her number, her name, the reason and our entry name", () => {
    const line = conflictLine({ no: 777, name: "Not Our Name", reason: "number_name_disagree", entryName: "Pumpy321" });
    expect(line).toContain("777");
    expect(line).toContain('"Not Our Name"');
    expect(line).toContain("number name disagree");
    expect(line).toContain("Pumpy321");
  });

  it("shows a missing entry name as none rather than inventing one", () => {
    const line = conflictLine({ no: 5, name: "Dup", reason: "duplicate_number_in_sheet", entryName: null });
    expect(line).toContain("(none)");
  });
});

describe("numberSuggestionLine", () => {
  it("is a NEEDS ANTHONY line with her number, our entry, the screen and that nothing was applied", () => {
    const line = numberSuggestionLine({ entryName: "Nolan Lawrence 1", sheetNo: 1037 });
    expect(line.startsWith("NEEDS ANTHONY")).toBe(true);
    expect(line).toContain("1037");
    expect(line).toContain("Nolan Lawrence 1");
    expect(line).toContain("/admin/entries");
    expect(line).toContain("nothing applied here");
  });
});

describe("herCountsLine", () => {
  it("prints her three buckets and a hyphen for a bucket she left blank", () => {
    expect(herCountsLine(1, { noLosses: 1206, lossBye: 42, out: 0 })).toBe(
      "Her counts for week 1: no losses 1206, 1 loss/bye 42, out 0",
    );
    expect(herCountsLine(18, { noLosses: 27, lossBye: null, out: null })).toContain("1 loss/bye -, out -");
    expect(herCountsLine(3, null)).toBe("Her counts for week 3: not in this file");
  });
});

describe("matchedByText", () => {
  it("lists each way in first-seen order", () => {
    expect(matchedByText({ lynne_number: 38, entry_name: 2 })).toBe("lynne_number 38, entry_name 2");
    expect(matchedByText({})).toBe("none");
  });
});

const DERIVED: MarkResultsPlan = {
  applies: [{ entry_id: "e1", result: "win" }],
  byResult: { win: 75, loss: 46, bye: 0, missed: 0 },
  lossesByTeam: { DAL: 3, LAC: 39, TEN: 2, GB: 1, TB: 1 },
  alreadyApplied: 0,
  conflicts: [VARIANCES[2]],
  unknown: 0,
  undecidable: 0,
  priorUnscored: 0,
  noCurrentPick: 0,
  cellDiffers: 0,
};

const GRID_PLAN: GridResultsPlan = {
  format: "grid",
  marks: [],
  derived: null,
  sha256: "abc",
  rows: [],
  rowCount: 1204,
  matchedCount: 3,
  matchedBy: { lynne_number: 2, entry_name: 1 },
  unmatched: [],
  variances: VARIANCES,
  applies: [],
  conflicts: [{ no: 777, name: "Not Our Name", reason: "number_name_disagree", entryName: "Pumpy321" }],
  numberSuggestions: [{ entryName: "Nolan Lawrence 1", sheetNo: 1037 }],
  missingCount: 2,
  confirmedRemovals: 1,
  absentButAlive: 1,
  otherPoolCount: 1200,
  teamAgreements: 1,
  statusAgreements: 0,
  quietRows: 0,
  weeksInFile: [1, 2, 3],
  latestFilledWeek: 2,
  herCounts: null,
  noFillInfo: true,
};

const LEGACY_PLAN: LegacyResultsPlan = {
  format: "legacy",
  sha256: "def",
  rows: [],
  rowCount: 5,
  matchedCount: 4,
  matchedBy: { entry_name: 4 },
  unmatched: [],
  variances: VARIANCES.slice(0, 1),
  applies: [{ entry_id: "e4", result: "win" }],
  alreadyApplied: 1,
  noResultYet: 1,
};

describe("planSummaryLines", () => {
  it("names the path and says whether results are applied on it", () => {
    const grid = planSummaryLines(GRID_PLAN);
    expect(grid[0]).toContain("grid");
    expect(grid[0]).toContain("DERIVED from her fill marks");
    expect(grid.join("\n")).toContain("1 confirmed removals, 1 absent but alive");
    expect(grid.join("\n")).toContain("other pool 1200");
    expect(grid.join("\n")).toContain("no fill colours");
    const legacy = planSummaryLines(LEGACY_PLAN);
    expect(legacy[0]).toContain("legacy");
    expect(legacy[0]).toContain("IS applied");
    expect(legacy.join("\n")).toContain("Already applied 1; no result yet 1");
    expect(legacy.join("\n")).toContain("applies 1");
  });
});

describe("derivedSummaryLine", () => {
  it("carries every count: by result, the losing teams most first, and every row set aside by reason", () => {
    expect(derivedSummaryLine(1, DERIVED)).toBe(
      "Her marks give Week 1 results: 75 won, 46 lost (LAC 39, DAL 3, TEN 2, GB 1, TB 1), 0 byes, 0 missed; 0 already on file; 1 conflicts; 0 unknown fill; 0 undecidable",
    );
    const setAside = derivedSummaryLine(2, { ...DERIVED, priorUnscored: 2, noCurrentPick: 1, cellDiffers: 3 });
    expect(setAside).toContain("2 with a prior week still pending");
    expect(setAside).toContain("1 with no current pick");
    expect(setAside).toContain("3 where her cell is not our pick");
  });

  it("says that nothing is derived from a sheet with no fill information, and why", () => {
    const line = derivedSummaryLine(1, null);
    expect(line).toContain("no Week 1 results");
    expect(line).toContain("no fill information");
    expect(line).toContain("Nothing derived, nothing applied");
  });

  it("orders the losing teams most first and says none when there are none", () => {
    expect(lossesByTeamText({ DAL: 3, LAC: 39, GB: 1, TB: 1 })).toBe("LAC 39, DAL 3, GB 1, TB 1");
    expect(lossesByTeamText({})).toBe("none");
  });
});

describe("derivedConflictLines", () => {
  it("is nothing when there is no conflict, else a title and one line per conflict with both values", () => {
    expect(derivedConflictLines(null, "import")).toEqual([]);
    expect(derivedConflictLines({ ...DERIVED, conflicts: [] }, "import")).toEqual([]);
    const lines = derivedConflictLines(DERIVED, "import");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("NOT applied");
    expect(lines[1]).toContain("Nicco E");
    expect(lines[1]).toContain("DAL / loss");
    expect(lines[1]).toContain("DAL / win");
  });

  it("says where the values are kept, and that differs by path: the import row, or the backfill's summary row when one is written", () => {
    // The ordinary run stores them in lynne_imports.variances; the backfill
    // writes no import row and its summary audit row exists only when a
    // result was written. One header for both claimed a record the backfill
    // does not make (verifier, 2026-09-15).
    const onImport = derivedConflictLines(DERIVED, "import")[0];
    const onBackfill = derivedConflictLines(DERIVED, "backfill")[0];
    expect(onImport).toContain("recorded with the import");
    expect(onBackfill).not.toContain("recorded with the import");
    expect(onBackfill).toContain("summary audit row when this run writes one");
    expect(onBackfill).toContain("otherwise only printed here");
    expect(derivedConflictLines(DERIVED, "backfill").slice(1)).toEqual(derivedConflictLines(DERIVED, "import").slice(1));
  });
});

describe("every printed line", () => {
  it("has no em dash and no en dash", () => {
    const all = [
      ...varianceTable(VARIANCES),
      ...varianceTable([]),
      conflictLine({ no: 777, name: "Not Our Name", reason: "number_name_disagree", entryName: "Pumpy321" }),
      numberSuggestionLine({ entryName: "Nolan Lawrence 1", sheetNo: 1037 }),
      herCountsLine(1, { noLosses: 1206, lossBye: 42, out: 0 }),
      herCountsLine(3, null),
      ...planSummaryLines(GRID_PLAN),
      ...planSummaryLines(LEGACY_PLAN),
      derivedSummaryLine(1, DERIVED),
      derivedSummaryLine(1, null),
      ...derivedConflictLines(DERIVED, "import"),
      ...derivedConflictLines(DERIVED, "backfill"),
    ];
    expect(all.length).toBeGreaterThan(15);
    for (const line of all) expect(line).not.toMatch(DASHES);
  });
});
