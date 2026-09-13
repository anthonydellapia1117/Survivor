// Our own entries, scored for DISPLAY from the game scores on nfl_games.
//
// Set by Anthony on 2026-09-13, on a bug he found on Week 1's Sunday: the
// Everyone scope of /grid coloured every finished game - her rows are scored
// from nfl_games by poolAsEntries - while the Our-group scope, /entry/[id],
// the Teams page's our-group setting and the dashboard's losses and rolling
// counts all still read "pending" for the same games. Those read
// v_entry_public and v_grid_cells, which carry picks.result, and
// picks.result is written only by admin_apply_lynne_import (her weekly
// results file, Tuesday and Thursday) and admin_set_result. Nothing writes
// it from a score, and that is deliberate: she is the authority on
// results, standings and elimination in her pool, and this app's local
// standing is a second, independent calculation that is compared with hers
// and never merged. So the STORED standing stays exactly what her results
// file said, and this layer is the one place a stored "pending" is read
// against the scores for what the site shows - the same rule, from the same
// table, that already colours her rows.
//
// Two rules, both the same as poolAsEntries so the two scopes are identical:
//
// - A STORED result is never overridden. Only a cell whose stored result is
//   "pending" is read against the scores. The sentinels need no guard of
//   their own: a masked pick (LOCKED) arrives with a null result, a bye
//   (SKIP_WEEK) with "bye" and a missed week (MISSED) with "missed", and
//   none of the three is a team nfl_games could ever score.
// - A game contributes only once it is FINAL with both scores. A part-scored
//   Sunday afternoon shows no colour rather than a colour that will move,
//   which is what teamResults already guarantees.
//
// The reveal gate is untouched. A cell reaches this with its team already
// revealed by the view (a masked pick arrives as LOCKED with no result), and
// a final game has always kicked off, so a result can never be painted onto
// a pick the reader cannot see.
//
// What it does NOT touch: v_entry_standing and everything built on it - the
// Lynne submission's OUT cell, the picks intake's eliminated-entry filter,
// chase and distribute. Those are operations that run on the stored record,
// which is hers.

import type { EntrySummary, GameRow, GridCell, PickResult } from "@/lib/data/types";
import { teamResults } from "@/lib/master-list";

/** What a cell scored here carries in resultSource, so the grid's cell
 *  detail says where the colour came from rather than implying her file. */
export const LIVE_RESULT_SOURCE = "nfl_games";

/**
 * Our entries and cells with every stored "pending" on a FINAL game read from
 * the scores. Cells and entries nothing applies to are returned as the same
 * objects, so a page that was showing the stored record keeps showing it.
 */
export function scoreFromGames(
  entries: EntrySummary[],
  cells: GridCell[],
  games: Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">[],
  doubleElimThrough = 7,
): { entries: EntrySummary[]; cells: GridCell[] } {
  const results = teamResults(games);
  // Per entry: what this layer added, and nothing else. The stored counts
  // are the baseline and only the delta is derived, so an entry the scores
  // say nothing new about is untouched, and one they do is the stored
  // standing plus exactly the finished games her file has not reached yet.
  const added = new Map<string, { wins: number; losses: number; lastWeek: number; lateLoss: boolean }>();
  const scoredCells = cells.map((c) => {
    if (c.result !== "pending") return c;
    const r = results.get(`${c.week}:${c.team}`);
    if (r === undefined) return c;
    const result: PickResult = r === "win" ? "win" : r === "tie" ? "tie_loss" : "loss";
    const a = added.get(c.entryId) ?? { wins: 0, losses: 0, lastWeek: 0, lateLoss: false };
    if (result === "win") a.wins += 1;
    else {
      a.losses += 1;
      if (c.week > doubleElimThrough) a.lateLoss = true;
    }
    a.lastWeek = Math.max(a.lastWeek, c.week);
    added.set(c.entryId, a);
    return { ...c, result, resultSource: LIVE_RESULT_SOURCE };
  });
  const scoredEntries = entries.map((e) => {
    const a = added.get(e.id);
    if (a === undefined) return e;
    const wins = e.wins + a.wins;
    const losses = e.losses + a.losses;
    const lastScoredWeek = Math.max(e.lastScoredWeek ?? 0, a.lastWeek);
    // Mirrors v_entry_standing: two losses or a loss past the double-elim
    // boundary is out, one loss is at risk, a clean row is bye eligible once
    // its last scored week reaches the boundary, else active. A stored
    // "eliminated" stays eliminated whatever the scores add.
    const eliminated = e.status === "eliminated" || losses >= 2 || a.lateLoss;
    const status: EntrySummary["status"] = eliminated
      ? "eliminated"
      : losses === 1
        ? "at_risk"
        : lastScoredWeek >= doubleElimThrough && losses === 0 && !e.byeUsed
          ? "bye_eligible"
          : "active";
    return {
      ...e,
      wins,
      losses,
      lastScoredWeek,
      livesRemaining: eliminated ? 0 : Math.max(0, 2 - losses),
      status,
    };
  });
  return { entries: scoredEntries, cells: scoredCells };
}
