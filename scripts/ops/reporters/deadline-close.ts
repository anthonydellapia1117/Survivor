// The Deadline Close Check, as a pure reporter (docs/ROUTINES.md section 4).
//
// The Routine it replaces had Gmail, the repo and the clock and no database
// (section 1b), so it inferred who had picked from the mail record. This reads
// the picks and the roster off the snapshot instead. Four things become true
// around a close and none of them announce themselves:
//
//   - a duplicate team, which is an ELIMINATION in Lynne's pool, not a
//     warning (CLAUDE.md), and so the first line this reporter prints;
//   - a pick that arrived after the deadline governing ITS OWN team - not the
//     week's, per the deadline table: a Wednesday game and a Sunday game in
//     one week close two days apart;
//   - a pick sitting on an entry she does not hold;
//   - an entry she has never been sent at all.
//
// It decides none of them. Accepting, refusing or sweeping a late pick is
// Anthony's call, a variance carries both values and is never auto-resolved,
// and nothing in scripts/ops/reporters can write, send or mark anything
// anyway.

import { LOCKED_TEAM } from "@/lib/data/types";
import { SKIP_WEEK } from "@/lib/standing";
import type { Report, ReportItem } from "../lib/report";
import {
  deadlineFor,
  etLabel,
  openWeek,
  type EntrySnapshot,
  type OpsSnapshot,
  type PickSnapshot,
} from "./types";

const JOB = "deadline-close";

// Said once, above the items, rather than on every late line - section 1d
// wants the question, not the same sentence four times.
const LATE_PREAMBLE = "Late picks are yours to call - accept, refuse or sweep; this reports and decides nothing.";

/**
 * The three values a pick cell can hold that are not a team. Mirrors
 * countsInTally in src/lib/master-list.ts. Two byes in two weeks are not a
 * duplicate team, and calling one an elimination would be inventing one.
 */
const NOT_A_TEAM = new Set<string>([SKIP_WEEK, LOCKED_TEAM, "MISSED"]);

function isTeam(team: string): boolean {
  return !NOT_A_TEAM.has(team.trim().toUpperCase());
}

/**
 * CLAUDE.md: matching is exact, then case-insensitive, never fuzzy. Equal
 * strings, or equal once trimmed and lower-cased, and nothing looser - SEA and
 * SEAHAWKS are two strings and must not read as one here, because the answer
 * this decides is whether an entry is out of her pool.
 */
