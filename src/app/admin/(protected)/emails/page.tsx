import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { EmailsClient } from "@/components/admin/emails-client";

export const metadata: Metadata = { title: "Emails" };

export default async function EmailsPage() {
  const owners = await getAdminData().listOwners();
  return (
    <EmailsClient
      owners={owners.map((o) => ({
        id: o.id,
        name: `${o.firstName} ${o.lastName}`,
        email: o.email,
        status: o.participationStatus,
        paid: o.paidCents >= o.dueCents && o.dueCents > 0,
      }))}
    />
  );
}
