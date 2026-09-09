// The public read of v_master_list against a stubbed PostgREST client: the
// whole sheet arrives whatever the response cap, in NO. order, the loop
// advances by rows received and stops on the exact count or an empty page;
// a view that is not applied yet reads as no sheet; any other error throws.

import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as [number, number][],
  pages: [] as { data: unknown[] | null; error: { code: string; message: string } | null; count: number | null }[],
}));

vi.mock("@supabase/supabase-js", () => {
  const chain = {
    order: () => chain,
    range: async (a: number, b: number) => {
      state.calls.push([a, b]);
      return state.pages.shift() ?? { data: [], error: null, count: null };
    },
  };
  return { createClient: () => ({ from: () => ({ select: () => chain }) }) };
});

import { supabaseBackend } from "../../src/lib/data/supabase";

function rows(from: number, to: number, loadedAt = "2026-09-08T21:53:00Z") {
  const out = [];
  for (let n = from; n <= to; n++) {
    out.push({ row_no: n, names: `Name ${n}`, cells: n === 1 ? { "Week 1": "Dallas" } : {}, sheet_loaded_at: loadedAt, entry_id: n === 983 ? "e-983" : null });
  }
  return out;
}

function gridRows(from: number, to: number) {
  const out = [];
  for (let n = from; n <= to; n++) {
    out.push({ entry_id: `e-${n % 121}`, week: Math.ceil(n / 121), team: "PHI", result: null, late: false, submitted_at: "2026-09-08T00:00:00Z", source: "text", result_source: null });
  }
  return out;
}

function reset(pages: typeof state.pages) {
  state.calls.length = 0;
  state.pages.length = 0;
  state.pages.push(...pages);
}

describe("supabaseBackend.getMasterList", () => {
  it("reads 1,319 rows in two pages of the default cap, in NO. order, with the sheet's load time", async () => {
    reset([
      { data: rows(1, 1000), error: null, count: 1319 },
      { data: rows(1001, 1319), error: null, count: 1319 },
    ]);
    const m = await supabaseBackend.getMasterList();
    expect(m.rows).toHaveLength(1319);
    expect(m.rows[0]).toEqual({ no: 1, names: "Name 1", cells: { "Week 1": "Dallas" }, entryId: null });
    expect(m.rows[982]).toMatchObject({ no: 983, entryId: "e-983" });
    expect(m.rows[1318].no).toBe(1319);
    expect(m.loadedAt).toBe("2026-09-08T21:53:00Z");
    expect(state.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("still reads every row when the response cap is below the page size", async () => {
    reset([
      { data: rows(1, 500), error: null, count: 1319 },
      { data: rows(501, 1000), error: null, count: 1319 },
      { data: rows(1001, 1319), error: null, count: 1319 },
    ]);
    const m = await supabaseBackend.getMasterList();
    expect(m.rows).toHaveLength(1319);
    expect(m.rows.map((r) => r.no)).toEqual(Array.from({ length: 1319 }, (_, i) => i + 1));
    expect(state.calls).toEqual([[0, 999], [500, 1499], [1000, 1999]]);
  });

  it("starts over when a new sheet lands between two pages, so one read never mixes two rosters", async () => {
    const OLD = "2026-09-08T21:53:00Z";
    const NEW = "2026-09-15T18:00:00Z";
    reset([
      { data: rows(1, 1000, OLD), error: null, count: 1319 },
      { data: rows(1001, 1330, NEW), error: null, count: 1330 },
      { data: rows(1, 1000, NEW), error: null, count: 1330 },
      { data: rows(1001, 1330, NEW), error: null, count: 1330 },
    ]);
    const m = await supabaseBackend.getMasterList();
    expect(m.rows).toHaveLength(1330);
    expect(m.loadedAt).toBe(NEW);
    expect(state.calls).toEqual([[0, 999], [1000, 1999], [0, 999], [1000, 1999]]);
  });

  it("starts over when a shorter replacement sheet makes the next page empty", async () => {
    const OLD = "2026-09-08T21:53:00Z";
    const NEW = "2026-09-15T18:00:00Z";
    reset([
      { data: rows(1, 1000, OLD), error: null, count: 1319 },
      { data: [], error: null, count: 900 },
      { data: rows(1, 900, NEW), error: null, count: 900 },
    ]);
    const m = await supabaseBackend.getMasterList();
    expect(m.rows).toHaveLength(900);
    expect(m.loadedAt).toBe(NEW);
    expect(state.calls).toEqual([[0, 999], [1000, 1999], [0, 999]]);
  });

  it("reads as no sheet when the view is not applied yet, and throws on any other error", async () => {
    reset([{ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.v_master_list' in the schema cache" }, count: null }]);
    expect(await supabaseBackend.getMasterList()).toEqual({ loadedAt: null, rows: [] });
    reset([{ data: null, error: { code: "42501", message: "permission denied" }, count: null }]);
    await expect(supabaseBackend.getMasterList()).rejects.toMatchObject({ code: "42501" });
  });
});

describe("supabaseBackend.getGridCells", () => {
  it("reads every current pick past the 1,000-row cap, a page at a time", async () => {
    reset([
      { data: gridRows(1, 1000), error: null, count: 2178 },
      { data: gridRows(1001, 2000), error: null, count: 2178 },
      { data: gridRows(2001, 2178), error: null, count: 2178 },
    ]);
    const cells = await supabaseBackend.getGridCells();
    expect(cells).toHaveLength(2178);
    expect(cells[0]).toMatchObject({ entryId: "e-1", week: 1, team: "PHI" });
    expect(cells[2177].week).toBe(18);
    expect(state.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
