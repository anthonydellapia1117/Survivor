import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cellPaints,
  OUT_TEXT_CLASS,
  ROW_CLASS,
  ROW_NAME_CLASS,
  rowTone,
  toneOfResult,
  toneOfTeamResult,
  TONE_BAR_CLASS,
  TONE_CELL_CLASS,
  TONE_FILL_CLASS,
  TONE_SWATCH_CLASS,
  OUT_SWATCH_CLASS,
} from "../../src/lib/result-colour";
import { teamResults } from "../../src/lib/master-list";
import type { EntrySummary } from "../../src/lib/data/types";

// Anthony's scheme, set 2026-09-10: won green, lost yellow, two losses the
// whole row red and struck through, no result no fill. Red therefore means
// OUT and yellow means damaged-but-alive, which is a shift from the older
// scheme where a single loss was already red.

const ROOT = path.join(__dirname, "../..");
const read = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");

/**
 * The dashboard's result surfaces (2026-09-15): the scoped section, its KPI
 * strip, its survival strip, its pick distribution and its carnage list.
 * Each colours a result - a chalk team, a bucket swatch, a bar, a finished
 * count - and each takes every class from the module.
 */
const DASHBOARD_SURFACES = [
  "src/components/dashboard/scope-section.tsx",
  "src/components/dashboard/kpi-strip.tsx",
  "src/components/dashboard/survival-strip.tsx",
  "src/components/dashboard/pick-distribution.tsx",
  "src/components/dashboard/carnage-list.tsx",
];

/** Every file that colours a RESULT: the one table, the Teams table and the dashboard. */
const RESULT_SURFACES = ["src/components/grid/grid-view.tsx", "src/components/teams/teams-client.tsx", ...DASHBOARD_SURFACES];

