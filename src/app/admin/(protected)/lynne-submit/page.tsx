import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { isAliveStatus } from "@/lib/alive";
import { LynneSubmit } from "@/components/admin/lynne-submit";

export const metadata: Metadata = { title: "Lynne submission" };

export default async function LynneSubmitPage(props: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await props.searchParams;
  const pub = getData();
  const [entries, cells, weeks, adminEntries] = await Promise.all([
    pub.getEntries(),
    pub.getGridCells(),
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
  const ready: { lynneNumber: number; entryName: string; team: string }[] = [];
  const missingNumber: string[] = [];
  const missingPick: string[] = [];
  for (const e of alive) {
    const team = pickByEntry.get(e.id);
    const no = numberById.get(e.id) ?? null;
    if (!team || team === "MISSED") {
      missingPick.push(e.entryName);
      continue;
    }
    if (no === null) {
      missingNumber.push(e.entryName);
      continue;
    }
    ready.push({ lynneNumber: no, entryName: e.entryName, team });
  }

  return (
    <LynneSubmit
      week={week}
      weeks={weeks.map((w) => w.week)}
      ready={ready}
      missingNumber={missingNumber}
      missingPick={missingPick}
      aliveCount={alive.length}
    />
  );
}
