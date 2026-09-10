import { describe, expect, it } from "vitest";
import type { EntryRow, OwnerRow, WeekBoundsRow } from "../../scripts/lib/db";
import { EXPECTED_ROSTER_ADDRESSES } from "../../scripts/lib/constants";
import { readFileSync } from "node:fs";
import { dueSlot, findSlot, slotKey, slotsOf } from "../../scripts/remind/lib/due";
import { countGate, reminderAddresses } from "../../scripts/remind/lib/recipients";
import {
  clockTime,
  NOT_THE_APP,
  relativeDay,
  reminderBody,
  reminderSubject,
} from "../../scripts/remind/lib/message";
import type { GameLite, WeekBounds } from "../../scripts/picks/lib/deadline";

// The week reminder is driven by the weeks table and the live roster and
// nothing typed by hand. Every piece that decides who, when and what is pure
// and tested here; the CLI only wires them together.

// ----------------------------------------------------------- recipients
const owner = (id: string, email: string | null, status = "confirmed"): OwnerRow => ({
  id,
  first_name: id,
  last_name: "X",
  email,
  participation_status: status,
});
const entry = (id: string, owner_id: string, player_email: string | null = null, voided_at: string | null = null): EntryRow => ({
  id,
  owner_id,
  entry_name: id,
  player_email,
  is_gifted: player_email !== null,
  is_free_entry: false,
  lynne_number: null,
  lynne_label: null,
  voided_at,
});

describe("who the reminder goes to", () => {
  it("takes every owner address and every player_email on a live entry, lowercased, once each", () => {
    const owners = [
      owner("kris", "Kris@Example.com"),
      owner("ray", "ray@example.com"),
      owner("declined", "gone@example.com", "declined"),
      owner("noentries", "idle@example.com"),
      owner("admin", "anthonydellapia@gmail.com"),
    ];
    const entries = [
      entry("k1", "kris"),
      entry("k2", "kris", "chas@example.com"),
      entry("r1", "ray", "JMVAS@example.com"),
      entry("r2", "ray", "jmvas@example.com"),
      entry("d1", "declined"),
      entry("v1", "kris", "voided@example.com", "2026-09-04T00:00:00Z"),
      entry("aaa1", "admin"),
    ];
    expect(reminderAddresses(owners, entries)).toEqual([
      "anthonydellapia@gmail.com",
      "chas@example.com",
      "jmvas@example.com",
      "kris@example.com",
      "ray@example.com",
    ]);
  });

  it("the expected count is the one Anthony set", () => {
    expect(EXPECTED_ROSTER_ADDRESSES).toBe(40);
  });
});

describe("the count gate", () => {
  it("passes only on the exact number", () => {
    const three = ["a@x.com", "b@x.com", "c@x.com"];
    expect(countGate(3, three).ok).toBe(true);
    expect(countGate(2, three)).toMatchObject({ ok: false, expected: 2, actual: 3, delta: 1 });
    expect(countGate(4, three)).toMatchObject({ ok: false, expected: 4, actual: 3, delta: -1 });
  });

  it("prints the arithmetic and, on a mismatch, every address", () => {
    const g = countGate(2, ["a@x.com", "b@x.com", "c@x.com"]);
    expect(g.lines[0]).toBe("expected recipients: 2");
    expect(g.lines[1]).toBe("derived from the live roster: 3");
    expect(g.lines[2]).toBe("delta: +1");
    expect(g.lines.filter((l) => l.includes("@x.com"))).toHaveLength(3);
    // A pass prints the arithmetic and no list: nothing to look for.
    expect(countGate(3, ["a@x.com", "b@x.com", "c@x.com"]).lines.some((l) => l.includes("@"))).toBe(false);
  });
});

// -------------------------------------------------------------- the clock
const WEEKS: WeekBoundsRow[] = [
  { week: 1, early_deadline_at: "2026-09-09T18:00:00+00:00", late_deadline_at: "2026-09-11T18:00:00+00:00" },
  { week: 2, early_deadline_at: "2026-09-16T16:00:00+00:00", late_deadline_at: "2026-09-18T16:00:00+00:00" },
];

