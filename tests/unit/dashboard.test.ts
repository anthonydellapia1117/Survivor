import { describe, expect, it } from "vitest";
import {
  currentPlayWeek,
  eliminationWeek,
  nextDeadline,
  nextLockBoundary,
  pickDistribution,
  standingsBreakdown,
  survivalCurve,
} from "@/lib/dashboard";
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
