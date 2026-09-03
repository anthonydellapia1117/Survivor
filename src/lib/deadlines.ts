// Which deadline governs one pick, by the day its team plays.
//
//   Wednesday game   -> Tuesday   12:00 PM ET   (early - 1 day)
//   Thursday game    -> Wednesday 12:00 PM ET   (early)
//   Friday game      -> Thursday  12:00 PM ET   (early + 1 day)
//   Sat / Sun / Mon  -> Friday    12:00 PM ET   (late)
//
// This mirrors the pick_deadline() SQL function exactly; the database is the
// enforcing side and this is what the screens display. Keep the two together.
// It applies to every week including Week 1 — there is no Week 1 special case.

import type { GameDay, GameRow } from "./data/types";

/** The tier a game day falls in. `late` is the Sat-Mon window. */
export type DeadlineTier = "wed" | "thu" | "fri" | "late";

export function deadlineTier(day: GameDay | null | undefined): DeadlineTier {
  switch (day) {
    case "Wednesday":
      return "wed";
    case "Thursday":
      return "thu";
    case "Friday":
      return "fri";
    default:
      // Saturday, Sunday, Monday — and a bye or unknown team, which takes the
      // week's final boundary, same as the SQL side.
      return "late";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The deadline for a pick on `day`, given the week's two stored boundaries.
 * The three early tiers sit one day apart, so they derive from the early
 * deadline rather than needing columns of their own — exactly as the SQL does.
 */
export function pickDeadlineIso(
  day: GameDay | null | undefined,
  earlyDeadlineAt: string,
  lateDeadlineAt: string,
): string {
  const tier = deadlineTier(day);
  if (tier === "late") return lateDeadlineAt;
  // Thursday IS the stored early boundary, so hand back exactly what was
  // given rather than round-tripping it through Date — otherwise the string
  // format would depend on the tier, which callers compare on.
  if (tier === "thu") return earlyDeadlineAt;
  const early = new Date(earlyDeadlineAt).getTime();
  return new Date(early + (tier === "wed" ? -DAY_MS : DAY_MS)).toISOString();
}

/** Short label for the tier, for column headers and legends. */
export const TIER_LABEL: Record<DeadlineTier, string> = {
  wed: "Tuesday",
  thu: "Wednesday",
  fri: "Thursday",
  late: "Friday",
};

/**
 * Deadline per team for one week, keyed by abbreviation.
 *
 * A screen that only knows the week's boundaries can tell you which tier
 * closes next, but not whether the team someone just chose is already past
 * its own. Those are different questions: in Week 1, Seattle is late from
 * Tuesday noon while Los Angeles is still open until Wednesday.
 */
export function teamDeadlines(
  weekGames: Pick<GameRow, "dayOfWeek" | "homeTeam" | "awayTeam">[],
  earlyDeadlineAt: string,
  lateDeadlineAt: string,
): Map<string, string> {
  const byTeam = new Map<string, string>();
  for (const g of weekGames) {
    const at = pickDeadlineIso(g.dayOfWeek, earlyDeadlineAt, lateDeadlineAt);
    byTeam.set(g.homeTeam, at);
    byTeam.set(g.awayTeam, at);
  }
  return byTeam;
}
