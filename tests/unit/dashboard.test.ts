import { describe, expect, it } from "vitest";
import {
  carnageWeek,
  chalkByWeek,
  currentPlayWeek,
  curveEarnsChart,
  dashboardKpis,
  distributionRows,
  eliminationsByWeek,
  MISSED_TEAM,
  eliminationWeek,
  eliminationWeekOfEntry,
  MIN_CURVE_POINTS,
  nextDeadline,
  nextLockBoundary,
  NO_PICK_LABEL,
  pickDistribution,
  standingsBreakdown,
  survivalCurve,
  teamScarcity,
  weekCarnage,
} from "@/lib/dashboard";
import { teamResults } from "@/lib/master-list";
import type { EntrySummary, GridCell, WeekRow } from "@/lib/data/types";

function cell(
  entryId: string,
  week: number,
  result: GridCell["result"],
  team = "KC",
): GridCell {
  return {
    entryId,
    week,
    team,
    result,
    late: false,
    submittedAt: "2026-09-01T00:00:00Z",
    source: "admin",
    resultSource: null,
  };
}

function entry(id: string, status: EntrySummary["status"]): EntrySummary {
  return {
    id,
    entryName: id,
    nameIsDefault: false,
    isFreeEntry: false,
    ownerId: "o",
    ownerName: "O",
    wins: 0,
    losses: 0,
    livesRemaining: 2,
    status,
    byeUsed: false,
    teamsUsed: [],
    isAdminEntry: false,
    lastScoredWeek: null,
  };
}

function week(n: number, deadlineIso: string, earlyIso?: string): WeekRow {
  return {
    week: n,
    windowLabel: "thu_fri",
    deadlineAt: deadlineIso,
    earlyDeadlineAt: earlyIso ?? deadlineIso,
    lateDeadlineAt: deadlineIso,
    resultsFinal: false,
    confirmed: true,
  };
}

describe("eliminationWeek", () => {
  it("is null with fewer than two early losses", () => {
    expect(eliminationWeek([cell("e", 1, "loss")])).toBeNull();
    expect(
      eliminationWeek([cell("e", 1, "win"), cell("e", 2, "win")]),
    ).toBeNull();
  });

  it("is the week of the second loss in the double-elim window", () => {
    expect(
      eliminationWeek([cell("e", 2, "loss"), cell("e", 5, "tie_loss")]),
    ).toBe(5);
  });

  it("counts missed picks as losses", () => {
    expect(
      eliminationWeek([cell("e", 1, "missed"), cell("e", 3, "loss")]),
    ).toBe(3);
  });

  it("is the week of ANY loss after week 7 (single elimination)", () => {
    expect(eliminationWeek([cell("e", 9, "loss")])).toBe(9);
    expect(eliminationWeek([cell("e", 8, "tie_loss")])).toBe(8);
  });

  it("ignores byes and pending picks", () => {
    expect(
      eliminationWeek([
        cell("e", 8, "bye", "SKIP_WEEK"),
        cell("e", 9, "pending"),
      ]),
    ).toBeNull();
  });
});

describe("survivalCurve", () => {
  it("starts at the full field and drops on elimination weeks", () => {
    const entries = [
      entry("a", "active"),
      entry("b", "eliminated"),
      entry("c", "active"),
    ];
    const cells = [
      cell("a", 1, "win"),
      cell("b", 1, "loss"),
      cell("c", 1, "win"),
      cell("a", 2, "win"),
      cell("b", 2, "loss"),
      cell("c", 2, "win"),
    ];
    expect(survivalCurve(entries, cells)).toEqual([
      { week: 0, remaining: 3 },
      { week: 1, remaining: 3 },
      { week: 2, remaining: 2 },
    ]);
  });
});

describe("week selection", () => {
  const weeks = [
    week(1, "2026-09-08T16:00:00Z"),
    week(2, "2026-09-16T16:00:00Z"),
  ];

  it("play week is week 1 before any deadline passes (nothing revealed)", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    expect(currentPlayWeek(weeks, now)?.week).toBe(1);
    expect(nextDeadline(weeks, now)?.week).toBe(1);
  });

  it("play week flips to week 1 revealed after its deadline, next deadline week 2", () => {
    const now = new Date("2026-09-09T00:00:00Z");
    expect(currentPlayWeek(weeks, now)?.week).toBe(1);
    expect(nextDeadline(weeks, now)?.week).toBe(2);
  });
});

