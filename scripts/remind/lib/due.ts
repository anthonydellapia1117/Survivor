// Which week reminder is due, from the weeks table and the clock and
// nothing else. A week has two stored boundaries, early (the Wednesday
// noon-ish tier) and late (the Friday lock); each gets one reminder, sent
// REMINDER_LEAD_HOURS before it. Pure, so it is tested without a database.

import type { WeekBoundsRow } from "../../lib/db";

export type BoundaryKind = "early" | "late";

export interface Boundary {
  week: number;
  kind: BoundaryKind;
  deadlineIso: string;
}

/** How long before a boundary its reminder goes. Set by Anthony on 2026-09-09. */
export const REMINDER_LEAD_HOURS = 6;

function at(iso: string): number {
  return new Date(iso).getTime();
}

/** Every boundary of every week, earliest first. */
export function boundariesOf(weeks: WeekBoundsRow[]): Boundary[] {
  const out: Boundary[] = [];
  for (const w of weeks) {
    if (w.early_deadline_at) out.push({ week: w.week, kind: "early", deadlineIso: w.early_deadline_at });
    if (w.late_deadline_at) out.push({ week: w.week, kind: "late", deadlineIso: w.late_deadline_at });
  }
  return out.sort((a, b) => at(a.deadlineIso) - at(b.deadlineIso) || a.week - b.week);
}

/** The audit key one reminder is sent under, once: week:N:early or week:N:late. */
export function boundaryKey(b: Pick<Boundary, "week" | "kind">): string {
  return `week:${b.week}:${b.kind}`;
}

/**
 * The boundary whose reminder window holds `now`: the earliest one with
 * deadline - lead <= now < deadline. Null when none is due, which is the
 * normal answer for most of the week; a scheduler can fire this on a coarse
 * clock and the audit log keeps it to one send per boundary.
 */
export function dueBoundary(weeks: WeekBoundsRow[], now: Date, leadHours: number = REMINDER_LEAD_HOURS): Boundary | null {
  const t = now.getTime();
  const lead = leadHours * 60 * 60 * 1000;
  for (const b of boundariesOf(weeks)) {
    const d = at(b.deadlineIso);
    if (d - lead <= t && t < d) return b;
  }
  return null;
}

/** A named boundary for a hand run; null when the week has no such boundary. */
export function findBoundary(weeks: WeekBoundsRow[], week: number, kind: BoundaryKind): Boundary | null {
  return boundariesOf(weeks).find((b) => b.week === week && b.kind === kind) ?? null;
}
