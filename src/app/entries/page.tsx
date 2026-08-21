import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Entries" };

export default function EntriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Roster</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All entries with status, lives, and current picks.
        </p>
      </div>
      <EmptyState
        title="No entries yet"
        detail="The roster table appears here once the pool is seeded."
      />
    </div>
  );
}
