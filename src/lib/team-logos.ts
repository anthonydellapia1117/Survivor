// The 32 primary logos, fetched once from ESPN's public teams endpoint on
// 2026-09-09 and committed under public/logos as 96px PNGs (2x the largest
// size they render at, so they stay crisp on a retina screen). Nothing here
// calls ESPN at runtime. ESPN's file stem is our team code, lower-cased, with
// one exception: our WAS is their WSH. The map is explicit so a mismatch is a
// test failure, not a broken image.

import { NFL_TEAMS } from "./standing";

/** Our code to ESPN's, for the one that differs. Every other code is itself. */
const ESPN_OVERRIDES: Record<string, string> = { WAS: "WSH" };

export const ESPN_CODE: Record<string, string> = Object.fromEntries(
  NFL_TEAMS.map((t) => [t.abbr, ESPN_OVERRIDES[t.abbr] ?? t.abbr]),
);

/** The local asset for a team, or null for a code that is not one of the 32. */
export function logoPath(abbr: string): string | null {
  const code = ESPN_CODE[abbr];
  return code ? `/logos/${code.toLowerCase()}.png` : null;
}
