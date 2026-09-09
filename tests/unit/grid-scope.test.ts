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
  { week: 3, homeTeam: "CHI", awayTeam: "GB", homeScore: 20, awayScore: 20, status: "final" },
];

const ROWS: MasterRow[] = [
  { no: 1, names: "Clean Row", cells: { "Week 1": "Philadelphia" }, entryId: null },
  { no: 2, names: "Lost Row", cells: { "Week 1": "Dallas" }, entryId: null },
  { no: 3, names: "Struck Row", cells: { "Week 1": "OUT" }, entryId: null },
  { no: 4, names: "Bye Row", cells: { "Week 1": "BYE" }, entryId: null },
  { no: 5, names: "Unplayed Row", cells: { "Week 2": "Buffalo" }, entryId: "e-5" },
  // Two weeks, same team: an elimination in this pool whatever the results.
  { no: 6, names: "Repeat Row", cells: { "Week 1": "Philadelphia", "Week 2": "Philadelphia" }, entryId: null },
  // A tie is a loss here, as it is everywhere else in this app.
  { no: 7, names: "Tied Row", cells: { "Week 3": "Chicago" }, entryId: null },
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
    const five = entries.find((e) => e.id === "e-5")!;
    expect(five.losses).toBe(0);
    expect(five.lastScoredWeek).toBeNull();
    expect(cells.find((c) => c.entryId === "e-5")!.result).toBeNull();
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

  it("eliminates a row that reuses a team, whatever that team's results", () => {
    // CLAUDE.md: a duplicate team is an ELIMINATION in her pool, not a
    // caution. PHI won in week 1 here, so results alone would keep this row.
    const { entries } = poolAsEntries(LIST, GAMES);
    expect(bucketOfEntry(entries.find((e) => e.id === "pool-6")!)).toBe("Out");
  });

  it("counts a tie as a loss and shows it as a tie, not as a win", () => {
    const { entries, cells } = poolAsEntries(LIST, GAMES);
    const tied = entries.find((e) => e.id === "pool-7")!;
    expect(tied.losses).toBe(1);
    expect(bucketOfEntry(tied)).toBe("1 Loss/Bye");
    expect(cells.find((c) => c.entryId === "pool-7")!.result).toBe("tie_loss");
  });

  it("emits a cell for a published BYE so the grid is not blank there", () => {
    const { cells } = poolAsEntries(LIST, GAMES);
    const bye = cells.find((c) => c.entryId === "pool-4");
    expect(bye).toBeDefined();
    expect(bye!.result).toBe("bye");
  });

  it("gives our own rows their real entry id and hers a synthetic one", () => {
    // A synthetic id has no entry page, so the Grid must not link it.
    const { entries } = poolAsEntries(LIST, GAMES);
    expect(entries.some((e) => e.id === "e-5")).toBe(true);
    expect(entries.some((e) => e.id === "pool-1")).toBe(true);
  });

  it("counts a pick with no games at all as unscored, so the Teams page is unaffected", () => {
    const { entries, cells } = poolAsEntries(LIST);
    expect(entries.every((e) => e.losses === 0)).toBe(true);
    // A published BYE is a bye whether or not anything has been scored; every
    // TEAM pick is what must come back unscored.
    expect(cells.filter((c) => c.result !== "bye").every((c) => c.result === null)).toBe(true);
  });
});

describe("the standing chips", () => {
  const entries = poolAsEntries(LIST, GAMES).entries;

  it("makes No Losses its own filter, separate from Alive", () => {
    const counts = standingCounts(entries);
    // Clean and unplayed are No Losses; a loss, a bye and a tie are the
    // middle; struck-out and repeat-team are Out.
    expect(counts["No Losses"]).toBe(2);
    expect(counts["1 Loss/Bye"]).toBe(3);
    expect(counts.Out).toBe(2);
    expect(counts.all).toBe(7);
    // Alive is the two live buckets together, a different question.
    expect(counts.alive).toBe(5);
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
    expect(html).toMatch(/Week 3: 1 picked/);
  });

  it("counts the footer against the scope on screen, not against our 121", async () => {
    // In Everyone this read "7 of 1 entries" - visible rows over the managed
    // group's total. The mock has 7 sheet rows and 1 entry of ours, so the
    // two denominators are distinguishable.
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toMatch(/7 of\s*(<!-- -->)?\s*7 entries/);
    expect(html).not.toMatch(/of\s*(<!-- -->)?\s*1 entries/);
  });

  it("does not link a row of hers to an entry page that does not exist", async () => {
    // Her rows carry synthetic ids; /entry/pool-1 would 404.
    const html = renderToStaticMarkup(await GridPage());
    expect(html).not.toContain('href="/entry/pool-');
  });

  it("reports her published total against the rows on the sheet", async () => {
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toMatch(/this sheet carries 7 rows/);
  });
});
