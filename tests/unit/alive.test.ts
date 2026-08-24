import { describe, expect, it } from "vitest";
import {
  eliminationWeekOf,
  isShowMode,
  matchesShowMode,
  showCounts,
} from "@/lib/alive";
import type { EntryStatus, GridCell } from "@/lib/data/types";

const statuses = (list: EntryStatus[]) => list.map((status) => ({ status }));

function cell(week: number, result: GridCell["result"]): GridCell {
  return {
    entryId: "e",
    week,
    team: "KC",
    result,
    late: false,
    submittedAt: "2026-09-01T00:00:00Z",
    source: "admin",
    resultSource: null,
  };
}

describe("show mode", () => {
  it("counts alive, out, and all correctly", () => {
    const c = showCounts(
      statuses(["active", "at_risk", "bye_eligible", "eliminated", "eliminated"]),
    );
    expect(c).toEqual({ alive: 3, out: 2, all: 5 });
  });

  it("filters by mode: alive excludes eliminated, out is only eliminated", () => {
    expect(matchesShowMode("active", "alive")).toBe(true);
    expect(matchesShowMode("at_risk", "alive")).toBe(true);
    expect(matchesShowMode("eliminated", "alive")).toBe(false);
    expect(matchesShowMode("eliminated", "out")).toBe(true);
    expect(matchesShowMode("active", "out")).toBe(false);
    expect(matchesShowMode("eliminated", "all")).toBe(true);
    expect(matchesShowMode("active", "all")).toBe(true);
  });

  it("validates URL values strictly", () => {
    expect(isShowMode("alive")).toBe(true);
    expect(isShowMode("out")).toBe(true);
    expect(isShowMode("all")).toBe(true);
    expect(isShowMode("dead")).toBe(false);
    expect(isShowMode(null)).toBe(false);
  });
});

describe("eliminationWeekOf", () => {
  it("second loss in the double-elim window", () => {
    expect(eliminationWeekOf([cell(2, "loss"), cell(5, "tie_loss")])).toBe(5);
  });
  it("any single loss after week 7", () => {
    expect(eliminationWeekOf([cell(9, "loss")])).toBe(9);
    expect(eliminationWeekOf([cell(1, "loss"), cell(10, "missed")])).toBe(10);
  });
  it("null while alive", () => {
    expect(eliminationWeekOf([cell(1, "win"), cell(2, "loss")])).toBeNull();
    expect(eliminationWeekOf([])).toBeNull();
  });
});
