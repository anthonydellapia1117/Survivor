import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Grid" };

export default function GridPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">The Grid</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every entry, every week, every result.
        </p>
      </div>
      <EmptyState
        title="No entries yet"
        detail="The 47-entry picks grid renders here once the roster is seeded."
      />
    </div>
  );
}
