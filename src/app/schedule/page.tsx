import type { Metadata } from "next";
import Link from "next/link";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { scoreFromGames } from "@/lib/live-standing";
import { poolAsEntries } from "@/lib/master-list";
import { ScopeToggle, scopeFrom } from "@/components/scope-toggle";
import { GameBoard } from "@/components/schedule/game-board";
import { ScheduleGrid } from "@/components/schedule/schedule-grid";
import { WindowLegend } from "@/components/schedule/window-legend";

export const metadata: Metadata = { title: "Schedule" };
// Rendered on every request: scores and her sheet move.
export const revalidate = 0;

export default async function SchedulePage(props: {
  searchParams: Promise<{ week?: string; view?: string; scope?: string }>;
}) {
  const { week: weekParam, view, scope: scopeParam } = await props.searchParams;
  const data = getData();
  const [games, storedEntries, storedCells, weeks, master] = await Promise.all([
    data.getSchedule(),
    data.getEntries(),
    data.getGridCells(),
    data.getWeeks(),
    data.getMasterList(),
  ]);
  // What a final game COST is read from the scores, not only from her file,
  // and for the WHOLE POOL by default (Anthony, 2026-09-15): a viewer's
  // count of who a game eliminated is her sheet's, our group's only when the
  // toggle says so.
  const ours = scoreFromGames(storedEntries, storedCells, games);
  const poolLoaded = master.rows.length > 0;
  const scope = scopeFrom(scopeParam, poolLoaded);
  const { entries, cells } = scope === "pool" ? poolAsEntries(master, games) : ours;
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
              ? "Every matchup, all 18 weeks - @ marks a road game, dark cells are byes."
              // The per-team pick counts came off on 2026-09-11 and this line
              // still promised them. What the card can say is what the result
              // COST; who picked what is the Teams page's question.
              : "Every game of the week - scores, and what each final result cost."}
          </p>
        </div>
        <div className="flex rounded-md border border-border bg-surface p-0.5 text-[11px] leading-4">
          <Link
            href={`/schedule?week=${week}`}
            className={
              !season
                ? "rounded bg-surface-2 px-2 py-0.5 font-medium"
                : "px-2 py-0.5 text-muted-foreground hover:text-foreground"
            }
          >
            Games
          </Link>
          <Link
            href={`/schedule?week=${week}&view=season`}
            className={
              season
                ? "rounded bg-surface-2 px-2 py-0.5 font-medium"
                : "px-2 py-0.5 text-muted-foreground hover:text-foreground"
            }
          >
            Season grid
          </Link>
        </div>
      </div>

      {!season ? (
        <ScopeToggle
          scope={scope}
          poolCount={poolLoaded ? master.rows.length : null}
          oursCount={ours.entries.length}
          path="/schedule"
          params={{ week: weekParam }}
        />
      ) : null}

      <WindowLegend />

      {season ? (
        <ScheduleGrid games={games} weeks={weeks} currentWeek={playWeek} />
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
