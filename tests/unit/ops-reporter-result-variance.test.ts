import { describe, expect, it } from "vitest";
import { renderReport } from "../../scripts/ops/lib/report";
import { reportResultVariance } from "../../scripts/ops/reporters/result-variance";
import type { EntrySnapshot, GameSnapshot, OpsSnapshot, PickSnapshot } from "../../scripts/ops/reporters/types";

// The seventh reporter: her stored result against the score-derived one, for
// our rows only. Set by Anthony on 2026-09-13.

const GAMES: GameSnapshot[] = [
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL", kickoffAt: "2026-09-13T17:00:00Z", homeScore: 24, awayScore: 17, status: "final" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "LAC", awayTeam: "ARI", kickoffAt: "2026-09-13T20:25:00Z", homeScore: 14, awayScore: 3, status: "in_progress" },
];

function entry(id: string, lynneNumber: number, entryName = id): EntrySnapshot {
  return {
    id, entryName, lynneNumber, ownerName: "Owner", ownerEmail: "o@example.com", playerEmail: null,
    isFreeEntry: false, isGifted: false, submittedToLynneAt: null, submittedAsName: null,
  };
}

function pick(entryId: string, team: string, result: string | null): PickSnapshot {
  return { entryId, week: 1, team, submittedAt: "2026-09-11T15:00:00Z", late: false, source: "email", result };
}

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: new Date("2026-09-15T22:00:00Z"),
    weeks: [{ week: 1, earlyDeadlineAt: "2026-09-09T18:00:00Z", lateDeadlineAt: "2026-09-11T18:00:00Z" }],
    games: GAMES,
    entries: [entry("a", 977, "AAA #6"), entry("b", 1016, "Jim Teti #4")],
    picks: [],
    herRows: [],
    herSheet: null,
    herMail: null,
    owners: [],
    payments: [],
    recipientAddresses: [],
    expectedRosterAddresses: 41,
    freeEntryCount: 0,
    recruitedCount: 0,
    lynneRateCents: 2500,
    ...over,
  };
}

describe("the result-variance reporter", () => {
  it("is NO ACTION before her file lands - everything pending is nothing to compare", () => {
    const r = reportResultVariance(snap({ picks: [pick("a", "DAL", "pending"), pick("b", "PHI", "pending")] }));
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("is NO ACTION when every row her file reached agrees with the scores", () => {
    const r = reportResultVariance(snap({ picks: [pick("a", "DAL", "loss"), pick("b", "PHI", "win")] }));
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("names the row where her file and the scores differ, with both values, and resolves nothing", () => {
    const r = reportResultVariance(snap({ picks: [pick("a", "DAL", "win"), pick("b", "PHI", "win")] }));
    expect(renderReport(r)).toEqual([
      "NEEDS ANTHONY",
      "her result and the score-derived result differ; neither side is corrected here.",
      "NO. 977 AAA #6 Week 1 DAL - her file: win, scores: loss",
    ]);
    expect(r.items[0].names).toEqual(["AAA #6 (NO. 977 Week 1)"]);
  });

  it("says nothing about a stored result on a game with no final", () => {
    const r = reportResultVariance(snap({ picks: [pick("a", "LAC", "loss")] }));
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });
});
