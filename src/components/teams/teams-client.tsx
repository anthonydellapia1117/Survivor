"use client";

import { useMemo, useState } from "react";
import type { EntrySummary, GridCell } from "@/lib/data/types";
import { NFL_TEAMS, SKIP_WEEK, STATUS_ORDER } from "@/lib/standing";
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
}

export function TeamsClient({ entries, cells, weekCount }: Props) {
  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.entryName.localeCompare(b.entryName),
      ),
    [entries],
  );
  const [entryId, setEntryId] = useState<string>(sorted[0]?.id ?? "");
  const selected = sorted.find((e) => e.id === entryId) ?? sorted[0];

  const usedByEntry = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of cells) {
      if (c.team === SKIP_WEEK || c.team === "MISSED") continue;
      if (!m.has(c.entryId)) m.set(c.entryId, new Set());
      m.get(c.entryId)!.add(c.team);
    }
    return m;
  }, [cells]);

  // team -> week -> count of current picks
  const heat = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    let max = 1;
    for (const c of cells) {
      if (c.team === SKIP_WEEK || c.team === "MISSED") continue;
      if (!m.has(c.team)) m.set(c.team, new Map());
      const wm = m.get(c.team)!;
      const n = (wm.get(c.week) ?? 0) + 1;
      wm.set(c.week, n);
      if (n > max) max = n;
    }
    return { m, max };
  }, [cells]);

  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1);
  const used = usedByEntry.get(selected?.id ?? "") ?? new Set<string>();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg">Availability</h2>
          <Select value={selected?.id ?? ""} onValueChange={setEntryId}>
            <SelectTrigger size="sm" className="w-56" aria-label="Choose entry">
              <SelectValue placeholder="Pick an entry" />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="flex items-center gap-2">
                    <StatusDot status={e.status} />
                    {e.entryName}
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
            const isUsed = used.has(t.abbr);
            return (
              <span
                key={t.abbr}
                title={t.name}
                className={cn(
                  "rounded-sm border px-2 py-2 text-center text-xs font-medium",
                  isUsed
                    ? "border-border bg-surface-2 text-muted-foreground line-through opacity-60"
                    : "border-border bg-surface",
                )}
              >
                {t.abbr}
              </span>
            );
          })}
        </div>
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
