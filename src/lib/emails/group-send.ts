// Who is on a group send.
//
// Owner addresses, deduplicated, in roster order. This file is the only place
// that decides who is on the list.
//
// It briefly also carried owners.cc_email, when a second contact was a
// property of the OWNER. That column is retired: a person who plays entries
// somebody else bought is now recorded on the ENTRY (entries.player_email),
// which is what let two giftees on one owner work at all. Group announcements
// are a separate question from pick requests, and are deliberately still
// owner-addressed — see the note in recipients.ts about who has standing on
// what.

import { normalizeAddress } from "./address";

export interface GroupSendOwner {
  id: string;
  name: string;
  email: string | null;
}

export interface GroupSendList {
  /** Deduplicated, in roster order: each owner's address then their CC. */
  addresses: string[];
  /** Owners with no address of their own — they miss every group send. */
  missingEmail: GroupSendOwner[];
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
 * Every address that should receive a group send, owners and CC contacts
 * alike, deduplicated case-insensitively.
 *
 * A CC contact is included even when the owner has no address of their own.
 * That differs from a pick request on purpose: a pick request asks ONE person
 * for their picks and must reach the owner, so a CC is never a stand-in
 * there. A group send is an announcement — the CC contact is a real person on
 * the roster and dropping them is the failure this function exists to stop.
 */
export function groupSendList(owners: GroupSendOwner[]): GroupSendList {
  const addresses: string[] = [];
  const missingEmail: GroupSendOwner[] = [];
  const duplicates: GroupSendList["duplicates"] = [];
  // Keyed on the lowercased address, because that is what "the same mailbox"
  // means here — and duplicates is keyed the same way, so one mailbox cannot
  // be reported as two.
  const seen = new Set<string>();
  const flagged = new Set<string>();

  const add = (owner: GroupSendOwner, address: string) => {
    const key = address.toLowerCase();
    if (seen.has(key)) {
      if (!flagged.has(key)) {
        flagged.add(key);
        duplicates.push({ ownerId: owner.id, ownerName: owner.name, address });
      }
      return;
    }
    seen.add(key);
    addresses.push(address);
  };

  for (const o of owners) {
    const email = normalizeAddress(o.email);
    if (email === "") missingEmail.push(o);
    else add(o, email);
  }

  return { addresses, missingEmail, duplicates };
}
