// The week reminder's subject and body, built from the week's deadlines and
// the clock and nothing else. Plain text, hyphens only. The wording is
// Anthony's Week 1 reminder of 2026-09-09, generalised: every deadline
// sentence is derived from the games and the stored boundaries, so the text
// is right in Week 12 (three early tiers) and Week 16 (Christmas) without a
// special case anywhere.
//
// This is the one player-facing message that may carry the site link, and
// only on the line that says picks are not made there (CLAUDE.md, set by
// Anthony on 2026-09-09). tests/unit/player-copy-submit-path.test.ts holds it
// to that.

import type { GameDay } from "@/lib/data/types";
import { CONTACT_PHONE } from "@/lib/emails/pick-request";
import { SITE_URL } from "../../lib/constants";
import { fullTeamName, joinOr, openTiers, type Tier } from "../../chase/lib/message";
import type { GameLite, WeekBounds } from "../../picks/lib/deadline";
import { etDateKey, type Boundary, type SlotName } from "./due";

/**
 * What one reminder names: a stored boundary, and - when the caller is one of
 * the three morning slots - which slot it is. Only the Friday slot changes a
 * word: it is the FINAL CALL, and it says so.
 */
export interface ReminderTarget extends Boundary {
  slot?: SlotName;
}

/** The Friday slot's mark, in the subject and on the first line. */
export const FINAL_CALL = "FINAL CALL";

/** The one line the site link may sit on. Exported so the copy guard can name it. */
export const NOT_THE_APP = "You do not make picks in the app. It is there to look at:";

export const SIGNOFF = "- Anthony";

const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" });
const ET_LONG_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
const ET_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });

function at(iso: string): number {
  return new Date(iso).getTime();
}

/** "today", "tomorrow", or the weekday name, judged on the ET calendar. */
export function relativeDay(deadlineIso: string, now: Date): string {
  const target = etDateKey(new Date(deadlineIso));
  if (target === etDateKey(now)) return "today";
  if (target === etDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return "tomorrow";
  return ET_WEEKDAY.format(new Date(deadlineIso));
}

/** "2 PM", "noon", or "12:30 PM": the clock time in ET, as a person writes it. */
export function clockTime(iso: string): string {
  const p = Object.fromEntries(ET_CLOCK.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  if (p.hour === "12" && p.minute === "00" && p.dayPeriod === "PM") return "noon";
  return p.minute === "00" ? `${p.hour} ${p.dayPeriod}` : `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "Friday September 11": the deadline's own date in ET, no comma after the day. */
export function longDate(iso: string): string {
  const p = Object.fromEntries(ET_LONG_DATE.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}`;
}

/**
 * When a deadline falls, as a sentence says it: "tomorrow, Friday September 11,"
 * on the two days a relative word is clearer than a date, and the plain date
 * otherwise. The relative word alone is what this used to say, and it is what
 * a reminder read at the wrong hour gets wrong - "tomorrow" in a message
 * somebody opens on Friday morning points at Saturday. The date is derived
 * from the stored boundary like everything else here; no day name is written
 * down anywhere.
 */
export function whenPhrase(deadlineIso: string, now: Date): string {
  const rel = relativeDay(deadlineIso, now);
  const date = longDate(deadlineIso);
  return rel === "today" || rel === "tomorrow" ? `${rel}, ${date},` : date;
}

/** "A and B"; three or more read "A, B and C". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function reminderSubject(b: ReminderTarget, now: Date): string {
  const mark = b.slot === "fri" ? `${FINAL_CALL}, ` : "";
  return `Survivor Week ${b.week} - ${mark}picks due ${relativeDay(b.deadlineIso, now)} at ${clockTime(b.deadlineIso)}`;
}

const DAY_ORDER: GameDay[] = ["Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday"];

/**
 * One sentence per deadline still ahead: each early tier by its game day,
 * then the late lock with the days it closes. A tier whose deadline has
 * passed is left out rather than described - a reminder must not tell
 * someone a closed window is open.
 */
export function deadlineSentences(tiers: Tier[], bounds: WeekBounds, games: GameLite[], now: Date): string[] {
  const late = at(bounds.lateDeadlineAt);
  const out: string[] = [];
  for (const t of tiers) {
    if (t.teams.length === 0 || at(t.deadlineIso) >= late) continue;
    const many = t.teams.length > 2;
    const what = t.gameDay ? `${t.gameDay}'s game${many ? "s" : ""}` : joinOr(t.teams.map(fullTeamName));
    out.push(`${what} close${many || !t.gameDay ? "" : "s"} ${whenPhrase(t.deadlineIso, now)} at ${clockTime(t.deadlineIso)} ET.`);
  }
  if (now.getTime() < late) {
    const lateTier = tiers.find((t) => at(t.deadlineIso) === late);
    const days = lateTier
      ? DAY_ORDER.filter((d) => games.some((g) => g.week === bounds.week && g.dayOfWeek === d && (lateTier.teams.includes(g.homeTeam) || lateTier.teams.includes(g.awayTeam))))
      : [];
    const what = days.length ? `${joinAnd(days)} games close` : "Everything else closes";
    out.push(`${what} ${whenPhrase(bounds.lateDeadlineAt, now)} at ${clockTime(bounds.lateDeadlineAt)} ET.`);
  }
  return out;
}

/**
 * The numbers a reminder states, derived on the run and never stored. There is
 * one today; it is an object rather than another positional argument so the
 * next fact cannot be added as an optional one that silently defaults to off.
 */
export interface ReminderFacts {
  /** Live entries with no current pick for this week. 0 prints no line. */
  outstanding: number;
}

export function reminderBody(b: ReminderTarget, bounds: WeekBounds, games: GameLite[], now: Date, facts: ReminderFacts): string {
  const tiers = openTiers(games, bounds, now);
  const deadlines = deadlineSentences(tiers, bounds, games, now).join(" ");
  // Naming the number is the nudge: somebody who has picked reads it as news,
  // somebody who has not reads it as a crowd they are standing in. It is
  // counted on the run, so it is right or it is absent - never a stale figure.
  const outstanding = facts.outstanding > 0
    ? [`${facts.outstanding} ${facts.outstanding === 1 ? "entry" : "entries"} still ${facts.outstanding === 1 ? "has" : "have"} no Week ${b.week} pick.`, ""]
    : [];
  return [
    b.slot === "fri" ? `Week ${b.week} - ${FINAL_CALL}.` : `Week ${b.week} is here.`,
    "",
    `${deadlines} No pick in by the deadline and you are out.`,
    "",
    ...outstanding,
    `Reply to this email with your team - reply to me, not reply all. Or text ${CONTACT_PHONE}. Email is better.`,
    "",
    "More than one entry means one team for each.",
    "",
    `${NOT_THE_APP} ${SITE_URL}`,
    "",
    SIGNOFF,
  ].join("\n");
}