describe("nextLockBoundary", () => {
  // The real 2026 shape: week 1 has a Wednesday opener and a Thursday game,
  // week 2 has only Thursday. Both close Sat-Mon at their late deadline.
  const weeks = [
    week(1, "2026-09-11T16:00:00Z", "2026-09-09T16:00:00Z"),
    week(2, "2026-09-18T16:00:00Z", "2026-09-16T16:00:00Z"),
  ];
  const games = [
    { week: 1, dayOfWeek: "Wednesday" as const },
    { week: 1, dayOfWeek: "Thursday" as const },
    { week: 1, dayOfWeek: "Sunday" as const },
    { week: 2, dayOfWeek: "Thursday" as const },
    { week: 2, dayOfWeek: "Sunday" as const },
  ];

  // The bug this replaced: week 1 reported one "all picks" lock, and once
  // tiered it would have advertised Wednesday while Seahawks picks were
  // closing Tuesday.
  it("offers week 1's Wednesday-game tier first, a day before the early deadline", () => {
    const b = nextLockBoundary(weeks, games, new Date("2026-09-01T00:00:00Z"));
    expect(b).toMatchObject({
      week: 1,
      kind: "wed",
      deadlineAt: "2026-09-08T16:00:00.000Z",
    });
  });

  it("then the Thursday tier, then the Sat-Mon lock", () => {
    expect(
      nextLockBoundary(weeks, games, new Date("2026-09-08T17:00:00Z")),
    ).toMatchObject({
      week: 1,
      kind: "thu",
      deadlineAt: "2026-09-09T16:00:00Z",
    });
    expect(
      nextLockBoundary(weeks, games, new Date("2026-09-10T00:00:00Z")),
    ).toMatchObject({
      week: 1,
      kind: "late",
      deadlineAt: "2026-09-11T16:00:00Z",
    });
  });

  it("skips a tier the week has no game for", () => {
    // Week 2 has no Wednesday game, so nothing closes on its Tuesday.
    const b = nextLockBoundary(weeks, games, new Date("2026-09-12T00:00:00Z"));
    expect(b).toMatchObject({
      week: 2,
      kind: "thu",
      deadlineAt: "2026-09-16T16:00:00Z",
    });
  });

  it("offers a Friday tier only when the week has a Friday game", () => {
    // Without one, the next boundary after week 2's Thursday tier is its
    // Sat-Mon lock; adding a Friday game inserts a cutoff a day earlier.
    const withFriday = [...games, { week: 2, dayOfWeek: "Friday" as const }];
    expect(
      nextLockBoundary(weeks, withFriday, new Date("2026-09-17T00:00:00Z")),
    ).toMatchObject({
      week: 2,
      kind: "fri",
      deadlineAt: "2026-09-17T16:00:00.000Z",
    });
  });

  it("between the windows, the Friday late boundary is next", () => {
    const b = nextLockBoundary(weeks, games, new Date("2026-09-17T00:00:00Z"));
    expect(b).toMatchObject({
      week: 2,
      kind: "late",
      deadlineAt: "2026-09-18T16:00:00Z",
    });
  });

  it("null once everything is locked", () => {
    expect(
      nextLockBoundary(weeks, games, new Date("2026-09-19T00:00:00Z")),
    ).toBeNull();
  });
});

describe("pickDistribution", () => {
  const weeks = [week(1, "2026-09-08T16:00:00Z")];
  const cells = [
    cell("a", 1, null, "KC"),
    cell("b", 1, null, "KC"),
    cell("c", 1, null, "BUF"),
    cell("d", 1, null, "SF"),
  ];

  it("hidden while every pick is still LOCKED — nothing to count", () => {
    const locked = cells.map((c) => ({ ...c, team: "LOCKED" }));
    const d = pickDistribution(weeks, locked, new Date("2026-09-08T15:59:00Z"));
    expect(d).toMatchObject({ week: 1, revealed: false });
    expect(d!.rows).toHaveLength(0);
  });

  it("counts only revealed picks — locked games stay out of the totals", () => {
    // KC's game has started (2 picks revealed); BUF's and SF's have not.
    const partial = [
      cells[0],
      cells[1],
      { ...cells[2], team: "LOCKED" },
      { ...cells[3], team: "LOCKED" },
    ];
    const d = pickDistribution(
      weeks,
      partial,
      new Date("2026-09-08T16:01:00Z"),
    );
    expect(d!.revealed).toBe(true);
    expect(d!.rows).toEqual([{ team: "KC", count: 2, pct: 100 }]);
  });

  it("reveals sorted counts with percentages once games are underway", () => {
    const d = pickDistribution(weeks, cells, new Date("2026-09-08T16:01:00Z"));
    expect(d!.revealed).toBe(true);
    expect(d!.rows[0]).toEqual({ team: "KC", count: 2, pct: 50 });
    expect(d!.rows).toHaveLength(3);
  });
});

