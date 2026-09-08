// The GroupSendOwner rows the group-send list is built from, off the roster
// the local commands load. Same shape and same source as the admin emails
// page: entries.player_email off each owner's live entries. WHO is on the
// list is decided by groupSendList (src/lib/emails/group-send.ts) and nowhere
// here - this only feeds it the roster in roster order.

import type { GroupSendOwner } from "@/lib/emails/group-send";
import type { EntryRow, OwnerRow } from "../../lib/db";
import { confirmedOwners, ownerFullName } from "../../lib/roster";

/**
 * One row per confirmed owner, in the order the owners arrive, carrying the
 * addresses of the people who play that owner's live entries. A voided entry
 * has nobody playing it, so its giftee is not on the roster for this. An
 * owner row that arrives twice is emitted once.
 */
export function buildGroupSendOwners(owners: OwnerRow[], entries: EntryRow[]): GroupSendOwner[] {
  const playersByOwner = new Map<string, string[]>();
  for (const e of entries) {
    if (e.voided_at !== null || !e.is_gifted || !e.player_email) continue;
    playersByOwner.set(e.owner_id, [...(playersByOwner.get(e.owner_id) ?? []), e.player_email]);
  }
  const seen = new Set<string>();
  const out: GroupSendOwner[] = [];
  for (const o of confirmedOwners(owners)) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      name: ownerFullName(o),
      email: o.email,
      players: playersByOwner.get(o.id) ?? [],
    });
  }
  return out;
}
