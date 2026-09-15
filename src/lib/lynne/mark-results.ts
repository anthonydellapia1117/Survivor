// The week's results, derived from her fill marks. Set by Anthony on
// 2026-09-15: "Write her Week 1 results to picks.result for our 121, from
// her Final Sheet, audited. She is the elimination authority and that field
// is where her authority lives."
//
// Her weekly sheet carries no per-week result column. What it carries is a
// STANDING per row, in the fill of the NAMES cell (white or none for a clean
// row, yellow for her "1 LOSS/BYE" bucket, red or the word OUT for OUT), and
// the week's result is derivable from that mark plus the standing our stored
// record already holds for the earlier weeks. The rule, stated once:
//
//   B  = what the row had already spent before this week, read off the
//        stored prior record: how many losses (loss, tie_loss, missed),
//        whether a bye was burned, and whether a loss fell past the double
//        elimination boundary, which is terminal on its own.
//   candidates for this week's pick: SKIP_WEEK gives [bye]; MISSED gives
//        [missed]; a real team gives [win, loss]. A tie is a loss to her, so
//        the derivation never emits tie_loss; when a stored tie_loss is
//        compared with a derived loss the two are one class.
//   predicted mark for a candidate r: losses = B.losses + 1 if r is a loss
//        or a missed week; bye = B.bye or r is the bye. A row already out on
//        a prior loss past the boundary reads OUT whatever r is; a loss or
//        missed week past the boundary is OUT outright; otherwise two losses
//        is OUT, one loss OR a burned bye is her yellow, and neither is clean.
//   the derived result is the ONE candidate whose predicted mark is hers.
//        None matches: a derived_conflict, both values, not applied. Both
//        match (only on a row our record already has out): the mark cannot
//        say which, so the row is undecidable, counted and left.
//
// That bucket vocabulary is INFERRED from her bucket's name, "1 LOSS/BYE",
// and is not stated by her anywhere: a bye and a loss each put a row there,
// and this reads the two together as that same bucket - exactly as
// derivedStandingOf (mark-variance.ts) and poolBucketOf (master-list.ts)
// already read her fill, so the three readers cannot disagree about one row.
// A first version here stacked them (a bye plus a loss read OUT), a third
// reading nothing from her supports; a verifier caught it on 2026-09-15. The
// stacking case is one the bye rule cannot produce anyway: admin_submit_pick
// allows SKIP_WEEK only from the week after the boundary, refuses it after a
// loss inside the boundary, and any loss past the boundary is terminal, so a
// bye never meets a loss on a live row. If it ever did and she marked the row
// OUT, no candidate would read as her mark and the row would reach Anthony
// as a derived_conflict, never as a guess.
//
// A stored result is never overwritten: a non-pending result of the same
// class as the derived one is already on file, a different one is a
// result_conflict with both values, and neither is applied. Two more rows
// are set aside rather than derived. Where her week cell names a team other
// than the one we hold (or none, or a word that is not a team), her mark is
// about HER team and says nothing about ours; computeGridPlan already
// records that row as team_mismatch, unreadable_team or missing_on_sheet, so
// it is counted here and reported there. And where the prior record still
// carries a pending result on a real team, B is understated and a yellow row
// with an unscored prior loss would derive this week as a loss it did not
// take. Nothing here resolves a difference; Anthony decides.

import type { Apply, Variance } from "./compare";
import { herMarkOf, MARK_WORD, SEASON_END_WEEK, type HerMark, type MarkRow } from "./mark-variance";
import { normalizeGridTeam } from "./plan-grid";

/** The current pick for the import week, as stored. */
export interface WeekPick {
  entryId: string;
  team: string;
  /** win | loss | tie_loss | bye | pending | missed, or null before scoring. */
  result: string | null;
}

/** A current pick for an earlier week, as stored. */
export interface PriorPick {
  entryId: string;
  week: number;
  team: string;
  result: string | null;
}

export interface MarkResultsInput {
  marks: MarkRow[];
  currentPicks: WeekPick[];
  priorPicks: PriorPick[];
  week: number;
  doubleElimThrough: number;
  /** Week 18 and later: her yellow is the winner and is set aside as unknown. Defaults from the week. */
  seasonEnd?: boolean;
}

