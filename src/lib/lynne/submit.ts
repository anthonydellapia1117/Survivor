// The weekly submission block, in exactly the three-column format Lynne
// accepts and nothing else:
//
//   NO.    NAMES                    Week 13
//   977    Anthony DellaPia 2       San Francisco
//
// Space-aligned columns, sorted by her entry number ascending.

import { LYNNE_TEAM_NAME } from "./names";
import { SKIP_WEEK } from "@/lib/standing";

export interface SubmitRow {
  lynneNumber: number;
  entryName: string;
  team: string; // app abbreviation
}

export function buildSubmissionBlock(week: number, rows: SubmitRow[]): string {
  const sorted = [...rows].sort((a, b) => a.lynneNumber - b.lynneNumber);
  const teamText = (abbr: string) =>
    abbr === SKIP_WEEK ? "BYE" : (LYNNE_TEAM_NAME[abbr] ?? abbr);
  const noWidth = Math.max(
    "NO.".length,
    ...sorted.map((r) => String(r.lynneNumber).length),
  );
  const nameWidth = Math.max(
    "NAMES".length,
    ...sorted.map((r) => r.entryName.length),
  );
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
  const lines = [
    `${pad("NO.", noWidth + 4)}${pad("NAMES", nameWidth + 4)}Week ${week}`,
    ...sorted.map(
      (r) =>
        `${pad(String(r.lynneNumber), noWidth + 4)}${pad(r.entryName, nameWidth + 4)}${teamText(r.team)}`,
    ),
  ];
  return lines.join("\n");
}
