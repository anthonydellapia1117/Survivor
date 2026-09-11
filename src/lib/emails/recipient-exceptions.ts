// Two standing exceptions to how a message is addressed. Set by Anthony on
// 2026-09-11, both permanent.
//
// Everywhere else the rule is one person, one mailbox, one message
// (recipients.ts), and an entry goes to its player_email when set and to its
// owner otherwise, NEVER BOTH (the gifted-entry rule in CLAUDE.md). These two
// are the named departures from that, and they are checked in for the same
// reason RETIRED_ADDRESSES is: a fact about the world that a run must not be
// able to talk itself out of, reviewable as a diff rather than discovered in a
// database row nobody reads.
//
// Neither of these is a bug to be tidied up later. A future reader who finds
// three addresses on one owner, or an owner CC'd on a giftee's message, is
// looking at a decision, and the reason is written beside it.

import { normalizeAddress } from "./address";

/**
 * The key two addresses are compared on here: trimmed AND lower-cased.
 *
 * normalizeAddress only trims - deliberately, because "blank" is decided with
 * trim() everywhere and case-insensitivity lives in sameAddress. Keying a
 * lookup on it alone is a silent miss: a roster row holding
 * `MarioHockey97@Yahoo.com` would get ONE copy instead of three, and nothing
 * would say so. Same rule as sameAddress, applied to a map key.
 */
function key(address: string): string {
  return normalizeAddress(address).toLowerCase();
}

// ---------------------------------------------------- one person, several mailboxes

export interface MultiAddressPerson {
  /** The address on the owner row - the key this person is bucketed under. */
  primary: string;
  /**
   * EVERY address this ONE PERSON is reachable at, the primary included.
   * They are copies of one message, not separate recipients.
   */
  addresses: readonly string[];
  since: string;
  reason: string;
}

/**
 * ONE PERSON, SEVERAL COPIES - never several recipients.
 *
 * This matters to the count gate and is the whole reason the distinction is
 * written down. The gate on a whole-roster send counts PEOPLE, so a person
 * with three mailboxes moves the delivered address count and not the gate.
 * Counting addresses instead would have made every extra mailbox a reviewed
 * change to EXPECTED_ROSTER_ADDRESSES, which would then no longer mean "how
 * many people are on this roster" - and that number is the one thing standing
 * between a derived list and a wrong send.
 */
export const MULTI_ADDRESS_PEOPLE: readonly MultiAddressPerson[] = [
  {
    primary: "mariohockey97@yahoo.com",
    addresses: [
      "mariohockey97@yahoo.com",
      "mariohockey97@gmail.com",
      "mariospectrum3@gmail.com",
    ],
    since: "2026-09-11",
    reason:
      "Mario Tropea III, owner d82708ef, entries 1037-1040. The roster holds the yahoo address and it is the one verified against the 2026 kickoff and Last Call BCC lists, but on 2026-09-11 Anthony named two others and did not recognise the yahoo one. He is UNSURE WHICH IS LIVE, so all three are deliberate and none is replaced: guessing would silently drop a player whose only fault is that nobody wrote his address down twice. Every message for his entries goes to all three. When one of them REPLIES, that is which address is live, and this entry collapses to it - noted by the reply, never by anyone picking.",
  },
];

// -------------------------------------------------------------- copy an owner in

export interface CopyTo {
  /** The recipient whose message this applies to, by their own address. */
  recipient: string;
  /** Addresses added on CC - people who see the message, not extra copies of it. */
  cc: readonly string[];
  since: string;
  reason: string;
}

/**
 * A NAMED EXCEPTION TO NEVER-BOTH, not a routing bug.
 *
 * The gifted-entry rule sends an entry to its player_email OR its owner and
 * never to both, because a buyer who is asked to pick for an entry he gave
 * away can answer with no authority over it. This carves out one case where
 * the owner is deliberately shown the message anyway - on CC, where he can
 * read it and is plainly not the person being asked.
 *
 * The owner still gets his OWN message for his OWN entries. What must never
 * happen is two separate emails covering the same entries, which is exactly
 * what adding the owner as a second recipient of the gifted entries would do.
 */
export const COPY_TO: readonly CopyTo[] = [
  {
    recipient: "jmvas731@msn.com",
    cc: ["ray@economydelivers.com"],
    since: "2026-09-11",
    reason:
      "Johnvas #1 and #2, entries 1069-1070. Ray Vassallo owns and pays for all four Vassallo entries; his brother John plays these two and owns their picks. Anthony wants Ray to see everything about the entries he pays for, so Ray is CC'd on John's message. Ray's own message for Rayvas #1-#2 (1067-1068) is unchanged and lists only those two - he must never receive a second email about 1069-1070.",
  },
];

// ------------------------------------------------------------------- lookups

const DELIVERY: ReadonlyMap<string, readonly string[]> = new Map(
  MULTI_ADDRESS_PEOPLE.map((p) => [key(p.primary), p.addresses.map(key)]),
);

const CC: ReadonlyMap<string, readonly string[]> = new Map(
  COPY_TO.map((c) => [key(c.recipient), c.cc.map(key)]),
);

/**
 * Every address ONE recipient's message is delivered to. The recipient's own
 * address for everybody, plus the other mailboxes of a multi-address person.
 * Always contains the address it was given, so a caller can use it unguarded.
 */
export function deliveryAddressesFor(address: string): string[] {
  const k = key(address);
  const extra = DELIVERY.get(k);
  return extra ? [...extra] : [k];
}

/** The addresses CC'd on one recipient's message, or none. */
export function ccFor(address: string): string[] {
  return [...(CC.get(key(address)) ?? [])];
}

/**
 * A list of RECIPIENTS (one address each) expanded to the addresses a send
 * actually delivers to, deduplicated and sorted.
 *
 * THE COUNT GATE RUNS ON WHAT GOES IN, NOT ON WHAT COMES OUT. A whole-roster
 * send gates the people list against EXPECTED_ROSTER_ADDRESSES first and
 * expands afterwards, so Mario's three mailboxes are one person to the gate
 * and three lines on the Bcc.
 */
export function expandDelivery(recipients: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of recipients) for (const a of deliveryAddressesFor(r)) out.add(a);
  return [...out].sort();
}

/** How many extra copies the expansion adds, for a run to print. */
export function extraCopies(recipients: readonly string[]): number {
  return expandDelivery(recipients).length - new Set(recipients.map(key)).size;
}
