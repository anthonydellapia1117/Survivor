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
 * team name are left out of the shares and counted separately.
 */
export function poolDistribution(
  rows: Pick<MasterRow, "cells">[],
  week: number,
): { rows: PoolDistributionRow[]; other: number } | null {
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
  return { rows: out, other };
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
  if (pot.poolPaidCount !== null) out.push({ label: "Total", value: pot.poolPaidCount.toLocaleString("en-US") });
  if (pot.poolPotCents !== null) out.push({ label: "Total Pay Out", value: formatCents(pot.poolPotCents) });
  return out;
}

/** Marks a row she has struck out: her cell reads OUT (any case). */
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
export function poolAsEntries(list: MasterList): { entries: EntrySummary[]; cells: GridCell[] } {
  const columns = weekColumns(list.rows);
  const entries: EntrySummary[] = [];
  const cells: GridCell[] = [];
  const at = list.loadedAt ?? "1970-01-01T00:00:00Z";
  for (const r of list.rows) {
    const used: string[] = [];
    for (const col of columns) {
      const team = herTeam(herCell(r, col));
      if (team === null) continue;
      used.push(team);
      cells.push({ entryId: `pool-${r.no}`, week: col.week, team, result: null, late: false, submittedAt: at, source: "master_list", resultSource: null });
    }
    entries.push({
      id: `pool-${r.no}`,
      entryName: `${r.no} ${r.names}`,
      nameIsDefault: false,
      ownerId: "",
      ownerName: "",
      wins: 0,
      losses: 0,
      livesRemaining: 2,
      status: herOut(r) ? "eliminated" : "active",
      byeUsed: false,
      teamsUsed: used,
      lastScoredWeek: null,
      isAdminEntry: r.entryId !== null,
    });
  }
  return { entries, cells };
}
