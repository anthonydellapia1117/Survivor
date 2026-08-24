import type { Metadata } from "next";
import Link from "next/link";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { GameBoard } from "@/components/schedule/game-board";
import { ScheduleGrid } from "@/components/schedule/schedule-grid";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function SchedulePage(props: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const { week: weekParam, view } = await props.searchParams;
  const data = getData();
  const [games, entries, cells, weeks] = await Promise.all([
    data.getSchedule(),
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
  ]);
  const playWeek = currentPlayWeek(weeks, new Date())?.week ?? 1;
  const week = Math.min(18, Math.max(1, Number(weekParam) || playWeek));
  const season = view === "season";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">
            {season ? "2026 season grid" : "Game board"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {season
              ? "Every matchup, all 18 weeks — @ marks a road game, dark cells are byes."
              : "Every game of the week — scores, who our entries picked, and what each result cost."}
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          <Link
            href={`/schedule?week=${week}`}
            className={
              !season
                ? "rounded-md bg-surface-2 px-3 py-1.5 font-medium"
                : "px-3 py-1.5 text-muted-foreground hover:text-foreground"
            }
          >
            Games
          </Link>
          <Link
            href={`/schedule?week=${week}&view=season`}
            className={
              season
                ? "rounded-md bg-surface-2 px-3 py-1.5 font-medium"
                : "px-3 py-1.5 text-muted-foreground hover:text-foreground"
            }
          >
            Season grid
          </Link>
        </div>
      </div>

      {season ? (
        <ScheduleGrid
          games={games}
          entries={entries.map((e) => ({
            id: e.id,
            entryName: e.entryName,
            teamsUsed: e.teamsUsed,
            status: e.status,
          }))}
          currentWeek={playWeek}
        />
      ) : (
        <GameBoard
          games={games}
          entries={entries}
          cells={cells}
          weeks={weeks}
          initialWeek={week}
        />
      )}
    </div>
  );
}
