import type { Metadata } from "next";
import Link from "next/link";
import { getData } from "@/lib/data";
import { TeamsClient } from "@/components/teams/teams-client";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Teams" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const data = getData();
  const [entries, cells, weeks] = await Promise.all([
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Team Availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Which teams each entry still has in hand. Plan against future
          matchups on the{" "}
          <Link href="/schedule" className="text-primary underline-offset-2 hover:underline">
            full 2026 schedule
          </Link>
          .
        </p>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="Per-entry team availability appears here once the roster is seeded."
        />
      ) : (
        <TeamsClient
          entries={entries}
          cells={cells}
          weekCount={weeks.length}
        />
      )}
    </div>
  );
}
