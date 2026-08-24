// Lynne's team vocabulary, extracted verbatim from her final 2025 sheet.
// She writes city/region names — "San Francisco", "LA Rams", "LV Raiders" —
// and submissions to her must use exactly these strings.

export const LYNNE_TEAM_NAME: Record<string, string> = {
  ARI: "Arizona",
  ATL: "Atlanta",
  BAL: "Baltimore",
  BUF: "Buffalo",
  CAR: "Carolina",
  CHI: "Chicago",
  CIN: "Cincinnati",
  CLE: "Cleveland",
  DAL: "Dallas",
  DEN: "Denver",
  DET: "Detroit",
  GB: "Green Bay",
  HOU: "Houston",
  IND: "Indianapolis",
  JAX: "Jacksonville",
  KC: "Kansas City",
  LAC: "LA Chargers",
  LAR: "LA Rams",
  LV: "LV Raiders",
  MIA: "Miami",
  MIN: "Minnesota",
  NE: "New England",
  NO: "New Orleans",
  NYG: "NY Giants",
  NYJ: "NY Jets",
  PHI: "Philadelphia",
  PIT: "Pittsburgh",
  SEA: "Seattle",
  SF: "San Francisco",
  TB: "Tampa Bay",
  TEN: "Tennessee",
  WAS: "Washington",
};

const REVERSE = new Map(
  Object.entries(LYNNE_TEAM_NAME).map(([abbr, name]) => [
    name.toLowerCase(),
    abbr,
  ]),
);

/** Her name -> app abbreviation, case-insensitive. Null when unrecognized. */
export function fromLynneTeamName(name: string): string | null {
  return REVERSE.get(name.trim().toLowerCase()) ?? null;
}

/**
 * Her standings buckets, verbatim. Alive entries with zero losses and no
 * bye used are "No Losses"; alive with a loss or a bye burned are
 * "Loss/Bye"; eliminated is "Out".
 */
export type LynneBucket = "No Losses" | "Loss/Bye" | "Out";

export function lynneBucket(e: {
  status: string;
  losses: number;
  byeUsed: boolean;
}): LynneBucket {
  if (e.status === "eliminated") return "Out";
  return e.losses === 0 && !e.byeUsed ? "No Losses" : "Loss/Bye";
}
