import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { diffRoster, duplicateNames, parseRosterSheet, rowsPayload } from "../../scripts/lynne/lib/roster-sheet";

/** A workbook in her layout, written to a buffer the way her mail delivers it. */
function sheet(rows: (string | number | null)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HER = [
  ["NO.", "NAMES", "Week 1", "Week 2"],
  [674, "Ian Lubin 1", "Dallas", null],
  [675, "Ian Lubin 2", null, null],
  [982, "AAA #11", "Seattle", null],
  [983, "Adriana Flacco ", null, null],
  [1089, "Andrew Dicicco #1", "OUT", "OUT"],
  ["x", "not a row", null, null],
  [1319, "Ian Lubin 1", null, null],
  [1320, "Ian Lubin 2", null, null],
];

describe("parseRosterSheet", () => {
  const buf = sheet(HER);
  const p = parseRosterSheet(buf);

  it("keys on the sheet's sha256 and counts the rows it read and skipped", () => {
    expect(p.sha256).toBe(createHash("sha256").update(buf).digest("hex"));
    expect(p.rows).toHaveLength(7);
    expect(p.skipped).toEqual([{ row: 7, reason: "no integer NO." }]);
    expect(p.weekHeaders).toEqual(["Week 1", "Week 2"]);
  });

  it("keeps NAMES verbatim, trailing space and her spelling included", () => {
    expect(p.rows.find((r) => r.no === 983)?.names).toBe("Adriana Flacco ");
    expect(p.rows.find((r) => r.no === 1089)?.names).toBe("Andrew Dicicco #1");
  });

  it("carries her filled week cells and nothing for the empty ones", () => {
    expect(p.rows.find((r) => r.no === 674)?.cells).toEqual({ "Week 1": "Dallas" });
    expect(p.rows.find((r) => r.no === 675)?.cells).toEqual({});
    expect(p.rows.find((r) => r.no === 1089)?.cells).toEqual({ "Week 1": "OUT", "Week 2": "OUT" });
  });

  it("stores duplicate names as separate rows, one per NO., never merged", () => {
    expect(p.rows.filter((r) => r.names === "Ian Lubin 1").map((r) => r.no)).toEqual([674, 1319]);
    expect(duplicateNames(p.rows)).toEqual([
      { key: "ian lubin 1", nos: [674, 1319] },
      { key: "ian lubin 2", nos: [675, 1320] },
    ]);
  });

  it("refuses a sheet that repeats a NO., naming both rows", () => {
    expect(() => parseRosterSheet(sheet([["NO.", "NAMES"], [5, "a"], [5, "b"]]))).toThrow("NO. 5 appears on sheet rows 2 and 3");
  });

  it("skips a NAMES cell that is only whitespace, while a real trailing space is kept verbatim", () => {
    const p2 = parseRosterSheet(sheet([["NO.", "NAMES"], [8, "   "], [9, "Real "]]));
    expect(p2.rows).toEqual([{ row: 3, no: 9, names: "Real ", cells: {} }]);
    expect(p2.skipped).toEqual([{ row: 2, reason: "NO. 8 has no NAMES" }]);
  });

  it("refuses a sheet with no usable row instead of handing the CLI an empty list", () => {
    expect(() => parseRosterSheet(sheet([["NO.", "NAMES"]]))).toThrow("No row with an integer NO. and a NAMES text");
    expect(() => parseRosterSheet(sheet([["NO.", "NAMES"], ["x", "not a row"], [7, null]]))).toThrow("2 rows read, 2 skipped");
  });

  it("refuses a workbook that is not her NO./NAMES layout", () => {
    expect(() => parseRosterSheet(sheet([["entry", "team"], ["x", "PHI"]]))).toThrow("Not her NO./NAMES layout");
  });

  it("hands the RPC the rows as read, verbatim", () => {
    expect(rowsPayload(p.rows)[3]).toEqual({ no: 983, names: "Adriana Flacco ", row: 5, cells: {} });
  });
});

describe("diffRoster", () => {
  it("reports added, removed and byte-exact renames by NO., and counts the unchanged", () => {
    const prev = [
      { no: 982, names: "Adriana Flacco " },
      { no: 983, names: "Waggs 1" },
      { no: 1313, names: "Andrew DiCicco #1" },
    ];
    const next = [
      { no: 982, names: "AAA #11" },
      { no: 983, names: "Adriana Flacco " },
      { no: 1089, names: "Andrew Dicicco #1" },
    ];
    expect(diffRoster(prev, next)).toEqual({
      added: [{ no: 1089, names: "Andrew Dicicco #1" }],
      removed: [{ no: 1313, names: "Andrew DiCicco #1" }],
      renamed: [
        { no: 982, before: "Adriana Flacco ", after: "AAA #11" },
        { no: 983, before: "Waggs 1", after: "Adriana Flacco " },
      ],
      unchanged: 0,
    });
  });

  it("treats a trailing space she added as a rename, never as the same name", () => {
    expect(diffRoster([{ no: 1, names: "Waggs 3" }], [{ no: 1, names: "Waggs 3 " }]).renamed).toHaveLength(1);
    expect(diffRoster([{ no: 1, names: "Waggs 3" }], [{ no: 1, names: "Waggs 3" }]).unchanged).toBe(1);
  });
});
