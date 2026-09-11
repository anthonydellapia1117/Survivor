// How the one table sorts. The two rules that are easy to get wrong are the
// two a reader actually notices: a blank is not a value below every other one,
// and equal values keep her numbering rather than whatever the last sort left.

import { describe, expect, it } from "vitest";
import { nextSort, sameSortKey, sortKeyId, sortRows, type SortableRow } from "@/lib/grid-sort";

const row = (no: number | null, name: string, weeks: Record<number, string> = {}): SortableRow => ({
  no,
  name,
  teamByWeek: new Map(Object.entries(weeks).map(([w, t]) => [Number(w), t])),
});

const ROWS: SortableRow[] = [
  row(1005, "E.A.T.", { 1: "SEA" }),
  row(983, "Adriana Flacco ", { 1: "DAL", 2: "PHI" }),
  row(1, "Lynne P", { 2: "KC" }),
  row(1089, "Andrew Dicicco #1", {}),
];

const nos = (rows: SortableRow[]) => rows.map((r) => r.no);

describe("sortRows", () => {
  it("opens on her numbering, ascending", () => {
    expect(nos(sortRows(ROWS, "no", "asc"))).toEqual([1, 983, 1005, 1089]);
    expect(nos(sortRows(ROWS, "no", "desc"))).toEqual([1089, 1005, 983, 1]);
  });

  it("sorts the name case-insensitively", () => {
    expect(sortRows(ROWS, "name", "asc").map((r) => r.name)).toEqual([
      "Adriana Flacco ",
      "Andrew Dicicco #1",
      "E.A.T.",
      "Lynne P",
    ]);
    expect(sortRows(ROWS, "name", "desc").map((r) => r.name)[0]).toBe("Lynne P");
  });

  it("sorts a week by the team shown in it", () => {
    expect(nos(sortRows(ROWS, { week: 1 }, "asc")).slice(0, 2)).toEqual([983, 1005]);
    expect(nos(sortRows(ROWS, { week: 1 }, "desc")).slice(0, 2)).toEqual([1005, 983]);
  });

  it("puts a blank LAST in both directions, because a blank is not a value", () => {
    // Descending by Week 1 should open on the teams, not on the twelve
    // hundred rows with no Week 1 cell. Only two rows here have one.
    for (const dir of ["asc", "desc"] as const) {
      const sorted = sortRows(ROWS, { week: 1 }, dir);
      expect({ dir, tail: nos(sorted).slice(2) }, "blanks after the teams").toEqual({ dir, tail: [1, 1089] });
    }
    // And a row with no NO. sorts last on the NO. column either way.
    const withNull = [...ROWS, row(null, "No number")];
    expect(nos(sortRows(withNull, "no", "asc")).at(-1)).toBeNull();
    expect(nos(sortRows(withNull, "no", "desc")).at(-1)).toBeNull();
  });

  it("breaks a tie on her NO., so a column of identical teams stays in her order", () => {
    const tied = [row(1005, "C", { 1: "DET" }), row(1, "A", { 1: "DET" }), row(983, "B", { 1: "DET" })];
    for (const dir of ["asc", "desc"] as const) {
      expect({ dir, nos: nos(sortRows(tied, { week: 1 }, dir)) }).toEqual({ dir, nos: [1, 983, 1005] });
    }
  });

  it("does not mutate what it was given", () => {
    const before = nos(ROWS);
    sortRows(ROWS, "name", "desc");
    expect(nos(ROWS)).toEqual(before);
  });
});

describe("clicking a header", () => {
  it("flips the same column and starts a new one ascending", () => {
    expect(nextSort({ key: "no", dir: "asc" }, "no")).toEqual({ key: "no", dir: "desc" });
    expect(nextSort({ key: "no", dir: "desc" }, "no")).toEqual({ key: "no", dir: "asc" });
    expect(nextSort({ key: "no", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: { week: 3 }, dir: "desc" }, { week: 3 })).toEqual({ key: { week: 3 }, dir: "asc" });
    expect(nextSort({ key: { week: 3 }, dir: "asc" }, { week: 4 })).toEqual({ key: { week: 4 }, dir: "asc" });
  });

  it("tells one week's key from another, which is what makes the flip work", () => {
    expect(sameSortKey({ week: 3 }, { week: 3 })).toBe(true);
    expect(sameSortKey({ week: 3 }, { week: 4 })).toBe(false);
    expect(sameSortKey("no", { week: 3 })).toBe(false);
    expect(sameSortKey("no", "no")).toBe(true);
    expect(sortKeyId({ week: 7 })).toBe("week:7");
    expect(sortKeyId("name")).toBe("name");
  });
});
