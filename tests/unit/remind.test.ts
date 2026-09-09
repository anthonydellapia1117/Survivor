import { describe, expect, it } from "vitest";
import type { EntryRow, OwnerRow, WeekBoundsRow } from "../../scripts/lib/db";
import { EXPECTED_ROSTER_ADDRESSES } from "../../scripts/lib/constants";
import { readFileSync } from "node:fs";
import { boundariesOf, boundaryKey, dueBoundary, findBoundary } from "../../scripts/remind/lib/due";
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
    expect(EXPECTED_ROSTER_ADDRESSES).toBe(39);
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

describe("which boundary is due", () => {
  it("lists both boundaries of every week, earliest first, under their keys", () => {
    expect(boundariesOf(WEEKS).map(boundaryKey)).toEqual(["week:1:early", "week:1:late", "week:2:early", "week:2:late"]);
  });

  it("is the boundary whose six-hour window holds now, and nothing outside it", () => {
    // Week 1 early is Wed 2 PM ET: due from 8 AM ET to 2 PM ET, not before, not after.
    expect(dueBoundary(WEEKS, new Date("2026-09-09T11:59:59Z"), 6)).toBeNull();
    expect(dueBoundary(WEEKS, new Date("2026-09-09T12:00:00Z"), 6)?.kind).toBe("early");
    expect(dueBoundary(WEEKS, new Date("2026-09-09T17:59:59Z"), 6)?.kind).toBe("early");
    expect(dueBoundary(WEEKS, new Date("2026-09-09T18:00:00Z"), 6)).toBeNull();
    // Friday 8 AM ET: the late one.
    expect(dueBoundary(WEEKS, new Date("2026-09-11T12:30:00Z"), 6)).toMatchObject({ week: 1, kind: "late" });
    // Thursday: nothing, whatever the week.
    expect(dueBoundary(WEEKS, new Date("2026-09-10T15:00:00Z"), 6)).toBeNull();
  });

  it("takes the lead from its caller and has no default of its own", () => {
    // The lead lives in scripts/ops/config.json. A second copy in due.ts was a
    // constant a reviewed change to the config would not have moved (#41), so
    // the argument is required and the window actually follows it.
    const eightHoursBefore = new Date("2026-09-09T10:00:00Z");
    expect(dueBoundary(WEEKS, eightHoursBefore, 6)).toBeNull();
    expect(dueBoundary(WEEKS, eightHoursBefore, 8)?.kind).toBe("early");
    // No default: calling it without a lead is a type error, and a nonsense
    // lead is refused rather than silently treated as six hours.
    expect(() => dueBoundary(WEEKS, eightHoursBefore, 0)).toThrow(/positive number of hours/);
    expect(() => dueBoundary(WEEKS, eightHoursBefore, Number.NaN)).toThrow(/positive number of hours/);
    // The command reads the config and passes it; it holds no literal lead.
    const cli = readFileSync("scripts/remind/cli.ts", "utf8");
    expect(cli).toMatch(/loadOpsConfig\(\)\.reminderLeadHours/);
    expect(cli).toMatch(/dueBoundary\(weeks, now, leadHours\)/);
    expect(cli).not.toMatch(/REMINDER_LEAD_HOURS/);
    expect(readFileSync("scripts/remind/lib/due.ts", "utf8")).not.toMatch(/REMINDER_LEAD_HOURS/);
  });

  it("finds a named boundary for a hand run and nothing for a week without one", () => {
    expect(findBoundary(WEEKS, 2, "late")?.deadlineIso).toBe("2026-09-18T16:00:00+00:00");
    expect(findBoundary(WEEKS, 3, "early")).toBeNull();
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
const EARLY = { week: 1, kind: "early" as const, deadlineIso: BOUNDS.earlyDeadlineAt };
const LATE = { week: 1, kind: "late" as const, deadlineIso: BOUNDS.lateDeadlineAt };
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
  });

  it("derives the deadline sentences from the games and the boundaries, leaving out a tier that has closed", () => {
    // Wednesday 8 AM ET: the Wednesday game closed Tuesday and is not
    // described; the Thursday game closes today; the weekend closes Friday.
    const early = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM);
    expect(early).toContain("Thursday's game closes today at 2 PM ET. Sunday and Monday games close Friday at 2 PM ET. No pick in by the deadline and you are out.");
    expect(early).not.toContain("Wednesday");
    // Friday 8 AM ET: only the lock is ahead.
    const late = reminderBody(LATE, BOUNDS, GAMES, FRI_8AM);
    expect(late).toContain("Sunday and Monday games close today at 2 PM ET. No pick in by the deadline and you are out.");
    expect(late).not.toContain("Thursday");
  });

  it("carries the whole of Anthony's text: reply to me, the number, one team per entry, the link only on the not-the-app line", () => {
    const body = reminderBody(EARLY, BOUNDS, GAMES, WED_8AM);
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
