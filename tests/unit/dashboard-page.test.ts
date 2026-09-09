import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The public dashboard now opens on the MASTER POOL: her four figures as she
// publishes them, then the whole pool's health in her buckets, and only then
// this group's own cards. Two rules ride on that and are guarded here:
//
//   1. Her per-entry rate is never printed on a public route (CLAUDE.md).
//      The guard used to live on the Master List; the figures moved, so it
//      moved with them rather than being dropped.
//   2. None of THIS GROUP's money reaches a public route - no collected, no
//      due, no outstanding, and no recruited-vs-free split.
//
// Two of her rows are scored here so the buckets are not all in one pile:
// pool-1 picked a winner, pool-2 a loser, pool-3 is struck OUT on her sheet,
// pool-4 burned a bye.
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
    getWeeks: async () => [
      {
        week: 1,
        earlyDeadlineAt: "2026-09-08T16:00:00Z",
        lateDeadlineAt: "2026-09-11T16:00:00Z",
      },
    ],
    getGridCells: async () => [
      {
        entryId: "e-983",
        week: 1,
        team: "PHI",
        result: null,
        late: false,
        submittedAt: "2026-09-08T00:00:00Z",
        source: "text",
        resultSource: null,
      },
    ],
    getPot: async () => ({
      entryCount: 121,
      poolEntryCount: 1318,
      poolFreeCount: 46,
      poolPaidCount: 1272,
      poolPotCents: 2862000,
    }),
    getSchedule: async () => [
      {
        id: "g-1",
        week: 1,
        kickoffAt: "2026-09-13T17:00:00Z",
        dayOfWeek: "Sunday",
        awayTeam: "DAL",
        homeTeam: "PHI",
        homeScore: 24,
        awayScore: 17,
        status: "final",
        revealOverride: null,
        network: "FOX",
      },
    ],
    getMasterList: async () => ({
      loadedAt: "2026-09-08T21:53:00Z",
      rows: [
        { no: 1, names: "Winner Row", cells: { "Week 1": "Philadelphia" }, entryId: null },
        { no: 2, names: "Loser Row", cells: { "Week 1": "Dallas" }, entryId: null },
        { no: 3, names: "Struck Row", cells: { "Week 1": "OUT" }, entryId: null },
        { no: 4, names: "Bye Row", cells: { "Week 1": "BYE" }, entryId: null },
      ],
    }),
  }),
}));

import DashboardPage from "../../src/app/page";

const html = async () => renderToStaticMarkup(await DashboardPage());

describe("Dashboard, signed out", () => {
  it("opens on her four figures, as published", async () => {
    const out = await html();
    expect(out).toContain("Total in Pool");
    expect(out).toContain("1,318");
    expect(out).toContain("Free");
    expect(out).toContain(">46<");
    expect(out).toContain("Total Paid");
    expect(out).toContain("1,272");
    expect(out).toContain("Total Payout");
    expect(out).toContain("$28,620");
  });

  it("never prints her per-entry rate, in any form", async () => {
    // The guard that used to sit on the Master List. Neither quotient of her
    // pot - by paying entries or by total - may appear.
    const out = await html();
    for (const s of ["$22.50", "22.5", "$21.71", "21.71", "2250", "2171"]) {
      expect(out).not.toContain(s);
    }
    expect(out).not.toMatch(/per (paying )?entry|apiece|each entry|\/\s*entry/i);
  });

  it("counts the whole pool's health in her buckets, not our 121", async () => {
    const out = await html();
    expect(out).toContain("No Losses");
    // Her wording, not "1 Loss": a burned bye lands here without a loss.
    expect(out).toContain("1 Loss/Bye");
    expect(out).toMatch(/Across all 4 rows of her sheet/);
    // PHI won, so row 1 is clean; DAL lost and BYE was burned, so rows 2 and
    // 4 are the middle bucket; row 3 she struck out herself.
    expect(out).toMatch(/text-win">\s*1\s*</);
    expect(out).toMatch(/text-tie">\s*2\s*</);
    expect(out).toMatch(/text-loss">\s*1\s*</);
  });

  it("says the buckets describe this sheet, not a season running total", async () => {
    // She deletes eliminated entries as the season goes, so an "Eliminated"
    // card read as cumulative would drift toward zero. The card and the
    // caption both say what is actually being counted.
    const out = await html();
    expect(out).toMatch(/>\s*out on this sheet\s*</);
    expect(out).toMatch(/removes eliminated entries as the season goes/);
    // And not "struck out": her explicit OUT is only part of that number, the
    // rest is our own calculation. Asserted negatively too, because
    // "out on this sheet" is a substring of "struck out on this sheet" and
    // the positive check alone would pass on the wrong wording.
    expect(out).not.toContain("struck out on this sheet");
    // The caption names the one marker of hers this copy of the sheet can
    // see - a week cell that reads OUT. Her red fill is not persisted, so
    // "a row she has struck out" would promise more than is delivered.
    expect(out).toMatch(/a row her sheet writes OUT on is out whatever we compute/);
    expect(out).not.toMatch(/a row she has struck out/);
  });

  it("says which week the pool count is scored through", async () => {
    const out = await html();
    expect(out).toContain("scored through Week 1");
  });

  it("puts none of this group's money on the page", async () => {
    const out = await html();
    expect(out).not.toMatch(/collected|outstanding|amount due|owed to/i);
    expect(out).not.toMatch(/recruited/i);
  });
});
