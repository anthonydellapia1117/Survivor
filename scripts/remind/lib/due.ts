// Which week reminder is due, from the weeks table and the ET calendar and
// nothing else.
//
// Anthony's schedule, set 2026-09-10: THREE reminders a week, each sent in the
// morning.
//
//   wed  Wednesday morning, naming the week's EARLY boundary - the deadline
//        the Thursday game's picks close on.
//   thu  Thursday morning, naming the week's LATE boundary - the deadline the
//        Sunday games close on, which is the Friday lock.
//   fri  Friday morning, the FINAL CALL, naming that same LATE boundary.
//
// Thursday and Friday name the SAME boundary, so week + boundary is no longer
// unique and cannot be the once-only key: the key is week + SLOT - week:N:wed,
// week:N:thu, week:N:fri - and the audit-row guard in scripts/lib/send.ts is
// otherwise unchanged.
//
// NOTHING HERE KNOWS AN HOUR. A slot's send day is the ET calendar date of a
// boundary the weeks table holds (wed and fri on their boundary's own day, thu
// on the day before the late one), and the minute the mail goes is the
// pick-reminder cron in scripts/ops/config.json. All eighteen weeks read
// 2:00 PM ET today; every one of them could move without a line of this file
// changing.
//
// Pure, so the schedule is tested without a database.

import type { WeekBoundsRow } from "../../lib/db";

export type BoundaryKind = "early" | "late";

/** The three morning sends of a week, in the order they go out. */
export const SLOT_NAMES = ["wed", "thu", "fri"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** A stored deadline a reminder names. */
export interface Boundary {
  week: number;
  kind: BoundaryKind;
  deadlineIso: string;
}

/** One morning send: which slot it is, and which stored boundary it names. */
export interface ReminderSlot extends Boundary {
  slot: SlotName;
  /** The ET calendar date the slot goes out on, e.g. 2026-09-10. */
  sendDate: string;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 24 * 60 * 60 * 1000;

/** The ET calendar date of an instant, e.g. 2026-09-11. */
export function etDateKey(d: Date): string {
  return ET_DATE.format(d);
}

function at(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Every slot of every week, in send order.
 *
 * The day before the late boundary is taken from the boundary itself rather
 * than from a weekday name: a deadline sits in the middle of its day, so
 * stepping back 24 hours lands on the previous ET date whatever the hour and
 * whichever side of a daylight-saving change the week falls on.
 */
export function slotsOf(weeks: WeekBoundsRow[]): ReminderSlot[] {
  const out: ReminderSlot[] = [];
  for (const w of weeks) {
    if (w.early_deadline_at) {
      out.push({ week: w.week, slot: "wed", kind: "early", deadlineIso: w.early_deadline_at, sendDate: etDateKey(new Date(w.early_deadline_at)) });
    }
    if (w.late_deadline_at) {
      const late = new Date(w.late_deadline_at);
      out.push({ week: w.week, slot: "thu", kind: "late", deadlineIso: w.late_deadline_at, sendDate: etDateKey(new Date(late.getTime() - DAY_MS)) });
      out.push({ week: w.week, slot: "fri", kind: "late", deadlineIso: w.late_deadline_at, sendDate: etDateKey(late) });
    }
  }
  return out.sort(
    (a, b) => a.sendDate.localeCompare(b.sendDate) || at(a.deadlineIso) - at(b.deadlineIso) || SLOT_NAMES.indexOf(a.slot) - SLOT_NAMES.indexOf(b.slot) || a.week - b.week,
  );
}

/**
 * The audit key one reminder is sent under, once: week:N:wed, week:N:thu or
 * week:N:fri. It is the SLOT and never the boundary, because thu and fri name
 * the same boundary and a key built from that would send only one of them.
 */
export function slotKey(s: Pick<ReminderSlot, "week" | "slot">): string {
  return `week:${s.week}:${s.slot}`;
}

/**
 * The slot this run belongs to: the one whose send day is today in ET and
 * whose deadline has not passed. Null when none is - the normal answer on a
 * Saturday, and the right answer on a Friday afternoon, when the lock has
 * already closed and no reminder can help.
 *
 * The hour is deliberately not tested here. A slot is due all of its morning
 * and on into its day; the pick-reminder cron decides the minute the mail
 * goes, and the audit key keeps a second run of the same day from sending
 * again.
 */
export function dueSlot(weeks: WeekBoundsRow[], now: Date): ReminderSlot | null {
  const today = etDateKey(now);
  const t = now.getTime();
  return slotsOf(weeks).find((s) => s.sendDate === today && t < at(s.deadlineIso)) ?? null;
}

/** A named slot for a hand run; null when the week has no such slot. */
export function findSlot(weeks: WeekBoundsRow[], week: number, slot: SlotName): ReminderSlot | null {
  return slotsOf(weeks).find((s) => s.week === week && s.slot === slot) ?? null;
}

/** Whether a string is one of the three slot names. */
export function isSlotName(v: string): v is SlotName {
  return (SLOT_NAMES as readonly string[]).includes(v);
}
