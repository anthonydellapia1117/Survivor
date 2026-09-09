// One distribute draft per week, and the audit row that proves it.
//
// The command has no other per-week guard, so two ticks in the same window -
// or a hand run beside a scheduled one - left two whole-roster Bcc drafts in
// Gmail (issue #40). Drafts, never sends, but the second is still one Anthony
// has to notice and delete. Pure, so it is tested without a database.

/** The audit action one week's draft is recorded under, once. */
export const DRAFTED_ACTION = "distribute_drafted";

/** The week an audit row drafted for, or null when the row names none. */
export function draftedWeekOf(r: { after: Record<string, unknown> | null }): number | null {
  const w = (r.after ?? {}).week;
  return typeof w === "number" && Number.isInteger(w) ? w : null;
}

/** The row already drafted for this week, or null when none is. */
export function priorDraftFor<T extends { after: Record<string, unknown> | null }>(rows: T[], week: number): T | null {
  return rows.find((r) => draftedWeekOf(r) === week) ?? null;
}
