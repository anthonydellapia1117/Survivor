import { describe, expect, it } from "vitest";
import { dashboardScope, type ScopeInput } from "@/lib/dashboard-scope";
import type { EntrySummary, GameRow, GridCell } from "@/lib/data/types";

// The builder's gates, driven through dashboardScope itself rather than the
// arithmetic under it, because each of these was found by a probe through the
// real builder after the arithmetic's own tests were green:
//
//   - the Chalk tile is a SHARE and waited only for a final, so a Thursday
//     night read the TNF team as 100% of one revealed pick;
//   - the pool's tiles for a week her sheet does not carry read zero losses
//     and "no game final yet" while a game was final;
//   - the survival drop reached a week at its first final and presented a
//     Thursday-night zero as the week's cost.

function cell(entryId: string, week: number, result: GridCell["result"], team: string): GridCell {
  return { entryId, week, team, result, late: false, submittedAt: "2026-09-01T00:00:00Z", source: "admin", resultSource: null };
}

function entry(id: string, status: EntrySummary["status"] = "active"): EntrySummary {
  return {
    id,
    entryName: id,
    nameIsDefault: false,
    isFreeEntry: false,
    ownerId: "o",
    ownerName: "O",
    wins: 0,
    losses: 0,
    livesRemaining: 2,
    status,
    byeUsed: false,
    teamsUsed: [],
    isAdminEntry: false,
    lastScoredWeek: null,
  };
}

function game(id: string, week: number, home: string, away: string, over: Partial<GameRow> = {}): GameRow {
  return {
    id,
    week,
    kickoffAt: "2026-09-13T17:00:00Z",
    dayOfWeek: "Sunday",
    homeTeam: home,
    awayTeam: away,
    homeScore: 24,
    awayScore: 17,
    status: "final",
    revealOverride: null,
    network: "FOX",
    ...over,
  } as GameRow;
}

const now = new Date("2026-09-15T12:00:00Z");
const distribution: ScopeInput["distribution"] = { scope: "pool", rows: null, empty: "none", caption: "", lockedAt: null };

function build(over: Partial<ScopeInput>) {
  return dashboardScope({
    key: "pool",
    entries: [],
    cells: [],
    games: [],
    now,
    week: 2,
    start: null,
    weekPublished: () => true,
    distribution,
    ...over,
  });
}

describe("the Chalk tile waits for the whole week", () => {
  // Thursday night of Week 2: SEA final, a Sunday game held back. Five
  // entries, one revealed on SEA, four LOCKED.
  const entries = ["a", "b", "c", "d", "e"].map((id) => entry(id));
  const cells = [cell("a", 2, "win", "SEA"), ...["b", "c", "d", "e"].map((id) => cell(id, 2, null, "LOCKED"))];
  const thursday = [game("thu", 2, "SEA", "NE"), game("sun", 2, "BUF", "MIA", { status: "scheduled", homeScore: null, awayScore: null, revealOverride: false })];

  it("names no chalk while a pick of the week is masked, and says the picks are masked", () => {
    const s = build({ entries, cells, games: thursday });
    expect(s.kpis.revealed).toBe(false);
    expect(s.kpis.anyFinal).toBe(true);
    expect(s.kpis.chalk).toBeNull();
    // The same shape the chalk card takes: nothing for Week 2 yet.
    expect(s.chalk.find((c) => c.week === 2)).toBeUndefined();
  });

  it("names it once every game has kicked off", () => {
    const monday = [thursday[0], { ...thursday[1], revealOverride: true }];
    const s = build({ entries, cells: [cell("a", 2, "win", "SEA"), ...["b", "c", "d", "e"].map((id) => cell(id, 2, "pending", "BUF"))], games: monday });
    expect(s.kpis.revealed).toBe(true);
    expect(s.kpis.chalk).toMatchObject({ team: "BUF", count: 4, pct: 80, state: "not final" });
  });
});

describe("a week the pool's sheet does not carry", () => {
  // Her newest sheet has Week 1 only; Week 2's Thursday game is final.
  const entries = [entry("a"), entry("b")];
  const cells = [cell("a", 1, "win", "PHI"), cell("b", 1, "loss", "DAL")];
  const games = [game("w1", 1, "PHI", "DAL"), game("w2", 2, "SEA", "NE"), game("w2b", 2, "BUF", "MIA", { status: "scheduled", homeScore: null, awayScore: null })];
  const herWeeks = new Set([1]);

  it("is not published on the tiles - never a zero, never 'no game final yet'", () => {
    const s = build({ entries, cells, games, weekPublished: (w) => herWeeks.has(w) });
    expect(s.kpis.published).toBe(false);
    expect(s.kpis.anyFinal).toBe(true);
    expect(s.kpis.chalk).toBeNull();
  });

  it("is unpublished on the carnage card, which names the week", () => {
    const s = build({ entries, cells, games, weekPublished: (w) => herWeeks.has(w) });
    expect(s.carnage).toEqual({ state: "unpublished", week: 2 });
  });

  it("is ordinary carnage for our own record, which holds every week", () => {
    const s = build({ key: "ours", entries, cells, games });
    expect(s.kpis.published).toBe(true);
    expect(s.carnage).toMatchObject({ state: "ready", week: 2, lostTotal: 0, finalGames: 1, totalGames: 2 });
  });

  it("is 'no final' only before any game anywhere is final", () => {
    const s = build({ entries, cells, games: games.map((g) => ({ ...g, status: "scheduled" as const, homeScore: null, awayScore: null })) });
    expect(s.carnage).toEqual({ state: "no final" });
  });
});

describe("the survival drop", () => {
  const entries = [entry("a"), entry("b", "eliminated"), entry("c")];
  const cells = [cell("a", 1, "win", "PHI"), cell("b", 1, "loss", "DAL"), cell("c", 1, "win", "PHI"), cell("b", 2, "loss", "NE")];

  it("is the week so far while a game of it is not final", () => {
    const games = [game("w1", 1, "PHI", "DAL"), game("w2", 2, "SEA", "NE"), game("w2b", 2, "BUF", "MIA", { status: "scheduled", homeScore: null, awayScore: null })];
    const s = build({ entries, cells, games });
    expect(s.survival.drop).toEqual({ week: 2, n: 1, pct: 33, partial: true });
  });

  it("is the week, settled, once every game of it is final", () => {
    const games = [game("w1", 1, "PHI", "DAL"), game("w2", 2, "SEA", "NE"), game("w2b", 2, "BUF", "MIA")];
    const s = build({ entries, cells, games });
    expect(s.survival.drop).toEqual({ week: 2, n: 1, pct: 33, partial: false });
  });
});
