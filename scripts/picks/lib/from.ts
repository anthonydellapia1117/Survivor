// Who --from means. An email or a name fragment must resolve to exactly one
// person on the roster, and a gifted entry's name resolves to the PERSON WHO
// PLAYS IT, never to the owner who bought it: "Chas Flaster" is Chas, whose
// picks are his to make (CLAUDE.md, Gifted entries), not Kris.

import type { EntryRow, OwnerRow } from "../../lib/db";

export interface FromScope {
  /** The address the sender is known by, when there is one. */
  address: string | null;
  /** The owner --from named, when it named an owner (with or without an address on file). */
  ownerId: string | null;
}

/**
 * Resolve --from against confirmed owners and live entries. Throws when it
 * matches nobody or more than one person; a scope is never guessed.
 */
export function resolveFromArg(raw: string, owners: OwnerRow[], entries: EntryRow[]): FromScope {
  const needle = raw.trim().toLowerCase();
  if (!needle) throw new Error("--from needs an email or a name.");
  const ownerIds = new Set(owners.map((o) => o.id));
  const live = entries.filter((e) => e.voided_at === null && ownerIds.has(e.owner_id));

  // 1. An address, exactly: an owner's own or a player's.
  const ownerByEmail = owners.filter((o) => (o.email ?? "").toLowerCase() === needle);
  const playedByEmail = live.filter((e) => (e.player_email ?? "").toLowerCase() === needle);
  if (ownerByEmail.length === 1 || playedByEmail.length > 0) return { address: needle, ownerId: ownerByEmail[0]?.id ?? null };

  // 2. A name fragment. Gifted entries with an address point at their player;
  // a gifted entry with no address points at nobody, never at its buyer.
  const giftedHits = live.filter((e) => e.is_gifted && e.player_email && e.entry_name.toLowerCase().includes(needle));
  const players = [...new Set(giftedHits.map((e) => e.player_email!.toLowerCase()))];
  const ownerHits = owners.filter(
    (o) =>
      `${o.first_name} ${o.last_name}`.toLowerCase().includes(needle) ||
      (o.email ?? "").toLowerCase().includes(needle) ||
      live.some((e) => e.owner_id === o.id && !e.is_gifted && e.entry_name.toLowerCase().includes(needle)),
  );
  const people = players.length + ownerHits.length;
  if (people === 0) {
    const orphan = live.find((e) => e.is_gifted && !e.player_email && e.entry_name.toLowerCase().includes(needle));
    if (orphan) {
      throw new Error(
        `--from "${raw}" is ${orphan.entry_name}, a gifted entry with no player address on file: nobody can be scoped to it until the address is recorded (CLAUDE.md, Gifted entries).`,
      );
    }
  }
  if (people === 1) {
    if (players.length === 1) return { address: players[0], ownerId: null };
    return { address: ownerHits[0].email?.toLowerCase() ?? null, ownerId: ownerHits[0].id };
  }
  const named = [...players, ...ownerHits.map((o) => `${o.first_name} ${o.last_name}`)];
  throw new Error(`--from "${raw}" matches ${people} people: ${named.join(", ") || "none"}. Use the address.`);
}
