// Who is on a group send.
//
// Owner addresses plus the people who PLAY entries those owners bought,
// deduplicated, in roster order. This file is the only place that decides who
// is on the list.
//
// The second-contact address used to come from owners.cc_email. That column is
// retired and the source is now entries.player_email — the same people, read
// off the entry that records the arrangement rather than off the owner, which
// is what lets one owner have two different giftees. The BEHAVIOUR is
// deliberately unchanged: dropping a giftee from the announcement list is the
// exact failure this function exists to stop. "If I send a batch and the CC
// contacts are missing, Chas does not get his email and I would not know."

import { normalizeAddress, sameAddress } from "./address";

export interface GroupSendOwner {
  id: string;
  name: string;
  email: string | null;
  /**
   * Addresses of people who play THIS owner's entries — entries.player_email
   * off their live entries. Repeats are fine; one giftee with two entries is
   * one address on the list.
   */
  players?: string[];
}

export interface GroupSendOptions {
  /**
   * Include the people who play an owner's entries. On for the announcement
   * view, off for the money filters and for Missing email — a giftee is on the
   * roster to hear announcements, not to be BCC'd on a note about the balance
   * of the owner who pays for their entries, and "who can I not reach" is a
   * diagnostic that should not hand back a live address list of other people.
   */
  includeGiftedPlayers?: boolean;
}

export interface GroupSendList {
  /** Deduplicated, in roster order: each owner's address then their players'. */
  addresses: string[];
  /** Owners with no address of their own — they miss every group send. */
  missingEmail: GroupSendOwner[];
  /**
   * The player addresses that made it onto the list, each named with the owner
   * whose entries they play. The screen renders its "+ address" annotations
   * from THIS, never from the raw row: reading the row directly would claim a
   * second contact for an address the list deliberately left off — a
   * whitespace value, a self-address, or a duplicate — which the BCC string
   * and the count both deny.
   */
  giftedPlayers: { ownerId: string; ownerName: string; address: string }[];
  /**
   * Addresses that appear on more than one ROW and were emitted once, each
   * named with the row that repeated it. Worth showing rather than silently
   * collapsing: two owners sharing an address is usually an intake mistake,
   * and the thing needed to fix it is which rows collide — so record that,
   * not just the string.
   */
  duplicates: { ownerId: string; ownerName: string; address: string }[];
}

/**
 * Every address that should receive a group send, owners and the people who
 * play their entries alike, deduplicated case-insensitively.
 *
 * A player is included even when the owner has no address of their own. That
 * differs from a pick request on purpose: a pick request asks ONE person for
 * their picks, so a giftee is never a stand-in for the owner there. A group
 * send is an announcement, and the giftee is a real person on the roster.
 */
export function groupSendList(
  owners: GroupSendOwner[],
  { includeGiftedPlayers = false }: GroupSendOptions = {},
): GroupSendList {
  const addresses: string[] = [];
  const missingEmail: GroupSendOwner[] = [];
  const giftedPlayers: GroupSendList["giftedPlayers"] = [];
  const duplicates: GroupSendList["duplicates"] = [];
  // Keyed on the lowercased address, because that is what "the same mailbox"
  // means here — and duplicates is keyed the same way, so one mailbox cannot
  // be reported as two.
  const seen = new Set<string>();
  const flagged = new Set<string>();

  /** True when the address was actually emitted, false when deduplicated. */
  const add = (owner: GroupSendOwner, address: string): boolean => {
    const key = address.toLowerCase();
    if (seen.has(key)) {
      if (!flagged.has(key)) {
        flagged.add(key);
        duplicates.push({ ownerId: owner.id, ownerName: owner.name, address });
      }
      return false;
    }
    seen.add(key);
    addresses.push(address);
    return true;
  };

  for (const o of owners) {
    const email = normalizeAddress(o.email);
    if (email === "") missingEmail.push(o);
    else add(o, email);

    if (!includeGiftedPlayers) continue;
    // One giftee playing two of this owner's entries arrives twice, which is
    // not a collision -- `duplicates` means the same mailbox on more than one
    // ROW, which is an intake mistake worth showing. Collapsing the repeat
    // here keeps it out of that list; without this, Kris's row reported a
    // duplicate against itself purely because Chas plays two of his entries.
    const seenHere = new Set<string>();
    for (const raw of o.players ?? []) {
      const player = normalizeAddress(raw);
      if (player !== "" && seenHere.has(player.toLowerCase())) continue;
      if (player !== "") seenHere.add(player.toLowerCase());
      // A gift back to the buyer's own address is one person, not two. Same
      // rule recipientsForPicks applies, from the same helper, so the two
      // cannot disagree about whether a row is a second contact.
      if (player === "" || sameAddress(player, o.email)) continue;
      if (add(o, player)) {
        giftedPlayers.push({
          ownerId: o.id,
          ownerName: o.name,
          address: player,
        });
      }
    }
  }

  return { addresses, missingEmail, giftedPlayers, duplicates };
}
