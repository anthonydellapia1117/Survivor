// The message itself. One subject, one body, nothing per owner: it goes to
// the whole group as a BCC, so it carries no entry names, no money and no
// recruited-or-free split (CLAUDE.md, "Public surfaces").
//
// THE ONE LINK (Anthony, 2026-09-11): the anchor "AD-26-Survivor" on the
// site's root. It used to be a bare https://.../grid, which was a second
// destination and an address in front of the reader; both are now out. The
// plain part names the site, the HTML part makes that word clickable, and
// they are the two parts of one message.

import { htmlBodyOf, SITE_LINK_TEXT } from "../../lib/site-link";
import { standingsSentence, type StandingsCounts } from "./standings";

export interface DistributeMessage {
  subject: string;
  body: string;
  /** The same words with the site's name as the one anchor. */
  html: string;
}

export function distributeMessage(week: number, counts: StandingsCounts): DistributeMessage {
  // The grid reveals each pick at its game's kickoff, not at the lock, so
  // the line promises what the link shows: locked now, posted per game.
  const body = [
    `Week ${week} picks are locked. Each one posts as its game kicks off: ${SITE_LINK_TEXT}`,
    "",
    standingsSentence(counts),
    "",
    "AD",
    "",
  ].join("\n");
  return {
    subject: `Survivor - Week ${week} picks posted`,
    body,
    html: htmlBodyOf(body),
  };
}
