import { describe, expect, it } from "vitest";
import {
  compareStoredToScores,
  scoreComparisonLines,
  scoreVarianceLine,
  type NumberedEntry,
  type StoredPick,
} from "../../src/lib/score-variance";
import type { GameRow } from "../../src/lib/data/types";

// Her stored result against the score-derived one, set by Anthony on
// 2026-09-13. Tuesday is the first time the two can disagree - her results
// file writes what the scores only implied - and a silent flip from won to
// lost has to reach him as one line, never as a colour that changed overnight.

type G = Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">;
const GAMES: G[] = [
  { week: 1, homeTeam: "PHI", awayTeam: "DAL", homeScore: 24, awayScore: 17, status: "final" },
  { week: 1, homeTeam: "CHI", awayTeam: "GB", homeScore: 20, awayScore: 20, status: "final" },
  { week: 1, homeTeam: "LAC", awayTeam: "ARI", homeScore: 14, awayScore: 3, status: "in_progress" },
];

const ENTRIES: NumberedEntry[] = [
  { id: "a", entryName: "AAA #6", lynneNumber: 977 },
  { id: "b", entryName: "Jim Teti #4", lynneNumber: 1016 },
  { id: "c", entryName: "No Number", lynneNumber: null },
];

const pick = (entryId: string, team: string, result: string | null, week = 1): StoredPick => ({ entryId, week, team, result });

describe("her result against the scores", () => {
  it("names a row where her file and the scores disagree, with both values", () => {
    const c = compareStoredToScores(ENTRIES, [pick("a", "DAL", "win")], GAMES);
    expect(c.differ).toEqual([
      { lynneNumber: 977, entryName: "AAA #6", week: 1, team: "DAL", stored: "win", derived: "loss" },
    ]);
    expect(scoreVarianceLine(c.differ[0])).toBe("NO. 977 AAA #6 Week 1 DAL - her file: win, scores: loss");
  });

  it("counts an agreeing row and never lists it", () => {
    const c = compareStoredToScores(ENTRIES, [pick("a", "PHI", "win"), pick("b", "DAL", "loss"), pick("c", "GB", "tie_loss")], GAMES);
    expect(c).toEqual({ differ: [], agree: 3, unscored: 0, pending: 0 });
  });

  it("a tie her file calls a win is a difference - a tie is a loss here", () => {
    const c = compareStoredToScores(ENTRIES, [pick("a", "GB", "win")], GAMES);
    expect(c.differ.map((d) => [d.stored, d.derived])).toEqual([["win", "tie_loss"]]);
  });

  it("a pending pick is counted as pending, never as agreement", () => {
    const c = compareStoredToScores(ENTRIES, [pick("a", "PHI", "pending"), pick("b", "PHI", null)], GAMES);
    expect(c).toEqual({ differ: [], agree: 0, unscored: 0, pending: 2 });
  });

  it("a stored result on a game with no final is unscored, not a difference", () => {
    // In progress, and a week with no game on file at all.
    const c = compareStoredToScores(ENTRIES, [pick("a", "LAC", "win"), pick("b", "PHI", "loss", 3)], GAMES);
    expect(c).toEqual({ differ: [], agree: 0, unscored: 2, pending: 0 });
  });

  it("a bye and a missed week carry no game result and are skipped", () => {
    const c = compareStoredToScores(ENTRIES, [pick("a", "SKIP_WEEK", "bye"), pick("b", "MISSED", "missed")], GAMES);
    expect(c).toEqual({ differ: [], agree: 0, unscored: 0, pending: 0 });
  });

  it("a pick whose entry is not one of ours is not compared", () => {
    const c = compareStoredToScores(ENTRIES, [pick("stranger", "DAL", "win")], GAMES);
    expect(c).toEqual({ differ: [], agree: 0, unscored: 0, pending: 0 });
  });

  it("orders differences by her NO., a row without one last", () => {
    const c = compareStoredToScores(
      ENTRIES,
      [pick("c", "DAL", "win"), pick("b", "DAL", "win"), pick("a", "DAL", "win")],
      GAMES,
    );
    expect(c.differ.map((d) => d.lynneNumber)).toEqual([977, 1016, null]);
    expect(scoreVarianceLine(c.differ[2])).toMatch(/^no NO\. No Number/);
  });
});

describe("the comparison as printed", () => {
  it("is one line when every reached row agrees, naming what is still pending", () => {
    const lines = scoreComparisonLines({ differ: [], agree: 119, unscored: 0, pending: 2 }, 1);
    expect(lines).toEqual([
      "Her results and the scores agree on every row her file has reached Week 1: 119 rows (2 still pending in her file).",
    ]);
  });

  it("leads with the count and lists every differing row when they differ", () => {
    const c = compareStoredToScores(ENTRIES, [pick("a", "DAL", "win"), pick("b", "PHI", "win")], GAMES);
    const lines = scoreComparisonLines(c, 1);
    expect(lines[0]).toBe("Her results and the scores DIFFER on 1 of ours Week 1; 1 agree. Neither side is corrected here:");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("NO. 977 AAA #6");
  });
});
