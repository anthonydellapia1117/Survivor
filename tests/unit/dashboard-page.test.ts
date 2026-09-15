import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
// Extra games switchable per test: one test adds a Week 1 game still to be
// played, to show a part-played week is not "scored through" even when every
// revealed pick on the sheet has a result.
const sheet = vi.hoisted(() => ({
  // Switchable to an empty roster: her sheet must still open the page.
  noEntries: false,
  // Switchable to no sheet at all: the section then opens on our group.
  noSheet: false,
  // Switchable to a second scored week: rows 1 and 2 take Kansas City in
  // Week 2 and the schedule carries its final, so the curve has three points.
  week2: false,
  // Switchable to Week 2 being the PLAY week - its deadline passed, one of
  // its games final, one pick of ours on it - while her sheet still carries
  // only Week 1: the Friday-to-Saturday window before her sheet lands.
  playWeek2: false,
  extraGames: [] as Record<string, unknown>[],
  extraRows: [] as Record<string, unknown>[],
  // The Week 1 game's reveal override: false holds the week back whatever
  // the clock says, true lets it out. Pinned so no test depends on today.
  reveal: null as boolean | null,
}));

vi.mock("../../src/lib/data", () => ({
  getData: () => ({
    getEntries: async () =>
      sheet.noEntries
        ? []
        : [
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
        deadlineAt: "2026-09-11T16:00:00Z",
        earlyDeadlineAt: "2026-09-08T16:00:00Z",
        lateDeadlineAt: "2026-09-11T16:00:00Z",
      },
      ...(sheet.playWeek2
        ? [{ week: 2, deadlineAt: "2026-09-12T16:00:00Z", earlyDeadlineAt: "2026-09-09T16:00:00Z", lateDeadlineAt: "2026-09-12T16:00:00Z" }]
        : []),
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
      ...(sheet.playWeek2
        ? [{ entryId: "e-983", week: 2, team: "KC", result: null, late: false, submittedAt: "2026-09-12T00:00:00Z", source: "text", resultSource: null }]
        : []),
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
        // Kicked off in the past, so with no override it is public.
        kickoffAt: "2026-09-06T17:00:00Z",
        dayOfWeek: "Sunday",
        awayTeam: "DAL",
        homeTeam: "PHI",
        homeScore: 24,
        awayScore: 17,
        status: "final",
        revealOverride: sheet.reveal,
        network: "FOX",
      },
      ...sheet.extraGames,
      ...(sheet.week2 || sheet.playWeek2
        ? [{ id: "g-w2", week: 2, kickoffAt: "2026-09-13T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "LV", homeTeam: "KC", homeScore: 30, awayScore: 10, status: "final", revealOverride: null, network: "CBS" }]
        : []),
    ],
    getMasterList: async () => ({
      loadedAt: sheet.noSheet ? null : "2026-09-08T21:53:00Z",
      rows: sheet.noSheet
        ? []
        : [
            { no: 1, names: "Winner Row", cells: { "Week 1": "Philadelphia", ...(sheet.week2 ? { "Week 2": "Kansas City" } : {}) }, entryId: null },
            { no: 2, names: "Loser Row", cells: { "Week 1": "Dallas", ...(sheet.week2 ? { "Week 2": "Kansas City" } : {}) }, entryId: null },
            { no: 3, names: "Struck Row", cells: { "Week 1": "OUT" }, entryId: null },
            { no: 4, names: "Bye Row", cells: { "Week 1": "BYE" }, entryId: null },
            ...sheet.extraRows,
          ],
    }),
  }),
}));

import DashboardPage from "../../src/app/page";
import { createElement } from "react";
import { distributionRows, MISSED_TEAM } from "../../src/lib/dashboard";
import { PickDistribution } from "../../src/components/dashboard/pick-distribution";

const html = async () => renderToStaticMarkup(await DashboardPage());

