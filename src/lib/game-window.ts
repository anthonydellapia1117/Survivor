// Which broadcast window a game sits in, for the season grid's colours. Set
// by Anthony on 2026-09-09 and counted against the live nfl_games table for
// 2026: TNF 19, SNF 17, MNF 17, Wed/Fri/Sat 8, the other 211 Sunday daytime
// games uncoloured, 272 in all. tests/unit/game-window.test.ts asserts those
// counts against the checked-in schedule seed.

import type { GameRow } from "@/lib/data/types";

export type GameWindow = "tnf" | "snf" | "mnf" | "wfs";

const ET_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });

/** The kickoff hour on the ET clock, 0-23, DST-aware. */
export function etHour(iso: string): number {
  const h = Number(ET_HOUR.format(new Date(iso)));
  return h === 24 ? 0 : h;
}

/** SNF is a Sunday game kicking off at or after 7:00 PM ET. */
export function gameWindow(g: Pick<GameRow, "dayOfWeek" | "kickoffAt">): GameWindow | null {
  switch (g.dayOfWeek) {
    case "Thursday":
      return "tnf";
    case "Monday":
      return "mnf";
    case "Wednesday":
    case "Friday":
    case "Saturday":
      return "wfs";
    case "Sunday":
      return etHour(g.kickoffAt) >= 19 ? "snf" : null;
    default:
      return null;
  }
}

export const WINDOW_ORDER: GameWindow[] = ["tnf", "snf", "mnf", "wfs"];

export const WINDOW_LABEL: Record<GameWindow, string> = {
  tnf: "TNF",
  snf: "SNF",
  mnf: "MNF",
  wfs: "Wed/Fri/Sat",
};

/** The design token each window fills with; TNF keeps the amber the grid already used. */
export const WINDOW_TOKEN: Record<GameWindow, "tie" | "snf" | "mnf" | "wfs"> = {
  tnf: "tie",
  snf: "snf",
  mnf: "mnf",
  wfs: "wfs",
};

/** Cell fill and tag text classes per window. Written out in full so Tailwind sees every class. */
export const WINDOW_CELL_CLASS: Record<GameWindow, string> = {
  tnf: "bg-tie/25",
  snf: "bg-snf/25",
  mnf: "bg-mnf/25",
  wfs: "bg-wfs/25",
};
export const WINDOW_TEXT_CLASS: Record<GameWindow, string> = {
  tnf: "text-tie",
  snf: "text-snf",
  mnf: "text-mnf",
  wfs: "text-wfs",
};
