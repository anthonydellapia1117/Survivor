import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { eliminationWeekOf } from "@/lib/alive";
import { scoreFromGames } from "@/lib/live-standing";
import { poolAsEntries } from "@/lib/master-list";
import { ScopeToggle, scopeFrom } from "@/components/scope-toggle";
import { EntriesTable } from "@/components/entries/entries-table";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Entries" };
// Rendered on every request: standings move as games go final.
export const revalidate = 0;

export default async function EntriesPage(
  props: { searchParams?: Promise<{ scope?: string }> } = {},
) {
  const { scope: scopeParam } = (await props.searchParams) ?? {};
  const data = getData();
  const [storedEntries, storedCells, weeks, games, master] = await Promise.all([
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
    data.getSchedule(),
    data.getMasterList(),
  ]);
  // Status, lives and elimination week read from the scores for display;
  // the stored record is her results file (src/lib/live-standing.ts).
  // The whole pool by default, every row of her newest sheet; our group's
  // roster, with its owners, only when the toggle says so (Anthony,
  // 2026-09-15).
  const ours = scoreFromGames(storedEntries, storedCells, games);
  const poolLoaded = master.rows.length > 0;
  const scope = scopeFrom(scopeParam, poolLoaded);
  const { entries, cells } = scope === "pool" ? poolAsEntries(master, games) : ours;

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

  // Default order: her sheet's NO. order for the whole pool; for our group,
  // admin entries first (stable within groups). Clicking a column header in
  // the table overrides it for that view.
  const rows = [...entries]
    .sort((a, b) => (scope === "pool" ? 0 : Number(b.isAdminEntry) - Number(a.isAdminEntry)))
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
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === "pool"
              ? `Every entry on her newest sheet, ${entries.length.toLocaleString("en-US")} in all, with status, lives and current picks.`
              : `Our group's ${entries.length.toLocaleString("en-US")} entries with owners, status, lives and current picks.`}
          </p>
        </div>
        {scope === "ours" ? (
          <a
            href="/api/export/roster.csv"
            className="text-sm font-medium text-primary hover:underline"
          >
            Download CSV
          </a>
        ) : null}
      </div>
      <ScopeToggle
        scope={scope}
        poolCount={poolLoaded ? master.rows.length : null}
        oursCount={ours.entries.length}
        path="/records/roster"
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No entries yet"
          detail="The roster table appears here once the pool is seeded."
        />
      ) : (
        <EntriesTable rows={rows} pool={scope === "pool"} />
      )}
    </div>
  );
}
