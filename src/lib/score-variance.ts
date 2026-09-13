// Her stored result against the result the game scores derive, one of our
// entries at a time.
//
// Set by Anthony on 2026-09-13. Tuesday is the first time picks.result and
// the score-derived display can disagree: her results file writes what ESPN
// has only implied. Until her import lands every one of our picks is
// "pending" and the site colours it from nfl_games (src/lib/live-standing.ts);
// once it lands the stored result wins and the colour follows her file. She
// is the authority on elimination, so that is correct - but a silent flip
// from won to lost is exactly the thing that should reach Anthony as one line
// rather than change colour overnight.
//
// The import itself cannot see this. computeImportPlan raises a
// result_conflict only when a LOCAL non-pending result already exists, and
// nothing writes picks.result from a score, so on import day every one of
// her results is a clean apply and the comparison never happens there. This
// is that comparison, and it is read-only: it names the row, her result and
// the score-derived result, and resolves nothing. Anthony decides.

import type { GameRow, PickResult } from "@/lib/data/types";
import { teamResults, type TeamResult } from "@/lib/master-list";

/** A pick as stored, with the result her file wrote (or "pending" before it). */
export interface StoredPick {
  entryId: string;
  week: number;
  team: string;
  result: string | null;
}

export interface NumberedEntry {
  id: string;
  entryName: string;
  lynneNumber: number | null;
}

export interface ScoreVariance {
  lynneNumber: number | null;
  entryName: string;
  week: number;
  team: string;
  /** Exactly as stored - her file's word for it. */
  stored: string;
  /** What nfl_games derives for that team that week. */
  derived: PickResult;
}

export interface ScoreComparison {
  /** Stored non-pending results that a final on file contradicts. */
  differ: ScoreVariance[];
  /** Stored non-pending results a final on file confirms. */
  agree: number;
  /** Stored non-pending results with no final on file to compare against. */
  unscored: number;
  /** Picks still pending: her file has not reached them. */
  pending: number;
}

/** A stored result this comparison can read: a game result, not a bye or a missed week. */
const COMPARABLE: ReadonlySet<string> = new Set(["win", "loss", "tie_loss"]);

function derivedResult(r: TeamResult): PickResult {
  return r === "win" ? "win" : r === "tie" ? "tie_loss" : "loss";
}

/**
 * Every stored result on `picks` against the score-derived one, for the
 * entries given. A pick whose entry is not in `entries` is not ours and is
 * skipped. Rows come back in her numbering, then by week.
 */
export function compareStoredToScores(
  entries: NumberedEntry[],
  picks: StoredPick[],
  games: Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">[],
): ScoreComparison {
  const results = teamResults(games);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: ScoreComparison = { differ: [], agree: 0, unscored: 0, pending: 0 };
  for (const p of picks) {
    const e = byId.get(p.entryId);
    if (e === undefined) continue;
    if (p.result === null || p.result === "pending") {
      out.pending += 1;
      continue;
    }
    if (!COMPARABLE.has(p.result)) continue;
    const r = results.get(`${p.week}:${p.team}`);
    if (r === undefined) {
      out.unscored += 1;
      continue;
    }
    const derived = derivedResult(r);
    if (derived === p.result) {
      out.agree += 1;
      continue;
    }
    out.differ.push({
      lynneNumber: e.lynneNumber,
      entryName: e.entryName,
      week: p.week,
      team: p.team,
      stored: p.result,
      derived,
    });
  }
  out.differ.sort(
    (a, b) =>
      (a.lynneNumber ?? Number.MAX_SAFE_INTEGER) - (b.lynneNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.week - b.week ||
      a.entryName.localeCompare(b.entryName),
  );
  return out;
}

/** "NO. 977 AAA #6 Week 1 TB - her file: win, scores: loss" - both values, neither called right. */
export function scoreVarianceLine(v: ScoreVariance): string {
  const no = v.lynneNumber === null ? "no NO." : `NO. ${v.lynneNumber}`;
  return `${no} ${v.entryName} Week ${v.week} ${v.team} - her file: ${v.stored}, scores: ${v.derived}`;
}

/**
 * The comparison as printed. One line when everything her file has reached
 * agrees; otherwise a heading with the count and one line per row. The
 * pending count is named so a partial import reads as partial and not as
 * agreement.
 */
export function scoreComparisonLines(c: ScoreComparison, week: number | null = null): string[] {
  const scope = week === null ? "" : ` Week ${week}`;
  const tail = [
    c.unscored > 0 ? `${c.unscored} with no final on file` : null,
    c.pending > 0 ? `${c.pending} still pending in her file` : null,
  ].filter((x): x is string => x !== null);
  const suffix = tail.length > 0 ? ` (${tail.join(", ")})` : "";
  if (c.differ.length === 0) {
    return [`Her results and the scores agree on every row her file has reached${scope}: ${c.agree} rows${suffix}.`];
  }
  return [
    `Her results and the scores DIFFER on ${c.differ.length} of ours${scope}; ${c.agree} agree${suffix}. Neither side is corrected here:`,
    ...c.differ.map(scoreVarianceLine),
  ];
}