export type DerivedResult = "win" | "loss" | "bye" | "missed";

export interface MarkResultsPlan {
  /** What the import writes, one per entry, never a stored non-pending result. */
  applies: Apply[];
  byResult: Record<DerivedResult, number>;
  /** Team of each derived loss, real teams only. */
  lossesByTeam: Record<string, number>;
  /** A stored non-pending result of the same class already on file. */
  alreadyApplied: number;
  /** derived_conflict where no candidate reads as her mark; result_conflict where the stored result differs. */
  conflicts: Variance[];
  /** Her fill is a colour this reader does not know, or the season-end yellow. */
  unknown: number;
  /** Two candidates read as her mark; the mark cannot say which. */
  undecidable: number;
  /** A prior week's pick still pending on a real team: B is unknown, so nothing is derived. */
  priorUnscored: number;
  /** Rows with no current pick for the week; plan-grid reports those, this only counts them. */
  noCurrentPick: number;
  /** Rows where her week cell names a team other than our pick, or none; plan-grid reports those too. */
  cellDiffers: number;
}

const LOSS_RESULTS: ReadonlySet<string> = new Set(["loss", "tie_loss", "missed"]);

/** loss and tie_loss are one class: a tie is a loss to her. */
export function resultClass(r: string): string {
  return r === "tie_loss" ? "loss" : r;
}

/** What the stored prior record says the row had already spent before the week. */
export interface PriorStanding {
  /** Stored loss, tie_loss and missed weeks. */
  losses: number;
  /** A SKIP_WEEK, or a stored bye. */
  bye: boolean;
  /** A loss or missed week past the double-elimination boundary: the row is out on that alone. */
  lateLoss: boolean;
}

/**
 * The prior standing, or null when a prior pick on a real team is still
 * pending. A bye and a loss are counted separately and never added into one
 * number: derivedStandingOf and poolBucketOf keep them apart the same way,
 * and one life-count for both is what made a bye stack with a loss.
 */
export function priorStandingOf(prior: PriorPick[], doubleElimThrough: number): PriorStanding | null {
  const out: PriorStanding = { losses: 0, bye: false, lateLoss: false };
  for (const p of prior) {
    if (p.team === "SKIP_WEEK" || p.result === "bye") {
      out.bye = true;
      continue;
    }
    if (p.team === "MISSED" || (p.result !== null && LOSS_RESULTS.has(p.result))) {
      out.losses += 1;
      if (p.week > doubleElimThrough) out.lateLoss = true;
      continue;
    }
    if (p.result === null || p.result === "pending") return null;
  }
  return out;
}

/** The prior standing in words, for a conflict's local side: "1 loss and a bye". */
export function priorStandingText(b: PriorStanding): string {
  const losses = `${b.losses} ${b.losses === 1 ? "loss" : "losses"}${b.lateLoss ? " (one past the boundary)" : ""}`;
  return `${losses} and ${b.bye ? "a bye" : "no bye"}`;
}

/**
 * What her mark would be if this week's result were `r`, given what the row
 * spent before. This is derivedStandingOf's bucketing with the week's result
 * supplied instead of read from a score: a row already out stays out, a loss
 * past the boundary is out, two losses out, one loss or a bye her yellow.
 */
export function predictedMark(r: DerivedResult, before: PriorStanding, week: number, doubleElimThrough: number): HerMark {
  if (before.lateLoss) return "out";
  const costsALoss = r === "loss" || r === "missed";
  const losses = before.losses + (costsALoss ? 1 : 0);
  const bye = before.bye || r === "bye";
  if (costsALoss && week > doubleElimThrough) return "out";
  if (losses >= 2) return "out";
  if (losses === 1 || bye) return "loss";
  return "clean";
}

function candidatesFor(team: string): DerivedResult[] {
  if (team === "SKIP_WEEK") return ["bye"];
  if (team === "MISSED") return ["missed"];
  return ["win", "loss"];
}

