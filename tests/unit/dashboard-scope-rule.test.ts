import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// THE DASHBOARD SCOPE RULE, set by Anthony on 2026-09-15, in his words: "this
// is the rule not a list of fixes: every panel on the dashboard shows the
// WHOLE POOL, 1,318, unless the toggle is set to our group. [...] Recent
// activity is the one exception and stays ours. It is our intake, it can only
// ever be ours, and it needs no label saying so. [...] Guard, broken before
// trusted: no viewer-scope panel renders a figure derived only from our 121
// while the toggle is on Everyone."
//
// Two departures were live on main after #102 and are what this guard was
// written against: the week's picks card let our group STAND IN under the
// Everyone toggle while her sheet had not published the play week (captioned
// "Our group", headline, bars and legend all from our cells), and Recent
// activity was rendered only under Our group when it should always show.
//
// The method: our group and the pool DISAGREE ON EVERY FIGURE a panel can
// print. Our group is exactly 7 entries, and every our-only figure is a
// 7-shaped number or a team the pool's rows never name (the pool picks PHI and
// DAL; we pick KC, LV, MIA and TB). The page is rendered on Everyone, the
// Recent activity card and the toggle's own "Our group 7" button are cut out,
// and NONE of our figures may remain - in a number, a caption, a title
// attribute, an aria-label or an empty-state sentence. The same figures must
// all appear under ?scope=ours, or the fixture proves nothing.
//
// Her sheet carries Week 1 only while the play week is 2, so the picks card's
// stand-in is exercised: it must say the week is unpublished and show nothing
// of ours. A second setting locks every Week 2 cell of hers instead, which is
// a held week, not an unpublished one. A THIRD publishes her Week 2 with every
// cell revealed, because the first two never render the card's PUBLISHED
// branch under Everyone - the "Most picked" headline, the bars, the legend and
// the "Most picked each week" line - and a panel in that branch reading ours
// went uncaught (found on review, 2026-09-15: `chalkByWeek(weeks, ours.cells)`
// and a headline total of `ours.entries.length` both passed the first two).
//
// Every date is in the past so the render never depends on today: both
// deadlines have passed (play week 2), every game has kicked off (every cell
// revealed), and Week 2's second game has no final (its bar stays neutral).

const fx = vi.hoisted(() => ({
  /** Her Week 2 cells present but every one held by the reveal gate. */
  week2Locked: false,
  /** Her Week 2 published and every cell revealed: five NY Jets (won), three
   *  Detroit (lost), nothing on the two rows she struck OUT. */
  week2Published: false,
}));

const SKIP = "SKIP_WEEK";
const MISSED = "MISSED";

const cell = (entryId: string, week: number, team: string, result: string | null, submittedAt: string) => ({
  entryId,
  week,
  team,
  result,
  late: false,
  submittedAt,
  source: "email",
  resultSource: null,
});

const entry = (id: string, entryName: string, o: Partial<Record<string, unknown>> = {}) => ({
  id,
  entryName,
  nameIsDefault: false,
  ownerId: "o-1",
  ownerName: "Owner",
  wins: 0,
  losses: 0,
  livesRemaining: 2,
  status: "active",
  byeUsed: false,
  teamsUsed: [] as string[],
  lastScoredWeek: null as number | null,
  isAdminEntry: false,
  ...o,
});

