"use client";

// Team-by-week schedule grid, survivorgrid-style: 32 team rows, 18 week
// columns, opponent in each cell.
//
// THE SCHEDULE, AND ONLY THE SCHEDULE (Anthony, 2026-09-11). The entry
// selector and the per-team usage count came off together: how many entries
// have used a team is a question about the POOL, the Teams page answers it
// properly week by week, and answering it a second way here meant two numbers
// that could disagree. What is left is where each team plays, when, and which
// deadline that day carries.

import { useMemo } from "react";
import type { GameRow, WeekRow } from "@/lib/data/types";
import { NFL_TEAMS, TEAM_NAME } from "@/lib/standing";
import { TEAM_COLOR } from "@/lib/team-colors";
import { cn } from "@/lib/utils";
import { deadlineTier, pickDeadlineIso, TIER_LABEL } from "@/lib/deadlines";
import { formatDeadline } from "@/lib/format";
import { gameWindow, WINDOW_CELL_CLASS, WINDOW_TEXT_CLASS } from "@/lib/game-window";

interface CellGame {
  opp: string;
  home: boolean;
  day: GameRow["dayOfWeek"];
  kickoffAt: string;
}

const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
// Every game carries a day tag. Leaving Sunday implicit made a filled cell
// look like missing data; an explicit "Su" reads as data.
const DAY_TAG: Record<string, string> = {
  Wednesday: "We",
  Thursday: "Th",
  Friday: "Fr",
  Saturday: "Sa",
  Sunday: "Su",
  Monday: "Mo",
};
// Which deadline a game day carries lives in one place, shared with the SQL
// side; the grid only decides how loudly to draw it. Wed/Thu/Fri each close a
// day apart, Sat-Mon share the Friday cutoff.

function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ScheduleGrid({
  games,
  weeks,
  currentWeek,
}: {
  games: GameRow[];
  /** The stored boundaries, so a tooltip states the real time and never a literal hour. */
  weeks: WeekRow[];
  currentWeek: number | null;
}) {
  const boundsByWeek = useMemo(() => new Map(weeks.map((w) => [w.week, w])), [weeks]);

  const byTeam = useMemo(() => {
    const m = new Map<string, Map<number, CellGame>>();
    for (const t of NFL_TEAMS) m.set(t.abbr, new Map());
    for (const g of games) {
      m.get(g.homeTeam)?.set(g.week, {
        opp: g.awayTeam,
        home: true,
        day: g.dayOfWeek,
        kickoffAt: g.kickoffAt,
      });
      m.get(g.awayTeam)?.set(g.week, {
        opp: g.homeTeam,
        home: false,
        day: g.dayOfWeek,
        kickoffAt: g.kickoffAt,
      });
    }
    return m;
  }, [games]);

  /** "Friday September 11, 2:00 PM ET" for the tier that game day closes on. */
  function deadlineLabel(week: number, day: GameRow["dayOfWeek"]): string {
    const b = boundsByWeek.get(week);
    if (!b) return `${TIER_LABEL[deadlineTier(day)]} - deadline not stored`;
    return formatDeadline(pickDeadlineIso(day, b.earlyDeadlineAt, b.lateDeadlineAt));
  }

  return (
    <div className="space-y-3">
      <div className="relative max-h-[75dvh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[7rem] border-b border-r border-border bg-surface-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground sm:min-w-[8.5rem]">
                Team
              </th>
              {WEEKS.map((w) => (
                <th
                  key={w}
                  className={cn(
                    "sticky top-0 z-20 h-11 min-w-11 border-b border-border bg-surface-2 px-1 text-center text-xs font-medium",
                    w === currentWeek
                      ? "text-primary shadow-[inset_0_-2px_0_var(--color-primary)]"
                      : "text-muted-foreground",
                  )}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NFL_TEAMS.map((t) => {
              const row = byTeam.get(t.abbr)!;
              return (
                <tr key={t.abbr}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r border-border/60 bg-surface px-3 text-left font-medium"
                    title={TEAM_NAME[t.abbr]}
                  >
                    <span className="flex h-11 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-5 w-1 shrink-0 rounded-full"
                        style={{ background: TEAM_COLOR[t.abbr] }}
                      />
                      <span>{t.abbr}</span>
                    </span>
                  </th>
                  {WEEKS.map((w) => {
                    const g = row.get(w);
                    if (!g) {
                      return (
                        <td
                          key={w}
                          className="h-11 min-w-11 border-b border-border/40 bg-black/30 text-center"
                          aria-label={`${t.abbr} week ${w}: bye`}
                        />
                      );
                    }
                    const tag = DAY_TAG[g.day] ?? g.day.slice(0, 2);
                    // The cell's colour is its game window: TNF amber, SNF,
                    // MNF, Wed/Fri/Sat; a Sunday daytime game stays plain.
                    const win = gameWindow({ dayOfWeek: g.day, kickoffAt: g.kickoffAt });
                    return (
                      <td
                        key={w}
                        className={cn(
                          "h-11 min-w-11 border-b border-border/40 px-1 text-center text-xs tabular-nums",
                          win !== null && WINDOW_CELL_CLASS[win],
                          w === currentWeek && win === null && "bg-primary/[0.07]",
                        )}
                        // The stored boundary, never a written-down hour: this
                        // read "noon ET" for two days after every deadline of
                        // all eighteen weeks moved to 2 PM (2026-09-09), and a
                        // literal would go stale again the next time it moves.
                        title={`${g.home ? "vs" : "@"} ${TEAM_NAME[g.opp]} - ${kickoffLabel(g.kickoffAt)} ET · picks close ${deadlineLabel(w, g.day)}`}
                      >
                        <span className={cn(!g.home && "text-muted-foreground")}>
                          {g.home ? "" : "@"}
                          {g.opp}
                        </span>
                        <span
                          className={cn(
                            "ml-0.5 align-super text-[9px]",
                            win !== null ? cn("font-semibold", WINDOW_TEXT_CLASS[win]) : "text-muted-foreground/70",
                          )}
                        >
                          {tag}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Every game carries its day (We/Th/Fr/Sa/Su/Mo) and is coloured by its
        window - TNF, SNF, MNF, Wed/Fri/Sat; Sunday daytime stays plain. The
        deadline follows the day the team plays, in every week, Week 1
        included: We, Th and Fr close a day apart, Sa/Su/Mo share the Friday
        cutoff. Tap a cell for kickoff time and the exact deadline.
      </p>
    </div>
  );
}
