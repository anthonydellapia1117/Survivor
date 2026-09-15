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
  // Anthony, 2026-09-15: every panel on the dashboard shows the whole pool
  // unless the toggle is on Our group. The page itself therefore computes
  // NOTHING from our entries for the section: both scopes go through
  // dashboardScope, the pool through poolAsEntries, and the one
  // `entries.length` left in the page is the empty-state guard. Recent
  // activity is the one exception - our intake, rendered outside the toggle
  // - and tests/unit/dashboard-scope-rule.test.ts holds it there.
  it("computes both scopes through the one builder, the pool through poolAsEntries", () => {
    expect(DASH_CODE).toContain("poolAsEntries(master, games)");
    expect(DASH_CODE).toMatch(/key: "pool",\s*entries: pool\.entries/);
    expect(DASH_CODE).toMatch(/key: "ours",\s*entries: ours\.entries/);
  });

  it("reads no our-group count or standing inline", () => {
    const lengths = DASH_CODE.match(/entries\.length/g) ?? [];
    expect(lengths, "only the empty-state guard may count our entries").toHaveLength(1);
    expect(DASH_CODE).toContain("ours.entries.length === 0 && master.rows.length === 0");
    for (const gone of ["aliveEntries", "standingsBreakdown", "survivalCurve", "lynneBucket", "breakdown.eliminated"]) {
      expect(DASH_CODE, `${gone} is an our-group figure and belongs in the scoped section`).not.toContain(gone);
    }
    // The one our-group read the page may make is the feed, and it goes to
    // the card outside the section, never to a scope.
    expect(DASH_CODE).toMatch(/<RecentActivity rows=\{recentActivity\(ours\.entries, ours\.cells, 10\)\} \/>/);
  });
});
