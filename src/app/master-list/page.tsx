import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { LOCKED_TEAM } from "@/lib/data/types";
import { MASTER_POOL } from "@/lib/site-copy";
import { countVariance, mergeWeekColumns, poolAsEntries, teamResults, weekColumns } from "@/lib/master-list";
import { rowTone, type RowTone } from "@/lib/result-colour";
import { formatEtDate } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { MasterListTable, type OurCell } from "@/components/master-list/master-list-table";
import { WeeklyResultFiles } from "@/components/master-list/weekly-result-files";

export const metadata: Metadata = { title: MASTER_POOL.title };
export const dynamic = "force-dynamic";

export default async function MasterListPage() {
  const data = getData();
  const [master, pot, cells, imports, games] = await Promise.all([
    data.getMasterList(),
    data.getPot(),
    data.getGridCells(),
    data.getLynneImports(),
    data.getSchedule(),
  ]);

  // Her four figures moved to the dashboard, where they open the site.
  // What stays here is the one thing only this page can say: how her
  // published total sits against the rows actually on the sheet.
  const variance = countVariance(pot.poolEntryCount, master.rows.length);
  const ourIds = new Set(master.rows.map((r) => r.entryId).filter((id): id is string => id !== null));
  // Only revealed picks reach the public view; a masked one stays masked here.
  const ourCells: OurCell[] = cells
    .filter((c) => ourIds.has(c.entryId) && c.team !== LOCKED_TEAM)
    .map((c) => ({ entryId: c.entryId, week: c.week, team: c.team }));
  const columns = mergeWeekColumns(
    weekColumns(master.rows),
    [...new Set(ourCells.map((c) => c.week))],
  );

  // The colours, from the STORED result and nothing else. Her cells arrive
  // here already masked by v_master_list's reveal gate, so a week she has
  // published but whose game has not kicked off carries no cell to colour -
  // the gate decides what is visible, this only decides what a visible cell
  // looks like. Scored through poolAsEntries, the same call the Grid makes,
  // so a row reads the same on both pages.
  const results = Object.fromEntries(teamResults(games));
  const scored = poolAsEntries(master, games);
  const toneById = new Map(scored.entries.map((e) => [e.id, rowTone(e)]));
  const rowTones: Record<number, RowTone> = {};
  for (const r of master.rows) {
    const tone = toneById.get(r.entryId ?? `pool-${r.no}`);
    if (tone !== undefined && tone !== "clean") rowTones[r.no] = tone;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">{MASTER_POOL.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every entry in the master pool, in its runner&apos;s numbering, with the
          week-by-week picks as published. Our group&apos;s entries are marked;
          where we hold a pick for one of them, it sits beside the published one.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        {master.loadedAt ? (
          <span suppressHydrationWarning>Sheet as of {formatEtDate(master.loadedAt)}. </span>
        ) : null}
        {/* No variance means either the two counts agree or she has not
            published a total yet. Only the first is a match. */}
        {variance ??
          (pot.poolEntryCount !== null ? "Her published total matches the rows on this sheet." : null)}
      </p>

      {master.rows.length === 0 ? (
        <EmptyState
          title="No sheet loaded yet"
          detail="The master pool's full list appears here once its sheet is loaded."
        />
      ) : (
        <MasterListTable
          rows={master.rows}
          columns={columns}
          ourCells={ourCells}
          ourCount={ourIds.size}
          results={results}
          rowTones={rowTones}
        />
      )}

      <WeeklyResultFiles imports={imports} />
    </div>
  );
}
