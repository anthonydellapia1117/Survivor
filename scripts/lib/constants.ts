// Values every local command shares. One place, so the address Lynne is
// mailed at and the thread her lists go in cannot drift between commands.

export const LYNNE_EMAIL = "lynnepiazza10@gmail.com";
export const ENTRY_LIST_SUBJECT = "Survivor - DellaPia | 2026 Entry List";
/** The only public URL. Older Vercel names were released; never use them. */
export const SITE_URL = "https://ad-26-survivor.vercel.app";
/** The admin's mailbox: the sender of every draft and the To of a BCC send. */
export const ADMIN_MAILBOX = "anthonydellapia@gmail.com";
/**
 * The week reminder's count gate: how many distinct addresses the live
 * roster must derive, exactly. Set by Anthony on 2026-09-09 at 39 (every
 * owner address and every player_email on a live entry, lowercased, once
 * each, his own included). A derived count that is not this number stops the
 * run before any draft or send; a range would let a wrong count through,
 * which is what happened once in another pool. Changing it is a reviewed
 * change here, never a flag.
 */
export const WEEK_REMINDER_EXPECTED_RECIPIENTS = 39;
