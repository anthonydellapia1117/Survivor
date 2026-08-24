// Matching and comparison for the grid-format weekly import.
//
// Her sheet lists the WHOLE pool (~1,200 entries), not just ours, so
// unmatched rows are expected — they are other people's entries and are
// counted, never flagged. Ours are found by her NO. first (our stored
// lynne_number), with the name required to agree; then by exact name,
// then case-insensitive name. NEVER fuzzy. A number whose name disagrees
// is a conflict for human review, not a guess.
//
// Nothing here is ever auto-applied: the plan produces variances and
// counts only. Results come from the scores engine, not her grid.

import type { GridEntryRow } from "./parse-grid";
import type { Variance } from "./compare";
import { fromLynneTeamName } from "./names";
import { normalizeTeam } from "./parse";

export interface GridTarget {
  id: string;
  entryName: string;
  lynneLabel: string | null;
  lynneNumber: number | null;
  /** Public standing status: active | at_risk | bye_eligible | eliminated. */
  status: string;
}

export type GridMatchedBy =
  | "lynne_number"
  | "lynne_label"
  | "entry_name"
  | "entry_name_ci";

export interface GridMatch {
  row: GridEntryRow;
  entryId: string;
  matchedBy: GridMatchedBy;
  /** Set when her sheet carries a NO. we do not have on file for this entry. */
  numberOnSheetNotOnFile: number | null;
}

export interface GridConflict {
  row: GridEntryRow;
  reason: "number_name_disagree" | "duplicate_number_in_sheet";
  /** The entry our lynne_number points at, when applicable. */
  entryId: string | null;
  entryName: string | null;
}

export interface GridMatchResult {
  matched: GridMatch[];
  conflicts: GridConflict[];
  /** Our non-voided entries with no row in her sheet. */
  missing: GridTarget[];
  /** Rows that are other people's entries in her pool. Counted only. */
  otherPoolCount: number;
}

function nameAgrees(row: GridEntryRow, t: GridTarget): boolean {
  if (t.lynneLabel !== null && row.name === t.lynneLabel) return true;
  if (row.name === t.entryName) return true;
  return row.name.toLowerCase() === t.entryName.toLowerCase();
}

export function matchGridRows(
  rows: GridEntryRow[],
  targets: GridTarget[],
): GridMatchResult {
  const byNumber = new Map<number, GridTarget>();
  const byLabel = new Map<string, GridTarget[]>();
  const byName = new Map<string, GridTarget[]>();
  const byNameCi = new Map<string, GridTarget[]>();
  for (const t of targets) {
    if (t.lynneNumber !== null) byNumber.set(t.lynneNumber, t);
    if (t.lynneLabel !== null) {
      byLabel.set(t.lynneLabel, [...(byLabel.get(t.lynneLabel) ?? []), t]);
    }
    byName.set(t.entryName, [...(byName.get(t.entryName) ?? []), t]);
    const ci = t.entryName.toLowerCase();
    byNameCi.set(ci, [...(byNameCi.get(ci) ?? []), t]);
  }

  const matched: GridMatch[] = [];
  const conflicts: GridConflict[] = [];
  const claimed = new Set<string>();
  const numbersSeen = new Set<number>();
  let otherPoolCount = 0;

  for (const row of rows) {
    const numberTarget = byNumber.get(row.no);
    if (numberTarget) {
      if (numbersSeen.has(row.no)) {
        conflicts.push({
          row,
          reason: "duplicate_number_in_sheet",
          entryId: numberTarget.id,
          entryName: numberTarget.entryName,
        });
        continue;
      }
      numbersSeen.add(row.no);
      if (nameAgrees(row, numberTarget)) {
        matched.push({
          row,
          entryId: numberTarget.id,
          matchedBy: "lynne_number",
          numberOnSheetNotOnFile: null,
        });
        claimed.add(numberTarget.id);
      } else {
        conflicts.push({
          row,
          reason: "number_name_disagree",
          entryId: numberTarget.id,
          entryName: numberTarget.entryName,
        });
      }
      continue;
    }

    // Name path (row's number is not one of ours, or we have none stored).
    const viaLabel = byLabel.get(row.name);
    const viaName = byName.get(row.name);
    const viaCi = byNameCi.get(row.name.toLowerCase());
    let hit: { t: GridTarget; by: GridMatchedBy } | null = null;
    if (viaLabel && viaLabel.length === 1) {
      hit = { t: viaLabel[0], by: "lynne_label" };
    } else if (viaName && viaName.length === 1) {
      hit = { t: viaName[0], by: "entry_name" };
    } else if (viaCi && viaCi.length === 1) {
      hit = { t: viaCi[0], by: "entry_name_ci" };
    }
    if (hit && !claimed.has(hit.t.id)) {
      matched.push({
        row,
        entryId: hit.t.id,
        matchedBy: hit.by,
        numberOnSheetNotOnFile:
          hit.t.lynneNumber === null || hit.t.lynneNumber !== row.no
            ? row.no
            : null,
      });
      claimed.add(hit.t.id);
      continue;
    }

    // Someone else's entry in her pool of ~1,200 — expected, not an error.
    otherPoolCount++;
  }

  const missing = targets.filter((t) => !claimed.has(t.id));
  return { matched, conflicts, missing, otherPoolCount };
}

