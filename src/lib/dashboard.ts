import type {
  EntrySummary,
  GridCell,
  PickResult,
  WeekRow,
} from "@/lib/data/types";

const LOSS_RESULTS: PickResult[] = ["loss", "tie_loss", "missed"];

/**
 * Week an entry was eliminated, derived from its current picks.
 * Two lives through `doubleElimThrough`; any loss after that is terminal.
 * Null = still alive.
 */
export function eliminationWeek(
  picks: GridCell[],
  doubleElimThrough = 7,
): number | null {
  let losses = 0;
  for (const p of [...picks].sort((a, b) => a.week - b.week)) {
    if (!p.result || !LOSS_RESULTS.includes(p.result)) continue;
    losses += 1;
    if (p.week > doubleElimThrough) return p.week;
    if (losses >= 2) return p.week;
  }
  return null;
}

/** Entries remaining after each scored week: [{week: 0, remaining: N}, ...]. */
export function survivalCurve(
  entries: EntrySummary[],
  cells: GridCell[],
  doubleElimThrough = 7,
): { week: number; remaining: number }[] {
  const byEntry = new Map<string, GridCell[]>();
  for (const c of cells) {
    if (!byEntry.has(c.entryId)) byEntry.set(c.entryId, []);
    byEntry.get(c.entryId)!.push(c);
  }
  const elimWeeks: number[] = [];
  let lastScored = 0;
  for (const e of entries) {
    const picks = byEntry.get(e.id) ?? [];
    for (const p of picks) {
      if (p.result && p.result !== "pending" && p.week > lastScored) {
        lastScored = p.week;
      }
    }
    const w = eliminationWeek(picks, doubleElimThrough);
    if (w !== null) elimWeeks.push(w);
  }
  const out = [{ week: 0, remaining: entries.length }];
  for (let w = 1; w <= lastScored; w++) {
    out.push({
      week: w,
      remaining: entries.length - elimWeeks.filter((x) => x <= w).length,
    });
  }
  return out;
}

/**
 * The week whose games are in play or next up: the last week whose pick
 * deadline has passed — or the first week if none has.
 */
export function currentPlayWeek(weeks: WeekRow[], now: Date): WeekRow | null {
  if (weeks.length === 0) return null;
  const passed = weeks.filter((w) => new Date(w.deadlineAt) <= now);
  return passed.length > 0 ? passed[passed.length - 1] : weeks[0];
}

/** The next deadline still in the future, if any. */
export function nextDeadline(weeks: WeekRow[], now: Date): WeekRow | null {
  return weeks.find((w) => new Date(w.deadlineAt) > now) ?? null;
}

export interface Distribution {
  week: number;
  revealed: boolean;
  rows: { team: string; count: number; pct: number }[];
}

/**
 * Pick distribution for the current play week. Revealed ONLY once that
 * week's deadline has passed — before that the counts stay server-side.
 */
export function pickDistribution(
  weeks: WeekRow[],
  cells: GridCell[],
  now: Date,
): Distribution | null {
  const wk = currentPlayWeek(weeks, now);
  if (!wk) return null;
  const revealed = new Date(wk.deadlineAt) <= now;
  if (!revealed) return { week: wk.week, revealed: false, rows: [] };
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of cells) {
    if (c.week !== wk.week) continue;
    counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
    total += 1;
  }
  const rows = [...counts.entries()]
    .map(([team, count]) => ({
      team,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
  return { week: wk.week, revealed: true, rows };
}

export interface StandingsBreakdown {
  byeEligible: number;
  active: number;
  atRisk: number;
  byeUsed: number;
  eliminated: number;
}

export function standingsBreakdown(
  entries: EntrySummary[],
): StandingsBreakdown {
  const b: StandingsBreakdown = {
    byeEligible: 0,
    active: 0,
    atRisk: 0,
    byeUsed: 0,
    eliminated: 0,
  };
  for (const e of entries) {
    if (e.status === "eliminated") b.eliminated += 1;
    else if (e.status === "at_risk") b.atRisk += 1;
    else if (e.status === "bye_eligible") b.byeEligible += 1;
    else if (e.byeUsed) b.byeUsed += 1;
    else b.active += 1;
  }
  return b;
}

export interface ActivityRow {
  entryName: string;
  entryId: string;
  team: string;
  week: number;
  result: PickResult;
}

export function recentActivity(
  entries: EntrySummary[],
  cells: GridCell[],
  limit = 10,
): ActivityRow[] {
  const names = new Map(entries.map((e) => [e.id, e.entryName]));
  return cells
    .filter((c) => c.result && c.result !== "pending" && names.has(c.entryId))
    .sort(
      (a, b) =>
        b.week - a.week ||
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    )
    .slice(0, limit)
    .map((c) => ({
      entryId: c.entryId,
      entryName: names.get(c.entryId)!,
      team: c.team,
      week: c.week,
      result: c.result as PickResult,
    }));
}
