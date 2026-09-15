"use client";

// How many entries picked each team, week by week, across whichever pool is
// showing.
//
// Set by Anthony on 2026-09-10, once results were being stored, and changed
// by him on 2026-09-13. The per-entry picker went with the first change: the
// question this page answers is what the POOL did, not what one entry has
// left, and a filter that shows one entry at a time cannot answer it. What
// is left is one number per team per week -
//
//   the count appears as soon as the WEEK's pick deadline has passed, read
//   from the weeks table, never hardcoded. From that moment the full board
//   shows: every team with at least one pick, whether its game is scheduled,
//   in progress or final. Before the deadline the counts stay hidden - a
//   published count before picks lock is strategic information and would
//   change what undecided players choose;
//   the count is every live entry in the pool that picked that team that
//   week. It comes from v_team_pick_counts, an aggregate that names nobody,
//   so it does not wait on the per-pick reveal gate - the Grid's cells keep
//   their kickoff-based reveal exactly as it is;
//   subtle green where that team won, yellow where it lost, NO FILL where
//   the game is not final, and NEVER red - red on this page would read as an
//   elimination, and a team losing is not one, it is a fact about a game.
//
// Every number is derived on the render from the counts, the weeks and the
// schedule. Nothing here is stored.

import { useMemo } from "react";
import type { GameRow, TeamPickCount, WeekRow } from "@/lib/data/types";
import { NFL_TEAMS } from "@/lib/standing";
import { teamResults } from "@/lib/master-list";
import { teamHeat } from "@/lib/team-counts";
import { toneOfTeamResult, TONE_FILL_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { TeamLabel } from "@/components/team-label";
import { cn } from "@/lib/utils";

interface Props {
  /** One scope's counts, every locked week. */
  counts: Pick<TeamPickCount, "week" | "team" | "n">[];
  weeks: WeekRow[];
  games: GameRow[];
  /** How many entries the scope holds, for the empty-state sentence. */
  entryCount: number;
  /** The scope's exact word - "Everyone" or "Our group" - for the captions that name it. */
  scopeLabel?: string;
  /** The render's clock; a test hands one in, the page takes now. */
  now?: Date;
}

export function TeamsClient({ counts, weeks, games, entryCount, scopeLabel = "Everyone", now }: Props) {
  const results = useMemo(() => teamResults(games), [games]);
  // The board: team -> week -> count, held to the weeks that have locked. The
  // view is the gate and this is the guard behind it.
  const heat = useMemo(() => teamHeat(counts, weeks, now ?? new Date()), [counts, weeks, now]);
  const weekNumbers = weeks.map((w) => w.week).sort((a, b) => a - b);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg">Picks by team and week</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How many entries picked each team, shown once the week&apos;s picks
          have locked. Green is a team that won that week, yellow one that
          lost; a game not yet final shows its count with no colour. A week
          still open carries no number. The bottom row is each week&apos;s
          total for {scopeLabel}.
        </p>
      </div>
      {heat.total === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
          {entryCount > 0
            ? "No week has locked yet. Numbers appear here the moment a week's picks close."
            : "No entries in this scope yet."}
        </p>
      ) : null}
      <div className="max-h-[70dvh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-muted-foreground">
                Team
              </th>
              {weekNumbers.map((w) => (
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
                {weekNumbers.map((w) => {
                  const n = heat.byTeam.get(t.abbr)?.get(w) ?? 0;
                  // The tone is the team's own result in that week, read off
                  // the stored FINAL score: teamResults carries a team only
                  // once its game is final, and toneOfTeamResult gives an
                  // absent result no fill. So a count on a game not yet
                  // final shows with no colour, and nothing here guesses one.
                  const result = results.get(`${w}:${t.abbr}`);
                  const tone = toneOfTeamResult(result);
                  const state = result === undefined ? "not final" : tone === "won" ? "won" : "lost";
                  return (
                    <td
                      key={w}
                      className={cn(
                        "h-8 min-w-8 border-b border-border/60 text-center font-semibold tabular-nums",
                        // The fill AND the number's colour: the fills sit about
                        // 1.1:1 apart on this palette, so on a phone in
                        // daylight the fill alone is not the difference this
                        // page says it is. Both only with a final result.
                        n > 0 && TONE_FILL_CLASS[tone],
                        n > 0 && TONE_TEXT_CLASS[tone],
                      )}
                      title={
                        n > 0
                          ? `${t.name} - week ${w}: ${n} ${n === 1 ? "entry" : "entries"}, ${state}`
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
              {weekNumbers.map((w) => {
                const n = heat.byWeek.get(w) ?? 0;
                return (
                  <td
                    key={w}
                    className="sticky bottom-0 z-10 h-8 min-w-8 border-t border-border bg-surface-2 text-center font-semibold tabular-nums"
                    title={
                      n > 0
                        ? `Week ${w}: ${n} ${n === 1 ? "pick" : "picks"}, ${scopeLabel}`
                        : `Week ${w}: not locked yet`
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
