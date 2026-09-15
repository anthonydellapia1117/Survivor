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
/**
 * The week a PLAYER'S message is recorded in, for the picks sweep. In order:
 * the week the message names, --week, the week that was open WHEN THE MAIL
 * ARRIVED, and only then the week open now. Null when none of those decides
 * (every week locked, nothing named, no --week); the caller stops and asks
 * for --week rather than guessing.
 *
 * The third step went in on 2026-09-15, the day read state stopped being the
 * sweep's marker. The first run after that reads a fortnight of mail Anthony
 * handled by hand while the sweep keyed on unread, and a Week 1 reply of 10
 * September that names no week used to take the open week at RUN time -
 * Week 2 - and would have been written as an on-time Week 2 pick. Judged in
 * the week it arrived in, it meets the Week 1 pick already on file and is a
 * no-op or a staged question. The same rule fixes the ordinary straggler: a
 * reply at 1 PM Friday swept at 3:43 PM is a Week 1 pick, not a Week 2 one.
 */
export function weekOfMail(weeks: WeekBoundsRow[], named: number | null, argWeek: number | null, receivedAt: string | null, now: Date): number | null {
  if (named !== null) return named;
  if (argWeek !== null) return argWeek;
  if (receivedAt && !Number.isNaN(new Date(receivedAt).getTime())) {
    const atReceipt = weekForMessage(weeks, receivedAt);
    if (atReceipt !== null) return atReceipt;
  }
  return weekForMessage(weeks, now.toISOString());
}

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