/** Source with comments removed, so prose ABOUT a class is not a use of it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const game = (over: Partial<Parameters<typeof teamResults>[0][number]> = {}) => ({
  week: 1,
  homeTeam: "PHI",
  awayTeam: "DAL",
  homeScore: 24,
  awayScore: 17,
  status: "final" as const,
  ...over,
});

describe("no colour on a game with no stored result", () => {
  it("gives a pending pick and an unknown one no tone at all", () => {
    expect(toneOfResult("pending")).toBe("none");
    expect(toneOfResult(null)).toBe("none");
    expect(toneOfResult(undefined)).toBe("none");
    expect(toneOfTeamResult(undefined)).toBe("none");
  });

  it("paints nothing for that tone: no fill, no colour, only the neutral border", () => {
    expect(TONE_FILL_CLASS.none).toBe("");
    expect(TONE_CELL_CLASS.none).not.toMatch(/\b(?:bg|text|border)-(?:win|loss|tie)\b/);
  });

  it("leaves a game that is not final out of the results entirely, scores or no scores", () => {
    // A score on an in-progress game is a partial score, not a result. If it
    // reached the map, the cell would go green or yellow at half time.
    for (const status of ["scheduled", "in_progress"] as const) {
      const r = teamResults([game({ status })]);
      expect(r.size, `${status} must contribute no result`).toBe(0);
      expect(toneOfTeamResult(r.get("1:PHI"))).toBe("none");
    }
    const missing = teamResults([game({ homeScore: null })]);
    expect(missing.size).toBe(0);
  });
});

describe("a tie counts as a loss", () => {
  it("tones a tie exactly as a loss, on both the pick and the team", () => {
    expect(toneOfResult("tie_loss")).toBe("lost");
    expect(toneOfTeamResult("tie")).toBe("lost");
    expect(toneOfResult("loss")).toBe("lost");
    expect(toneOfTeamResult("loss")).toBe("lost");
    // A missed week is a loss in v_entry_public too, so it is one here.
    expect(toneOfResult("missed")).toBe("lost");
  });

  it("gives a tied game both teams the losing tone", () => {
    const r = teamResults([game({ homeScore: 20, awayScore: 20 })]);
    expect(toneOfTeamResult(r.get("1:PHI"))).toBe("lost");
    expect(toneOfTeamResult(r.get("1:DAL"))).toBe("lost");
  });

  it("colours the losing tone yellow and never red", () => {
    expect(TONE_CELL_CLASS.lost).toContain("bg-tie/20");
    expect(TONE_CELL_CLASS.lost).not.toMatch(/-loss\b/);
    expect(TONE_FILL_CLASS.lost).not.toMatch(/-loss\b/);
    expect(TONE_CELL_CLASS.won).toContain("bg-win/15");
  });
});

describe("a bar", () => {
  // The dashboard's pick distribution and carnage list (Anthony,
  // 2026-09-15): a bar is a solid chip, so won and lost take the swatch
  // values; a game not final keeps the accent the bars were always painted
  // in; and a losing team is yellow, never red, on any bar.
  it("takes the swatch colours for a final result, and never a loss token", () => {
    expect(TONE_BAR_CLASS.won).toBe(TONE_SWATCH_CLASS.won);
    expect(TONE_BAR_CLASS.lost).toBe(TONE_SWATCH_CLASS.lost);
    expect(TONE_BAR_CLASS.won).toMatch(/\bbg-win\b/);
    expect(TONE_BAR_CLASS.lost).toMatch(/\bbg-tie\b/);
    for (const tone of ["won", "lost", "bye", "none"] as const) {
      expect(TONE_BAR_CLASS[tone], `${tone} bar must never be red`).not.toMatch(/-loss\b/);
    }
  });

  it("paints a game with no result in no result token at all", () => {
    expect(TONE_BAR_CLASS.none).not.toMatch(/\b(?:bg|text|border)-(?:win|loss|tie|bye)\b/);
    expect(TONE_BAR_CLASS.none).not.toBe("");
  });
});

describe("the row", () => {
  const entry = (over: Partial<EntrySummary>): Pick<EntrySummary, "status" | "losses"> => ({
    status: "active",
    losses: 0,
    ...over,
  }) as Pick<EntrySummary, "status" | "losses">;

  it("turns red and struck through once the entry is out, which is what two losses does", () => {
    expect(rowTone(entry({ status: "eliminated", losses: 2 }))).toBe("out");
    expect(ROW_CLASS.out).toContain("line-through");
    expect(ROW_CLASS.out).toContain("bg-loss/10");
    expect(ROW_NAME_CLASS.out).toContain("line-through");
  });

  it("puts yellow on the entry name at the first loss, and nothing on a clean row", () => {
    expect(rowTone(entry({ status: "at_risk", losses: 1 }))).toBe("lost");
    expect(ROW_NAME_CLASS.lost).toBe("text-tie");
    expect(rowTone(entry({}))).toBe("clean");
    expect(ROW_CLASS.clean).toBe("");
    expect(ROW_NAME_CLASS.clean).toBe("");
  });

  it("stops its cells painting their own tone once it is out, so the row reads as one thing", () => {
    expect(cellPaints("out")).toBe(false);
    expect(cellPaints("lost")).toBe(true);
    expect(cellPaints("clean")).toBe(true);
  });
});

describe("the surfaces", () => {
  it("colour a result only through this module, never by writing the class inline", () => {
    // Two surfaces since 2026-09-11, not three: the Grid and the Master List
    // became one table, so the third file is the one that used to hold half
    // of it.
    // Seven since 2026-09-15: the five dashboard surfaces joined. The first
    // review of that change found the section's chalk text and Out swatch
    // outside every scan - a fallen chalk painted green shipped green.
    for (const file of RESULT_SURFACES) {
      const src = code(read(file));
      expect(src, `${file} must read its tones from result-colour`).toContain('from "@/lib/result-colour"');
      // bg-win/20 written by hand is how the grid and the master list drifted
      // apart before. The only fills allowed are the ones this module owns.
      expect(
        (src.match(/\bbg-(?:win|tie)\b(?:\/\d+)?/g) ?? []),
        `${file} writes a result fill inline instead of taking it from the module`,
      ).toEqual([]);
    }
  });

  it("writes no result or OUT token inline on any dashboard surface - text, fill or border", () => {
    // Stricter than the grid, which still carries a few of its own (the
    // killing cell, the late flag): these five were built after the module
    // existed and have no reason to spell a token. The OUT vocabulary is
    // OUT_TEXT_CLASS or OUT_SWATCH_CLASS, never text-loss typed where a scan
    // cannot see it.
    for (const file of DASHBOARD_SURFACES) {
      const src = code(read(file));
      expect(
        (src.match(/\b(?:bg|text|border|ring)-(?:win|tie|loss|bye)\b(?:\/\d+)?/g) ?? []),
        `${file} writes a result or OUT class inline instead of taking it from the module`,
      ).toEqual([]);
    }
  });

  it("names the OUT vocabulary as text once, in the module", () => {
    expect(OUT_TEXT_CLASS).toBe("text-loss");
    expect(OUT_SWATCH_CLASS).toMatch(/\bbg-loss\b/);
  });

  it("never puts red on the Teams page or a distribution bar - a team losing is a fact about a game, not an elimination", () => {
    for (const file of ["src/components/teams/teams-client.tsx", "src/components/dashboard/pick-distribution.tsx", "src/components/dashboard/bar-row.tsx"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/\b(?:bg|text|border|ring)-loss\b/);
      expect(src, file).not.toContain("ROW_CLASS");
    }
  });
});
