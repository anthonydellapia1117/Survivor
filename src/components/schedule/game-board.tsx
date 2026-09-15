"use client";

// The week-by-week game board. Every game as a card - winners and losers
// visually distinct, and what each final game COST: the entries it eliminated.
//
// The per-team pick count came off on 2026-09-11 (Anthony). With it went the
// reveal plumbing it needed: the elimination list is built only from cells
// already carrying a loss or a tie, which cannot exist before the game is
// scored, so nothing here can show a pick early.
//
// The elimination list shows the WHOLE POOL by default and our group only
// under the same Everyone / Our group toggle the one table uses (Anthony,
// 2026-09-15). Both lists are computed on the server by eliminationsByWeek
// over the one shape both scopes produce, and arrive here as plain data.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameRow, WeekRow } from "@/lib/data/types";
import type { EliminationsByWeek } from "@/lib/dashboard";
import type { TeamsSourceKind as Source } from "@/lib/master-list";
import { TEAM_NAME } from "@/lib/standing";
import { TEAM_PALETTE } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

function kickoffLabel(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

export interface EliminationScopes {
  /** Every row of her newest sheet; null when no sheet is loaded. */
  pool: { eliminated: EliminationsByWeek; count: number } | null;
  ours: { eliminated: EliminationsByWeek; count: number };
}

export function GameBoard({
  games,
  eliminations,
  weeks,
  initialWeek,
}: {
  games: GameRow[];
  eliminations: EliminationScopes;
  weeks: WeekRow[];
  initialWeek: number;
}) {
  const router = useRouter();
  const [week, setWeek] = useState(initialWeek);
  const [expanded, setExpanded] = useState<string | null>(null);
  const poolLoaded = eliminations.pool !== null;
  const [source, setSource] = useState<Source>(poolLoaded ? "pool" : "ours");
  const weekGames = useMemo(
    () => games.filter((g) => g.week === week),
    [games, week],
  );

  // Entries this game eliminated, in the scope showing: losing-side pickers
  // whose elimination week is this week.
  const scope = source === "pool" && eliminations.pool ? eliminations.pool : eliminations.ours;
  const elimByTeam = scope.eliminated[week] ?? {};
  const options: { key: Source; label: string; n: number; disabled?: boolean }[] = [
    { key: "pool", label: "Everyone", n: eliminations.pool?.count ?? 0, disabled: !poolLoaded },
    { key: "ours", label: "Our group", n: eliminations.ours.count },
  ];

  function changeWeek(w: number) {
    setWeek(w);
    setExpanded(null);
    const params = new URLSearchParams(window.location.search);
    params.set("week", String(w));
    router.replace(`?${params}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
        {weeks.map((w) => (
          <button
            key={w.week}
            type="button"
            onClick={() => changeWeek(w.week)}
            className={cn(
              "h-9 min-w-11 shrink-0 rounded-md px-2.5 text-sm font-medium tabular-nums transition-colors duration-150",
              w.week === week
                ? "bg-primary text-primary-foreground"
                : w.week === initialWeek
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {w.week}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label="Everyone or our group"
          className="inline-flex rounded-lg border border-border bg-surface p-0.5"
        >
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={source === o.key}
              disabled={o.disabled}
              onClick={() => setSource(o.key)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150 disabled:opacity-50",
                source === o.key ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
              <span className="tabular-nums opacity-70">{o.n.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {source === "pool" && poolLoaded
            ? "Entries a final eliminated, across every row of her newest sheet."
            : "Entries a final eliminated, Our group only."}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {weekGames.map((g) => {
          const elim = [
            ...(elimByTeam[g.homeTeam] ?? []),
            ...(elimByTeam[g.awayTeam] ?? []),
          ];
          const final = g.status === "final";
          const tie =
            final && g.homeScore !== null && g.homeScore === g.awayScore;
          const homeWon = final && !tie && (g.homeScore ?? 0) > (g.awayScore ?? 0);
          const awayWon = final && !tie && !homeWon;

          const row = (team: string, score: number | null, won: boolean) => {
            const p = TEAM_PALETTE[team];
            const lost = final && !won && !tie;
            return (
              <div
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5",
                  won && "border-l-2 border-win bg-win/5",
                  tie && "border-l-2 border-tie bg-tie/5",
                  lost && "opacity-60",
                )}
              >
                <span
                  aria-hidden
                  className="h-5 w-1.5 shrink-0 rounded-full"
                  style={{ background: p?.display }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wide"
                  style={{ color: p?.display }}
                >
                  {TEAM_NAME[team] ?? team}
                </span>
                {final ? (
                  <span
                    className={cn(
                      "text-lg tabular-nums",
                      won ? "font-bold" : "text-muted-foreground",
                      tie && "text-tie",
                    )}
                  >
                    {score}
                  </span>
                ) : null}
                {won ? (
                  <span className="text-sm font-semibold text-win">✓ WON</span>
                ) : null}
              </div>
            );
          };

          return (
            <div
              key={g.id}
              className={cn(
                "rounded-lg border bg-surface p-3",
                g.status === "in_progress"
                  ? "animate-pulse border-primary/60"
                  : "border-border",
              )}
            >
              <p className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{kickoffLabel(g.kickoffAt)} ET</span>
                {tie ? (
                  <span className="font-bold text-tie">
                    TIE - a loss in this pool
                  </span>
                ) : g.status === "in_progress" ? (
                  <span className="font-semibold text-primary">LIVE</span>
                ) : g.network ? (
                  <span className="rounded-sm border border-border px-1.5 py-0.5 font-semibold tracking-wide">
                    {g.network}
                  </span>
                ) : null}
              </p>

              <div className="space-y-1">
                {row(g.awayTeam, g.awayScore, awayWon)}
                {row(g.homeTeam, g.homeScore, homeWon)}
              </div>

              {/* The per-team pick count came off on 2026-09-11: how many
                  entries took a team is a question about the POOL, and the
                  Teams page answers it week by week for all 32. Two places
                  counting the same thing is two numbers that can disagree.
                  What stays is what only this card can say - what the result
                  COST, which is the elimination list below. */}
              <div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                {elim.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((v) => (v === g.id ? null : g.id))
                    }
                    className="mt-1 font-semibold text-loss"
                  >
                    ⚠ {elim.length} {elim.length === 1 ? "entry" : "entries"}{" "}
                    eliminated {expanded === g.id ? "▾" : "▸"}
                  </button>
                ) : null}
                {expanded === g.id && elim.length > 0 ? (
                  <p className="mt-1 text-loss/90">{elim.join(" · ")}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {weekGames.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No games this week.
        </p>
      ) : null}
    </div>
  );
}