export interface GridLocalPick {
  entryId: string;
  team: string;
  result: string | null;
}

export interface GridPlan {
  variances: Variance[];
  /** Matched rows whose target-week team agrees with the local pick. */
  teamAgreements: number;
  /** OUT on her sheet and eliminated locally, in agreement. */
  statusAgreements: number;
  /** Ours missing from her sheet AND eliminated locally — her normal
   *  deletion of dead entries, confirmation not error. */
  confirmedRemovals: number;
  /** Rows where neither side has a pick for the week yet. */
  quietRows: number;
}

/** Normalize a week cell through her vocabulary first, generic second. */
export function normalizeGridTeam(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (upper === "BYE") return "SKIP_WEEK";
  return fromLynneTeamName(raw) ?? normalizeTeam(raw);
}

export function computeGridPlan(
  matched: GridMatch[],
  missing: GridTarget[],
  week: number,
  localPicks: GridLocalPick[],
  targets: GridTarget[],
): GridPlan {
  const local = new Map(localPicks.map((p) => [p.entryId, p]));
  const targetById = new Map(targets.map((t) => [t.id, t]));
  const plan: GridPlan = {
    variances: [],
    teamAgreements: 0,
    statusAgreements: 0,
    confirmedRemovals: 0,
    quietRows: 0,
  };

  for (const m of matched) {
    const t = targetById.get(m.entryId);
    if (!t) continue;
    const raw = m.row.cells[week];
    const sheetSaysOut =
      m.row.fill === "red" || raw?.trim().toUpperCase() === "OUT";
    const localOut = t.status === "eliminated";
    const lp = local.get(m.entryId);

    if (sheetSaysOut || localOut) {
      if (sheetSaysOut && localOut) {
        plan.statusAgreements++;
      } else {
        plan.variances.push({
          type: "status_conflict",
          entryId: m.entryId,
          entryName: t.entryName,
          lynne: {
            team: raw ?? null,
            result: sheetSaysOut ? "out" : "listed alive",
          },
          local: { team: lp?.team ?? null, result: localOut ? "eliminated" : "alive" },
        });
      }
      continue;
    }

    // Both sides alive.
    if (raw === undefined) {
      if (lp) {
        plan.variances.push({
          type: "missing_on_sheet",
          entryId: m.entryId,
          entryName: t.entryName,
          lynne: { team: null, result: null },
          local: { team: lp.team, result: lp.result },
        });
      } else {
        plan.quietRows++;
      }
      continue;
    }

    const team = normalizeGridTeam(raw);
    if (team === null) {
      plan.variances.push({
        type: "unreadable_team",
        entryId: m.entryId,
        entryName: t.entryName,
        lynne: { team: raw, result: null },
        local: { team: lp?.team ?? null, result: lp?.result ?? null },
      });
      continue;
    }

    if (!lp) {
      plan.variances.push({
        type: "no_local_pick",
        entryId: m.entryId,
        entryName: t.entryName,
        lynne: { team, result: null },
        local: { team: null, result: null },
      });
    } else if (team === lp.team) {
      plan.teamAgreements++;
    } else {
      plan.variances.push({
        type: "team_mismatch",
        entryId: m.entryId,
        entryName: t.entryName,
        lynne: { team, result: null },
        local: { team: lp.team, result: lp.result },
      });
    }
  }

  for (const t of missing) {
    if (t.status === "eliminated") {
      plan.confirmedRemovals++;
    } else {
      plan.variances.push({
        type: "absent_but_alive",
        entryId: t.id,
        entryName: t.entryName,
        lynne: { team: null, result: "not in her sheet" },
        local: {
          team: local.get(t.id)?.team ?? null,
          result: t.status,
        },
      });
    }
  }

  return plan;
}
