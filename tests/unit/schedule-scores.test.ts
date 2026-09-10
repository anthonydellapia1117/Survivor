import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));

import { GameBoard } from "../../src/components/schedule/game-board";
import type { GameRow, GridCell, EntrySummary, WeekRow } from "../../src/lib/data/types";

// The schedule page shows a final's two scores and marks the winner, and shows
// NEITHER on a game with no stored result. That second half is the guard: a
// colour on a game nobody has played is a claim about a result that does not
// exist, and before 2026-09-11 nothing in this repo had ever rendered a final
// because every nfl_games row was `scheduled` with null scores.

const game = (over: Partial<GameRow>): GameRow => ({
  id: over.id ?? "g1",
  week: 1,
  kickoffAt: "2026-09-10T00:20:00Z",
  dayOfWeek: "Wednesday",
  awayTeam: "NE",
  homeTeam: "SEA",
  homeScore: null,
  awayScore: null,
  status: "scheduled",
  revealOverride: null,
  network: null,
  ...over,
});

const WEEKS: WeekRow[] = [
  { week: 1, earlyDeadlineAt: "2026-09-09T18:00:00Z", lateDeadlineAt: "2026-09-11T18:00:00Z" } as WeekRow,
];

function render(games: GameRow[]): string {
  return renderToStaticMarkup(
    React.createElement(GameBoard, {
      games,
      entries: [] as EntrySummary[],
      cells: [] as GridCell[],
      weeks: WEEKS,
      initialWeek: 1,
    }),
  );
}

/** Result colours, as classes. The window vocabulary is checked elsewhere. */
const RESULT_CLASSES = /\b(?:bg|text|border)-(?:win|loss|tie)(?:\/\d+)?\b/g;

/**
 * How many SCORE elements the card rendered. The score is the only
 * `tabular-nums` in a game card, and counting elements is the only honest
 * check: an empty span reads the same as no span in the text.
 */
function scoreSpans(html: string): number {
  // `text-lg tabular-nums` is the score span and only the score span; the
  // week buttons above the cards are the card page's other tabular-nums.
  return (html.match(/text-lg tabular-nums/g) ?? []).length;
}

describe("a game with no stored result", () => {
  const html = render([game({})]);

  it("carries no result colour at all", () => {
    expect(html.match(RESULT_CLASSES) ?? []).toEqual([]);
  });

  it("shows no score and no winner mark", () => {
    expect(html).not.toContain("WON");
    expect(html).toContain("Seahawks"); // the card renders the team NAME, not the code
    // Count the SCORE SPANS, not the text in them. Asserting "no >null<" and
    // "no >0<" looked like a guard and was not: React renders {null} as an
    // EMPTY span, so making the card show a score on every game passed it.
    // A scheduled game must render no score element at all.
    expect(scoreSpans(html)).toBe(0);
  });
});

describe("a game in progress", () => {
  const html = render([game({ status: "in_progress", homeScore: 7, awayScore: 3 })]);

  it("is marked live, shows no score yet and claims no winner", () => {
    expect(html).toContain("LIVE");
    // in_progress is not final, so the card shows no score element either.
    expect(scoreSpans(html)).toBe(0);
    expect(html).not.toContain("WON");
    // No win/loss colour: nobody has won yet.
    expect(html.match(/\b(?:bg|text|border)-(?:win|loss)(?:\/\d+)?\b/g) ?? []).toEqual([]);
  });
});

describe("a final", () => {
  const html = render([game({ status: "final", homeScore: 13, awayScore: 10 })]);

  it("shows both scores, in two score elements", () => {
    expect(html).toContain(">13<");
    expect(html).toContain(">10<");
    expect(scoreSpans(html)).toBe(2);
  });

  it("marks the winner and its score, and only the winner", () => {
    expect(html).toContain("WON");
    expect((html.match(/WON/g) ?? []).length).toBe(1);
    expect(html).toMatch(/border-win/);
    expect(html).toMatch(/text-win/);
  });

  it("does not tint it as a broadcast window - that is the season grid's job", () => {
    expect(html.match(/\b(?:bg|text|border)-(?:tnf|snf|mnf|wfs)(?:\/\d+)?\b/g) ?? []).toEqual([]);
  });
});

describe("a tie", () => {
  const html = render([game({ status: "final", homeScore: 20, awayScore: 20 })]);

  it("is called a loss in words, not just coloured", () => {
    expect(html).toContain("TIE - a loss in this pool");
    expect(html).not.toContain("WON");
  });

  it("shows both scores and marks neither side the winner", () => {
    expect((html.match(/>20</g) ?? []).length).toBe(2);
    expect(scoreSpans(html)).toBe(2);
    expect(html).not.toMatch(/border-win/);
  });
});
