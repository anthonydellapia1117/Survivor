import { afterEach, describe, expect, it, vi } from "vitest";
import { syncSpreadsheet } from "@/lib/sheets/google";
import type { TabSpec } from "@/lib/sheets/types";
import { COLORS } from "@/lib/sheets/types";

function tab(title: string, rows = 3, cols = 2): TabSpec {
  return {
    title,
    tabColor: COLORS.accentBlue,
    rows: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({ v: `${title}-${r}-${c}` })),
    ),
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: Array.from({ length: cols }, () => 100),
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: 1,
    dataRowCount: rows - 2,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockSheetsApi(existingTitles: string[]): Call[] {
  const calls: Call[] = [];
  let sheets = existingTitles.map((title, i) => ({
    properties: { sheetId: 100 + i, title, index: i },
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url: String(url), method, body });
      if (method === "GET") {
        return new Response(
          JSON.stringify({ spreadsheetUrl: "https://sheets.example/x", sheets }),
          { status: 200 },
        );
      }
      // addSheet batch: register the new sheets so the refresh sees them.
      if (body?.requests?.some((r: { addSheet?: unknown }) => r.addSheet)) {
        for (const r of body.requests) {
          if (r.addSheet) {
            sheets = [
              ...sheets,
              {
                properties: {
                  sheetId: 500 + sheets.length,
                  title: r.addSheet.properties.title,
                  index: sheets.length,
                },
              },
            ];
          }
        }
      }
      return new Response(JSON.stringify({ replies: [] }), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("syncSpreadsheet", () => {
  it("adds missing tabs, deletes stale ones, and reports row counts", async () => {
    const calls = mockSheetsApi(["Sheet1"]);
    const res = await syncSpreadsheet("tok", "SS", [tab("Summary"), tab("Grid", 5)]);
    expect(res.rowCounts).toEqual({ Summary: 1, Grid: 3 });

    const batches = calls.filter((c) => c.method === "POST");
    const addReqs = (batches[0].body as any).requests;
    expect(addReqs.map((r: any) => r.addSheet.properties.title)).toEqual([
      "Summary",
      "Grid",
    ]);

    const main = (batches[1].body as any).requests;
    const deletes = main.filter((r: any) => r.deleteSheet);
    expect(deletes).toHaveLength(1); // default Sheet1 removed
  });

  it("writes the full grid with fields:* semantics and merges only the banner", async () => {
    mockSheetsApi(["Summary"]);
    const calls = mockSheetsApi(["Summary"]);
    await syncSpreadsheet("tok", "SS", [tab("Summary", 4, 3)]);
    const main = calls.filter((c) => c.method === "POST").at(-1)!;
    const reqs = (main.body as any).requests;

    const update = reqs.find((r: any) => r.updateCells);
    expect(update.updateCells.fields).toBe(
      "userEnteredValue,userEnteredFormat,textFormatRuns",
    );
    expect(update.updateCells.rows).toHaveLength(4);
    expect(update.updateCells.rows[0].values).toHaveLength(3);

    const merges = reqs.filter((r: any) => r.mergeCells);
    expect(merges).toHaveLength(1);
    expect(merges[0].mergeCells.range.endRowIndex).toBe(1); // banner only

    const props = reqs.find((r: any) => r.updateSheetProperties);
    const gp = props.updateSheetProperties.properties.gridProperties;
    expect(gp.rowCount).toBe(4); // exact size: stale rows are gone
    expect(gp.hideGridlines).toBe(true);
    expect(gp.frozenRowCount).toBe(2);

    const prot = reqs.find((r: any) => r.addProtectedRange);
    expect(prot.addProtectedRange.protectedRange.warningOnly).toBe(true);

    const filter = reqs.find((r: any) => r.setBasicFilter);
    expect(filter.setBasicFilter.filter.range.startRowIndex).toBe(1);
  });

  it("running twice produces the same request shape (idempotent)", async () => {
    const calls1 = mockSheetsApi(["Summary", "Grid"]);
    await syncSpreadsheet("tok", "SS", [tab("Summary"), tab("Grid")]);
    const shape1 = JSON.stringify(
      calls1.filter((c) => c.method === "POST").map((c) => c.body),
    );
    vi.unstubAllGlobals();
    const calls2 = mockSheetsApi(["Summary", "Grid"]);
    await syncSpreadsheet("tok", "SS", [tab("Summary"), tab("Grid")]);
    const shape2 = JSON.stringify(
      calls2.filter((c) => c.method === "POST").map((c) => c.body),
    );
    expect(shape1).toBe(shape2);
  });
});
