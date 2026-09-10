// The 32 primary logos, fetched once from ESPN's public teams endpoint on
// 2026-09-09 and committed under public/logos as 96px PNGs (2x the largest
// size they render at, so they stay crisp on a retina screen). Nothing here
// calls ESPN at runtime. ESPN's file stem is our team code, lower-cased, with
// one exception: our WAS is their WSH. The map is explicit so a mismatch is a
// test failure, not a broken image.

import { NFL_TEAMS } from "./standing";
import { espnTeam } from "./nfl/espn";

/**
 * Our code to ESPN's. The rename lives in ONE place - src/lib/nfl/espn.ts,
 * which the scoreboard reader uses too. It was written out here as well until
 * 2026-09-11, and a third time inside the admin scores prefill with two extra
 * codes the feed does not send; three statements of one fact is how they drift.
 */
export const ESPN_CODE: Record<string, string> = Object.fromEntries(
  NFL_TEAMS.map((t) => [t.abbr, espnTeam(t.abbr)]),
);

/** The local asset for a team, or null for a code that is not one of the 32. */
export function logoPath(abbr: string): string | null {
  const code = ESPN_CODE[abbr];
  return code ? `/logos/${code.toLowerCase()}.png` : null;
}
