// The Lynne Echo Check, as a pure reporter (docs/ROUTINES.md section 5).
//
// Why the job exists: what Anthony sent her and what she recorded are two
// documents, and the week she transcribes one wrong is the week an entry loses
// on a team it never picked.
//
// THIS ONE IS NEW IN KIND. The Routine it replaces had Gmail, the repo and the
// clock and no database at all (section 1b), so it had to find her echo in the
// mail record - work her address out of Anthony's Sent, fetch each thread
// whole because a search preview hides recent replies, read her rows out of
// her body text, and say in one line when her list arrived as an attachment it
// could not open. Her published cells are now in the database, loaded by the
// two shapes of scripts/lynne (the sheet, and the echo mail whose cells arrive
// with cellSources "email"), so this reads them. What survives from the prompt
// is the reasoning, and it is all from CLAUDE.md:
//
//   - MATCH ON HER NUMBER, NEVER ON A NAME. Her sheet is ~1,320 rows and 121
//     of them are ours; a row that does not carry one of our Lynne numbers is
//     not ours and is never reported. Names are stored verbatim and hers carry
//     her own casing and double spaces ("Amy  3", "Adriana Flacco "), so a name
//     is not an identifier here. Team text is matched exact, then
//     case-insensitive, and never fuzzy.
//   - A VARIANCE CARRIES BOTH VALUES AND IS NEVER RESOLVED. Her sheet can
//     carry a transcription slip and our pick can be stale; neither side is
//     corrected here and no line says which one is wrong.
//   - HER LIST IS PARTIAL AND HER SHEET SHRINKS. A week she has left blank on
//     one of our rows produces NO LINE AT ALL. Silence from her is not a
//     variance and is never an elimination.
//   - NEVER INVENT DATA. A word of hers that maps to none of her team names is
//     its own item quoting her text exactly - untrimmed, as she wrote it - and
//     is never guessed at.
//
// It reports and does nothing else: no write, no send, no label, no mark, no
// resolution. /admin/import is where the two sides are compared, and Anthony's
// is the only hand that corrects either one.

import { fromLynneTeamName } from "@/lib/lynne/names";
import type { Report, ReportItem } from "../lib/report";
import {
  deadlineFor,
  etLabel,
  openWeek,
  type EntrySnapshot,
  type HerRowSnapshot,
  type OpsSnapshot,
} from "./types";

const JOB = "lynne-echo";

// Said once, above the items. Every line below is one document against
// another, and this is the sentence that keeps it that way.
const PREAMBLE = "compare on /admin/import; neither side is corrected here.";

/**
 * CLAUDE.md: matching is exact, then case-insensitive, never fuzzy. Equal
 * strings, or equal once trimmed and lower-cased, and nothing looser - SEA and
 * SEAHAWKS are two strings and must not read as one, because a difference here
 * is a difference between her sheet and ours and she is the authority on
 * elimination in her pool.
 */
function sameTeam(a: string, b: string): boolean {
  return a === b || a.trim().toLowerCase() === b.trim().toLowerCase();
}

function pickKey(entryId: string, week: number): string {
  return `${entryId}:${week}`;
}

/** One of her filled cells on one of our rows, and what this group holds against it. */
interface EchoRow {
  week: number;
  her: HerRowSnapshot;
  entry: EntrySnapshot;
  /** Her cell exactly as she wrote it - never trimmed, never cased. */
  cell: string;
  /** Her cell as an app code, or null when it is not one of her team names. */
  hers: string | null;
  /** The team this group holds a current pick for that week, or null. */
  ours: string | null;
}

/**
 * The deadline a line is tied to, named as section 1d requires.
 *
 * Two teams can be on one line and close two days apart - her Wednesday-game
 * team and our Sunday-game team are the same week and different tiers - so the
 * line names the EARLIEST of them, which is the one still ahead, and says
 * which team it belongs to. When both fall in the same tier the team is left
 * off: naming one of two teams that close at the same instant would read as a
 * claim about that team. A week with no stored boundaries says so rather than
 * printing a deadline that is not on record, and a deadline already behind us
 * reads "closed" - a played week's variance is still a variance, and pretending
 * its deadline is ahead would be inventing one.
 */
