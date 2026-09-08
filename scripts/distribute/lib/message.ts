// The message itself. One subject, one body, nothing per owner: it goes to
// the whole group as a BCC, so it carries no entry names, no money and no
// recruited-or-free split (CLAUDE.md, "Public surfaces"). The only link is
// the one public URL.

import { SITE_URL } from "../../lib/constants";
import { standingsSentence, type StandingsCounts } from "./standings";

export interface DistributeMessage {
  subject: string;
  body: string;
}

export const GRID_URL = `${SITE_URL}/grid`;

export function distributeMessage(week: number, counts: StandingsCounts): DistributeMessage {
  return {
    subject: `Survivor - Week ${week} picks posted`,
    // The grid reveals each pick at its game's kickoff, not at the lock, so
    // the line promises what the link shows: locked now, posted per game.
    body: [
      `Week ${week} picks are locked. Each one posts on the grid as its game kicks off: ${GRID_URL}`,
      "",
      standingsSentence(counts),
      "",
      "AD",
      "",
    ].join("\n"),
  };
}