vi.mock("../../src/lib/data", () => ({
  getData: () => ({
    // Seven of ours. Week 1 as her results file left it (stored results);
    // Week 2 still pending in the store, so MIA's loss is scored for display
    // by scoreFromGames, the way production reads a Sunday.
    getEntries: async () => [
      entry("e1", "Alpha One", { wins: 1, lastScoredWeek: 1, teamsUsed: ["KC", "MIA"] }),
      entry("e2", "Alpha Two", { wins: 1, lastScoredWeek: 1, teamsUsed: ["KC", "MIA"] }),
      entry("e3", "Alpha Three", { wins: 1, lastScoredWeek: 1, teamsUsed: ["KC", "MIA"] }),
      entry("e4", "Beta Four", { losses: 1, livesRemaining: 1, status: "at_risk", lastScoredWeek: 1, teamsUsed: ["LV", "MIA"] }),
      entry("e5", "Gamma Five", { byeUsed: true, lastScoredWeek: 1, teamsUsed: ["TB"] }),
      entry("e6", "Delta Six", { losses: 1, livesRemaining: 1, status: "at_risk", lastScoredWeek: 1, teamsUsed: ["LV", "TB"] }),
      entry("e7", "Epsilon Seven", { losses: 1, livesRemaining: 1, status: "at_risk", lastScoredWeek: 1, teamsUsed: ["TB"] }),
    ],
    getWeeks: async () => [
      { week: 1, windowLabel: "sat_mon", deadlineAt: "2026-09-04T18:00:00Z", earlyDeadlineAt: "2026-09-02T18:00:00Z", lateDeadlineAt: "2026-09-04T18:00:00Z" },
      { week: 2, windowLabel: "sat_mon", deadlineAt: "2026-09-08T18:00:00Z", earlyDeadlineAt: "2026-09-06T18:00:00Z", lateDeadlineAt: "2026-09-08T18:00:00Z" },
    ],
    getGridCells: async () => [
      cell("e1", 1, "KC", "win", "2026-09-01T00:00:00Z"),
      cell("e2", 1, "KC", "win", "2026-09-01T01:00:00Z"),
      cell("e3", 1, "KC", "win", "2026-09-01T02:00:00Z"),
      cell("e4", 1, "LV", "loss", "2026-09-01T03:00:00Z"),
      cell("e5", 1, SKIP, "bye", "2026-09-03T00:00:00Z"),
      cell("e6", 1, "LV", "loss", "2026-09-01T04:00:00Z"),
      // A missed week is stamped at the deadline, so it is the newest of Week 1.
      cell("e7", 1, MISSED, "missed", "2026-09-04T18:00:00Z"),
      cell("e1", 2, "MIA", "pending", "2026-09-07T00:00:00Z"),
      cell("e2", 2, "MIA", "pending", "2026-09-07T01:00:00Z"),
      cell("e3", 2, "MIA", "pending", "2026-09-07T02:00:00Z"),
      cell("e4", 2, "MIA", "pending", "2026-09-07T03:00:00Z"),
      cell("e5", 2, "TB", "pending", "2026-09-07T04:00:00Z"),
      cell("e6", 2, "TB", "pending", "2026-09-07T05:00:00Z"),
      cell("e7", 2, "TB", "pending", "2026-09-07T06:00:00Z"),
    ],
    getPot: async () => ({
      entryCount: 7,
      poolEntryCount: 1318,
      poolFreeCount: 46,
      poolPaidCount: 1272,
      poolPotCents: 2862000,
    }),
    getSchedule: async () => [
      { id: "g1", week: 1, kickoffAt: "2026-09-05T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "DAL", homeTeam: "PHI", homeScore: 24, awayScore: 17, status: "final", revealOverride: null, network: "FOX" },
      { id: "g2", week: 1, kickoffAt: "2026-09-05T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "KC", homeTeam: "DEN", homeScore: 10, awayScore: 30, status: "final", revealOverride: null, network: "CBS" },
      { id: "g3", week: 1, kickoffAt: "2026-09-05T20:25:00Z", dayOfWeek: "Sunday", awayTeam: "LV", homeTeam: "SEA", homeScore: 20, awayScore: 10, status: "final", revealOverride: null, network: "CBS" },
      { id: "g4", week: 2, kickoffAt: "2026-09-09T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "MIA", homeTeam: "NYJ", homeScore: 20, awayScore: 10, status: "final", revealOverride: null, network: "CBS" },
      { id: "g5", week: 2, kickoffAt: "2026-09-09T20:25:00Z", dayOfWeek: "Sunday", awayTeam: "TB", homeTeam: "ATL", homeScore: null, awayScore: null, status: "in_progress", revealOverride: null, network: "FOX" },
      // A Week 2 final none of ours is on, so her published Week 2 has a
      // loser of its own and her carnage is hers, not a copy of our Miami.
      { id: "g6", week: 2, kickoffAt: "2026-09-09T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "DET", homeTeam: "GB", homeScore: 27, awayScore: 13, status: "final", revealOverride: null, network: "FOX" },
    ],
    // Ten of hers, Week 1 only: five Philadelphia (won), two Dallas (lost),
    // one NO PICK (a loss), two OUT. So 5 / 3 / 2, 8 alive, nothing in 7s.
    // Published, her Week 2 puts the five clean rows on NY Jets (won, 5 of 8,
    // 63%) and the three damaged ones on Detroit (lost, 38%, all three out):
    // 5 / 0 / 5, 5 alive, still nothing in 7s and no team of ours.
    getMasterList: async () => ({
      loadedAt: "2026-09-08T21:53:00Z",
      rows: [
        ...[1, 2, 3, 4, 5].map((no) => ({ no, names: `Row ${no}`, cells: { "Week 1": "Philadelphia" }, entryId: null })),
        ...[6, 7].map((no) => ({ no, names: `Row ${no}`, cells: { "Week 1": "Dallas" }, entryId: null })),
        { no: 8, names: "Row 8", cells: { "Week 1": "NO PICK" }, entryId: null },
        { no: 9, names: "Row 9", cells: { "Week 1": "OUT" }, entryId: null },
        { no: 10, names: "Row 10", cells: { "Week 1": "OUT" }, entryId: null },
      ]
        .map((r) => (fx.week2Locked ? { ...r, cells: { ...r.cells, "Week 2": "LOCKED" } } : r))
        .map((r) =>
          fx.week2Published && r.no <= 8
            ? { ...r, cells: { ...r.cells, "Week 2": r.no <= 5 ? "NY Jets" : "Detroit" } }
            : r,
        ),
    }),
  }),
}));

import DashboardPage from "../../src/app/page";

const render = async (scope?: string) =>
  renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve(scope ? { scope } : {}) }));

/** The element carrying this id, from its opening tag to its matching close. */
function elementById(html: string, id: string): string {
  const at = html.indexOf(`id="${id}"`);
  expect(at, `no element with id ${id}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<div", at);
  let depth = 0;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`unbalanced markup after id ${id}`);
}

const TOGGLE = /<nav aria-label="Everyone or our group".*?<\/nav>/;

/** The page without the two things allowed to be ours under Everyone. */
function viewerPanels(html: string): string {
  const feed = elementById(html, "recent-activity");
  const out = html.replace(feed, "").replace(TOGGLE, "");
  expect(out).not.toContain("Recent activity");
  expect(out).not.toMatch(/aria-label="Everyone or our group"/);
  return out;
}

// Every figure the seven of us produce and the ten of hers cannot. Each is
// checked as the exact text the panel prints, so a bare digit shared with a
// week number or an axis label cannot make the guard pass or fail by accident.
const OURS_ONLY: (string | RegExp)[] = [
  // Health row: our buckets 0 / 6 / 1 of 7 (hers are 5 / 3 / 2 of 10).
  /text-win">0</,
  /text-tie">6</,
  /text-loss">1</,
  "out in our group",
  "Across our group",
  "7 entries",
  "No Losses=0, 1 Loss/Bye used=6 and Out=1",
  "We are down to 6 left in the pool",
  // Survival columns: the aria-label summary and the per-week titles.
  "After Week 2: 6 of 7 alive (86%), 0 without a loss (0%), 1 out.",
  "Week 1: 3 no losses, 4 one loss or bye, 0 out",
  "Week 2: 0 no losses, 6 one loss or bye, 1 out",
  // The week's picks: rows, counts, shares, the most-picked team, the chalk line.
  "Miami Dolphins",
  /\bMIA\b/,
  /\bTB\b/,
  "Tampa Bay Buccaneers",
  />4<\/span> of <span[^>]*>7</,
  // The headline's total on its own: 7 is our entry count and hers is never 7.
  / of <span[^>]*>7<\/span>/,
  "57%",
  "43%",
  "chalk fell",
  "Most picked each week",
  /\bW1 KC\b/,
  /\bW2 MIA\b/,
  // Carnage: Week 2 for us (Week 1 for her), 4 of 7 on Miami, one finished.
  "Carnage, Week 2",
  "(57% of 7)",
  "Miami Dolphins: 4 lost a life, 1 out",
  // Teams running out: our 6 alive against her 8.
  /\bKC\b/,
  /\bLV\b/,
  "Kansas City Chiefs",
  "Las Vegas Raiders",
  "of 6 alive entries can still take it",
  "Share of the 6 alive entries",
];

/** Every our-only figure that reached the page, reported together, so a
 *  failure names the whole leak and not just the first figure in the list. */
function expectNone(out: string, figures: (string | RegExp)[]): void {
  const leaked = figures.filter((f) => (typeof f === "string" ? out.includes(f) : f.test(out))).map(String);
  expect(leaked, "our-only figures reached the Everyone page").toEqual([]);
}

// Two strings in OURS_ONLY are the panel's POSITION, not a figure of ours:
// with her Week 2 unpublished her carnage stands on Week 1 and her chalk line
// does not render, so they are our-only THERE. Once her Week 2 is published
// and scored both scopes stand on Week 2 and both have a chalk line, so the
// published test sets these two aside and checks what the two panels carry.
const SHARED_WHEN_PUBLISHED: (string | RegExp)[] = ["Carnage, Week 2", "Most picked each week"];
const OURS_ONLY_WHEN_PUBLISHED = OURS_ONLY.filter((f) => !SHARED_WHEN_PUBLISHED.includes(f));

function expectAll(out: string, figures: (string | RegExp)[]): void {
  for (const f of figures) {
    if (typeof f === "string") expect(out, `fixture does not print "${f}" under Our group`).toContain(f);
    else expect(out, `fixture does not print ${f} under Our group`).toMatch(f);
  }
}

describe("The dashboard scope rule: every viewer panel is the whole pool unless the toggle says Our group", () => {
  it("prints no figure derived from our 7 anywhere on the Everyone page, the picks card's unpublished week included", async () => {
    const out = await render();
    expect(out).toMatch(/aria-current="true"[^>]*>Everyone/);
    const panels = viewerPanels(out);
    expectNone(panels, OURS_ONLY);
    // And what IS there is hers: ten rows, scored through Week 1, and the
    // picks card saying plainly that her Week 2 is not published, under
    // the Everyone label, with no headline, no bars and no legend.
    expect(panels).toContain("Across all 10 rows of her sheet");
    expect(panels).toContain("After Week 1: 8 of 10 alive (80%), 5 without a loss (50%), 2 out.");
    expect(panels).toContain("Carnage, Week 1");
    expect(panels).toContain("Share of the 8 alive entries");
    expect(panels).toMatch(/Week 2 picks<span[^>]*>Everyone<\/span>/);
    expect(panels).toContain("The master pool&#x27;s Week 2 picks are not published yet.");
    expect(panels).not.toContain("Most picked");
    expect(panels).not.toContain("No final yet");
    // The old stand-in's own words, gone with it.
    expect(panels).not.toContain("Our group.");
  });

  it("calls a week her sheet carries but the gate still holds hidden, not unpublished, and still shows nothing of ours", async () => {
    fx.week2Locked = true;
    try {
      const out = await render();
      const panels = viewerPanels(out);
      expectNone(panels, OURS_ONLY);
      expect(panels).toContain("The master pool&#x27;s Week 2 picks appear as their games kick off.");
      expect(panels).not.toContain("not published yet");
      expect(panels).toMatch(/Week 2 picks<span[^>]*>Everyone<\/span>/);
    } finally {
      fx.week2Locked = false;
    }
  });

  it("renders her published week under Everyone - headline, bars, legend and chalk line all hers - and still nothing of ours", async () => {
    fx.week2Published = true;
    try {
      const out = await render();
      expect(out).toMatch(/aria-current="true"[^>]*>Everyone/);
      const panels = viewerPanels(out);
      expect(OURS_ONLY_WHEN_PUBLISHED.length).toBe(OURS_ONLY.length - SHARED_WHEN_PUBLISHED.length);
      expectNone(panels, OURS_ONLY_WHEN_PUBLISHED);
      // The headline: her top team and HER total, 5 of 8, never 4 of 7 and
      // never "of 7" at all.
      expect(panels).toMatch(/Week 2 picks<span[^>]*>Everyone<\/span>/);
      expect(panels).toMatch(
        /Most picked: <span[^>]*>New York Jets<\/span>, <span[^>]*>5<\/span> of <span[^>]*>8<\/span> - <span[^>]*>chalk held<\/span>/,
      );
      expect(panels).toContain("63%");
      expect(panels).toContain("38%");
      expect(panels).toContain("Detroit Lions");
      expect(panels).toContain("Every entry in the master pool, from the published sheet");
      // The chalk line names only her teams, week by week.
      const chalkLine = panels.match(/Most picked each week:.*?<\/p>/);
      expect(chalkLine, "no chalk line on the published Everyone page").not.toBeNull();
      const teams = [...chalkLine![0].matchAll(/W(\d) ([A-Z]{2,3}) <span/g)].map((m) => `W${m[1]} ${m[2]}`);
      expect(teams).toEqual(["W1 PHI", "W2 NYJ"]);
      // Her carnage on the same week: three Detroit rows finished, none of ours.
      expect(panels).toContain("Carnage, Week 2");
      expect(panels).toContain("(38% of 8)");
      expect(panels).toContain("Detroit Lions: 3 lost a life, 3 out");
      expect(panels).toContain("After Week 2: 5 of 10 alive (50%), 5 without a loss (50%), 5 out.");
      expect(panels).toContain("Share of the 5 alive entries");
      expect(panels).not.toContain("not published yet");
    } finally {
      fx.week2Published = false;
    }
  });

  it("prints every one of those figures under Our group, so the fixture is real", async () => {
    const out = await render("ours");
    expect(out).toMatch(/aria-current="true"[^>]*>Our group/);
    const panels = viewerPanels(out);
    expectAll(panels, OURS_ONLY);
    expect(panels).toMatch(/Week 2 picks<span[^>]*>Our group<\/span>/);
    expect(panels).not.toContain("not published yet");
    expect(panels).not.toContain("Across all 10 rows");
  });

  it("renders Recent activity under both scopes, byte-identical, ours, and with no scope word on it", async () => {
    const pool = elementById(await render(), "recent-activity");
    const ours = elementById(await render("ours"), "recent-activity");
    // No label, caption or count naming a scope, from the card's root down.
    for (const card of [pool, ours]) expect(card).not.toMatch(/Our group|Everyone|our group|\bours\b|\bscope\b/);
    expect(pool).toContain("Recent activity");
    // Our rows under Everyone too: the newest ten of our scored cells, each
    // linking to its entry.
    expect(pool).toContain('href="/entry/e4"');
    expect(pool).toContain('href="/entry/e7"');
    expect(pool).toContain("Miami Dolphins");
    // A missed week reads "No pick" and a bye "Bye"; the values never do.
    expect(pool).toContain("No pick");
    expect(pool).toContain(">Bye<");
    expect(pool).not.toMatch(/\bMISSED\b|SKIP_WEEK/);
    expect(pool).toBe(ours);
  });

  it("puts no sentinel on the page in either scope", async () => {
    for (const out of [await render(), await render("ours")]) {
      expect(out).not.toMatch(/\bMISSED\b|SKIP_WEEK|\bLOCKED\b/);
    }
  });
});
