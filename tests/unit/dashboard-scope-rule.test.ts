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
//   (won); alive 6 of 7; lost 4, 1      1 BYE; alive 11 of 1,318; lost 2,
//   out; chalk NYJ 4 picks 57% fell;    0 out; chalk PHI 8 picks 80% held;
//   start 7, remaining 6, -1 14%; NYJ   start 1,318, remaining 11, -2 15%;
//   57%, MIA 29%, GB 14%; carnage NYJ   PHI 80%, DAL 20%; carnage DAL 2, 0
//   4, 1 out; No Losses=3, Loss/Bye=3,  out; No Losses=8, Loss/Bye=3, Out=2,
//   Out=1, "We are down to 6"; scarcity "11 left"; scarcity PHI 3/11, DAL
//   NYJ 3/6, MIA 4/6, GB 5/6.           9/11.
//
// Ours 1 carries a stored loss already, so its NYJ loss puts it OUT: that
// is what makes out-this-week disagree too. With every one of ours alive it
// was 0 on both scopes, and a panel routing that one figure to our group
// passed the guard (found on review, 2026-09-15). Every figure a panel can
// print now differs between the scopes.
//
// The teams do not overlap either, so a team code is as telling as a number.
// Every game is final and kicked off in the past, so nothing is masked and
// the reveal gate is not what keeps a figure off the page.
//
// Broken before it was trusted, each recorded in its commit: our entries fed
// to the pool scope in the page; one panel (Teams running out) reading ours
// whatever the toggle; a scope label on Recent activity; out-this-week
// routed to ours under Everyone; an eyebrow and a title attribute on the
// feed card ABOVE its title; and the feed's MISSED branch removed.

const fixture = vi.hoisted(() => ({
  // Switchable to no sheet: the only state the page can open on Our group
  // without a click, which a server render cannot make.
  noSheet: false,
}));

vi.mock("../../src/lib/data", () => {
  // Ours 1 already holds one stored loss, so the week's NYJ loss is its
  // second and scoreFromGames reads it out: 1 now out on our scope, 0 on
  // the pool's.
  const entry = (i: number) => ({
    id: `o-${i}`,
    entryName: `Ours ${i}`,
    nameIsDefault: false,
    ownerId: "o",
    ownerName: "O",
    wins: 0,
    losses: i === 1 ? 1 : 0,
    livesRemaining: i === 1 ? 1 : 2,
    status: i === 1 ? "at_risk" : "active",
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
  numbers: [/\b7\b/, /\b6\b/, /\b4\b/, /\b57\b/, /\b29\b/, /\b14\b/],
  strings: [
    ">NYJ<",
    ">MIA<",
    ">GB<",
    "New York Jets",
    "Miami Dolphins",
    "Green Bay Packers",
    "of 7",
    "/6<",
    "6 left",
    "We are down to",
    "4 picks",
    "4 entries lost",
    "1 now out",
    "1 of them out",
    "57%",
    "29%",
    "14%",
    'title="No Losses: 3"',
    'title="Out: 1"',
  ],
};

describe("the dashboard scope rule - no our-only figure under Everyone", () => {
  it("opens on Everyone and prints the pool's figures on every panel", async () => {
    const out = await html();
    expect(out).toMatch(/aria-checked="true"[^>]*>Everyone<span[^>]*>13</);
    expect(out).toMatch(/aria-checked="false"[^>]*>Our group<span[^>]*>7</);
    const p = panels(out);
    expect(p).toMatch(/Alive<\/p><p class="[^"]*">11<\/p><p class="[^"]*">of 1,318</);
    expect(p).toMatch(/Lost this week<\/p><p class="[^"]*">2<\/p><p class="[^"]*">0 now out</);
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
      expect(p).toMatch(/Alive<\/p><p class="[^"]*">6<\/p><p class="[^"]*">of 7</);
      expect(p).toMatch(/Lost this week<\/p><p class="[^"]*">4<\/p><p class="[^"]*">1 now out</);
      expect(p).toMatch(/Remaining<\/p><p class="[^"]*">6</);
      expect(p).toMatch(/Chalk<\/p><p class="[^"]*">NYJ<span[^>]*>57%/);
      expect(p).toContain("No Losses=3, 1 Loss/Bye used=3 and Out=1. We are down to 6 left in the pool.");
      expect(p).toContain("4 entries lost this week, 1 of them out - 3 of 3 games final.");
      expect(p).toMatch(/>NYJ<[\s\S]*?>3\/6</);
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
  // The WHOLE card, from its root element: Card renders data-slot="card" on
  // its root div (src/components/ui/card.tsx). Slicing from the title left
  // the header above it unread, so an eyebrow placed before the title, or a
  // title attribute on the card itself, passed every test here (found on
  // review, 2026-09-15). Nothing on the page follows the card, so the slice
  // runs to the end of the markup.
  const card = (out: string) => {
    const i = out.indexOf(">Recent activity<");
    expect(i, "the card is on the page").toBeGreaterThan(-1);
    const start = out.lastIndexOf('<div data-slot="card"', i);
    expect(start, "the card wraps the title").toBeGreaterThan(-1);
    return out.slice(start);
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

  it("prints a missed week as No pick and a bye as Bye - the values reach no screen as words", async () => {
    // The rules engine writes MISSED into the team column
    // (20260821000008_rules_engine.sql), as it writes SKIP_WEEK for a bye,
    // and the feed rendered it verbatim - "MISSED Missed" - until
    // 2026-09-15. Rendered directly: the page fixture cannot hold a missed
    // week without moving the seven-entry figures every assertion above
    // pins, and the branch is the component's.
    const { RecentActivity } = await import("../../src/components/dashboard/recent-activity");
    const { MISSED_TEAM, NO_PICK_LABEL } = await import("../../src/lib/dashboard");
    const { SKIP_WEEK } = await import("../../src/lib/standing");
    const out = renderToStaticMarkup(
      RecentActivity({
        rows: [
          { entryId: "o-1", entryName: "Ours 1", team: MISSED_TEAM, week: 2, result: "missed" },
          { entryId: "o-2", entryName: "Ours 2", team: SKIP_WEEK, week: 2, result: "bye" },
        ],
      }),
    );
    expect(out).toContain(`>${NO_PICK_LABEL}<`);
    expect(out).toContain(">Bye<");
    expect(out).not.toContain("MISSED");
    expect(out).not.toContain("SKIP_WEEK");
  });
});