describe("which slot is due", () => {
  // Three a week, each on its own morning: wed names the early boundary, thu
  // the late one, fri the final call on that same late one (Anthony,
  // 2026-09-10). tests/unit/remind-slots.test.ts is the full account of the
  // schedule; what is here is what this file already covered.
  it("lists all three slots of every week, in send order, under their keys", () => {
    expect(slotsOf(WEEKS).map(slotKey)).toEqual([
      "week:1:wed",
      "week:1:thu",
      "week:1:fri",
      "week:2:wed",
      "week:2:thu",
      "week:2:fri",
    ]);
  });

  it("is today's slot on the ET calendar, and nothing once its deadline has passed", () => {
    // Week 1 early is Wed 2 PM ET (18:00Z): the Wednesday slot runs all
    // morning and stops at the deadline it names.
    expect(dueSlot(WEEKS, new Date("2026-09-09T12:00:00Z"))?.slot).toBe("wed");
    expect(dueSlot(WEEKS, new Date("2026-09-09T17:59:59Z"))?.slot).toBe("wed");
    expect(dueSlot(WEEKS, new Date("2026-09-09T18:00:00Z"))).toBeNull();
    // Thursday and Friday both name the late boundary and are two sends.
    expect(dueSlot(WEEKS, new Date("2026-09-10T15:00:00Z"))).toMatchObject({ week: 1, slot: "thu", kind: "late" });
    expect(dueSlot(WEEKS, new Date("2026-09-11T12:30:00Z"))).toMatchObject({ week: 1, slot: "fri", kind: "late" });
    // Tuesday: nothing, whatever the week.
    expect(dueSlot(WEEKS, new Date("2026-09-08T15:00:00Z"))).toBeNull();
  });

  it("holds no clock of its own: the command reads the weeks table and no lead", () => {
    // The lead lives in scripts/ops/config.json and used to be what triggered
    // a run (#41). Under the three-slot schedule the ET calendar decides which
    // slot a run belongs to and the pick-reminder cron decides the minute, so
    // the command reads neither an hour nor a lead.
    const cli = readFileSync("scripts/remind/cli.ts", "utf8");
    expect(cli).toMatch(/dueSlot\(weeks, now\)/);
    expect(cli).not.toMatch(/reminderLeadHours/);
    expect(cli).not.toMatch(/REMINDER_LEAD_HOURS/);
    expect(readFileSync("scripts/remind/lib/due.ts", "utf8")).not.toMatch(/REMINDER_LEAD_HOURS/);
  });

  it("finds a named slot for a hand run and nothing for a week without one", () => {
    expect(findSlot(WEEKS, 2, "fri")?.deadlineIso).toBe("2026-09-18T16:00:00+00:00");
    expect(findSlot(WEEKS, 3, "wed")).toBeNull();
  });
});

