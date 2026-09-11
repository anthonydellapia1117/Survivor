import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { countVariance, fullyRevealedWeeks, poolAsEntries, poolRowIdentity } from "@/lib/master-list";
import { formatEtDate } from "@/lib/format";
import { GridView } from "@/components/grid/grid-view";
import { WeeklyResultFiles } from "@/components/master-list/weekly-result-files";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Grid" };
// Always render fresh: results and picks change while the site is open.
export const dynamic = "force-dynamic";

export default async function GridPage() {
  const data = getData();
  const [entries, weeks, cells, master, games, pot, imports] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
    data.getMasterList(),
    data.getSchedule(),
    data.getPot(),
    data.getLynneImports(),
  ]);

  // The whole pool as grid rows: her published picks, scored against our game
  // results so the standing chips mean the same thing in both scopes. Only
  // cells her public view has revealed reach this, so a week still masked on
  // our 121 is masked here too.
  const pool = poolAsEntries(master, games);
  // Her NO. and her NAMES as two columns rather than one glued string. Our
  // group's rows read their NO. from the same map: v_entry_public does not
  // carry a Lynne number, and her sheet already holds every one of them.
  const identity = poolRowIdentity(master);
  const revealedWeeks = fullyRevealedWeeks(games);
  const variance = countVariance(pot.poolEntryCount, master.rows.length);
  // No variance means either the two counts agree or she has not published a
  // total yet. Only the first is a match, and saying so is the one thing this
  // line can say that nothing else on the site does.
  const poolNote =
    master.rows.length === 0
      ? null
      : [
          master.loadedAt ? `Sheet as of ${formatEtDate(master.loadedAt)}.` : null,
          variance ??
            (pot.poolEntryCount !== null ? "Her published total matches the rows on this sheet." : null),
        ]
          .filter(Boolean)
          .join(" ") || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">The Grid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every entry in the master pool, in its runner&apos;s numbering, week
            by week. Our group&apos;s rows are marked. Tap a cell for details,
            tap a header to sort.
          </p>
        </div>
        <a
          href="/api/export/picks.xlsx"
          className="text-sm font-medium text-primary hover:underline"
          title="The workbook carries this group's entries and picks; the master pool's rows come from her published sheet"
        >
          Export Excel (our group)
        </a>
      </div>
      {entries.length === 0 && pool.entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="The picks grid renders here once the roster is seeded."
        />
      ) : (
        <>
          <GridView
            entries={entries}
            weeks={weeks}
            cells={cells}
            poolEntries={pool.entries}
            poolCells={pool.cells}
            identity={identity}
            poolNote={poolNote}
            revealedWeeks={revealedWeeks}
          />
          {/* Her weekly result files sat under the Master List; the table they
              belong to is here now, so they are. */}
          <WeeklyResultFiles imports={imports} />
        </>
      )}
    </div>
  );
}
