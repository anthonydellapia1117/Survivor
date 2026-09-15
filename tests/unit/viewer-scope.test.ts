import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Set by Anthony on 2026-09-15: ALL viewer KPIs show the whole pool - her
// newest sheet's rows - on the Dashboard, Grid, Schedule, Teams and Records,
// and this group's own figures appear only when the toggle is set to Our
// group. The Dashboard has its own suite (dashboard-page.test.ts); the Grid
// and Teams pages already opened on Everyone. This holds the three pages the
// change reached besides the Dashboard, by rendering each one and reading
// what its table or board was actually handed.
//
// The client components are stubbed to print what they received, so the
// assertion is on the data a page chose, not on markup a hook would need a
// router to draw.

vi.mock("../../src/components/entries/entries-table", () => ({
  EntriesTable: ({ rows, pool }: { rows: { id: string }[]; pool?: boolean }) =>
    createElement("output", null, `ROWS:${rows.length} POOL:${String(!!pool)} IDS:${rows.map((r) => r.id).join(",")}`),
}));
vi.mock("../../src/components/schedule/game-board", () => ({
  GameBoard: ({ entries }: { entries: { id: string }[] }) =>
    createElement("output", null, `BOARD:${entries.length} IDS:${entries.map((e) => e.id).join(",")}`),
}));

vi.mock("../../src/lib/data", () => ({
  getData: () => ({
    getEntries: async () => [
      {
        id: "e-983",
        entryName: "Adriana Flacco ",
        nameIsDefault: false,
        ownerId: "o-1",
        ownerName: "Adriana Flacco",
        wins: 0,
        losses: 0,
        livesRemaining: 2,
        status: "active",
        byeUsed: false,
        teamsUsed: ["PHI"],
        lastScoredWeek: null,
        isAdminEntry: true,
      },
    ],
    getGridCells: async () => [],
    getWeeks: async () => [
      { week: 1, deadlineAt: "2026-09-11T18:00:00Z", earlyDeadlineAt: "2026-09-09T18:00:00Z", lateDeadlineAt: "2026-09-11T18:00:00Z" },
    ],
    getSchedule: async () => [
      { id: "g-1", week: 1, kickoffAt: "2026-09-13T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "DAL", homeTeam: "PHI", homeScore: 24, awayScore: 17, status: "final", revealOverride: null, network: "FOX" },
    ],
    getMasterList: async () => ({
      loadedAt: "2026-09-15T16:59:22Z",
      rows: [
        { no: 1, names: "Winner Row", cells: { "Week 1": "Philadelphia" }, entryId: null },
        { no: 2, names: "Loser Row", cells: { "Week 1": "Dallas" }, entryId: null },
        { no: 983, names: "Adriana Flacco ", cells: { "Week 1": "Philadelphia" }, entryId: "e-983" },
      ],
    }),
    getArchive2025: async () => ({
      entries: [
        { lynneNumber: 980, entryName: "Mine", picks: ["Dallas", "OUT"], outcome: "out" },
        { lynneNumber: 12, entryName: "Someone", picks: ["Dallas"], outcome: "winner" },
      ],
      weekly: [{ week: 1, noLosses: 1206, lossBye: 30, out: 9 }],
    }),
  }),
}));

import RosterPage from "../../src/app/records/roster/page";
import SchedulePage from "../../src/app/schedule/page";
import Archive2025Page from "../../src/app/records/2025/page";
import { scopeFrom, scopeHref } from "../../src/components/scope-toggle";

const render = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

/** None of this group's money reaches a public page, in either scope (CLAUDE.md, Public surfaces). */
function noGroupMoney(out: string): void {
  expect(out).not.toMatch(/collected|outstanding|amount due|owed to|recruited|margin/i);
}

describe("scopeFrom and scopeHref", () => {
  it("is the whole pool unless the URL asks for our group, and our group when no sheet is loaded", () => {
    expect(scopeFrom(undefined, true)).toBe("pool");
    expect(scopeFrom("ours", true)).toBe("ours");
    expect(scopeFrom("OURS", true)).toBe("pool");
    expect(scopeFrom(["ours"], true)).toBe("pool");
    expect(scopeFrom(undefined, false)).toBe("ours");
  });

  it("keeps the page's other parameters and names only our group in the URL", () => {
    expect(scopeHref("/schedule", "ours", { week: "3", scope: "pool" })).toBe("/schedule?week=3&scope=ours");
    expect(scopeHref("/schedule", "pool", { week: "3" })).toBe("/schedule?week=3");
    expect(scopeHref("/", "pool")).toBe("/");
  });
});

describe("Records: the roster", () => {
  it("lists every row of her sheet by default, owners off and her rows unlinked", async () => {
    const out = await render(RosterPage());
    expect(out).toContain("ROWS:3 POOL:true");
    expect(out).toContain("IDS:pool-1,pool-2,e-983");
    expect(out).toMatch(/aria-current="true"[^>]*>Everyone/);
    // The CSV is our group's roster and is offered only there.
    expect(out).not.toContain("Download CSV");
    noGroupMoney(out);
  });

  it("lists our group, with the CSV, only under Our group", async () => {
    const out = await render(RosterPage({ searchParams: Promise.resolve({ scope: "ours" }) }));
    expect(out).toContain("ROWS:1 POOL:false");
    expect(out).toContain("Download CSV");
    expect(out).toMatch(/aria-current="true"[^>]*>Our group/);
    noGroupMoney(out);
  });
});

describe("Schedule: what each game cost", () => {
  it("hands the board the whole pool by default", async () => {
    const out = await render(SchedulePage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("BOARD:3 IDS:pool-1,pool-2,e-983");
    expect(out).toMatch(/aria-current="true"[^>]*>Everyone/);
    noGroupMoney(out);
  });

  it("hands it our group only under Our group, keeping the week", async () => {
    const out = await render(SchedulePage({ searchParams: Promise.resolve({ scope: "ours", week: "1" }) }));
    expect(out).toContain("BOARD:1 IDS:e-983");
    expect(out).toContain('href="/schedule?week=1"');
    noGroupMoney(out);
  });
});

describe("Records: the 2025 archive", () => {
  it("shows her sheet's figures by default and none of Anthony's own", async () => {
    const out = await render(Archive2025Page());
    expect(out).toContain("Pool size");
    expect(out).not.toContain("My entries");
    expect(out).not.toContain("My 2025 entries still on the sheet");
    expect(out).not.toContain("3 of my 66");
    noGroupMoney(out);
  });

  it("shows his own entries only under Our group", async () => {
    const out = await render(Archive2025Page({ searchParams: Promise.resolve({ scope: "ours" }) }));
    expect(out).toContain("My entries");
    expect(out).toContain("My 2025 entries still on the sheet");
    noGroupMoney(out);
  });
});