describe("gameIsRevealed", () => {
  const base = { kickoffAt: "2026-09-13T17:00:00Z" };
  const before = new Date("2026-09-13T16:59:00Z");
  const after = new Date("2026-09-13T17:01:00Z");

  it("automatic: kickoff decides", async () => {
    const { gameIsRevealed } = await import("@/lib/data/types");
    expect(gameIsRevealed({ ...base, revealOverride: null }, before)).toBe(
      false,
    );
    expect(gameIsRevealed({ ...base, revealOverride: null }, after)).toBe(true);
  });

  it("the override wins in both directions", async () => {
    const { gameIsRevealed } = await import("@/lib/data/types");
    expect(gameIsRevealed({ ...base, revealOverride: true }, before)).toBe(
      true,
    );
    expect(gameIsRevealed({ ...base, revealOverride: false }, after)).toBe(
      false,
    );
  });
});

describe("standingsBreakdown", () => {
  it("separates bye-used from plain active", () => {
    const a = entry("a", "active");
    const b = { ...entry("b", "active"), byeUsed: true };
    const c = entry("c", "at_risk");
    const d = entry("d", "eliminated");
    const e = entry("e", "bye_eligible");
    expect(standingsBreakdown([a, b, c, d, e])).toEqual({
      byeEligible: 1,
      active: 1,
      atRisk: 1,
      byeUsed: 1,
      eliminated: 1,
    });
  });
});

// ------------------------------------------------------------ scoped cards
//
// Anthony, 2026-09-15: every viewer KPI shows the whole pool. Her rows reach
// these through poolAsEntries with status "eliminated" and no killing cell
// where she struck a row OUT or it repeated a team, so the curve has to
// honour the status; and every count below is built from the one shape both
// scopes produce, so the two scopes cannot be counted two ways.

const game = (
  week: number,
  home: string,
  away: string,
  homeScore: number | null,
  awayScore: number | null,
  status: "final" | "scheduled" | "in_progress" = "final",
) => ({ week, homeTeam: home, awayTeam: away, homeScore, awayScore, status });

describe("the curve honours an eliminated status the cells cannot explain", () => {
  it("drops a row she struck OUT at the OUT column, or at Week 1 when it was never scored", () => {
    const struck = { ...entry("out", "eliminated"), lastScoredWeek: null };
    expect(eliminationWeekOfEntry(struck, [], 7, 3)).toBe(3);
    expect(eliminationWeekOfEntry(struck, [], 7, null)).toBe(1);
    // A live row with no loss is not dropped, whatever the fallback says.
    expect(eliminationWeekOfEntry(entry("a", "active"), [], 7, 3)).toBeNull();
  });

  it("drops a repeated-team row at its last scored week", () => {
    const repeat = { ...entry("r", "eliminated"), lastScoredWeek: 3 };
    const cells = [cell("r", 1, "win", "KC"), cell("r", 2, "win", "PHI"), cell("r", 3, "win", "KC")];
    expect(eliminationWeekOfEntry(repeat, cells)).toBe(3);
  });

  it("so the survival curve falls for her OUT rows, which the loss-only rule never saw", () => {
    const entries = [entry("a", "active"), entry("b", "eliminated")];
    const cells = [cell("a", 1, "win"), cell("a", 2, "win")];
    expect(survivalCurve(entries, cells)).toEqual([
      { week: 0, remaining: 2 },
      { week: 1, remaining: 1 },
      { week: 2, remaining: 1 },
    ]);
    expect(survivalCurve(entries, cells, 7, new Map([["b", 2]]))).toEqual([
      { week: 0, remaining: 2 },
      { week: 1, remaining: 2 },
      { week: 2, remaining: 1 },
    ]);
  });

  it("earns a chart only from three points - two scored weeks", () => {
    const p = (week: number) => ({ week, remaining: 10 - week });
    expect(MIN_CURVE_POINTS).toBe(3);
    expect(curveEarnsChart([p(0), p(1)])).toBe(false);
    expect(curveEarnsChart([p(0), p(1), p(2)])).toBe(true);
  });
});

