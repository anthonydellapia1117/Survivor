// The Master List: Lynne's whole pool as she publishes it, read from the
// newest sheet in lynne_roster. Pure helpers for the public pages - the
// table, its search, the week columns her sheet carries, the match of one
// of our entries' recorded pick against what she has, and the whole-pool
// pick distribution the dashboard defaults to.
//
// Her NAMES text is never trimmed or cased here. Her team vocabulary is
// mapped through fromLynneTeamName (case-insensitive, exact words); a cell
// that is not one of her team names ("OUT", a note) is kept as her text and
// never guessed at. Her per-entry rate is never computed: the four figures
// on the strip are hers, verbatim.

import {
  LOCKED_TEAM,
  type EntrySummary,
  type GameRow,
  type GridCell,
  type MasterListData,
  type MasterListRow,
  type PotSummary,
} from "@/lib/data/types";
import { fromLynneTeamName } from "@/lib/lynne/names";
import { formatCents } from "@/lib/pool";
import { SKIP_WEEK } from "@/lib/standing";

export type MasterRow = MasterListRow;
export type MasterList = MasterListData;

export interface WeekColumn {
  week: number;
  /** Her header text for it, so cells are read back under the same key. */
  key: string;
}

const WEEK_KEY = /^\s*(?:week|wk)\s*(\d{1,2})\s*$/i;

/** Her week headers, as she wrote them, in week order. "Week 1", "WEEK 18" and "Wk 3" all count. */
export function weekColumns(rows: Pick<MasterRow, "cells">[]): WeekColumn[] {
  const byWeek = new Map<number, string>();
  for (const r of rows) {
    for (const key of Object.keys(r.cells)) {
      const m = WEEK_KEY.exec(key);
      if (!m) continue;
      const week = Number(m[1]);
      if (!byWeek.has(week)) byWeek.set(week, key);
    }
  }
  return [...byWeek]
    .sort((a, b) => a[0] - b[0])
    .map(([week, key]) => ({ week, key }));
}

/**
 * Her columns plus a column for each week we hold a revealed pick in and she
 * has not published: our picks then have somewhere to sit. Her key wins for
 * a week she has; ours is labelled the plain way.
 */
export function mergeWeekColumns(hers: WeekColumn[], ourWeeks: number[]): WeekColumn[] {
  const byWeek = new Map<number, string>(hers.map((c) => [c.week, c.key]));
  for (const w of ourWeeks) if (!byWeek.has(w)) byWeek.set(w, `Week ${w}`);
  return [...byWeek].sort((a, b) => a[0] - b[0]).map(([week, key]) => ({ week, key }));
}

/** Her cell for a week, or undefined when she has left it blank. The column's key is tried first, then any key of the row that names the same week. */
export function herCell(row: Pick<MasterRow, "cells">, col: WeekColumn): string | undefined {
  let v = row.cells[col.key];
  if (v === undefined) {
    for (const [key, val] of Object.entries(row.cells)) {
      const m = WEEK_KEY.exec(key);
      if (m && Number(m[1]) === col.week) {
        v = val;
        break;
      }
    }
  }
  return v === undefined || v.trim() === "" ? undefined : v;
}

/** Her cell as an app team code when it is one of her team names, else null. */
export function herTeam(cell: string | undefined): string | null {
  return cell === undefined ? null : fromLynneTeamName(cell);
}

export type PickMatch =
  | { kind: "none" }
  /** She has the pick and we have no revealed pick for it. */
  | { kind: "hers" }
  /** We have a revealed pick and her cell is blank. */
  | { kind: "ours"; ours: string }
  /** Both present and the same team. */
  | { kind: "match"; team: string }
  /** Both present and different teams; reported, never resolved. */
  | { kind: "variance"; hers: string; ours: string }
  /** Her cell is text that is not a team ("OUT", a note) beside our pick. */
  | { kind: "text"; hers: string; ours: string };

/**
 * One of our entries' recorded pick for a week against her cell. A pick the
 * public view still masks (LOCKED) is treated as absent, so nothing here can
 * reveal a pick before its game. A bye is compared as the word she uses.
 */
