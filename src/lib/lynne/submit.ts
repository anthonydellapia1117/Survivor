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
  /** Runner's entry — sorts to the top of the block and CSV. */
  isAdminEntry?: boolean;
}

function submitOrder(a: SubmitRow, b: SubmitRow): number {
  return (
    Number(b.isAdminEntry ?? false) - Number(a.isAdminEntry ?? false) ||
    a.lynneNumber - b.lynneNumber
  );
}

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * The same data as the copy block, as a CSV Lynne can open directly:
 * NO. | NAMES | Week [n], sorted by her number, BYE literal, her team
 * vocabulary. Filename convention: DellaPia_Week[n]_Picks.csv.
 */
export function buildSubmissionCsv(week: number, rows: SubmitRow[]): string {
  const sorted = [...rows].sort(submitOrder);
  const teamText = (abbr: string) =>
    abbr === SKIP_WEEK ? "BYE" : (LYNNE_TEAM_NAME[abbr] ?? abbr);
  const lines = [
    `NO.,NAMES,Week ${week}`,
    ...sorted.map(
      (r) =>
        `${r.lynneNumber},${csvField(r.entryName)},${csvField(teamText(r.team))}`,
    ),
  ];
  return lines.join("\n") + "\n";
}

export interface SubmitRowsResult {
  ready: SubmitRow[];
  missingNumber: string[];
  missingPick: string[];
  aliveCount: number;
}

/**
 * Assemble the week's submittable rows from alive entries: a row needs a
 * current pick AND a Lynne number. Shared by /admin/lynne-submit and the
 * week cockpit so both screens carry identical preconditions.
 */
export function buildSubmitRows(
  alive: { id: string; entryName: string; isAdminEntry?: boolean }[],
  pickByEntry: Map<string, string>,
  numberById: Map<string, number | null>,
): SubmitRowsResult {
  const ready: SubmitRow[] = [];
  const missingNumber: string[] = [];
  const missingPick: string[] = [];
  for (const e of alive) {
    const team = pickByEntry.get(e.id);
    const no = numberById.get(e.id) ?? null;
    if (!team || team === "MISSED") {
      missingPick.push(e.entryName);
      continue;
    }
    if (no === null) {
      missingNumber.push(e.entryName);
      continue;
    }
    ready.push({
      lynneNumber: no,
      entryName: e.entryName,
      team,
      isAdminEntry: e.isAdminEntry ?? false,
    });
  }
  return { ready, missingNumber, missingPick, aliveCount: alive.length };
}

export function buildSubmissionBlock(week: number, rows: SubmitRow[]): string {
  const sorted = [...rows].sort(submitOrder);
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
