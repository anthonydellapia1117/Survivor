import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));

import { GameBoard, type EliminationScopes } from "../../src/components/schedule/game-board";
import type { GameRow, WeekRow } from "../../src/lib/data/types";

// The game board's "N entries eliminated" line showed OUR group to every
// viewer with no toggle. Since 2026-09-15 it shows the whole pool - every
// row of her newest sheet, scored from the games - and our group only under
// the same Everyone / Our group toggle the one table uses. The two lists are
// computed on the server (eliminationsByWeek) and arrive as plain data, so
// this renders the board with the two scopes DISAGREEING and reads which one
// the default view counts.

const final: GameRow = {
  id: "g1",
  week: 1,
  kickoffAt: "2026-09-13T17:00:00Z",
  dayOfWeek: "Sunday",
  awayTeam: "DAL",
  homeTeam: "PHI",
  homeScore: 24,
  awayScore: 17,
  status: "final",
  revealOverride: null,
  network: "FOX",
};

const WEEKS: WeekRow[] = [
  { week: 1, earlyDeadlineAt: "2026-09-09T18:00:00Z", lateDeadlineAt: "2026-09-11T18:00:00Z" } as WeekRow,
];

const pool = { eliminated: { 1: { DAL: ["2 Loser Row", "9 Another Row"] } }, count: 4 };
const ours = { eliminated: { 1: { DAL: ["Adriana Flacco "] } }, count: 1 };

function render(eliminations: EliminationScopes): string {
  return renderToStaticMarkup(React.createElement(GameBoard, { games: [final], eliminations, weeks: WEEKS, initialWeek: 1 }));
}

describe("the game board's eliminated list", () => {
  it("opens on Everyone and counts the pool's rows, not ours", () => {
    const html = render({ pool, ours });
    expect(html).toMatch(/aria-checked="true"[^>]*>Everyone<span[^>]*>4</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Our group<span[^>]*>1</);
    expect(html).toContain("2 entries eliminated");
    expect(html).not.toContain("1 entry eliminated");
    expect(html).toContain("across every row of her newest sheet");
  });

  it("falls back to our group, with Everyone disabled, when no sheet is loaded", () => {
    const html = render({ pool: null, ours });
    expect(html).toMatch(/aria-checked="true"[^>]*>Our group<span[^>]*>1</);
    expect(html).toMatch(/disabled=""[^>]*>Everyone</);
    expect(html).toContain("1 entry eliminated");
    expect(html).toContain("Our group only");
  });
});
