// Who gets a pick request, and which entries theirs lists.
//
// Until now the unit was the OWNER: one message per owner, listing every entry
// they paid for. That stopped being right the moment an entry could be played
// by somebody else. A gifted entry's pick belongs to its player — Anthony's
// decision of 2026-09-04: once an entry is gifted the giftee owns the pick, and
// a reply from them is acted on. The money and the tier stay with the buyer.
//
// So the unit is the RECIPIENT. Kris gets a message listing his two; Chas gets
// his own message listing only his two, with his own reply line. Two people,
// two conversations, neither reading a list of four and working out which half
// is theirs.
//
// Everything downstream — the screen, copy-all, the address list, the skip
// reporting — is built on what this returns, so the new unit is learned in one
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

export interface Recipient {
  /** Stable across renders: the owner id, or owner id + the player address. */
  key: string;
  kind: "owner" | "player";
  email: string;
  /** How this person is greeted. A giftee is greeted by their entry names,
   *  because the roster stores no name for them — the entry name is the only
   *  identity anyone gave, and inventing one would be the app deciding. */
  greetingName: string;
  /** Who paid. Every recipient belongs to exactly one owner. */
  ownerId: string;
  ownerName: string;
  entries: RecipientEntry[];
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

/**
 * Split a roster into the messages that actually need sending.
 *
 * An entry is the owner's unless it is gifted AND carries an address that
 * differs from the owner's own. A gifted entry whose player_email is the
 * owner's address is the owner's to play — the same rule ccAddress applies,
 * from the same helper, so the two cannot drift.
 */
export function recipientsForPicks(owners: RecipientOwner[]): RecipientSplit {
  const recipients: Recipient[] = [];
  const ownersWithoutEmail: RecipientSplit["ownersWithoutEmail"] = [];
  const giftedWithoutEmail: RecipientSplit["giftedWithoutEmail"] = [];

  for (const o of owners) {
    if (o.entries.length === 0) continue;
    const ownerEmail = normalizeAddress(o.email);
    const own: RecipientEntry[] = [];
    // Keyed on the lowercased address so one giftee with two entries gets one
    // message, and "Chas@" beside "chas@" is not two people.
    const byPlayer = new Map<string, { address: string; entries: RecipientEntry[] }>();

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
      const key = player.toLowerCase();
      const bucket = byPlayer.get(key) ?? { address: player, entries: [] };
      bucket.entries.push(e);
      byPlayer.set(key, bucket);
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
        recipients.push({
          key: o.id,
          kind: "owner",
          email: ownerEmail,
          greetingName: o.greetingName,
          ownerId: o.id,
          ownerName: o.fullName,
          entries: own,
        });
      }
    }

    // One message per giftee. Deliberately independent of whether the owner
    // could be mailed: a giftee is reachable on their own address, and an
    // owner with no address of their own does not silence the people playing
    // the entries they bought.
    for (const [key, bucket] of byPlayer) {
      recipients.push({
        key: `${o.id}:${key}`,
        kind: "player",
        email: bucket.address,
        greetingName: playerGreeting(bucket.entries),
        ownerId: o.id,
        ownerName: o.fullName,
        entries: bucket.entries,
      });
    }
  }

  return { recipients, ownersWithoutEmail, giftedWithoutEmail };
}
