// Which week /admin/picks OPENS on. The default only - the selector is his to
// change whenever he wants, and this never touches what a pick is stamped
// with.
//
// It used to roll the moment a week's deadline passed, which is wrong for how
// the week actually runs. Stragglers arrive all Friday evening and Saturday,
// well past the 2 PM lock, and every one of them meant fighting the selector
// back to the week being worked. The banner already says "locked 2h ago - new
// picks will be flagged late"; that line is what tells him he is past the
// deadline, and it does its job while the selector stays put.
//
// So the roll point is KICKOFF, not the deadline: once the week is actually
// being played there is nothing left to record for it.
//
// WHICH kickoff is the whole subtlety. Set by Anthony on 2026-09-11: Week 1
// holds until Sunday 2026-09-13 1:00 PM ET, the first Sunday kickoff. That is
// NOT the week's earliest game - Week 1 opens with a standalone Wednesday
// night game (NE at SEA, 09-09 8:20 PM ET) and a Thursday one. Rolling on the
// earliest kickoff of any kind would have moved off Week 1 on Wednesday
// evening, before the Friday deadline had even passed, which is a worse
// version of the bug this replaces.
//
// The roll point is therefore the first kickoff of the week's MAIN SLATE - the
// games sharing the week's late deadline, which is the Sat/Sun/Mon window that
// carries the volume. `deadlineTier` is the one place that mapping is written
// (src/lib/deadlines.ts) and this reads it rather than naming days again.
//
// Read off nfl_games every time. No hardcoded day, no hardcoded hour, and
// nothing derived from the deadline - a week whose schedule moves moves this
// with it.

import { deadlineTier } from "./deadlines";
import type { GameRow, WeekRow } from "./data/types";

/**
 * When the default stops offering `week` - the first main-slate kickoff, or
 * null when the schedule cannot say.
 *
 * Falls back to the week's earliest game of ANY tier when it has no main-slate
 * game at all. That combination does not exist in a real NFL week; the
 * fallback is here so a partially seeded schedule degrades to the old
 * every-game reading rather than to "never roll".
 */
export function weekRollsAt(week: number, games: GameRow[]): Date | null {
  let slate: number | null = null;
  let any: number | null = null;
  for (const g of games) {
    if (g.week !== week) continue;
    const t = new Date(g.kickoffAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (any === null || t < any) any = t;
    if (deadlineTier(g.dayOfWeek) !== "late") continue;
    if (slate === null || t < slate) slate = t;
  }
  const ms = slate ?? any;
  return ms === null ? null : new Date(ms);
}

/**
 * The week /admin/picks opens on: the earliest week still short of its first
 * main-slate kickoff.
 *
 * A week the schedule says nothing about is never skipped past - it has no
 * kickoff to have passed, so it is still open to record against. The last week
 * is the floor once the season is played out.
 */
export function defaultPickWeek(
  weeks: WeekRow[],
  games: GameRow[],
  now: Date = new Date(),
): number {
  const ordered = [...weeks].sort((a, b) => a.week - b.week);
  const ms = now.getTime();
  for (const w of ordered) {
    const rollsAt = weekRollsAt(w.week, games);
    if (rollsAt === null || rollsAt.getTime() > ms) return w.week;
  }
  return ordered[ordered.length - 1]?.week ?? 1;
}
