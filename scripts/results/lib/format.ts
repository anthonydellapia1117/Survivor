// Lines the results command prints. Pure, so the tests can hold them to two
// rules: every variance is printed with BOTH sides and none is dropped, and
// nothing a human reads carries an em dash or en dash. Nothing here decides
// anything; a null side prints as "-" and stays null in the import.

import type { Variance } from "@/lib/lynne/compare";
import type { HerWeekCounts } from "@/lib/lynne/parse-grid";
import type { ConflictSummary, NumberSuggestion, ResultsPlan } from "./plan";

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** "PHI / win", "SKIP_WEEK / -", "- / -": a null is shown, never filled in. */
export function side(team: string | null, result: string | null): string {
  return `${team ?? "-"} / ${result ?? "-"}`;
}

const ENTRY_W = 28;
const TYPE_W = 18;
const SIDE_W = 24;

export function varianceHeader(): string[] {
  const h = `${pad("entry", ENTRY_W)} | ${pad("type", TYPE_W)} | ${pad("Lynne team / result", SIDE_W)} | local team / result`;
  return [h, "-".repeat(h.length)];
}

/** One line per variance: entry | type | Lynne team / result | local team / result. */
export function varianceLine(v: Variance): string {
  return `${pad(v.entryName, ENTRY_W)} | ${pad(v.type, TYPE_W)} | ${pad(side(v.lynne.team, v.lynne.result), SIDE_W)} | ${side(v.local.team, v.local.result)}`;
}

/** Exactly one line per variance, in the order given. */
export function varianceLines(variances: Variance[]): string[] {
  return variances.map(varianceLine);
}

/** The table as printed: a title, the header, then every variance. */
export function varianceTable(variances: Variance[]): string[] {
  if (variances.length === 0) return ["Variances: none."];
  return [
    `Variances (${variances.length}), recorded with the import and never resolved here:`,
    ...varianceHeader(),
    ...varianceLines(variances),
  ];
}

/** A conflict on her sheet: her number, her name, why, and the entry ours points at. */
export function conflictLine(c: ConflictSummary): string {
  const why = c.reason.replace(/_/g, " ");
  return `- CONFLICT her no. ${c.no} "${c.name}": ${why}; our entry for that number: ${c.entryName ?? "(none)"}`;
}

/** A number on her sheet we do not hold. Anthony sets it; nothing is applied here. */
export function numberSuggestionLine(s: NumberSuggestion): string {
  return `NEEDS ANTHONY - her sheet carries ${s.sheetNo} for ${s.entryName}, not on file; set it on /admin/entries; nothing applied here`;
}

export function herCountsLine(week: number, c: HerWeekCounts | null): string {
  if (!c) return `Her counts for week ${week}: not in this file`;
  const n = (x: number | null) => (x === null ? "-" : String(x));
  return `Her counts for week ${week}: no losses ${n(c.noLosses)}, 1 loss/bye ${n(c.lossBye)}, out ${n(c.out)}`;
}

export function matchedByText(b: Record<string, number>): string {
  const parts = Object.entries(b).map(([k, n]) => `${k} ${n}`);
  return parts.length ? parts.join(", ") : "none";
}

/** The counts block printed before any write, per path. */
export function planSummaryLines(plan: ResultsPlan): string[] {
  if (plan.format === "grid") {
    const lines = [
      "Path: grid (her NO./NAMES sheet). Results are NOT applied on this path; the scores engine owns them.",
      `Weeks in file: ${plan.weeksInFile.join(", ")}; latest filled week: ${plan.latestFilledWeek ?? "-"}`,
      `Matched ${plan.matchedCount} (${matchedByText(plan.matchedBy)}); conflicts ${plan.conflicts.length}; missing ${plan.missingCount} (${plan.confirmedRemovals} confirmed removals, ${plan.absentButAlive} absent but alive); other pool ${plan.otherPoolCount}`,
      `Agreements: team ${plan.teamAgreements}, status ${plan.statusAgreements}; quiet rows ${plan.quietRows}`,
      `Variances ${plan.variances.length}; applies ${plan.applies.length}; rows stored ${plan.rows.length} of ${plan.rowCount} on her sheet`,
    ];
    if (plan.noFillInfo) {
      lines.push("Note: this file carries no fill colours; OUT is read from cell text only.");
    }
    return lines;
  }
  return [
    "Path: legacy (entry/team/result columns). A result IS applied on this path, only where her row agrees with the local pick and carries a result.",
    `Rows ${plan.rowCount}; matched ${plan.matchedCount} (${matchedByText(plan.matchedBy)}); unmatched ${plan.unmatched.length}`,
    `Already applied ${plan.alreadyApplied}; no result yet ${plan.noResultYet}`,
    `Variances ${plan.variances.length}; applies ${plan.applies.length}`,
  ];
}
