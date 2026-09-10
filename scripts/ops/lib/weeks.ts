// Which week a post-lock job works on: the most recent week whose late
// deadline has passed. Results arrive for it and the distribute message
// describes it. Null before Week 1 locks.

import type { WeekBoundsRow } from "../../lib/db";

export function latestLockedWeek(weeks: WeekBoundsRow[], now: Date): number | null {
  let best: number | null = null;
  for (const w of weeks) {
    if (!w.late_deadline_at) continue;
    if (new Date(w.late_deadline_at).getTime() <= now.getTime() && (best === null || w.week > best)) best = w.week;
  }
  return best;
}

/**
 * The week a message of hers is about: the first week whose late deadline had
 * not passed when it arrived. That is the open week, which is the one she
 * publishes picks for.
 *
 * Derived from the weeks table and nothing else - never from a calendar in
 * code, and never from her subject line, which reads "Wednesday and Thursday
 * Games" and names no week at all. Null when every week has locked; the
 * caller names one rather than being handed a guess.
 */
export function weekForMessage(weeks: WeekBoundsRow[], receivedAt: string): number | null {
  const at = new Date(receivedAt).getTime();
  let best: number | null = null;
  let bestAt = Infinity;
  for (const w of weeks) {
    if (!w.late_deadline_at) continue;
    const late = new Date(w.late_deadline_at).getTime();
    if (late >= at && late < bestAt) {
      best = w.week;
      bestAt = late;
    }
  }
  return best;
}
