// The one sentence in the message: Lynne's three buckets and how many are
// left, in the dashboard's exact words. src/app/page.tsx builds the same
// sentence for the site. tests/unit/distribute-message.test.ts reads that
// file from disk and checks the template here still matches it, so the two
// cannot drift without a red test.
//
// Counts only. No entry names, no money, no recruited-or-free split: this
// text goes to every player.

import { lynneBucket } from "@/lib/lynne/names";

export interface StandingInput {
  status: string;
  losses: number;
  byeUsed: boolean;
}

export interface StandingsCounts {
  noLosses: number;
  lossBye: number;
  out: number;
  /** Everything not eliminated: the "left in the pool" number. */
  alive: number;
}

/** Bucket each live entry the way the dashboard does, and count. */
export function countStandings(rows: StandingInput[]): StandingsCounts {
  const c: StandingsCounts = { noLosses: 0, lossBye: 0, out: 0, alive: 0 };
  for (const r of rows) {
    const bucket = lynneBucket(r);
    if (bucket === "No Losses") c.noLosses += 1;
    else if (bucket === "Loss/Bye") c.lossBye += 1;
    else c.out += 1;
    if (r.status !== "eliminated") c.alive += 1;
  }
  return c;
}

/** The dashboard's sentence, character for character. */
export function standingsSentence(c: StandingsCounts): string {
  return `No Losses=${c.noLosses}, 1 Loss/Bye used=${c.lossBye} and Out=${c.out}. We are down to ${c.alive} left in the pool.`;
}
