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
import { LOCKED_TEAM } from "@/lib/data/types";
import { MISSED_TEAM, teamResults, type TeamResult } from "@/lib/master-list";
import { SKIP_WEEK } from "@/lib/standing";

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
 * deadline has passed - or the first week if none has.
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
      // The late boundary is the week's full lock and always applies - a
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
  late: "Sat-Mon picks",
};

export interface Distribution {
  week: number;
  revealed: boolean;
  rows: { team: string; count: number; pct: number }[];
}

/**
 * Pick distribution for the current play week. Counts ONLY picks whose
 * games have started - locked picks are masked out of the payload
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

// ------------------------------------------------------------ the charts
//
// Each helper below reads the entries and cells of ONE scope: the whole
// pool's rows as poolAsEntries builds them from her newest sheet, or this
// group's own. The dashboard picks the scope once and hands every chart the
// same pair, so no chart can mix the pool with our 121.

function cellsByEntry(cells: GridCell[]): Map<string, GridCell[]> {
  const m = new Map<string, GridCell[]>();
  for (const c of cells) {
    if (!m.has(c.entryId)) m.set(c.entryId, []);
    m.get(c.entryId)!.push(c);
  }
  return m;
}

function isScored(c: GridCell): boolean {
  return c.result !== null && c.result !== "pending";
}

/** The latest week any cell carries a result in; null before Week 1 is scored. */
export function latestScoredWeek(cells: GridCell[]): number | null {
  let latest: number | null = null;
  for (const c of cells) if (isScored(c) && (latest === null || c.week > latest)) latest = c.week;
  return latest;
}

/**
 * The week an entry stops counting as alive. A losing cell dates it when it
 * can; an entry that is out with none (her OUT, a repeated team) is out from
 * its last scored week, or from `fallback` when it has none.
 */
function outWeekOf(e: EntrySummary, picks: GridCell[], fallback: number, doubleElimThrough: number): number | null {
  const w = eliminationWeek(picks, doubleElimThrough);
  if (w !== null) return w;
  return e.status === "eliminated" ? (e.lastScoredWeek ?? fallback) : null;
}

export interface SurvivalWeek {
  /** 0 is the start of the season, before anything is scored. */
  week: number;
  noLosses: number;
  lossBye: number;
  out: number;
}

/**
 * Where every entry of a scope stood after each scored week, in her three
 * buckets: No Losses, 1 Loss/Bye, Out. Week 0 is the start. The survival chart
 * draws one column per week from this, so a reader sees at once how much of
 * the field is clean, how much is damaged and how much is gone - where the
 * old single line read "121 remaining" for eleven weeks and said nothing.
 */
export function survivalByWeek(
  entries: EntrySummary[],
  cells: GridCell[],
  doubleElimThrough = 7,
): SurvivalWeek[] {
  const byEntry = cellsByEntry(cells);
  const last = latestScoredWeek(cells) ?? 0;
  const state = entries.map((e) => {
    const picks = byEntry.get(e.id) ?? [];
    const lossWeeks = picks.filter((p) => p.result !== null && LOSS_RESULTS.includes(p.result)).map((p) => p.week);
    const byeCell = picks.find((p) => p.team === SKIP_WEEK || p.result === "bye");
    const byeWeek = byeCell ? byeCell.week : e.byeUsed ? last : null;
    return { lossWeeks, byeWeek, outWeek: outWeekOf(e, picks, last, doubleElimThrough) };
  });
  const out: SurvivalWeek[] = [];
  for (let w = 0; w <= last; w++) {
    let noLosses = 0;
    let lossBye = 0;
    let gone = 0;
    for (const s of state) {
      if (s.outWeek !== null && s.outWeek <= w) gone += 1;
      else if (s.lossWeeks.some((x) => x <= w) || (s.byeWeek !== null && s.byeWeek <= w)) lossBye += 1;
      else noLosses += 1;
    }
    out.push({ week: w, noLosses, lossBye, out: gone });
  }
  return out;
}

export interface DamageRow {
  /** The team a loss was taken on, or MISSED for a week with no pick. */
  team: string;
  /** Entries that lost a life on it that week: a loss, a tie, a missed week. */
  lost: number;
  /** Of those, the entries the loss finished. */
  out: number;
}

export interface WeekDamage {
  week: number;
  rows: DamageRow[];
  lost: number;
  out: number;
  /** Entries still alive going into the week: what the shares are shares of. */
  aliveBefore: number;
}

