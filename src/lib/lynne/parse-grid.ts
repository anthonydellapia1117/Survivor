// Parser for Lynne's real working sheet — the NO./NAMES grid format
// verified against her final 2025 file (Football_2025-54.xlsx) and ported
// from scripts/archive/parse-2025.py:
//
//   NO. | NAMES | Week 1 | Week 2 | ... (mixed-case week headers)
//
//   - Only rows with an integer NO. and a string NAMES are entries.
//   - Status lives in the FILL COLOR of the NAMES cell: FF0000 red = OUT,
//     FFFF00 yellow = winner (season end). Alive entries mid-season have
//     no fill. Read with cellStyles, never values-only.
//   - BYE and OUT appear as literal cell values in week columns.
//   - She DELETES eliminated entries week to week, so the sheet shrinks.
//     A missing entry is NOT a data error.
//   - Her stats block (NO LOSSES / 1 LOSS/BYE / OUT rows below the grid)
//     is captured when present — her own bucket counts, for cross-check.

import * as XLSX from "xlsx-js-style";
import { createHash } from "node:crypto";

export type GridFill = "red" | "yellow" | "none" | "other";

export interface GridEntryRow {
  /** Her number, from the NO. column. */
  no: number;
  /** NAMES cell verbatim (trimmed). */
  name: string;
  fill: GridFill;
  /** Raw fill descriptor when fill is "other", for the preview. */
  fillRaw: string | null;
  /** week -> raw trimmed cell text; absent when the cell is empty. */
  cells: Record<number, string>;
  /** 1-based sheet row. */
  rowIndex: number;
}

export interface HerWeekCounts {
  noLosses: number | null;
  lossBye: number | null;
  out: number | null;
}

export interface ParsedLynneGrid {
  format: "grid";
  sha256: string;
  sheetName: string;
  /** Week numbers present as columns, ascending. */
  weeks: number[];
  rows: GridEntryRow[];
  /** Highest week column where any entry row has a non-empty cell. */
  latestFilledWeek: number | null;
  /** Her stats block, when present: week -> her bucket counts. */
  herCounts: Record<number, HerWeekCounts>;
  /** Header cells past NAMES that were not Week N (ignored, reported). */
  ignoredColumns: string[];
  /** Physical rows that were neither entries nor stats (blank, labels). */
  skippedRows: number;
}

function cellString(ws: XLSX.WorkSheet, r: number, c: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === null || cell.v === undefined) return "";
  return String(cell.w ?? cell.v).trim();
}

function cellNumber(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return null;
  if (cell.t === "n" && typeof cell.v === "number") return cell.v;
  return null;
}

function readFill(ws: XLSX.WorkSheet, r: number, c: number): {
  fill: GridFill;
  raw: string | null;
} {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as
    | (XLSX.CellObject & {
        s?: {
          patternType?: string;
          fgColor?: { rgb?: string; theme?: number };
        };
      })
    | undefined;
  const s = cell?.s;
  if (!s || !s.patternType || s.patternType === "none") {
    return { fill: "none", raw: null };
  }
  const rgb = s.fgColor?.rgb;
  if (typeof rgb === "string") {
    // ARGB or RGB; compare on the last 6 hex digits.
    const hex = rgb.toUpperCase().slice(-6);
    if (hex === "FF0000") return { fill: "red", raw: rgb };
    if (hex === "FFFF00") return { fill: "yellow", raw: rgb };
    return { fill: "other", raw: rgb };
  }
  if (typeof s.fgColor?.theme === "number") {
    return { fill: "other", raw: `theme:${s.fgColor.theme}` };
  }
  return { fill: "other", raw: "unknown" };
}

/**
 * Parse a workbook in her grid format. Returns null when the sheet does not
 * lead with NO./NAMES headers — the caller falls back to the legacy
 * tolerant parser (older files, hand-made CSVs).
 */
export function parseLynneGrid(
  buf: Buffer | Uint8Array,
): ParsedLynneGrid | null {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellStyles: true });
  } catch {
    return null;
  }
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) return null;
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Header row: NO. then NAMES, exactly her layout (case-insensitive).
  if (!/^no\.?$/i.test(cellString(ws, 0, 0))) return null;
  if (!/^names?$/i.test(cellString(ws, 0, 1))) return null;

  // Week columns, mixed case ("Week 4", "WEEK 5"), anywhere past NAMES.
  const weekCols = new Map<number, number>();
  const ignoredColumns: string[] = [];
  for (let c = 2; c <= range.e.c; c++) {
    const h = cellString(ws, 0, c);
    if (!h) continue;
    const m = /^week\s*(\d+)$/i.exec(h);
    if (m) {
      const wk = Number(m[1]);
      if (!weekCols.has(wk)) weekCols.set(wk, c);
    } else {
      ignoredColumns.push(h);
    }
  }
  if (weekCols.size === 0) return null;

  const rows: GridEntryRow[] = [];
  const herCounts: Record<number, HerWeekCounts> = {};
  let statsFound: { noLosses?: number; lossBye?: number; out?: number } = {};
  let skippedRows = 0;

  for (let r = 1; r <= range.e.r; r++) {
    const no = cellNumber(ws, r, 0);
    const name = cellString(ws, r, 1);

    if (no !== null && Number.isInteger(no) && name !== "") {
      const { fill, raw } = readFill(ws, r, 1);
      const cells: Record<number, string> = {};
      for (const [wk, c] of weekCols) {
        const v = cellString(ws, r, c);
        if (v !== "") cells[wk] = v;
      }
      rows.push({ no, name, fill, fillRaw: raw, cells, rowIndex: r + 1 });
      continue;
    }

    // Her stats block: labels in the NAMES column, no NO. value.
    if (no === null && name !== "") {
      if (/^no\s+losses$/i.test(name)) {
        statsFound = { ...statsFound, noLosses: r };
        continue;
      }
      if (/^1\s+loss/i.test(name)) {
        statsFound = { ...statsFound, lossBye: r };
        continue;
      }
      if (/^out$/i.test(name)) {
        statsFound = { ...statsFound, out: r };
        continue;
      }
    }
    skippedRows++;
  }

  for (const [wk, c] of weekCols) {
    const counts: HerWeekCounts = {
      noLosses:
        statsFound.noLosses !== undefined
          ? cellNumber(ws, statsFound.noLosses, c)
          : null,
      lossBye:
        statsFound.lossBye !== undefined
          ? cellNumber(ws, statsFound.lossBye, c)
          : null,
      out: statsFound.out !== undefined ? cellNumber(ws, statsFound.out, c) : null,
    };
    if (counts.noLosses !== null || counts.lossBye !== null || counts.out !== null) {
      herCounts[wk] = counts;
    }
  }

  const weeks = [...weekCols.keys()].sort((a, b) => a - b);
  let latestFilledWeek: number | null = null;
  for (const wk of weeks) {
    if (rows.some((row) => wk in row.cells)) latestFilledWeek = wk;
  }

  return {
    format: "grid",
    sha256,
    sheetName,
    weeks,
    rows,
    latestFilledWeek,
    herCounts,
    ignoredColumns,
    skippedRows,
  };
}
