import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lockedWeeks, teamHeat } from "../../src/lib/team-counts";
import { TeamsClient } from "../../src/components/teams/teams-client";
import { TONE_FILL_CLASS } from "../../src/lib/result-colour";
import type { GameRow, TeamPickCount, WeekRow } from "../../src/lib/data/types";

// The Teams page's counts, set by Anthony on 2026-09-13: a team's count
// appears the moment the WEEK's pick deadline has passed, from the weeks
// table, and stays hidden before it. Colour still needs a stored final.
// Each guard here was broken on purpose before it was trusted.

const week = (n: number, lateDeadlineAt: string): WeekRow => ({
  week: n,
  windowLabel: "sat_mon",
  deadlineAt: lateDeadlineAt,
  earlyDeadlineAt: lateDeadlineAt,
  lateDeadlineAt,
  resultsFinal: false,
  confirmed: true,
});

// Week 1 locked Friday 2026-09-11 2 PM ET; Week 2 locks a week later.
const WEEKS: WeekRow[] = [
  week(1, "2026-09-11T18:00:00Z"),
  week(2, "2026-09-18T18:00:00Z"),
];
/** Sunday 2026-09-13 5:20 PM ET: Week 1 locked, Week 2 open. */
const NOW = new Date("2026-09-13T21:20:00Z");
/** Friday 1:59 PM ET, a minute before Week 1 locks. */
const BEFORE = new Date("2026-09-11T17:59:00Z");

const game = (over: Partial<GameRow>): GameRow => ({
  id: "g",
  week: 1,
  kickoffAt: "2026-09-13T17:00:00Z",
  dayOfWeek: "Sunday",
  awayTeam: "DAL",
  homeTeam: "PHI",
  homeScore: null,
  awayScore: null,
  status: "scheduled",
  revealOverride: null,
  network: null,
  ...over,
});
const GAMES: GameRow[] = [
  game({ id: "final", homeTeam: "PHI", awayTeam: "DAL", homeScore: 24, awayScore: 17, status: "final" }),
  game({ id: "live", homeTeam: "LAC", awayTeam: "ARI", homeScore: 14, awayScore: 3, status: "in_progress" }),
  game({ id: "later", homeTeam: "NYG", awayTeam: "DEN", kickoffAt: "2026-09-14T00:20:00Z" }),
  game({ id: "w2", week: 2, homeTeam: "BUF", awayTeam: "NYJ", kickoffAt: "2026-09-20T17:00:00Z" }),
];

const count = (w: number, team: string, n: number): TeamPickCount => ({ scope: "pool", week: w, team, n });
const COUNTS: TeamPickCount[] = [
  count(1, "PHI", 40),
  count(1, "DAL", 3),
  count(1, "LAC", 12),
  count(1, "DEN", 9),
  count(1, "NYG", 1),
  // Handed over for an open week: must never render.
  count(2, "BUF", 55),
];

describe("which weeks have locked", () => {
  it("is every week whose late deadline has passed, read from the weeks table", () => {
    expect([...lockedWeeks(WEEKS, NOW)]).toEqual([1]);
    expect([...lockedWeeks(WEEKS, BEFORE)]).toEqual([]);
    expect([...lockedWeeks(WEEKS, new Date("2026-09-18T18:00:00Z"))]).toEqual([1, 2]);
  });
});

describe("the board", () => {
  it("carries every team with a pick once the week has locked, whatever its game's state", () => {
    const h = teamHeat(COUNTS, WEEKS, NOW);
    expect([...h.byTeam.keys()].sort()).toEqual(["DAL", "DEN", "LAC", "NYG", "PHI"]);
    expect(h.byTeam.get("DEN")?.get(1)).toBe(9); // scheduled
    expect(h.byTeam.get("LAC")?.get(1)).toBe(12); // in progress
    expect(h.byTeam.get("PHI")?.get(1)).toBe(40); // final
  });

  it("drops a count for a week that has not locked, even if a read handed it over", () => {
    const h = teamHeat(COUNTS, WEEKS, NOW);
    expect(h.byTeam.get("BUF")).toBeUndefined();
    expect(h.byWeek.get(2)).toBeUndefined();
    // And before the deadline the whole board is empty.
    const b = teamHeat(COUNTS, WEEKS, BEFORE);
    expect(b.total).toBe(0);
    expect(b.byTeam.size).toBe(0);
  });

  it("sums each locked week's column for the total row", () => {
    const h = teamHeat(COUNTS, WEEKS, NOW);
    expect(h.byWeek.get(1)).toBe(40 + 3 + 12 + 9 + 1);
    expect(h.total).toBe(65);
  });
});

