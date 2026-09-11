// The per-week claim for the Friday picks draft.
//
// The ops tick fires every 19 minutes with a 60-MINUTE LOOKBACK, so the
// Friday 17:30 ET slot reads as due at 17:38, 17:57, 18:00 and 18:19 - four
// firings, four identical drafts to Lynne, and an easy send of a stale one.
// That is the exact hazard that had three Week 1 drafts sitting in her thread
// on 2026-09-11. Both reviewers found it on #91.
//
// Same shape as the distribute job's: a claim row keyed by week goes in
// BEFORE the Gmail call, so a run that dies between the two still stops every
// later run from drafting that week again.

export const WEEKLY_CLAIM_ACTION = "lynne_weekly_draft_claim";
export const WEEKLY_DRAFTED_ACTION = "lynne_weekly_drafted";

function weekOf(row: { after: Record<string, unknown> | null }): number | null {
  const w = row.after?.week;
  return typeof w === "number" ? w : null;
}

/** The claim or drafted row for `week`, or null when it is unclaimed. */
export function priorWeeklyDraft<T extends { after: Record<string, unknown> | null }>(
  rows: T[],
  week: number,
): T | null {
  return rows.find((r) => weekOf(r) === week) ?? null;
}