describe("dashboardKpis", () => {
  // Week 2: two lost with DAL (one of them out), one won with PHI, one still
  // pending on a game not final; and a Week 1 loss that must stay in Week 1.
  const entries = [entry("a", "at_risk"), entry("b", "eliminated"), entry("c", "active"), entry("d", "active")];
  const cells = [
    cell("a", 2, "loss", "DAL"),
    cell("b", 2, "loss", "DAL"),
    cell("c", 2, "win", "PHI"),
    cell("d", 2, "pending", "KC"),
    cell("c", 1, "loss", "NYG"),
  ];
  const results = teamResults([game(2, "PHI", "DAL", 24, 17), game(2, "KC", "LV", 10, 3, "in_progress")]);

  const open = { anyFinal: true, revealed: true, published: true };

  it("counts the week's losses, who is now out, and the chalk with its result", () => {
    const k = dashboardKpis(entries, cells, results, 2, open);
    expect(k.alive).toBe(3);
    expect(k.lostThisWeek).toBe(2);
    expect(k.outThisWeek).toBe(1);
    expect(k.chalk).toEqual({ team: "DAL", count: 2, pct: 50, tone: "lost", state: "lost" });
  });

  it("prints nothing for the week before any game is final", () => {
    const k = dashboardKpis(entries, cells, results, 2, { ...open, anyFinal: false });
    expect(k.anyFinal).toBe(false);
    expect(k.chalk).toBeNull();
  });

  it("calls the chalk not final when its own game is still on, and never a loss", () => {
    const k = dashboardKpis(entries, [cell("a", 2, "pending", "KC"), cell("b", 2, "pending", "KC")], results, 2, open);
    expect(k.chalk).toEqual({ team: "KC", count: 2, pct: 100, tone: "none", state: "not final" });
    expect(k.lostThisWeek).toBe(0);
  });

  it("names no chalk while any pick of the week is still masked - a share over the revealed subset is a wrong number", () => {
    // Thursday night: one revealed pick on the final game, four LOCKED. A
    // tile computed here would call DAL the chalk at 100%.
    const masked = [cell("a", 2, "loss", "DAL"), ...["b", "c", "d"].map((id) => cell(id, 2, null, "LOCKED"))];
    const k = dashboardKpis(entries, masked, results, 2, { ...open, revealed: false });
    expect(k.revealed).toBe(false);
    expect(k.chalk).toBeNull();
    // The loss count is not a share and still reads the one final.
    expect(k.lostThisWeek).toBe(1);
    // With the whole week revealed the same cells produce the tile.
    expect(dashboardKpis(entries, masked, results, 2, open).chalk).toMatchObject({ team: "DAL", pct: 100 });
  });

  it("names no chalk for a week the scope does not hold at all", () => {
    const k = dashboardKpis(entries, cells, results, 2, { ...open, published: false });
    expect(k.published).toBe(false);
    expect(k.chalk).toBeNull();
  });
});

describe("distributionRows", () => {
  const rows = [
    { team: "PHI", count: 10, pct: 50 },
    { team: "DAL", count: 6, pct: 30 },
    { team: "KC", count: 4, pct: 20 },
  ];
  const results = teamResults([game(1, "PHI", "DAL", 24, 17), game(1, "KC", "LV", null, null, "scheduled")]);

  it("colours each team by its own final result and leaves an unplayed game with no fill", () => {
    const out = distributionRows(rows, results, 1);
    expect(out.top.map((r) => r.tone)).toEqual(["won", "lost", "none"]);
    expect(out.top.map((r) => r.glyph)).toEqual(["W", "L", ""]);
    expect(out.max).toBe(10);
  });

  it("gives a tied final the losing tone on both teams", () => {
    const tied = teamResults([game(1, "PHI", "DAL", 20, 20)]);
    const out = distributionRows(rows, tied, 1);
    expect(out.top[0].tone).toBe("lost");
    expect(out.top[1].tone).toBe("lost");
  });

  it("never recounts: the top rows plus Others equal the input, in the input's order", () => {
    const out = distributionRows(rows, results, 1, 2);
    expect(out.top.map((r) => r.team)).toEqual(["PHI", "DAL"]);
    expect(out.others).toEqual({ teams: 1, count: 4, pct: 20 });
    expect(out.top.reduce((n, r) => n + r.count, 0) + out.others!.count).toBe(20);
    expect(out.all).toHaveLength(3);
    expect(distributionRows(rows, results, 1).others).toBeNull();
  });

  it("prints a skipped week as BYE in the bye tone", () => {
    const out = distributionRows([{ team: "SKIP_WEEK", count: 2, pct: 100 }], results, 1);
    expect(out.top[0]).toMatchObject({ label: "BYE", tone: "bye", glyph: "" });
  });

  it("prints a missed week as No pick with no fill - MISSED is a value, never a word on a screen", () => {
    const out = distributionRows([{ team: MISSED_TEAM, count: 1, pct: 10 }, ...rows], results, 1);
    expect(out.top[0]).toMatchObject({ team: "MISSED", label: NO_PICK_LABEL, tone: "none", glyph: "" });
    expect(out.all.map((r) => r.label)).not.toContain("MISSED");
  });
});

