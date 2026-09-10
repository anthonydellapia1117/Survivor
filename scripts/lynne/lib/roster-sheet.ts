// Lynne's master sheet, read for the lynne_roster reference table: every
// row with an integer NO. and a NAMES text, the NAMES cell verbatim, the
// filled week cells as she wrote them. Pure: a buffer in, rows out. Nothing
// here trims, cases or spells a name for her, and nothing here touches the
// database.

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export interface RosterRow {
  /** The sheet row, 1-based; the header is row 1. */
  row: number;
  /** Her NO. */
  no: number;
  /** Her NAMES cell verbatim, trailing spaces included. */
  names: string;
  /** Her filled week columns, header text to cell text. */
  cells: Record<string, string>;
}

export interface SkippedRow {
  row: number;
  reason: string;
}

export interface ParsedRosterSheet {
  sha256: string;
  sheetName: string;
  /** Rows below the header, filled or not. */
  rowCount: number;
  rows: RosterRow[];
  skipped: SkippedRow[];
  weekHeaders: string[];
}

function cellText(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return null;
  // `v` is the raw value: a string cell keeps its spaces, a number stays a number.
  return typeof cell.v === "string" ? cell.v : String(cell.v);
}

function cellNumber(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (typeof cell.v === "number") return Number.isInteger(cell.v) ? cell.v : null;
  if (typeof cell.v === "string" && /^\d+$/.test(cell.v.trim())) return Number(cell.v.trim());
  return null;
}

/**
 * Parse her NO./NAMES sheet. Throws when the first sheet does not lead with
 * NO. and NAMES, or when a NO. repeats: her NO. is the key of the reference
 * table and a repeat is hers to fix, never ours to guess around.
 */
export function parseRosterSheet(buf: Buffer | Uint8Array): ParsedRosterSheet {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) throw new Error("The workbook's first sheet is empty.");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const h0 = (cellText(ws, 0, 0) ?? "").trim();
  const h1 = (cellText(ws, 0, 1) ?? "").trim();
  if (!/^no\.?$/i.test(h0) || !/^names?$/i.test(h1)) {
    throw new Error(`Not her NO./NAMES layout: the header row reads ${JSON.stringify([h0, h1])}.`);
  }
  const headers: { col: number; text: string }[] = [];
  for (let c = 2; c <= range.e.c; c++) {
    const t = (cellText(ws, 0, c) ?? "").trim();
    if (t) headers.push({ col: c, text: t });
  }
  const rows: RosterRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<number, number>();
  for (let r = 1; r <= range.e.r; r++) {
    const no = cellNumber(ws, r, 0);
    const names = cellText(ws, r, 1);
    const sheetRow = r + 1;
    // A NAMES cell that is empty or only whitespace is no name. The test is
    // on a trimmed copy; the stored value stays verbatim, trailing spaces kept.
    const blank = names === null || names.trim() === "";
    if (no === null && blank) continue; // blank line
    if (no === null) {
      skipped.push({ row: sheetRow, reason: "no integer NO." });
      continue;
    }
    if (blank) {
      skipped.push({ row: sheetRow, reason: `NO. ${no} has no NAMES` });
      continue;
    }
    const first = seen.get(no);
    if (first !== undefined) {
      throw new Error(`NO. ${no} appears on sheet rows ${first} and ${sheetRow}; her NO. is the key and the sheet has to say which is which.`);
    }
    seen.set(no, sheetRow);
    const cells: Record<string, string> = {};
    for (const h of headers) {
      const v = cellText(ws, r, h.col);
      if (v !== null && v.trim() !== "") cells[h.text] = v;
    }
    rows.push({ row: sheetRow, no, names, cells });
  }
  if (rows.length === 0) {
    throw new Error(
      `No row with an integer NO. and a NAMES text below the header (${range.e.r} rows read, ${skipped.length} skipped). Nothing to load.`,
    );
  }
  return {
    sha256,
    sheetName,
    rowCount: range.e.r,
    rows,
    skipped,
    weekHeaders: headers.map((h) => h.text),
  };
}

export interface DuplicateName {
  /** The trimmed, case-folded key the rows share. */
  key: string;
  /** The NO.s carrying it, ascending. */
  nos: number[];
}

/** Names that repeat on the sheet, trimmed and case-insensitive. Reported, never merged. */
export function duplicateNames(rows: { no: number; names: string }[]): DuplicateName[] {
  const byKey = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.names.trim().toLowerCase();
    byKey.set(k, [...(byKey.get(k) ?? []), r.no]);
  }
  return [...byKey]
    .filter(([, nos]) => nos.length > 1)
    .map(([key, nos]) => ({ key, nos: [...nos].sort((a, b) => a - b) }))
    .sort((a, b) => a.nos[0] - b.nos[0]);
}

