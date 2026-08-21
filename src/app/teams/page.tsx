import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Teams" };

export default function TeamsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Team Availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Which teams each entry still has in hand.
        </p>
      </div>
      <EmptyState
        title="No entries yet"
        detail="Per-entry team availability and the league-wide usage heatmap appear here once the roster is seeded."
      />
    </div>
  );
}
