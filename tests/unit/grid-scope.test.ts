import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import {
  bucketOfEntry,
  matchesStanding,
  poolAsEntries,
  standingCounts,
  tallySentence,
  type MasterRow,
} from "../../src/lib/master-list";
import type { EntrySummary, GameRow } from "../../src/lib/data/types";

// The Grid is the front door and now carries the WHOLE pool, so the pieces
// that decide what it shows are pure and tested here; the render below covers
// only what a static pass can see, since this repo has no DOM in tests.

const GAMES: Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">[] = [
  { week: 1, homeTeam: "PHI", awayTeam: "DAL", homeScore: 24, awayScore: 17, status: "final" },
  // Scheduled, so neither team is scored: an unplayed week must not read as a loss.
  { week: 2, homeTeam: "BUF", awayTeam: "NYJ", homeScore: null, awayScore: null, status: "scheduled" },
];

const ROWS: MasterRow[] = [
  { no: 1, names: "Clean Row", cells: { "Week 1": "Philadelphia" }, entryId: null },
  { no: 2, names: "Lost Row", cells: { "Week 1": "Dallas" }, entryId: null },
  { no: 3, names: "Struck Row", cells: { "Week 1": "OUT" }, entryId: null },
  { no: 4, names: "Bye Row", cells: { "Week 1": "BYE" }, entryId: null },
  { no: 5, names: "Unplayed Row", cells: { "Week 2": "Buffalo" }, entryId: "e-5" },
];

const LIST = { loadedAt: "2026-09-08T21:53:00Z", rows: ROWS };

describe("the pool as grid rows", () => {
  it("scores her published picks against our results", () => {
    const { entries, cells } = poolAsEntries(LIST, GAMES);
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("pool-1")!.losses).toBe(0);
    expect(byId.get("pool-2")!.losses).toBe(1);
    expect(cells.find((c) => c.entryId === "pool-1")!.result).toBe("win");
    expect(cells.find((c) => c.entryId === "pool-2")!.result).toBe("loss");
  });

  it("leaves an unplayed week unscored rather than counting it as a loss", () => {
    const { entries, cells } = poolAsEntries(LIST, GAMES);
    const five = entries.find((e) => e.id === "pool-5")!;
    expect(five.losses).toBe(0);
    expect(five.lastScoredWeek).toBeNull();
    expect(cells.find((c) => c.entryId === "pool-5")!.result).toBeNull();
    expect(bucketOfEntry(five)).toBe("No Losses");
  });

  it("keeps her OUT authoritative and puts a burned bye in the middle bucket", () => {
    const { entries } = poolAsEntries(LIST, GAMES);
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(bucketOfEntry(byId.get("pool-3")!)).toBe("Out");
    expect(bucketOfEntry(byId.get("pool-4")!)).toBe("1 Loss/Bye");
    expect(bucketOfEntry(byId.get("pool-2")!)).toBe("1 Loss/Bye");
    expect(bucketOfEntry(byId.get("pool-1")!)).toBe("No Losses");
  });

  it("counts a pick with no games at all as unscored, so the Teams page is unaffected", () => {
    const { entries, cells } = poolAsEntries(LIST);
    expect(entries.every((e) => e.losses === 0)).toBe(true);
    expect(cells.every((c) => c.result === null)).toBe(true);
  });
});

describe("the standing chips", () => {
  const entries = poolAsEntries(LIST, GAMES).entries;

  it("makes No Losses its own filter, separate from Alive", () => {
    const counts = standingCounts(entries);
    // 1 clean, 2 in the middle (a loss and a bye), 1 struck out, 1 unplayed.
    expect(counts["No Losses"]).toBe(2);
    expect(counts["1 Loss/Bye"]).toBe(2);
    expect(counts.Out).toBe(1);
    expect(counts.all).toBe(5);
    // Alive is the two buckets together, which is a different question.
    expect(counts.alive).toBe(4);
    expect(counts.alive).not.toBe(counts["No Losses"]);
  });

  it("matches each bucket to its own chip and Alive to both live ones", () => {
    expect(matchesStanding("No Losses", "No Losses")).toBe(true);
    expect(matchesStanding("1 Loss/Bye", "No Losses")).toBe(false);
    expect(matchesStanding("No Losses", "alive")).toBe(true);
    expect(matchesStanding("1 Loss/Bye", "alive")).toBe(true);
    expect(matchesStanding("Out", "alive")).toBe(false);
    for (const b of ["No Losses", "1 Loss/Bye", "Out"] as const) {
      expect(matchesStanding(b, "all")).toBe(true);
    }
  });
});

