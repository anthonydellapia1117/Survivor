// Whether a week's late deadline has passed. The distribute message says the
// picks are posted, so it must not go out while any pick for the week is
// still private. The week is fully locked at the late boundary (Friday noon,
// per CLAUDE.md "Pick deadlines"), and that is the only moment this command
// may run after.

import { formatEt, type WeekBounds } from "../../picks/lib/deadline";

/** True once `now` is at or past the week's late deadline. Earlier is a refusal. */
export function lockPassed(bounds: WeekBounds, now: Date): boolean {
  return now.getTime() >= new Date(bounds.lateDeadlineAt).getTime();
}

/** The refusal line before the lock, null once the week is locked. */
export function refusalBeforeLock(bounds: WeekBounds, now: Date): string | null {
  if (lockPassed(bounds, now)) return null;
  return `Week ${bounds.week} locks at ${formatEt(bounds.lateDeadlineAt)}; distribute runs after the lock.`;
}
