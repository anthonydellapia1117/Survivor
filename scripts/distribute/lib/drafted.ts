// One distribute draft per week, and the audit row that proves it.
//
// The command has no other per-week guard, so two ticks in the same window -
// or a hand run beside a scheduled one - left two whole-roster Bcc drafts in
// Gmail (issue #40). Drafts, never sends, but the second is still one Anthony
// has to notice and delete. Pure, so it is tested without a database.

/**
 * Written BEFORE the Gmail call, the way scripts/lib/send.ts claims a send.
 * A claim with no matching drafted row means a draft was attempted and its
 * outcome is unknown; the next run treats it as drafted (never a second
 * whole-roster draft) and Anthony reads it on /admin/audit. Recording only
 * after the call left a draft with no row whenever the insert failed - a
 * transient database error, not just a crash - and the next run drafted again.
 */
export const DRAFT_CLAIM_ACTION = "distribute_draft_claim";

/** The audit action one week's draft is recorded under, once, after it exists. */
export const DRAFTED_ACTION = "distribute_drafted";

/** The week an audit row drafted for, or null when the row names none. */
export function draftedWeekOf(r: { after: Record<string, unknown> | null }): number | null {
  const w = (r.after ?? {}).week;
  return typeof w === "number" && Number.isInteger(w) ? w : null;
}

/** The row already claimed or drafted for this week, or null when none is. A claim counts. */
export function priorDraftFor<T extends { after: Record<string, unknown> | null }>(rows: T[], week: number): T | null {
  return rows.find((r) => draftedWeekOf(r) === week) ?? null;
}
