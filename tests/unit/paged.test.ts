import { describe, expect, it } from "vitest";
import { fetchAllPages, PAGE } from "../../scripts/lib/paged";

/** A table of n rows served in pages, recording every range asked for. */
function table(n: number) {
  const calls: [number, number][] = [];
  const rows = Array.from({ length: n }, (_, i) => ({ row_no: i + 1 }));
  return {
    calls,
    read: async (from: number, to: number) => {
      calls.push([from, to]);
      return rows.slice(from, to + 1);
    },
  };
}

describe("fetchAllPages", () => {
  it("walks past the 1,000-row cap and returns every row in order", async () => {
    const t = table(2319);
    const rows = await fetchAllPages(t.read);
    expect(rows).toHaveLength(2319);
    expect(rows[0]).toEqual({ row_no: 1 });
    expect(rows[2318]).toEqual({ row_no: 2319 });
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(PAGE).toBe(1000);
  });

  it("stops after one page when the table is shorter than a page", async () => {
    const t = table(5);
    expect(await fetchAllPages(t.read)).toHaveLength(5);
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("asks once more when a table ends exactly on a page boundary", async () => {
    const t = table(20);
    expect(await fetchAllPages(t.read, 10)).toHaveLength(20);
    expect(t.calls).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it("returns nothing for an empty table and refuses a bad page size", async () => {
    const t = table(0);
    expect(await fetchAllPages(t.read)).toEqual([]);
    await expect(fetchAllPages(t.read, 0)).rejects.toThrow("page must be a positive integer");
  });
});
