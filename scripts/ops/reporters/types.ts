// What the six daily reporters are handed, and what they give back.
//
// Each reporter is a PURE function: this input in, a Report out. Nothing in
// scripts/ops/reporters reads Gmail, opens a database connection, or writes
// anything - scripts/ops/daily.ts gathers the input once and hands the same
// snapshot to every one of them. That is what makes them testable against a
// fixture instead of against a live season, and it is why none of them can
// write, send, label, mark Paid, resolve an identity or resolve a variance
// even by accident.
//
// These replace the six claude.ai Routines of docs/ROUTINES.md. Those had
// Gmail, the repo and the clock and no database at all (section 1b), so they
// inferred the roster from mail. These read it.

import type { Report } from "../lib/report";

export interface EntrySnapshot {
  id: string;
  entryName: string;
  lynneNumber: number | null;
  ownerName: string;
  ownerEmail: string | null;
  playerEmail: string | null;
  isFreeEntry: boolean;
  isGifted: boolean;
  /** Null when the entry has not been sent to her yet. */
  submittedToLynneAt: string | null;
  submittedAsName: string | null;
}

export interface PickSnapshot {
  entryId: string;
  week: number;
  team: string;
  submittedAt: string;
  late: boolean;
  source: string;
}

export interface WeekSnapshot {
  week: number;
  earlyDeadlineAt: string;
  lateDeadlineAt: string;
}

export interface GameSnapshot {
  week: number;
  dayOfWeek: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
}

/** One of her rows on the newest loaded sheet. */
export interface HerRowSnapshot {
  rowNo: number;
  names: string;
  /** Her week columns, week number to the text she wrote. */
  cells: Record<number, string>;
  /** Where each of those weeks came from: "sheet" or "email". */
  cellSources: Record<number, string>;
}

export interface PaymentSnapshot {
  /** NULL means unmatched - a receipt in quarantine, a meaningful value and not a missing one. */
  ownerId: string | null;
  amountCents: number;
  /** Exactly as stored. Never constructed, and never a Gmail id. */
  venmoTxnId: string | null;
  /** payments.paid_on, a DATE. There is no paid_at column on this table. */
  paidOn: string | null;
  /** Her memo as recorded, verbatim; it is what makes a split readable ("1 of 2"). */
  note: string | null;
}

export interface OwnerSnapshot {
  id: string;
  name: string;
  email: string | null;
  entryCount: number;
  dueCents: number;
  paidCents: number;
}

/** Her sheet as loaded, for the watch that asks whether a newer one is waiting. */
export interface SheetSnapshot {
  sha256: string;
  sourceFile: string;
  gmailMessageId: string | null;
  loadedAt: string;
  rowCount: number;
}

/** A Football .xlsx sitting in Gmail, whether or not it has been loaded. */
export interface HerMailSnapshot {
  messageId: string;
  subject: string;
  receivedAt: string;
  filenames: string[];
  hasAttachment: boolean;
}

export interface OpsSnapshot {
  now: Date;
  weeks: WeekSnapshot[];
  games: GameSnapshot[];
  entries: EntrySnapshot[];
  /** Current picks only, every week. */
  picks: PickSnapshot[];
  herRows: HerRowSnapshot[];
  herSheet: SheetSnapshot | null;
  /** Null when Gmail is not configured for this run; a reporter says so rather than reporting nothing. */
  herMail: HerMailSnapshot[] | null;
  owners: OwnerSnapshot[];
  payments: PaymentSnapshot[];
  /** Every address the whole-roster messages derive live, lowercased, once each. */
  recipientAddresses: string[];
  /** The count those messages gate on, from scripts/ops/config.json. */
  expectedRosterAddresses: number;
  freeEntryCount: number;
  recruitedCount: number;
  lynneRateCents: number;
}

export type ReporterFn = (s: OpsSnapshot) => Report;

/**
 * The open week: the lowest week whose late deadline has not passed. Null once
 * every week has locked. Every reporter that needs a week takes it from here,
 * so none of them carries a calendar of its own.
 */
export function openWeek(s: Pick<OpsSnapshot, "weeks" | "now">): number | null {
  let best: number | null = null;
  for (const w of s.weeks) {
    if (new Date(w.lateDeadlineAt).getTime() < s.now.getTime()) continue;
    if (best === null || w.week < best) best = w.week;
  }
  return best;
}

/**
 * The deadline governing a pick for `team` in `week`, from the week's two
 * stored boundaries and the day its game falls on. Mirrors pickDeadlineIso in
 * src/lib/deadlines.ts and pick_deadline() in SQL: a Wednesday game closes a
 * day before the early boundary, Thursday is it, Friday a day after, and
 * Saturday, Sunday and Monday share the late boundary. A team with no game
 * that week - a bye - takes the late boundary, same as both other copies.
 */
export function deadlineFor(s: Pick<OpsSnapshot, "weeks" | "games">, week: number, team: string | null): string | null {
  const w = s.weeks.find((x) => x.week === week);
  if (!w) return null;
  if (!team) return w.lateDeadlineAt;
  const g = s.games.find((x) => x.week === week && (x.homeTeam === team || x.awayTeam === team));
  if (!g) return w.lateDeadlineAt;
  const DAY = 86_400_000;
  const early = new Date(w.earlyDeadlineAt).getTime();
  if (g.dayOfWeek === "Wednesday") return new Date(early - DAY).toISOString();
  if (g.dayOfWeek === "Thursday") return w.earlyDeadlineAt;
  if (g.dayOfWeek === "Friday") return new Date(early + DAY).toISOString();
  return w.lateDeadlineAt;
}

/** "Fri 2:00 PM ET", for a line that names the deadline it is tied to. */
export function etLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
  return `${day} ${time} ET`;
}

export type { Report };
