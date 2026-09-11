"use client";

// How many entries picked each team, week by week, across whichever pool is
// showing.
//
// Set by Anthony on 2026-09-10, once results were being stored. The per-entry
// picker went with it: the question this page answers is what the POOL did,
// not what one entry has left, and a filter that shows one entry at a time
// cannot answer it. What is left is one number per team per week -
//
//   the count is over FINISHED games only, so a week still in play shows
//   nothing rather than a number that will move;
//   subtle green where that team won, yellow where it lost, and NEVER red -
//   red on this page would read as an elimination, and a team losing is not
//   one, it is a fact about a game.
//
// Every number is derived on the render from the cells and the schedule.
// Nothing here is stored.

import { useMemo } from "react";
import type { GameRow, GridCell } from "@/lib/data/types";
import { NFL_TEAMS, SKIP_WEEK } from "@/lib/standing";
import { teamResults } from "@/lib/master-list";
import { toneOfTeamResult, TONE_FILL_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { TeamLabel } from "@/components/team-label";
import { cn } from "@/lib/utils";

interface Props {
  cells: GridCell[];
  weekCount: number;
  games: GameRow[];
}

/** The cell values the grid uses for something other than a team. */
function isTeamPick(team: string): boolean {
  return team !== SKIP_WEEK && team !== "MISSED" && team !== "LOCKED";
}

export function TeamsClient({ cells, weekCount, games }: Props) {
  const results = useMemo(() => teamResults(games), [games]);

  // team -> week -> how many entries picked it, counting only weeks whose
  // game is final. A team absent from `results` for that week has no final
  // game, so it contributes no count and gets no fill.
  const heat = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const c of cells) {
      if (!isTeamPick(c.team)) continue;
      if (!results.has(`${c.week}:${c.team}`)) continue;
      if (!m.has(c.team)) m.set(c.team, new Map());
      const wm = m.get(c.team)!;
      wm.set(c.week, (wm.get(c.week) ?? 0) + 1);
    }
    return m;
  }, [cells, results]);

  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1);
  const total = useMemo(
    () => [...heat.values()].reduce((n, wm) => n + [...wm.values()].reduce((a, b) => a + b, 0), 0),
    [heat],
  );

  // The weekly total: how many picks across the pool that week carries, which
  // is the column read the other way and the one number the per-team cells
  // cannot give you (Anthony, 2026-09-11). Over FINISHED games only, exactly
  // like the cells above it, so a week still in play sums to nothing rather
  // than to a number that will move.
  const weekTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const wm of heat.values()) {
      for (const [w, n] of wm) m.set(w, (m.get(w) ?? 0) + n);
    }
    return m;
  }, [heat]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg">Picks by team and week</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How many entries picked each team, counting only games that have
          finished. Green is a team that won that week, yellow one that lost.
          A week still in play carries no number yet. The bottom row is each
          week&apos;s total across the pool.
        </p>
      </div>
      {total === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
          No finished game carries a pick yet. Numbers appear here as games go
          final.
        </p>
      ) : null}
      <div className="max-h-[70dvh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-muted-foreground">
                Team
              </th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className="sticky top-0 z-20 min-w-8 border-b border-border bg-surface-2 px-1 py-1.5 text-center font-medium text-muted-foreground"
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NFL_TEAMS.map((t) => (
              <tr key={t.abbr}>
                <td className="sticky left-0 z-10 border-b border-r border-border/60 bg-surface px-2 py-1 font-medium">
                  <TeamLabel abbr={t.abbr} />
                </td>
                {weeks.map((w) => {
                  const n = heat.get(t.abbr)?.get(w) ?? 0;
                  // The tone is the team's own result in that week, read off
                  // the stored score. No stored result, no fill - which is
                  // also every week the team did not play.
                  const tone = toneOfTeamResult(results.get(`${w}:${t.abbr}`));
                  return (
                    <td
                      key={w}
                      className={cn(
                        "h-8 min-w-8 border-b border-border/60 text-center font-semibold tabular-nums",
                        // The fill AND the number's colour: the fills sit about
                        // 1.1:1 apart on this palette, so on a phone in
                        // daylight the fill alone is not the difference this
                        // page says it is.
                        n > 0 && TONE_FILL_CLASS[tone],
                        n > 0 && TONE_TEXT_CLASS[tone],
                      )}
                      title={
                        n > 0
                          ? `${t.name} - week ${w}: ${n} ${n === 1 ? "entry" : "entries"}, ${tone === "won" ? "won" : "lost"}`
                          : `${t.name} - week ${w}`
                      }
                    >
                      {n > 0 ? n : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-20 border-r border-t border-border bg-surface-2 px-2 py-1 text-left font-semibold"
              >
                All teams
              </th>
              {weeks.map((w) => {
                const n = weekTotals.get(w) ?? 0;
                return (
                  <td
                    key={w}
                    className="sticky bottom-0 z-10 h-8 min-w-8 border-t border-border bg-surface-2 text-center font-semibold tabular-nums"
                    title={
                      n > 0
                        ? `Week ${w}: ${n} ${n === 1 ? "pick" : "picks"} across the pool, over finished games`
                        : `Week ${w}: no finished game carries a pick yet`
                    }
                  >
                    {n > 0 ? n : ""}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
