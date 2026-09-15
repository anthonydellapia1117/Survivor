import {
  LOCKED_TEAM,
  type EntrySummary,
  type GameDay,
  type GameRow,
  type GridCell,
  type PickResult,
  type WeekRow,
} from "@/lib/data/types";
import type { TeamResult } from "@/lib/master-list";
import { toneOfTeamResult, type ResultTone } from "@/lib/result-colour";
import { SKIP_WEEK } from "@/lib/standing";
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

/**
 * The week an entry dropped out, honouring a status the cells cannot explain.
 *
 * A row of hers she has struck OUT and a row eliminated by a repeated team
 * both carry status "eliminated" with no killing loss cell, so the loss-only
 * rule never drops them from the curve. Given `outWeek` - the week her sheet
 * writes OUT on, where it does - that wins; otherwise such a row drops at the
 * last week it was scored, and at Week 1 if it never was.
 */
export function eliminationWeekOfEntry(
  e: Pick<EntrySummary, "status" | "lastScoredWeek">,
  picks: GridCell[],
  doubleElimThrough = 7,
  outWeek: number | null = null,
): number | null {
  const w = eliminationWeek(picks, doubleElimThrough);
  if (w !== null) return w;
  if (e.status !== "eliminated") return null;
  return outWeek ?? Math.max(1, e.lastScoredWeek ?? 0);
}

