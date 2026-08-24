import { describe, expect, it } from "vitest";
import { buildSubmissionCsv, buildSubmitRows } from "@/lib/lynne/submit";
import { matchNumberPairs, parseNumberPairs } from "@/lib/lynne/numbers";

describe("buildSubmissionCsv", () => {
  it("NO./NAMES/Week n, her vocabulary, sorted by number, BYE literal", () => {
    const csv = buildSubmissionCsv(4, [
      { lynneNumber: 1006, entryName: "Alexc 1", team: "SKIP_WEEK" },
      { lynneNumber: 977, entryName: "Anthony DellaPia 2", team: "SF" },
      { lynneNumber: 984, entryName: "Cheeky 2k", team: "LAR" },
    ]);
    expect(csv).toBe(
      "NO.,NAMES,Week 4\n" +
        "977,Anthony DellaPia 2,San Francisco\n" +
        "984,Cheeky 2k,LA Rams\n" +
        "1006,Alexc 1,BYE\n",
    );
  });

  it("quotes names carrying commas or quotes; apostrophes pass verbatim", () => {
    const csv = buildSubmissionCsv(2, [
      { lynneNumber: 12, entryName: "thedrick's picks", team: "KC" },
      { lynneNumber: 13, entryName: 'Big, "Bad" Bo', team: "LV" },
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[1]).toBe("12,thedrick's picks,Kansas City");
    expect(lines[2]).toBe('13,"Big, ""Bad"" Bo",LV Raiders');
  });
});

describe("buildSubmitRows preconditions", () => {
  it("splits alive entries into ready / missing pick / missing number", () => {
    const res = buildSubmitRows(
      [
        { id: "a", entryName: "Has Both" },
        { id: "b", entryName: "No Pick" },
        { id: "c", entryName: "No Number" },
      ],
      new Map([
        ["a", "KC"],
        ["c", "SF"],
      ]),
      new Map([
        ["a", 977],
        ["c", null],
      ]),
    );
    expect(res.ready).toEqual([
      { lynneNumber: 977, entryName: "Has Both", team: "KC" },
    ]);
    expect(res.missingPick).toEqual(["No Pick"]);
    expect(res.missingNumber).toEqual(["No Number"]);
    expect(res.aliveCount).toBe(3);
  });
});

describe("parseNumberPairs", () => {
  it("number-first, name-first, tab and comma forms — names keep spaces and digits", () => {
    const { pairs, unparsed } = parseNumberPairs(
      [
        "993 Nick&Kels 1",
        "Nick&Kels 2 994",
        "995\tNick&Kels 3",
        "Nick&Kels 4, 996",
        "",
        "  1006   Alexc 1  ",
      ].join("\n"),
    );
    expect(unparsed).toEqual([]);
    expect(pairs.map((p) => [p.no, p.name])).toEqual([
      [993, "Nick&Kels 1"],
      [994, "Nick&Kels 2"],
      [995, "Nick&Kels 3"],
      [996, "Nick&Kels 4"],
      [1006, "Alexc 1"],
    ]);
  });

  it("reports lines without a number instead of guessing", () => {
    const { pairs, unparsed } = parseNumberPairs("just a name\n977 Real One");
    expect(pairs).toHaveLength(1);
    expect(unparsed).toEqual([{ line: 1, text: "just a name" }]);
  });
});

describe("matchNumberPairs", () => {
  const targets = [
    { id: "a", entryName: "Waggs1", lynneNumber: null },
    { id: "b", entryName: "thedrick's picks", lynneNumber: null },
    { id: "c", entryName: "Taken Already", lynneNumber: 500 },
  ];

  it("exact then case-insensitive, never fuzzy; unmatched reported", () => {
    const { matches, issues } = matchNumberPairs(
      parseNumberPairs("101 Waggs1\n102 THEDRICK'S PICKS\n103 Wagggs1").pairs,
      targets,
    );
    expect(matches.map((m) => [m.entryId, m.no, m.matchedBy])).toEqual([
      ["a", 101, "entry_name"],
      ["b", 102, "entry_name_ci"],
    ]);
    expect(issues).toEqual([
      { line: 3, text: "103 Wagggs1", reason: "no_match" },
    ]);
  });

  it("flags duplicate numbers, duplicate names, and taken numbers", () => {
    const { matches, issues } = matchNumberPairs(
      parseNumberPairs("101 Waggs1\n101 thedrick's picks\n500 Waggs1").pairs,
      targets,
    );
    expect(matches).toHaveLength(1);
    const reasons = issues.map((i) => i.reason);
    expect(reasons).toContain("duplicate_number_in_paste");
    // "500 Waggs1": Waggs1 already claimed on line 1.
    expect(reasons).toContain("duplicate_name_in_paste");
  });

  it("a number owned by a different entry is refused; re-assigning the same entry shows old -> new", () => {
    const { matches, issues } = matchNumberPairs(
      parseNumberPairs("500 Waggs1").pairs,
      targets,
    );
    expect(matches).toEqual([]);
    expect(issues[0].reason).toBe("number_taken_by_other_entry");

    const renumber = matchNumberPairs(
      parseNumberPairs("501 Taken Already").pairs,
      targets,
    );
    expect(renumber.matches[0].replaces).toBe(500);
  });
});
