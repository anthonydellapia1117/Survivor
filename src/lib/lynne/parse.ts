// Tolerant parser for Lynne's weekly files (.xlsx or .csv). Her format
// varies between weeks: the header row is detected, columns are mapped
// loosely, and unknown columns are ignored (spec 6.1).

import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { NFL_TEAMS, TEAM_NAME } from "@/lib/standing";

export interface LynneRow {
  /** Entry label exactly as it appears in her file. */
  entry: string;
  /** Team normalized to an NFL abbreviation when recognizable, else raw. */
  team: string | null;
  /** Result normalized to win|loss|tie_loss|bye, else null. */
  result: string | null;
  rowIndex: number;
  /** Her NO. for the row — grid-format files only. */
  no?: number | null;
}

export interface ParsedLynneFile {
  rows: LynneRow[];
  headerRowIndex: number | null;
  columns: { entry: number; team: number | null; result: number | null };
  sha256: string;
  sheetName: string;
}

const ENTRY_HEADER = /entry|name|player|label/i;
const TEAM_HEADER = /team|pick|selection/i;
const RESULT_HEADER = /result|outcome|w\s*\/\s*l|status|win/i;

const NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  NFL_TEAMS.map((t) => [t.name.toLowerCase(), t.abbr]),
);
// Common short names ("Jaguars", "49ers", "Niners", city names).
const EXTRA_ALIASES: Record<string, string> = {};
for (const t of NFL_TEAMS) {
  const parts = t.name.split(" ");
  const nickname = parts[parts.length - 1].toLowerCase();
  EXTRA_ALIASES[nickname] = t.abbr;
  const city = parts.slice(0, -1).join(" ").toLowerCase();
  if (!(city in EXTRA_ALIASES)) EXTRA_ALIASES[city] = t.abbr;
}
EXTRA_ALIASES["niners"] = "SF";
EXTRA_ALIASES["jags"] = "JAX";
EXTRA_ALIASES["pats"] = "NE";
EXTRA_ALIASES["skins"] = "WAS";
EXTRA_ALIASES["commanders"] = "WAS";
// Alternate abbreviation conventions.
const ABBR_ALIASES: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
  LVR: "LV",
  SFO: "SF",
  TAM: "TB",
  GNB: "GB",
  KAN: "KC",
  NOR: "NO",
  NWE: "NE",
};

export function normalizeTeam(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === "BYE" || upper === "SKIP" || upper === "SKIP_WEEK") {
    return "SKIP_WEEK";
  }
  if (upper in TEAM_NAME) return upper;
  if (upper in ABBR_ALIASES) return ABBR_ALIASES[upper];
  const lower = s.toLowerCase();
  if (lower in NAME_TO_ABBR) return NAME_TO_ABBR[lower];
  if (lower in EXTRA_ALIASES) return EXTRA_ALIASES[lower];
  return null;
}

export function normalizeResult(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["w", "win", "won", "winner"].includes(s)) return "win";
  if (["l", "loss", "lost", "lose", "loser", "out"].includes(s)) return "loss";
  if (["t", "tie", "tied", "tie-loss", "tie loss", "tie_loss"].includes(s)) {
    return "tie_loss";
  }
  if (["bye", "skip", "skipped"].includes(s)) return "bye";
  return null;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Parse a Lynne file. Detects the header row by scanning for entry/team
 * patterns in the first 12 rows; falls back to positional columns
 * (entry, team, result) when no header row is present.
 */
export function parseLynneFile(
  buf: Buffer | Uint8Array,
  filename: string,
): ParsedLynneFile {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  let headerRowIndex: number | null = null;
  let cols: { entry: number; team: number | null; result: number | null } = {
    entry: 0,
    team: 1,
    result: 2,
  };

  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const row = grid[i].map(cellText);
    const entryCol = row.findIndex((c) => ENTRY_HEADER.test(c));
    const teamCol = row.findIndex((c) => TEAM_HEADER.test(c));
    if (entryCol >= 0 && teamCol >= 0 && entryCol !== teamCol) {
      const resultCol = row.findIndex(
        (c, idx) => idx !== entryCol && idx !== teamCol && RESULT_HEADER.test(c),
      );
      headerRowIndex = i;
      cols = {
        entry: entryCol,
        team: teamCol,
        result: resultCol >= 0 ? resultCol : null,
      };
      break;
    }
  }

  const startRow = headerRowIndex === null ? 0 : headerRowIndex + 1;
  const rows: LynneRow[] = [];
  for (let i = startRow; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const entry = cellText(row[cols.entry]);
    if (!entry) continue;
    const teamRaw = cols.team !== null ? cellText(row[cols.team]) : "";
    const resultRaw = cols.result !== null ? cellText(row[cols.result]) : "";
    // Headerless fallback: a row that itself looks like a header is skipped.
    if (
      headerRowIndex === null &&
      i === 0 &&
      ENTRY_HEADER.test(entry) &&
      teamRaw !== "" &&
      normalizeTeam(teamRaw) === null &&
      TEAM_HEADER.test(teamRaw)
    ) {
      continue;
    }
    rows.push({
      entry,
      team: teamRaw ? (normalizeTeam(teamRaw) ?? teamRaw.toUpperCase()) : null,
      result: resultRaw ? normalizeResult(resultRaw) : null,
      rowIndex: i,
    });
  }

  void filename;
  return { rows, headerRowIndex, columns: cols, sha256, sheetName };
}