export function matchPick(cell: string | undefined, ours: Pick<GridCell, "team"> | undefined): PickMatch {
  const ourTeam = ours && ours.team !== LOCKED_TEAM ? ours.team : undefined;
  if (cell === undefined && ourTeam === undefined) return { kind: "none" };
  if (cell === undefined) return { kind: "ours", ours: ourTeam! };
  if (ourTeam === undefined) return { kind: "hers" };
  const hers = herTeam(cell);
  if (ourTeam === SKIP_WEEK) {
    return /^\s*bye\s*$/i.test(cell) ? { kind: "match", team: SKIP_WEEK } : { kind: "text", hers: cell, ours: ourTeam };
  }
  if (hers === null) return { kind: "text", hers: cell, ours: ourTeam };
  return hers === ourTeam ? { kind: "match", team: ourTeam } : { kind: "variance", hers, ours: ourTeam };
}

/** Rows whose NO. starts with the query or whose NAMES contains it, case-insensitive; optionally ours only. */
export function filterRows<T extends Pick<MasterRow, "no" | "names" | "entryId">>(
  rows: T[],
  query: string,
  oursOnly: boolean,
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (oursOnly && r.entryId === null) return false;
    if (q === "") return true;
    if (/^\d+$/.test(q)) return String(r.no).startsWith(q);
    return r.names.toLowerCase().includes(q);
  });
}

export interface PoolDistributionRow {
  team: string;
  count: number;
  pct: number;
}

/** Whether her sheet carries any cell for the week. */
export function poolWeekFilled(rows: Pick<MasterRow, "cells">[], week: number): boolean {
  const col = weekColumns(rows).find((c) => c.week === week);
  return col !== undefined && rows.some((r) => herCell(r, col) !== undefined);
}

/**
 * The whole pool's picks for a week from her sheet: one count per team she
 * named, as a share of the cells that named a team. Cells that are not a
 * team name are left out of the shares and counted separately. `revealed`
 * is how many of her rows carry a cell for the week at all: the view serves
 * a cell only once its game has kicked off, so during a week with staggered
 * kickoffs this is the revealed subset, not the pool, and the caption has to
 * say so.
 */