function deadlineText(s: OpsSnapshot, week: number, teams: (string | null)[]): string {
  const named = [...new Set(teams.filter((t): t is string => t !== null && t.trim() !== ""))];
  const candidates: { team: string | null; iso: string }[] = [];
  for (const team of named.length > 0 ? named : [null]) {
    const iso = deadlineFor(s, week, team);
    if (iso !== null) candidates.push({ team, iso });
  }
  if (candidates.length === 0) return `Week ${week} has no deadline on record`;

  candidates.sort(
    (a, b) =>
      new Date(a.iso).getTime() - new Date(b.iso).getTime() ||
      (a.team ?? "").localeCompare(b.team ?? ""),
  );
  const first = candidates[0];
  const oneTier = candidates.every((c) => c.iso === first.iso);
  const verb = new Date(first.iso).getTime() < s.now.getTime() ? "closed" : "closes";
  const who = oneTier || first.team === null ? "" : ` for ${first.team}`;
  return `Week ${week} ${verb}${who} at ${etLabel(first.iso)}`;
}

/** Her word and our code on one line, in her wording and ours, with neither called right. */
function lineFor(s: OpsSnapshot, r: EchoRow): string {
  const where = `${r.entry.entryName} (her NO. ${r.her.rowNo}) Week ${r.week}`;
  const when = deadlineText(s, r.week, [r.ours, r.hers]);
  if (r.hers === null) {
    // Quoted exactly as she wrote it, spacing included. Her vocabulary is a
    // fixed list; a word outside it is hers to explain, never ours to map.
    const held = r.ours === null ? "this group holds no pick" : `we hold ${r.ours}`;
    return `${where} - her cell reads "${r.cell}" and is not one of her team names - ${held} - ${when}`;
  }
  if (r.ours === null) {
    // She has a pick recorded against one of ours that this group does not
    // hold. That is a variance in the other direction and worth its own line.
    return `${where} - she has "${r.cell}" (${r.hers}), this group holds no pick for it - ${when}`;
  }
  return `${where} - she has "${r.cell}" (${r.hers}), we hold ${r.ours} - ${when}`;
}

export function reportLynneEcho(s: OpsSnapshot): Report {
  const items: ReportItem[] = [];

  // Nothing of hers is loaded, so there is no second document to compare
  // against. An unloaded sheet is not evidence about a single pick, and a
  // report built from one side alone would be this reporter guessing.
  if (s.herSheet === null) return { job: JOB, items };

  // Her NO. to one of our live entries. entries_lynne_number_key makes the
  // number unique, so a second entry on one number cannot exist; the guard is
  // here only so a collision would leave the first row rather than the last.
  const byNumber = new Map<number, EntrySnapshot>();
  for (const e of s.entries) {
    if (e.lynneNumber === null) continue;
    if (!byNumber.has(e.lynneNumber)) byNumber.set(e.lynneNumber, e);
  }

  // Current picks only - the snapshot carries no superseded rows.
  const ourPicks = new Map<string, string>();
  for (const p of s.picks) {
    const k = pickKey(p.entryId, p.week);
    if (!ourPicks.has(k)) ourPicks.set(k, p.team);
  }

  const rows: EchoRow[] = [];
  for (const her of s.herRows) {
    const entry = byNumber.get(her.rowNo);
    // Not one of ours. Her pool is ~1,320 rows around this group's 121, and a
    // row matching none of our numbers is never reported - not even when its
    // NAMES text looks like one of ours, because the name is not the match.
    if (entry === undefined) continue;

    for (const [key, cell] of Object.entries(her.cells)) {
      const week = Number(key);
      if (!Number.isFinite(week)) continue;
      // A blank cell is a week she has not filled, which the loader already
      // drops. Silence from her is not a variance.
      if (cell.trim() === "") continue;

      const hers = fromLynneTeamName(cell);
      const ours = ourPicks.get(pickKey(entry.id, week)) ?? null;
      if (hers !== null && ours !== null && sameTeam(hers, ours)) continue;
      rows.push({ week, her, entry, cell, hers, ours });
    }
  }

  // The open week leads - its deadline is the one still ahead - and the rest
  // run in week order, then by her NO., so one snapshot always prints one
  // report.
  const open = openWeek(s);
  const rank = (w: number) => (open !== null && w === open ? 0 : 1);
  rows.sort(
    (a, b) =>
      rank(a.week) - rank(b.week) ||
      a.week - b.week ||
      a.her.rowNo - b.her.rowNo ||
      a.entry.entryName.localeCompare(b.entry.entryName),
  );

  for (const r of rows) {
    items.push({
      text: lineFor(s, r),
      // The collapse keeps every name, so each one has to identify its row on
      // its own: an entry can differ from her in more than one week.
      names: [`${r.entry.entryName} (NO. ${r.her.rowNo} Week ${r.week})`],
    });
  }

  return items.length > 0 ? { job: JOB, items, preamble: PREAMBLE } : { job: JOB, items };
}