describe("the week's tally", () => {
  it("reads the picks in scope as the sentence she sends, biggest first", () => {
    const cells = [
      { week: 1, team: "SEA" },
      { week: 1, team: "SEA" },
      { week: 1, team: "LAR" },
      { week: 2, team: "BUF" },
    ];
    expect(tallySentence(cells, 1, (t) => (t === "SEA" ? "Seattle Seahawks" : "LA Rams"))).toBe(
      "2 picked Seattle Seahawks, 1 picked LA Rams",
    );
  });

  it("counts no placeholder as a pick", () => {
    const cells = [
      { week: 1, team: "LOCKED" },
      { week: 1, team: "SKIP_WEEK" },
      { week: 1, team: "MISSED" },
    ];
    expect(tallySentence(cells, 1, (t) => t)).toBeNull();
  });
});

// -------------------------------------------------------------- the render
vi.mock("../../src/lib/data", () => ({
  getData: () => ({
    getEntries: async (): Promise<EntrySummary[]> => [
      {
        id: "e-5",
        entryName: "Ours Only",
        nameIsDefault: false,
        ownerId: "o-1",
        ownerName: "Anthony DellaPia",
        wins: 0,
        losses: 0,
        livesRemaining: 2,
        status: "active",
        byeUsed: false,
        teamsUsed: [],
        lastScoredWeek: null,
        isAdminEntry: true,
      },
    ],
    getWeeks: async () => [
      { week: 1, earlyDeadlineAt: "2026-09-08T16:00:00Z", lateDeadlineAt: "2026-09-11T16:00:00Z" },
      { week: 2, earlyDeadlineAt: "2026-09-15T16:00:00Z", lateDeadlineAt: "2026-09-18T16:00:00Z" },
    ],
    getGridCells: async () => [],
    getMasterList: async () => LIST,
    getSchedule: async () => GAMES.map((g, i) => ({
      ...g,
      id: `g-${i}`,
      kickoffAt: "2026-09-13T17:00:00Z",
      dayOfWeek: "Sunday",
      revealOverride: null,
      network: null,
    })),
    getPot: async () => ({
      entryCount: 1,
      poolEntryCount: 4,
      poolFreeCount: null,
      poolPaidCount: null,
      poolPotCents: null,
    }),
  }),
}));

import GridPage from "../../src/app/grid/page";

describe("Grid, signed out", () => {
  it("opens on the whole pool, not on our group", async () => {
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toContain("Everyone");
    expect(html).toContain("Our group");
    // Her rows, verbatim, in her numbering.
    expect(html).toContain("Clean Row");
    expect(html).toContain("Struck Row");
  });

  it("offers the chips with No Losses among them, and a search box", async () => {
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toContain("No Losses");
    expect(html).toContain("1 Loss/Bye");
    expect(html).toContain("Find a NO. or a name");
  });

  it("hides the owner filter while the whole pool is showing", async () => {
    // Her sheet carries no owner, so the control would list nothing. Keyed on
    // the trigger's label, not on the option text: the options live in a
    // portal that a static render never opens, so asserting on "All owners"
    // would pass whether the control was there or not.
    const html = renderToStaticMarkup(await GridPage());
    expect(html).not.toContain("Filter by owner");
  });

  it("derives the week's tally from the grid rather than being told it", async () => {
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toMatch(/Week 2: 1 picked/);
  });

  it("reports her published total against the rows on the sheet", async () => {
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toMatch(/this sheet carries 5 rows/);
  });
});
