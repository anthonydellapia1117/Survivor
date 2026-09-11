// The weekly submission block, in exactly the three-column format Lynne
// accepts and nothing else:
//
//   NO.    NAMES                    Week 13
//   977    Anthony DellaPia 2       San Francisco
//
// Space-aligned columns, sorted by her entry number ascending.

import { LYNNE_TEAM_NAME } from "./names";
import { SKIP_WEEK } from "@/lib/standing";
import { isAliveStatus } from "@/lib/alive";
import type { EntryStatus } from "@/lib/data/types";

/**
 * What a cell holds when it is not a team. Values, never words - the same
 * shape as SKIP_WEEK, and like it they are rendered by `cellText` and never
 * printed raw.
 */
export const NO_PICK = "NO_PICK";
export const OUT_OF_POOL = "OUT_OF_POOL";

/**
 * The one place a cell's TEXT is written. The block and the CSV each had
 * their own copy of this and only one of them would have learned a new case -
 * the same two-copies-of-one-rule shape that put SKIP_WEEK on a screen.
 */
export function cellText(value: string): string {
  if (value === SKIP_WEEK) return "BYE";
  if (value === NO_PICK) return "NO PICK";
  if (value === OUT_OF_POOL) return "OUT";
  return LYNNE_TEAM_NAME[value] ?? value;
}

export interface SubmitRow {
  lynneNumber: number;
  entryName: string;
  /** App abbreviation, or SKIP_WEEK / NO_PICK / OUT_OF_POOL. Rendered by
   *  `cellText`; never printed raw. */
  team: string;
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
  const lines = [
    `NO.,NAMES,Week ${week}`,
    ...sorted.map(
      (r) =>
        `${r.lynneNumber},${csvField(r.entryName)},${csvField(cellText(r.team))}`,
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
 * Assemble the week's rows: EVERY live entry, every week.
 *
 * It used to emit only entries that had a current pick, and silently drop the
 * rest - so a week with a missed pick or an elimination sent Lynne a SHORTER
 * list than the roster, and nothing on the page said which rows had gone. In
 * Week 1 that was invisible because all 121 had picks; from Week 2 it is not.
 *
 * So a row is emitted for every entry that carries a Lynne number, and the
 * cell says what is true: the team, BYE for a bye, NO PICK where there is
 * none, OUT where the entry is eliminated. **Row count equals live entry
 * count**, which is the property `/admin/lynne-submit` states and the guard
 * asserts.
 *
 * An entry with NO LYNNE NUMBER still cannot be a row - there is no number to
 * put it under in her sheet - so it is reported separately and is the one
 * thing that can make the counts differ. Every entry carries one today.
 */
export function buildSubmitRows(
  live: { id: string; entryName: string; status: EntryStatus; isAdminEntry?: boolean }[],
  pickByEntry: Map<string, string>,
  numberById: Map<string, number | null>,
): SubmitRowsResult {
  const ready: SubmitRow[] = [];
  const missingNumber: string[] = [];
  const missingPick: string[] = [];
  for (const e of live) {
    const no = numberById.get(e.id) ?? null;
    if (no === null) {
      missingNumber.push(e.entryName);
      continue;
    }
    const pick = pickByEntry.get(e.id);
    // A MISSED week is no pick, which is exactly what it should read as.
    const noPick = !pick || pick === "MISSED";
    // OUT ONLY WHERE THERE IS NO PICK FOR THIS WEEK.
    //
    // `status` is the entry's standing TODAY, not its standing in the week
    // being submitted, and this function serves an explicitly chosen week -
    // `--week N` and the admin week selector. Letting a dead entry's status
    // win outright rewrote HISTORY: re-running Week 1 after a Week 2
    // elimination replaced that entry's Week 1 team with OUT, when the Week 1
    // pick is right there and really was its pick. Copilot caught it on #91.
    //
    // A pick on file is what happened, so it is what she is told. OUT is for
    // the row that has nothing for the week AND is finished - which is what
    // the current week produces for an eliminated entry, since nobody chases
    // one for a pick.
    const out = noPick && !isAliveStatus(e.status);
    const team = out ? OUT_OF_POOL : noPick ? NO_PICK : pick;
    if (!out && noPick) missingPick.push(e.entryName);
    ready.push({
      lynneNumber: no,
      entryName: e.entryName,
      team,
      isAdminEntry: e.isAdminEntry ?? false,
    });
  }
  return {
    ready,
    missingNumber,
    missingPick,
    aliveCount: live.filter((e) => isAliveStatus(e.status)).length,
  };
}

export function buildSubmissionBlock(week: number, rows: SubmitRow[]): string {
  const sorted = [...rows].sort(submitOrder);
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
        `${pad(String(r.lynneNumber), noWidth + 4)}${pad(r.entryName, nameWidth + 4)}${cellText(r.team)}`,
    ),
  ];
  return lines.join("\n");
}
