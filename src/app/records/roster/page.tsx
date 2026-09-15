import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { eliminationWeekOf } from "@/lib/alive";
import { scoreFromGames } from "@/lib/live-standing";
import { EntriesTable } from "@/components/entries/entries-table";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Entries" };
export const dynamic = "force-dynamic";

export default async function EntriesPage() {
  const data = getData();
  const [storedEntries, storedCells, weeks, games] = await Promise.all([
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
    data.getSchedule(),
  ]);
  // Status, lives and elimination week read from the scores for display;
  // the stored record is her results file (src/lib/live-standing.ts).
  const { entries, cells } = scoreFromGames(storedEntries, storedCells, games);

  // Current week: the first week whose deadline is in the future, else the last.
  const now = Date.now();
  const currentWeek =
    weeks.find((w) => new Date(w.deadlineAt).getTime() > now)?.week ??
    weeks.at(-1)?.week ??
    1;

  const currentPickByEntry = new Map<string, string>();
  for (const c of cells) {
    if (c.week === currentWeek) currentPickByEntry.set(c.entryId, c.team);
  }

  // Default order: admin entries first (stable within groups); clicking a
  // column header in the table overrides it for that view.
  const rows = [...entries]
    .sort((a, b) => Number(b.isAdminEntry) - Number(a.isAdminEntry))
    .map((e) => ({
      ...e,
      currentPick: currentPickByEntry.get(e.id) ?? null,
      weeksSurvived: e.lastScoredWeek ?? 0,
      elimWeek: eliminationWeekOf(cells.filter((c) => c.entryId === e.id)),
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Roster</h1>
          {/* A roster LISTING of the group Anthony manages, not a viewer KPI:
              the pool's roster is /grid. It is the one public page that shows
              our figures with no toggle, so the header says whose they are,
              in the exact words the toggles use (Anthony, 2026-09-15). */}
          <p className="mt-1 text-sm text-muted-foreground">
            Our group - {entries.length} entries with status, lives and current picks.
          </p>
        </div>
        <a
          href="/api/export/roster.csv"
          className="text-sm font-medium text-primary hover:underline"
        >
          Download CSV
        </a>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="The roster table appears here once the pool is seeded."
        />
      ) : (
        <EntriesTable rows={rows} />
      )}
    </div>
  );
}
