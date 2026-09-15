import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// THE DASHBOARD SCOPE RULE, set by Anthony on 2026-09-15 - "this is the rule
// not a list of fixes": every panel on the dashboard shows the WHOLE POOL
// unless the toggle is set to Our group. Recent activity is the one
// exception - our intake, which can only ever be ours - and it carries no
// label saying so.
//
// The guard: no viewer-scope panel renders a figure derived only from our
// entries while the toggle is on Everyone. The fixture makes the two scopes
// DISAGREE ON EVERY FIGURE a panel can print. Our group has exactly SEVEN
// entries and every our-only figure is a number the pool's rows cannot
// produce; the pool has thirteen rows and prints none of ours.
//
//   our group (7)                       the pool (13 rows, 1,318 published)
//   4 NYJ (lost), 2 MIA (won), 1 GB     8 PHI (won), 2 DAL (lost), 2 OUT,
//   (won); alive 7 of 7; lost 4, 0      1 BYE; alive 11 of 1,318; lost 2,
//   out; chalk NYJ 4 picks 57% fell;    0 out; chalk PHI 8 picks 80% held;
//   start 7, remaining 7; NYJ 57%, MIA  start 1,318, remaining 11, -2 15%;
//   29%, GB 14%; carnage NYJ 4; No      PHI 80%, DAL 20%; carnage DAL 2; No
//   Losses=3, Loss/Bye=4, Out=0, "We    Losses=8, Loss/Bye=3, Out=2, "11
//   are down to 7"; scarcity NYJ 3/7,   left"; scarcity PHI 3/11, DAL 9/11.
//   MIA 5/7, GB 6/7.
//
// The teams do not overlap either, so a team code is as telling as a number.
// Every game is final and kicked off in the past, so nothing is masked and
// the reveal gate is not what keeps a figure off the page.
//
// Broken three ways before it was trusted, each recorded in the commit:
// our entries fed to the pool scope in the page; one panel (Teams running
// out) reading ours whatever the toggle; and a scope label on Recent
// activity.

const fixture = vi.hoisted(() => ({
  // Switchable to no sheet: the only state the page can open on Our group
  // without a click, which a server render cannot make.
  noSheet: false,
}));

vi.mock("../../src/lib/data", () => {
  const entry = (i: number) => ({
    id: `o-${i}`,
    entryName: `Ours ${i}`,
    nameIsDefault: false,
    ownerId: "o",
    ownerName: "O",
    wins: 0,
    losses: 0,
    livesRemaining: 2,
    status: "active",
    byeUsed: false,
    teamsUsed: [],
    lastScoredWeek: null,
    isAdminEntry: false,
  });
  // A stored "pending" on a final game is what scoreFromGames reads, so
  // every one of ours resolves to a result for display.
  const cell = (i: number, team: string) => ({
    entryId: `o-${i}`,
    week: 1,
    team,
    result: "pending",
    late: false,
    submittedAt: `2026-09-08T00:0${i}:00Z`,
    source: "text",
    resultSource: null,
  });
  const game = (id: string, home: string, away: string, hs: number, as: number) => ({
    id,
    week: 1,
    kickoffAt: "2026-09-06T17:00:00Z",
    dayOfWeek: "Sunday",
    homeTeam: home,
    awayTeam: away,
    homeScore: hs,
    awayScore: as,
    status: "final",
    revealOverride: null,
    network: "FOX",
  });
  const row = (no: number, cellText: string) => ({ no, names: `Row ${no}`, cells: { "Week 1": cellText }, entryId: null });
  return {
    getData: () => ({
      getEntries: async () => [1, 2, 3, 4, 5, 6, 7].map(entry),
      getWeeks: async () => [
        { week: 1, deadlineAt: "2026-09-11T18:00:00Z", earlyDeadlineAt: "2026-09-09T18:00:00Z", lateDeadlineAt: "2026-09-11T18:00:00Z" },
      ],
      getGridCells: async () => [cell(1, "NYJ"), cell(2, "NYJ"), cell(3, "NYJ"), cell(4, "NYJ"), cell(5, "MIA"), cell(6, "MIA"), cell(7, "GB")],
      getPot: async () => ({ entryCount: 7, poolEntryCount: 1318, poolFreeCount: 46, poolPaidCount: 1272, poolPotCents: 2862000 }),
      getSchedule: async () => [game("g-pool", "PHI", "DAL", 24, 17), game("g-jets", "MIA", "NYJ", 21, 14), game("g-pack", "GB", "CHI", 27, 10)],
      getMasterList: async () => ({
        loadedAt: fixture.noSheet ? null : "2026-09-12T02:40:00Z",
        rows: fixture.noSheet
          ? []
          : [
              ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(n, "Philadelphia")),
              row(9, "Dallas"),
              row(10, "Dallas"),
              row(11, "OUT"),
              row(12, "OUT"),
              row(13, "BYE"),
            ],
      }),
    }),
  };
});

