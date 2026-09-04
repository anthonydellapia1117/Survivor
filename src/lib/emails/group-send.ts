// Who is on a group send.
//
// /admin/emails calls itself "every owner email" and produces one BCC-ready
// string. Once an owner can carry a second contact, "every owner email" stops
// being the same set as "everyone who should get the mail": Chas Flaster is on
// the roster only as Kris Tomasco's cc_email, and the whole premise of that
// column is that he sees the same messages. Building the list from o.email
// alone drops him from every group send, and the "Missing email" filter cannot
// reveal it, because the owner it hangs off does have an address.
//
// So the list is built here, from both columns, and this file is the only
// place that decides who is on it.
//
// Whether a CC is a second PERSON is not decided here — sameAddress is shared
// with the pick-request generator, because a row that one screen calls a
// second contact and the other calls a dropped self-CC is worse than either
// answer on its own.

import { normalizeAddress, sameAddress } from "./address";

export interface GroupSendOwner {
  id: string;
  name: string;
  email: string | null;
  /** Second contact for this owner. Null for nearly everyone. */
  ccEmail: string | null;
}

export interface GroupSendList {
  /** Deduplicated, in roster order: each owner's address then their CC. */
  addresses: string[];
  /** Owners with no address of their own — they miss every group send. */
  missingEmail: GroupSendOwner[];
  /** The CC contacts on the list, and whose row each came from. */
  ccContacts: { ownerId: string; ownerName: string; address: string }[];
  /**
   * Addresses that appear on more than one ROW and were emitted once, each
   * named with the row that repeated it. Worth showing rather than silently
   * collapsing: two owners sharing an address is usually an intake mistake,
   * and the thing needed to fix it is which rows collide — so record that,
   * not just the string.
   */
  duplicates: { ownerId: string; ownerName: string; address: string }[];
}

/** Include each owner's second contact, not just their own address. */
export interface GroupSendOptions {
  /**
   * Default true. Set false for a send that is about ONE person's money: a
   * second contact is on the roster to see announcements, not to be BCC'd on
   * a note about the balance of the owner who pays for their entries.
   */
  includeCcContacts?: boolean;
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
export function groupSendList(
  owners: GroupSendOwner[],
  options: GroupSendOptions = {},
): GroupSendList {
  const includeCc = options.includeCcContacts ?? true;
  const addresses: string[] = [];
  const ccContacts: GroupSendList["ccContacts"] = [];
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
    const cc = normalizeAddress(o.ccEmail);
    if (email === "") missingEmail.push(o);
    else add(o, email);
    // A CC that reaches the owner's own mailbox is not a second person. The
    // pick-email screen reports it as dropped; counting it here would have
    // the two screens contradicting each other about the same row.
    if (includeCc && cc !== "" && !sameAddress(cc, o.email)) {
      ccContacts.push({ ownerId: o.id, ownerName: o.name, address: cc });
      add(o, cc);
    }
  }

  return { addresses, missingEmail, ccContacts, duplicates };
}
