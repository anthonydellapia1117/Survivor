// The public read of v_master_list against a stubbed PostgREST client: the
// whole sheet arrives whatever the response cap, in NO. order, the loop
// advances by rows received and stops on the exact count or an empty page;
// a view that is not applied yet reads as no sheet; any other error throws.

import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as [number, number][],
  pages: [] as { data: unknown[] | null; error: { code: string; message: string } | null; count: number | null }[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          range: async (a: number, b: number) => {
            state.calls.push([a, b]);
            return state.pages.shift() ?? { data: [], error: null, count: null };
          },
        }),
      }),
    }),
  }),
}));

import { supabaseBackend } from "../../src/lib/data/supabase";

function rows(from: number, to: number) {
  const out = [];
  for (let n = from; n <= to; n++) {
    out.push({ row_no: n, names: `Name ${n}`, cells: n === 1 ? { "Week 1": "Dallas" } : {}, sheet_loaded_at: "2026-09-08T21:53:00Z", entry_id: n === 983 ? "e-983" : null });
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

  it("reads as no sheet when the view is not applied yet, and throws on any other error", async () => {
    reset([{ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.v_master_list' in the schema cache" }, count: null }]);
    expect(await supabaseBackend.getMasterList()).toEqual({ loadedAt: null, rows: [] });
    reset([{ data: null, error: { code: "42501", message: "permission denied" }, count: null }]);
    await expect(supabaseBackend.getMasterList()).rejects.toMatchObject({ code: "42501" });
  });
});