describe("the Teams table as rendered", () => {
  const render = (now: Date, counts = COUNTS) =>
    renderToStaticMarkup(
      React.createElement(TeamsClient, { counts, weeks: WEEKS, games: GAMES, entryCount: 121, now }),
    );
  /** The cell for a team in a week, by its title attribute. */
  const cell = (html: string, team: string, w: number) =>
    new RegExp(`<td[^>]*title="[^"]* - week ${w}[^"]*"[^>]*>`).exec(
      html.slice(html.indexOf(`>${team}<`) >= 0 ? html.indexOf(`>${team}<`) : 0),
    )?.[0] ?? "";
  const cellFor = (html: string, name: string, w: number) =>
    new RegExp(`<td[^>]*title="${name} - week ${w}[^"]*"[^>]*>[^<]*</td>`).exec(html)?.[0] ?? "";

  it("renders no count for a week whose deadline has not passed", () => {
    const html = render(BEFORE);
    expect(html).toContain("No week has locked yet");
    expect(cellFor(html, "Philadelphia Eagles", 1)).toMatch(/><\/td>$/);
    expect(cellFor(html, "Buffalo Bills", 2)).toMatch(/><\/td>$/);
    // Week 2 stays empty after Week 1 locks, too.
    expect(cellFor(render(NOW), "Buffalo Bills", 2)).toMatch(/><\/td>$/);
  });

  it("renders a count for every team with a pick once the week has locked - final, in progress and scheduled alike", () => {
    const html = render(NOW);
    expect(cellFor(html, "Philadelphia Eagles", 1)).toMatch(/>40<\/td>$/);
    expect(cellFor(html, "Los Angeles Chargers", 1)).toMatch(/>12<\/td>$/);
    expect(cellFor(html, "Denver Broncos", 1)).toMatch(/>9<\/td>$/);
    expect(cellFor(html, "New York Giants", 1)).toMatch(/>1<\/td>$/);
    expect(html).not.toContain("No week has locked yet");
  });

  it("colours a count only with a stored final: green won, yellow lost, no fill otherwise, never red", () => {
    const html = render(NOW);
    expect(cellFor(html, "Philadelphia Eagles", 1)).toContain(TONE_FILL_CLASS.won);
    expect(cellFor(html, "Dallas Cowboys", 1)).toContain(TONE_FILL_CLASS.lost);
    for (const name of ["Los Angeles Chargers", "Denver Broncos", "New York Giants"]) {
      const c = cellFor(html, name, 1);
      expect(c, `${name} is not final and must carry no fill`).not.toContain(TONE_FILL_CLASS.won);
      expect(c, `${name} is not final and must carry no fill`).not.toContain(TONE_FILL_CLASS.lost);
      expect(c).toContain("not final");
    }
    expect(html).not.toMatch(/\bbg-loss\b/);
    void cell;
  });

  it("sums the week's column in the total row, and names the scope showing rather than 'the pool'", () => {
    const html = render(NOW);
    expect(html).toMatch(/title="Week 1: 65 picks, Everyone"[^>]*>65<\/td>/);
    expect(html).toMatch(/title="Week 2: not locked yet"[^>]*><\/td>/);
    expect(html).toContain("total for Everyone.");
    // Under Our group the same 121-based totals used to be captioned "across
    // the pool" (2026-09-15): the caption and the footer title take the
    // scope's exact word.
    const ours = renderToStaticMarkup(
      React.createElement(TeamsClient, { counts: COUNTS, weeks: WEEKS, games: GAMES, entryCount: 121, scopeLabel: "Our group", now: NOW }),
    );
    expect(ours).toMatch(/title="Week 1: 65 picks, Our group"/);
    expect(ours).toContain("total for Our group.");
    expect(ours).not.toContain("across the pool");
  });
});
