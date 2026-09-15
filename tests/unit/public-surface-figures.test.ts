// What the two shared public surfaces say, set by Anthony on 2026-09-11.
//
// The share card carries HER two published headline figures and nothing else;
// the dashboard has no subtitle. Both changes take an OUR-GROUP number off a
// surface a stranger sees.
//
// The money rule these observe is not "no money": her pool-wide pot is the one
// dollar figure public by design. What must never appear is THIS GROUP's
// finances - collected, due, outstanding, margin, recruited-vs-free.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeWithoutComments } from "../helpers/source-literals";

const OG = readFileSync("src/app/api/og/route.tsx", "utf8");
const DASH = readFileSync("src/app/page.tsx", "utf8");
// The CODE, comments stripped. Both files EXPLAIN what came off and why, so a
// scan of the raw text finds the removed thing in the prose that records its
// removal - which would make these assertions unpassable for the wrong reason.
const OG_CODE = codeWithoutComments(OG);
const DASH_CODE = codeWithoutComments(DASH);

describe("the link preview card", () => {
  it("shows Total in Pool and Total Payout", () => {
    expect(OG).toContain('const wanted = ["Total in Pool", "Total Payout"];');
    // Through poolStats, so it cannot drift from the dashboard strip.
    expect(OG).toContain("poolStats(pot)");
  });

  it("carries NO countdown - a scraped image outlives the deadline in it", () => {
    expect(OG_CODE).not.toContain("deadlineLine");
    expect(OG_CODE).not.toContain("nextLockBoundary");
  });

  it("carries NO our-group figure", () => {
    expect(OG_CODE, "alive-of-total is what this group manages").not.toContain("entries alive");
    expect(OG_CODE).not.toContain("isAliveStatus");
  });

  it("never reaches for a THIS-GROUP money figure", () => {
    for (const forbidden of ["collected", "outstanding", "margin", "Margin", "due"]) {
      expect(OG_CODE, `${forbidden} is admin-only`).not.toContain(forbidden);
    }
  });
});

describe("the dashboard heading", () => {
  it("has no subtitle under the h1", () => {
    expect(DASH).toContain('<h1 className="text-2xl">2026 NFL Survivor Pool</h1>');
    expect(DASH_CODE).not.toContain("live standings, picks, and pool health");
    // The entry count is what made it an our-group line.
    expect(DASH_CODE).not.toMatch(/\{entries\.length\} entries/);
  });
});

describe("the dashboard's viewer KPIs", () => {
  // Anthony, 2026-09-15: every viewer KPI shows the whole pool, and our
  // group's figures appear only under the section's toggle. The page itself
  // therefore computes NOTHING from our entries for display: both scopes go
  // through dashboardScope, the pool through poolAsEntries, and the one
  // `entries.length` left in the page is the empty-state guard.
  it("computes both scopes through the one builder, the pool through poolAsEntries", () => {
    expect(DASH_CODE).toContain("poolAsEntries(master, games)");
    expect(DASH_CODE).toMatch(/key: "pool",\s*entries: pool\.entries/);
    expect(DASH_CODE).toMatch(/key: "ours",\s*entries: ours\.entries/);
  });

  it("measures an entry against the pool, and names our group on the one listing that shows it", () => {
    // /entry/[id] used to print an unlabelled "group median" over our 121;
    // it is the pool median now, over poolAsEntries. /records/roster is a
    // listing of the group Anthony manages, not a KPI surface, so it keeps
    // its count and leads with whose it is, in the toggle's exact words.
    // Whitespace collapsed: the JSX breaks "(pool median" across a line, so a
    // raw-text scan for "group median" passed with the old wording in place.
    const entry = codeWithoutComments(readFileSync("src/app/entry/[id]/page.tsx", "utf8")).replace(/\s+/g, " ");
    expect(entry).toContain("poolAsEntries(master, games)");
    expect(entry).not.toContain("group median");
    expect(entry).toContain("(pool median {median})");
    expect(entry).not.toContain("data.getEntries()");
    const roster = codeWithoutComments(readFileSync("src/app/records/roster/page.tsx", "utf8"));
    expect(roster).toMatch(/Our group - \{entries\.length\} entries/);
  });

  it("feeds the schedule's game board the pool's eliminations from the pool's rows", () => {
    // tests/unit/game-board-scope.test.ts renders the board with hand-built
    // props and never reads this page, so a page wiring our entries under
    // the pool key passed every test. This reads the page.
    const sched = codeWithoutComments(readFileSync("src/app/schedule/page.tsx", "utf8")).replace(/\s+/g, " ");
    expect(sched).toContain("poolAsEntries(master, games)");
    expect(sched).toMatch(/pool: master\.rows\.length > 0 \? \{ eliminated: eliminationsByWeek\(pool\.entries, pool\.cells\), count: pool\.entries\.length \}/);
    expect(sched).toMatch(/ours: \{ eliminated: eliminationsByWeek\(ours\.entries, ours\.cells\), count: ours\.entries\.length \}/);
  });

  it("reads no our-group count or standing inline", () => {
    const lengths = DASH_CODE.match(/entries\.length/g) ?? [];
    expect(lengths, "only the empty-state guard may count our entries").toHaveLength(1);
    expect(DASH_CODE).toContain("ours.entries.length === 0 && master.rows.length === 0");
    for (const gone of ["aliveEntries", "standingsBreakdown", "survivalCurve", "recentActivity", "lynneBucket", "breakdown.eliminated"]) {
      expect(DASH_CODE, `${gone} is an our-group figure and belongs in the scoped section`).not.toContain(gone);
    }
  });
});
