import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { isAliveStatus } from "@/lib/alive";
import { buildSubmitRows } from "@/lib/lynne/submit";
import { LynneSubmit } from "@/components/admin/lynne-submit";

export const metadata: Metadata = { title: "Lynne submission" };

export default async function LynneSubmitPage(props: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await props.searchParams;
  const pub = getData();
  const [entries, cells, weeks, adminEntries] = await Promise.all([
    getAdminData().listEntrySummaries(),
    getAdminData().listGridCells(),
    pub.getWeeks(),
    getAdminData().listEntries(),
  ]);

  const playWeek = currentPlayWeek(weeks, new Date())?.week ?? 1;
  const week = Math.min(
    18,
    Math.max(1, Number(weekParam) || playWeek),
  );

  const numberById = new Map(
    adminEntries.map((e) => [e.id, e.lynneNumber] as const),
  );
  const pickByEntry = new Map(
    cells.filter((c) => c.week === week).map((c) => [c.entryId, c.team]),
  );
  const alive = entries.filter((e) => isAliveStatus(e.status));
  const { ready, missingNumber, missingPick, aliveCount } = buildSubmitRows(
    alive,
    pickByEntry,
    numberById,
  );

  return (
    <LynneSubmit
      week={week}
      weeks={weeks.map((w) => w.week)}
      ready={ready}
      missingNumber={missingNumber}
      missingPick={missingPick}
      aliveCount={aliveCount}
    />
  );
}