/**
 * What one scored week cost, team by team: how many entries lost a life on
 * each losing team (or on no pick at all) and how many of those it finished.
 *
 * The carnage view reads this rather than eliminations alone. Through the
 * double-elimination weeks a lost life is the event and an elimination is
 * rare: Week 1 of 2026 cost 459 of 1,318 entries a life and finished none,
 * and a report of eliminations only said "No eliminations yet" over the worst
 * week of damage the pool will have.
 */
export function weekDamage(
  entries: EntrySummary[],
  cells: GridCell[],
  week: number,
  doubleElimThrough = 7,
): WeekDamage | null {
  const byEntry = cellsByEntry(cells);
  const last = latestScoredWeek(cells) ?? 0;
  const rows = new Map<string, DamageRow>();
  let lost = 0;
  let out = 0;
  let aliveBefore = 0;
  let scored = false;
  for (const e of entries) {
    const picks = byEntry.get(e.id) ?? [];
    const outWeek = outWeekOf(e, picks, last, doubleElimThrough);
    if (outWeek === null || outWeek >= week) aliveBefore += 1;
    for (const c of picks) {
      if (c.week !== week) continue;
      if (isScored(c)) scored = true;
      if (c.result === null || !LOSS_RESULTS.includes(c.result)) continue;
      const row = rows.get(c.team) ?? { team: c.team, lost: 0, out: 0 };
      row.lost += 1;
      lost += 1;
      if (eliminationWeek(picks, doubleElimThrough) === week) {
        row.out += 1;
        out += 1;
      }
      rows.set(c.team, row);
    }
  }
  if (!scored) return null;
  return {
    week,
    rows: [...rows.values()].sort((a, b) => b.lost - a.lost || a.team.localeCompare(b.team)),
    lost,
    out,
    aliveBefore,
  };
}

export interface ChalkWeek {
  week: number;
  team: string;
  count: number;
  /** The most-picked team's result that week; "pending" until its game is final. */
  result: PickResult;
}

/** The most-picked team of every week with a scored pick, and how it did. */
export function chalkByWeek(weeks: Pick<WeekRow, "week">[], cells: GridCell[]): ChalkWeek[] {
  const out: ChalkWeek[] = [];
  for (const w of weeks) {
    const weekCells = cells.filter(
      (c) => c.week === w.week && c.team !== SKIP_WEEK && c.team !== MISSED_TEAM && c.team !== LOCKED_TEAM,
    );
    if (!weekCells.some(isScored)) continue;
    const byTeam = new Map<string, { n: number; result: PickResult }>();
    for (const c of weekCells) {
      const cur = byTeam.get(c.team) ?? { n: 0, result: "pending" as PickResult };
      cur.n += 1;
      if (c.result && c.result !== "pending") cur.result = c.result;
      byTeam.set(c.team, cur);
    }
    const top = [...byTeam.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    if (top) out.push({ week: w.week, team: top[0], count: top[1].n, result: top[1].result });
  }
  return out;
}

export interface TeamLeft {
  team: string;
  /** Alive entries that have not used the team yet. */
  left: number;
}

/**
 * The teams the fewest alive entries still hold, scarcest first: the ones the
 * field will be forced off soonest. Only teams at least one alive entry has
 * already spent are listed - a team nobody has used is not running out.
 */
export function teamsRunningOut(
  entries: Pick<EntrySummary, "status" | "teamsUsed">[],
  teams: string[],
  limit = 8,
): { rows: TeamLeft[]; alive: number } {
  const alive = entries.filter((e) => e.status !== "eliminated");
  const rows = teams
    .map((team) => ({ team, left: alive.filter((e) => !e.teamsUsed.includes(team)).length }))
    .filter((r) => r.left < alive.length)
    .sort((a, b) => a.left - b.left || a.team.localeCompare(b.team))
    .slice(0, limit);
  return { rows, alive: alive.length };
}

/**
 * Each team's result in a week, for the distribution's bar colours: from the
 * finals only, so a game still being played has none and its bar stays
 * neutral rather than taking a colour that will move.
 */
export function weekTeamResults(
  games: Parameters<typeof teamResults>[0],
  week: number,
): (team: string) => TeamResult | undefined {
  const results = teamResults(games);
  return (team) => results.get(`${week}:${team}`);
}
