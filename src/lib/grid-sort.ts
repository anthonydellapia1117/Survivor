// How the one table at /grid sorts. Pure, so the table only has to hold a key
// and a direction.
//
// Set by Anthony on 2026-09-11, when the Grid and the Master List became one
// page: every column header sorts on click - her NO., the name, and each week.
//
// Two rules the obvious implementation gets wrong, and both are what a reader
// actually wants:
//
//   * A BLANK SORTS LAST IN BOTH DIRECTIONS. Descending by Week 3 should put
//     the teams at the top, not the twelve hundred rows with no Week 3 cell.
//     A blank is the absence of a value, not a value below every other one.
//   * The sort is STABLE on her NO. Sorting by name, or by a week where three
//     hundred rows all read DET, leaves those rows in her numbering rather
//     than in whatever order the previous sort happened to leave them.

/** The columns that can be sorted on: her number, the name, or one week. */
export type SortKey = "no" | "name" | { week: number };

export type SortDir = "asc" | "desc";

/** What the table needs of a row to sort it. */
export interface SortableRow {
  /** Her NO., or null for a row that is not on her sheet. */
  no: number | null;
  /** What the Name column shows - her NAMES, or our entry name. */
  name: string;
  /** The team shown in each week, absent where the cell is empty. */
  teamByWeek: Map<number, string>;
}

/**
 * THE SORT KEY OF A WEEK IS WHAT THE CELL SHOWS.
 *
 * A row can have a team in a week from either of two places: her published
 * cell, or - where she has published nothing and we hold a revealed pick - our
 * own. The cell draws whichever exists, so the sort has to read both. Built
 * from her cells alone, a cell reading "BUF / ours" sorted as a blank and
 * landed among the twelve hundred genuinely empty rows.
 *
 * HER CELL WINS where both exist. That is the chip's main text; the "ours X"
 * beside it is the secondary value, and a variance must sort on what the
 * reader is looking at.
 */
export function weekKeys(
  hers: ReadonlyMap<number, string>,
  ours: ReadonlyMap<number, string>,
): Map<number, string> {
  const out = new Map<number, string>(ours);
  for (const [week, team] of hers) out.set(week, team);
  return out;
}

export function sameSortKey(a: SortKey, b: SortKey): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.week === b.week;
}

/** A stable id for a key, so it can sit in a React key or a data attribute. */
export function sortKeyId(k: SortKey): string {
  return typeof k === "string" ? k : `week:${k.week}`;
}

/**
 * Clicking a header: the same column flips direction, a new column starts
 * ascending. NO. is the one that starts ascending and stays the default,
 * which is what the page opens on.
 */
export function nextSort(
  current: { key: SortKey; dir: SortDir },
  clicked: SortKey,
): { key: SortKey; dir: SortDir } {
  if (sameSortKey(current.key, clicked)) {
    return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, dir: "asc" };
}

function valueOf(row: SortableRow, key: SortKey): string | number | null {
  if (key === "no") return row.no;
  if (key === "name") return row.name.trim() === "" ? null : row.name.trim().toLowerCase();
  return row.teamByWeek.get(key.week) ?? null;
}

/** Her numbering, which is the default order and the tiebreak under every other. */
function byNumber(a: SortableRow, b: SortableRow): number {
  if (a.no === b.no) return a.name.localeCompare(b.name);
  if (a.no === null) return 1;
  if (b.no === null) return -1;
  return a.no - b.no;
}

export function sortRows<T extends SortableRow>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = valueOf(a, key);
    const bv = valueOf(b, key);
    // A blank is last whichever way the column is pointing.
    if (av === null && bv === null) return byNumber(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return cmp === 0 ? byNumber(a, b) : cmp * sign;
  });
}
