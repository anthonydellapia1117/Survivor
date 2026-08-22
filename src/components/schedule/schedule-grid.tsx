"use client";

// Team-by-week schedule grid, survivorgrid-style: 32 team rows, 18 week
// columns, opponent in each cell. An entry selector strikes out the teams
// that entry has burned; "All entries" shows how many entries have used
// each team instead.

import { useMemo, useState } from "react";
import type { GameRow } from "@/lib/data/types";
import { NFL_TEAMS, TEAM_NAME } from "@/lib/standing";
import { TEAM_COLOR } from "@/lib/team-colors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface SlimEntry {
  id: string;
  entryName: string;
  teamsUsed: string[];
  status: string;
}

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
// Wed/Thu/Fri games lock at the early (Wednesday noon) deadline.
const EARLY_DAYS = new Set(["Wednesday", "Thursday", "Friday"]);

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
  entries,
  currentWeek,
}: {
  games: GameRow[];
  entries: SlimEntry[];
  currentWeek: number | null;
}) {
  const [entryId, setEntryId] = useState<string>("all");

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

  const heat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      for (const t of e.teamsUsed) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [entries]);

  const selected = entries.find((e) => e.id === entryId) ?? null;
  const used = useMemo(
    () => new Set(selected?.teamsUsed ?? []),
    [selected],
  );

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => a.entryName.localeCompare(b.entryName)),
    [entries],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={entryId} onValueChange={setEntryId}>
          <SelectTrigger size="sm" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entries — teams-used heat</SelectItem>
            {sorted.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.entryName}
                {e.status === "eliminated" ? " (eliminated)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {selected ? (
            <>
              <span className="font-medium text-foreground">
                {32 - used.size}
              </span>{" "}
              teams left for {selected.entryName} — struck rows are burned.
            </>
          ) : (
            "The count beside each team is how many entries have used it."
          )}
        </p>
      </div>

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
              const burned = selected !== null && used.has(t.abbr);
              const count = heat.get(t.abbr) ?? 0;
              return (
                <tr key={t.abbr} className={cn(burned && "opacity-40")}>
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
                      <span className={cn(burned && "line-through")}>
                        {t.abbr}
                      </span>
                      {selected === null && count > 0 ? (
                        <span
                          className={cn(
                            "ml-auto rounded px-1 text-[10px] font-semibold tabular-nums",
                            count >= 8
                              ? "bg-loss/25 text-loss"
                              : count >= 4
                                ? "bg-tie/25 text-tie"
                                : "bg-surface-2 text-muted-foreground",
                          )}
                          title={`${count} ${count === 1 ? "entry has" : "entries have"} used ${t.abbr}`}
                        >
                          {count}
                        </span>
                      ) : null}
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
                    const early = EARLY_DAYS.has(g.day);
                    return (
                      <td
                        key={w}
                        className={cn(
                          "h-11 min-w-11 border-b border-border/40 px-1 text-center text-xs tabular-nums",
                          w === currentWeek && "bg-primary/[0.07]",
                          burned && "line-through",
                        )}
                        title={`${g.home ? "vs" : "@"} ${TEAM_NAME[g.opp]} — ${kickoffLabel(g.kickoffAt)} ET · ${
                          early ? "Wednesday" : "Friday"
                        } noon deadline`}
                      >
                        <span className={cn(!g.home && "text-muted-foreground")}>
                          {g.home ? "" : "@"}
                          {g.opp}
                        </span>
                        <span
                          className={cn(
                            "ml-0.5 align-super text-[9px]",
                            // Early-window days carry the tighter deadline, so
                            // they stay visually louder than the Sat-Mon days.
                            early
                              ? "font-semibold text-tie"
                              : "text-muted-foreground/70",
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
        Every game carries its day (We/Th/Fr/Sa/Su/Mo).{" "}
        <span className="font-semibold text-tie">Amber</span> days —
        We/Th/Fr — lock at the early deadline, Wednesday noon ET; grey days —
        Sa/Su/Mo — lock Friday noon ET. All of Week 1 locks Tuesday Sep 8,
        noon ET regardless of day. Hover a cell for kickoff time and which
        deadline applies.
      </p>
    </div>
  );
}
