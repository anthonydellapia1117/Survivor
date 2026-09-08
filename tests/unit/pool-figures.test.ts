import { describe, expect, it } from "vitest";
import { checkFigures, parseCount } from "../../src/lib/pool-figures";

describe("parseCount", () => {
  it("reads a whole number with commas, blank as null, anything else as invalid", () => {
    expect(parseCount("1,318")).toBe(1318);
    expect(parseCount(" 46 ")).toBe(46);
    expect(parseCount("")).toBeNull();
    expect(parseCount("12.5")).toBe(false);
    expect(parseCount("-1")).toBe(false);
    expect(parseCount("abc")).toBe(false);
  });
});

describe("checkFigures", () => {
  it("an invalid count is invalid, and no rate or mismatch is judged from it", () => {
    expect(checkFigures("1318", "4x", "1272", 2862000)).toEqual({ kind: "invalid" });
    expect(checkFigures("abc", "", "", 2862000)).toEqual({ kind: "invalid" });
  });

  it("three counts that do not agree are a mismatch with her numbers named", () => {
    expect(checkFigures("1318", "40", "1272", 2862000)).toEqual({ kind: "mismatch", free: 40, paid: 1272, total: 1318 });
  });

  it("figures that agree are saveable, with the admin-only rate over paying entries when typed, else over the total, else none", () => {
    expect(checkFigures("1318", "46", "1272", 2862000)).toEqual({ kind: "ok", perEntryCents: 2862000 / 1272, per: "paying entry" });
    expect(checkFigures("1318", "", "", 2862000)).toEqual({ kind: "ok", perEntryCents: 2862000 / 1318, per: "entry" });
    expect(checkFigures("", "", "", null)).toEqual({ kind: "ok", perEntryCents: null, per: "entry" });
    expect(checkFigures("1318", "46", "", null)).toEqual({ kind: "ok", perEntryCents: null, per: "entry" });
  });
});
