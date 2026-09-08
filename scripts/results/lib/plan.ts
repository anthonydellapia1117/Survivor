// Parse Lynne's file and plan the import exactly the way /admin/import does
// (lynneImportPreviewAction in src/app/admin/actions.ts). Pure given the
// loaded rows, so it can be tested without Gmail or the database.
//
// Two paths, decided by the file:
//   grid   - her real NO./NAMES sheet. Results are NEVER applied here; the
//            grid carries no per-week results and the scores engine owns
//            them. The plan is variances and counts only.
//   legacy - an older per-week file with entry/team/result columns. A
//            result IS applied, but only where her row agrees with the local
//            pick and carries a result; anything else is a variance.
//
// Matching is exact, then case-insensitive, never fuzzy. A variance is
// recorded with both values and decided by nobody here.

import { createHash } from "node:crypto";
import { computeImportPlan, type Apply, type Variance } from "@/lib/lynne/compare";
import { matchRows } from "@/lib/lynne/match";
import { parseLynneFile, type LynneRow } from "@/lib/lynne/parse";
import { parseLynneGrid, type GridEntryRow, type HerWeekCounts } from "@/lib/lynne/parse-grid";
import {
  computeGridPlan,
  matchGridRows,
  normalizeGridTeam,
  type GridLocalPick,
  type GridTarget,
} from "@/lib/lynne/plan-grid";
import type { CurrentPickRow, EntryRow, StandingRow } from "../../lib/db";

export interface PlanInput {
  buf: Buffer;
  filename: string;
  week: number;
  entries: EntryRow[];
  standings: StandingRow[];
  localPicks: CurrentPickRow[];
}

/** A row of her sheet whose NO. points at one of ours but names someone else. */
export interface ConflictSummary {
  no: number;
  name: string;
  reason: string;
  /** The entry our lynne_number points at. */
  entryName: string | null;
}

/** Her sheet carries a NO. for one of ours that we do not have on file. */
export interface NumberSuggestion {
  entryName: string;
  sheetNo: number;
}

interface PlanBase {
  sha256: string;
  /** What lynne_imports.rows will hold. On the grid path, only OUR rows. */
  rows: LynneRow[];
  rowCount: number;
  matchedCount: number;
  /** matchedBy -> count, in first-seen order. */
  matchedBy: Record<string, number>;
  unmatched: LynneRow[];
  variances: Variance[];
  applies: Apply[];
}

export interface GridResultsPlan extends PlanBase {
  format: "grid";
  conflicts: ConflictSummary[];
  numberSuggestions: NumberSuggestion[];
  /** Ours with no row in her sheet, split below. */
  missingCount: number;
  confirmedRemovals: number;
  absentButAlive: number;
  otherPoolCount: number;
  teamAgreements: number;
  statusAgreements: number;
  quietRows: number;
  weeksInFile: number[];
  latestFilledWeek: number | null;
  herCounts: HerWeekCounts | null;
  noFillInfo: boolean;
}

export interface LegacyResultsPlan extends PlanBase {
  format: "legacy";
  alreadyApplied: number;
  noResultYet: number;
}

export type ResultsPlan = GridResultsPlan | LegacyResultsPlan;

export function sha256Of(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function breakdown(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

export function buildResultsPlan(input: PlanInput): ResultsPlan {
  const { buf, filename, week } = input;
  const entries = input.entries.filter((e) => e.voided_at === null);
  const localPicks: GridLocalPick[] = input.localPicks.map((p) => ({
    entryId: p.entry_id,
    team: p.team,
    result: p.result,
  }));
  const names = new Map(entries.map((e) => [e.id, e.entry_name]));

  // Her real format first: the NO./NAMES grid with fill-colour status.
  const grid = parseLynneGrid(buf);
  if (grid) {
    if (!grid.weeks.includes(week)) {
      throw new Error(
        `Her sheet has no Week ${week} column (it has ${grid.weeks.map((w) => `Week ${w}`).join(", ")}).`,
      );
    }
    const statusById = new Map(input.standings.map((s) => [s.entry_id, s.status]));
    const targets: GridTarget[] = entries.map((e) => ({
      id: e.id,
      entryName: e.entry_name,
      lynneLabel: e.lynne_label,
      lynneNumber: e.lynne_number,
      status: statusById.get(e.id) ?? "active",
    }));
    const { matched, conflicts, missing, otherPoolCount } = matchGridRows(grid.rows, targets);
    const plan = computeGridPlan(matched, missing, week, localPicks, targets);

    const toRow = (r: GridEntryRow): LynneRow => {
      const raw = r.cells[week];
      return {
        entry: r.name,
        team: raw ? (normalizeGridTeam(raw) ?? raw) : null,
        result: r.fill === "red" || raw?.toUpperCase() === "OUT" ? "out" : null,
        rowIndex: r.rowIndex,
        no: r.no,
      };
    };
    // Store only OUR rows (matched + conflicts): her sheet holds the whole
    // pool and the rest is not ours to keep. rowCount records the true size.
    const rows = [...matched.map((m) => toRow(m.row)), ...conflicts.map((c) => toRow(c.row))];
    const absentButAlive = plan.variances.filter((v) => v.type === "absent_but_alive").length;

    return {
      format: "grid",
      sha256: grid.sha256,
      rows,
      rowCount: rows.length + otherPoolCount,
      matchedCount: matched.length,
      matchedBy: breakdown(matched.map((m) => m.matchedBy)),
      unmatched: conflicts.map((c) => toRow(c.row)),
      variances: plan.variances,
      // The grid carries no per-week results; the scores engine owns them.
      applies: [],
      conflicts: conflicts.map((c) => ({
        no: c.row.no,
        name: c.row.name,
        reason: c.reason,
        entryName: c.entryName,
      })),
      numberSuggestions: matched.flatMap((m) =>
        m.numberOnSheetNotOnFile === null
          ? []
          : [{ entryName: names.get(m.entryId) ?? m.row.name, sheetNo: m.numberOnSheetNotOnFile }],
      ),
      missingCount: missing.length,
      confirmedRemovals: plan.confirmedRemovals,
      absentButAlive,
      otherPoolCount,
      teamAgreements: plan.teamAgreements,
      statusAgreements: plan.statusAgreements,
      quietRows: plan.quietRows,
      weeksInFile: grid.weeks,
      latestFilledWeek: grid.latestFilledWeek,
      herCounts: grid.herCounts[week] ?? null,
      noFillInfo: grid.rows.every((r) => r.fill === "none"),
    };
  }

  // Legacy tolerant path (older files, hand-made CSVs).
  const parsed = parseLynneFile(buf, filename);
  const { matched, unmatched } = matchRows(
    parsed.rows,
    entries.map((e) => ({ id: e.id, entryName: e.entry_name, lynneLabel: e.lynne_label })),
  );
  const plan = computeImportPlan(matched, localPicks, names);
  return {
    format: "legacy",
    sha256: parsed.sha256,
    rows: parsed.rows,
    rowCount: parsed.rows.length,
    matchedCount: matched.length,
    matchedBy: breakdown(matched.map((m) => m.matchedBy)),
    unmatched,
    variances: plan.variances,
    applies: plan.applies,
    alreadyApplied: plan.alreadyApplied,
    noResultYet: plan.noResultYet,
  };
}
