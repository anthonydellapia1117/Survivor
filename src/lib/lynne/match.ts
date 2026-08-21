// Row-to-entry matching (spec 6.1 step 4): exact lynne_label first, then
// exact entry_name, then case-insensitive entry_name. NEVER fuzzy — an
// ambiguous or unknown label goes to unmatched for human review.

import type { LynneRow } from "./parse";

export interface MatchTarget {
  id: string;
  entryName: string;
  lynneLabel: string | null;
}

export interface MatchedRow {
  row: LynneRow;
  entryId: string;
  matchedBy: "lynne_label" | "entry_name" | "entry_name_ci";
}

export interface MatchResult {
  matched: MatchedRow[];
  unmatched: LynneRow[];
}

export function matchRows(
  rows: LynneRow[],
  entries: MatchTarget[],
): MatchResult {
  const byLabel = new Map<string, MatchTarget[]>();
  const byName = new Map<string, MatchTarget[]>();
  const byNameCi = new Map<string, MatchTarget[]>();
  for (const e of entries) {
    if (e.lynneLabel) {
      const l = byLabel.get(e.lynneLabel) ?? [];
      l.push(e);
      byLabel.set(e.lynneLabel, l);
    }
    const n = byName.get(e.entryName) ?? [];
    n.push(e);
    byName.set(e.entryName, n);
    const key = e.entryName.toLowerCase();
    const c = byNameCi.get(key) ?? [];
    c.push(e);
    byNameCi.set(key, c);
  }

  const matched: MatchedRow[] = [];
  const unmatched: LynneRow[] = [];

  for (const row of rows) {
    const label = row.entry;
    const viaLabel = byLabel.get(label);
    if (viaLabel && viaLabel.length === 1) {
      matched.push({ row, entryId: viaLabel[0].id, matchedBy: "lynne_label" });
      continue;
    }
    const viaName = byName.get(label);
    if (viaName && viaName.length === 1) {
      matched.push({ row, entryId: viaName[0].id, matchedBy: "entry_name" });
      continue;
    }
    const viaCi = byNameCi.get(label.toLowerCase());
    if (viaCi && viaCi.length === 1) {
      matched.push({ row, entryId: viaCi[0].id, matchedBy: "entry_name_ci" });
      continue;
    }
    // Ambiguous (duplicate names) or unknown: human review, never a guess.
    unmatched.push(row);
  }

  return { matched, unmatched };
}
