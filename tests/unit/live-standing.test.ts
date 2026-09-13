import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIVE_RESULT_SOURCE, scoreFromGames } from "../../src/lib/live-standing";
import { poolAsEntries, type MasterRow } from "../../src/lib/master-list";
import type { EntrySummary, GameRow, GridCell } from "../../src/lib/data/types";

// Our own entries scored for display from nfl_games, the way her rows already
// are. Set by Anthony on 2026-09-13: the Everyone scope coloured Week 1's
// finished games while the Our-group scope, /entry/[id] and the dashboard
// still read pending for the same games, because picks.result is written
// only from her results file. The stored record is not changed; this layer
// reads a stored pending against the scores and nothing else.

type G = Pick<GameRow, "week" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "status">;
const GAMES: G[] = [
  { week: 1, homeTeam: "PHI", awayTeam: "DAL", homeScore: 24, awayScore: 17, status: "final" },
  { week: 1, homeTeam: "CHI", awayTeam: "GB", homeScore: 20, awayScore: 20, status: "final" },
  // In progress: contributes nothing, whatever the score reads right now.
  { week: 1, homeTeam: "LAC", awayTeam: "ARI", homeScore: 14, awayScore: 3, status: "in_progress" },
  { week: 2, homeTeam: "BUF", awayTeam: "NYJ", homeScore: 31, awayScore: 10, status: "final" },
  { week: 8, homeTeam: "SEA", awayTeam: "SF", homeScore: 10, awayScore: 27, status: "final" },
];

const entry = (id: string, over: Partial<EntrySummary> = {}): EntrySummary => ({
  id,
  entryName: id,
  nameIsDefault: false,
  ownerId: "o",
  ownerName: "Owner",
  wins: 0,
  losses: 0,
  livesRemaining: 2,
  status: "active",
  byeUsed: false,
  teamsUsed: [],
  lastScoredWeek: null,
  isAdminEntry: false,
  ...over,
});

const cell = (entryId: string, week: number, team: string, over: Partial<GridCell> = {}): GridCell => ({
  entryId,
  week,
  team,
  result: "pending",
  late: false,
  submittedAt: "2026-09-11T15:00:00Z",
  source: "email",
  resultSource: null,
  ...over,
});

describe("scoring our cells from the games", () => {
  it("reads a stored pending on a final game as the game's result, and marks where it came from", () => {
    const { cells } = scoreFromGames(
      [entry("w"), entry("l"), entry("t")],
      [cell("w", 1, "PHI"), cell("l", 1, "DAL"), cell("t", 1, "GB")],
      GAMES,
    );
    expect(cells.map((c) => [c.entryId, c.result, c.resultSource])).toEqual([
      ["w", "win", LIVE_RESULT_SOURCE],
      ["l", "loss", LIVE_RESULT_SOURCE],
      ["t", "tie_loss", LIVE_RESULT_SOURCE],
    ]);
  });

  it("never overrides a STORED result - her file is the record, the scores only fill a pending", () => {
    // Stored win on a team the scores say lost: the stored result stands.
    const stored = cell("s", 1, "DAL", { result: "win", resultSource: "lynne_import" });
    const { cells, entries } = scoreFromGames([entry("s", { wins: 1, lastScoredWeek: 1 })], [stored], GAMES);
    expect(cells[0]).toBe(stored);
    expect(entries[0].wins).toBe(1);
    expect(entries[0].losses).toBe(0);
  });

  it("leaves an in-progress game, a masked pick, a bye and a missed week exactly as they came", () => {
    const untouched = [
      cell("a", 1, "LAC"), // in progress
      cell("b", 1, "LOCKED", { result: null }), // masked: no team to score
      cell("c", 1, "SKIP_WEEK", { result: "bye" }),
      cell("d", 1, "MISSED", { result: "missed" }),
      cell("e", 3, "PHI"), // no game stored for that week
    ];
    const { cells } = scoreFromGames(["a", "b", "c", "d", "e"].map((id) => entry(id)), untouched, GAMES);
    cells.forEach((c, i) => expect(c).toBe(untouched[i]));
  });

  it("returns an entry the scores add nothing to as the SAME object", () => {
    const e = entry("same", { wins: 3, losses: 1, status: "at_risk", livesRemaining: 1, lastScoredWeek: 4 });
    const { entries } = scoreFromGames([e], [cell("same", 1, "LAC")], GAMES);
    expect(entries[0]).toBe(e);
  });
});

