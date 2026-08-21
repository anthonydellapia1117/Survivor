import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { GridView } from "@/components/grid/grid-view";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Grid" };
// Always render fresh: results and picks change while the site is open.
export const dynamic = "force-dynamic";

export default async function GridPage() {
  const data = getData();
  const [entries, weeks, cells] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">The Grid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every entry, every week, every result. Tap a cell for details.
          </p>
        </div>
        <a
          href="/api/export/picks.xlsx"
          className="text-sm font-medium text-primary hover:underline"
        >
          Export Excel
        </a>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="The picks grid renders here once the roster is seeded."
        />
      ) : (
        <GridView entries={entries} weeks={weeks} cells={cells} />
      )}
    </div>
  );
}
