import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The public Master List: every row of the master pool's newest sheet with
// her figures as published. It must never name the runner, never show an
// uploaded filename, never print a per-entry rate, and never reveal a pick
// the public view still masks.
vi.mock("../../src/lib/data", () => ({
  getData: () => ({
    getMasterList: async () => ({
      loadedAt: "2026-09-08T21:53:00Z",
      rows: [
        { no: 1, names: "Lynne P", cells: { "Week 1": "Dallas" }, entryId: null },
        { no: 983, names: "Adriana Flacco ", cells: { "Week 1": "Dallas" }, entryId: "e-983" },
        { no: 1005, names: "E.A.T.", cells: {}, entryId: "e-1005" },
        { no: 1089, names: "Andrew Dicicco #1", cells: {}, entryId: "e-1089" },
      ],
    }),
    getPot: async () => ({
      entryCount: 121,
      poolEntryCount: 1318,
      poolFreeCount: 46,
      poolPaidCount: 1272,
      poolPotCents: 2862000,
    }),
    getGridCells: async () => [
      { entryId: "e-983", week: 1, team: "PHI", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
      { entryId: "e-1005", week: 1, team: "LOCKED", result: null, late: true, submittedAt: "2026-09-08T00:00:00Z", source: "email", resultSource: null },
      { entryId: "e-1089", week: 2, team: "BUF", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
      { entryId: "someone-else", week: 1, team: "KC", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
    ],
    getLynneImports: async () => [
      {
        id: "im-2",
        week: 2,
        filename: "Lynne Week 2 results.xlsx",
        fileSha256: "b",
        importedAt: "2026-09-22T16:00:00Z",
        rowCount: 2,
        matchedCount: 2,
        unmatched: [],
        variances: [
          {
            type: "result_mismatch",
            entryName: "E.A.T.",
            lynne: { team: "Seattle", result: "L" },
            local: { team: "SEA", result: "W" },
          },
        ],
        rows: [{ entry: "1005 E.A.T.", team: "Seattle", result: "L" }],
      },
      {
        id: "im-1",
        week: 1,
        filename: "lynne_week1.csv",
        fileSha256: "a",
        importedAt: "2026-09-15T16:00:00Z",
        rowCount: 1,
        matchedCount: 1,
        unmatched: [],
        variances: [],
        rows: [],
      },
    ],
  }),
}));

import MasterListPage from "../../src/app/master-list/page";

describe("Master List, signed out", () => {
  it("shows her figures as published and never a per-entry rate", async () => {
    const html = renderToStaticMarkup(await MasterListPage());
    expect(html).toContain("Master List");
    expect(html).toContain("Total in Pool");
    expect(html).toContain("1,318");
    expect(html).toContain(">46<");
    expect(html).toContain("1,272");
    expect(html).toContain("$28,620");
    expect(html).not.toMatch(/22\.5/);
    expect(html).not.toMatch(/per entry/i);
  });

  it("never shows the uploaded filename or the runner's name, and keeps the weekly files", async () => {
    const html = renderToStaticMarkup(await MasterListPage());
    expect(html).not.toMatch(/lynne(?! P)/i);
    expect(html).not.toContain(".xlsx");
    expect(html).not.toContain(".csv");
    expect(html).toContain("Week 2");
    expect(html).toContain("W1");
    expect(html).toContain("E.A.T.");
  });

  it("lists every row verbatim, marks ours, matches our pick against her cell and never reveals a masked pick", async () => {
    const html = renderToStaticMarkup(await MasterListPage());
    expect(html).toContain("Lynne P");
    expect(html).toContain("Adriana Flacco ");
    expect(html).toContain("Andrew Dicicco #1");
    expect(html).toContain("Showing 4 of 4");
    // Her Dallas against our PHI on 983: a variance, hers kept, ours beside it.
    expect(html).toMatch(/Dallas[\s\S]{0,300}ours PHI/);
    // 1089 has our Week 2 pick and she has no Week 2 column yet: ours only.
    expect(html).toContain("Week 2");
    expect(html).toContain("ours BUF");
    // 1005's pick is still masked by the public view: nothing about it.
    expect(html).not.toContain("LOCKED");
    expect(html).not.toContain("ours SEA");
    // Someone else's cell belongs to no row here.
    expect(html).not.toContain("ours KC");
  });
});
