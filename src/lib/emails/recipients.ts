// Who gets a pick request, and which entries theirs lists.
//
// Until now the unit was the OWNER: one message per owner, listing every entry
// they paid for. That stopped being right the moment an entry could be played
// by somebody else. A gifted entry's pick belongs to its player — Anthony's
// decision of 2026-09-04: once an entry is gifted the giftee owns the pick, and
// a reply from them is acted on. The money and the tier stay with the buyer.
//
// So the unit is the RECIPIENT — the PERSON, keyed by their mailbox, not the
// (owner, person) pair. Kris gets a message listing his two; Chas gets his own
// message listing his, with his own reply line.
//
// Keying on the pair looks equivalent and is not. Somebody gifted entries by
// two different buyers would get two separate emails, and somebody who both
// owns entries and plays one gifted by another owner would get two more —
// each listing part of what they have to pick, from the same sender, on the
// same deadline. That is exactly the "reads a list and works out which half is
// theirs" problem the recipient unit exists to end, so the buckets are built
// across the WHOLE roster before any message is emitted.
//
// Everything downstream — the screen, copy-all, the address list, the skip
// reporting — is built on what this returns, so the unit is learned in one
// place rather than bolted onto owner grouping in five.

import { normalizeAddress, sameAddress } from "./address";

export interface RecipientEntry {
  id: string;
  entryName: string;
  isGifted: boolean;
  playerEmail: string | null;
}

export interface RecipientOwner {
  id: string;
  /** How the OWNER is addressed — first name where there is one. */
  greetingName: string;
  fullName: string;
  email: string | null;
  entries: RecipientEntry[];
}

/** An owner who bought entries on somebody else's message. */
export interface Buyer {
  id: string;
  name: string;
}

export interface Recipient {
  /** The lowercased address. One mailbox, one message, one conversation. */
  key: string;
  /**
   * "owner" — every entry is one they bought themselves.
   * "player" — every entry was bought for them by somebody else.
   * "mixed"  — both, which one message has to say plainly.
   */
  kind: "owner" | "player" | "mixed";
  email: string;
  /** How this person is greeted. A giftee is greeted by their entry names,
   *  because the roster stores no name for them — the entry name is the only
   *  identity anyone gave, and inventing one would be the app deciding. */
  greetingName: string;
  entries: RecipientEntry[];
  /** Owners who bought entries on this message, excluding the recipient. */
  buyers: Buyer[];
  /** How many of `entries` somebody else bought. Not derivable from
   *  buyers.length: one buyer can gift several. */
  giftedCount: number;
}

export interface RecipientSplit {
  recipients: Recipient[];
  /** Entries the OWNER plays but who has no address — unmailable. */
  ownersWithoutEmail: {
    id: string;
    name: string;
    entryCount: number;
    entryNames: string[];
  }[];
  /**
   * Gifted entries with nobody to send to: is_gifted with no player_email.
   * The gap worth chasing — somebody else is playing this entry and the
   * roster cannot reach them. Distinct from an owner with no address,
   * because the person to go and ask is different.
   */
  giftedWithoutEmail: {
    entryId: string;
    entryName: string;
    ownerId: string;
    ownerName: string;
  }[];
}

/**
 * A giftee's greeting. The roster deliberately stores no name for them — see
 * `player_name` in the design notes, dropped because it drifts against the
 * entry name that already carries the identity. So greet them by what they
 * are known as here.
 */
