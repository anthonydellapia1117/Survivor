import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { EmailsClient } from "@/components/admin/emails-client";

export const metadata: Metadata = { title: "Emails" };

export default async function EmailsPage() {
  const admin = getAdminData();
  const [owners, entries] = await Promise.all([
    admin.listOwners(),
    admin.listEntries(),
  ]);

  // Who plays entries somebody else bought. Voided entries are excluded --
  // nobody is playing those, so their giftee is not on the roster for this.
  // Elimination is deliberately NOT a filter: an eliminated player is still in
  // the group and still hears the announcements.
  const playersByOwner = new Map<string, string[]>();
  for (const e of entries) {
    if (e.voidedAt !== null || !e.isGifted || !e.playerEmail) continue;
    playersByOwner.set(e.ownerId, [
      ...(playersByOwner.get(e.ownerId) ?? []),
      e.playerEmail,
    ]);
  }

  return (
    <EmailsClient
      owners={owners.map((o) => ({
        id: o.id,
        name: `${o.firstName} ${o.lastName}`,
        email: o.email,
        players: playersByOwner.get(o.id) ?? [],
        status: o.participationStatus,
        // dueCents 0 (the runner's free-entry row) owes nothing.
        paid: o.dueCents === 0 || o.paidCents >= o.dueCents,
      }))}
    />
  );
}
