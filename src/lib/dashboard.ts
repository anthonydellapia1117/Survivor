import type {
  EntrySummary,
  GameDay,
  GameRow,
  GridCell,
  PickResult,
  WeekRow,
} from "@/lib/data/types";
import {
  deadlineTier,
  pickDeadlineIso,
  type DeadlineTier,
} from "@/lib/deadlines";

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

export interface LockBoundary {
  week: number;
  /** Which game-day tier this boundary closes. `late` is the Sat-Mon window. */
  kind: DeadlineTier;
  deadlineAt: string;
}

/**
 * The next deadline any entry actually faces.
 *
 * It has to consult the schedule, not just the week's two stored boundaries:
 * the tiers are per game day, so a week with a Wednesday game closes those
 * picks a day BEFORE its early deadline, and a week with a Friday game closes
 * those a day after. Reading only early/late would advertise Wednesday as the
 * next lock while Seahawks picks were closing on Tuesday.
 *
 * A tier is only offered if the week has a game on that day; the Sat-Mon
 * boundary is always offered, since it is the week's full lock.
 */
export function nextLockBoundary(
  weeks: WeekRow[],
  games: Pick<GameRow, "week" | "dayOfWeek">[],
  now: Date,
): LockBoundary | null {
  const daysByWeek = new Map<number, Set<DeadlineTier>>();
  for (const g of games) {
    const set = daysByWeek.get(g.week) ?? new Set<DeadlineTier>();
    set.add(deadlineTier(g.dayOfWeek));
    daysByWeek.set(g.week, set);
  }

  const upcoming: LockBoundary[] = [];
  for (const w of weeks) {
    const tiers = daysByWeek.get(w.week) ?? new Set<DeadlineTier>();
    for (const kind of ["wed", "thu", "fri", "late"] as const) {
      // The late boundary is the week's full lock and always applies — a
      // bye or an entry with no pick yet is governed by it.
      if (kind !== "late" && !tiers.has(kind)) continue;
      const at = pickDeadlineIso(
        TIER_DAY[kind],
        w.earlyDeadlineAt,
        w.lateDeadlineAt,
      );
      if (new Date(at) > now) {
        upcoming.push({ week: w.week, kind, deadlineAt: at });
      }
    }
  }
  upcoming.sort(
    (a, b) =>
      new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime(),
  );
  return upcoming[0] ?? null;
}

/** A representative game day per tier, to drive the shared derivation. */
const TIER_DAY: Record<DeadlineTier, GameDay> = {
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  late: "Sunday",
};

export const LOCK_KIND_LABEL: Record<LockBoundary["kind"], string> = {
  wed: "Wednesday-game picks",
  thu: "Thursday-game picks",
  fri: "Friday-game picks",
  late: "Sat–Mon picks",
};

export interface Distribution {
  week: number;
  revealed: boolean;
  rows: { team: string; count: number; pct: number }[];
}

/**
 * Pick distribution for the current play week. Counts ONLY picks whose
 * games have started — locked picks are masked out of the payload
 * server-side (per-game visibility), so a game's counts appear the moment
 * it kicks off and never before.
 */
export function pickDistribution(
  weeks: WeekRow[],
  cells: GridCell[],
  now: Date,
): Distribution | null {
  const wk = currentPlayWeek(weeks, now);
  if (!wk) return null;
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of cells) {
    if (c.week !== wk.week || c.team === "LOCKED") continue;
    counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return { week: wk.week, revealed: false, rows: [] };
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