import DashboardPage from "../../src/app/page";

const html = async () => renderToStaticMarkup(await DashboardPage());

/** The scoped section's markup, toggle buttons removed - the "Our group 7" button is the one place our count may appear. */
function panels(out: string): string {
  const a = out.indexOf("<section");
  const b = out.indexOf("</section>", a);
  expect(a, "the scoped section is on the page").toBeGreaterThan(-1);
  return out.slice(a, b).replace(/<button[^>]*role="radio"[\s\S]*?<\/button>/g, "");
}

/** Visible text plus every title attribute, tags dropped, so a class like gap-4 is not a 4. */
function readable(markup: string): string {
  const titles = [...markup.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
  return [markup.replace(/<[^>]+>/g, " "), ...titles].join(" ").replace(/&#x27;/g, "'");
}

/** Every our-only figure, as it would be printed. None of these can come from the pool's rows. */
const OURS_ONLY = {
  numbers: [/\b7\b/, /\b4\b/, /\b57\b/, /\b29\b/, /\b14\b/],
  strings: [
    ">NYJ<",
    ">MIA<",
    ">GB<",
    "New York Jets",
    "Miami Dolphins",
    "Green Bay Packers",
    "of 7",
    "/7<",
    "7 left",
    "We are down to",
    "4 picks",
    "4 entries lost",
    "57%",
    "29%",
    "14%",
    'title="No Losses: 3"',
    'title="Loss/Bye: 4"',
  ],
};

describe("the dashboard scope rule - no our-only figure under Everyone", () => {
  it("opens on Everyone and prints the pool's figures on every panel", async () => {
    const out = await html();
    expect(out).toMatch(/aria-checked="true"[^>]*>Everyone<span[^>]*>13</);
    expect(out).toMatch(/aria-checked="false"[^>]*>Our group<span[^>]*>7</);
    const p = panels(out);
    expect(p).toMatch(/Alive<\/p><p class="[^"]*">11<\/p><p class="[^"]*">of 1,318</);
    expect(p).toMatch(/Lost this week<\/p><p class="[^"]*">2<\/p>/);
    expect(p).toMatch(/Chalk<\/p><p class="[^"]*">PHI<span[^>]*>80%/);
    expect(p).toMatch(/Start<\/p><p class="[^"]*">1,318</);
    expect(p).toMatch(/Remaining<\/p><p class="[^"]*">11</);
    expect(p).toContain("No Losses=8, 1 Loss/Bye used=3 and Out=2. 11 left in the pool.");
    expect(p).toContain("2 entries lost this week, 0 of them out - 3 of 3 games final.");
    expect(p).toMatch(/>PHI<[\s\S]*?>3\/11</);
    expect(p).toMatch(/>DAL<[\s\S]*?>9\/11</);
  });

  it("prints NONE of our group's figures on any panel while the toggle is on Everyone", async () => {
    const p = panels(await html());
    const text = readable(p);
    for (const re of OURS_ONLY.numbers) {
      expect(text, `an our-only number ${re} reached a panel under Everyone`).not.toMatch(re);
    }
    for (const s of OURS_ONLY.strings) {
      expect(p, `an our-only figure "${s}" reached a panel under Everyone`).not.toContain(s);
    }
    // The two words are the toggle's; with its buttons removed, the panels
    // and their captions name our group nowhere.
    expect(p).not.toContain("Our group");
    expect(p).not.toContain("stands in");
  });

  it("prints every one of those figures under Our group, so the fixture is real", async () => {
    // No sheet loaded is the one state the page opens on Our group; the
    // ours scope is built by the same page wiring either way.
    fixture.noSheet = true;
    try {
      const out = await html();
      expect(out).toMatch(/aria-checked="true"[^>]*>Our group<span[^>]*>7</);
      const p = panels(out);
      const text = readable(p);
      for (const re of OURS_ONLY.numbers) {
        expect(text, `our figure ${re} is missing under Our group`).toMatch(re);
      }
      for (const s of OURS_ONLY.strings) {
        expect(p, `our figure "${s}" is missing under Our group`).toContain(s);
      }
      expect(p).toMatch(/Alive<\/p><p class="[^"]*">7<\/p><p class="[^"]*">of 7</);
      expect(p).toMatch(/Lost this week<\/p><p class="[^"]*">4<\/p>/);
      expect(p).toMatch(/Chalk<\/p><p class="[^"]*">NYJ<span[^>]*>57%/);
      expect(p).toContain("No Losses=3, 1 Loss/Bye used=4 and Out=0. We are down to 7 left in the pool.");
      expect(p).toContain("4 entries lost this week, 0 of them out - 3 of 3 games final.");
      expect(p).toMatch(/>NYJ<[\s\S]*?>3\/7</);
      // And none of the pool's, which is the same rule read the other way.
      expect(p).not.toContain("1,318");
      expect(p).not.toContain(">PHI<");
      expect(p).not.toContain("11 left");
    } finally {
      fixture.noSheet = false;
    }
  });

  it("says the week is not published on the picks card, with no stand-in, when her sheet lacks the week", async () => {
    // The pool's picks card is the one that used to fall through to our
    // rows. It is asked through the builder's own predicate, so this reads
    // the page's copy for that branch rather than re-deriving it.
    const { dashboardScope } = await import("../../src/lib/dashboard-scope");
    const scope = dashboardScope({
      key: "pool",
      entries: [],
      cells: [],
      games: [],
      now: new Date("2026-09-15T12:00:00Z"),
      week: 2,
      start: 1318,
      weekPublished: () => false,
      distribution: { rows: null, empty: "unpublished", lockedAt: null, caption: "The master pool's Week 2 picks are not published yet." },
    });
    expect(scope.distribution.rows).toBeNull();
    expect(scope.distribution.empty).toBe("unpublished");
    expect(scope.carnage).toEqual({ state: "no final" });
    expect(scope).not.toHaveProperty("activity");
  });
});

describe("Recent activity is the one exception - ours, unlabelled, outside the toggle", () => {
  const card = (out: string) => {
    const i = out.indexOf(">Recent activity<");
    expect(i, "the card is on the page").toBeGreaterThan(-1);
    return out.slice(i);
  };

  it("sits after the scoped section, so no toggle state can reach it", async () => {
    const out = await html();
    expect(out.indexOf(">Recent activity<")).toBeGreaterThan(out.indexOf("</section>"));
    // And the section itself renders no such card.
    expect(panels(out)).not.toContain("Recent activity");
  });

  it("renders identically under both toggle states, carrying our rows and no scope word", async () => {
    const everyone = card(await html());
    fixture.noSheet = true;
    let ours: string;
    try {
      ours = card(await html());
    } finally {
      fixture.noSheet = false;
    }
    expect(everyone).toBe(ours);
    // Our seven, each scored from its final: the feed is our intake.
    for (let i = 1; i <= 7; i++) expect(everyone).toContain(`href="/entry/o-${i}"`);
    expect(everyone).toContain("New York Jets");
    expect(everyone).toContain("Green Bay Packers");
    // No label, caption, count or word saying whose it is. The regex is the
    // toggle's two words, their lower-case leak, the scope key and the word
    // itself - a caption reading "Our group's own feed" fails here.
    expect(everyone).not.toMatch(/Our group|Everyone|our group|\bours\b|\bscope\b|\bpool\b/);
    expect(everyone).not.toMatch(/\b7 entries\b/);
  });
});
