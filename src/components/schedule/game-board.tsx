"use client";

// D1-D4: the week-by-week game board. Every game as a card — winners and
// losers visually distinct, pick counts revealed once that game's own
// deadline passes, and elimination impact per final game.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntrySummary, GameRow, GridCell, WeekRow } from "@/lib/data/types";
import { TEAM_NAME } from "@/lib/standing";
import { TEAM_PALETTE } from "@/lib/team-colors";
import { eliminationWeekOf } from "@/lib/alive";
import { cn } from "@/lib/utils";

const EARLY_DAYS = new Set(["Wednesday", "Thursday", "Friday"]);

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

export function GameBoard({
  games,
  entries,
  cells,
  weeks,
  initialWeek,
}: {
  games: GameRow[];
  entries: EntrySummary[];
  cells: GridCell[];
  weeks: WeekRow[];
  initialWeek: number;
}) {
  const router = useRouter();
  const [week, setWeek] = useState(initialWeek);
  const [expanded, setExpanded] = useState<string | null>(null);
  const now = Date.now();

  const weekRow = weeks.find((w) => w.week === week);
  const weekGames = useMemo(
    () => games.filter((g) => g.week === week),
    [games, week],
  );

  const nameById = useMemo(
    () => new Map(entries.map((e) => [e.id, e.entryName])),
    [entries],
  );

  // Current picks for the selected week, keyed by team.
  const pickersByTeam = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of cells) {
      if (c.week !== week || c.team === "SKIP_WEEK" || c.team === "MISSED") continue;
      if (!m.has(c.team)) m.set(c.team, []);
      m.get(c.team)!.push(nameById.get(c.entryId) ?? "?");
    }
    return m;
  }, [cells, week, nameById]);

  // Entries this game eliminated: losing-side pickers whose elimination
  // week is this week.
  const elimByTeam = useMemo(() => {
    const byEntry = new Map<string, GridCell[]>();
    for (const c of cells) {
      if (!byEntry.has(c.entryId)) byEntry.set(c.entryId, []);
      byEntry.get(c.entryId)!.push(c);
    }
    const m = new Map<string, string[]>();
    for (const e of entries) {
      if (e.status !== "eliminated") continue;
      const ew = eliminationWeekOf(byEntry.get(e.id) ?? []);
      if (ew !== week) continue;
      const killCell = (byEntry.get(e.id) ?? []).find(
        (c) =>
          c.week === week &&
          (c.result === "loss" || c.result === "tie_loss"),
      );
      if (!killCell) continue;
      if (!m.has(killCell.team)) m.set(killCell.team, []);
      m.get(killCell.team)!.push(e.entryName);
    }
    return m;
  }, [cells, entries, week]);

  function gameDeadlinePassed(g: GameRow): boolean {
    if (!weekRow) return false;
    const dl =
      week === 1 || EARLY_DAYS.has(g.dayOfWeek)
        ? weekRow.earlyDeadlineAt
        : weekRow.lateDeadlineAt;
    return new Date(dl).getTime() <= now;
  }

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

      <div className="grid gap-3 md:grid-cols-2">
        {weekGames.map((g) => {
          const revealed = gameDeadlinePassed(g);
          const homePickers = pickersByTeam.get(g.homeTeam) ?? [];
          const awayPickers = pickersByTeam.get(g.awayTeam) ?? [];
          const elim = [
            ...(elimByTeam.get(g.homeTeam) ?? []),
            ...(elimByTeam.get(g.awayTeam) ?? []),
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
                    TIE — a loss in this pool
                  </span>
                ) : g.status === "in_progress" ? (
                  <span className="font-semibold text-primary">LIVE</span>
                ) : null}
              </p>

              <div className="space-y-1">
                {row(g.awayTeam, g.awayScore, awayWon)}
                {row(g.homeTeam, g.homeScore, homeWon)}
              </div>

              <div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                {revealed ? (
                  awayPickers.length + homePickers.length > 0 ? (
                    <p>
                      {awayPickers.length > 0
                        ? `${awayPickers.length} picked ${g.awayTeam}`
                        : null}
                      {awayPickers.length > 0 && homePickers.length > 0
                        ? " · "
                        : null}
                      {homePickers.length > 0
                        ? `${homePickers.length} picked ${g.homeTeam}`
                        : null}
                    </p>
                  ) : (
                    <p>No entries on this game.</p>
                  )
                ) : (
                  <p>Pick counts hidden until this game&apos;s deadline.</p>
                )}

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
