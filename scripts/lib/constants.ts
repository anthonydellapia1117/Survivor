import { loadOpsConfig } from "../ops/lib/config";

// Values every local command shares. One place, so the address Lynne is
// mailed at and the thread her lists go in cannot drift between commands.

export const LYNNE_EMAIL = "lynnepiazza10@gmail.com";
export const ENTRY_LIST_SUBJECT = "Survivor - DellaPia | 2026 Entry List";
/** The only public URL. Older Vercel names were released; never use them. */
export const SITE_URL = "https://ad-26-survivor.vercel.app";
/** The admin's mailbox: the sender of every draft and the To of a BCC send. */
export const ADMIN_MAILBOX = "anthonydellapia@gmail.com";
/**
 * The exact number of distinct addresses the live roster must derive for a
 * whole-roster message (the week reminder, the distribute draft): every
 * owner address and every player_email on a live entry, lowercased, once
 * each, Anthony's own included. Read from scripts/ops/config.json
 * (expectedRosterAddresses), set by Anthony on 2026-09-09 at 39 and moved to
 * 40 on 2026-09-10 when Alexa became the player on AAA #3, #6 and #9: her
 * address is a player_email like any other, so the derived set carries it.
 * A derived count that is not this number stops the run before any draft or
 * send; a range would let a wrong count through, which is what happened once
 * in another pool. Changing it is a reviewed change to the config, never a
 * flag - and the change is only ever made to MATCH a roster that moved, never
 * to make a failing run pass.
 */
export const EXPECTED_ROSTER_ADDRESSES = loadOpsConfig().expectedRosterAddresses;
