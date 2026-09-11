// Which week /admin/picks opens on.
//
// The rule Anthony set on 2026-09-11: the default holds the current week until
// that week's first MAIN-SLATE game has kicked off, then rolls. Not the
// deadline, which is what it used to read and what made him fight the selector
// back every time a straggler came in on Friday evening.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultPickWeek, weekRollsAt } from "@/lib/default-week";
import type { GameRow, WeekRow } from "@/lib/data/types";

const week = (n: number, early: string, late: string): WeekRow => ({
  week: n,
  windowLabel: "sat_mon",
  deadlineAt: late,
  earlyDeadlineAt: early,
  lateDeadlineAt: late,
  resultsFinal: false,
  confirmed: false,
});

let id = 0;
const game = (wk: number, day: GameRow["dayOfWeek"], kickoffAt: string): GameRow => ({
  id: `g${++id}`,
  week: wk,
  kickoffAt,
  dayOfWeek: day,
  awayTeam: "AAA",
  homeTeam: "BBB",
  homeScore: null,
  awayScore: null,
  status: "scheduled",
  revealOverride: null,
  network: null,
});

// Week 1 as it actually is in nfl_games: a standalone Wednesday night game, a
// standalone Thursday night game, then the Sunday slate.
const WEEKS = [
  week(1, "2026-09-09T18:00:00Z", "2026-09-11T18:00:00Z"),
  week(2, "2026-09-16T18:00:00Z", "2026-09-18T18:00:00Z"),
];
const GAMES = [
  game(1, "Wednesday", "2026-09-10T00:20:00Z"), // 09-09 8:20 PM ET
  game(1, "Thursday", "2026-09-11T00:35:00Z"), //  09-10 8:35 PM ET
  game(1, "Sunday", "2026-09-13T17:00:00Z"), //    09-13 1:00 PM ET
  game(1, "Sunday", "2026-09-13T20:25:00Z"),
  game(1, "Monday", "2026-09-15T00:15:00Z"),
  game(2, "Thursday", "2026-09-18T00:15:00Z"),
  game(2, "Sunday", "2026-09-20T17:00:00Z"),
];

describe("the default holds past the deadline", () => {
  it("stays on week 1 with the deadline PASSED and the first kickoff still ahead", () => {
    // THE CASE THIS EXISTS FOR. Friday 2026-09-11 4:00 PM ET: the 2 PM lock is
    // two hours gone, the banner says so, and stragglers are still arriving.
    // The old reading rolled to week 2 here.
    const friEvening = new Date("2026-09-11T20:00:00Z");
    expect(new Date(WEEKS[0].lateDeadlineAt).getTime()).toBeLessThan(friEvening.getTime());
    expect(defaultPickWeek(WEEKS, GAMES, friEvening)).toBe(1);
  });

  it("holds all Saturday, which is where the stragglers actually are", () => {
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-09-12T23:00:00Z"))).toBe(1);
  });

  it("still holds one minute before the first Sunday kickoff", () => {
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-09-13T16:59:00Z"))).toBe(1);
  });

  it("rolls to week 2 the moment that kickoff passes", () => {
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-09-13T17:00:00Z"))).toBe(2);
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-09-14T12:00:00Z"))).toBe(2);
  });
});

describe("the earliest kickoff of the week is NOT the roll point", () => {
  it("does not roll on week 1's Wednesday night game", () => {
    // The trap. Week 1's earliest kickoff is Wednesday 8:20 PM ET, BEFORE its
    // own Friday deadline - so "roll on the first kickoff of the week" would
    // have moved off week 1 on Wednesday evening. Worse than what it replaced.
    const afterWed = new Date("2026-09-10T02:00:00Z"); // 09-09 10 PM ET
    const earliest = Math.min(...GAMES.filter((g) => g.week === 1).map((g) => new Date(g.kickoffAt).getTime()));
    expect(earliest, "week 1's earliest game really is the Wednesday one").toBeLessThan(afterWed.getTime());
    expect(defaultPickWeek(WEEKS, GAMES, afterWed)).toBe(1);
  });

  it("does not roll on the Thursday night game either", () => {
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-09-11T02:00:00Z"))).toBe(1);
  });

  it("names the Sunday slate as the roll point, not Wednesday", () => {
    expect(weekRollsAt(1, GAMES)?.toISOString()).toBe("2026-09-13T17:00:00.000Z");
    expect(weekRollsAt(2, GAMES)?.toISOString()).toBe("2026-09-20T17:00:00.000Z");
  });
});

describe("edges", () => {
  it("opens on week 1 before anything has happened", () => {
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-09-01T12:00:00Z"))).toBe(1);
  });

  it("holds the last week once the season is played out", () => {
    expect(defaultPickWeek(WEEKS, GAMES, new Date("2026-12-01T12:00:00Z"))).toBe(2);
  });

  it("never skips a week the schedule says nothing about", () => {
    // No kickoff means nothing has kicked off, so it is still open to record
    // against - never rolled past on silence.
    expect(defaultPickWeek(WEEKS, [], new Date("2026-12-01T12:00:00Z"))).toBe(1);
    expect(weekRollsAt(1, [])).toBeNull();
  });

  it("falls back to any game when a week has no main-slate game at all", () => {
    const odd = [game(3, "Thursday", "2026-09-24T00:15:00Z")];
    expect(weekRollsAt(3, odd)?.toISOString()).toBe("2026-09-24T00:15:00.000Z");
  });

  it("reads the weeks in order however they arrive", () => {
    const shuffled = [WEEKS[1], WEEKS[0]];
    expect(defaultPickWeek(shuffled, GAMES, new Date("2026-09-11T20:00:00Z"))).toBe(1);
  });
});

describe("the page reads it, and nothing else moved", () => {
  it("wires the selector's default to this and not to a deadline", () => {
    const src = readFileSync("src/components/admin/picks/picks-entry.tsx", "utf8");
    expect(src).toContain("defaultPickWeek(weeks, games)");
    // The old reading is gone: no week is chosen by comparing a deadline to now.
    expect(src).not.toMatch(/weeks\.find\([^)]*deadlineAt/);
  });

  it("leaves the banner and the late stamping alone", () => {
    const src = readFileSync("src/components/admin/picks/picks-entry.tsx", "utf8");
    // The line that tells him he is past the deadline while still letting him
    // record on the right week. It is the whole reason the selector can hold.
    expect(src).toContain("new picks will be flagged late");
    expect(src).toContain("locked ${span} ago");
  });
});
