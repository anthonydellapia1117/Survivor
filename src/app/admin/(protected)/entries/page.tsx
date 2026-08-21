import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { EntriesAdmin } from "@/components/admin/entries/entries-admin";

export const metadata: Metadata = { title: "Entries" };

export default async function AdminEntriesPage() {
  const data = getAdminData();
  const [entries, owners] = await Promise.all([
    data.listEntries(),
    data.listOwners(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Entries</h1>
      </div>
      <EntriesAdmin entries={entries} owners={owners} />
    </div>
  );
}