function sameTeam(a: string, b: string): boolean {
  return a === b || a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What to call an entry on a line. A pick whose entry is not on the snapshot
 * is named as the unknown it is rather than dropped or paired with a guess.
 */
function entryLabel(byId: Map<string, EntrySnapshot>, entryId: string): string {
  return byId.get(entryId)?.entryName ?? `unknown entry ${entryId}`;
}

/**
 * A duplicate team: this entry has already picked this team in an earlier
 * week. The look-back spans the season - every earlier week of her pool, not
 * just the one before - and the line names both weeks so the claim can be
 * checked against her sheet, which is the authority on elimination.
 */
function duplicateTeamItems(
  s: OpsSnapshot,
  byId: Map<string, EntrySnapshot>,
  week: number | null,
): ReportItem[] {
  const byEntry = new Map<string, PickSnapshot[]>();
  for (const p of s.picks) {
    const held = byEntry.get(p.entryId);
    if (held) held.push(p);
    else byEntry.set(p.entryId, [p]);
  }

  const found: { pick: PickSnapshot; earlier: PickSnapshot; name: string }[] = [];
  for (const [entryId, picks] of byEntry) {
    const inWeekOrder = [...picks].sort((a, b) => a.week - b.week);
    for (let i = 0; i < inWeekOrder.length; i++) {
      const pick = inWeekOrder[i];
      if (!isTeam(pick.team)) continue;
      const earlier = inWeekOrder.slice(0, i).find((q) => isTeam(q.team) && sameTeam(q.team, pick.team));
      if (!earlier) continue;
      found.push({ pick, earlier, name: entryLabel(byId, entryId) });
    }
  }

  // The open week's duplicate is the one still worth a message before its
  // deadline, so it leads; the rest follow newest first.
  const rank = (w: number) => (w === week ? 0 : 1);
  found.sort(
    (a, b) =>
      rank(a.pick.week) - rank(b.pick.week) ||
      b.pick.week - a.pick.week ||
      a.name.localeCompare(b.name),
  );

  return found.map(({ pick, earlier, name }) => {
    const dl = deadlineFor(s, pick.week, pick.team);
    const closes = dl
      ? `Week ${pick.week} closes for ${pick.team} at ${etLabel(dl)}`
      : `Week ${pick.week} has no deadline on record`;
    return {
      text:
        `${name} - ${pick.team} in Week ${pick.week} is already this entry's Week ${earlier.week} pick` +
        ` - a duplicate team is an ELIMINATION in her pool, not a warning - ${closes}`,
      names: [name],
    };
  });
}

/**
 * Late picks for the open week. Late by the clock is submittedAt after the
 * deadline for that pick's own team; late by the flag is the app's own
 * `late`. Either reports, and when the two disagree the line carries both
 * values unresolved - that is the variance rule, applied to our own two
 * records rather than to hers.
 */
function latePickItems(
  s: OpsSnapshot,
  byId: Map<string, EntrySnapshot>,
  week: number | null,
): ReportItem[] {
  if (week === null) return [];

  const rows: { pick: PickSnapshot; name: string; text: string }[] = [];
  for (const pick of s.picks) {
    if (pick.week !== week) continue;
    const dl = deadlineFor(s, pick.week, pick.team);
    const pastDeadline = dl !== null && new Date(pick.submittedAt).getTime() > new Date(dl).getTime();
    if (!pastDeadline && !pick.late) continue;

    const name = entryLabel(byId, pick.entryId);
    const clock =
      dl === null
        ? `arrived ${etLabel(pick.submittedAt)} - no deadline on record for Week ${pick.week}`
        : `arrived ${etLabel(pick.submittedAt)} - ${pastDeadline ? "after" : "before"} its ${etLabel(dl)} deadline`;
    const flag = pick.late ? "flagged late" : "not flagged late";
    const disagree =
      dl !== null && pastDeadline !== pick.late
        ? " - the flag and the deadline disagree; both values stand as recorded"
        : "";
    rows.push({ pick, name, text: `${name} - ${pick.team} - ${clock} - ${flag}${disagree}` });
  }

  rows.sort(
    (a, b) =>
      new Date(a.pick.submittedAt).getTime() - new Date(b.pick.submittedAt).getTime() ||
      a.name.localeCompare(b.name),
  );
  return rows.map(({ text, name }) => ({ text, names: [name] }));
}

/** Entry names, sorted, so the same snapshot always prints the same line. */
function sortedNames(entries: EntrySnapshot[]): string[] {
  return entries.map((e) => e.entryName).sort((a, b) => a.localeCompare(b));
}

/**
 * A pick for the open week on an entry she does not hold. She scores from her
 * own sheet, so a pick against a row she has not got cannot be reported to her
 * at all; it is tied to the week's late boundary, which is the lock.
 */
function picksNotSentItems(s: OpsSnapshot, week: number | null): ReportItem[] {
  if (week === null) return [];
  const picked = new Set(s.picks.filter((p) => p.week === week).map((p) => p.entryId));
  const names = sortedNames(s.entries.filter((e) => picked.has(e.id) && e.submittedToLynneAt === null));
  if (names.length === 0) return [];
  const dl = deadlineFor(s, week, null);
  const lock = dl ? ` - Week ${week} locks ${etLabel(dl)}` : "";
  const verb = names.length === 1 ? "entry with a" : "entries with a";
  const are = names.length === 1 ? "is" : "are";
  return [
    {
      text: `${names.length} ${verb} Week ${week} pick ${are} not on her sheet: ${names.join(", ")}${lock}`,
      names,
    },
  ];
}

/**
 * Roster drift: entries she has never been sent, pick or no pick. This one
 * spans the season rather than the open week - an entry she does not hold is
 * missing from every week until it is sent. EntrySnapshot carries no voided
 * flag because the snapshot is the live roster, so every row here is one she
 * should have.
 */
function rosterDriftItems(s: OpsSnapshot, week: number | null): ReportItem[] {
  const names = sortedNames(s.entries.filter((e) => e.submittedToLynneAt === null));
  if (names.length === 0) return [];
  const dl = week === null ? null : deadlineFor(s, week, null);
  const before = dl ? ` - send before Week ${week} locks ${etLabel(dl)}` : "";
  const have = names.length === 1 ? "entry has" : "entries have";
  const them = names.length === 1 ? "it" : "them";
  return [
    {
      text: `${names.length} live ${have} never been sent to Lynne - she does not hold ${them}: ${names.join(", ")}${before}`,
      names,
    },
  ];
}

export function reportDeadlineClose(s: OpsSnapshot): Report {
  // The only clock this file has. Never Date.now(): the whole reporter has to
  // be replayable against a fixture.
  const week = openWeek(s);
  const byId = new Map(s.entries.map((e) => [e.id, e]));

  const duplicates = duplicateTeamItems(s, byId, week);
  const late = latePickItems(s, byId, week);
  const notSent = picksNotSentItems(s, week);
  const drift = rosterDriftItems(s, week);

  const items = [...duplicates, ...late, ...notSent, ...drift];
  return late.length > 0 ? { job: JOB, items, preamble: LATE_PREAMBLE } : { job: JOB, items };
}