/**
 * Whether her week cell is about the pick we hold. A MISSED pick has no
 * team for her to name, so any cell stands; a bye needs her BYE; a team
 * needs her word to map to the same code, exactly (normalizeGridTeam is her
 * vocabulary then the generic one, never fuzzy).
 */
export function herCellIsOurPick(weekCellText: string | null, team: string): boolean {
  if (team === "MISSED") return true;
  if (weekCellText === null) return false;
  return normalizeGridTeam(weekCellText) === team;
}

export function deriveWeekResults(input: MarkResultsInput): MarkResultsPlan {
  const { week, doubleElimThrough } = input;
  const seasonEnd = input.seasonEnd ?? week >= SEASON_END_WEEK;
  const current = new Map(input.currentPicks.map((p) => [p.entryId, p]));
  const priorByEntry = new Map<string, PriorPick[]>();
  for (const p of input.priorPicks) {
    if (p.week >= week) continue;
    priorByEntry.set(p.entryId, [...(priorByEntry.get(p.entryId) ?? []), p]);
  }
  const plan: MarkResultsPlan = {
    applies: [],
    byResult: { win: 0, loss: 0, bye: 0, missed: 0 },
    lossesByTeam: {},
    alreadyApplied: 0,
    conflicts: [],
    unknown: 0,
    undecidable: 0,
    priorUnscored: 0,
    noCurrentPick: 0,
    cellDiffers: 0,
  };

  for (const row of [...input.marks].sort((a, b) => a.no - b.no)) {
    const hers = herMarkOf(row.fill, row.weekCellText, seasonEnd);
    if (hers === "unknown") {
      plan.unknown += 1;
      continue;
    }
    const pick = current.get(row.entryId);
    if (!pick) {
      // admin_apply_lynne_import raises on an apply with no current pick, and
      // computeGridPlan already records the row (no_local_pick or
      // missing_on_sheet); counted here, reported there.
      plan.noCurrentPick += 1;
      continue;
    }
    if (!herCellIsOurPick(row.weekCellText, pick.team)) {
      plan.cellDiffers += 1;
      continue;
    }
    const before = priorStandingOf(priorByEntry.get(row.entryId) ?? [], doubleElimThrough);
    if (before === null) {
      plan.priorUnscored += 1;
      continue;
    }
    const candidates = candidatesFor(pick.team);
    const matching = candidates.filter((r) => predictedMark(r, before, week, doubleElimThrough) === hers);
    if (matching.length > 1) {
      plan.undecidable += 1;
      continue;
    }
    if (matching.length === 0) {
      const implied = candidates
        .map((r) => `${r} reads ${MARK_WORD[predictedMark(r, before, week, doubleElimThrough)]}`)
        .join(", ");
      // Its own type: the score comparison records the same row's mark
      // against the SCORES as a mark_conflict, and one type for both counted
      // one row twice in the total the operator approves (verifier, 2026-09-15).
      plan.conflicts.push({
        type: "derived_conflict",
        entryId: row.entryId,
        entryName: row.entryName,
        lynne: { team: row.weekCellText, result: MARK_WORD[hers] },
        local: { team: pick.team, result: `${priorStandingText(before)} before week ${week}; ${implied}` },
      });
      continue;
    }
    const derived = matching[0];
    const stored = pick.result === null || pick.result === "pending" ? null : pick.result;
    if (stored !== null) {
      if (resultClass(stored) === resultClass(derived)) {
        plan.alreadyApplied += 1;
      } else {
        plan.conflicts.push({
          type: "result_conflict",
          entryId: row.entryId,
          entryName: row.entryName,
          lynne: { team: row.weekCellText, result: `${derived} (her mark: ${MARK_WORD[hers]})` },
          local: { team: pick.team, result: stored },
        });
      }
      continue;
    }
    plan.applies.push({ entry_id: row.entryId, result: derived });
    plan.byResult[derived] += 1;
    if (derived === "loss") plan.lossesByTeam[pick.team] = (plan.lossesByTeam[pick.team] ?? 0) + 1;
  }

  return plan;
}
