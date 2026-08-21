import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { OwnersClient } from "@/components/admin/owners/owners-client";

export const metadata: Metadata = { title: "Owners" };

export default async function AdminOwnersPage() {
  const data = getAdminData();
  const [owners, entries] = await Promise.all([
    data.listOwners(),
    data.listEntries(),
  ]);
  return <OwnersClient owners={owners} entries={entries} />;
}
