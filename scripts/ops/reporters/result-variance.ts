// Her stored results against the score-derived ones, as a daily reporter.
//
// Set by Anthony on 2026-09-13. Until her results file lands, every one of
// our picks is "pending" and the site colours it from nfl_games; once it
// lands, picks.result is her word and the colour follows it. She is the
// authority on elimination, so a row that flips is correct to flip - and it
// is exactly the row that has to reach Anthony as one line rather than
// change colour overnight. The import cannot raise it (a result_conflict
// needs a local result to already exist, and nothing writes one from a
// score), so this reads what the import wrote and compares it.
//
// Like every reporter here it is pure and read-only: no write, no send, no
// resolution. Both values are named and neither is called right.

import { compareStoredToScores, scoreVarianceLine } from "@/lib/score-variance";
import type { Report, ReportItem } from "../lib/report";
import type { OpsSnapshot } from "./types";

const JOB = "result-variance";

const PREAMBLE = "her result and the score-derived result differ; neither side is corrected here.";

export function reportResultVariance(s: OpsSnapshot): Report {
  const c = compareStoredToScores(
    s.entries.map((e) => ({ id: e.id, entryName: e.entryName, lynneNumber: e.lynneNumber })),
    s.picks.map((p) => ({ entryId: p.entryId, week: p.week, team: p.team, result: p.result })),
    s.games.map((g) => ({
      week: g.week,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      status: g.status,
    })),
  );
  const items: ReportItem[] = c.differ.map((v) => ({
    text: scoreVarianceLine(v),
    names: [`${v.entryName} (NO. ${v.lynneNumber ?? "none"} Week ${v.week})`],
  }));
  return items.length > 0 ? { job: JOB, items, preamble: PREAMBLE } : { job: JOB, items };
}
