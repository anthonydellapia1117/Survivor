"use client";

// Which pool the Teams page reads: everyone (every entry in the
// master pool, from the published sheet) or our group (our recorded picks).
// The whole pool is the default once she has published a week's picks,
// because that is what the group wants to see; until then our group stands
// in and says so. The choice is view state only.

import { useState } from "react";
import type { EntrySummary, GameRow, GridCell, TeamPickCount, WeekRow } from "@/lib/data/types";
import { defaultTeamsSource, type TeamsSourceKind as Source } from "@/lib/master-list";
import { TeamsClient } from "@/components/teams/teams-client";
import { cn } from "@/lib/utils";

interface Dataset {
  entries: EntrySummary[];
  cells: GridCell[];
}

interface Props {
  ours: Dataset;
  pool: Dataset;
  /** The master pool's sheet is loaded (rows exist). */
  poolLoaded: boolean;
  /** The sheet carries at least one week pick, revealed or counted. */
  poolHasPicks: boolean;
  /** Both scopes' counts for every locked week, from v_team_pick_counts. */
  counts: TeamPickCount[];
  weeks: WeekRow[];
  games: GameRow[];
}

export function TeamsSource({ ours, pool, counts, poolLoaded, poolHasPicks, weeks, games }: Props) {
  const [source, setSource] = useState<Source>(defaultTeamsSource(poolLoaded, poolHasPicks));
  const active = source === "pool" ? pool : ours;
  const options: { key: Source; label: string; n: number; disabled?: boolean }[] = [
    // "Everyone", the same word the one table at /grid uses for the same
    // choice. It read "Master List" until 2026-09-11, which named a page that
    // no longer exists and offered one scope under two names on two public
    // surfaces.
    { key: "pool", label: "Everyone", n: pool.entries.length, disabled: !poolLoaded },
    { key: "ours", label: "Our group", n: ours.entries.length },
  ];

  return (
    <div className="space-y-4">
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
        {source === "pool" ? (
          <span className="text-xs text-muted-foreground">
            {poolHasPicks
              ? "Built from the published sheet, counted once the week has locked."
              : "The published sheet carries no week picks yet."}
          </span>
        ) : poolLoaded && !poolHasPicks ? (
          // The shared default opens here SILENTLY when a sheet is loaded
          // but carries no week cells; "stands in" has to say so.
          <span className="text-xs text-muted-foreground">
            Our group stands in until the published sheet carries a week&apos;s picks.
          </span>
        ) : null}
      </div>
      <TeamsClient
        key={source}
        counts={counts.filter((c) => c.scope === source)}
        weeks={weeks}
        games={games}
        entryCount={active.entries.length}
        scopeLabel={options.find((o) => o.key === source)?.label ?? "Everyone"}
      />
    </div>
  );
}