describe("Dashboard, signed out", () => {
  it("opens on her four figures, as published", async () => {
    const out = await html();
    expect(out).toContain("Total in Pool");
    expect(out).toContain("1,318");
    // His labels of 2026-09-09: her Free is "Admin entries", her Total is
    // "Total paid", Total in Pool and Total Payout stay.
    expect(out).toContain("Admin entries");
    expect(out).toContain(">46<");
    expect(out).toContain("Total paid");
    expect(out).not.toContain("Total Paid");
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
    // Every Week 1 pick on the sheet (PHI, DAL) has a final: the week is in.
    const out = await html();
    expect(out).toContain("scored through Week 1");
    expect(out).not.toContain("in progress");
  });

  it("calls a part-played week in progress rather than scored through, from the schedule and not from the revealed cells", async () => {
    // Every revealed Week 1 pick on the sheet (PHI, DAL) has a final, and one
    // more Week 1 game is still scheduled: its picks are the ones the public
    // view is still holding back. The buckets can still move, so the page
    // must not say the count is scored through Week 1.
    sheet.extraGames = [{ id: "g-2", week: 1, kickoffAt: "2026-09-14T00:20:00Z", dayOfWeek: "Sunday", awayTeam: "MIA", homeTeam: "BUF", homeScore: null, awayScore: null, status: "scheduled", revealOverride: null, network: "NBC" }];
    try {
      const out = await html();
      expect(out).not.toContain("scored through Week 1");
      expect(out).toContain("Week 1 in progress");
      expect(out).toContain("no week fully scored yet");
    } finally {
      sheet.extraGames = [];
    }
  });

  it("qualifies the master-pool distribution until every game of the week has kicked off", async () => {
    // Every game public (kicked off, no hold): the whole pool, said plainly.
    let out = await html();
    expect(out).toContain("Every entry in the master pool");
    expect(out).not.toContain("Revealed picks so far");
    // Held back: the chart is whatever cells the view has revealed, and the
    // caption must not call that the whole pool. The same hold keeps the
    // week from reading as scored through.
    sheet.reveal = false;
    try {
      out = await html();
      expect(out).toContain("Revealed picks so far in the master pool");
      expect(out).not.toContain("Every entry in the master pool");
      expect(out).not.toContain("scored through Week 1");
    } finally {
      sheet.reveal = null;
    }
  });

  it("still opens on the master pool when our roster is empty but her sheet is loaded", async () => {
    // The two sources are independent. The empty state is for neither
    // having anything, not for the roster alone.
    sheet.noEntries = true;
    try {
      const out = await html();
      expect(out).not.toContain("Season not seeded yet");
      expect(out).toContain("Total in Pool");
      expect(out).toContain("No Losses");
      expect(out).toMatch(/Across all 4 rows of her sheet/);
    } finally {
      sheet.noEntries = false;
    }
  });

  it("puts none of this group's money on the page", async () => {
    const out = await html();
    expect(out).not.toMatch(/collected|outstanding|amount due|owed to/i);
    expect(out).not.toMatch(/recruited/i);
  });
});

// Anthony, 2026-09-15: every viewer KPI below Row 2 shows the whole pool -
// the four rows of her sheet in this fixture, never our one entry - and our
// group's figures appear only under the section's toggle. The fixture makes
// the two scopes disagree on every number so a card computed from our
// roster cannot pass by coincidence: the sheet has 4 rows (3 alive, 1 lost
// this week, 1 struck OUT); our roster has 1 entry with no result.

/** The markup between one card title and the next. */
const between = (out: string, from: string, to: string) => {
  const a = out.indexOf(from);
  const b = out.indexOf(to, a);
  expect(a, `card "${from}" is on the page`).toBeGreaterThan(-1);
  return b > a ? out.slice(a, b) : out.slice(a);
};

