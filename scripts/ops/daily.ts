// The daily entry point: one run, one read of the roster, six reporters.
//
// This replaces the six claude.ai Routines of docs/ROUTINES.md sections 3-7.
// Each of those fired its own fresh session with Gmail and the repo and NO
// database (section 1b), and worked the roster out of mail. These read it.
//
// WHY THE SPLIT IS SWEEP-HOURLY / EVERYTHING-ELSE-DAILY. The picks intake has
// to run every hour - a reply that lands at 1:15 has to be recorded before a
// 2:00 deadline - and the two sending jobs are tied to a boundary six hours
// out, so they need the hour too. That is what `npm run ops -- hourly` is, and
// it is what it has always been: the tick, renamed to say when it runs.
// Reporting is not hour-sensitive. Nothing here writes, sends, labels, marks
// Paid, resolves an identity or resolves a variance; it prints what a person
// has to decide, once a day, in twelve lines per reporter.
//
//   npm run ops -- daily              the six reporters
//   npm run ops -- hourly             every scheduled job due in the last hour
//   npm run ops -- tick               the old name for hourly, still accepted

import { renderReport, reportSummary, type Report } from "./lib/report";
import { loadSnapshot } from "./snapshot";
import type { OpsSnapshot, ReporterFn } from "./reporters/types";
import { reportPickGap } from "./reporters/pick-gap";
import { reportDeadlineClose } from "./reporters/deadline-close";
import { reportLynneEcho } from "./reporters/lynne-echo";
import { reportSheetWatch } from "./reporters/sheet-watch";
import { reportMoneyWatch } from "./reporters/money-watch";
import { reportRosterIntegrity } from "./reporters/roster-integrity";

/**
 * Ordered by what costs money or a week if it is missed.
 *
 * roster-integrity is first because the recipient count gate stops every
 * whole-roster message dead, so a mismatch there means nobody is being mailed
 * at all; pick-gap and deadline-close are next because a missing or late pick
 * takes a loss at the Friday boundary. money-watch is last: a payment has no
 * deadline.
 */
export const REPORTERS: { name: string; run: ReporterFn }[] = [
  { name: "roster-integrity", run: reportRosterIntegrity },
  { name: "pick-gap", run: reportPickGap },
  { name: "deadline-close", run: reportDeadlineClose },
  { name: "lynne-echo", run: reportLynneEcho },
  { name: "sheet-watch", run: reportSheetWatch },
  { name: "money-watch", run: reportMoneyWatch },
];

export interface DailyOutcome {
  name: string;
  lines: string[];
  summary: string;
  /** Set when the reporter threw. One failing reporter never silences the other five. */
  error?: string;
}

/**
 * Every reporter against one snapshot.
 *
 * A reporter that throws is reported as a failure and the rest still run: the
 * whole point of a daily report is that it arrives, and five reports plus a
 * named failure is worth more than a stack trace and nothing. That is the same
 * reasoning as ops issue #40 - a job that never started must not read as a
 * clean run.
 */
export function runReporters(s: OpsSnapshot): DailyOutcome[] {
  return REPORTERS.map(({ name, run }) => {
    try {
      const r: Report = run(s);
      return { name, lines: renderReport(r), summary: reportSummary(r) };
    } catch (e: unknown) {
      const why = e instanceof Error ? e.message : String(e);
      return {
        name,
        lines: ["NEEDS ANTHONY", `${name} could not run: ${why} - the other reporters below still ran`],
        summary: `${name}: FAILED`,
        error: why,
      };
    }
  });
}

export function renderDaily(outcomes: DailyOutcome[], now: Date): string[] {
  const out: string[] = [`Survivor daily - ${now.toISOString()}`];
  for (const o of outcomes) {
    out.push("", `## ${o.name}`, ...o.lines);
  }
  return out;
}

export async function runDaily(deps: {
  client: Parameters<typeof loadSnapshot>[0];
  gmail: Parameters<typeof loadSnapshot>[2];
  now: Date;
}): Promise<{ outcomes: DailyOutcome[]; lines: string[]; needsAnthony: number; failed: number }> {
  const snapshot = await loadSnapshot(deps.client, deps.now, deps.gmail);
  const outcomes = runReporters(snapshot);
  return {
    outcomes,
    lines: renderDaily(outcomes, deps.now),
    needsAnthony: outcomes.filter((o) => !o.error && o.lines[0] === "NEEDS ANTHONY").length,
    failed: outcomes.filter((o) => o.error).length,
  };
}
