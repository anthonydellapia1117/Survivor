"use client";

import { useMemo, useState } from "react";
import type { EntrySummary, GameRow, GridCell } from "@/lib/data/types";
import { NFL_TEAMS, SKIP_WEEK, STATUS_ORDER } from "@/lib/standing";
import { matchesShowMode, showCounts } from "@/lib/alive";
import { ShowToggle, useShowMode } from "@/components/show-toggle";
import { StatusDot } from "@/components/status-dot";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  entries: EntrySummary[];
  cells: GridCell[];
  weekCount: number;
  games: GameRow[];
}

export function TeamsClient({ entries, cells, weekCount, games }: Props) {
  const [mode, setMode] = useShowMode();
  const counts = useMemo(() => showCounts(entries), [entries]);
  const sorted = useMemo(
    () =>
      [...entries]
        .filter((e) => matchesShowMode(e.status, mode))
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            a.entryName.localeCompare(b.entryName),
        ),
    [entries, mode],
  );
  const [entryId, setEntryId] = useState<string>(sorted[0]?.id ?? "");
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const selected = sorted.find((e) => e.id === entryId) ?? sorted[0];

  // team -> week it was used by each entry (first current pick of that team)
  const usedByEntry = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of cells) {
      if (c.team === SKIP_WEEK || c.team === "MISSED" || c.team === "LOCKED") continue;
      if (!m.has(c.entryId)) m.set(c.entryId, new Map());
      const tm = m.get(c.entryId)!;
      if (!tm.has(c.team) || c.week < tm.get(c.team)!) tm.set(c.team, c.week);
    }
    return m;
  }, [cells]);

  // team -> week -> count of current picks
  const heat = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    let max = 1;
    for (const c of cells) {
      if (c.team === SKIP_WEEK || c.team === "MISSED" || c.team === "LOCKED") continue;
      if (!m.has(c.team)) m.set(c.team, new Map());
      const wm = m.get(c.team)!;
      const n = (wm.get(c.week) ?? 0) + 1;
      wm.set(c.week, n);
      if (n > max) max = n;
    }
    return { m, max };
  }, [cells]);

  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1);
  const used = usedByEntry.get(selected?.id ?? "") ?? new Map<string, number>();
  const selectedOut = selected?.status === "eliminated";

  const upcomingFor = (abbr: string) =>
    games
      .filter((g) => g.homeTeam === abbr || g.awayTeam === abbr)
      .map((g) => ({
        week: g.week,
        opp: g.homeTeam === abbr ? g.awayTeam : g.homeTeam,
        home: g.homeTeam === abbr,
        day: g.dayOfWeek,
      }));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg">Availability</h2>
          <ShowToggle mode={mode} counts={counts} onChange={setMode} />
          <Select value={selected?.id ?? ""} onValueChange={setEntryId}>
            <SelectTrigger size="sm" className="w-56" aria-label="Choose entry">
              <SelectValue placeholder="Pick an entry" />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="flex items-center gap-2">
                    <StatusDot status={e.status} />
                    <span className={e.status === "eliminated" ? "line-through opacity-70" : undefined}>
                      {e.entryName}
                    </span>
                    {e.status === "eliminated" ? (
                      <span className="text-[10px] font-semibold text-loss">OUT</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {NFL_TEAMS.length - used.size} teams left
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {NFL_TEAMS.map((t) => {
            const usedWeek = used.get(t.abbr);
            const isUsed = usedWeek !== undefined;
            return (
              <button
                key={t.abbr}
                type="button"
                title={isUsed ? `${t.name} — used week ${usedWeek}` : `${t.name} — upcoming matchups`}
                onClick={() =>
                  isUsed ? undefined : setOpenTeam((v) => (v === t.abbr ? null : t.abbr))
                }
                className={cn(
                  "rounded-sm border px-2 py-2 text-center text-xs font-medium",
                  isUsed || selectedOut
                    ? "border-border bg-surface-2 text-muted-foreground line-through opacity-60"
                    : "border-border bg-surface hover:border-primary/60",
                  openTeam === t.abbr && !isUsed && "border-primary",
                )}
              >
                {t.abbr}
                {isUsed ? (
                  <span className="block text-[9px] font-normal no-underline">WK {usedWeek}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {selectedOut ? (
          <p className="text-xs text-loss">
            This entry is out — its remaining teams no longer matter and render struck.
          </p>
        ) : null}
        {openTeam && !used.has(openTeam) ? (
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
            <span className="font-semibold">{openTeam}</span>{" "}
            <span className="text-muted-foreground">upcoming:</span>{" "}
            {upcomingFor(openTeam)
              .map((m) => `W${m.week} ${m.home ? "" : "@"}${m.opp}`)
              .join(" · ") || "season complete"}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg">League heatmap</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How many entries picked each team, by week.
          </p>
        </div>
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
                    {t.abbr}
                  </td>
                  {weeks.map((w) => {
                    const n = heat.m.get(t.abbr)?.get(w) ?? 0;
                    return (
                      <td
                        key={w}
                        className="h-8 min-w-8 border-b border-border/60 text-center tabular-nums"
                        style={
                          n > 0
                            ? {
                                backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(
                                  15 + (n / heat.max) * 60,
                                )}%, transparent)`,
                              }
                            : undefined
                        }
                        title={`${t.name} — week ${w}: ${n}`}
                      >
                        {n > 0 ? n : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
