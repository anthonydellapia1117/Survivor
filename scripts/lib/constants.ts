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

/**
 * The most pending rows one sweep may stage before it refuses to write
 * anything at all. Set by Anthony on 2026-09-10, after the first run with
 * credentials staged 1,951 rows from 65 messages in four minutes: a run over
 * this ceiling is reading the wrong mail, and half-applying it is worse than
 * not running it. The gate has the same shape as the roster count gate on a
 * send - it stops the run and prints, it does not trim to the limit.
 *
 * RAISING THIS IS NEVER THE FIX. If a legitimate week genuinely needs more
 * than this many questions answered, the filter is wrong or the roster moved,
 * and one of those is what changes.
 */
export const MAX_STAGED_PER_RUN = 25;

/**
 * How far back either sweep reads. Unread mail older than this is not a pick
 * for the week in play; the first credentialed run read five months of it,
 * and an unread Axios newsletter from 27 April became a staged question
 * because the address path has no subject filter to save it.
 */
export const SWEEP_WINDOW_DAYS = 14;