function playerGreeting(entries: RecipientEntry[]): string {
  const names = entries.map((e) => e.entryName);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface Bucket {
  email: string;
  /** Set once the mailbox is an owner's own — their greeting wins. */
  ownerGreeting: string | null;
  entries: RecipientEntry[];
  buyers: Map<string, string>;
  giftedCount: number;
  ownsSome: boolean;
  playsSome: boolean;
}

/**
 * Split a roster into the messages that actually need sending.
 *
 * An entry is the owner's unless it is gifted AND carries an address that
 * differs from the owner's own. A gifted entry whose player_email is the
 * owner's address is the owner's to play — the same rule the group-send list
 * applies, from the same helper, so the two cannot drift.
 */
export function recipientsForPicks(owners: RecipientOwner[]): RecipientSplit {
  const ownersWithoutEmail: RecipientSplit["ownersWithoutEmail"] = [];
  const giftedWithoutEmail: RecipientSplit["giftedWithoutEmail"] = [];
  // Keyed on the lowercased address, so "Chas@" beside "chas@" is one person.
  // Insertion order is roster order, which is the order messages come out in.
  const buckets = new Map<string, Bucket>();

  const bucketFor = (address: string): Bucket => {
    const key = address.toLowerCase();
    const existing = buckets.get(key);
    if (existing) return existing;
    const fresh: Bucket = {
      email: address,
      ownerGreeting: null,
      entries: [],
      buyers: new Map(),
      giftedCount: 0,
      ownsSome: false,
      playsSome: false,
    };
    buckets.set(key, fresh);
    return fresh;
  };

  for (const o of owners) {
    if (o.entries.length === 0) continue;
    const ownerEmail = normalizeAddress(o.email);
    const own: RecipientEntry[] = [];
    const gifted: RecipientEntry[] = [];

    // Partition FIRST, bucket second. The owner's own message has to be
    // created before the entries they gifted away, or a roster-ordered run
    // puts the giftee's message ahead of the buyer's.
    for (const e of o.entries) {
      const player = normalizeAddress(e.playerEmail);
      if (!e.isGifted || player === "" || sameAddress(player, o.email)) {
        // Gifted with no address is still a gap even though the owner keeps
        // it for now: somebody else is playing it and cannot be reached.
        if (e.isGifted && player === "") {
          giftedWithoutEmail.push({
            entryId: e.id,
            entryName: e.entryName,
            ownerId: o.id,
            ownerName: o.fullName,
          });
        }
        own.push(e);
        continue;
      }
      gifted.push(e);
    }

    // The owner's own message, if there is anything left to ask them for.
    if (own.length > 0) {
      if (ownerEmail === "") {
        ownersWithoutEmail.push({
          id: o.id,
          name: o.fullName,
          entryCount: own.length,
          entryNames: own.map((e) => e.entryName),
        });
      } else {
        // Merges with anything already gifted to this mailbox. Two owner ROWS
        // sharing one address merge too: that is an intake mistake the roster
        // surfaces elsewhere, and two emails to one mailbox each asking for
        // picks on half the entries is the worse way to find out about it.
        const bucket = bucketFor(ownerEmail);
        bucket.ownerGreeting ??= o.greetingName;
        bucket.entries.push(...own);
        bucket.ownsSome = true;
      }
    }

    // One message per PERSON, not per person-per-buyer. Two buyers gifting to
    // the same player put their entries on one message, each buyer named.
    for (const e of gifted) {
      const bucket = bucketFor(normalizeAddress(e.playerEmail));
      bucket.entries.push(e);
      bucket.playsSome = true;
      bucket.giftedCount += 1;
      bucket.buyers.set(o.id, o.fullName);
    }
  }

  const recipients: Recipient[] = [];
  for (const [key, b] of buckets) {
    // A giftee is reachable on their own address whether or not the owner who
    // bought their entries could be mailed: an owner with no address of their
    // own does not silence the people playing the entries they bought.
    recipients.push({
      key,
      kind: b.ownsSome && b.playsSome ? "mixed" : b.ownsSome ? "owner" : "player",
      email: b.email,
      greetingName: b.ownerGreeting ?? playerGreeting(b.entries),
      entries: b.entries,
      buyers: [...b.buyers].map(([id, name]) => ({ id, name })),
      giftedCount: b.giftedCount,
    });
  }

  return { recipients, ownersWithoutEmail, giftedWithoutEmail };
}
