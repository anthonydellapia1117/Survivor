// One scope of the dashboard's lower section, computed on the server.
//
// Set by Anthony on 2026-09-15, and restated the same day as the rule rather
// than a list of fixes: every panel on the dashboard shows the WHOLE POOL
// unless the toggle is set to Our group. The two scopes are one computation:
// poolAsEntries(master, games) hands over her rows in the same EntrySummary /
// GridCell shape scoreFromGames hands over ours, and everything here is built
// from that shape and nothing else. Both scopes are computed here, on the
// server, and handed to one client toggle as plain data, so the reveal gate
// is untouched: a masked pick reaches this already LOCKED with no result, and
// nothing below can turn it into a team.
//
// ScopeData is EVERYTHING a panel may print. Recent activity is not on it:
// that card is our intake and can only ever be ours, so it is rendered
// outside the toggle by the page (src/components/dashboard/recent-activity.tsx)
// and the pool scope cannot even carry one. Nothing else that is our-group
// derived reaches a panel any other way.
//
// Every figure is a number, a string or a list of those - no Map, no Date,
// no function - because the whole thing crosses to a client component.

import type { EntrySummary, GameRow, GridCell } from "@/lib/data/types";
import {
  carnageWeek,
  chalkByWeek,
  curveEarnsChart,
  dashboardKpis,
  distributionRows,
  survivalCurve,
  teamScarcity,
  weekCarnage,
  type ChalkRow,
  type DashboardKpis,
  type DistributionRows,
  type ScarcityRow,
  type WeekCarnage,
} from "@/lib/dashboard";
import { lynneBucket } from "@/lib/lynne/names";
import {
  fullyRevealedWeeks,
  herCell,
  poolEntryId,
  teamResults,
  weekColumns,
  type MasterList,
  type TeamsSourceKind,
} from "@/lib/master-list";
import { NFL_TEAMS } from "@/lib/standing";

/** The exact words on the toggle, the same on /grid, /teams and here. */
export const SCOPE_LABEL: Record<TeamsSourceKind, string> = {
  pool: "Everyone",
  ours: "Our group",
};

export interface SurvivalStrip {
  /** Where the field started: her published Total in Pool, or the scope's count. */
  start: number;
  /** Entries in the scope that are not out. */
  remaining: number;
  /**
   * The latest scored week's drop; null before any week is scored. `partial`
   * is that week still in play - a game of it not final - so the strip says
   * "so far" rather than presenting a Thursday-night zero as the week's cost.
   */
  drop: { week: number; n: number; pct: number; partial: boolean } | null;
  points: { week: number; remaining: number }[];
  /** Whether the points earn a chart (MIN_CURVE_POINTS). */
  chart: boolean;
}

export interface DistributionView {
  week: number | null;
  /** The rows to draw, or null for one of the empty states. Always the scope's own. */
  rows: DistributionRows | null;
  /**
   * Which empty state, when rows is null. `unpublished` is the pool's: her
   * sheet has no column for the week yet, and the card says so. Our group
   * does NOT stand in on it - that branch came out on 2026-09-15, because
   * under Everyone no figure may be derived from our entries.
   */
  empty: "locked" | "unpublished" | "none";
  /** The sentence under the rows. */
  caption: string;
  /** For the locked state: when the week's lock passes. */
  lockedAt: string | null;
}

export interface StandingsBar {
  buckets: { label: "No Losses" | "Loss/Bye" | "Out"; n: number }[];
  total: number;
  alive: number;
  sentence: string;
}

/**
 * The carnage card: the highest final week's damage, or why there is none -
 * no game final anywhere yet, or (the pool only) a week her sheet does not
 * carry, where a zero would read as "nobody lost" and be false.
 */
export type CarnageView =
  | ({ state: "ready" } & WeekCarnage & { finalGames: number; totalGames: number })
  | { state: "no final" }
  | { state: "unpublished"; week: number };

export interface ScopeData {
  key: TeamsSourceKind;
  label: string;
  /** Entries in the scope, for the toggle. */
  count: number;
  kpis: DashboardKpis;
  survival: SurvivalStrip;
  distribution: DistributionView;
  carnage: CarnageView;
  standings: StandingsBar;
  chalk: ChalkRow[];
  scarcity: { rows: ScarcityRow[]; alive: number; throughWeek: number | null };
}

export interface ScopeInput {
  key: TeamsSourceKind;
  entries: EntrySummary[];
  cells: GridCell[];
  games: GameRow[];
  now: Date;
  /** The play week, or null before the season has one. */
  week: number | null;
  /** Her published Total in Pool for the pool; null falls back to the scope's count. */
  start: number | null;
  /**
   * Whether the scope holds a week's picks at all. Our own record always
   * does; her sheet only once it carries the week's column. A week that is
   * not published prints "not published yet" on every tile that would
   * otherwise read a zero off cells that do not exist.
   */
  weekPublished: (week: number) => boolean;
  /** The week's counts as the scope's own distribution produced them, or null with why. */
  distribution: {
    rows: { team: string; count: number; pct: number }[] | null;
    empty: DistributionView["empty"];
    caption: string;
    lockedAt: string | null;
  };
  /** Entry id to the week her sheet writes OUT on, for rows with no loss cell. */
  outWeeks?: Map<string, number>;
}