describe("the standing an entry reaches, mirroring v_entry_standing", () => {
  it("a win is active with the week scored; one loss is at risk with one life", () => {
    const { entries } = scoreFromGames(
      [entry("w"), entry("l")],
      [cell("w", 1, "PHI"), cell("l", 1, "DAL")],
      GAMES,
    );
    expect(entries[0]).toMatchObject({ wins: 1, losses: 0, status: "active", livesRemaining: 2, lastScoredWeek: 1 });
    expect(entries[1]).toMatchObject({ wins: 0, losses: 1, status: "at_risk", livesRemaining: 1, lastScoredWeek: 1 });
  });

  it("two losses is eliminated with no lives, stored and scored losses counted together", () => {
    // One loss already stored from her file, a second read from the scores.
    const e = entry("x", { losses: 1, status: "at_risk", livesRemaining: 1, lastScoredWeek: 1 });
    const { entries } = scoreFromGames([e], [cell("x", 2, "NYJ")], GAMES);
    expect(entries[0]).toMatchObject({ losses: 2, status: "eliminated", livesRemaining: 0, lastScoredWeek: 2 });
  });

  it("a single loss past the double-elimination boundary is eliminated", () => {
    const { entries } = scoreFromGames([entry("late")], [cell("late", 8, "SEA")], GAMES);
    expect(entries[0]).toMatchObject({ losses: 1, status: "eliminated", livesRemaining: 0 });
    // And the boundary is a parameter, not a constant: through week 8 it is a
    // first loss, at risk.
    const wide = scoreFromGames([entry("late")], [cell("late", 8, "SEA")], GAMES, 8);
    expect(wide.entries[0]).toMatchObject({ losses: 1, status: "at_risk", livesRemaining: 1 });
  });

  it("a clean row whose last scored week reaches the boundary is bye eligible, unless the bye is used", () => {
    const { entries } = scoreFromGames(
      [entry("clean"), entry("byed", { byeUsed: true })],
      [cell("clean", 8, "SF"), cell("byed", 8, "SF")],
      GAMES,
    );
    expect(entries[0].status).toBe("bye_eligible");
    expect(entries[1].status).toBe("active");
  });

  it("a stored elimination stays eliminated whatever the scores add", () => {
    const e = entry("out", { status: "eliminated", livesRemaining: 0, losses: 0 });
    const { entries } = scoreFromGames([e], [cell("out", 1, "PHI")], GAMES);
    expect(entries[0]).toMatchObject({ status: "eliminated", livesRemaining: 0, wins: 1 });
  });

  it("gives one of ours the SAME standing her row of the same picks gets - the two scopes are identical", () => {
    // Her row, scored by poolAsEntries from the same games.
    const rows: MasterRow[] = [
      { no: 1, names: "Lost", cells: { "Week 1": "Dallas" }, entryId: "ours-l" },
      { no: 2, names: "Won", cells: { "Week 1": "Philadelphia" }, entryId: "ours-w" },
      { no: 3, names: "Tied", cells: { "Week 1": "Green Bay" }, entryId: "ours-t" },
    ];
    const hers = poolAsEntries({ loadedAt: "2026-09-12T00:00:00Z", rows }, GAMES);
    const ours = scoreFromGames(
      [entry("ours-l"), entry("ours-w"), entry("ours-t")],
      [cell("ours-l", 1, "DAL"), cell("ours-w", 1, "PHI"), cell("ours-t", 1, "GB")],
      GAMES,
    );
    const standing = (e: EntrySummary) => ({ wins: e.wins, losses: e.losses, status: e.status, lives: e.livesRemaining });
    expect(ours.entries.map(standing)).toEqual(hers.entries.map(standing));
    expect(ours.cells.map((c) => c.result)).toEqual(hers.cells.map((c) => c.result));
  });
});

describe("where it is wired", () => {
  // Every public page that renders one of OUR entries' standing or cells
  // passes them through scoreFromGames. A page that reads the stored record
  // straight from getData() shows pending for a game the Grid's Everyone
  // scope has already coloured, which is the bug this exists to fix.
  const PAGES = [
    "src/app/grid/page.tsx",
    "src/app/page.tsx",
    "src/app/teams/page.tsx",
    "src/app/schedule/page.tsx",
    "src/app/records/roster/page.tsx",
    "src/app/entry/[id]/page.tsx",
  ];
  for (const p of PAGES) {
    it(`${p} scores our entries from the games before rendering`, () => {
      const src = readFileSync(p, "utf8");
      expect(src).toMatch(/scoreFromGames\(/);
      expect(src).toMatch(/from "@\/lib\/live-standing"/);
    });
  }
});
