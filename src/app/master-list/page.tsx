import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { LOCKED_TEAM } from "@/lib/data/types";
import { MASTER_POOL } from "@/lib/site-copy";
import { mergeWeekColumns, poolStats, weekColumns } from "@/lib/master-list";
import { formatEtDate } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MasterListTable, type OurCell } from "@/components/master-list/master-list-table";
import { WeeklyResultFiles } from "@/components/master-list/weekly-result-files";

export const metadata: Metadata = { title: MASTER_POOL.title };
export const dynamic = "force-dynamic";

export default async function MasterListPage() {
  const data = getData();
  const [master, pot, cells, imports] = await Promise.all([
    data.getMasterList(),
    data.getPot(),
    data.getGridCells(),
    data.getLynneImports(),
  ]);

  const stats = poolStats(pot);
  const ourIds = new Set(master.rows.map((r) => r.entryId).filter((id): id is string => id !== null));
  // Only revealed picks reach the public view; a masked one stays masked here.
  const ourCells: OurCell[] = cells
    .filter((c) => ourIds.has(c.entryId) && c.team !== LOCKED_TEAM)
    .map((c) => ({ entryId: c.entryId, week: c.week, team: c.team }));
  const columns = mergeWeekColumns(
    weekColumns(master.rows),
    [...new Set(ourCells.map((c) => c.week))],
  );

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

      {stats.length > 0 ? (
        <div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <Card key={s.label} className="bg-surface">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl tabular-nums">{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The master pool&apos;s own figures, as published.
            {master.loadedAt ? (
              <span suppressHydrationWarning> Sheet as of {formatEtDate(master.loadedAt)}.</span>
            ) : null}
          </p>
        </div>
      ) : null}

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
        />
      )}

      <WeeklyResultFiles imports={imports} />
    </div>
  );
}
