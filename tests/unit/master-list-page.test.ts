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
      { entryId: "someone-else", week: 7, team: "KC", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
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
  it("no longer carries her four figures - they open the dashboard now - and still never a rate", async () => {
    // The figures moved to the dashboard so the site opens on them; this page
    // keeps the one thing only it can say, how her published total sits
    // against the rows actually on the sheet. The rate guard stays here as
    // well as there: it must appear on no public route at all.
    const html = renderToStaticMarkup(await MasterListPage());
    expect(html).toContain("Master List");
    expect(html).not.toContain("Total in Pool");
    expect(html).not.toContain("Total Payout");
    for (const s of ["$22.50", "22.5", "$21.71", "21.71", "2250", "2171"]) expect(html).not.toContain(s);
    expect(html).not.toMatch(/per (paying )?entry|apiece|each entry|\/\s*entry/i);
  });

  it("reports the gap between her published total and the rows on the sheet, correcting neither", async () => {
    // 1,318 published against 4 mocked rows: both numbers, no arithmetic on
    // either (CLAUDE.md - report the variance, never auto-resolve).
    const html = renderToStaticMarkup(await MasterListPage());
    expect(html).toContain("1,318");
    expect(html).toMatch(/this sheet carries 4 rows/);
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
    // Her Dallas against our PHI on 983: a variance, hers kept in the cell, ours beside it.
    expect(html).toMatch(/<td[^>]*><span>Dallas<\/span><span[^>]*>ours PHI<\/span><\/td>/);
    // Row 1 is not ours: her cell alone.
    expect(html).toMatch(/<td[^>]*>Dallas<\/td>/);
    // 1089 has our Week 2 pick and she has no Week 2 column yet: ours only.
    expect(html).toContain("Week 2");
    expect(html).toContain("ours BUF");
    // 1005's pick is still masked by the public view: nothing about it.
    expect(html).not.toContain("LOCKED");
    expect(html).not.toContain("ours SEA");
    // Someone else's cell belongs to no row here, so its week adds no column.
    expect(html).not.toContain("ours KC");
    expect(html).not.toContain("Week 7");
  });
});
