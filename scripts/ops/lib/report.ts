// The output contract every daily reporter keeps.
//
// docs/ROUTINES.md section 1d set it for the six claude.ai Routines these
// replace: twelve lines or fewer, either a section headed NEEDS ANTHONY with
// one line per item - the exact question, and the deadline it is tied to
// where one applies - or the two words NO ACTION alone. No narration and no
// list of what was fine.
//
// One rule from that section is load-bearing and is enforced here rather than
// left to each reporter: WHEN A LIST WOULD PASS THE CAP IT COLLAPSES INTO ONE
// LINE THAT LEADS WITH THE COUNT AND KEEPS EVERY NAME. A name is never
// dropped to fit. The cap yields to completeness, never the other way round.
//
// What changed in the move from a Routine to this file: a Routine had Gmail,
// the repo and the clock, and no database at all (section 1b). These run as
// the admin through the same RLS session every other command uses, so they
// read the live roster, the live picks and her loaded sheet directly instead
// of inferring them from mail. Everything they were forbidden to do, they
// still do not do: nothing here writes, sends, labels, marks Paid, resolves
// an identity, or resolves a variance.

export const MAX_LINES = 12;

export interface ReportItem {
  /** The line itself: the exact question, not a description of one. */
  text: string;
  /**
   * Names this item carries. On overflow the line collapses but every one of
   * these survives into the collapsed line.
   */
  names?: string[];
}

export interface Report {
  /** The reporter's name, for the run summary. */
  job: string;
  items: ReportItem[];
  /** Printed once above the items when there is at least one. */
  preamble?: string;
}

/**
 * A report as the lines it prints.
 *
 * Empty items give exactly ["NO ACTION"]. Otherwise a NEEDS ANTHONY heading,
 * the preamble if there is one, then the items - collapsed from the end while
 * the whole thing would pass the cap, each collapse naming its count and
 * keeping every name it carried.
 */
export function renderReport(r: Report): string[] {
  if (r.items.length === 0) return ["NO ACTION"];
  const head = ["NEEDS ANTHONY", ...(r.preamble ? [r.preamble] : [])];
  if (head.length + r.items.length <= MAX_LINES) {
    return [...head, ...r.items.map((i) => i.text)];
  }
  // One line goes to the collapsed remainder, so at least one item is still
  // shown whole however tight the cap is.
  const shown = Math.max(1, MAX_LINES - head.length - 1);
  const kept = r.items.slice(0, shown);
  const rest = r.items.slice(shown);
  const names = rest.flatMap((i) => i.names ?? []);
  // Completeness beats the cap: every name in the tail is on the line, however
  // long that makes it. Dropping one is how an entry stops being chased.
  const line = names.length
    ? `${rest.length} more: ${names.join(", ")}`
    : `${rest.length} more, see the run output`;
  return [...head, ...kept.map((i) => i.text), line];
}

/** The one line a run posts through notify, from a report. */
export function reportSummary(r: Report): string {
  return r.items.length === 0 ? `${r.job}: NO ACTION` : `${r.job}: ${r.items.length} for Anthony`;
}
