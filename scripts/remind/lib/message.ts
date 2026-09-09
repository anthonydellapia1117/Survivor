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
import type { Boundary } from "./due";

/** The one line the site link may sit on. Exported so the copy guard can name it. */
export const NOT_THE_APP = "You do not make picks in the app. It is there to look at:";

export const SIGNOFF = "- Anthony";

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" });
const ET_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });

function at(iso: string): number {
  return new Date(iso).getTime();
}

/** The ET calendar date, e.g. 2026-09-11. */
export function etDateKey(d: Date): string {
  return ET_DATE.format(d);
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

/** "A and B"; three or more read "A, B and C". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function reminderSubject(b: Boundary, now: Date): string {
  return `Survivor Week ${b.week} - picks due ${relativeDay(b.deadlineIso, now)} at ${clockTime(b.deadlineIso)}`;
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
    out.push(`${what} close${many || !t.gameDay ? "" : "s"} ${relativeDay(t.deadlineIso, now)} at ${clockTime(t.deadlineIso)} ET.`);
  }
  if (now.getTime() < late) {
    const lateTier = tiers.find((t) => at(t.deadlineIso) === late);
    const days = lateTier
      ? DAY_ORDER.filter((d) => games.some((g) => g.week === bounds.week && g.dayOfWeek === d && (lateTier.teams.includes(g.homeTeam) || lateTier.teams.includes(g.awayTeam))))
      : [];
    const what = days.length ? `${joinAnd(days)} games close` : "Everything else closes";
    out.push(`${what} ${relativeDay(bounds.lateDeadlineAt, now)} at ${clockTime(bounds.lateDeadlineAt)} ET.`);
  }
  return out;
}

export function reminderBody(b: Boundary, bounds: WeekBounds, games: GameLite[], now: Date): string {
  const tiers = openTiers(games, bounds, now);
  const deadlines = deadlineSentences(tiers, bounds, games, now).join(" ");
  return [
    `Week ${b.week} is here.`,
    "",
    `${deadlines} No pick in by the deadline and you are out.`,
    "",
    `Reply to this email with your team - reply to me, not reply all. Or text ${CONTACT_PHONE}. Email is better.`,
    "",
    "More than one entry means one team for each.",
    "",
    `${NOT_THE_APP} ${SITE_URL}`,
    "",
    SIGNOFF,
  ].join("\n");
}
