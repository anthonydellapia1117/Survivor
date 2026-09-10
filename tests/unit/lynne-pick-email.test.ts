import { describe, expect, it } from "vitest";
import { conflictingNos, headingTeam, parsePickEmail } from "../../src/lib/lynne/pick-email";

// Her real message, verbatim: Gmail 1a08631cab24c4ce, "Wednesday and Thursday
// Games", 2026-09-09 8:43 AM ET. Kept byte for byte, her double space after
// "#573-" and her stray spacing included, because the parser's whole job is to
// survive how she actually types.
const REAL = `Hello,
First thing is the pot is $*28,620*.
Couple of errors but corrected.

The following people are picking Seattle:
#144-Chris Mierzwa 11
#145-Chris Mierzwa 12
#146-Chris Mierzwa 13
#573- Judy Manzi
#717-Micah B2
#783-Jason Knuth 4
#1005-E.A.T.

The following is taking the LA Rams:
#1200-Brett

If you have any questions please let me know.
Lynne/Scottie`;

describe("her plain-text pick email", () => {
  it("reads the real message into the eight rows she stated", () => {
    const r = parsePickEmail(REAL);
    expect(r.unmapped).toEqual([]);
    expect(r.orphans).toEqual([]);
    expect(r.picks.map((p) => p.no)).toEqual([144, 145, 146, 573, 717, 783, 1005, 1200]);
    expect(r.picks.filter((p) => p.teamAbbr === "SEA").map((p) => p.no)).toEqual([144, 145, 146, 573, 717, 783, 1005]);
    expect(r.picks.filter((p) => p.teamAbbr === "LAR").map((p) => p.no)).toEqual([1200]);
  });

  it("stores her word, not our code", () => {
    const r = parsePickEmail(REAL);
    expect(r.picks[0].teamText).toBe("Seattle");
    expect(r.picks.at(-1)!.teamText).toBe("LA Rams");
  });

  it("carries the name for the report and never keys on it", () => {
    const r = parsePickEmail(REAL);
    // Her space after the dash is not part of the name.
    expect(r.picks.find((p) => p.no === 573)!.name).toBe("Judy Manzi");
    expect(r.picks.find((p) => p.no === 1005)!.name).toBe("E.A.T.");
  });

  it("takes nothing from her greeting or her pot figure", () => {
    // "$*28,620*" holds digits; a looser entry pattern would read it as a NO.
    expect(parsePickEmail(REAL).picks.every((p) => p.no !== 28)).toBe(true);
    expect(parsePickEmail(REAL).picks).toHaveLength(8);
  });

  it("requires her hash: a bare numbered line is not an entry", () => {
    // The one shape that must never be guessed at. A line of digits and a dash
    // appears in prose she writes -- a date, a score, a dollar figure split
    // over a line -- and reading one as a NO. invents a pick against a real
    // entry of hers. Missing a row she stated is safe: the run prints its
    // count and her list is partial by rule. Inventing one is not.
    const r = parsePickEmail("picking Seattle:\n#144-real\n1005 - E.A.T.\n9 - 6 at half");
    expect(r.picks.map((p) => p.no)).toEqual([144]);
  });

  it("says nothing about an entry she did not name", () => {
    const r = parsePickEmail(REAL);
    // 1006 sits between two she named and is simply absent. Her list is partial.
    expect(r.picks.some((p) => p.no === 1006)).toBe(false);
  });
});

describe("a word that does not map exactly stops the run", () => {
  it("reports a heading that maps to no team", () => {
    const r = parsePickEmail("The following are taking New York:\n#12-Someone");
    expect(r.picks).toEqual([]);
    expect(r.unmapped).toHaveLength(1);
    expect(r.unmapped[0].text).toBe("The following are taking New York:");
    expect(r.unmapped[0].reason).toMatch(/no team in her vocabulary/);
  });

  it("reports a heading that names two teams rather than picking the longer", () => {
    const r = parsePickEmail("Seattle over Miami:\n#12-Someone");
    expect(r.picks).toEqual([]);
    expect(r.unmapped[0].reason).toMatch(/more than one team/);
  });

  it("reports an unmapped heading once, not once per line under it", () => {
    const r = parsePickEmail("Taking Gotham:\n#1-a\n#2-b\n#3-c");
    expect(r.unmapped).toHaveLength(1);
  });

  it("reports entry lines that answer to no heading at all", () => {
    const r = parsePickEmail("#12-Someone\n#13-Another");
    expect(r.picks).toEqual([]);
    expect(r.orphans.map((o) => o.line)).toEqual([1, 2]);
  });
});

describe("headingTeam", () => {
  it("matches whole words only", () => {
    // "Miamian" is not Miami; a substring match would take it.
    expect(headingTeam("The Miamian society:")).toBeNull();
    expect(headingTeam("picking Miami:")!.teamAbbr).toBe("MIA");
  });

  it("is case-insensitive and keeps her spelling", () => {
    const h = headingTeam("everyone below has SEATTLE")!;
    expect(h.teamAbbr).toBe("SEA");
    expect(h.teamText).toBe("SEATTLE");
  });

  it("does not let one LA team shadow the other", () => {
    expect(headingTeam("taking the LA Rams:")!.teamAbbr).toBe("LAR");
    expect(headingTeam("taking the LA Chargers:")!.teamAbbr).toBe("LAC");
  });

  it("returns null when she names no team", () => {
    expect(headingTeam("If you have any questions please let me know.")).toBeNull();
  });
});

describe("separators and spacing she actually types", () => {
  it("accepts a hyphen, an en dash and an em dash, and stray space", () => {
    const r = parsePickEmail("picking Dallas:\n#1-a\n# 2 – b\n#3—c\n  #4  -  d  ");
    expect(r.picks.map((p) => p.no)).toEqual([1, 2, 3, 4]);
    expect(r.picks.map((p) => p.name)).toEqual(["a", "b", "c", "d"]);
  });

  it("accepts an entry with no name after the dash", () => {
    const r = parsePickEmail("picking Denver:\n#7-");
    expect(r.picks).toEqual([expect.objectContaining({ no: 7, name: "", teamAbbr: "DEN" })]);
  });
});

describe("conflictingNos", () => {
  it("names a NO. she stated under two teams and settles nothing", () => {
    const r = parsePickEmail("picking Seattle:\n#5-x\n\npicking Miami:\n#5-x");
    expect(conflictingNos(r.picks)).toEqual([{ no: 5, teams: ["MIA", "SEA"] }]);
  });

  it("is empty when every NO. is stated once", () => {
    expect(conflictingNos(parsePickEmail(REAL).picks)).toEqual([]);
  });
});
