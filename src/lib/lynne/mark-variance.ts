// Her fill mark against the standing our scores derive, one of our rows at a
// time. Set by Anthony on 2026-09-15, the morning her Week 1 Final Sheet
// arrived.
//
// Her weekly sheet carries no per-week results. What it carries is a STANDING
// per row, in the fill colour of the NAMES cell: nothing (or the white theme
// fill) for a clean row, yellow for her "1 LOSS/BYE" bucket, red for OUT. On
// 2026-09-15 that was 859 clean and 459 yellow across 1,318 rows, and her
// own stats block on the sheet said the same. So the comparison Anthony
// asked for - her result for each of our 121 against the score-derived one
// - is a comparison of BUCKETS: what her colour says about a row against
// what our current picks and the finals say about it. For Week 1 those are
// the same question as the week's result; from Week 2 they are not, because
// yellow says "one loss somewhere", not "lost this week", so the derived side
// is built from every current pick through the import week and never from
// one week alone.
//
// It is read-only and resolves nothing. She is the authority on elimination
// in her pool; a difference is reported with both values and Anthony
// decides. A silent flip is exactly what this exists to prevent.

import type { GameRow } from "@/lib/data/types";
import { teamResults } from "@/lib/master-list";
import type { GridFill } from "./parse-grid";

/** What her fill says about a row. */
export type HerMark = "clean" | "loss" | "out" | "unknown";

/** What our picks and the finals say about the same row. */
export type DerivedStanding = "clean" | "loss" | "out" | "unscored" | "no pick";

export interface MarkRow {
  entryId: string;
  no: number;
  entryName: string;
  fill: GridFill;
  /** Her cell for the import week, raw, so an OUT written as text counts. */
  weekCellText: string | null;
}

export interface MarkPick {
  entryId: string;
  week: number;
  team: string;
}

export interface MarkVariance {
  no: number;
  entryName: string;
  hers: HerMark;
  ours: DerivedStanding;
  /** The picks the derived side was read from, "W1 LAC, W2 BAL". */
  picks: string;
}

export interface MarkComparison {
  agree: number;
  differ: MarkVariance[];
  /** Rows whose fill is a colour this reader does not know. */
  unknown: number;
  /** Rows with a pick on a game that has no final yet. */
  unscored: number;
}

/** Red, or the word OUT in the week cell, is OUT; yellow is her 1 loss/bye bucket. */
export function herMarkOf(fill: GridFill, weekCellText: string | null): HerMark {
  if (fill === "red" || (weekCellText ?? "").trim().toUpperCase() === "OUT") return "out";
  if (fill === "yellow") return "loss";
  if (fill === "none") return "clean";
  return "unknown";
}

/**
 * Our standing for one row through `week`, from its current picks and the
 * finals: two losses is out, one loss OR a burned bye is her middle bucket,
 * a pick on a game with no final is unscored, no pick at all is said so.
 */
export function derivedStandingOf(
  picks: Pick<MarkPick, "week" | "team">[],
  results: Map<string, "win" | "loss" | "tie">,
  week: number,
): DerivedStanding {
  const mine = picks.filter((p) => p.week <= week);
  if (mine.length === 0) return "no pick";
  let losses = 0;
  let bye = false;
  for (const p of mine) {
    if (p.team === "SKIP_WEEK") {
      bye = true;
      continue;
    }
    if (p.team === "MISSED") {
      losses += 1;
      continue;
    }
    const r = results.get(`${p.week}:${p.team}`);
    if (r === undefined) return "unscored";
    if (r !== "win") losses += 1;
  }
  if (losses >= 2) return "out";
  if (losses === 1 || bye) return "loss";
  return "clean";
}

/**
 * Every matched row of hers against ours. Rows in her numbering. Nothing is
 * written and neither side is called right.
 */
export function compareMarksToScores(
  rows: MarkRow[],
  picks: MarkPick[],
  games: Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">[],
  week: number,
): MarkComparison {
  const results = teamResults(games);
  const byEntry = new Map<string, MarkPick[]>();
  for (const p of picks) byEntry.set(p.entryId, [...(byEntry.get(p.entryId) ?? []), p]);
  const out: MarkComparison = { agree: 0, differ: [], unknown: 0, unscored: 0 };
  for (const r of [...rows].sort((a, b) => a.no - b.no)) {
    const hers = herMarkOf(r.fill, r.weekCellText);
    if (hers === "unknown") {
      out.unknown += 1;
      continue;
    }
    const mine = (byEntry.get(r.entryId) ?? []).filter((p) => p.week <= week).sort((a, b) => a.week - b.week);
    const ours = derivedStandingOf(mine, results, week);
    if (ours === "unscored") {
      out.unscored += 1;
      continue;
    }
    if (ours === hers) {
      out.agree += 1;
      continue;
    }
    out.differ.push({
      no: r.no,
      entryName: r.entryName,
      hers,
      ours,
      picks: mine.map((p) => `W${p.week} ${p.team}`).join(", ") || "-",
    });
  }
  return out;
}

const MARK_WORD: Record<HerMark, string> = {
  clean: "no losses",
  loss: "1 loss/bye",
  out: "OUT",
  unknown: "unknown fill",
};
const OURS_WORD: Record<DerivedStanding, string> = {
  clean: "no losses",
  loss: "1 loss/bye",
  out: "out",
  unscored: "unscored",
  "no pick": "no pick",
};

/** "NO. 977 AAA #6 (W1 TB) - her sheet: no losses, scores: 1 loss/bye" - both values, neither called right. */
export function markVarianceLine(v: MarkVariance): string {
  return `NO. ${v.no} ${v.entryName} (${v.picks}) - her sheet: ${MARK_WORD[v.hers]}, scores: ${OURS_WORD[v.ours]}`;
}

/** The comparison as printed: one line when every row agrees, else the count and every row. */
export function markComparisonLines(c: MarkComparison, week: number): string[] {
  const tail = [
    c.unscored > 0 ? `${c.unscored} with a game not yet final` : null,
    c.unknown > 0 ? `${c.unknown} with a fill this reader does not know` : null,
  ].filter((x): x is string => x !== null);
  const suffix = tail.length > 0 ? ` (${tail.join(", ")})` : "";
  if (c.differ.length === 0) {
    return [`Her marks and the scores agree on every one of our rows through Week ${week}: ${c.agree} rows${suffix}.`];
  }
  return [
    `Her marks and the scores DIFFER on ${c.differ.length} of ours through Week ${week}; ${c.agree} agree${suffix}. Neither side is corrected here:`,
    ...c.differ.map(markVarianceLine),
  ];
}
