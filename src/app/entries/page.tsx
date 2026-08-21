import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { EntriesTable } from "@/components/entries/entries-table";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Entries" };
export const dynamic = "force-dynamic";

export default async function EntriesPage() {
  const data = getData();
  const [entries, cells, weeks] = await Promise.all([
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
  ]);

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

  const rows = entries.map((e) => ({
    ...e,
    currentPick: currentPickByEntry.get(e.id) ?? null,
    weeksSurvived: e.lastScoredWeek ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Roster</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All {entries.length} entries with status, lives, and current picks.
        </p>
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
