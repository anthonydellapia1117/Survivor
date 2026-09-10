// The Final Sheet Watch, as a pure reporter (docs/ROUTINES.md section 6).
//
// Her Final Sheet is the authority on who is out of HER pool. It arrives
// Monday or Tuesday, corrections follow as separate mails, and until it is
// loaded nothing in this app knows what it says. The Routine this replaces had
// Gmail, the repo and the clock and no database at all (section 1b), so it
// read her sheet out of the attachment and hand-compared it. This reads the
// loaded sheet off the snapshot and asks the one question the mailbox still
// answers on its own: is a newer one sitting there unloaded?
//
// Four things it says, and nothing else:
//
//   - her mail could not be read at all, so the watch is blind;
//   - a Football .xlsx of hers arrived after the loaded sheet and is waiting;
//   - a live entry of ours whose NO. is not on her newest sheet at all;
//   - a cell of hers on one of our NO.s that is not one of her team names.
//
// It resolves none of them. HER SHEET SHRINKS BY DESIGN - she deletes
// eliminated entries as the season goes, so a missing row is not a data error
// and never a row to re-add (CLAUDE.md). And her list is partial: a NO. she
// does not name in a week has no pick recorded there and is NOT eliminated, so
// a blank cell is never read as an OUT. Both of those are questions for her,
// carried with both sides' values, decided by Anthony.

import { fromLynneTeamName } from "@/lib/lynne/names";
import type { Report, ReportItem } from "../lib/report";
import {
  deadlineFor,
  etLabel,
  openWeek,
  type EntrySnapshot,
  type HerMailSnapshot,
  type OpsSnapshot,
} from "./types";

const JOB = "sheet-watch";

// Said once above the items rather than on every line - section 1d wants the
// question, not the same sentence four times. It is the standing rule, so it
// survives a collapse: renderReport keeps the head and folds only the items.
const SHEET_PREAMBLE =
  "Her sheet decides who is out; a row she has dropped or marked is a question for her, never a correction to make here.";

/**
 * A Football .xlsx of hers. `includes` rather than an exact name because the
 * one thing this watch must never do is miss a sheet: `Football 2026-3.xlsx`,
 * `Football 2026-4.xlsx` and a forward's `Copy of Football 2026-4.xlsx` all
 * have to land here. It is not fuzzy matching in the CLAUDE.md sense - that
 * rule governs matching an entry or a row of hers to one of ours, which below
 * is by NO. and by nothing else.
 */
function footballFiles(m: HerMailSnapshot): string[] {
  return m.filenames.filter((f) => {
    const name = f.trim().toLowerCase();
    return name.endsWith(".xlsx") && name.includes("football");
  });
}

/**
 * The open week's late boundary, as a suffix. Whether one of ours has been
 * dropped or marked by her is a question that has to be settled before the
 * week locks - that is when his picks go to her - so those lines name it. The
 * mail lines do not: loading her sheet is not gated by a pick deadline, and
 * saying it is would invent a tie the schedule does not have.
 */
function lockSuffix(s: OpsSnapshot): string {
  const week = openWeek(s);
  if (week === null) return "";
  const iso = deadlineFor(s, week, null);
  return iso === null ? "" : ` - Week ${week} locks ${etLabel(iso)}`;
}

/**
 * Her Football sheets in the mailbox that are not the loaded one.
 *
 * Excluded two ways, because either alone can be wrong: by Gmail message id,
 * which is exact, and by arrival against `loadedAt`. With nothing loaded every
 * one of them is waiting.
 */
function unloadedSheetItems(s: OpsSnapshot): ReportItem[] {
  if (s.herMail === null) return [];
  const sheet = s.herSheet;
  const loadedMs = sheet === null ? null : new Date(sheet.loadedAt).getTime();

  const waiting = s.herMail
    .filter((m) => footballFiles(m).length > 0)
    .filter((m) => {
      if (sheet === null) return true;
      if (sheet.gmailMessageId !== null && m.messageId === sheet.gmailMessageId) return false;
      return loadedMs === null || new Date(m.receivedAt).getTime() > loadedMs;
    })
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime() ||
        a.messageId.localeCompare(b.messageId),
    );

  return waiting.map((m) => {
    const files = footballFiles(m);
    const loaded =
      sheet === null
        ? ""
        : ` - the loaded sheet is ${sheet.sourceFile} from ${etLabel(sheet.loadedAt)}`;
    return {
      text:
        `${files.join(", ")} arrived ${etLabel(m.receivedAt)} in her message ${m.messageId}` +
        ` and ${files.length === 1 ? "is" : "are"} not loaded${loaded} - npm run lynne:roster`,
      names: [`${files.join(", ")} (message ${m.messageId})`],
    };
  });
}