// ---------------------------------------------------------------- the text
const BOUNDS: WeekBounds = { week: 1, earlyDeadlineAt: "2026-09-09T18:00:00+00:00", lateDeadlineAt: "2026-09-11T18:00:00+00:00" };
const GAMES: GameLite[] = [
  { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE" },
  { week: 1, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "KC", awayTeam: "LAC" },
  { week: 1, dayOfWeek: "Monday", homeTeam: "BUF", awayTeam: "NYJ" },
];
const EARLY = { week: 1, kind: "early" as const, slot: "wed" as const, deadlineIso: BOUNDS.earlyDeadlineAt };
const LATE = { week: 1, kind: "late" as const, slot: "thu" as const, deadlineIso: BOUNDS.lateDeadlineAt };
const FINAL = { week: 1, kind: "late" as const, slot: "fri" as const, deadlineIso: BOUNDS.lateDeadlineAt };
const WED_8AM = new Date("2026-09-09T12:00:00Z");
const FRI_8AM = new Date("2026-09-11T12:00:00Z");

describe("the reminder's words", () => {
  it("writes the clock the way a person does", () => {
    expect(clockTime("2026-09-09T18:00:00Z")).toBe("2 PM");
    expect(clockTime("2026-09-09T16:00:00Z")).toBe("noon");
    expect(clockTime("2026-09-09T16:30:00Z")).toBe("12:30 PM");
    expect(relativeDay("2026-09-09T18:00:00Z", WED_8AM)).toBe("today");
    expect(relativeDay("2026-09-10T18:00:00Z", WED_8AM)).toBe("tomorrow");
    expect(relativeDay("2026-09-11T18:00:00Z", WED_8AM)).toBe("Friday");
  });

  it("subject begins Survivor Week N and names the boundary's own day and time", () => {
    expect(reminderSubject(EARLY, WED_8AM)).toBe("Survivor Week 1 - picks due today at 2 PM");
    expect(reminderSubject(LATE, WED_8AM)).toBe("Survivor Week 1 - picks due Friday at 2 PM");
    expect(reminderSubject(LATE, FRI_8AM)).toBe("Survivor Week 1 - picks due today at 2 PM");
    // Only the Friday slot is the final call.
    expect(reminderSubject(FINAL, FRI_8AM)).toBe("Survivor Week 1 - FINAL CALL, picks due today at 2 PM");
  });

  it("derives the deadline sentences from the games and the boundaries, leaving out a tier that has closed", () => {
    // Wednesday 8 AM ET: the Wednesday game closed Tuesday and is not
    // described; the Thursday game closes today; the weekend closes Friday.
    const early = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM, { outstanding: 0 });
    expect(early).toContain("Thursday's game closes today, Wednesday September 9, at 2 PM ET. Sunday and Monday games close Friday September 11 at 2 PM ET. No pick in by the deadline and you are out.");
    // The closed tier is not DESCRIBED. The word "Wednesday" itself now appears
    // in the date of the deadline that is open, so the assertion names the
    // phrase that would mean the closed tier came back, not the day name.
    expect(early).not.toContain("Wednesday's game");
    // Friday 8 AM ET: only the lock is ahead.
    const late = reminderBody(FINAL, BOUNDS, GAMES, FRI_8AM, { outstanding: 0 });
    expect(late).toContain("Sunday and Monday games close today, Friday September 11, at 2 PM ET. No pick in by the deadline and you are out.");
    expect(late).not.toContain("Thursday");
  });

  it("states how many entries are still unpicked, counted on the run, and says nothing when none are", () => {
    // The number is derived every run and passed in; there is nowhere to store
    // it, so it cannot go stale. It is a nudge, not a report: at zero the line
    // is absent rather than reading "0 entries".
    const many = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM, { outstanding: 59 });
    expect(many).toContain("59 entries still have no Week 1 pick.");
    // One entry gets singular verbs, or the line reads like a machine wrote it.
    const one = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM, { outstanding: 1 });
    expect(one).toContain("1 entry still has no Week 1 pick.");
    expect(one).not.toContain("entries still have");
    // Zero prints no line at all, and leaves no double blank behind it.
    const none = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM, { outstanding: 0 });
    expect(none).not.toMatch(/no Week 1 pick/);
    expect(none).not.toContain("\n\n\n");
    // It sits between the deadlines and the how-to-reply line, which is where
    // somebody reading on a phone meets it before they are told what to do.
    const lines = many.split("\n").filter((l) => l !== "");
    expect(lines[2]).toBe("59 entries still have no Week 1 pick.");
    expect(lines[3]).toMatch(/^Reply to this email/);
  });

  it("names the DATE of every deadline, not only the relative day", () => {
    // "tomorrow" in a message somebody opens the next morning points at the
    // wrong day. The date comes from the stored boundary; no day is hardcoded.
    const early = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM, { outstanding: 0 });
    expect(early).toContain("closes today, Wednesday September 9, at 2 PM ET");
    expect(early).toContain("close Friday September 11 at 2 PM ET");
    const final = reminderBody(FINAL, BOUNDS, GAMES, FRI_8AM, { outstanding: 0 });
    expect(final).toContain("close today, Friday September 11, at 2 PM ET");
  });

  it("carries the whole of Anthony's text: reply to me, the number, one team per entry, the link only on the not-the-app line", () => {
    const body = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM, { outstanding: 0 });
    const lines = body.split("\n");
    expect(lines[0]).toBe("Week 1 is here.");
    expect(body).toContain("Reply to this email with your team - reply to me, not reply all. Or text 215-384-8335. Email is better.");
    expect(body).toContain("More than one entry means one team for each.");
    const linkLines = lines.filter((l) => l.includes("ad-26-survivor.vercel.app"));
    expect(linkLines).toEqual([`${NOT_THE_APP} https://ad-26-survivor.vercel.app`]);
    expect(lines[lines.length - 1]).toBe("- Anthony");
    // Hyphens only, nothing else in the dash family.
    expect(body).not.toMatch(/[–—]/);
  });
});
