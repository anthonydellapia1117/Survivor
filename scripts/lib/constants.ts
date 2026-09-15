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
 * (expectedRosterAddresses), set by Anthony on 2026-09-09 at 39, moved to 40
 * on 2026-09-10 when Alexa became the player on AAA #3, #6 and #9 (her
 * address is a player_email like any other, so the derived set carries it),
 * and to 41 on 2026-09-12 when an owner split put Rob & Alanna #2 under its
 * own owner: both owners keep a live entry, so the set grew by one.
 * A derived count that is not this number stops the run before any draft or
 * send; a range would let a wrong count through, which is what happened once
 * in another pool. Changing it is a reviewed change to the config, never a
 * flag - and the change is only ever made to MATCH a roster that moved, never
 * to make a failing run pass.
 */
export const EXPECTED_ROSTER_ADDRESSES = loadOpsConfig().expectedRosterAddresses;

/**
 * THE STAGING CEILING, SPLIT BY CLASS. Set by Anthony on 2026-09-15, before
 * the Wednesday 2 PM deadline, with 43 people holding the Week 2 email: "The
 * 25-row ceiling: 43 people replying could plausibly stage more than 25
 * legitimate pick rows in one run. If a genuine batch can trip it, raise it
 * for pick rows only and keep it low for unparsed noise."
 *
 * The one number this replaced (MAX_STAGED_PER_RUN = 25, set 2026-09-10 after
 * the 1,951-row flood) counted every staged row whatever its sender, and when
 * it tripped the whole run stopped - the clean picks in the same run were not
 * written either, no message was filed, and the next hourly run tripped the
 * same way until a person intervened. A newsletter flood on a Wednesday would
 * have held 43 people's picks.
 *
 * NOISE is every row of kind `identity`: a sender that resolves to no live
 * entry - a stranger on the subject rule, a declined owner, a bounce. When it
 * trips, those rows are left unstaged and unfiled and reported by sender (the
 * same mail is still there to sweep once the filter is right), and the roster
 * rows and the clean picks in the same run STILL GO THROUGH. That is the one
 * departure from the 2026-09-10 "it stops, it never trims" rule, for this
 * class only, on his instruction.
 *
 * ROSTER is every row from a placed sender: kinds `pick` and
 * `player_question`. The limit is the roster size, 121: more than one row per
 * live entry in one run is not a batch of picks, it is a reader defect. When
 * it trips the whole run stops exactly as before - nothing written, nothing
 * staged, nothing filed, NEEDS ANTHONY.
 *
 * RAISING EITHER IS NEVER THE FIX. Over the noise limit the filter is wrong;
 * over the roster limit the parser is.
 */
export const MAX_NOISE_ROWS_PER_RUN = 25;
export const MAX_ROSTER_ROWS_PER_RUN = 121;

/**
 * The Gmail label the sweep files a processed message under, and since
 * 2026-09-15 the ONLY thing it keys "already processed" on. Set by Anthony
 * that morning: a message he read on his phone before the sweep ran was never
 * swept, because both readers asked Gmail for `is:unread`. They now ask for
 * everything in the window that does not carry this label, and a run that
 * cannot resolve or create the label stops before reading anything - a run
 * that could not mark a message processed would re-stage the same mail every
 * hour forever. `npm run picks:self` files under the same label.
 */
export const DONE_LABEL = "Pool-Survivor-Done";

/**
 * How far back either sweep reads. Unread mail older than this is not a pick
 * for the week in play; the first credentialed run read five months of it,
 * and an unread Axios newsletter from 27 April became a staged question
 * because the address path has no subject filter to save it.
 */
export const SWEEP_WINDOW_DAYS = 14;
