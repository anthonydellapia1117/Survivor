// The weekly picks email to Lynne: subject, body, and the CSV's filename.
//
// THE CONVENTION IS ANTHONY'S, AS SENT, and is not this file's to change.
// Week 1 went at 5:56 PM ET on 2026-09-11 as `DellaPia_Week1_Picks`, To Lynne,
// BCC himself, with `DellaPia_Week1_Picks.csv` attached and the same table in
// the body. She replied "Got it."
//
//   Subject:  DellaPia_Week<N>_Picks          <- matches the filename exactly
//   Filename: DellaPia_Week<N>_Picks.csv
//
// Underscores in both, on purpose: the two matching is what he wants, and
// searchability is not this string's job.
//
// A NEW MESSAGE EACH WEEK, not a reply on the Entry List thread. That thread
// is the roster; this is the week's picks, and Week 1 started its own.
//
// The body carries the table AND the file, every week - a reader who will not
// open a CSV still sees the picks, and a reader who wants to paste them into a
// sheet has the file.

import { SITE_LINK_TEXT } from "../../../scripts/lib/site-link";

/** `DellaPia_Week3_Picks` - the subject, and the filename without `.csv`. */
export function weeklyPicksStem(week: number): string {
  return `DellaPia_Week${week}_Picks`;
}

export function weeklyPicksSubject(week: number): string {
  return weeklyPicksStem(week);
}

export function weeklyPicksFilename(week: number): string {
  return `${weeklyPicksStem(week)}.csv`;
}

export interface WeeklyEmailInput {
  week: number;
  /** The space-aligned block, from buildSubmissionBlock. */
  table: string;
  /** How many rows the block carries - every live entry. */
  rowCount: number;
  /** Name changes to tell her about, already worded, or none. */
  notes?: string[];
}

/**
 * The plain-text body.
 *
 * The site link appears once, as the anchor text only - the ONE LINK rule
 * (CLAUDE.md): the plain part names the site and carries no address, and the
 * HTML part built from it carries the href. This is a RESULTS link, never a
 * submission instruction, and Lynne is not a player being asked for a pick.
 *
 * No signature. Gmail appends his own when he opens the draft, and a
 * generated one would be this file inventing how he signs off.
 */
export function weeklyPicksBody(input: WeeklyEmailInput): string {
  const { week, table, rowCount, notes = [] } = input;
  const lines = [
    "Hey Lynne,",
    "",
    `Below are my ${rowCount} picks for Week ${week}.`,
  ];
  for (const n of notes) lines.push("", n);
  lines.push(
    "",
    `The pool site is up if you want a look: ${SITE_LINK_TEXT}`,
    "",
    "Picks below and attached:",
    "",
    table,
  );
  return lines.join("\n");
}
