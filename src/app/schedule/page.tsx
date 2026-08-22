import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { ScheduleGrid } from "@/components/schedule/schedule-grid";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const data = getData();
  const [games, entries, weeks] = await Promise.all([
    data.getSchedule(),
    data.getEntries(),
    data.getWeeks(),
  ]);
  const playWeek = currentPlayWeek(weeks, new Date());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">2026 schedule</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every matchup, all 18 weeks — @ marks a road game, dark cells are
          byes. Pick an entry to see which teams it has left and what they
          face.
        </p>
      </div>
      <ScheduleGrid
        games={games}
        entries={entries.map((e) => ({
          id: e.id,
          entryName: e.entryName,
          teamsUsed: e.teamsUsed,
          status: e.status,
        }))}
        currentWeek={playWeek?.week ?? null}
      />
    </div>
  );
}
