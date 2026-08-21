import type { EntryStatus, PickResult } from "@/lib/data/types";

/** Sort order for standings displays: alive first, eliminated last. */
export const STATUS_ORDER: Record<EntryStatus, number> = {
  bye_eligible: 0,
  active: 1,
  at_risk: 2,
  eliminated: 3,
};

export const STATUS_LABEL: Record<EntryStatus, string> = {
  active: "Active",
  at_risk: "At risk",
  bye_eligible: "Bye eligible",
  eliminated: "Eliminated",
};

/** Dot / badge color classes per status. */
export const STATUS_DOT: Record<EntryStatus, string> = {
  active: "bg-win",
  at_risk: "bg-tie",
  bye_eligible: "bg-primary",
  eliminated: "bg-loss",
};

export const RESULT_LABEL: Record<PickResult, string> = {
  win: "Win",
  loss: "Loss",
  tie_loss: "Tie (loss)",
  bye: "Bye",
  pending: "Pending",
  missed: "Missed",
};

export function isAlive(status: EntryStatus): boolean {
  return status !== "eliminated";
}

export interface NflTeam {
  abbr: string;
  name: string;
}

export const NFL_TEAMS: NflTeam[] = [
  { abbr: "ARI", name: "Arizona Cardinals" },
  { abbr: "ATL", name: "Atlanta Falcons" },
  { abbr: "BAL", name: "Baltimore Ravens" },
  { abbr: "BUF", name: "Buffalo Bills" },
  { abbr: "CAR", name: "Carolina Panthers" },
  { abbr: "CHI", name: "Chicago Bears" },
  { abbr: "CIN", name: "Cincinnati Bengals" },
  { abbr: "CLE", name: "Cleveland Browns" },
  { abbr: "DAL", name: "Dallas Cowboys" },
  { abbr: "DEN", name: "Denver Broncos" },
  { abbr: "DET", name: "Detroit Lions" },
  { abbr: "GB", name: "Green Bay Packers" },
  { abbr: "HOU", name: "Houston Texans" },
  { abbr: "IND", name: "Indianapolis Colts" },
  { abbr: "JAX", name: "Jacksonville Jaguars" },
  { abbr: "KC", name: "Kansas City Chiefs" },
  { abbr: "LAC", name: "Los Angeles Chargers" },
  { abbr: "LAR", name: "Los Angeles Rams" },
  { abbr: "LV", name: "Las Vegas Raiders" },
  { abbr: "MIA", name: "Miami Dolphins" },
  { abbr: "MIN", name: "Minnesota Vikings" },
  { abbr: "NE", name: "New England Patriots" },
  { abbr: "NO", name: "New Orleans Saints" },
  { abbr: "NYG", name: "New York Giants" },
  { abbr: "NYJ", name: "New York Jets" },
  { abbr: "PHI", name: "Philadelphia Eagles" },
  { abbr: "PIT", name: "Pittsburgh Steelers" },
  { abbr: "SEA", name: "Seattle Seahawks" },
  { abbr: "SF", name: "San Francisco 49ers" },
  { abbr: "TB", name: "Tampa Bay Buccaneers" },
  { abbr: "TEN", name: "Tennessee Titans" },
  { abbr: "WAS", name: "Washington Commanders" },
];

export const TEAM_NAME: Record<string, string> = Object.fromEntries(
  NFL_TEAMS.map((t) => [t.abbr, t.name]),
);

export const SKIP_WEEK = "SKIP_WEEK";