describe("Dashboard - the scoped section opens on Everyone", () => {
  it("offers the two scopes in the exact words, the sheet's count on one and ours on the other", async () => {
    const out = await html();
    expect(out).toContain('aria-label="Everyone or our group"');
    expect(out).toMatch(/aria-checked="true"[^>]*>Everyone<span[^>]*>4</);
    expect(out).toMatch(/aria-checked="false"[^>]*>Our group<span[^>]*>1</);
    // "our group" in lower case reached a caption once; the two words are
    // the toggle's and are never lower-cased in copy. The aria-label is an
    // attribute, not copy, and is the one place the phrase is allowed.
    expect(out.replace(/aria-label="Everyone or our group"/g, "")).not.toMatch(/our group/);
  });

  it("counts ALIVE, LOST THIS WEEK and CHALK over the sheet's rows, out of her published total", async () => {
    const out = await html();
    // 3 of the sheet's 4 rows are alive, out of her 1,318 - not "1 of 1".
    expect(out).toMatch(/Alive<\/p><p class="[^"]*">3<\/p><p class="[^"]*">of 1,318</);
    // One row lost (Dallas) and none of those is out; our roster has no loss.
    expect(out).toMatch(/Lost this week<\/p><p class="[^"]*text-tie">1<\/p><p class="[^"]*text-loss">0 now out</);
    // The chalk: DAL and PHI tie at one pick each, DAL first by name, and
    // DAL lost - so the tile is yellow and says so in words.
    expect(out).toMatch(/Chalk<\/p><p class="[^"]*text-tie">DAL<span[^>]*>50%<\/span><\/p><p class="[^"]*">1 pick, lost</);
  });

  it("draws the standings bar and sentence from the sheet, not in his our-group wording", async () => {
    const out = await html();
    expect(out).toContain("No Losses=1, 1 Loss/Bye used=2 and Out=1. 3 left in the pool.");
    expect(out).not.toContain("We are down to");
    // The Out segment is the OUT red from the module - not the losing
    // yellow, which would make a finished row read as damaged-but-alive.
    expect(out).toMatch(/class="h-full bg-loss\/70"[^>]*title="Out: 1"/);
    expect(out).toMatch(/class="h-full bg-tie\/70"[^>]*title="Loss\/Bye: 2"/);
  });

  it("lists the chalk and the teams running out over the sheet's rows, the fallen chalk in yellow", async () => {
    const out = await html();
    // Pool: DAL and PHI tie at one pick each, DAL first by name, and DAL
    // lost. Ours would be PHI at 100%, held.
    const chalk = between(out, ">Chalk vs contrarian<", ">Teams running out<");
    expect(chalk).toMatch(/>W1</);
    expect(chalk).toMatch(/<span class="font-medium text-tie">DAL<\/span>/);
    expect(chalk).toContain("1 picks, 50%");
    expect(chalk).toContain("chalk fell");
    expect(chalk).not.toContain(">PHI<");
    expect(chalk).not.toContain("chalk held");
    expect(chalk).not.toContain("text-win");
    // Pool: 3 alive, one holding PHI and one DAL, so both read 2/3. Ours
    // would be PHI at 0/1.
    const scarcity = between(out, ">Teams running out<", ">Recent activity<");
    expect(scarcity).toMatch(/>PHI<[\s\S]*?>2\/3</);
    expect(scarcity).toMatch(/>DAL<[\s\S]*?>2\/3</);
    expect(scarcity).not.toContain("0/1");
    expect(scarcity).toContain("through Week 1");
  });

  it("starts the survival strip at her published total and states the drop as numbers, with no chart at two points", async () => {
    const out = await html();
    const card = between(out, ">Survival<", ">Week 1 picks<");
    expect(card).toMatch(/Start<\/p><p class="[^"]*">1,318</);
    expect(card).toMatch(/Remaining<\/p><p class="[^"]*">3</);
    // The struck row dropped in Week 1: 4 rows to 3, a 25% fall, in the OUT red.
    expect(card).toMatch(/Week 1<\/p><p class="[^"]*text-loss">-1<span[^>]*>25%</);
    expect(card).not.toContain("<svg");
    expect(card).toContain("removes eliminated entries as the season goes");
  });

  it("labels the drop 'so far' while a game of that week is not final", async () => {
    // survivalCurve reaches Week 1 at its first final; with a second Week 1
    // game still scheduled the week's cost is not settled, and "Week 1 0"
    // would read as a week that cost nothing.
    sheet.extraGames = [{ id: "g-2", week: 1, kickoffAt: "2026-09-13T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "MIA", homeTeam: "BUF", homeScore: null, awayScore: null, status: "scheduled", revealOverride: null, network: "CBS" }];
    try {
      const out = await html();
      const card = between(out, ">Survival<", ">Week 1 picks<");
      expect(card).toMatch(/Week 1 so far<\/p>/);
      expect(card).not.toMatch(/>Week 1<\/p>/);
    } finally {
      sheet.extraGames = [];
    }
    // And plainly "Week 1" once every game of it is final.
    const settled = between(await html(), ">Survival<", ">Week 1 picks<");
    expect(settled).toMatch(/>Week 1<\/p>/);
    expect(settled).not.toContain("so far");
  });

  it("earns the step chart at three points and prints every step as text beneath it", async () => {
    sheet.week2 = true;
    try {
      const out = await html();
      const card = between(out, ">Survival<", ">Week 2 picks<");
      expect(card).toContain("<svg");
      expect(card).toMatch(/W1 3\s+W2 3/);
    } finally {
      sheet.week2 = false;
    }
  });

  it("colours each distribution bar by the team's own final result, yellow for a loss and never red", async () => {
    const out = await html();
    const card = between(out, ">Week 1 picks<", ">Week 1 carnage<");
    const row = (team: string) => new RegExp(`<li[^>]*>(?:(?!</li>).)*>${team}<(?:(?!</li>).)*</li>`, "s").exec(card)?.[0] ?? "";
    // Philadelphia won: green fill and a visible W. Dallas lost: yellow and an L.
    expect(row("PHI")).toContain("bg-win/70");
    expect(row("PHI")).toMatch(/aria-label="won"[^>]*>W</);
    expect(row("DAL")).toContain("bg-tie/70");
    expect(row("DAL")).toMatch(/aria-label="lost"[^>]*>L</);
    // The count and the share are visible text on every row, not a tooltip.
    expect(row("DAL")).toMatch(/>1<\/span>/);
    expect(row("DAL")).toMatch(/>50%/);
    expect(card).not.toMatch(/\b(?:bg|text)-loss\b/);
    // The three caption branches are unchanged, word for word.
    expect(card).toContain("Every entry in the master pool, from the published sheet");
  });

  it("leaves a team whose game is not final with the plain accent and no W or L", async () => {
    sheet.extraGames = [{ id: "g-2", week: 1, kickoffAt: "2026-09-13T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "MIA", homeTeam: "BUF", homeScore: null, awayScore: null, status: "scheduled", revealOverride: null, network: "CBS" }];
    sheet.extraRows = [{ no: 5, names: "Open Row", cells: { "Week 1": "Buffalo" }, entryId: null }];
    try {
      const out = await html();
      const card = between(out, ">Week 1 picks<", ">Week 1 carnage<");
      const buf = new RegExp("<li[^>]*>(?:(?!</li>).)*>BUF<(?:(?!</li>).)*</li>", "s").exec(card)?.[0] ?? "";
      expect(buf).toContain("bg-primary/60");
      expect(buf).not.toMatch(/bg-(?:win|tie)\/70/);
      expect(buf).not.toMatch(/aria-label="(?:won|lost)"/);
    } finally {
      sheet.extraGames = [];
      sheet.extraRows = [];
    }
  });

  it("lists this week's carnage across the sheet in the losing yellow, with the games-final count", async () => {
    const out = await html();
    const card = between(out, ">Week 1 carnage<", ">Standings - official count<");
    expect(card).toContain("bg-tie/70");
    expect(card).toMatch(/>DAL</);
    expect(card).not.toMatch(/\bbg-loss\b/);
    expect(card).toContain("1 entry lost this week, 0 of them out - 1 of 1 games final.");
  });

  it("names no chalk on the tile while any pick of the week is still masked", async () => {
    // Thursday night: one game final and one held back. The week's picks are
    // not all revealed, so a share computed now would be over the revealed
    // subset - DAL at 50% of two, with the rest of the pool masked. The tile
    // waits, and says why, while the loss count (not a share) still reads.
    sheet.extraGames = [{ id: "g-2", week: 1, kickoffAt: "2026-09-13T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "MIA", homeTeam: "BUF", homeScore: null, awayScore: null, status: "scheduled", revealOverride: false, network: "CBS" }];
    sheet.extraRows = [{ no: 5, names: "Open Row", cells: { "Week 1": "Buffalo" }, entryId: null }];
    try {
      const out = await html();
      expect(out).toMatch(/Chalk<\/p><p class="[^"]*">-<\/p><p class="[^"]*">picks still masked</);
      expect(out).not.toMatch(/Chalk<\/p><p class="[^"]*">DAL<span/);
      expect(out).not.toMatch(/>50%<\/span><\/p><p class="[^"]*">1 pick, lost/);
      expect(out).toMatch(/Lost this week<\/p><p class="[^"]*text-tie">1<\/p>/);
    } finally {
      sheet.extraGames = [];
      sheet.extraRows = [];
    }
  });

  it("still opens on Everyone when her sheet lacks the play week, and the picks card says so rather than standing in", async () => {
    // Friday 2 PM to whenever her sheet lands: the play week has rolled, one
    // of its games is final, and her newest sheet carries only last week.
    // Every card that can be read off her sheet still is; the tiles that
    // would read a zero off a column she has not published say so; and the
    // picks card, which has nothing of hers, says so too. Our group used to
    // stand in on it, labelled - a stand-in is still our figure under
    // Everyone, and the rule (2026-09-15) forbids exactly that.
    sheet.playWeek2 = true;
    try {
      const out = await html();
      expect(out).toMatch(/aria-checked="true"[^>]*>Everyone<span[^>]*>4</);
      expect(out).toMatch(/Alive<\/p><p class="[^"]*">3<\/p><p class="[^"]*">of 1,318</);
      expect(out).toContain("No Losses=1, 1 Loss/Bye used=2 and Out=1. 3 left in the pool.");
      expect(out).not.toContain("We are down to");
      // The week's tiles: not a zero, not "no game final yet" while KC is final.
      expect(out).toMatch(/Lost this week<\/p><p class="[^"]*">-<\/p><p class="[^"]*">not published yet</);
      expect(out).toMatch(/Chalk<\/p><p class="[^"]*">-<\/p><p class="[^"]*">not published yet</);
      expect(out).not.toMatch(/Lost this week<\/p><p class="[^"]*text-tie">0</);
      // The carnage card, same reason, and not "No entry has lost yet".
      const carnage = between(out, ">Week 2 carnage<", ">Standings - official count<");
      expect(carnage).toContain("The master pool&#x27;s Week 2 picks are not published yet.");
      expect(carnage).not.toContain("No entry has lost yet");
      expect(carnage).not.toContain("games final");
      // The picks card: no rows, no label, one sentence naming what is not
      // published. Our KC pick is on no part of it.
      const picks = between(out, ">Week 2 picks<", ">Week 2 carnage<");
      expect(picks).toContain("The master pool&#x27;s Week 2 picks are not published yet.");
      expect(picks).not.toMatch(/>KC</);
      expect(picks).not.toContain("Our group");
      expect(picks).not.toContain("stands in");
      expect(picks).not.toContain("Every entry in the master pool");
      // And the survival strip's drop is last week's, settled, not Week 2's.
      const survival = between(out, ">Survival<", ">Week 2 picks<");
      expect(survival).toMatch(/>Week 1<\/p>/);
      expect(survival).toMatch(/Start<\/p><p class="[^"]*">1,318</);
    } finally {
      sheet.playWeek2 = false;
    }
  });

  it("renders Recent activity outside the section, ours, with no scope word, whatever the toggle", async () => {
    // The one exception to the rule: our intake, which can only ever be
    // ours, so it is always there and needs no label. It sits AFTER the
    // section's closing tag, so no toggle state can reach it.
    const out = await html();
    const section = out.indexOf("</section>");
    const title = out.indexOf(">Recent activity<");
    expect(section).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(section);
    // Our one cell here has no stored result (null, not pending), so the
    // feed is empty and says so; tests/unit/dashboard-scope-rule.test.ts
    // renders it with rows. Either way it names no scope.
    const card = out.slice(title);
    expect(card).toContain("Results appear here as weeks are scored.");
    expect(card).not.toMatch(/Our group|Everyone|our group|\bours\b/);
  });

  it("opens on Our group, disabled Everyone, when no sheet is loaded - and nothing stands in for anything", async () => {
    sheet.noSheet = true;
    try {
      const out = await html();
      expect(out).toMatch(/aria-checked="true"[^>]*>Our group<span[^>]*>1</);
      expect(out).toMatch(/aria-checked="false"[^>]*disabled=""[^>]*>Everyone<span[^>]*>0</);
      expect(out).toContain("Our group&#x27;s own entries; Everyone appears once the master pool&#x27;s sheet is loaded.");
      expect(out).toContain("We are down to 1 left in the pool.");
      expect(out).toContain("Our group&#x27;s Week 1 picks, as recorded.");
      expect(out).toContain("Recent activity");
      expect(out).not.toContain("stands in");
      expect(out).not.toMatch(/>Week 1 picks<span/);
    } finally {
      sheet.noSheet = false;
    }
  });
});

describe("Dashboard - the lower section on a phone", () => {
  const read = (p: string) => readFileSync(path.join(__dirname, "../..", p), "utf8");
  const bars = [
    "src/components/dashboard/survival-strip.tsx",
    "src/components/dashboard/pick-distribution.tsx",
    "src/components/dashboard/carnage-list.tsx",
    "src/components/dashboard/bar-row.tsx",
  ];

  it("renders the three visuals on the server with nothing that scrolls sideways", () => {
    for (const f of bars) {
      const src = read(f);
      expect(src, `${f} is a server component`).not.toContain('"use client"');
      expect(src, `${f} must not scroll sideways`).not.toMatch(/overflow-x/);
      expect(src, `${f} must set no minimum width`).not.toMatch(/\bmin-w-/);
      expect(src, `${f} draws no chart library`).not.toContain("recharts");
    }
  });

  it("gives every tappable thing a 44px target", () => {
    for (const f of ["src/components/dashboard/pick-distribution.tsx", "src/components/dashboard/carnage-list.tsx"]) {
      expect(read(f), `${f} summary`).toMatch(/<summary className="[^"]*\bh-11\b/);
    }
    expect(read("src/components/dashboard/scope-section.tsx")).toMatch(/role="radio"[\s\S]*?className=\{cn\(\s*"[^"]*\bh-11\b/);
  });

  it("draws a missed week as No pick, with the value MISSED on no part of the row", () => {
    // Our group's distribution can carry the rules engine's MISSED value; it
    // is a value like SKIP_WEEK and never reaches a screen as a word - not
    // as the label, not as the title.
    const rows = distributionRows([{ team: MISSED_TEAM, count: 1, pct: 100 }], new Map(), 1);
    const out = renderToStaticMarkup(createElement(PickDistribution, { rows }));
    expect(out).toContain(">No pick<");
    expect(out).toContain('title="No pick recorded"');
    expect(out).not.toContain("MISSED");
    expect(out).not.toMatch(/bg-(?:win|tie)\/70/);
  });

  it("imports no chart library anywhere under src", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const users = walk(path.join(__dirname, "../../src")).filter((f) => /from "recharts"/.test(readFileSync(f, "utf8")));
    expect(users).toEqual([]);
  });
});
