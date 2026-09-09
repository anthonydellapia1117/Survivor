import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { countVariance, fullyRevealedWeeks, poolAsEntries } from "@/lib/master-list";
import { formatEtDate } from "@/lib/format";
import { GridView } from "@/components/grid/grid-view";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Grid" };
// Always render fresh: results and picks change while the site is open.
export const dynamic = "force-dynamic";

export default async function GridPage() {
  const data = getData();
  const [entries, weeks, cells, master, games, pot] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
    data.getMasterList(),
    data.getSchedule(),
    data.getPot(),
  ]);

  // The whole pool as grid rows: her published picks, scored against our game
  // results so the standing chips mean the same thing in both scopes. Only
  // cells her public view has revealed reach this, so a week still masked on
  // our 121 is masked here too.
  const pool = poolAsEntries(master, games);
  const revealedWeeks = fullyRevealedWeeks(games);
  const variance = countVariance(pot.poolEntryCount, master.rows.length);
  const poolNote =
    master.rows.length === 0
      ? null
      : [
          master.loadedAt ? `Sheet as of ${formatEtDate(master.loadedAt)}.` : null,
          variance,
        ]
          .filter(Boolean)
          .join(" ") || null;

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
      {entries.length === 0 && pool.entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="The picks grid renders here once the roster is seeded."
        />
      ) : (
        <GridView
          entries={entries}
          weeks={weeks}
          cells={cells}
          poolEntries={pool.entries}
          poolCells={pool.cells}
          poolNote={poolNote}
          revealedWeeks={revealedWeeks}
        />
      )}
    </div>
  );
}