/**
 * Ours she no longer carries: a live entry holding a Lynne number that is not
 * a NO. on her newest sheet.
 *
 * Matched by NO. and never by name - CLAUDE.md, and the reason her NAMES text
 * is not consulted here at all: `Adriana Flacco ` carries a trailing space and
 * `Andrew Dicicco #1` her own casing, and a name comparison would have to
 * choose which of those to forgive.
 *
 * An entry with no number was never on her sheet to be dropped from; that gap
 * is roster drift and belongs to the deadline-close reporter. And with no
 * sheet loaded this says nothing at all: calling all 121 dropped because the
 * table is empty would be the reporter inventing its own findings.
 */
function droppedItems(s: OpsSnapshot, lock: string): ReportItem[] {
  if (s.herRows.length === 0) return [];
  const hers = new Set(s.herRows.map((r) => r.rowNo));
  const gone = s.entries
    .filter((e): e is EntrySnapshot & { lynneNumber: number } => e.lynneNumber !== null && !hers.has(e.lynneNumber))
    .sort((a, b) => a.lynneNumber - b.lynneNumber);
  if (gone.length === 0) return [];

  const names = gone.map((e) => `${e.entryName} (NO. ${e.lynneNumber})`);
  const sheet = s.herSheet === null ? "" : ` (${s.herSheet.sourceFile})`;
  return [
    {
      text:
        `${gone.length} of ours ${gone.length === 1 ? "is" : "are"} not on her newest sheet${sheet} at all: ${names.join(", ")}` +
        ` - her sheet shrinks as she deletes eliminated entries, so a missing row is not a data error and not a row to re-add - ask her${lock}`,
      names,
    },
  ];
}

/**
 * A cell of hers on one of our NO.s whose text is not one of her team names -
 * OUT, a note, a typo - quoted exactly as she wrote it.
 *
 * Her vocabulary comes from fromLynneTeamName and nowhere else: that is the
 * same function v_master_list is built on, so a cell this reporter calls "not
 * a team" is exactly a cell the Master List renders as her text. A second copy
 * of her team list here would drift against it.
 *
 * A blank or absent cell produces nothing. Her list is partial - a week she
 * has not filled in for a row records no pick and eliminates nobody - and
 * reading silence as an OUT is how a live entry stops being played.
 */
function markedItems(s: OpsSnapshot, lock: string): ReportItem[] {
  const byNo = new Map<number, EntrySnapshot>();
  for (const e of s.entries) if (e.lynneNumber !== null) byNo.set(e.lynneNumber, e);

  const found: { week: number; rowNo: number; item: ReportItem }[] = [];
  for (const row of s.herRows) {
    const ours = byNo.get(row.rowNo);
    if (!ours) continue;
    for (const [key, raw] of Object.entries(row.cells)) {
      const week = Number(key);
      if (!Number.isFinite(week)) continue;
      if (raw.trim() === "") continue;
      if (fromLynneTeamName(raw) !== null) continue;
      const label = `${ours.entryName} (NO. ${row.rowNo}) Week ${week} "${raw}"`;
      found.push({
        week,
        rowNo: row.rowNo,
        item: {
          text: `${ours.entryName} (NO. ${row.rowNo}) - her Week ${week} cell reads "${raw}" - not one of her team names${lock}`,
          names: [label],
        },
      });
    }
  }

  // Newest week first: an OUT she wrote this week is the one still worth a
  // message, and her sheet carries every earlier week's for the rest of the
  // season.
  found.sort((a, b) => b.week - a.week || a.rowNo - b.rowNo);
  return found.map((f) => f.item);
}

export function reportSheetWatch(s: OpsSnapshot): Report {
  const items: ReportItem[] = [];
  const lock = lockSuffix(s);

  // Gmail off for this run. One item, and NEVER an empty report: NO ACTION here
  // would read as "nothing of hers is waiting", which is the one thing this
  // run cannot know. The sheet checks below come off the database and are
  // unaffected by Gmail, so they still run - suppressing a row she has dropped
  // because the mailbox was unreachable would hide a finding that is already
  // in hand.
  if (s.herMail === null) {
    items.push({
      text: "Her mail could not be read this run - Gmail is not configured for it - the sheet watch is blind: a newer Football sheet may be waiting and this run cannot see it",
    });
  }

  if (s.herSheet === null) {
    items.push({
      text: "No sheet of hers is loaded at all - there is nothing to compare ours against - npm run lynne:roster",
    });
  }

  items.push(...unloadedSheetItems(s));

  const dropped = droppedItems(s, lock);
  const marked = markedItems(s, lock);
  items.push(...dropped, ...marked);

  return dropped.length + marked.length > 0
    ? { job: JOB, items, preamble: SHEET_PREAMBLE }
    : { job: JOB, items };
}
