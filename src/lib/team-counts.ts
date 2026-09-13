// The Teams page's numbers: how many entries picked each team each week,
// shown from the moment that week has locked.
//
// Set by Anthony on 2026-09-13. A count used to appear only once the team's
// game was final. Now it appears as soon as the WEEK's pick deadline has
// passed - taken from the weeks table, never hardcoded - and from that
// moment the full board shows: every team with at least one pick, whether
// its game is scheduled, in progress or final. Before the deadline nothing
// shows, because a published count before picks lock is strategic
// information and would change what undecided players choose.
//
// The counts themselves come from v_team_pick_counts, which the database
// already gates on the same deadline, so this is the second copy of one
// rule - the one a render can be held to in a unit test. Colour is still a
// FINAL result's business and lives in teamResults / result-colour; nothing
// here decides a fill.

import type { TeamPickCount, WeekRow } from "@/lib/data/types";

/** The weeks whose late deadline - the whole week's lock - has passed. */
export function lockedWeeks(weeks: Pick<WeekRow, "week" | "lateDeadlineAt">[], now: Date): Set<number> {
  const out = new Set<number>();
  for (const w of weeks) {
    if (new Date(w.lateDeadlineAt).getTime() <= now.getTime()) out.add(w.week);
  }
  return out;
}

export interface TeamHeat {
  /** team -> week -> entries that picked it. Only locked weeks are present. */
  byTeam: Map<string, Map<number, number>>;
  /** week -> every pick across the pool that week. Only locked weeks are present. */
  byWeek: Map<number, number>;
  /** Every count on the board, summed. */
  total: number;
}

/**
 * The board from the counts, held to the locked weeks. A count for a week
 * that has not locked is dropped here even if a read handed it over - the
 * view is the gate and this is the guard behind it, not a second source.
 */
export function teamHeat(
  counts: Pick<TeamPickCount, "week" | "team" | "n">[],
  weeks: Pick<WeekRow, "week" | "lateDeadlineAt">[],
  now: Date,
): TeamHeat {
  const locked = lockedWeeks(weeks, now);
  const byTeam = new Map<string, Map<number, number>>();
  const byWeek = new Map<number, number>();
  let total = 0;
  for (const c of counts) {
    if (!locked.has(c.week) || c.n <= 0) continue;
    if (!byTeam.has(c.team)) byTeam.set(c.team, new Map());
    const wm = byTeam.get(c.team)!;
    wm.set(c.week, (wm.get(c.week) ?? 0) + c.n);
    byWeek.set(c.week, (byWeek.get(c.week) ?? 0) + c.n);
    total += c.n;
  }
  return { byTeam, byWeek, total };
}
