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
   * Addresses that appear on more than one row and were emitted once. Worth
   * showing rather than silently collapsing: two owners sharing an address is
   * usually an intake mistake, and a CC that duplicates somebody's primary
   * address means the arrangement is already covered.
   */
  duplicates: string[];
}

const clean = (v: string | null | undefined): string => v?.trim() ?? "";

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
  const ccContacts: GroupSendList["ccContacts"] = [];
  const missingEmail: GroupSendOwner[] = [];
  const duplicates: string[] = [];
  // Case-insensitive, because mailbox case is not significant to any provider
  // this pool uses and "Kris@" beside "kris@" is one person, not two.
  const seen = new Set<string>();

  const add = (address: string) => {
    const key = address.toLowerCase();
    if (seen.has(key)) {
      if (!duplicates.includes(address)) duplicates.push(address);
      return;
    }
    seen.add(key);
    addresses.push(address);
  };

  for (const o of owners) {
    const email = clean(o.email);
    const cc = clean(o.ccEmail);
    if (email === "") missingEmail.push(o);
    else add(email);
    if (cc !== "") {
      ccContacts.push({ ownerId: o.id, ownerName: o.name, address: cc });
      add(cc);
    }
  }

  return { addresses, missingEmail, ccContacts, duplicates };
}
