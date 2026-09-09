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