describe("weekCarnage", () => {
  // Week 3: two lost with DAL (one out), one tied with NYG, one missed, one
  // won - and a masked cell and an in-progress one, which are never a loss.
  const entries = [
    entry("a", "at_risk"),
    entry("b", "eliminated"),
    entry("c", "at_risk"),
    entry("d", "at_risk"),
    entry("e", "active"),
    entry("f", "active"),
    entry("g", "active"),
  ];
  const cells = [
    cell("a", 3, "loss", "DAL"),
    cell("b", 3, "loss", "DAL"),
    cell("c", 3, "tie_loss", "NYG"),
    cell("d", 3, "missed", "MISSED"),
    cell("e", 3, "win", "PHI"),
    cell("f", 3, null, "LOCKED"),
    cell("g", 3, "pending", "KC"),
    cell("a", 2, "loss", "SF"),
  ];

  it("groups the week's losses by team, a tie and a missed pick included, with who is now out", () => {
    const r = weekCarnage(entries, cells, 3);
    expect(r.lostTotal).toBe(4);
    expect(r.outTotal).toBe(1);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ team: "DAL", lost: 2, out: 1, share: 50 });
    expect(r.rows.find((x) => x.team === "NYG")).toEqual({ team: "NYG", lost: 1, out: 0, share: 25 });
    expect(r.rows.find((x) => x.team === NO_PICK_LABEL)).toEqual({ team: NO_PICK_LABEL, lost: 1, out: 0, share: 25 });
    expect(r.rows.find((x) => x.team === "PHI")).toBeUndefined();
  });

  it("is the highest week with a final game, not the play week", () => {
    expect(carnageWeek([game(1, "A", "B", 1, 0), game(2, "C", "D", 1, 0), game(3, "E", "F", null, null, "scheduled")])).toBe(2);
    expect(carnageWeek([game(1, "A", "B", null, null, "scheduled")])).toBeNull();
  });
});

describe("chalk, scarcity and the game board's eliminations", () => {
  it("names each fully revealed week's most-picked team and whether it held", () => {
    const cells = [cell("a", 1, "win", "PHI"), cell("b", 1, "win", "PHI"), cell("c", 1, "loss", "DAL"), cell("a", 2, "pending", "KC")];
    const results = teamResults([game(1, "PHI", "DAL", 24, 17)]);
    expect(chalkByWeek(cells, results, [1])).toEqual([{ week: 1, team: "PHI", count: 2, pct: 67, tone: "won", state: "won" }]);
    // Week 2 is not in the revealed list, so it is not a row however many picks it has.
    expect(chalkByWeek(cells, results, [1]).find((c) => c.week === 2)).toBeUndefined();
  });

  it("counts how many ALIVE entries still hold a team, from the revealed weeks only", () => {
    const entries = [entry("a", "active"), entry("b", "active"), entry("c", "eliminated")];
    const cells = [cell("a", 1, "win", "PHI"), cell("b", 1, "win", "PHI"), cell("c", 1, "win", "PHI"), cell("a", 2, null, "DAL")];
    const s = teamScarcity(entries, cells, [1], ["PHI", "DAL", "KC"]);
    expect(s.alive).toBe(2);
    expect(s.rows).toEqual([{ team: "PHI", left: 0 }]);
  });

  it("lists an eliminated entry under the team of its killing loss, and not a row with no loss cell", () => {
    const entries = [entry("b", "eliminated"), entry("out", "eliminated"), entry("a", "active")];
    const cells = [cell("b", 1, "loss", "DAL"), cell("b", 2, "loss", "KC"), cell("a", 1, "loss", "DAL")];
    expect(eliminationsByWeek(entries, cells)).toEqual({ 2: { KC: ["b"] } });
  });
});