/** Entries remaining after each scored week: [{week: 0, remaining: N}, ...]. */
export function survivalCurve(
  entries: EntrySummary[],
  cells: GridCell[],
  doubleElimThrough = 7,
  /** Entry id to the week her sheet writes OUT on, for rows with no loss cell. */
  outWeeks: Map<string, number> = new Map(),
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
    const w = eliminationWeekOfEntry(e, picks, doubleElimThrough, outWeeks.get(e.id) ?? null);
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
 * A chart does not earn its place at two points: [start, after Week 1] is one
 * subtraction, which a number states better than an area chart. The strip
 * draws the step chart only from here on.
 */
export const MIN_CURVE_POINTS = 3;

export function curveEarnsChart(points: { week: number; remaining: number }[]): boolean {
  return points.length >= MIN_CURVE_POINTS;
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

// ------------------------------------------------------------ scoped cards
//
// Everything below is computed ONCE PER SCOPE from the EntrySummary / GridCell
// shape both scopes already produce - poolAsEntries(master, games) for
// Everyone, scoreFromGames(...) for Our group - so the two scopes can never
// be computed two ways (Anthony, 2026-09-15: every viewer KPI shows the whole
// pool by default, our group only under the toggle). None of these functions
// sees a masked pick as anything: a LOCKED cell has a null result and no team
// these count, so nothing here can derive a hidden pick.

/** The week's damage and its most-picked team, for the KPI strip. */
export interface DashboardKpis {
  week: number;
  /** Entries in the scope that are not out. */
  alive: number;
  /** Any final in the week yet. Null tiles print "-" until there is one. */
  anyFinal: boolean;
  /** Cells of the week with a loss, a tie or a missed pick. */
  lostThisWeek: number;
  /** Of those, entries now out. */
  outThisWeek: number;
  chalk: {
    team: string;
    count: number;
    pct: number;
    tone: ResultTone;
    state: "won" | "lost" | "not final";
  } | null;
}

const TEAM_SENTINELS = new Set([SKIP_WEEK, "MISSED", LOCKED_TEAM]);

/** Whether a cell names a real team the scores could ever settle. */
function namesTeam(c: Pick<GridCell, "team">): boolean {
  return !TEAM_SENTINELS.has(c.team);
}

export function dashboardKpis(
  entries: Pick<EntrySummary, "id" | "status">[],
  cells: GridCell[],
  results: Map<string, TeamResult>,
  week: number,
  anyFinal: boolean,
): DashboardKpis {
  const status = new Map(entries.map((e) => [e.id, e.status]));
  const alive = entries.filter((e) => e.status !== "eliminated").length;
  let lostThisWeek = 0;
  let outThisWeek = 0;
  const counts = new Map<string, number>();
  let picked = 0;
  for (const c of cells) {
    if (c.week !== week || !status.has(c.entryId)) continue;
    if (c.result && LOSS_RESULTS.includes(c.result)) {
      lostThisWeek += 1;
      if (status.get(c.entryId) === "eliminated") outThisWeek += 1;
    }
    if (!namesTeam(c)) continue;
    counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
    picked += 1;
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  let chalk: DashboardKpis["chalk"] = null;
  if (anyFinal && top) {
    const r = results.get(`${week}:${top[0]}`);
    const tone = toneOfTeamResult(r);
    chalk = {
      team: top[0],
      count: top[1],
      pct: Math.round((top[1] / picked) * 100),
      tone,
      state: r === undefined ? "not final" : tone === "won" ? "won" : "lost",
    };
  }
  return { week, alive, anyFinal, lostThisWeek, outThisWeek, chalk };
}

/** Rows past this collapse into one "Others" row; the full list sits in a details element. */
export const TOP_N = 8;

export interface DistributionRow {
  team: string;
  /** What the row prints: the code, or BYE for a skipped week. */
  label: string;
  count: number;
  pct: number;
  tone: ResultTone;
  /** A visible W or L beside a final result, nothing otherwise. */
  glyph: "W" | "L" | "";
}

export interface DistributionRows {
  /** The top rows, at most TOP_N. */
  top: DistributionRow[];
  /** Everything past them, summed; null when nothing was collapsed. */
  others: { teams: number; count: number; pct: number } | null;
  /** Every row, for the expanded list. */
  all: DistributionRow[];
  /** The largest count, which the widest bar is drawn against. */
  max: number;
}

/**
 * The week's pick counts with each team's result colour. The counts arrive
 * exactly as poolDistribution / pickDistribution produced them and are never
 * recounted - this never sees a cell, so it can never see a LOCKED one. The
 * tone is the team's own FINAL result in that week and nothing else: an
 * unplayed game leaves the row with no fill and no glyph.
 */
export function distributionRows(
  rows: { team: string; count: number; pct: number }[],
  results: Map<string, TeamResult>,
  week: number,
  topN = TOP_N,
): DistributionRows {
  const all = rows.map((r): DistributionRow => {
    if (r.team === SKIP_WEEK) return { ...r, label: "BYE", tone: "bye", glyph: "" };
    const tone = toneOfTeamResult(results.get(`${week}:${r.team}`));
    return { ...r, label: r.team, tone, glyph: tone === "won" ? "W" : tone === "lost" ? "L" : "" };
  });
  const top = all.length > topN ? all.slice(0, topN) : all;
  const rest = all.slice(top.length);
  const others =
    rest.length > 0
      ? {
          teams: rest.length,
          count: rest.reduce((n, r) => n + r.count, 0),
          pct: rest.reduce((n, r) => n + r.pct, 0),
        }
      : null;
  return { top, others, all, max: Math.max(0, ...all.map((r) => r.count)) };
}

/** The label a missed pick groups under in the carnage list. */
export const NO_PICK_LABEL = "No pick";

export interface CarnageRow {
  /** The team code, or NO_PICK_LABEL for a missed week. */
  team: string;
  lost: number;
  /** Of those, entries now out. */
  out: number;
  /** Share of the week's losses, rounded. */
  share: number;
}

export interface WeekCarnage {
  week: number;
  lostTotal: number;
  outTotal: number;
  rows: CarnageRow[];
}

/**
 * The highest week with any FINAL game - not the play week: on a Thursday
 * night the new week's carnage is the Thursday game, and it grows through
 * Sunday. Null before any game is final.
 */
export function carnageWeek(games: Pick<GameRow, "week" | "status">[]): number | null {
  let w: number | null = null;
  for (const g of games) if (g.status === "final" && (w === null || g.week > w)) w = g.week;
  return w;
}

/**
 * What the week cost, by team: every cell of the week whose result is a
 * loss, a tie (a loss everywhere in this app) or a missed pick, grouped by
 * team, with how many of those entries are now out. A LOCKED cell has a null
 * result and an in-progress game a pending one, so neither is ever a loss
 * here. Sorted by losses, then team.
 */
export function weekCarnage(
  entries: Pick<EntrySummary, "id" | "status">[],
  cells: GridCell[],
  week: number,
): WeekCarnage {
  const status = new Map(entries.map((e) => [e.id, e.status]));
  const by = new Map<string, { lost: number; out: number }>();
  let lostTotal = 0;
  let outTotal = 0;
  for (const c of cells) {
    if (c.week !== week || !status.has(c.entryId)) continue;
    if (!c.result || !LOSS_RESULTS.includes(c.result)) continue;
    const key = c.result === "missed" ? NO_PICK_LABEL : c.team;
    const row = by.get(key) ?? { lost: 0, out: 0 };
    row.lost += 1;
    lostTotal += 1;
    if (status.get(c.entryId) === "eliminated") {
      row.out += 1;
      outTotal += 1;
    }
    by.set(key, row);
  }
  const rows = [...by]
    .map(([team, r]) => ({ team, ...r, share: Math.round((r.lost / lostTotal) * 100) }))
    .sort((a, b) => b.lost - a.lost || a.team.localeCompare(b.team));
  return { week, lostTotal, outTotal, rows };
}

/** The most-picked team of each fully revealed week, and whether it won. */
export interface ChalkRow {
  week: number;
  team: string;
  count: number;
  pct: number;
  tone: ResultTone;
  state: "won" | "lost" | "not final";
}

export function chalkByWeek(
  cells: GridCell[],
  results: Map<string, TeamResult>,
  weeks: number[],
): ChalkRow[] {
  const out: ChalkRow[] = [];
  for (const week of [...weeks].sort((a, b) => a - b)) {
    const counts = new Map<string, number>();
    let picked = 0;
    for (const c of cells) {
      if (c.week !== week || !namesTeam(c)) continue;
      counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
      picked += 1;
    }
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!top) continue;
    const r = results.get(`${week}:${top[0]}`);
    const tone = toneOfTeamResult(r);
    out.push({
      week,
      team: top[0],
      count: top[1],
      pct: Math.round((top[1] / picked) * 100),
      tone,
      state: r === undefined ? "not final" : tone === "won" ? "won" : "lost",
    });
  }
  return out;
}

/** How many ALIVE entries still hold each team, from the revealed weeks only. */
export interface ScarcityRow {
  team: string;
  left: number;
}

export function teamScarcity(
  entries: Pick<EntrySummary, "id" | "status">[],
  cells: GridCell[],
  weeks: number[],
  teams: string[],
  limit = TOP_N,
): { rows: ScarcityRow[]; alive: number } {
  const alive = new Set(entries.filter((e) => e.status !== "eliminated").map((e) => e.id));
  const revealed = new Set(weeks);
  const used = new Map<string, Set<string>>();
  for (const c of cells) {
    if (!alive.has(c.entryId) || !revealed.has(c.week) || !namesTeam(c)) continue;
    if (!used.has(c.team)) used.set(c.team, new Set());
    used.get(c.team)!.add(c.entryId);
  }
  const rows = teams
    .map((team) => ({ team, left: alive.size - (used.get(team)?.size ?? 0) }))
    .filter((r) => r.left < alive.size)
    .sort((a, b) => a.left - b.left || a.team.localeCompare(b.team))
    .slice(0, limit);
  return { rows, alive: alive.size };
}

/**
 * The entries each game eliminated: week -> losing team -> entry names,
 * for the schedule's game board. An entry counts under the team of the loss
 * (or tie) cell in the week it was eliminated; a row with no killing cell -
 * her OUT, a repeated team - is not listed, because no game did it. Only a
 * cell already carrying a loss reaches this, and none can exist before the
 * game is scored, so nothing here can show a pick early.
 */
export type EliminationsByWeek = Record<number, Record<string, string[]>>;

export function eliminationsByWeek(
  entries: Pick<EntrySummary, "id" | "entryName" | "status">[],
  cells: GridCell[],
  doubleElimThrough = 7,
): EliminationsByWeek {
  const byEntry = new Map<string, GridCell[]>();
  for (const c of cells) {
    if (!byEntry.has(c.entryId)) byEntry.set(c.entryId, []);
    byEntry.get(c.entryId)!.push(c);
  }
  const out: EliminationsByWeek = {};
  for (const e of entries) {
    if (e.status !== "eliminated") continue;
    const picks = byEntry.get(e.id) ?? [];
    const week = eliminationWeek(picks, doubleElimThrough);
    if (week === null) continue;
    const kill = picks.find((c) => c.week === week && (c.result === "loss" || c.result === "tie_loss"));
    if (!kill) continue;
    (out[week] ??= {})[kill.team] ??= [];
    out[week][kill.team].push(e.entryName);
  }
  return out;
}
