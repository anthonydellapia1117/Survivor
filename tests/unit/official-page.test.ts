import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The public board must not leak the runner's name through data either: an
// admin upload named after her would otherwise be rendered verbatim.
vi.mock("../../src/lib/data", () => ({
  getData: () => ({
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
        rows: [{ entry: "1004 E.A.T.", team: "Seattle", result: "L" }],
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

import OfficialPage from "../../src/app/official/page";

describe("official board, signed out", () => {
  it("never shows the uploaded filename or the runner's name", async () => {
    const html = renderToStaticMarkup(await OfficialPage());
    expect(html).not.toMatch(/lynne/i);
    expect(html).not.toContain(".xlsx");
    expect(html).not.toContain(".csv");
    expect(html).toContain("Week 2");
    expect(html).toContain("W1");
    expect(html).toContain("E.A.T.");
  });
});