export interface RosterDiff {
  added: { no: number; names: string }[];
  removed: { no: number; names: string }[];
  /** Same NO., different NAMES text, byte for byte. */
  renamed: { no: number; before: string; after: string }[];
  unchanged: number;
}

/** The new sheet against the prior one, by NO. Byte-exact on NAMES: a trailing space she added is a change. */
export function diffRoster(prev: { no: number; names: string }[], next: { no: number; names: string }[]): RosterDiff {
  const before = new Map(prev.map((r) => [r.no, r.names]));
  const after = new Map(next.map((r) => [r.no, r.names]));
  const added = next.filter((r) => !before.has(r.no)).map((r) => ({ no: r.no, names: r.names }));
  const removed = prev.filter((r) => !after.has(r.no)).map((r) => ({ no: r.no, names: r.names }));
  const renamed: RosterDiff["renamed"] = [];
  let unchanged = 0;
  for (const r of next) {
    const b = before.get(r.no);
    if (b === undefined) continue;
    if (b === r.names) unchanged++;
    else renamed.push({ no: r.no, before: b, after: r.names });
  }
  const byNo = (a: { no: number }, b: { no: number }) => a.no - b.no;
  return { added: added.sort(byNo), removed: removed.sort(byNo), renamed: renamed.sort(byNo), unchanged };
}

/** The week a header names, or null. Mirrors lynne_cell_week() in SQL and the pattern in v_master_list. */
export function cellWeek(header: string): number | null {
  const m = /^\s*(?:week|wk)\s*(\d{1,2})\s*$/i.exec(header);
  return m ? Number(m[1]) : null;
}

export interface WeekCellChange {
  no: number;
  week: number;
  before: string | null;
  after: string | null;
}

export interface WeekCellDiff {
  /** A week she had not filled for this NO. and now has. */
  added: WeekCellChange[];
  /** A week she had filled and now leaves blank - reported, never acted on. */
  cleared: WeekCellChange[];
  /** A week whose value changed. Her correction, and the line worth reading. */
  changed: WeekCellChange[];
  unchanged: number;
}

/**
 * Her week cells, new sheet against prior, by NO. and week.
 *
 * Printed BEFORE anything is written, because a sheet of hers is loaded once
 * and never rewritten: if a week's column came back different, that is the
 * moment to look. Comparison is case-insensitive on a trimmed copy -- she
 * types "Seattle" and "SEATTLE" on different weeks and neither is a change --
 * while the value stored stays exactly what she wrote.
 *
 * A NO. only the prior sheet carries produces nothing here. Her sheet shrinks
 * as she deletes eliminated entries, and CLAUDE.md is explicit that a missing
 * entry is not a data error; the row diff already reports it as removed.
 */
export function diffWeekCells(
  prev: { no: number; cells: Record<string, string> }[],
  next: { no: number; cells: Record<string, string> }[],
): WeekCellDiff {
  const byWeek = (cells: Record<string, string>): Map<number, string> => {
    const out = new Map<number, string>();
    for (const [k, v] of Object.entries(cells)) {
      const w = cellWeek(k);
      if (w !== null && v.trim() !== "") out.set(w, v);
    }
    return out;
  };
  const before = new Map(prev.map((r) => [r.no, byWeek(r.cells)]));
  const added: WeekCellChange[] = [];
  const cleared: WeekCellChange[] = [];
  const changed: WeekCellChange[] = [];
  let unchanged = 0;
  for (const r of next) {
    const b = before.get(r.no);
    if (b === undefined) continue; // a NO. she has just added; the row diff has it
    const a = byWeek(r.cells);
    for (const w of new Set([...b.keys(), ...a.keys()])) {
      const bv = b.get(w) ?? null;
      const av = a.get(w) ?? null;
      if (bv === null && av !== null) added.push({ no: r.no, week: w, before: null, after: av });
      else if (bv !== null && av === null) cleared.push({ no: r.no, week: w, before: bv, after: null });
      else if (bv !== null && av !== null) {
        if (bv.trim().toLowerCase() === av.trim().toLowerCase()) unchanged++;
        else changed.push({ no: r.no, week: w, before: bv, after: av });
      }
    }
  }
  const order = (x: WeekCellChange, y: WeekCellChange) => x.no - y.no || x.week - y.week;
  return { added: added.sort(order), cleared: cleared.sort(order), changed: changed.sort(order), unchanged };
}

/** The rows the RPC takes: no, names verbatim, row, cells. */
export function rowsPayload(rows: RosterRow[]): { no: number; names: string; row: number; cells: Record<string, string> }[] {
  return rows.map((r) => ({ no: r.no, names: r.names, row: r.row, cells: r.cells }));
}
