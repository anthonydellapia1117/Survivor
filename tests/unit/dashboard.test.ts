import { describe, expect, it } from "vitest";
import {
  currentPlayWeek,
  eliminationWeek,
  nextDeadline,
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
    lastScoredWeek: null,
  };
}

function week(n: number, deadlineIso: string): WeekRow {
  return {
    week: n,
    windowLabel: "thu_fri",
    deadlineAt: deadlineIso,
    resultsFinal: false,
    confirmed: true,
  };
}

describe("eliminationWeek", () => {
  it("is null with fewer than two early losses", () => {
    expect(eliminationWeek([cell("e", 1, "loss")])).toBeNull();
    expect(eliminationWeek([cell("e", 1, "win"), cell("e", 2, "win")])).toBeNull();
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
    const entries = [entry("a", "active"), entry("b", "eliminated"), entry("c", "active")];
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

describe("pickDistribution", () => {
  const weeks = [week(1, "2026-09-08T16:00:00Z")];
  const cells = [
    cell("a", 1, null, "KC"),
    cell("b", 1, null, "KC"),
    cell("c", 1, null, "BUF"),
    cell("d", 1, null, "SF"),
  ];

  it("stays hidden before the deadline — no rows leave the server", () => {
    const d = pickDistribution(weeks, cells, new Date("2026-09-08T15:59:00Z"));
    expect(d).toMatchObject({ week: 1, revealed: false });
    expect(d!.rows).toHaveLength(0);
  });

  it("reveals sorted counts with percentages after the deadline", () => {
    const d = pickDistribution(weeks, cells, new Date("2026-09-08T16:01:00Z"));
    expect(d!.revealed).toBe(true);
    expect(d!.rows[0]).toEqual({ team: "KC", count: 2, pct: 50 });
    expect(d!.rows).toHaveLength(3);
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