export function poolDistribution(
  rows: Pick<MasterRow, "cells">[],
  week: number,
): { rows: PoolDistributionRow[]; other: number; revealed: number } | null {
  const col = weekColumns(rows).find((c) => c.week === week);
  if (!col) return null;
  const counts = new Map<string, number>();
  let total = 0;
  let other = 0;
  for (const r of rows) {
    const cell = herCell(r, col);
    if (cell === undefined) continue;
    const team = herTeam(cell);
    if (team === null) {
      other += 1;
      continue;
    }
    counts.set(team, (counts.get(team) ?? 0) + 1);
    total += 1;
  }
  if (total === 0 && other === 0) return null;
  const out = [...counts]
    .map(([team, count]) => ({ team, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
  return { rows: out, other, revealed: total + other };
}

export interface PoolStat {
  label: string;
  value: string;
}

/**
 * Her four figures for the strip, as published: no rate, no division. A
 * figure she has not given is left off rather than shown as zero.
 */
export function poolStats(pot: Pick<PotSummary, "poolEntryCount" | "poolFreeCount" | "poolPaidCount" | "poolPotCents">): PoolStat[] {
  const out: PoolStat[] = [];
  if (pot.poolEntryCount !== null) out.push({ label: "Total in Pool", value: pot.poolEntryCount.toLocaleString("en-US") });
  if (pot.poolFreeCount !== null) out.push({ label: "Free", value: pot.poolFreeCount.toLocaleString("en-US") });
  if (pot.poolPaidCount !== null) out.push({ label: "Total Paid", value: pot.poolPaidCount.toLocaleString("en-US") });
  if (pot.poolPotCents !== null) out.push({ label: "Total Payout", value: formatCents(pot.poolPotCents) });
  return out;
}

/**
 * Marks a row she has struck out: a week cell that reads OUT (any case).
 *
 * This is the only elimination marker the roster copy carries. Her other one,
 * the red fill on the NAMES cell, is not persisted by the master-sheet loader
 * (lynne_roster stores text only), so a row she has eliminated by fill alone
 * is scored here like any other row - a known undercount, tracked in #37.
 */
export function herOut(row: Pick<MasterRow, "cells">): boolean {
  return Object.values(row.cells).some((v) => /^\s*out\s*$/i.test(v));
}

/**
 * The whole pool in the shapes the Teams page renders for our group: one
 * entry per row of her sheet, its used teams read from her week cells. Only
 * cells that are one of her team names become picks; OUT marks the entry
 * eliminated; anything else is left alone. Ids are her NO., prefixed so they
 * can never collide with an entry id of ours.
 */
export function poolAsEntries(
  list: MasterList,
  /**
   * Optional game results. Given them, each of her published picks carries
   * its own win/loss/tie and the row's losses, bye and status are our second,
   * independent calculation. Omitted, the picks stay unscored - which is what
   * the Teams page wants, since it only reads which teams are used.
   */
  games: Parameters<typeof teamResults>[0] = [],
  doubleElimThrough = 7,
): { entries: EntrySummary[]; cells: GridCell[] } {
  const columns = weekColumns(list.rows);
  const results = teamResults(games);
  const entries: EntrySummary[] = [];
  const cells: GridCell[] = [];
  const at = list.loadedAt ?? "1970-01-01T00:00:00Z";
  for (const r of list.rows) {
    const used: string[] = [];
    let wins = 0;
    let losses = 0;
    let lastScoredWeek: number | null = null;
    // Her own entry id where the row is one of ours, so the Grid can link the
    // row to its real page; a synthetic id otherwise, which the Grid renders
    // without a link because no such page exists.
    const id = r.entryId ?? `pool-${r.no}`;
    for (const col of columns) {
      const cell = herCell(r, col);
      const team = herTeam(cell);
      if (team === null) {
        // A published BYE is a real week with a real state, and the legend
        // advertises it; dropping it left a blank where the grid should show
        // the bye. Other non-team text (OUT, a note) is still left alone.
        if (cell !== undefined && /^\s*bye\s*$/i.test(cell)) {
          cells.push({
            entryId: id,
            week: col.week,
            team: SKIP_WEEK,
            result: "bye",
            late: false,
            submittedAt: at,
            source: "master_list",
            resultSource: null,
          });
        }
        continue;
      }
      used.push(team);
      const scored = results.get(`${col.week}:${team}`);
      if (scored !== undefined) lastScoredWeek = col.week;
      if (scored === "win") wins += 1;
      if (scored === "loss" || scored === "tie") losses += 1;
      cells.push({
        entryId: id,
        week: col.week,
        team,
        // The real result, so a tie reads as a tie rather than as a win. It
        // still counts as a loss above, which is what tie_loss means.
        result:
          scored === undefined
            ? null
            : scored === "loss"
              ? "loss"
              : scored === "tie"
                ? "tie_loss"
                : "win",
        late: false,
        submittedAt: at,
        source: "master_list",
        resultSource: null,
      });
    }
    const bucket = poolBucketOf(r, results, columns, doubleElimThrough);
    entries.push({
      id,
      entryName: `${r.no} ${r.names}`,
      nameIsDefault: false,
      ownerId: "",
      ownerName: "",
      wins,
      losses,
      livesRemaining: Math.max(0, 2 - losses),
      status: bucket === "Out" ? "eliminated" : "active",
      byeUsed: herBye(r),
      teamsUsed: used,
      lastScoredWeek,
      isAdminEntry: r.entryId !== null,
    });
  }
  return { entries, cells };
}

/**
 * One entry's bucket in her words, for either pool. Our 121 carry their own
 * losses and bye from local scoring; her rows carry the ones poolAsEntries
 * computed. Same three labels either way, so the Grid's chips mean the same
 * thing whichever scope is showing.
 */
export function bucketOfEntry(e: Pick<EntrySummary, "status" | "losses" | "byeUsed">): PoolBucket {
  if (e.status === "eliminated") return "Out";
  return e.losses === 0 && !e.byeUsed ? "No Losses" : "1 Loss/Bye";
}

export type TeamsSourceKind = "pool" | "ours";

/**
 * Which pool the Teams page opens on. The Master List once her sheet is
 * loaded and carries a week pick; until she publishes a week, our group
 * stands in (CLAUDE.md, Public surfaces). The Master List stays selectable
 * whenever a sheet is loaded.
 */
export function defaultTeamsSource(poolLoaded: boolean, poolHasPicks: boolean): TeamsSourceKind {
  return poolLoaded && poolHasPicks ? "pool" : "ours";
}

// ---------------------------------------------------------------- standings
//
// The whole pool's standing, in her buckets. She is the authority on
// elimination in her pool (CLAUDE.md), so a row she has struck OUT is Out
// whatever our scores say; everything else is OUR second, independent
// calculation from her published picks and our game results. When her own
// stats block arrives with a weekly file, the two are shown side by side and
// any difference is reported, never resolved here.
//
// Her middle bucket is "1 LOSS/BYE" on the sheet, not "1 loss": a burned bye
// puts an entry there without a loss. The label follows her wording so the
// site, lynneBucket() and the stats she emails all count the same thing.

/**
 * A team's result in a week, from the final score.
 *
 * A tie is a LOSS in this pool, as it is everywhere else in this app: the
 * pick result is `tie_loss`, v_entry_public counts it in `losses`, and
 * standing.ts labels it "Tie (loss)". An earlier draft of this file treated a
 * tie as survival, which was invented rather than read off the rules.
 */
export type TeamResult = "win" | "loss" | "tie";

/**
 * (week, team) -> result, built once per render. A game counts only when it
 * is final and both scores are in; a scheduled or in-progress game leaves
 * both its teams absent, which reads as "not yet scored" rather than as a
 * loss.
 */
export function teamResults(games: Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">[]): Map<string, TeamResult> {
  const out = new Map<string, TeamResult>();
  for (const g of games) {
    if (g.status !== "final" || g.homeScore === null || g.awayScore === null) continue;
    const home: TeamResult = g.homeScore > g.awayScore ? "win" : g.homeScore < g.awayScore ? "loss" : "tie";
    const away: TeamResult = home === "win" ? "loss" : home === "loss" ? "win" : "tie";
    out.set(`${g.week}:${g.homeTeam}`, home);
    out.set(`${g.week}:${g.awayTeam}`, away);
  }
  return out;
}

/** Her cell for a week reads BYE. A burned bye is not a loss but does leave "No Losses". */
export function herBye(row: Pick<MasterRow, "cells">): boolean {
  return Object.values(row.cells).some((v) => /^\s*bye\s*$/i.test(v));
}

export type PoolBucket = "No Losses" | "1 Loss/Bye" | "Out";

export interface PoolStandings {
  noLosses: number;
  lossBye: number;
  out: number;
  /** Rows counted: every row of her newest sheet. */
  total: number;
  /** Highest week any of her published cells has been scored through. Null before Week 1 scores. */
  scoredThrough: number | null;
}

/**
 * One row's bucket. Only a scored loss or tie counts, so an unplayed or
 * unpublished week leaves the row where it was rather than moving it.
 */
export function poolBucketOf(
  row: Pick<MasterRow, "cells">,
  results: Map<string, TeamResult>,
  columns: WeekColumn[],
  doubleElimThrough: number,
): PoolBucket {
  if (herOut(row)) return "Out";
  let losses = 0;
  const used = new Set<string>();
  for (const col of columns) {
    const team = herTeam(herCell(row, col));
    if (team === null) continue;
    // A repeated team is an ELIMINATION in this pool, not a caution
    // (CLAUDE.md), and it eliminates whatever the repeated team's results
    // were - so it is checked before the results are.
    if (used.has(team)) return "Out";
    used.add(team);
    const r = results.get(`${col.week}:${team}`);
    // A tie counts here for the same reason it counts in v_entry_public.
    if (r !== "loss" && r !== "tie") continue;
    losses += 1;
    if (col.week > doubleElimThrough || losses >= 2) return "Out";
  }
  return losses === 0 && !herBye(row) ? "No Losses" : "1 Loss/Bye";
}

/** The three bucket counts across her whole sheet. */
export function poolStandings(
  list: Pick<MasterList, "rows">,
  games: Parameters<typeof teamResults>[0],
  doubleElimThrough = 7,
): PoolStandings {
  const columns = weekColumns(list.rows);
  const results = teamResults(games);
  let noLosses = 0;
  let lossBye = 0;
  let out = 0;
  for (const r of list.rows) {
    const bucket = poolBucketOf(r, results, columns, doubleElimThrough);
    if (bucket === "Out") out += 1;
    else if (bucket === "No Losses") noLosses += 1;
    else lossBye += 1;
  }
  let scoredThrough: number | null = null;
  for (const col of columns) {
    const scored = list.rows.some((r) => {
      const team = herTeam(herCell(r, col));
      return team !== null && results.has(`${col.week}:${team}`);
    });
    if (scored) scoredThrough = col.week;
  }
  return { noLosses, lossBye, out, total: list.rows.length, scoredThrough };
}

/**
 * Her published Total in Pool against the number of rows on her sheet.
 *
 * These are different quantities and can legitimately disagree, so neither is
 * corrected to the other (CLAUDE.md: report the variance, never auto-resolve).
 * On the 2026-09-08 sheet hers is 1,318 - her 1,320 NO.s less the two
 * duplicate Ian Lubin rows - while our copy holds 1,319, her 1,320 less the
 * row whose NO. cell reads "1311 Andrew Yukanis" and so carries no integer
 * NO. for the loader to key on. Null when they agree or when she has
 * published no total.
 */
export function countVariance(publishedTotal: number | null, sheetRows: number): string | null {
  if (publishedTotal === null || publishedTotal === sheetRows) return null;
  return `Her published total is ${publishedTotal.toLocaleString("en-US")}; this sheet carries ${sheetRows.toLocaleString("en-US")} rows. Both are shown as they stand.`;
}

/**
 * The week's picks as the one line Lynne sends by email: "7 picked Seattle
 * Seahawks, 1 picked LA Rams", biggest first. Derived from whatever cells
 * are in scope, so the Grid's toggle changes it rather than anyone typing a
 * tally in. Placeholder teams are not picks and are left out; null when the
 * week has no real pick yet.
 */
export function tallySentence(
  cells: Pick<GridCell, "week" | "team">[],
  week: number,
  teamName: (abbr: string) => string,
): string | null {
  const counts = new Map<string, number>();
  for (const c of cells) {
    if (c.week !== week || !countsInTally(c.team)) continue;
    counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([team, n]) => `${n} picked ${teamName(team)}`)
    .join(", ");
}

/** A cell that names a team. A bye, a miss and a pick the public view still masks are not picks to count. */
function countsInTally(team: string): boolean {
  return team !== SKIP_WEEK && team !== LOCKED_TEAM && team !== "MISSED";
}

/**
 * The week the tally describes: the latest week holding a pick that counts,
 * which is the latest week tallySentence() has anything to say about. A
 * future-week pick the public view still masks arrives as a LOCKED cell, so
 * "the highest week with any cell" would land on that week and the tally
 * would read as empty while the revealed week before it still had picks.
 */
export function tallyWeekOf(cells: Pick<GridCell, "week" | "team">[]): number | null {
  let latest: number | null = null;
  for (const c of cells) {
    if (!countsInTally(c.team)) continue;
    if (latest === null || c.week > latest) latest = c.week;
  }
  return latest;
}

/**
 * The Grid's standing filters. "Alive" is No Losses plus 1 Loss/Bye: "who is
 * still in" and "who is still clean" are different questions and both get
 * asked week to week, so both are their own chip.
 */
export type StandingFilter = "all" | "alive" | PoolBucket;

export const STANDING_FILTERS: StandingFilter[] = ["all", "alive", "No Losses", "1 Loss/Bye", "Out"];

export function matchesStanding(bucket: PoolBucket, filter: StandingFilter): boolean {
  if (filter === "all") return true;
  if (filter === "alive") return bucket !== "Out";
  return bucket === filter;
}

/** How many entries each chip would show, so its count moves with the scope. */
export function standingCounts(
  entries: Pick<EntrySummary, "status" | "losses" | "byeUsed">[],
): Record<StandingFilter, number> {
  const out: Record<StandingFilter, number> = {
    all: entries.length,
    alive: 0,
    "No Losses": 0,
    "1 Loss/Bye": 0,
    Out: 0,
  };
  for (const e of entries) {
    const bucket = bucketOfEntry(e);
    out[bucket] += 1;
    if (bucket !== "Out") out.alive += 1;
  }
  return out;
}
