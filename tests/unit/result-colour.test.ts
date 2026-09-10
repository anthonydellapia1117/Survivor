import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cellPaints,
  ROW_CLASS,
  ROW_NAME_CLASS,
  rowTone,
  toneOfResult,
  toneOfTeamResult,
  TONE_CELL_CLASS,
  TONE_FILL_CLASS,
} from "../../src/lib/result-colour";
import { teamResults } from "../../src/lib/master-list";
import type { EntrySummary } from "../../src/lib/data/types";

// Anthony's scheme, set 2026-09-10: won green, lost yellow, two losses the
// whole row red and struck through, no result no fill. Red therefore means
// OUT and yellow means damaged-but-alive, which is a shift from the older
// scheme where a single loss was already red.

const ROOT = path.join(__dirname, "../..");
const read = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");

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
    for (const file of [
      "src/components/grid/grid-view.tsx",
      "src/components/master-list/master-list-table.tsx",
      "src/components/teams/teams-client.tsx",
    ]) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      expect(src, `${file} must read its tones from result-colour`).toContain('from "@/lib/result-colour"');
      // bg-win/20 written by hand is how the grid and the master list drifted
      // apart before. The only fills allowed are the ones this module owns.
      expect(
        (src.match(/\bbg-(?:win|tie)\b(?:\/\d+)?/g) ?? []),
        `${file} writes a result fill inline instead of taking it from the module`,
      ).toEqual([]);
    }
  });

  it("never puts red on the Teams page - a team losing is a fact about a game, not an elimination", () => {
    const src = read("src/components/teams/teams-client.tsx");
    expect(src).not.toMatch(/\b(?:bg|text|border|ring)-loss\b/);
    expect(src).not.toContain("ROW_CLASS");
  });
});
