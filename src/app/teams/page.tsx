import type { Metadata } from "next";
import Link from "next/link";
import { getData } from "@/lib/data";
import { poolAsEntries } from "@/lib/master-list";
import { TeamsSource } from "@/components/teams/teams-source";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Teams" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const data = getData();
  const [entries, cells, weeks, games, master] = await Promise.all([
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
    data.getSchedule(),
    data.getMasterList(),
  ]);
  // The whole pool from the published sheet is the default view; our group
  // is the other setting.
  const pool = poolAsEntries(master);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Teams</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How many entries picked each team each week, across the whole master
          pool or just our group, counting only finished games. Plan against
          future matchups on the{" "}
          <Link href="/schedule" className="text-primary underline-offset-2 hover:underline">
            full 2026 schedule
          </Link>
          .
        </p>
      </div>
      {entries.length === 0 && pool.entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="Team pick counts appear here once the roster is seeded."
        />
      ) : (
        <TeamsSource
          ours={{ entries, cells }}
          pool={pool}
          poolLoaded={pool.entries.length > 0}
          poolHasPicks={pool.cells.length > 0}
          weekCount={weeks.length}
          games={games}
        />
      )}
    </div>
  );
}
