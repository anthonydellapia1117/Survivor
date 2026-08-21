// Compare matched Lynne rows against local state (spec 6.1 step 5).
// Any disagreement is a VARIANCE — reported, stored, never auto-resolved.
// Only matched rows that agree with the local pick produce result applies.

import type { MatchedRow } from "./match";

export interface LocalPick {
  entryId: string;
  team: string;
  result: string | null;
}

export interface Variance {
  type: "team_mismatch" | "no_local_pick" | "result_conflict";
  entryId: string;
  entryName: string;
  lynne: { team: string | null; result: string | null };
  local: { team: string | null; result: string | null };
}

export interface Apply {
  entry_id: string;
  result: string;
}

export interface ImportPlan {
  applies: Apply[];
  variances: Variance[];
  /** Matched rows already in agreement with a final local result. */
  alreadyApplied: number;
  /** Matched rows carrying no result yet (her file lists picks only). */
  noResultYet: number;
}

export function computeImportPlan(
  matched: MatchedRow[],
  localPicks: LocalPick[],
  entryNames: Map<string, string>,
): ImportPlan {
  const local = new Map(localPicks.map((p) => [p.entryId, p]));
  const plan: ImportPlan = {
    applies: [],
    variances: [],
    alreadyApplied: 0,
    noResultYet: 0,
  };

  for (const m of matched) {
    const name = entryNames.get(m.entryId) ?? m.row.entry;
    const lp = local.get(m.entryId);

    if (!lp) {
      plan.variances.push({
        type: "no_local_pick",
        entryId: m.entryId,
        entryName: name,
        lynne: { team: m.row.team, result: m.row.result },
        local: { team: null, result: null },
      });
      continue;
    }

    // Team comparison: only when her file names a team. A bye on both sides
    // (SKIP_WEEK) compares like any team.
    if (m.row.team && m.row.team !== lp.team) {
      plan.variances.push({
        type: "team_mismatch",
        entryId: m.entryId,
        entryName: name,
        lynne: { team: m.row.team, result: m.row.result },
        local: { team: lp.team, result: lp.result },
      });
      continue;
    }

    if (!m.row.result) {
      plan.noResultYet += 1;
      continue;
    }

    const localResult = lp.result === "pending" ? null : lp.result;
    if (localResult === null) {
      plan.applies.push({ entry_id: m.entryId, result: m.row.result });
    } else if (localResult === m.row.result) {
      plan.alreadyApplied += 1;
    } else {
      plan.variances.push({
        type: "result_conflict",
        entryId: m.entryId,
        entryName: name,
        lynne: { team: m.row.team, result: m.row.result },
        local: { team: lp.team, result: lp.result },
      });
    }
  }

  return plan;
}
