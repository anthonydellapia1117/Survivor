import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import {
  bucketOfEntry,
  cellTimeLabel,
  fullyRevealedWeeks,
  MASTER_LIST_SOURCE,
  matchesStanding,
  poolAsEntries,
  poolStandings,
  standingCounts,
  tallyHeading,
  tallySentence,
  tallyWeekOf,
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

  it("gives a one-loss row the same at_risk status our own one-loss rows carry", () => {
    // v_entry_public: losses = 1 is at_risk. The chip already said 1 Loss/Bye;
    // the status dot and the sort order must say the same thing.
    const { entries } = poolAsEntries(LIST, GAMES);
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("pool-2")!.status).toBe("at_risk");
    expect(byId.get("pool-1")!.status).toBe("active");
    expect(byId.get("pool-3")!.status).toBe("eliminated");
  });

  it("gives an eliminated row no lives, however it was eliminated", () => {
    // v_entry_standing: lives_remaining is 0 for an eliminated entry. Her
    // OUT and a repeated team eliminate a row with no loss on it, so
    // 2 - losses would have read "2 lives" on a row that is out.
    const { entries } = poolAsEntries(LIST, GAMES);
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("pool-3")!.livesRemaining).toBe(0);
    expect(byId.get("pool-6")!.livesRemaining).toBe(0);
    expect(byId.get("pool-2")!.livesRemaining).toBe(1);
    expect(byId.get("pool-1")!.livesRemaining).toBe(2);
  });

  it("marks a clean row bye eligible once it is scored into the single-elimination weeks, as the view does", () => {
    // v_entry_standing: last_scored_week >= 7 (past the double-elimination
    // window), no losses, bye unused. A row scored only in Week 1 is active.
    const games = [...GAMES, { week: 8, homeTeam: "DEN", awayTeam: "LV", homeScore: 27, awayScore: 10, status: "final" as const }];
    const rows: MasterRow[] = [
      { no: 20, names: "Deep Row", cells: { "Week 1": "Philadelphia", "Week 8": "Denver" }, entryId: null },
      { no: 21, names: "Deep Bye Row", cells: { "Week 1": "BYE", "Week 8": "Denver" }, entryId: null },
    ];
    const { entries } = poolAsEntries({ loadedAt: LIST.loadedAt, rows }, games);
    expect(entries.find((e) => e.id === "pool-20")!.status).toBe("bye_eligible");
    expect(entries.find((e) => e.id === "pool-21")!.status).toBe("active");
    expect(poolAsEntries(LIST, GAMES).entries.find((e) => e.id === "pool-1")!.status).toBe("active");
  });

  it("stamps every cell of hers as the sheet's, so its time reads as the sheet's and not as a submission", () => {
    const { cells } = poolAsEntries(LIST, GAMES);
    expect(cells.every((c) => c.source === MASTER_LIST_SOURCE)).toBe(true);
    expect(cellTimeLabel({ source: MASTER_LIST_SOURCE })).toBe("Sheet as of");
    expect(cellTimeLabel({ source: "email" })).toBe("Submitted");
    expect(cellTimeLabel({ source: "text" })).toBe("Submitted");
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

describe("scored through", () => {
  it("advances only past a week whose every published pick is scored, and never over an open week", () => {
    // Week 1's picks (PHI, DAL, PHI) are all final; Week 2's one pick (BUF)
    // is unplayed; Week 3's one pick (CHI) is final. "Through Week 3" would
    // skip an open week, so the marker stops at 1.
    const s = poolStandings(LIST, GAMES);
    expect(s.scoredThrough).toBe(1);
    expect(s.scoredThrough).not.toBe(3);
    // Week 2 has nothing scored, so nothing is "in progress" there either.
    expect(s.inProgressWeek).toBeNull();
  });

  it("decides completeness from the schedule, so a week with a game still to play is in progress even when every REVEALED pick is scored", () => {
    // The public view withholds each cell until its game kicks off. On this
    // sheet every revealed Week 1 pick (PHI, DAL, PHI) has a final, and yet
    // Week 1 has a game still scheduled: the hidden picks are for that game.
    const games = [
      ...GAMES,
      { week: 1, homeTeam: "BUF", awayTeam: "MIA", homeScore: null, awayScore: null, status: "scheduled" as const },
    ];
    const s = poolStandings(LIST, games);
    expect(s.scoredThrough).toBeNull();
    expect(s.inProgressWeek).toBe(1);
  });
});

describe("what the tally can claim", () => {
  it("counts a week fully revealed only when every game of it has kicked off or been overridden", () => {
    const now = new Date("2026-09-13T20:00:00Z");
    const games = [
      { week: 1, kickoffAt: "2026-09-10T00:20:00Z", revealOverride: null },
      { week: 1, kickoffAt: "2026-09-13T17:00:00Z", revealOverride: null },
      { week: 2, kickoffAt: "2026-09-13T17:00:00Z", revealOverride: null },
      { week: 2, kickoffAt: "2026-09-21T00:20:00Z", revealOverride: null },
      { week: 3, kickoffAt: "2026-09-28T00:20:00Z", revealOverride: true },
    ];
    expect(fullyRevealedWeeks(games, now)).toEqual([1, 3]);
    // The override can hold a game back as well as let it out.
    expect(fullyRevealedWeeks([{ week: 1, kickoffAt: "2026-09-10T00:20:00Z", revealOverride: false }], now)).toEqual([]);
  });

  it("qualifies the tally until the week is fully revealed", () => {
    expect(tallyHeading(1, true)).toBe("Week 1:");
    expect(tallyHeading(1, false)).toBe("Week 1 so far, revealed picks only:");
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

  it("describes the latest week with a countable pick, not the latest week with any cell", () => {
    // A future-week pick the public view still masks is a LOCKED cell on
    // that week. Taking the highest week with any cell landed the tally on
    // it, and every cell there is a placeholder, so the sentence vanished
    // while Week 1 still had picks to summarise.
    const cells = [
      { week: 1, team: "SEA" },
      { week: 1, team: "LAR" },
      { week: 2, team: "LOCKED" },
      { week: 3, team: "SKIP_WEEK" },
    ];
    expect(tallyWeekOf(cells)).toBe(1);
    expect(tallySentence(cells, tallyWeekOf(cells)!, (t) => t)).toBe("1 picked LAR, 1 picked SEA");
    // Nothing countable anywhere: no week, rather than a week with nothing in it.
    expect(tallyWeekOf([{ week: 2, team: "LOCKED" }])).toBeNull();
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
      // Held back: nothing in the mock has been revealed, whatever the clock says.
      revealOverride: false,
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

  it("derives the week's tally from the grid rather than being told it, and says it is a subset until the week is fully revealed", async () => {
    const html = renderToStaticMarkup(await GridPage());
    expect(html).toMatch(/Week 3 so far, revealed picks only: 1 picked/);
    expect(html).not.toMatch(/Week 3: 1 picked/);
  });

  it("labels a cell of hers with the sheet's time, not a submission time", () => {
    // The popup is client state a static render never opens, so the wiring
    // is read from the source: the label comes from cellTimeLabel and the
    // fixed word is gone.
    const src = readFileSync(new URL("../../src/components/grid/grid-view.tsx", import.meta.url), "utf8");
    expect(src).toContain("cellTimeLabel(pop.cell)");
    expect(src).not.toContain('>Submitted</dt>');
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