/**
 * The week her sheet writes OUT on, per row that is one of the pool's entries.
 * Only a revealed cell counts - a locked one reports absent - which is the
 * gate doing its job, not a gap.
 */
export function herOutWeeks(list: Pick<MasterList, "rows">): Map<string, number> {
  const columns = weekColumns(list.rows);
  const out = new Map<string, number>();
  for (const r of list.rows) {
    for (const col of columns) {
      const cell = herCell(r, col);
      if (cell !== undefined && /^\s*out\s*$/i.test(cell)) {
        out.set(poolEntryId(r), col.week);
        break;
      }
    }
  }
  return out;
}

export function dashboardScope(input: ScopeInput): ScopeData {
  const { key, entries, cells, games, now, week } = input;
  const results = teamResults(games);
  const revealedWeeks = fullyRevealedWeeks(games, now);
  const finals = (w: number) => games.filter((g) => g.week === w && g.status === "final").length;
  const scheduled = (w: number) => games.filter((g) => g.week === w).length;
  const kpis = dashboardKpis(entries, cells, results, week ?? 0, {
    anyFinal: week !== null && finals(week) > 0,
    // The chalk is a share, and a share over the revealed subset is wrong:
    // the tile waits for the whole week, exactly as the chalk card does.
    revealed: week !== null && revealedWeeks.includes(week),
    published: week !== null && input.weekPublished(week),
  });

  const points = survivalCurve(entries, cells, 7, input.outWeeks);
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  const survival: SurvivalStrip = {
    start: input.start ?? entries.length,
    remaining: kpis.alive,
    drop:
      before !== undefined
        ? {
            week: last.week,
            n: before.remaining - last.remaining,
            pct: before.remaining > 0 ? Math.round(((before.remaining - last.remaining) / before.remaining) * 100) : 0,
            // survivalCurve reaches a week at its FIRST final, so the drop is
            // the week so far until every game of it is final.
            partial: finals(last.week) < scheduled(last.week),
          }
        : null,
    points,
    chart: curveEarnsChart(points),
  };

  const d = input.distribution;
  const distribution: DistributionView = {
    week,
    rows: d.rows !== null && week !== null && d.rows.length > 0 ? distributionRows(d.rows, results, week) : null,
    empty: d.empty,
    caption: d.caption,
    lockedAt: d.lockedAt,
  };

  const cw = carnageWeek(games);
  const carnage: CarnageView =
    cw === null
      ? { state: "no final" }
      : !input.weekPublished(cw)
        ? { state: "unpublished", week: cw }
        : {
            state: "ready",
            ...weekCarnage(entries, cells, cw),
            finalGames: finals(cw),
            totalGames: scheduled(cw),
          };

  const b = { "No Losses": 0, "Loss/Bye": 0, Out: 0 };
  for (const e of entries) b[lynneBucket(e)] += 1;
  const alive = entries.length - b.Out;
  const standings: StandingsBar = {
    buckets: [
      { label: "No Losses", n: b["No Losses"] },
      { label: "Loss/Bye", n: b["Loss/Bye"] },
      { label: "Out", n: b.Out },
    ],
    total: entries.length,
    alive,
    // Her three labels either way. "We are down to" is the line Anthony
    // sends her about HIS entries (scripts/distribute/lib/standings.ts holds
    // the same template and tests/unit/distribute-message.test.ts reads this
    // one against it), so it is our group's wording only.
    sentence:
      key === "ours"
        ? `No Losses=${b["No Losses"]}, 1 Loss/Bye used=${b["Loss/Bye"]} and Out=${b.Out}. We are down to ${alive} left in the pool.`
        : `No Losses=${b["No Losses"].toLocaleString("en-US")}, 1 Loss/Bye used=${b["Loss/Bye"].toLocaleString("en-US")} and Out=${b.Out.toLocaleString("en-US")}. ${alive.toLocaleString("en-US")} left in the pool.`,
  };

  const scarcity = teamScarcity(
    entries,
    cells,
    revealedWeeks,
    NFL_TEAMS.map((t) => t.abbr),
  );
  const weeksWithCells = new Set(cells.map((c) => c.week));
  const throughWeek = revealedWeeks.filter((w) => weeksWithCells.has(w)).at(-1) ?? null;

  return {
    key,
    label: SCOPE_LABEL[key],
    count: entries.length,
    kpis,
    survival,
    distribution,
    carnage,
    standings,
    chalk: chalkByWeek(cells, results, revealedWeeks),
    scarcity: { ...scarcity, throughWeek },
  };
}
