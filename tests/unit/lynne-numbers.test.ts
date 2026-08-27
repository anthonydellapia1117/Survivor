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
      {
        lynneNumber: 977,
        entryName: "Has Both",
        team: "KC",
        isAdminEntry: false,
      },
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

describe("admin-first ordering", () => {
  it("submission block and CSV put admin entries first, then by number", async () => {
    const { buildSubmissionBlock, buildSubmissionCsv } =
      await import("@/lib/lynne/submit");
    const rows = [
      { lynneNumber: 977, entryName: "Recruit A", team: "KC" },
      { lynneNumber: 971, entryName: "AAA 1", team: "SF", isAdminEntry: true },
      { lynneNumber: 980, entryName: "Recruit B", team: "LV" },
      { lynneNumber: 972, entryName: "AAA 2", team: "GB", isAdminEntry: true },
    ];
    const block = buildSubmissionBlock(1, rows).split("\n");
    expect(block[1]).toContain("AAA 1");
    expect(block[2]).toContain("AAA 2");
    expect(block[3]).toContain("Recruit A");
    const csv = buildSubmissionCsv(1, rows).trim().split("\n");
    expect(csv.slice(1).map((l) => l.split(",")[1])).toEqual([
      "AAA 1",
      "AAA 2",
      "Recruit A",
      "Recruit B",
    ]);
  });

  it("admin entries lead even when their numbers are higher", async () => {
    const { buildSubmissionCsv } = await import("@/lib/lynne/submit");
    const csv = buildSubmissionCsv(1, [
      { lynneNumber: 1, entryName: "Recruit", team: "KC" },
      { lynneNumber: 1250, entryName: "AAA 1", team: "SF", isAdminEntry: true },
    ])
      .trim()
      .split("\n");
    expect(csv[1]).toContain("AAA 1");
  });

  it("adminFirst is stable for equal flags", async () => {
    const { adminFirst } = await import("@/lib/free-entries");
    expect(
      adminFirst({ isAdminEntry: true }, { isAdminEntry: false }),
    ).toBeLessThan(0);
    expect(
      adminFirst({ isAdminEntry: false }, { isAdminEntry: true }),
    ).toBeGreaterThan(0);
    expect(adminFirst({ isAdminEntry: true }, { isAdminEntry: true })).toBe(0);
  });
});

describe("numbers for entries renamed after submission", () => {
  // Lynne's paste carries the name SHE has. An entry renamed since then must
  // still take its number, and the mapping must say which name matched.
  const targets = [
    {
      id: "nick1",
      entryName: "Nicky DiVirgilio 1",
      lynneNumber: null,
      submittedAsName: "Nick DiVirgilio 1",
    },
    {
      id: "lou1",
      entryName: "Lou Direnzo 1",
      lynneNumber: null,
      submittedAsName: "Nick DiVirgilio 3",
    },
    { id: "plain", entryName: "Waggs1", lynneNumber: null },
  ];

  it("matches her old name and reports it as a submitted-name match", () => {
    const { matches, issues } = matchNumberPairs(
      [
        { no: 900, name: "Nick DiVirgilio 1", line: 1 },
        { no: 901, name: "nick divirgilio 3", line: 2 },
        { no: 902, name: "Waggs1", line: 3 },
      ],
      targets,
    );
    expect(issues).toEqual([]);
    expect(matches.map((m) => [m.entryId, m.no, m.matchedBy])).toEqual([
      ["nick1", 900, "submitted_name"],
      ["lou1", 901, "submitted_name_ci"],
      ["plain", 902, "entry_name"],
    ]);
  });

  it("prefers the current name when both could match", () => {
    const { matches } = matchNumberPairs(
      [{ no: 910, name: "Nicky DiVirgilio 1", line: 1 }],
      targets,
    );
    expect(matches[0].matchedBy).toBe("entry_name");
    expect(matches[0].entryId).toBe("nick1");
  });

  it("still refuses anything fuzzy", () => {
    const { matches, issues } = matchNumberPairs(
      [{ no: 920, name: "Nick DiVirgilio", line: 1 }],
      targets,
    );
    expect(matches).toEqual([]);
    expect(issues[0].reason).toBe("no_match");
  });

  it("reports ambiguity rather than guessing when two entries share her name", () => {
    const { matches, issues } = matchNumberPairs(
      [{ no: 930, name: "Shared Old Name", line: 1 }],
      [
        {
          id: "a",
          entryName: "A 1",
          lynneNumber: null,
          submittedAsName: "Shared Old Name",
        },
        {
          id: "b",
          entryName: "B 1",
          lynneNumber: null,
          submittedAsName: "Shared Old Name",
        },
      ],
    );
    expect(matches).toEqual([]);
    expect(issues[0].reason).toBe("ambiguous_name");
  });
});
